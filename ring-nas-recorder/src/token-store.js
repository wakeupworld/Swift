import path from 'node:path'
import { readFileIfExists, writeFileAtomic } from './fs-utils.js'
import { log } from './log.js'

// Ring refresh tokens are single-use: every auth returns a new one and the old
// one stops working, so the latest token must survive container restarts.
export class TokenStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'refresh-token')
  }

  async load(envToken) {
    const saved = (await readFileIfExists(this.file))?.trim()
    if (saved) {
      log.info(`Using refresh token persisted in ${this.file}`)
      return saved
    }
    if (envToken) {
      log.info('Using refresh token from RING_REFRESH_TOKEN (first run)')
      return envToken
    }
    return undefined
  }

  async save(token) {
    await writeFileAtomic(this.file, `${token}\n`, 0o600)
  }
}
