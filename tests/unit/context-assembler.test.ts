import { beforeEach, describe, expect, it, vi } from 'vitest'

const logIndexMocks = vi.hoisted(() => ({
  getCachedLogIndex: vi.fn(),
  scheduleLogIndex: vi.fn(),
}))

vi.mock('../../src/main/services/log-index-service', () => ({
  getCachedLogIndex: logIndexMocks.getCachedLogIndex,
  scheduleLogIndex: logIndexMocks.scheduleLogIndex,
}))

vi.mock('../../src/main/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn() },
}))

import { assembleAgentContext } from '../../src/main/agent/context-assembler'

describe('context-assembler large log enrichment', () => {
  beforeEach(() => {
    logIndexMocks.getCachedLogIndex.mockReset()
    logIndexMocks.scheduleLogIndex.mockReset()
  })

  it('uses no synchronous build when a large log has no cached index', () => {
    logIndexMocks.getCachedLogIndex.mockReturnValue(undefined)

    const result = assembleAgentContext({
      baseSystemPrompt: 'base',
      userMessage: 'analyse this log',
      history: [],
      openFiles: [{
        path: 'C:\\logs\\large.log',
        sizeBytes: 20 * 1024 * 1024,
        lines: 200_000,
        encoding: 'utf8',
      }],
    })

    expect(logIndexMocks.getCachedLogIndex).toHaveBeenCalledWith('C:\\logs\\large.log')
    expect(logIndexMocks.scheduleLogIndex).toHaveBeenCalledWith('C:\\logs\\large.log')
    expect(result.system).toContain('Log index is being prepared')
  })
})
