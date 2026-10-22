/**
 * Text encoding detection (files are not always UTF-8).
 *
 * The encoding of a file is detected when it is read and kept when it is
 * written again, so a GBK document stays a GBK document.
 */
import { TextDecoder } from 'node:util'
import iconv from 'iconv-lite'

/** The encodings the app can read and write. */
export const ENCODINGS = [
  'utf-8',
  'utf-8-bom',
  'utf-16le',
  'utf-16be',
  'gb18030',
  'windows-1252'
] as const

export type TextEncoding = (typeof ENCODINGS)[number]

export interface DecodedText {
  text: string
  encoding: TextEncoding
}

const UTF8_BOM = [0xef, 0xbb, 0xbf]

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false
  return bytes.every((b, i) => buffer[i] === b)
}

/** Decodes a buffer and reports the encoding it was decoded with. */
export function decodeBuffer(buffer: Buffer): DecodedText {
  if (startsWith(buffer, UTF8_BOM)) {
    return {
      text: new TextDecoder('utf-8').decode(buffer.subarray(3)),
      encoding: 'utf-8-bom'
    }
  }
  if (startsWith(buffer, [0xff, 0xfe])) {
    return {
      text: new TextDecoder('utf-16le').decode(buffer.subarray(2)),
      encoding: 'utf-16le'
    }
  }
  if (startsWith(buffer, [0xfe, 0xff])) {
    return {
      text: new TextDecoder('utf-16be').decode(buffer.subarray(2)),
      encoding: 'utf-16be'
    }
  }
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(buffer),
      encoding: 'utf-8'
    }
  } catch {
    /* not valid UTF-8 */
  }
  try {
    // GB18030 is a superset of GBK and GB2312.
    return {
      text: new TextDecoder('gb18030', { fatal: true }).decode(buffer),
      encoding: 'gb18030'
    }
  } catch {
    /* not a Chinese legacy encoding either */
  }
  // Windows-1252 decodes every byte, it is the last resort.
  return {
    text: new TextDecoder('windows-1252').decode(buffer),
    encoding: 'windows-1252'
  }
}

/** Encodes text with the given encoding (the BOM is part of it). */
export function encodeText(text: string, encoding: TextEncoding): Buffer {
  if (encoding === 'utf-8-bom') {
    return Buffer.concat([Buffer.from(UTF8_BOM), Buffer.from(text, 'utf-8')])
  }
  if (encoding === 'utf-16le') {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
  }
  if (encoding === 'utf-16be') {
    return Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()])
  }
  if (encoding === 'gb18030') {
    // Node's Buffer only knows the legacy encodings with a full ICU, so the
    // conversion is done with iconv-lite.
    return iconv.encode(text, 'gb18030')
  }
  if (encoding === 'windows-1252') {
    return iconv.encode(text, 'windows-1252')
  }
  return Buffer.from(text, 'utf-8')
}

/** The encoding of an existing file (UTF-8 for a new file). */
export function detectFileEncoding(buffer: Buffer): TextEncoding {
  return decodeBuffer(buffer).encoding
}
