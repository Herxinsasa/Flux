import fs from 'fs'
import * as iconv from 'iconv-lite'

const CHUNK_SIZE = 64 * 1024 // 64KB
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024 // 10MB

/**
 * Stream-read a file in 64KB chunks with the given encoding.
 * Returns an abort function.
 *
 * - For UTF-8: uses native fs.createReadStream with encoding.
 * - For GBK and other non-UTF-8 encodings: pipes through iconv-lite decodeStream,
 *   which correctly handles multi-byte character boundaries across chunks.
 *
 * Usage in IPC handler:
 *   const cancel = streamReadFile(filePath, encoding,
 *     (chunk) => event.sender.send(channel, chunk),
 *     () => event.sender.send(channel, null), // null signals end
 *     (err) => event.sender.send(channel, { error: err.message }),
 *   )
 */
export function streamReadFile(
  filePath: string,
  encoding: string,
  onChunk: (chunk: string) => void,
  onEnd: () => void,
  onError: (error: Error) => void,
): () => void {
  // Native Node.js encodings: use fs.createReadStream directly
  if (encoding === 'utf8' || encoding === 'utf-8' || encoding === 'utf16le') {
    const stream = fs.createReadStream(filePath, {
      highWaterMark: CHUNK_SIZE,
      encoding: encoding as BufferEncoding,
    })

    stream.on('data', (chunk: string | Buffer) => onChunk(String(chunk)))
    stream.on('end', onEnd)
    stream.on('error', onError)

    return () => {
      ;(stream as unknown as { destroy: () => void }).destroy()
    }
  }

  // Non-native encodings (e.g. GBK): use iconv-lite decode stream
  const decodeStream = iconv.decodeStream(encoding)
  const readStream = fs.createReadStream(filePath, {
    highWaterMark: CHUNK_SIZE,
  })

  readStream.pipe(decodeStream)

  decodeStream.on('data', (chunk: string) => onChunk(chunk))
  decodeStream.on('end', onEnd)
  decodeStream.on('error', onError)
  readStream.on('error', onError)

  return () => {
    ;(readStream as unknown as { destroy: () => void }).destroy()
    ;(decodeStream as unknown as { destroy: () => void }).destroy()
  }
}

export function shouldStreamRead(filePath: string): boolean {
  const stat = fs.statSync(filePath)
  return stat.size > LARGE_FILE_THRESHOLD
}

export { CHUNK_SIZE, LARGE_FILE_THRESHOLD }
