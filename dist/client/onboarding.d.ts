export declare const GREENWEEZ_LOGIN_URL = "https://www.greenweez.com/connexion";
export declare const GREENWEEZ_SIGNUP_URL = "https://www.greenweez.com/inscription";
export interface GreenweezOnboardingGateway {
    sessionStatus(): Promise<{
        connected: boolean;
        portableBundle: boolean;
    }>;
    loginAndExportSession(): Promise<{
        connected: true;
        exported: true;
    }>;
    openAccountCreation(): Promise<{
        opened: true;
    }>;
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
export declare class GreenweezOnboarding {
    private readonly gateway;
    private server;
    private token;
    private state;
    private message;
    private loginPromise;
    private closeTimer;
    constructor(gateway: GreenweezOnboardingGateway);
    private resetCloseTimer;
    private startServer;
    private url;
    private send;
    private handle;
    private startLogin;
    begin(): Promise<GreenweezConnectionWizard>;
    close(): Promise<void>;
}
