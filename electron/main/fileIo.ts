/**
 * Reading and writing of text files. The encoding of a file is detected
 * when it is read and kept when it is written again, so a GBK document
 * stays a GBK document.
 */
import fs from 'node:fs'
import path from 'node:path'
import { decodeBuffer, detectFileEncoding, encodeText, type TextEncoding } from './encoding'

export interface TextFile {
  content: string
  encoding: TextEncoding
  size: number
  mtimeMs: number
}

/** Reads a text file and detects its encoding. */
export function readTextFile(abs: string): TextFile | null {
  try {
    const st = fs.statSync(abs)
    if (!st.isFile()) return null
    const decoded = decodeBuffer(fs.readFileSync(abs))
    return {
      content: decoded.text,
      encoding: decoded.encoding,
      size: st.size,
      mtimeMs: st.mtimeMs
    }
  } catch {
    return null
  }
}

/** The encoding of an existing file (UTF-8 for a new file). */
export function existingEncoding(abs: string): TextEncoding {
  try {
    return detectFileEncoding(fs.readFileSync(abs))
  } catch {
    return 'utf-8'
  }
}

/** Writes a file atomically (tmp file + rename) with its original encoding. */
export function writeTextFileAtomic(abs: string, content: string): void {
  const dir = path.dirname(abs)
  const tmp = path.join(
    dir,
    `.${path.basename(abs)}.mde-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  )
  fs.writeFileSync(tmp, encodeText(content, existingEncoding(abs)))
  fs.renameSync(tmp, abs)
}
