import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { ConfigurationError, ConnectionError, ContractChangedError } from "./errors.js";
const cookieSchema = z.object({
    name: z.string().min(1),
    value: z.string(),
    domain: z.string().min(1),
    path: z.string().optional(),
    expires: z.number().optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
}).strict();
const payloadSchema = z.object({
    version: z.literal(1),
    provider: z.literal("greenweez.com"),
    cookies: z.array(cookieSchema).max(500),
}).strict();
const envelopeSchema = z.object({
    version: z.literal(1),
    algorithm: z.literal("aes-256-gcm"),
    iv: z.string().regex(/^[a-f0-9]{24}$/),
    tag: z.string().regex(/^[a-f0-9]{32}$/),
    ciphertext: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
const portableCookieNames = new Set([
    "__Host-next-auth.csrf-token",
    "__Secure-next-auth.callback-url",
    "__Secure-next-auth.session-token",
    "__cf_bm",
    "cartToken",
    "cf_clearance",
    "gwz-user-token",
]);
function defaultDataDirectory(environment) {
    if (environment.GREENWEEZ_SESSION_DIRECTORY)
        return resolve(environment.GREENWEEZ_SESSION_DIRECTORY);
    if (environment.XDG_DATA_HOME)
        return join(resolve(environment.XDG_DATA_HOME), "greenweez-mcp");
    if (process.platform === "win32" && environment.APPDATA)
        return join(resolve(environment.APPDATA), "greenweez-mcp");
    return join(homedir(), ".local", "share", "greenweez-mcp");
}
export function sessionBundlePaths(environment = process.env) {
    const directory = defaultDataDirectory(environment);
    const scope = String(environment.GREENWEEZ_CAMOFOX_USER_ID ?? "greenweez-mcp").trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(scope))
        throw new ConfigurationError("GREENWEEZ_CAMOFOX_USER_ID est invalide pour le bundle de session.", "Utilisez un identifiant local stable composé de lettres, chiffres, points, tirets ou underscores.");
    const suffix = scope === "greenweez-mcp" ? "" : `.${scope}`;
    return {
        bundleFile: resolve(environment.GREENWEEZ_SESSION_BUNDLE_FILE ?? join(directory, `greenweez-session${suffix}.enc.json`)),
        keyFile: resolve(environment.GREENWEEZ_SESSION_KEY_FILE ?? join(directory, `greenweez-session${suffix}.key`)),
    };
}
function privateDirectory(path) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32")
        chmodSync(path, 0o700);
}
function atomicPrivateWrite(path, contents) {
    privateDirectory(dirname(path));
    const temporary = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
    writeFileSync(temporary, contents, { mode: 0o600, flag: "wx" });
    if (process.platform !== "win32")
        chmodSync(temporary, 0o600);
    renameSync(temporary, path);
    if (process.platform !== "win32")
        chmodSync(path, 0o600);
}
function getOrCreateKey(path, create) {
    if (!existsSync(path)) {
        if (!create)
            throw new ConnectionError("La clé de session Greenweez est absente.", "Copiez le fichier de clé privé depuis la machine déjà connectée ou reconnectez-vous localement une fois.");
        atomicPrivateWrite(path, `${randomBytes(32).toString("hex")}\n`);
    }
    const encoded = readFileSync(path, "utf8").trim();
    if (!/^[a-f0-9]{64}$/i.test(encoded))
        throw new ConfigurationError("Le fichier de clé de session Greenweez est invalide.", "Restaurez la clé privée d’origine correspondant au bundle chiffré.");
    if (process.platform !== "win32")
        chmodSync(path, 0o600);
    return Buffer.from(encoded, "hex");
}
function greenweezCookies(value) {
    const parsed = z.array(cookieSchema).max(500).safeParse(value);
    if (!parsed.success)
        throw new ContractChangedError("Camofox a renvoyé un format de session non reconnu.");
    const cookies = parsed.data.filter((cookie) => {
        const domain = cookie.domain.replace(/^\./, "").toLowerCase();
        return (domain === "greenweez.com" || domain.endsWith(".greenweez.com")) && portableCookieNames.has(cookie.name);
    });
    if (!cookies.length)
        throw new ConnectionError("Aucune session Greenweez exportable n’a été trouvée.", "Connectez-vous dans la page locale Greenweez, puis relancez l’export de session.");
    return cookies;
}
export function writeEncryptedSessionBundle(rawCookies, environment = process.env) {
    const cookies = greenweezCookies(rawCookies);
    const paths = sessionBundlePaths(environment);
    const key = getOrCreateKey(paths.keyFile, true);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const plaintext = Buffer.from(JSON.stringify({ version: 1, provider: "greenweez.com", cookies }), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = { version: 1, algorithm: "aes-256-gcm", iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ciphertext: ciphertext.toString("base64") };
    atomicPrivateWrite(paths.bundleFile, `${JSON.stringify(envelope)}\n`);
}
export function readEncryptedSessionBundle(environment = process.env) {
    const paths = sessionBundlePaths(environment);
    if (!existsSync(paths.bundleFile))
        throw new ConnectionError("Le bundle de session Greenweez est absent.", "Copiez le bundle chiffré et sa clé privée depuis la machine déjà connectée, ou reconnectez-vous localement une fois.");
    let rawEnvelope;
    try {
        rawEnvelope = JSON.parse(readFileSync(paths.bundleFile, "utf8"));
    }
    catch {
        throw new ContractChangedError("Le bundle de session Greenweez n’est pas un document JSON valide.");
    }
    const envelope = envelopeSchema.safeParse(rawEnvelope);
    if (!envelope.success)
        throw new ContractChangedError("Le bundle de session Greenweez est corrompu ou d’une version non reconnue.");
    const key = getOrCreateKey(paths.keyFile, false);
    try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.data.iv, "hex"));
        decipher.setAuthTag(Buffer.from(envelope.data.tag, "hex"));
        const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data.ciphertext, "base64")), decipher.final()]);
        const payload = payloadSchema.parse(JSON.parse(plaintext.toString("utf8")));
        if (process.platform !== "win32")
            chmodSync(paths.bundleFile, 0o600);
        return payload.cookies;
    }
    catch (error) {
        if (error instanceof z.ZodError)
            throw new ContractChangedError("Le contenu du bundle de session Greenweez n’est plus reconnu.");
        throw new ConnectionError("Le bundle de session Greenweez ne peut pas être déchiffré.", "Utilisez le fichier de clé créé avec ce bundle ; ne mélangez pas les fichiers provenant de deux exports différents.");
    }
}
export function sessionBundleExists(environment = process.env) {
    const paths = sessionBundlePaths(environment);
    return existsSync(paths.bundleFile) && existsSync(paths.keyFile);
}
