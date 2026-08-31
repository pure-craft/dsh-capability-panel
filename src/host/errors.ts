export class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413 | 415 | 503,
    message: string,
  ) {
    super(message);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
