export declare class GreenweezError extends Error {
    readonly code: string;
    readonly remediation: string;
    constructor(message: string, code: string, remediation: string);
}
export declare class ConfigurationError extends GreenweezError {
    constructor(message: string, remediation: string);
}
export declare class ConnectionError extends GreenweezError {
    constructor(message: string, remediation: string);
}
export declare class ContractChangedError extends GreenweezError {
    constructor(message: string);
}
export declare class ConflictError extends GreenweezError {
    constructor(message: string, remediation: string);
}
export declare class MutationVerificationError extends GreenweezError {
    constructor(message: string);
}
