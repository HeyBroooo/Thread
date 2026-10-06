/** Consistent API error format (doc §156). Never leak stack traces to clients. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

/** Internal job error format (doc §157). */
export interface JobError {
  jobId: string;
  stage: string;
  code: string;
  message: string;
  retryable: boolean;
}

export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: string, message: string, httpStatus = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }

  toBody(requestId: string): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const Errors = {
  repositoryNotFound: (id: string) =>
    new AppError('REPOSITORY_NOT_FOUND', `Repository ${id} was not found.`, 404),
  forbidden: (message = 'You do not have access to this resource.') =>
    new AppError('FORBIDDEN', message, 403),
  unauthorized: () => new AppError('UNAUTHORIZED', 'Authentication is required.', 401),
  badRequest: (message: string, details?: unknown) =>
    new AppError('BAD_REQUEST', message, 400, details),
  notIndexed: (message = 'The repository graph is not ready yet.') =>
    new AppError('GRAPH_NOT_READY', message, 409),
  aiFailed: (message: string) => new AppError('AI_FAILED', message, 502),
  webhookSignature: () => new AppError('INVALID_SIGNATURE', 'Webhook signature verification failed.', 401),
  internal: (message = 'Internal server error.') =>
    new AppError('INTERNAL_ERROR', message, 500),
};

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
