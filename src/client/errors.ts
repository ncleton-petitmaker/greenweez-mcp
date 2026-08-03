export class GreenweezError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly remediation: string,
  ) {
    super(message);
    this.name = "GreenweezError";
  }
}

export class ConfigurationError extends GreenweezError {
  constructor(message: string, remediation: string) {
    super(message, "configuration_error", remediation);
    this.name = "ConfigurationError";
  }
}

export class ConnectionError extends GreenweezError {
  constructor(message: string, remediation: string) {
    super(message, "connection_error", remediation);
    this.name = "ConnectionError";
  }
}

export class ContractChangedError extends GreenweezError {
  constructor(message: string) {
    super(message, "contract_changed", "Vérifiez la version du connecteur et ré-observez le parcours public Greenweez avant de réessayer.");
    this.name = "ContractChangedError";
  }
}

export class ConflictError extends GreenweezError {
  constructor(message: string, remediation: string) {
    super(message, "state_conflict", remediation);
    this.name = "ConflictError";
  }
}

export class MutationVerificationError extends GreenweezError {
  constructor(message: string) {
    super(message, "mutation_not_verified", "Relisez le panier réel avant toute nouvelle mutation, puis relancez une prévisualisation.");
    this.name = "MutationVerificationError";
  }
}
