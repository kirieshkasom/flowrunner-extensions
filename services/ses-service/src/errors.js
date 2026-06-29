'use strict'

function createLogger(serviceName) {
  const prefix = `[${ serviceName } Service]`

  return {
    info: (...args) => console.log(prefix, 'info:', ...args),
    debug: (...args) => console.log(prefix, 'debug:', ...args),
    warn: (...args) => console.log(prefix, 'warn:', ...args),
    error: (...args) => console.log(prefix, 'error:', ...args),
  }
}

function mapAwsError(error) {
  const name = error.name || ''
  const message = error.message || 'Unknown error'

  if (name === 'ThrottlingException' || name === 'Throttling' || name === 'ProvisionedThroughputExceededException') {
    return new Error(`Request was throttled by AWS: ${ message }. Retry with backoff or increase capacity.`)
  }

  if (name === 'InvalidSignatureException' || name === 'UnrecognizedClientException' || name === 'InvalidClientTokenId' || /credential/i.test(message)) {
    return new Error(`Invalid AWS credentials: ${ message }. Check your access key, secret key, and (for IAM Role) the Role ARN.`)
  }

  if (name === 'AccessDeniedException' || name === 'AccessDenied') {
    return new Error(`Access denied: ${ message }. Verify the IAM permissions for this operation.`)
  }

  if (
    /timed out/i.test(message) ||
    error.code === 'ECONNREFUSED' ||
    error.code === 'ENOTFOUND' ||
    error.code === 'ETIMEDOUT'
  ) {
    return new Error(`Connection to AWS failed: ${ message }. Check the region and network connectivity.`)
  }

  return new Error(message, { cause: error })
}

module.exports = { createLogger, mapAwsError }
