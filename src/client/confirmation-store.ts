import { createHash, randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { ConfigurationError, ConflictError, ContractChangedError } from "./errors.js";
import { sessionBundlePaths } from "./session-bundle.js";

const pendingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add"), expiresAt: z.string().datetime(), stateVersion: z.string().length(64), reference: z.string().min(1), slug: z.string().min(1), offerId: z.number().int().positive(), quantityBefore: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("remove"), expiresAt: z.string().datetime(), stateVersion: z.string().length(64), reference: z.string().min(1), cartItemId: z.number().int().positive(), quantityBefore: z.number().int().positive() }).strict(),
]);

const fileSchema = z.object({ version: z.literal(1), pending: z.record(z.string().length(64), pendingSchema) }).strict();

export type PendingConfirmation = z.infer<typeof pendingSchema>;
export type PendingConfirmationInput =
  | Omit<Extract<PendingConfirmation, { kind: "add" }>, "expiresAt">
  | Omit<Extract<PendingConfirmation, { kind: "remove" }>, "expiresAt">;

function tokenDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function paths(environment: NodeJS.ProcessEnv): { file: string; lock: string; mutationLock: string } {
  const base = dirname(sessionBundlePaths(environment).bundleFile);
  const scope = String(environment.GREENWEEZ_CAMOFOX_USER_ID ?? "greenweez-mcp").trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(scope)) throw new ConfigurationError("GREENWEEZ_CAMOFOX_USER_ID est invalide pour le registre de confirmations.", "Utilisez un identifiant local stable composé de lettres, chiffres, points, tirets ou underscores.");
  const file = resolve(environment.GREENWEEZ_CONFIRMATION_FILE ?? join(base, `pending-confirmations.${scope}.json`));
  return { file, lock: `${file}.lock`, mutationLock: resolve(environment.GREENWEEZ_MUTATION_LOCK_FILE ?? join(base, `cart-mutation.${scope}.lock`)) };
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(path, 0o700);
}

function atomicWrite(path: string, value: unknown): void {
  ensurePrivateDirectory(dirname(path));
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
  if (process.platform !== "win32") chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  if (process.platform !== "win32") chmodSync(path, 0o600);
}

function acquire(path: string, purpose: string): () => void {
  ensurePrivateDirectory(dirname(path));
  let descriptor: number | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      descriptor = openSync(path, "wx", 0o600);
      writeFileSync(descriptor, `${process.pid}\n`);
      break;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "EEXIST" && attempt === 0) {
        try {
          if (Date.now() - statSync(path).mtimeMs > 10 * 60_000) { unlinkSync(path); continue; }
        } catch {}
      }
      if (code === "EEXIST") throw new ConflictError(`Une autre ${purpose} Greenweez est déjà en cours.`, "Attendez sa fin puis relisez le panier avant de recommencer.");
      throw new ConfigurationError(`Le verrou privé Greenweez ne peut pas être créé pour ${purpose}.`, "Vérifiez les droits d’écriture du répertoire de session Greenweez.");
    }
  }
  if (descriptor === undefined) throw new ConfigurationError(`Le verrou privé Greenweez ne peut pas être créé pour ${purpose}.`, "Vérifiez les droits d’écriture du répertoire de session Greenweez.");
  return () => {
    try { closeSync(descriptor); } catch {}
    try { unlinkSync(path); } catch {}
  };
}

export class ConfirmationStore {
  private readonly file: string;
  private readonly lock: string;
  private readonly mutationLock: string;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    ({ file: this.file, lock: this.lock, mutationLock: this.mutationLock } = paths(environment));
  }

  private load(): z.infer<typeof fileSchema> {
    if (!existsSync(this.file)) return { version: 1, pending: {} };
    let value: unknown;
    try { value = JSON.parse(readFileSync(this.file, "utf8")); }
    catch { throw new ContractChangedError("Le registre privé des confirmations Greenweez est illisible."); }
    const parsed = fileSchema.safeParse(value);
    if (!parsed.success) throw new ContractChangedError("Le registre privé des confirmations Greenweez a un format inconnu.");
    if (process.platform !== "win32") chmodSync(this.file, 0o600);
    return parsed.data;
  }

  create(pending: PendingConfirmationInput, ttlMs = 120_000): { confirmationToken: string; expiresAt: string } {
    const release = acquire(this.lock, "prévisualisation");
    try {
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();
      const state = this.load();
      const now = Date.now();
      for (const [digest, item] of Object.entries(state.pending)) if (Date.parse(item.expiresAt) <= now) delete state.pending[digest];
      state.pending[tokenDigest(token)] = pendingSchema.parse({ ...pending, expiresAt });
      atomicWrite(this.file, state);
      return { confirmationToken: token, expiresAt };
    } finally { release(); }
  }

  take(token: string): PendingConfirmation {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ConflictError("Le jeton de confirmation Greenweez est invalide.", "Relancez la prévisualisation et utilisez exactement le nouveau jeton retourné.");
    const release = acquire(this.lock, "confirmation");
    try {
      const state = this.load();
      const digest = tokenDigest(token);
      const pending = state.pending[digest];
      if (pending) delete state.pending[digest];
      atomicWrite(this.file, state);
      if (!pending) throw new ConflictError("Cette confirmation Greenweez est inconnue ou a déjà été utilisée.", "Relancez la prévisualisation sur l’état actuel du panier.");
      if (Date.parse(pending.expiresAt) <= Date.now()) throw new ConflictError("Cette confirmation Greenweez a expiré.", "Relancez la prévisualisation sur l’état actuel du panier.");
      return pending;
    } finally { release(); }
  }

  withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const release = acquire(this.mutationLock, "mutation de panier");
    return operation().finally(release);
  }
}
