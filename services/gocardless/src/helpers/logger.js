'use strict'

const logger = {
  info: (...args) => console.log('[GoCardless Service] info:', ...args),
  debug: (...args) => console.log('[GoCardless Service] debug:', ...args),
  warn: (...args) => console.warn('[GoCardless Service] warn:', ...args),
  error: (...args) => console.error('[GoCardless Service] error:', ...args),
}

module.exports = { logger }
