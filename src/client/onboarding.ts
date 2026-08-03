import { randomBytes } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { ConfigurationError, ConnectionError } from "./errors.js";

export const GREENWEEZ_LOGIN_URL = "https://www.greenweez.com/connexion";
export const GREENWEEZ_SIGNUP_URL = "https://www.greenweez.com/inscription";

export interface GreenweezOnboardingGateway {
  sessionStatus(): Promise<{ connected: boolean; portableBundle: boolean }>;
  loginAndExportSession(): Promise<{ connected: true; exported: true }>;
  openAccountCreation(): Promise<{ opened: true }>;
}

export interface GreenweezConnectionWizard {
  status: "connected" | "connection_required";
  wizardUrl?: string;
  links?: {
    signIn: string;
    createAccount: string;
  };
  officialLinks: {
    signIn: string;
    createAccount: string;
  };
  message: string;
}

type WizardState = "ready" | "connecting" | "connected" | "error";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function page(baseUrl: string, state: WizardState, message: string): string {
  const status = state === "connected" ? "Connexion terminée" : state === "connecting" ? "Connexion en cours" : state === "error" ? "Connexion à relancer" : "Prêt à connecter";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Connecter Greenweez</title><style>body{margin:0;background:#f5faf6;color:#173327;font:16px system-ui,-apple-system,sans-serif}.card{max-width:620px;margin:8vh auto;padding:32px;background:#fff;border-radius:20px;box-shadow:0 16px 50px #0b48211c}h1{margin:0 0 8px;font-size:28px}p{line-height:1.5}.actions{display:grid;gap:12px;margin:28px 0}.action{display:block;padding:15px 18px;border-radius:12px;text-decoration:none;text-align:center;font-weight:700;background:#087a46;color:#fff}.secondary{background:#e4f5e9;color:#075c35}.status{padding:14px;border-radius:10px;background:#f0f7f2}.small{color:#486153;font-size:14px}</style></head><body><main class="card"><h1>🛒 Connecter Greenweez</h1><p>Choisissez une option. Vos identifiants et votre éventuel code 2FA sont saisis uniquement sur Greenweez, jamais dans le MCP.</p><div class="actions"><a class="action" href="${baseUrl}/connect">J’ai un compte — me connecter</a><a class="action secondary" href="${baseUrl}/create-account">Créer un compte Greenweez</a></div><div class="status"><strong>${escapeHtml(status)}</strong><br><span id="message">${escapeHtml(message)}</span></div><p class="small">Cette page écoute seulement sur votre ordinateur. Une fois la connexion validée, vous pouvez la fermer.</p></main><script>const refresh=async()=>{const response=await fetch('${baseUrl}/status',{cache:'no-store'});const value=await response.json();document.getElementById('message').textContent=value.message;if(value.state==='connecting')setTimeout(refresh,1200);};refresh();</script></body></html>`;
}

export class GreenweezOnboarding {
  private server: Server | undefined;
  private token: string | undefined;
  private state: WizardState = "ready";
  private message = "Choisissez la connexion ou la création de compte.";
  private loginPromise: Promise<void> | undefined;
  private closeTimer: NodeJS.Timeout | undefined;

  constructor(private readonly gateway: GreenweezOnboardingGateway) {}

  private resetCloseTimer(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => { void this.close(); }, 15 * 60_000);
    this.closeTimer.unref();
  }

  private async startServer(): Promise<string> {
    if (this.server && this.token) return this.url();
    this.token = randomBytes(24).toString("base64url");
    this.server = createServer((request, response) => { void this.handle(request.url ?? "/", response); });
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(0, "127.0.0.1", () => resolve());
    });
    this.resetCloseTimer();
    return this.url();
  }

  private url(): string {
    const address = this.server?.address();
    if (!this.token || !address || typeof address === "string") throw new ConfigurationError("Le wizard Greenweez local ne peut pas déterminer son adresse.", "Relancez l’outil connect_greenweez.");
    return `http://127.0.0.1:${address.port}/${this.token}`;
  }

  private send(response: ServerResponse, status: number, body: string, contentType: string): void {
    response.writeHead(status, {
      "content-type": contentType,
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    });
    response.end(body);
  }

  private async handle(requestUrl: string, response: ServerResponse): Promise<void> {
    this.resetCloseTimer();
    const baseUrl = this.url();
    let url: URL;
    try { url = new URL(requestUrl, baseUrl); } catch { this.send(response, 400, "Requête invalide.", "text/plain; charset=utf-8"); return; }
    if (!url.pathname.startsWith(`/${this.token}`)) { this.send(response, 404, "Introuvable.", "text/plain; charset=utf-8"); return; }
    const suffix = url.pathname.slice(`/${this.token}`.length) || "/";
    if (suffix === "/status") {
      this.send(response, 200, JSON.stringify({ state: this.state, message: this.message }), "application/json; charset=utf-8");
      return;
    }
    if (suffix === "/connect") {
      this.startLogin();
      response.writeHead(302, { location: baseUrl, "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-frame-options": "DENY" });
      response.end();
      return;
    }
    if (suffix === "/create-account") {
      try {
        await this.gateway.openAccountCreation();
        this.message = "La création de compte est ouverte dans Greenweez. Revenez ensuite ici puis choisissez la connexion.";
      } catch {
        this.state = "error";
        this.message = "La page officielle de création de compte n’a pas pu être ouverte. Vérifiez le navigateur local puis réessayez.";
      }
      response.writeHead(302, { location: baseUrl, "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-frame-options": "DENY" });
      response.end();
      return;
    }
    this.send(response, 200, page(baseUrl, this.state, this.message), "text/html; charset=utf-8");
  }

  private startLogin(): void {
    if (this.loginPromise || this.state === "connected") return;
    this.state = "connecting";
    this.message = "La fenêtre Greenweez locale est ouverte. Terminez la connexion ou le 2FA directement dans cette fenêtre.";
    this.loginPromise = this.gateway.loginAndExportSession().then(() => {
      this.state = "connected";
      this.message = "Connexion vérifiée. La session chiffrée est prête pour ce MCP.";
    }).catch((error: unknown) => {
      this.state = "error";
      this.message = error instanceof ConnectionError ? error.message : "La connexion n’a pas abouti. Relancez la connexion depuis cette page.";
    }).finally(() => { this.loginPromise = undefined; });
  }

  async begin(): Promise<GreenweezConnectionWizard> {
    const status = await this.gateway.sessionStatus();
    const officialLinks = { signIn: GREENWEEZ_LOGIN_URL, createAccount: GREENWEEZ_SIGNUP_URL };
    if (status.connected) return { status: "connected", officialLinks, message: "La session Greenweez est déjà connectée et vérifiée." };
    const wizardUrl = await this.startServer();
    return {
      status: "connection_required",
      wizardUrl,
      links: { signIn: `${wizardUrl}/connect`, createAccount: `${wizardUrl}/create-account` },
      officialLinks,
      message: "Ouvrez le wizard local. Il propose directement la connexion à un compte existant ou la création d’un compte Greenweez.",
    };
  }

  async close(): Promise<void> {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = undefined;
    const server = this.server;
    this.server = undefined;
    this.token = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
