'use strict'

const { jsonRequest } = require('./aws-client')
const { CredentialProvider } = require('./credentials')
const { createLogger, mapAwsError } = require('./errors')
const { awsConfigItems } = require('./config-items')

const TARGET_PREFIX = 'CertificateManager'
const CONTENT_TYPE = 'application/x-amz-json-1.1'

const VALIDATION_METHODS = { DNS: 'DNS', Email: 'EMAIL' }

const CERTIFICATE_STATUSES = {
  'Pending Validation': 'PENDING_VALIDATION',
  Issued: 'ISSUED',
  Inactive: 'INACTIVE',
  Expired: 'EXPIRED',
  'Validation Timed Out': 'VALIDATION_TIMED_OUT',
  Revoked: 'REVOKED',
  Failed: 'FAILED',
}

const KEY_ALGORITHMS = {
  'RSA 2048': 'RSA_2048',
  'RSA 1024': 'RSA_1024',
  'RSA 3072': 'RSA_3072',
  'RSA 4096': 'RSA_4096',
  'ECDSA P-256 (EC_prime256v1)': 'EC_prime256v1',
  'ECDSA P-384 (EC_secp384r1)': 'EC_secp384r1',
  'ECDSA P-521 (EC_secp521r1)': 'EC_secp521r1',
}

/**
 * @integrationName AWS Certificate Manager
 * @integrationIcon /icon.svg
 */
class AwsAcm {
  constructor(config = {}) {
    this.region = config.region || 'us-east-1'
    this.logger = createLogger('AWS Certificate Manager')

    this.credentials = new CredentialProvider({
      authenticationMethod: config.authenticationMethod || 'API Key',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: this.region,
      roleArn: config.roleArn,
      externalId: config.externalId,
    })

    this.deps = { jsonRequest }
  }

  async sendJson(operation, body) {
    const creds = await this.credentials.resolve()

    return this.deps.jsonRequest(
      { region: this.region, service: 'acm', target: `${ TARGET_PREFIX }.${ operation }`, contentType: CONTENT_TYPE, body },
      creds
    )
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * @operationName List Certificates
   * @description Lists the ACM certificates in the configured AWS region, returning a summary for each (ARN, domain name, status, type, and key usage). Optionally filter by certificate status. Supports pagination via NextToken; the response includes a nextToken when more results are available.
   * @route GET /list-certificates
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"Array<String>","label":"Certificate Statuses","name":"certificateStatuses","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Pending Validation","Issued","Inactive","Expired","Validation Timed Out","Revoked","Failed"]}},"description":"Filter results to certificates in these statuses only. Leave empty to return certificates of any status."}
   * @paramDef {"type":"Number","label":"Max Items","name":"maxItems","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of certificates to return per page (1-1000)."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","required":false,"description":"Pagination token returned by a previous call. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"certificates":[{"CertificateArn":"arn:aws:acm:us-east-1:123456789012:certificate/abcd1234","DomainName":"www.example.com","Status":"ISSUED","Type":"AMAZON_ISSUED"}],"nextToken":null}
   */
  async listCertificates(certificateStatuses, maxItems, nextToken) {
    try {
      const body = {}

      if (Array.isArray(certificateStatuses) && certificateStatuses.length) {
        body.CertificateStatuses = certificateStatuses.map(status => this.#resolveChoice(status, CERTIFICATE_STATUSES))
      }

      if (maxItems) body.MaxItems = Number(maxItems)
      if (nextToken) body.NextToken = nextToken

      const res = await this.sendJson('ListCertificates', body)

      return {
        certificates: res.CertificateSummaryList || [],
        nextToken: res.NextToken || null,
      }
    } catch (error) {
      this.#handleError('listCertificates', error)
    }
  }

  /**
   * @operationName Describe Certificate
   * @description Returns detailed metadata for a single ACM certificate: its domain name and subject alternative names, status, type, issuer, serial number, validity dates, key algorithm, renewal eligibility, and the DomainValidationOptions (including the DNS CNAME records or validation emails needed to complete validation of a pending public certificate).
   * @route GET /describe-certificate
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Certificate ARN","name":"certificateArn","required":true,"dictionary":"getCertificatesDictionary","description":"The Amazon Resource Name (ARN) of the certificate to describe."}
   * @returns {Object}
   * @sampleResult {"certificate":{"CertificateArn":"arn:aws:acm:us-east-1:123456789012:certificate/abcd1234","DomainName":"www.example.com","Status":"PENDING_VALIDATION","Type":"AMAZON_ISSUED","KeyAlgorithm":"RSA-2048","DomainValidationOptions":[{"DomainName":"www.example.com","ValidationStatus":"PENDING_VALIDATION","ValidationMethod":"DNS","ResourceRecord":{"Name":"_abc.www.example.com.","Type":"CNAME","Value":"_xyz.acm-validations.aws."}}]}}
   */
  async describeCertificate(certificateArn) {
    if (!certificateArn) throw new Error('certificateArn is required.')

    try {
      const res = await this.sendJson('DescribeCertificate', { CertificateArn: certificateArn })

      return { certificate: res.Certificate || null }
    } catch (error) {
      this.#handleError('describeCertificate', error)
    }
  }

  /**
   * @operationName Request Certificate
   * @description Requests a new public ACM certificate for a domain. Specify the primary domain name (an asterisk creates a wildcard, e.g. *.example.com) and optionally additional subject alternative names. Choose DNS or Email validation. For DNS validation, after the request completes call Describe Certificate to retrieve the CNAME record you must add to your DNS zone; for Email validation, approval emails are sent to the domain contacts. The certificate is only issued once validation succeeds. Returns the ARN of the newly requested certificate.
   * @route POST /request-certificate
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Domain Name","name":"domainName","required":true,"description":"The fully qualified domain name to secure, e.g. www.example.com. Use *.example.com for a wildcard certificate. Maximum 253 characters."}
   * @paramDef {"type":"String","label":"Validation Method","name":"validationMethod","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["DNS","Email"]}},"description":"How to prove domain ownership for a public certificate. DNS (recommended) validates via a CNAME record; Email sends approval emails to domain contacts. Defaults to DNS."}
   * @paramDef {"type":"Array<String>","label":"Subject Alternative Names","name":"subjectAlternativeNames","required":false,"description":"Additional fully qualified domain names to include on the certificate (e.g. example.com, www.example.net). Up to 100 names (initial quota is 10)."}
   * @paramDef {"type":"String","label":"Key Algorithm","name":"keyAlgorithm","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["RSA 2048","RSA 1024","RSA 3072","RSA 4096","ECDSA P-256 (EC_prime256v1)","ECDSA P-384 (EC_secp384r1)","ECDSA P-521 (EC_secp521r1)"]}},"description":"The algorithm for the certificate's public/private key pair. Defaults to RSA 2048."}
   * @paramDef {"type":"Object","label":"Tags","name":"tags","required":false,"description":"Optional resource tags as a plain JSON object of key/value pairs (e.g. {\"Environment\":\"prod\",\"Team\":\"web\"})."}
   * @paramDef {"type":"String","label":"Idempotency Token","name":"idempotencyToken","required":false,"description":"Optional string (max 32 alphanumeric/underscore chars) to distinguish requests. Reusing the same token within one hour returns the same certificate instead of creating a new one."}
   * @returns {Object}
   * @sampleResult {"certificateArn":"arn:aws:acm:us-east-1:123456789012:certificate/abcd1234-5678-90ab-cdef-1234567890ab"}
   */
  async requestCertificate(domainName, validationMethod, subjectAlternativeNames, keyAlgorithm, tags, idempotencyToken) {
    if (!domainName) throw new Error('domainName is required.')

    try {
      const body = { DomainName: domainName }

      const method = this.#resolveChoice(validationMethod, VALIDATION_METHODS)

      if (method) body.ValidationMethod = method

      if (Array.isArray(subjectAlternativeNames) && subjectAlternativeNames.length) {
        body.SubjectAlternativeNames = subjectAlternativeNames
      }

      const algorithm = this.#resolveChoice(keyAlgorithm, KEY_ALGORITHMS)

      if (algorithm) body.KeyAlgorithm = algorithm

      const tagList = this.#toTagList(tags)

      if (tagList.length) body.Tags = tagList

      if (idempotencyToken) body.IdempotencyToken = idempotencyToken

      const res = await this.sendJson('RequestCertificate', body)

      return { certificateArn: res.CertificateArn }
    } catch (error) {
      this.#handleError('requestCertificate', error)
    }
  }

  /**
   * @operationName Delete Certificate
   * @description Permanently deletes an ACM certificate and its private key. A certificate cannot be deleted while it is still associated with an AWS resource (such as a load balancer or CloudFront distribution); detach it from all resources first. This action cannot be undone.
   * @route DELETE /delete-certificate
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Certificate ARN","name":"certificateArn","required":true,"dictionary":"getCertificatesDictionary","description":"The Amazon Resource Name (ARN) of the certificate to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"certificateArn":"arn:aws:acm:us-east-1:123456789012:certificate/abcd1234"}
   */
  async deleteCertificate(certificateArn) {
    if (!certificateArn) throw new Error('certificateArn is required.')

    try {
      await this.sendJson('DeleteCertificate', { CertificateArn: certificateArn })

      return { deleted: true, certificateArn }
    } catch (error) {
      this.#handleError('deleteCertificate', error)
    }
  }

  /**
   * @operationName Get Certificate
   * @description Retrieves an issued ACM certificate and its certificate chain in PEM format. The certificate must be in the ISSUED state; requesting a certificate that is still pending validation will fail. Use this to export the public certificate body and chain for installation on non-AWS servers or inspection.
   * @route GET /get-certificate
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Certificate ARN","name":"certificateArn","required":true,"dictionary":"getCertificatesDictionary","description":"The Amazon Resource Name (ARN) of an issued certificate."}
   * @returns {Object}
   * @sampleResult {"certificate":"-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----","certificateChain":"-----BEGIN CERTIFICATE-----\nMIIE...\n-----END CERTIFICATE-----"}
   */
  async getCertificate(certificateArn) {
    if (!certificateArn) throw new Error('certificateArn is required.')

    try {
      const res = await this.sendJson('GetCertificate', { CertificateArn: certificateArn })

      return { certificate: res.Certificate || null, certificateChain: res.CertificateChain || null }
    } catch (error) {
      this.#handleError('getCertificate', error)
    }
  }

  /**
   * @operationName Add Tags To Certificate
   * @description Adds one or more tags (key/value pairs) to an ACM certificate. Tags help you organize, search, and control access to certificates. Adding a tag with an existing key overwrites that tag's value.
   * @route POST /add-tags-to-certificate
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Certificate ARN","name":"certificateArn","required":true,"dictionary":"getCertificatesDictionary","description":"The Amazon Resource Name (ARN) of the certificate to tag."}
   * @paramDef {"type":"Object","label":"Tags","name":"tags","required":true,"description":"Tags to add, as a plain JSON object of key/value pairs (e.g. {\"Environment\":\"prod\",\"Owner\":\"web-team\"}). Keys cannot begin with aws:."}
   * @returns {Object}
   * @sampleResult {"tagged":true,"certificateArn":"arn:aws:acm:us-east-1:123456789012:certificate/abcd1234"}
   */
  async addTagsToCertificate(certificateArn, tags) {
    if (!certificateArn) throw new Error('certificateArn is required.')

    const tagList = this.#toTagList(tags)

    if (!tagList.length) throw new Error('tags must contain at least one key/value pair.')

    try {
      await this.sendJson('AddTagsToCertificate', { CertificateArn: certificateArn, Tags: tagList })

      return { tagged: true, certificateArn }
    } catch (error) {
      this.#handleError('addTagsToCertificate', error)
    }
  }

  /**
   * @operationName List Tags For Certificate
   * @description Lists all tags (key/value pairs) currently associated with an ACM certificate.
   * @route GET /list-tags-for-certificate
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Certificate ARN","name":"certificateArn","required":true,"dictionary":"getCertificatesDictionary","description":"The Amazon Resource Name (ARN) of the certificate whose tags you want to list."}
   * @returns {Object}
   * @sampleResult {"tags":[{"Key":"Environment","Value":"prod"},{"Key":"Owner","Value":"web-team"}]}
   */
  async listTagsForCertificate(certificateArn) {
    if (!certificateArn) throw new Error('certificateArn is required.')

    try {
      const res = await this.sendJson('ListTagsForCertificate', { CertificateArn: certificateArn })

      return { tags: res.Tags || [] }
    } catch (error) {
      this.#handleError('listTagsForCertificate', error)
    }
  }

  /**
   * @operationName Remove Tags From Certificate
   * @description Removes one or more tags from an ACM certificate. Provide the tag keys (and optionally values) to remove. If a value is supplied, the tag is only removed when both key and value match.
   * @route POST /remove-tags-from-certificate
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Certificate ARN","name":"certificateArn","required":true,"dictionary":"getCertificatesDictionary","description":"The Amazon Resource Name (ARN) of the certificate to remove tags from."}
   * @paramDef {"type":"Object","label":"Tags","name":"tags","required":true,"description":"Tags to remove, as a plain JSON object of key/value pairs (e.g. {\"Environment\":\"prod\"}). A tag is removed only when both key and value match; pass an empty string value to match any value for that key."}
   * @returns {Object}
   * @sampleResult {"untagged":true,"certificateArn":"arn:aws:acm:us-east-1:123456789012:certificate/abcd1234"}
   */
  async removeTagsFromCertificate(certificateArn, tags) {
    if (!certificateArn) throw new Error('certificateArn is required.')

    const tagList = this.#toTagList(tags, true)

    if (!tagList.length) throw new Error('tags must contain at least one key to remove.')

    try {
      await this.sendJson('RemoveTagsFromCertificate', { CertificateArn: certificateArn, Tags: tagList })

      return { untagged: true, certificateArn }
    } catch (error) {
      this.#handleError('removeTagsFromCertificate', error)
    }
  }

  /**
   * @operationName Resend Validation Email
   * @description Resends the domain validation email for a public certificate that is pending email validation. The certificate must have been requested with the Email validation method and still be in the PENDING_VALIDATION state. Specify the domain being validated and the base validation domain used to derive the recipient email addresses.
   * @route POST /resend-validation-email
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Certificate ARN","name":"certificateArn","required":true,"dictionary":"getCertificatesDictionary","description":"The Amazon Resource Name (ARN) of the pending certificate."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"description":"The fully qualified domain name being validated, exactly as it appears in the original request (e.g. www.example.com)."}
   * @paramDef {"type":"String","label":"Validation Domain","name":"validationDomain","required":true,"description":"The base validation domain used to construct the recipient addresses (e.g. example.com). ACM sends to admin@, administrator@, hostmaster@, postmaster@, and webmaster@ this domain, plus WHOIS contacts."}
   * @returns {Object}
   * @sampleResult {"resent":true,"certificateArn":"arn:aws:acm:us-east-1:123456789012:certificate/abcd1234","domain":"www.example.com"}
   */
  async resendValidationEmail(certificateArn, domain, validationDomain) {
    if (!certificateArn) throw new Error('certificateArn is required.')
    if (!domain) throw new Error('domain is required.')
    if (!validationDomain) throw new Error('validationDomain is required.')

    try {
      await this.sendJson('ResendValidationEmail', {
        CertificateArn: certificateArn,
        Domain: domain,
        ValidationDomain: validationDomain,
      })

      return { resent: true, certificateArn, domain }
    } catch (error) {
      this.#handleError('resendValidationEmail', error)
    }
  }

  /**
   * @operationName Renew Certificate
   * @description Renews an eligible private certificate issued by AWS Private CA that is managed via ACM. This applies only to certificates whose RenewalEligibility is ELIGIBLE. Public certificates are renewed automatically by ACM (managed renewal) and do not require this action.
   * @route POST /renew-certificate
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Certificate ARN","name":"certificateArn","required":true,"dictionary":"getCertificatesDictionary","description":"The Amazon Resource Name (ARN) of the certificate to renew."}
   * @returns {Object}
   * @sampleResult {"renewalRequested":true,"certificateArn":"arn:aws:acm:us-east-1:123456789012:certificate/abcd1234"}
   */
  async renewCertificate(certificateArn) {
    if (!certificateArn) throw new Error('certificateArn is required.')

    try {
      await this.sendJson('RenewCertificate', { CertificateArn: certificateArn })

      return { renewalRequested: true, certificateArn }
    } catch (error) {
      this.#handleError('renewCertificate', error)
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Certificates Dictionary
   * @description Provides a searchable list of ACM certificates (labeled by domain name, valued by ARN) for dynamic dropdown selection in other operations.
   * @route POST /get-certificates-dictionary
   * @paramDef {"type":"getCertificatesDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"www.example.com","value":"arn:aws:acm:us-east-1:123456789012:certificate/abcd1234","note":"ISSUED"}],"cursor":null}
   */
  async getCertificatesDictionary(payload) {
    const { search, cursor } = payload || {}

    try {
      const body = { MaxItems: 100 }

      if (cursor) body.NextToken = cursor

      const res = await this.sendJson('ListCertificates', body)
      let list = res.CertificateSummaryList || []

      if (search) {
        const lower = search.toLowerCase()

        list = list.filter(cert => (cert.DomainName || '').toLowerCase().includes(lower))
      }

      return {
        items: list.map(cert => ({
          label: cert.DomainName || cert.CertificateArn,
          value: cert.CertificateArn,
          note: cert.Status || undefined,
        })),
        cursor: res.NextToken || null,
      }
    } catch (error) {
      this.#handleError('getCertificatesDictionary', error)
    }
  }

  /**
   * Converts a plain JSON object of key/value pairs into the ACM Tag array form
   * [{ Key, Value }]. When forRemoval is true, an empty-string value is omitted so
   * the tag matches on key alone.
   * @param {Object} tags
   * @param {boolean} [forRemoval=false]
   * @returns {Array<Object>}
   */
  #toTagList(tags, forRemoval = false) {
    if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return []

    return Object.keys(tags).map(key => {
      const value = tags[key]

      if (forRemoval && (value === undefined || value === null || value === '')) {
        return { Key: key }
      }

      return { Key: key, Value: value == null ? '' : String(value) }
    })
  }

  #handleError(method, error) {
    this.logger.error(`[${ method }]`, error && error.message)

    if (error && error.name === 'ResourceNotFoundException') {
      throw new Error(`Certificate not found: ${ error.message }. Check the certificate ARN and region.`)
    }

    if (error && (error.name === 'InvalidArnException' || error.name === 'InvalidDomainValidationOptionsException')) {
      throw new Error(`Invalid ARN or domain validation options: ${ error.message }.`)
    }

    if (error && error.name === 'InvalidParameterException') {
      throw new Error(`Invalid request parameter: ${ error.message }.`)
    }

    if (error && error.name === 'RequestInProgressException') {
      throw new Error(`The certificate request is still in progress: ${ error.message }. Wait a few seconds and try again.`)
    }

    if (error && (error.name === 'InvalidStateException' || error.name === 'RequestFailedException')) {
      throw new Error(`Certificate is not in a valid state for this operation: ${ error.message }.`)
    }

    if (error && (error.name === 'TooManyTagsException' || error.name === 'InvalidTagException' || error.name === 'TagPolicyException')) {
      throw new Error(`Tag error: ${ error.message }.`)
    }

    if (error && error.name === 'LimitExceededException') {
      throw new Error(`An ACM quota has been exceeded: ${ error.message }.`)
    }

    throw mapAwsError(error)
  }
}

/**
 * @typedef {Object} getCertificatesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to certificate domain names."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call."}
 */

if (typeof Flowrunner !== 'undefined') {
  Flowrunner.ServerCode.addService(AwsAcm, awsConfigItems)
}

module.exports = { AwsAcm }
