import { describe, expect, it } from 'vitest'
import { AiActionError, describeAiActionError } from '../../src/main/services/ai-action-error'

describe('describeAiActionError', () => {
  it('preserves structured action errors', () => {
    expect(describeAiActionError(new AiActionError('TIMEOUT', 'timed out'))).toEqual({
      code: 'TIMEOUT',
      message: 'timed out',
    })
  })

  it('maps unexpected failures to IO_ERROR', () => {
    expect(describeAiActionError(new Error('network failed'))).toEqual({
      code: 'IO_ERROR',
      message: 'network failed',
    })
  })
})
