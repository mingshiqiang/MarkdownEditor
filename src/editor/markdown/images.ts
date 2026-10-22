/**
 * Image helpers for rendered markdown: mark images that fail to load so the
 * user sees a readable placeholder instead of a broken-image icon.
 */
export function attachImageHandlers(root: HTMLElement): void {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    img.addEventListener('error', () => {
      img.classList.add('md-img-broken')
      img.setAttribute('data-broken-src', img.getAttribute('src') ?? '')
      if (import.meta.env?.DEV) {
        console.warn('[mde] image FAILED', img.getAttribute('src'))
      }
    })
    if (import.meta.env?.DEV) {
      img.addEventListener('load', () => {
        console.info(
          '[mde] image loaded',
          img.naturalWidth + 'x' + img.naturalHeight,
          img.getAttribute('src')
        )
      })
    }
  }
}
