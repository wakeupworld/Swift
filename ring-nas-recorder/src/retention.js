import fs from 'node:fs/promises'
import path from 'node:path'
import { log } from './log.js'

async function prune(dir, cutoff) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return 0
    throw err
  }
  let removed = 0
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      removed += await prune(full, cutoff)
      const left = await fs.readdir(full).catch(() => ['?'])
      if (left.length === 0) await fs.rmdir(full).catch(() => {})
    } else if (entry.isFile() && /\.(mp4|jpg)$/i.test(entry.name)) {
      const { mtimeMs } = await fs.stat(full)
      if (mtimeMs < cutoff) {
        await fs.rm(full, { force: true })
        removed++
      }
    }
  }
  return removed
}

export async function applyRetention(recordingsDir, days) {
  if (days <= 0) return
  const removed = await prune(recordingsDir, Date.now() - days * 86400000)
  if (removed) log.info(`Retention: deleted ${removed} file(s) older than ${days} day(s)`)
}
