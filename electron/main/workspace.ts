/**
 * Workspace file tree & search (M3 / F-06 / F-09).
 *
 * Runs in the main process: directory scanning, entry creation/rename/delete
 * (delete goes to the system trash), moving entries and content search.
 */
import { shell } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FileTreeNode, SearchMatch, SearchMode } from '../../shared/types'

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.idea',
  '.vscode',
  '.obsidian',
  'dist',
  'build',
  'out',
  'release',
  'coverage',
  '.cache',
  '__pycache__'
])

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico)$/i
const MARKDOWN_EXT = /\.(md|markdown|mkd|mdx|txt)$/i

const MAX_DEPTH = 8
const MAX_ENTRIES = 4000
const MAX_SEARCH_FILES = 1500
const MAX_SEARCH_RESULTS = 300
const MAX_FILE_SIZE = 4 * 1024 * 1024

export function isMarkdownFile(name: string): boolean {
  return MARKDOWN_EXT.test(name)
}

export function isImageFile(name: string): boolean {
  return IMAGE_EXT.test(name)
}

function isIgnored(name: string): boolean {
  if (name.startsWith('.')) return true
  return IGNORED_DIRS.has(name)
}

/** Build the file tree of a directory (depth & count limited). */
export async function buildTree(dir: string, depth = 0): Promise<FileTreeNode[]> {
  if (depth > MAX_DEPTH) return []
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const nodes: FileTreeNode[] = []
  for (const entry of entries) {
    if (isIgnored(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: full,
        type: 'directory',
        children: await buildTree(full, depth + 1)
      })
    } else if (entry.isFile()) {
      let size: number | undefined
      let mtimeMs: number | undefined
      try {
        const st = await fsp.stat(full)
        size = st.size
        mtimeMs = st.mtimeMs
      } catch {
        /* ignore */
      }
      nodes.push({
        name: entry.name,
        path: full,
        type: 'file',
        size,
        mtimeMs,
        markdown: isMarkdownFile(entry.name),
        image: isImageFile(entry.name)
      })
    }
    if (nodes.length >= MAX_ENTRIES) break
  }
  // Directories first, then files, each alphabetically.
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
  return nodes
}

/** Create a file or directory below `parent`. */
export async function createEntry(
  parent: string,
  name: string,
  type: 'file' | 'directory'
): Promise<boolean> {
  try {
    const safe = sanitizeName(name)
    if (!safe) return false
    const target = path.join(parent, safe)
    if (fs.existsSync(target)) return false
    if (type === 'directory') {
      await fsp.mkdir(target, { recursive: true })
    } else {
      await fsp.writeFile(target, '', 'utf-8')
    }
    return true
  } catch {
    return false
  }
}

/** Rename a file or directory. */
export async function renameEntry(target: string, newName: string): Promise<boolean> {
  try {
    const safe = sanitizeName(newName)
    if (!safe) return false
    const parent = path.dirname(target)
    const next = path.join(parent, safe)
    if (next === target) return true
    if (fs.existsSync(next)) return false
    await fsp.rename(target, next)
    return true
  } catch {
    return false
  }
}

/** Move an entry into another directory. */
export async function moveEntry(from: string, toDir: string): Promise<boolean> {
  try {
    if (from === toDir) return false
    const parent = path.dirname(from)
    if (parent === toDir) return false
    const target = path.join(toDir, path.basename(from))
    if (fs.existsSync(target)) return false
    await fsp.rename(from, target)
    return true
  } catch {
    // Cross-device moves need a copy + delete.
    try {
      await fsp.cp(from, path.join(toDir, path.basename(from)), { recursive: true })
      await fsp.rm(from, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  }
}

/** Delete an entry (system trash, so it can be recovered). */
export async function deleteEntry(target: string): Promise<boolean> {
  try {
    await shell.trashItem(target)
    return true
  } catch {
    try {
      await fsp.rm(target, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  }
}

function sanitizeName(name: string): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return ''
  if (/[\\/:*?"<>|]/.test(trimmed)) return ''
  if (trimmed === '.' || trimmed === '..') return ''
  return trimmed
}

/* --------------------------------- search --------------------------------- */

async function collectFiles(root: string, limit: number): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (out.length >= limit || depth > MAX_DEPTH) return
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= limit) return
      if (isIgnored(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full, depth + 1)
      else if (entry.isFile() && isMarkdownFile(entry.name)) out.push(full)
    }
  }
  await walk(root, 0)
  return out
}

/** Search the workspace by file name or by content. */
export async function searchWorkspace(
  root: string,
  query: string,
  mode: SearchMode
): Promise<SearchMatch[]> {
  const q = query.trim()
  if (!q) return []
  const lower = q.toLowerCase()

  if (mode === 'name') {
    const files = await collectFiles(root, MAX_SEARCH_FILES)
    const matches: SearchMatch[] = []
    for (const file of files) {
      if (path.basename(file).toLowerCase().includes(lower)) {
        matches.push({
          path: file,
          name: path.basename(file),
          line: 0,
          column: 0,
          preview: path.relative(root, file)
        })
      }
      if (matches.length >= MAX_SEARCH_RESULTS) break
    }
    return matches
  }

  const files = await collectFiles(root, MAX_SEARCH_FILES)
  const matches: SearchMatch[] = []
  for (const file of files) {
    let stat: fs.Stats
    try {
      stat = await fsp.stat(file)
    } catch {
      continue
    }
    if (stat.size > MAX_FILE_SIZE) continue
    let content: string
    try {
      content = await fsp.readFile(file, 'utf-8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const idx = line.toLowerCase().indexOf(lower)
      if (idx >= 0) {
        matches.push({
          path: file,
          name: path.basename(file),
          line: i + 1,
          column: idx + 1,
          preview: line.trim().slice(0, 200)
        })
        if (matches.length >= MAX_SEARCH_RESULTS) return matches
      }
    }
  }
  return matches
}
