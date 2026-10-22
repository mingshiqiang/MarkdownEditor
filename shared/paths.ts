/**
 * Pure-string path helpers usable in the sandboxed renderer (no node:path).
 * All inputs/outputs use forward slashes.
 */

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

/** True for Windows drive letters, UNC paths and POSIX absolute paths. */
export function isAbsPath(p: string): boolean {
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true
  if (p.startsWith('\\\\') || p.startsWith('//')) return true
  return p.startsWith('/')
}

/** Join a directory (posix) with a relative path, collapsing `.` segments. */
export function joinPath(dir: string, rel: string): string {
  const base = toPosix(dir).replace(/\/+$/, '')
  const tail = toPosix(rel).replace(/^\.?\//, '')
  if (!base) return tail
  return `${base}/${tail}`
}

/** Build the custom-scheme URI that serves a local image file. */
export function toImageUri(absPath: string): string {
  const posix = toPosix(absPath)
  return `mdimg://local/${encodeURIComponent(posix)}`
}

/**
 * Normalize a markdown destination that points at a local file.
 *
 * markdown-it percent-encodes backslashes in link/image destinations
 * (`D:\dir\img.png` -> `D:%5Cdir%5Cimg.png`), which would make the path
 * unrecognizable as an absolute Windows path. Undo that and use forward
 * slashes, so the path can be resolved against the document folder.
 */
export function normalizeLocalPath(src: string): string {
  if (!src) return src
  let s = src.replace(/%5C/gi, '\\')
  if (/^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\')) {
    s = s.replace(/\\/g, '/')
  }
  return s
}
