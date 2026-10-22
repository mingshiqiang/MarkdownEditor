/**
 * Tiny module-level buses that let editor (CodeMirror) modules call into the
 * Vue app without importing Pinia stores (avoids circular imports and keeps
 * editor code testable).
 */

/* ---------------------------------- toast --------------------------------- */

type ToastFn = (message: string) => void
let toastFn: ToastFn | null = null

export function setToastFn(fn: ToastFn): void {
  toastFn = fn
}

export function toast(message: string): void {
  toastFn?.(message)
}

/* -------------------------------- open docs -------------------------------- */

type OpenDocFn = (absPath: string) => void
let openDocFn: OpenDocFn | null = null

export function setOpenDocFn(fn: OpenDocFn): void {
  openDocFn = fn
}

/** Ask the app to open a markdown file (e.g. relative links in rendered md). */
export function requestOpenDoc(absPath: string): void {
  openDocFn?.(absPath)
}
