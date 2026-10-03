import fs from 'node:fs/promises'
import path from 'node:path'

export async function writeFileAtomic(file, contents, mode) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, contents, mode ? { mode } : undefined)
  await fs.rename(tmp, file)
}

export async function readFileIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return undefined
    throw err
  }
}

const UNSAFE = /[<>:"/\\|?*\x00-\x1f]/g

export function safeName(name) {
  const cleaned = String(name).replace(UNSAFE, '_').replace(/\s+/g, ' ').trim()
  return cleaned.replace(/^\.+/, '_') || 'unnamed'
}

function pad(n) {
  return String(n).padStart(2, '0')
}

// Uses the container's local time (set TZ) so folders match the user's calendar day.
export function clipPath(root, cameraName, date, kind) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  return path.join(root, safeName(cameraName), day, `${day}_${time}_${safeName(kind)}.mp4`)
}
