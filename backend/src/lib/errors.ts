export type AppErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'UPSTREAM_EXPIRED'
  | 'STORAGE_ERROR'
  | 'INTERNAL';

const STATUS: Record<AppErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  UPSTREAM_EXPIRED: 410,
  STORAGE_ERROR: 500,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  readonly userMessage: string;
  override readonly cause?: unknown;

  constructor(code: AppErrorCode, userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = STATUS[code];
    this.userMessage = userMessage;
    if (cause !== undefined) this.cause = cause;
  }
}
