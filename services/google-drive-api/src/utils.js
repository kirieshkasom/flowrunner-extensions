const { inspect } = require('node:util')

const logger = {
  info: (...args) => console.log('[Google Drive Service] info:', ...args),
  debug: (...args) => console.log('[Google Drive Service] debug:', ...args),
  error: (...args) => console.log('[Google Drive Service] error:', ...args),
  warn: (...args) => console.log('[Google Drive Service] warn:', ...args),
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function logMessage(title, args) {
  const message = Object.entries(args).reduce((acc, [key, value]) => {
    return acc + `${ key } = ${ inspect(value) }(typeof: ${ typeof value }); `
  }, `${ title }: `)

  logger.debug(message)
}

function getFilenameFromUrl(url) {
  if (!url) {
    return null
  }

  return url.split('/').pop().split('?')[0]
}

module.exports = {
  assert,
  logMessage,
  getFilenameFromUrl,
}
