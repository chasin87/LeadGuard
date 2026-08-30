export class AuthorizationError extends Error {
  readonly status = 403;
  readonly code = "FORBIDDEN";

  constructor(message = "Je hebt geen toegang tot deze organisatie.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class UnauthenticatedError extends Error {
  readonly status = 401;
  readonly code = "UNAUTHENTICATED";

  constructor(message = "Je moet ingelogd zijn om dit te doen.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export class OrganizationNotFoundError extends Error {
  readonly status = 404;
  readonly code = "ORGANIZATION_NOT_FOUND";

  constructor(message = "Organisatie niet gevonden.") {
    super(message);
    this.name = "OrganizationNotFoundError";
  }
}

export class DomainError extends Error {
  readonly status = 400;
  readonly code = "DOMAIN_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export function isAuthorizationError(
  error: unknown,
): error is AuthorizationError {
  return error instanceof AuthorizationError;
}
