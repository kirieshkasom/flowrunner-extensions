const MailboxReader = require('./mailbox-reader')
const EmailParser = require('./email-parser')
const EmailSender = require('./email-sender')
const { logger } = require('./logger')

/**
 *  @integrationName Mailbox
 *  @integrationIcon /icon.png
 **/
class MailboxService {
  constructor(config) {
    this.config = config || {}
    this.emailParser = new EmailParser()
  }

  /**
   * @typedef {Object} EmailAddress
   * @property {string} address - The email address.
   * @property {string} name - The name associated with the email address.
   */

  /**
   * @typedef {Object} Attachment
   * @property {string} filename - The name of the attachment file.
   * @property {string} contentType - The MIME type of the attachment.
   * @property {string} contentDisposition - How the attachment should be handled (e.g., inline or attachment).
   * @property {Buffer|Stream} content - The actual content of the attachment (as a Buffer or Stream).
   */

  /**
   * @typedef {Object} Mail
   * @property {string} uid - The unique UID of the email.
   * @property {string} messageId - The unique ID of the email message.
   * @property {Object} from - The sender of the email.
   * @property {EmailAddress[]} from.text - The plain text version of sender email addresses.
   * @property {EmailAddress[]} from.value - Array of sender email addresses.
   * @property {Object} to - The recipient(s) of the email.
   * @property {EmailAddress[]} to.value - Array of recipient email addresses.
   * @property {EmailAddress[]} [cc] - The email addresses of CC recipients (optional).
   * @property {EmailAddress[]} [bcc] - The email addresses of BCC recipients (optional).
   * @property {string} subject - The subject of the email.
   * @property {string} date - The date when the email was sent.
   * @property {string} [replyTo] - The reply-to email address (optional).
   * @property {string} body - The plain text version of the email body.
   * @property {string} textAsHtml - The plain text email body converted to HTML.
   * @property {string} html - The HTML version of the email body (optional).
   * @property {string[]} [inReplyTo] - Message-IDs of emails this message is replying to (optional).
   */

  /**
   * @description Reads the inbox and retrieves the last N emails, parsing them into a structured format. Supports various filter criteria including sender, recipient, subject, date ranges, and read status.
   * @route POST /read-inbox
   * @operationName Read Inbox
   * @appearanceColor #1581d7 #50d8ff
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The number of most recent emails to retrieve from the inbox. Defaults to 5. Specify 0 to retrieve all."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Filter emails by sender."}
   * @paramDef {"type":"String","label":"To","name":"to","description":"Filter emails by recipient."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Filter emails by subject."}
   * @paramDef {"type":"Number","label":"Since","name":"since","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Filter emails received after this date."}
   * @paramDef {"type":"Number","label":"Before","name":"before","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Filter emails received before this date."}
   * @paramDef {"type":"Boolean","label":"Seen","name":"seen","uiComponent":{"type":"TOGGLE"},"description":"Filter for seen or unseen (unread) emails. Defaults to unseen emails."}
   * @paramDef {"type":"Boolean","label":"Answered","name":"answered","uiComponent":{"type":"TOGGLE"},"description":"Filter emails that have been answered or not."}
   *
   * @returns {Promise<Array<Mail>>} - A promise that resolves to an array of parsed email objects.
   * @sampleResult [{"uid":"12345","messageId":"<example@domain.com>","from":{"value":[{"address":"sender@example.com","name":"John Doe"}]},"to":{"value":[{"address":"recipient@example.com","name":"Jane Smith"}]},"subject":"Test Email","date":"2023-10-01T12:00:00.000Z","body":"This is a test email body.","html":"<p>This is a test email body.</p>"}]
   */
  async readInbox(limit = 5, from, to, subject, since, before, seen, answered) {
    this.mailboxReader = new MailboxReader({
      host: this.config.imapHost,
      port: this.config.imapPort,
      useTLS: this.config.imapUseTLS,
      user: this.config.user,
      password: this.config.password,
      accessToken: this.config.accessToken,
    })

    const searchCriteria = { seen }

    if (from) searchCriteria.from = from
    if (to) searchCriteria.to = to
    if (subject) searchCriteria.subject = subject
    if (since) searchCriteria.since = new Date(since)
    if (before) searchCriteria.before = new Date(before)
    if (seen !== undefined) searchCriteria.seen = seen
    if (answered !== undefined) searchCriteria.answered = answered

    try {
      await this.mailboxReader.connect()
      const rawEmails = await this.mailboxReader.fetchEmails(searchCriteria, limit)

      const parsedEmails = []

      for (const rawEmail of rawEmails) {
        const parsedEmail = await this.emailParser.parse(rawEmail.source)
        parsedEmails.push({ ...parsedEmail, uid: rawEmail.uid })
      }

      return parsedEmails
    } catch (error) {
      logger.error('Error reading and parsing emails:', error)

      throw error
    } finally {
      await this.mailboxReader.disconnect()
    }
  }

  /**
   * @description Marks a specified email as unread in the mailbox. This allows you to reset the read status of an email that was previously marked as read.
   * @route POST /mark-as-unread
   * @operationName Mark Email As Unread
   * @appearanceColor #1581d7 #50d8ff
   *
   * @paramDef {"type":"String","label":"Email UID","name":"emailUid","required":true,"description":"The UID of Email"}
   *
   * @returns {Promise<void>}
   * @sampleResult {"success":true,"message":"Email marked as unread"}
   */
  async markEmailAsUnread(emailUid) {
    this.mailboxReader = new MailboxReader({
      host: this.config.imapHost,
      port: this.config.imapPort,
      useTLS: this.config.imapUseTLS,
      user: this.config.user,
      password: this.config.password,
      accessToken: this.config.accessToken,
    })

    try {
      await this.mailboxReader.connect()
      await this.mailboxReader.markEmailAsUnread(emailUid)
    } catch (error) {
      logger.error('Error marking and email as unread:', error)

      throw error
    } finally {
      await this.mailboxReader.disconnect()
    }
  }

  /**
   * @description Sends an email using SMTP configuration. Supports both plain text and HTML content, along with CC, BCC, priority settings and custom reply-to addresses.
   * @route POST /send-email
   * @operationName Send Email
   * @appearanceColor #1581d7 #50d8ff
   *
   * @paramDef {"type":"String","label":"From","name":"from","required":true,"description":"The name of the sender."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"The recipient's email address or a comma-separated list of addresses."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The subject of the email."}
   * @paramDef {"type":"String","label":"Text Body","name":"text","required":true,"description":"The plain text content of the email."}
   * @paramDef {"type":"String","label":"HTML Body","name":"html","description":"The HTML content of the email. If not provided, the email will be sent as plain text."}
   * @paramDef {"type":"String","label":"CC (Carbon Copy)","name":"cc","description":"Email address(es) for CC (carbon copy)."}
   * @paramDef {"type":"String","label":"BCC (Blind Carbon Copy)","name":"bcc","description":"Email address(es) for BCC (blind carbon copy)."}
   * @paramDef {"type":"String","label":"Reply To","name":"replyTo","description":"Email address to reply to."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["high","normal","low"]}},"description":"Priority of the email ('high', 'normal', 'low'). Defaults to 'normal'"}
   *
   * @returns {Promise<Object>} A promise that resolves with the `info` object when the email is sent successfully.
   * @sampleResult {"messageId":"<abc123@domain.com>","response":"250 Message accepted","accepted":["recipient@example.com"],"rejected":[],"envelope":{"from":"sender@example.com","to":["recipient@example.com"]}}
   */
  sendEmail(from, to, subject, text, html, cc, bcc, replyTo, priority) {
    const emailSender = new EmailSender({
      host: this.config.smtpHost,
      port: this.config.smtpPort,
      useTLS: this.config.smtpUseTLS,
      user: this.config.user,
      password: this.config.password,
      accessToken: this.config.accessToken,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
    })

    return emailSender.sendEmail(from, to, subject, text, html, cc, bcc, replyTo, priority)
  }
}

Flowrunner.ServerCode.addService(MailboxService, [
  {
    order: 0,
    displayName: 'IMAP Host',
    defaultValue: 'imap.gmail.com',
    name: 'imapHost',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'IMAP server',
  },
  {
    order: 1,
    displayName: 'IMAP Port',
    defaultValue: 993,
    name: 'imapPort',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Secure IMAP port',
  },
  {
    order: 2,
    displayName: 'IMAP Use TLS',
    defaultValue: true,
    name: 'imapUseTLS',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.BOOL,
  },
  {
    order: 3,
    displayName: 'SMTP Host',
    defaultValue: 'smtp.gmail.com',
    name: 'smtpHost',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'SMTP server',
  },
  {
    order: 4,
    displayName: 'SMTP Port',
    defaultValue: 587,
    name: 'smtpPort',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Secure SMTP port',
  },
  {
    order: 5,
    displayName: 'SMTP Use TLS',
    defaultValue: false,
    name: 'smtpUseTLS',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.BOOL,
  },
  {
    order: 6,
    displayName: 'User',
    name: 'user',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    hint: 'Your email address',
    required: false,
  },
  {
    order: 7,
    displayName: 'Password',
    name: 'password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    hint: 'Your email password or app-specific password',
    required: false,
  },
])
