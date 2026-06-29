'use strict'

const { stsAssumeRole: defaultStsAssumeRole } = require('./aws-client')

const EXPIRY_BUFFER_MS = 300000 // 5 minutes

class CredentialProvider {
  constructor(config = {}, deps = {}) {
    this.authenticationMethod = config.authenticationMethod || 'API Key'
    this.accessKeyId = config.accessKeyId
    this.secretAccessKey = config.secretAccessKey
    this.region = config.region || 'us-east-1'
    this.roleArn = config.roleArn
    this.externalId = config.externalId

    this._stsAssumeRole = deps.stsAssumeRole || defaultStsAssumeRole
    this._now = deps.now || (() => Date.now())

    this._cached = null
    this._cachedExpiryMs = null
  }

  async resolve() {
    if (this.authenticationMethod === 'IAM Role') {
      return this._resolveRole()
    }

    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error('Access Key and Secret Key are required for API Key authentication.')
    }

    return { accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey }
  }

  async _resolveRole() {
    if (this._cached && this._cachedExpiryMs && this._now() < this._cachedExpiryMs - EXPIRY_BUFFER_MS) {
      return this._cached
    }

    if (!this.roleArn) {
      throw new Error('IAM Role ARN is required for IAM Role authentication.')
    }

    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error('Access Key and Secret Key are required to assume an IAM Role.')
    }

    const result = await this._stsAssumeRole(
      { accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey },
      this.region,
      this.roleArn,
      `flowrunner-sns-${ this._now() }`,
      this.externalId
    )

    this._cached = { accessKeyId: result.accessKeyId, secretAccessKey: result.secretAccessKey, sessionToken: result.sessionToken }
    this._cachedExpiryMs = new Date(result.expiration).getTime()

    return this._cached
  }
}

module.exports = { CredentialProvider }
