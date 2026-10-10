/** An error the player may see. Anything else is logged and answered with a generic 500. */
export class GameError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new GameError(404, "not_found", `${what} not found`);
export const rejected = (code: string, message: string) => new GameError(409, code, message);
