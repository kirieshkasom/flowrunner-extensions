'use strict'

const logger = {
  info: (...args) => console.log('[Google Docs Service] info:', ...args),
  debug: (...args) => console.log('[Google Docs Service] debug:', ...args),
  error: (...args) => console.log('[Google Docs Service] error:', ...args),
  warn: (...args) => console.log('[Google Docs Service] warn:', ...args),
}

module.exports = { logger }
