'use strict'

const logger = {
  info: (...args) => console.log('[YouTube Service] info:', ...args),
  debug: (...args) => console.log('[YouTube Service] debug:', ...args),
  error: (...args) => console.log('[YouTube Service] error:', ...args),
  warn: (...args) => console.log('[YouTube Service] warn:', ...args),
}

module.exports = { logger }
