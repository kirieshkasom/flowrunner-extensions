const logger = {
  info: (...args) => console.log('[Revolut Business Service] info:', ...args),
  debug: (...args) => console.log('[Revolut Business Service] debug:', ...args),
  error: (...args) => console.log('[Revolut Business Service] error:', ...args),
  warn: (...args) => console.log('[Revolut Business Service] warn:', ...args),
}

module.exports = { logger }
