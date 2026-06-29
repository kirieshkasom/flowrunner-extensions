'use strict'

const { jsonRequest } = require('./aws-client')
const { CredentialProvider } = require('./credentials')
const { createLogger, mapAwsError } = require('./errors')
const { awsConfigItems } = require('./config-items')

/**
 * @integrationName Amazon SQS
 * @integrationIcon /icon.svg
 */
class SQS {
  constructor(config = {}, context = {}) {
    this.region = config.region || 'us-east-1'
    this.logger = createLogger('SQS')

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
      { region: this.region, service: 'sqs', target: `AmazonSQS.${ operation }`, contentType: 'application/x-amz-json-1.0', body },
      creds
    )
  }

  /**
   * @operationName Send Message
   * @description Sends a single message to a queue. For FIFO queues, provide Message Group ID to ensure ordering and Message Deduplication ID to prevent duplicates. Use Delay Seconds to postpone message delivery.
   * @route POST /send-message
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Queue URL","name":"queueUrl","required":true,"description":"The URL of the queue to send the message to."}
   * @paramDef {"type":"String","label":"Message Body","name":"messageBody","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the message. Maximum 256 KB."}
   * @paramDef {"type":"Number","label":"Delay Seconds","name":"delaySeconds","required":false,"uiComponent":{"type":"NUMERIC"},"description":"Seconds to delay message delivery (0–900). Overrides the queue's default delay."}
   * @paramDef {"type":"String","label":"Message Group ID","name":"messageGroupId","required":false,"description":"Required for FIFO queues. Groups related messages to be processed in order."}
   * @paramDef {"type":"String","label":"Message Deduplication ID","name":"messageDeduplicationId","required":false,"description":"Optional for FIFO queues with content-based deduplication disabled. Prevents duplicate messages within a 5-minute window."}
   * @returns {Object}
   * @sampleResult {"messageId":"5fea7756-0ea4-451a-a703-a558b933e274","sequenceNumber":null}
   */
  async sendMessage(queueUrl, messageBody, delaySeconds, messageGroupId, messageDeduplicationId) {
    if (!queueUrl) throw new Error('queueUrl is required.')
    if (!messageBody) throw new Error('messageBody is required.')

    try {
      const body = {
        QueueUrl: queueUrl,
        MessageBody: messageBody,
        ...(delaySeconds != null && { DelaySeconds: delaySeconds }),
        ...(messageGroupId && { MessageGroupId: messageGroupId }),
        ...(messageDeduplicationId && { MessageDeduplicationId: messageDeduplicationId }),
      }

      const res = await this.sendJson('SendMessage', body)

      return { messageId: res.MessageId, sequenceNumber: res.SequenceNumber || null }
    } catch (error) {
      this.#handleError('sendMessage', error)
    }
  }

  /**
   * @operationName Send Message Batch
   * @description Sends up to 10 messages in a single request. Each entry must include a unique ID and a message body. Returns lists of successfully sent and failed messages.
   * @route POST /send-message-batch
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Queue URL","name":"queueUrl","required":true,"description":"The URL of the queue to send messages to."}
   * @paramDef {"type":"Array","label":"Entries","name":"entries","required":true,"description":"Array of message entries to send. Each entry must have id (string, unique per batch), messageBody (string), and an optional delaySeconds (number)."}
   * @returns {Object}
   * @sampleResult {"successful":[{"id":"msg1","messageId":"5fea7756-0ea4-451a-a703-a558b933e274"}],"failed":[]}
   */
  async sendMessageBatch(queueUrl, entries) {
    if (!queueUrl) throw new Error('queueUrl is required.')
    if (!Array.isArray(entries) || entries.length === 0) throw new Error('entries must be a non-empty array.')

    try {
      const body = {
        QueueUrl: queueUrl,
        Entries: entries.map(e => ({
          Id: e.id,
          MessageBody: e.messageBody,
          ...(e.delaySeconds != null && { DelaySeconds: e.delaySeconds }),
        })),
      }

      const res = await this.sendJson('SendMessageBatch', body)

      return {
        successful: (res.Successful || []).map(s => ({ id: s.Id, messageId: s.MessageId })),
        failed: (res.Failed || []).map(f => ({ id: f.Id, code: f.Code, message: f.Message, senderFault: f.SenderFault })),
      }
    } catch (error) {
      this.#handleError('sendMessageBatch', error)
    }
  }

  /**
   * @operationName Receive Messages
   * @description Polls a queue and returns up to the requested number of messages. Use Wait Time Seconds for long polling to reduce empty responses and lower costs. Messages remain hidden from other consumers until the Visibility Timeout expires.
   * @route POST /receive-message
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Queue URL","name":"queueUrl","required":true,"description":"The URL of the queue to receive messages from."}
   * @paramDef {"type":"Number","label":"Max Number of Messages","name":"maxNumberOfMessages","required":false,"uiComponent":{"type":"NUMERIC"},"description":"Maximum number of messages to return (1–10). Fewer may be returned even when available."}
   * @paramDef {"type":"Number","label":"Wait Time Seconds","name":"waitTimeSeconds","required":false,"uiComponent":{"type":"NUMERIC"},"description":"Seconds to wait for messages before returning (0–20). Values above 0 enable long polling."}
   * @paramDef {"type":"Number","label":"Visibility Timeout","name":"visibilityTimeout","required":false,"uiComponent":{"type":"NUMERIC"},"description":"Seconds a received message is hidden from other consumers (0–43200). Defaults to the queue setting."}
   * @returns {Object}
   * @sampleResult {"messages":[{"messageId":"5fea7756-0ea4-451a-a703-a558b933e274","receiptHandle":"AQEBwJnKyrHigUMZj...","body":"Hello World","md5OfBody":"e1d3a7b3c4d5e6f7","attributes":{}}]}
   */
  async receiveMessage(queueUrl, maxNumberOfMessages, waitTimeSeconds, visibilityTimeout) {
    if (!queueUrl) throw new Error('queueUrl is required.')

    try {
      const body = {
        QueueUrl: queueUrl,
        ...(maxNumberOfMessages && { MaxNumberOfMessages: maxNumberOfMessages }),
        ...(waitTimeSeconds != null && { WaitTimeSeconds: waitTimeSeconds }),
        ...(visibilityTimeout != null && { VisibilityTimeout: visibilityTimeout }),
        MessageSystemAttributeNames: ['All'],
      }

      const res = await this.sendJson('ReceiveMessage', body)

      return {
        messages: (res.Messages || []).map(m => ({
          messageId: m.MessageId,
          receiptHandle: m.ReceiptHandle,
          body: m.Body,
          md5OfBody: m.MD5OfBody,
          attributes: m.Attributes || {},
        })),
      }
    } catch (error) {
      this.#handleError('receiveMessage', error)
    }
  }

  /**
   * @operationName Delete Message
   * @description Permanently removes a message from a queue using its receipt handle obtained from Receive Messages. After deletion the message cannot be received again.
   * @route POST /delete-message
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Queue URL","name":"queueUrl","required":true,"description":"The URL of the queue containing the message."}
   * @paramDef {"type":"String","label":"Receipt Handle","name":"receiptHandle","required":true,"description":"The receipt handle returned by Receive Messages. This identifies which message to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteMessage(queueUrl, receiptHandle) {
    if (!queueUrl) throw new Error('queueUrl is required.')
    if (!receiptHandle) throw new Error('receiptHandle is required.')

    try {
      const body = { QueueUrl: queueUrl, ReceiptHandle: receiptHandle }

      await this.sendJson('DeleteMessage', body)

      return { success: true }
    } catch (error) {
      this.#handleError('deleteMessage', error)
    }
  }

  /**
   * @operationName Get Queue Attributes
   * @description Retrieves attributes of a queue such as message count, visibility timeout, ARN, and delay settings. Defaults to returning all attributes.
   * @route POST /get-queue-attributes
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Queue URL","name":"queueUrl","required":true,"description":"The URL of the queue to inspect."}
   * @paramDef {"type":"Array","label":"Attribute Names","name":"attributeNames","required":false,"description":"List of attribute names to retrieve (e.g. [\"ApproximateNumberOfMessages\",\"VisibilityTimeout\"]). Defaults to all attributes."}
   * @returns {Object}
   * @sampleResult {"attributes":{"ApproximateNumberOfMessages":"5","VisibilityTimeout":"30","QueueArn":"arn:aws:sqs:us-east-1:123456789012:MyQueue"}}
   */
  async getQueueAttributes(queueUrl, attributeNames) {
    if (!queueUrl) throw new Error('queueUrl is required.')

    try {
      const body = {
        QueueUrl: queueUrl,
        AttributeNames: Array.isArray(attributeNames) && attributeNames.length ? attributeNames : ['All'],
      }

      const res = await this.sendJson('GetQueueAttributes', body)

      return { attributes: res.Attributes || {} }
    } catch (error) {
      this.#handleError('getQueueAttributes', error)
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName List Queues Dictionary
   * @description Provides a searchable list of queue URLs for dynamic dropdown selection in other operations. The label shows the queue name; the value is the full URL.
   * @route POST /list-queues-dictionary
   * @paramDef {"type":"listQueuesDictionary__payload","label":"Payload","name":"payload","description":"Optional queue name prefix to filter results and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"MyQueue","value":"https://sqs.us-east-1.amazonaws.com/123456789012/MyQueue"}],"cursor":null}
   */
  async listQueuesDictionary(payload) {
    const { search, cursor } = payload || {}

    try {
      const body = {
        MaxResults: 100,
        ...(search && { QueueNamePrefix: search }),
        ...(cursor && { NextToken: cursor }),
      }

      const res = await this.sendJson('ListQueues', body)

      const urls = res.QueueUrls || []

      return {
        items: urls.map(url => ({ label: url.split('/').pop(), value: url })),
        cursor: res.NextToken || null,
      }
    } catch (error) {
      this.#handleError('listQueuesDictionary', error)
    }
  }

  #handleError(method, error) {
    this.logger.error(`[${ method }]`, error && error.message)

    if (error && (error.name === 'QueueDoesNotExist' || error.name === 'AWS.SimpleQueueService.NonExistentQueue')) {
      throw new Error(`Queue not found: ${ error.message }. Check the queue URL and region.`)
    }

    if (error && error.name === 'ReceiptHandleIsInvalid') {
      throw new Error(`Invalid receipt handle: ${ error.message }. The message may have already been deleted or the handle has expired.`)
    }

    if (error && (error.name === 'OverLimit' || error.name === 'AWS.SimpleQueueService.OverLimit')) {
      throw new Error(`Request over limit: ${ error.message }. Reduce the number of in-flight messages or retry later.`)
    }

    if (error && error.name === 'AWS.SimpleQueueService.QueueDeletedRecently') {
      throw new Error(`Queue was recently deleted: ${ error.message }. Wait 60 seconds before recreating a queue with the same name.`)
    }

    throw mapAwsError(error)
  }
}

if (typeof Flowrunner !== 'undefined') {
  Flowrunner.ServerCode.addService(SQS, awsConfigItems)
}

module.exports = { SQS }
