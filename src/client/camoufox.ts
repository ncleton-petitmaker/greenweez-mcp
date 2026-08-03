import { ConfigurationError, ConnectionError, ContractChangedError } from "./errors.js";
import { readEncryptedSessionBundle, sessionBundleExists, writeEncryptedSessionBundle } from "./session-bundle.js";

export interface BrowserGateway {
  read(url: URL, expression: string): Promise<unknown>;
  mutate(url: URL, expression: string): Promise<unknown>;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractChangedError("Le navigateur local a renvoyé une réponse non reconnue.");
  }
  return value as JsonRecord;
}

function requireLocalOrigin(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch {
    throw new ConfigurationError("GREENWEEZ_CAMOFOX_URL doit être une URL HTTP locale valide.", "Démarrez Camofox sur loopback puis définissez GREENWEEZ_CAMOFOX_URL.");
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ConfigurationError("GREENWEEZ_CAMOFOX_URL doit désigner uniquement une origine HTTP loopback.", "Utilisez par exemple http://127.0.0.1:9377.");
  }
  return url;
}

export class CamoufoxGateway implements BrowserGateway {
  private readonly origin: URL;
  private readonly apiKey: string;
  private readonly userId: string;
  private readonly environment: NodeJS.ProcessEnv;
  private sessionImportAttempted = false;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.environment = environment;
    this.origin = requireLocalOrigin(environment.GREENWEEZ_CAMOFOX_URL ?? "http://127.0.0.1:9377");
    this.apiKey = String(environment.GREENWEEZ_CAMOFOX_API_KEY ?? "").trim();
    if (Buffer.byteLength(this.apiKey, "utf8") < 32) {
      throw new ConfigurationError("GREENWEEZ_CAMOFOX_API_KEY est absent ou trop court.", "Configurez une clé aléatoire d’au moins 32 octets sur le service Camofox local et dans l’environnement du MCP.");
    }
    this.userId = String(environment.GREENWEEZ_CAMOFOX_USER_ID ?? "greenweez-mcp").trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(this.userId)) {
      throw new ConfigurationError("GREENWEEZ_CAMOFOX_USER_ID est invalide.", "Utilisez un identifiant local stable composé de lettres, chiffres, points, tirets ou underscores.");
    }
  }

  private async requestValue(path: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    timeout.unref();
    try {
      const response = await fetch(new URL(path, this.origin), {
        ...init,
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", ...init.headers },
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const reason = typeof body === "object" && body !== null && "error" in body ? String((body as JsonRecord).error) : `HTTP ${response.status}`;
        throw new ConnectionError(`Le navigateur local a refusé l’opération (${reason}).`, "Vérifiez que Camofox est actif sur loopback, que sa clé correspond à GREENWEEZ_CAMOFOX_API_KEY et que sa version est compatible.");
      }
      return body;
    } catch (error) {
      if (error instanceof ConnectionError || error instanceof ContractChangedError) throw error;
      throw new ConnectionError("Le navigateur local Camofox est indisponible.", "Démarrez Camofox localement et vérifiez GREENWEEZ_CAMOFOX_URL et GREENWEEZ_CAMOFOX_API_KEY.");
    } finally { clearTimeout(timeout); }
  }

  private async request(path: string, init: RequestInit = {}): Promise<JsonRecord> {
    return asRecord(await this.requestValue(path, init));
  }

  private async open(url: URL): Promise<string> {
    if (url.origin !== "https://www.greenweez.com") throw new ConfigurationError("Le connecteur a refusé une origine non Greenweez.", "Utilisez uniquement les outils Greenweez fournis par ce MCP.");
    const opened = await this.request("/tabs", { method: "POST", body: JSON.stringify({ url: url.toString(), userId: this.userId, sessionKey: "greenweez" }) });
    const tabId = typeof opened.tabId === "string" ? opened.tabId : undefined;
    if (!tabId) throw new ContractChangedError("Camofox n’a pas retourné l’identifiant d’onglet attendu.");
    await this.request(`/tabs/${encodeURIComponent(tabId)}/wait`, { method: "POST", body: JSON.stringify({ userId: this.userId, timeout: 30_000, waitForNetwork: true }) });
    return tabId;
  }

  private async close(tabId: string): Promise<void> {
    await this.request(`/tabs/${encodeURIComponent(tabId)}`, { method: "DELETE", body: JSON.stringify({ userId: this.userId }) }).catch(() => undefined);
  }

  private async evaluate(tabId: string, expression: string): Promise<unknown> {
    const result = await this.request(`/tabs/${encodeURIComponent(tabId)}/evaluate-extended`, { method: "POST", body: JSON.stringify({ userId: this.userId, expression, timeout: 30_000 }) });
    if (result.ok !== true || !("result" in result)) throw new ContractChangedError("Le navigateur n’a pas pu extraire la page Greenweez avec le contrat attendu.");
    return result.result;
  }

  private async importPortableSessionIfPresent(): Promise<void> {
    if (this.sessionImportAttempted) return;
    this.sessionImportAttempted = true;
    if (!sessionBundleExists(this.environment)) return;
    await this.importSession();
  }

  async exportSession(): Promise<{ exported: true }> {
    const tabId = await this.open(new URL("https://www.greenweez.com/mon-compte"));
    try {
      const connected = await this.evaluate(tabId, `(() => { const text=String(document.body.innerText||''); return location.pathname.startsWith('/mon-compte') && !/me connecter|connexion à votre compte/i.test(text); })()`);
      if (connected !== true) throw new ConnectionError("La session Greenweez n’est pas connectée.", "Connectez-vous dans la page locale Greenweez, puis relancez l’export.");
      const cookies = await this.requestValue(`/tabs/${encodeURIComponent(tabId)}/cookies?userId=${encodeURIComponent(this.userId)}`);
      writeEncryptedSessionBundle(cookies, this.environment);
      return { exported: true };
    } finally { await this.close(tabId); }
  }

  async loginAndExportSession(timeoutMs = 10 * 60_000): Promise<{ connected: true; exported: true }> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 30 * 60_000) throw new ConfigurationError("Le délai de connexion locale est invalide.", "Utilisez un délai compris entre 30 secondes et 30 minutes.");
    const tabId = await this.open(new URL("https://www.greenweez.com/mon-compte"));
    const deadline = Date.now() + timeoutMs;
    try {
      while (Date.now() < deadline) {
        const connected = await this.evaluate(tabId, `(() => { const text=String(document.body.innerText||''); return location.pathname.startsWith('/mon-compte') && !/me connecter|connexion à votre compte/i.test(text); })()`);
        if (connected === true) {
          const cookies = await this.requestValue(`/tabs/${encodeURIComponent(tabId)}/cookies?userId=${encodeURIComponent(this.userId)}`);
          writeEncryptedSessionBundle(cookies, this.environment);
          return { connected: true, exported: true };
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      throw new ConnectionError("La connexion Greenweez locale n’a pas été terminée dans le délai imparti.", "Relancez `greenweez session login` puis terminez la connexion dans la fenêtre locale, sans transmettre vos identifiants au MCP.");
    } finally { await this.close(tabId); }
  }

  async importSession(): Promise<{ imported: true; connected: true }> {
    const cookies = readEncryptedSessionBundle(this.environment);
    const tabId = await this.open(new URL("https://www.greenweez.com/"));
    try {
      await this.request(`/sessions/${encodeURIComponent(this.userId)}/cookies`, { method: "POST", body: JSON.stringify({ cookies, tabId }) });
      await this.request(`/tabs/${encodeURIComponent(tabId)}/navigate`, { method: "POST", body: JSON.stringify({ userId: this.userId, url: "https://www.greenweez.com/mon-compte" }) });
      await this.request(`/tabs/${encodeURIComponent(tabId)}/wait`, { method: "POST", body: JSON.stringify({ userId: this.userId, timeout: 30_000, waitForNetwork: true }) });
      const connected = await this.evaluate(tabId, `(() => { const text=String(document.body.innerText||''); return location.pathname.startsWith('/mon-compte') && !/me connecter|connexion à votre compte/i.test(text); })()`);
      if (connected !== true) throw new ConnectionError("La session Greenweez importée a expiré ou a été révoquée.", "Reconnectez-vous localement une fois, puis créez un nouveau bundle chiffré.");
      return { imported: true, connected: true };
    } finally { await this.close(tabId); }
  }

  async sessionStatus(): Promise<{ connected: boolean; portableBundle: boolean }> {
    await this.importPortableSessionIfPresent();
    const tabId = await this.open(new URL("https://www.greenweez.com/mon-compte"));
    try {
      const connected = await this.evaluate(tabId, `(() => { const text=String(document.body.innerText||''); return location.pathname.startsWith('/mon-compte') && !/me connecter|connexion à votre compte/i.test(text); })()`);
      return { connected: connected === true, portableBundle: sessionBundleExists(this.environment) };
    } finally { await this.close(tabId); }
  }

  async read(url: URL, expression: string): Promise<unknown> {
    if (url.origin !== "https://www.greenweez.com") {
      throw new ConfigurationError("Le connecteur a refusé une origine non Greenweez.", "Utilisez uniquement les outils publics Greenweez fournis par ce MCP.");
    }
    await this.importPortableSessionIfPresent();
    let tabId: string | undefined;
    try {
      tabId = await this.open(url);
      return await this.evaluate(tabId, expression);
    } finally {
      if (tabId) await this.close(tabId);
    }
  }

  async mutate(url: URL, expression: string): Promise<unknown> {
    return this.read(url, expression);
  }
}
