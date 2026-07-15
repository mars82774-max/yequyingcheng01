export class SourceStopError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SourceStopError";
    this.details = details;
    this.httpStatus = details.httpStatus || 0;
    this.retryable = Boolean(details.retryable);
    this.blocked = Boolean(details.blocked);
  }
}

export function isSourceStopError(error) {
  return error instanceof SourceStopError || error?.name === "SourceStopError";
}
