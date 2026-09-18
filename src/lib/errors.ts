const STATUS = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const;

export type AppErrorCode = keyof typeof STATUS;

const GENERIC_MESSAGE = 'Ha ocurrido un error inesperado. Inténtalo de nuevo en unos minutos.';

/**
 * The only error that may cross the server boundary.
 * `userMessage` is Spanish copy that is safe to show; `message` is the technical detail for logs.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;

  constructor(code: AppErrorCode, userMessage: string, technicalMessage?: string, cause?: unknown) {
    super(technicalMessage ?? userMessage, { cause });
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

/** Anything that is not an AppError (Prisma, network, bugs) collapses to a generic message. */
export function toUserMessage(error: unknown): string {
  return error instanceof AppError ? error.userMessage : GENERIC_MESSAGE;
}
