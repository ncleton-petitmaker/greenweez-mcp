import type { GreenweezOnboardingGateway } from "./onboarding.js";
export interface BrowserGateway {
    read(url: URL, expression: string): Promise<unknown>;
    mutate(url: URL, expression: string): Promise<unknown>;
}
export declare class CamoufoxGateway implements BrowserGateway, GreenweezOnboardingGateway {
    private readonly origin;
    private readonly apiKey;
    private readonly userId;
    private readonly environment;
    private sessionImportAttempted;
    constructor(environment?: NodeJS.ProcessEnv);
    private requestValue;
    private request;
    private open;
    private close;
    private evaluate;
    private importPortableSessionIfPresent;
    exportSession(): Promise<{
        exported: true;
    }>;
    loginAndExportSession(timeoutMs?: number): Promise<{
        connected: true;
        exported: true;
    }>;
    openAccountCreation(): Promise<{
        opened: true;
    }>;
    importSession(): Promise<{
        imported: true;
        connected: true;
    }>;
    sessionStatus(): Promise<{
        connected: boolean;
        portableBundle: boolean;
    }>;
    read(url: URL, expression: string): Promise<unknown>;
    mutate(url: URL, expression: string): Promise<unknown>;
}
