import { describe, expect, it } from 'vitest'
import { getSaveErrorMessage } from '../../src/renderer/src/hooks/useShortcuts'

describe('Ctrl+S error messages', () => {
  it('explains a version conflict without suggesting overwrite', () => {
    expect(getSaveErrorMessage('VERSION_CONFLICT')).toBe('文件已在外部修改，未覆盖原文件')
  })

  it('translates other save failures to a concise Chinese message', () => {
    expect(getSaveErrorMessage('UNKNOWN', '磁盘不可用')).toBe('保存失败：磁盘不可用')
    expect(getSaveErrorMessage()).toBe('保存失败，请稍后重试')
  })
})
