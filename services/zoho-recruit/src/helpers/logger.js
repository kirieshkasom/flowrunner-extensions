'use strict'

const logger = {
  info: (...args) => console.log('[Zoho Recruit Service] info:', ...args),
  debug: (...args) => console.log('[Zoho Recruit Service] debug:', ...args),
  warn: (...args) => console.warn('[Zoho Recruit Service] warn:', ...args),
  error: (...args) => console.error('[Zoho Recruit Service] error:', ...args),
}

module.exports = { logger }
