function stamp() {
  return new Date().toISOString()
}

export const log = {
  debugEnabled: false,
  info: (...args) => console.log(stamp(), 'INFO ', ...args),
  warn: (...args) => console.warn(stamp(), 'WARN ', ...args),
  error: (...args) => console.error(stamp(), 'ERROR', ...args),
  debug: (...args) => {
    if (log.debugEnabled) console.log(stamp(), 'DEBUG', ...args)
  },
}
