# AGENTS.md

## Project shape

- Single npm package: Electron 44 main/preload + Vue 3 renderer + CodeMirror 6. No workspaces.
- `README.md` is the detailed product/architecture reference; read its “架构” and “已知限制” sections before changing editor behavior.
- Source entrypoints: `electron/main/index.ts`, `electron/preload/index.ts`, `src/main.ts`; renderer root is `src/`.

## Commands

- `npm run dev` — Electron + renderer HMR.
- `npm run check` — required gate, in order: ESLint → Prettier check → three typechecks → Vitest. Run it before proposing a commit.
- `npx vitest run src/editor/textMap.test.ts` — run one test file. Vitest uses jsdom and only picks up `src/**/*.test.ts`, `shared/**/*.test.ts`, `electron/**/*.test.ts`; tests sit next to the code.
- `npm run build` / `npx electron-vite build` — output `out/`; rebuild after main/preload changes and before packaging.
- `npx electron-vite dev --rendererOnly` — starts the renderer dev server (and Electron using the previous main/preload build). Its Vite URL is usable in a browser through `src/lib/mockApi.ts`; rebuild main/preload first if they changed.
- `npm run dist:win`, `npm run dist:mac`, `npm run dist:linux` — package on the matching OS only; CI builds all platforms on `v*` tags.
- Prettier ignores `*.md`, `docs/`, `package-lock.json`, and `scripts/clean-release.cjs`; `npm run format` will not touch README/AGENTS.
- If the Electron binary download fails, follow README’s `ELECTRON_MIRROR` + `node node_modules/electron/install.js` instructions.

## Boundaries and invariants

- Renderer is sandboxed: contextIsolation + sandbox on, nodeIntegration off, CSP in `src/index.html`. Do not import Node/Electron into `src/`; use the preload `window.api` whitelist.
- Adding a `window.api` method requires all four: `shared/types.ts` (`IPC` + `Api`), `electron/preload/index.ts`, `electron/main/ipc.ts`, and `src/lib/mockApi.ts`. The mock is what keeps browser preview working.
- `shared/keymap.ts` is the only shortcut table; native menu, window handler and CodeMirror commands all resolve it. Don’t add a second shortcut list.
- `src/editor/statePool.ts` owns per-tab `EditorState`/undo/scroll. Tab switches swap states; live text may live there, not in the Pinia tab. Use `documents.textOf` / `peekStateText` for saves and statistics.
- User-facing strings live in `shared/i18n.ts`; `zhCN` is the source of truth and `en` must keep the same shape. Use `t`/`tf`, and add both languages.
- All app styling is in `src/themes/index.css` using CSS variables; keep new UI on those variables. Reusable right-click menus are `src/lib/contextMenu.ts` + `src/components/ContextMenu.vue`; don’t add local `.ctx-menu` copies.
- Icons are split: runtime/packaging use `resources/icon.png`/`icon.ico`; the in-app titlebar/welcome logo is `src/assets/icon.png`; README uses `docs/logo.png`. Window-control assets: `normal.png` = maximize (single square), `max.png` = restore (two squares).

## Live render / editor gotchas

- `src/editor/extensions/liveRender.ts` is the core. Block widgets must come from `EditorView.decorations` (not a ViewPlugin); `segmenter.ts`, `textMap.ts`, and `sourceStyle.ts` are part of the same pipeline. Changes need focused tests.
- Rendered blocks are `contenteditable=false`. Never switch a block to source on mousedown: that changes line height and makes drag selection land on another line. Drags are painted with CSS Custom Highlight and mapped to source on mouseup (see `liveRender.ts`).
- Tables stay rendered even while active; table-cell selections are captured in `cellSelection.ts`, and column widths are display-only (`tableLayout.ts`), never written into Markdown.
- Context-menu formatting must use `toggleMarker` (it checks the rendered cell selection first), not raw `toggleWrapCommand`; otherwise table-cell selections are ignored.
- Electron 44 clipboard is W3C-style: there is no `clipboard.writeImage`/`readImage`. Use `nativeImage` plus `clipboard.write([new ClipboardItem({ 'image/png': new Blob(...) })])`; prefer `webContents.paste()` for native paste.

## Verification and git

- Browser preview can exercise layout and renderer logic, but native menus, dialogs, clipboard, window controls, and packaging need real Electron.
- Do not push or configure remotes; the user uploads to GitHub. Do not commit unless explicitly asked.
- Packaging is OS-specific; signing/notarization and update-feed variables are documented in `README.md` and `electron-builder.yml`. `out/` and `release*/` are generated and gitignored.
