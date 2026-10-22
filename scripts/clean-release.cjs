const fs = require('node:fs')
const path = require('node:path')

// electron-builder writes release/win-unpacked.tmp while unpacking the Electron
// dist. If a previous run was interrupted, Windows may still hold handles on
// files inside that temp dir (IDE indexers, antivirus), and the next build dies
// with EBUSY on unlink. Clearing the output dir up front keeps builds repeatable.
const target = path.join(__dirname, '..', 'release')

try {
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  console.log(`[clean-release] removed ${target}`)
} catch (err) {
  // Not fatal: electron-builder recreates the directory it needs.
  console.warn(`[clean-release] could not fully remove ${target}: ${err.code || err.message}`)
}
