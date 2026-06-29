'use strict'

const { restJsonRequest } = require('./aws-client')
const { CredentialProvider } = require('./credentials')
const { createLogger, mapAwsError } = require('./errors')
const { awsConfigItems } = require('./config-items')

/**
 * @integrationName Amazon SES
 * @integrationIcon /icon.png
 */
class SES {
  constructor(config = {}) {
    this.region = config.region || 'us-east-1'
    this.logger = createLogger('SES')

    this.credentials = new CredentialProvider({
      authenticationMethod: config.authenticationMethod || 'API Key',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: this.region,
      roleArn: config.roleArn,
      externalId: config.externalId,
    })

    this.deps = { restJsonRequest }
  }

  async sendRest(method, path, body) {
    const creds = await this.credentials.resolve()

    return this.deps.restJsonRequest({ region: this.region, service: 'ses', method, path, body }, creds)
  }

  /**
   * @operationName Send Email
   * @description Sends a plain text or HTML email to one or more recipients via a verified sender address. Supports optional CC, BCC, and reply-to addresses.
   * @route POST /send-email
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"From Address","name":"fromEmailAddress","required":true,"description":"The verified sender email address."}
   * @paramDef {"type":"Array","label":"To Addresses","name":"toAddresses","required":true,"description":"List of recipient email addresses."}
   * @paramDef {"type":"Array","label":"CC Addresses","name":"ccAddresses","required":false,"description":"Optional list of CC recipient email addresses."}
   * @paramDef {"type":"Array","label":"BCC Addresses","name":"bccAddresses","required":false,"description":"Optional list of BCC recipient email addresses."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The subject line of the email."}
   * @paramDef {"type":"String","label":"Text Body","name":"textBody","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain text body of the email. At least one of Text Body or HTML Body is required."}
   * @paramDef {"type":"String","label":"HTML Body","name":"htmlBody","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"HTML body of the email. At least one of Text Body or HTML Body is required."}
   * @paramDef {"type":"Array","label":"Reply-To Addresses","name":"replyToAddresses","required":false,"description":"Optional list of reply-to email addresses."}
   * @returns {Object}
   * @sampleResult {"messageId":"0100018f-abcd-1234-5678-000000000001"}
   */
  async sendEmail(fromEmailAddress, toAddresses, ccAddresses, bccAddresses, subject, textBody, htmlBody, replyToAddresses) {
    if (!fromEmailAddress) throw new Error('fromEmailAddress is required.')
    if (!toAddresses || !Array.isArray(toAddresses) || toAddresses.length === 0) throw new Error('toAddresses must be a non-empty array.')
    if (!subject) throw new Error('subject is required.')
    if (!textBody && !htmlBody) throw new Error('At least one of textBody or htmlBody is required.')

    try {
      const destination = { ToAddresses: toAddresses }

      if (ccAddresses) destination.CcAddresses = ccAddresses
      if (bccAddresses) destination.BccAddresses = bccAddresses

      const bodyContent = {}

      if (textBody) bodyContent.Text = { Data: textBody }
      if (htmlBody) bodyContent.Html = { Data: htmlBody }

      const body = {
        FromEmailAddress: fromEmailAddress,
        Destination: destination,
        Content: {
          Simple: {
            Subject: { Data: subject },
            Body: bodyContent,
          },
        },
      }

      if (replyToAddresses) body.ReplyToAddresses = replyToAddresses

      const res = await this.sendRest('POST', '/v2/email/outbound-emails', body)

      return { messageId: res.MessageId }
    } catch (error) {
      this.#handleError('sendEmail', error)
    }
  }

  /**
   * @operationName Send Templated Email
   * @description Sends an email using a pre-created email template, with optional template data for variable substitution.
   * @route POST /send-templated-email
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"From Address","name":"fromEmailAddress","required":true,"description":"The verified sender email address."}
   * @paramDef {"type":"Array","label":"To Addresses","name":"toAddresses","required":true,"description":"List of recipient email addresses."}
   * @paramDef {"type":"Array","label":"CC Addresses","name":"ccAddresses","required":false,"description":"Optional list of CC recipient email addresses."}
   * @paramDef {"type":"Array","label":"BCC Addresses","name":"bccAddresses","required":false,"description":"Optional list of BCC recipient email addresses."}
   * @paramDef {"type":"String","label":"Template Name","name":"templateName","required":true,"dictionary":"listTemplatesDictionary","description":"The name of the email template to use."}
   * @paramDef {"type":"Object","label":"Template Data","name":"templateData","required":false,"description":"Key-value pairs for template variable substitution, as plain JSON (e.g. {\"name\":\"Alice\"})."}
   * @paramDef {"type":"Array","label":"Reply-To Addresses","name":"replyToAddresses","required":false,"description":"Optional list of reply-to email addresses."}
   * @returns {Object}
   * @sampleResult {"messageId":"0100018f-abcd-1234-5678-000000000002"}
   */
  async sendTemplatedEmail(fromEmailAddress, toAddresses, ccAddresses, bccAddresses, templateName, templateData, replyToAddresses) {
    if (!fromEmailAddress) throw new Error('fromEmailAddress is required.')
    if (!toAddresses || !Array.isArray(toAddresses) || toAddresses.length === 0) throw new Error('toAddresses must be a non-empty array.')
    if (!templateName) throw new Error('templateName is required.')

    try {
      const destination = { ToAddresses: toAddresses }

      if (ccAddresses) destination.CcAddresses = ccAddresses
      if (bccAddresses) destination.BccAddresses = bccAddresses

      const body = {
        FromEmailAddress: fromEmailAddress,
        Destination: destination,
        Content: {
          Template: {
            TemplateName: templateName,
            TemplateData: JSON.stringify(templateData || {}),
          },
        },
      }

      if (replyToAddresses) body.ReplyToAddresses = replyToAddresses

      const res = await this.sendRest('POST', '/v2/email/outbound-emails', body)

      return { messageId: res.MessageId }
    } catch (error) {
      this.#handleError('sendTemplatedEmail', error)
    }
  }

  /**
   * @operationName Send Bulk Templated Email
   * @description Sends a templated email to multiple recipients in a single batch operation, with optional per-recipient variable substitution.
   * @route POST /send-bulk-templated-email
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"From Address","name":"fromEmailAddress","required":true,"description":"The verified sender email address."}
   * @paramDef {"type":"String","label":"Template Name","name":"templateName","required":true,"dictionary":"listTemplatesDictionary","description":"The name of the email template to use for all recipients."}
   * @paramDef {"type":"Object","label":"Default Template Data","name":"defaultTemplateData","required":false,"description":"Default key-value pairs for template variable substitution applied to all entries unless overridden."}
   * @paramDef {"type":"Array","label":"Entries","name":"entries","required":true,"description":"Array of recipient entries. Each entry must have toAddresses (array) and may have replacementData (object) to override default template variables."}
   * @returns {Object}
   * @sampleResult {"results":[{"messageId":"0100018f-0001","status":"SUCCESS","error":null},{"messageId":"0100018f-0002","status":"FAILED","error":"MessageRejected"}]}
   */
  async sendBulkTemplatedEmail(fromEmailAddress, templateName, defaultTemplateData, entries) {
    if (!fromEmailAddress) throw new Error('fromEmailAddress is required.')
    if (!templateName) throw new Error('templateName is required.')
    if (!Array.isArray(entries) || entries.length === 0) throw new Error('entries must be a non-empty array.')

    try {
      const body = {
        FromEmailAddress: fromEmailAddress,
        DefaultContent: {
          Template: {
            TemplateName: templateName,
            TemplateData: JSON.stringify(defaultTemplateData || {}),
          },
        },
        BulkEmailEntries: entries.map(e => ({
          Destination: { ToAddresses: e.toAddresses },
          ReplacementEmailContent: {
            ReplacementTemplate: {
              ReplacementTemplateData: JSON.stringify(e.replacementData || {}),
            },
          },
        })),
      }

      const res = await this.sendRest('POST', '/v2/email/outbound-bulk-emails', body)

      return {
        results: (res.BulkEmailEntries || []).map(r => ({ messageId: r.MessageId, status: r.Status, error: r.Error })),
      }
    } catch (error) {
      this.#handleError('sendBulkTemplatedEmail', error)
    }
  }

  /**
   * @operationName Create Email Template
   * @description Creates a reusable email template with a name, subject, and optional text and HTML body parts. Templates support Handlebars-style variable substitution.
   * @route POST /create-email-template
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Template Name","name":"templateName","required":true,"description":"Unique name for the template. Must be unique within your account."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Subject line template, supporting variable substitution (e.g. Hello {{name}})."}
   * @paramDef {"type":"String","label":"Text Part","name":"textPart","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain text body of the template, supporting variable substitution."}
   * @paramDef {"type":"String","label":"HTML Part","name":"htmlPart","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"HTML body of the template, supporting variable substitution."}
   * @returns {Object}
   * @sampleResult {"templateName":"WelcomeTemplate"}
   */
  async createEmailTemplate(templateName, subject, textPart, htmlPart) {
    if (!templateName) throw new Error('templateName is required.')
    if (!subject) throw new Error('subject is required.')

    try {
      const templateContent = { Subject: subject }

      if (textPart) templateContent.Text = textPart
      if (htmlPart) templateContent.Html = htmlPart

      const body = { TemplateName: templateName, TemplateContent: templateContent }

      await this.sendRest('POST', '/v2/email/templates', body)

      return { templateName }
    } catch (error) {
      this.#handleError('createEmailTemplate', error)
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName List Templates
   * @description Provides a searchable list of email template names for use in send operations.
   * @route POST /list-templates-dictionary
   * @paramDef {"type":"listTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"WelcomeTemplate","value":"WelcomeTemplate"}],"cursor":null}
   */
  async listTemplatesDictionary(payload) {
    const { search, cursor } = payload || {}

    try {
      let path = '/v2/email/templates?PageSize=100'

      if (cursor) path += `&NextToken=${ encodeURIComponent(cursor) }`

      const res = await this.sendRest('GET', path)
      let names = (res.TemplatesMetadata || []).map(t => t.TemplateName)

      if (search) {
        const lower = search.toLowerCase()

        names = names.filter(name => name.toLowerCase().includes(lower))
      }

      return {
        items: names.map(name => ({ label: name, value: name })),
        cursor: res.NextToken || null,
      }
    } catch (error) {
      this.#handleError('listTemplatesDictionary', error)
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName List Identities
   * @description Provides a searchable list of verified email identities (domains and email addresses) for use as sender addresses.
   * @route POST /list-identities-dictionary
   * @paramDef {"type":"listIdentitiesDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"example.com","value":"example.com","note":"DOMAIN"},{"label":"user@example.com","value":"user@example.com","note":"EMAIL_ADDRESS"}],"cursor":null}
   */
  async listIdentitiesDictionary(payload) {
    const { search, cursor } = payload || {}

    try {
      let path = '/v2/email/identities?PageSize=100'

      if (cursor) path += `&NextToken=${ encodeURIComponent(cursor) }`

      const res = await this.sendRest('GET', path)
      let identities = res.EmailIdentities || []

      if (search) {
        const lower = search.toLowerCase()

        identities = identities.filter(i => i.IdentityName.toLowerCase().includes(lower))
      }

      return {
        items: identities.map(i => ({ label: i.IdentityName, value: i.IdentityName, note: i.IdentityType })),
        cursor: res.NextToken || null,
      }
    } catch (error) {
      this.#handleError('listIdentitiesDictionary', error)
    }
  }

  #handleError(method, error) {
    this.logger.error(`[${ method }]`, error && error.message)

    if (error && error.name === 'MessageRejected') {
      throw new Error(`Message rejected: ${ error.message }. Verify the sender address and content.`)
    }

    if (error && error.name === 'MailFromDomainNotVerifiedException') {
      throw new Error(`Mail From domain not verified: ${ error.message }. Configure and verify the MAIL FROM domain.`)
    }

    if (error && error.name === 'AccountSuspendedException') {
      throw new Error(`Account suspended: ${ error.message }. Contact AWS Support to resolve account suspension.`)
    }

    if (error && error.name === 'SendingPausedException') {
      throw new Error(`Sending paused: ${ error.message }. Resume sending in the console or wait for the pause to clear.`)
    }

    if (error && error.name === 'NotFoundException') {
      throw new Error(`Resource not found: ${ error.message }. Check the template name or identity.`)
    }

    if (error && (error.name === 'TooManyRequestsException' || error.name === 'ThrottlingException')) {
      throw new Error(`Too many requests: ${ error.message }. Reduce request rate and retry with backoff.`)
    }

    throw mapAwsError(error)
  }
}

if (typeof Flowrunner !== 'undefined') {
  Flowrunner.ServerCode.addService(SES, awsConfigItems)
}

module.exports = { SES }
