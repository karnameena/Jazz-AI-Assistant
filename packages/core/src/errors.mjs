export class JazzError extends Error {
  constructor(code, message, { cause, details = {}, retryable = false } = {}) {
    super(message, { cause });
    this.name = "JazzError";
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message, details: this.details, retryable: this.retryable };
  }
}

export function normalizeError(error, fallbackCode = "JAZZ_INTERNAL_ERROR") {
  if (error instanceof JazzError) return error;
  return new JazzError(fallbackCode, error instanceof Error ? error.message : String(error), { cause: error });
}
