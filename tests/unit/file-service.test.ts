import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as iconv from 'iconv-lite'
import { FluxFileError, readFileLineRange, readText, saveText } from '../../src/main/services/file-service'

describe('file-service text documents', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-file-service-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it.each([
    ['utf8', Buffer.from('hello', 'utf8')],
    ['utf8-bom', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello')])],
    ['gbk', iconv.encode('\u4f60\u597d', 'gbk')],
    ['utf16le', Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode('hello', 'utf16le')])],
    ['utf16be', Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode('hello', 'utf16be')])],
  ])('detects %s text', (encoding, content) => {
    const filePath = path.join(tempDir, `${encoding}.txt`)
    fs.writeFileSync(filePath, content)

    expect(readText(filePath).encoding).toBe(encoding)
  })

  it('rejects binary files', () => {
    const filePath = path.join(tempDir, 'binary.bin')
    fs.writeFileSync(filePath, Buffer.from([0x00, 0x01, 0x02]))

    expect(() => readText(filePath)).toThrow(FluxFileError)
  })

  it('preserves source encoding and line endings through an atomic save', async () => {
    const filePath = path.join(tempDir, 'legacy.txt')
    fs.writeFileSync(filePath, iconv.encode('\u4f60\u597d\r\nworld\r\n', 'gbk'))
    const opened = readText(filePath)

    const saved = await saveText({
      filePath,
      content: '\u518d\u89c1\nworld\n',
      encoding: opened.encoding,
      lineEnding: opened.lineEnding,
      expectedVersion: opened.version,
    })

    expect(readText(filePath)).toMatchObject({
      content: '\u518d\u89c1\r\nworld\r\n',
      encoding: 'gbk',
      lineEnding: 'crlf',
      version: saved.version,
    })
    expect(iconv.decode(fs.readFileSync(filePath), 'gbk')).toBe('\u518d\u89c1\r\nworld\r\n')
  })

  it('does not overwrite an externally changed file', async () => {
    const filePath = path.join(tempDir, 'conflict.txt')
    fs.writeFileSync(filePath, 'before', 'utf8')
    const opened = readText(filePath)
    fs.writeFileSync(filePath, 'external edit', 'utf8')

    await expect(saveText({
      filePath,
      content: 'local edit',
      encoding: opened.encoding,
      lineEnding: opened.lineEnding,
      expectedVersion: opened.version,
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    expect(fs.readFileSync(filePath, 'utf8')).toBe('external edit')
  })

  it('keeps UTF-8 characters intact when a large streamed read crosses a chunk boundary', () => {
    const filePath = path.join(tempDir, 'streamed.txt')
    const firstLine = `${'a'.repeat(262_143)}你`
    const body = `${firstLine}\n第二行：完整文本\n${'z'.repeat(300_000)}`
    fs.writeFileSync(filePath, body, 'utf8')

    const result = readFileLineRange(filePath, 1, 1)
    expect(result.content).toBe('第二行：完整文本')
    expect(result.content).not.toContain('\uFFFD')
  })
})
