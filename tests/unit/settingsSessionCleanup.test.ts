import { describe, expect, it } from 'vitest'

import { buildManualCleanupOptions } from '../../src/renderer/src/components/settings/SettingsView'

describe('manual session cleanup', () => {
  it('protects the active session in the cleanup payload', () => {
    expect(buildManualCleanupOptions(14, 64, 'new-active-session')).toEqual({
      retentionDays: 14,
      maxBytes: 64 * 1024 * 1024,
      protectedSessionIds: ['new-active-session'],
    })
  })

  it('uses an empty protection list when there is no active session', () => {
    expect(buildManualCleanupOptions(30, 200, null)).toEqual({
      retentionDays: 30,
      maxBytes: 200 * 1024 * 1024,
      protectedSessionIds: [],
    })
  })
})
