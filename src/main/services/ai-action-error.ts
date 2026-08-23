import type { FluxErrorCode } from '../../shared/types'

export class AiActionError extends Error {
  constructor(
    public readonly code: FluxErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AiActionError'
  }
}

export function describeAiActionError(error: unknown): { code: FluxErrorCode; message: string } {
  if (error instanceof AiActionError) return { code: error.code, message: error.message }
  return {
    code: 'IO_ERROR',
    message: error instanceof Error ? error.message : String(error),
  }
}
