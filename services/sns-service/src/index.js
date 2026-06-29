'use strict'

const { queryRequest, parseXmlTag, parseXmlTags } = require('./aws-client')
const { CredentialProvider } = require('./credentials')
const { createLogger, mapAwsError } = require('./errors')
const { awsConfigItems } = require('./config-items')

const SNS_VERSION = '2010-03-31'

/**
 * @integrationName Amazon SNS
 * @integrationIcon /icon.png
 */
class SNS {
  constructor(config = {}, context = {}) {
    this.region = config.region || 'us-east-1'
    this.logger = createLogger('SNS')

    this.credentials = new CredentialProvider({
      authenticationMethod: config.authenticationMethod || 'API Key',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: this.region,
      roleArn: config.roleArn,
      externalId: config.externalId,
    })

    this.deps = { queryRequest }
  }

  async sendQuery(action, params) {
    const creds = await this.credentials.resolve()

    return this.deps.queryRequest(
      { region: this.region, service: 'sns', action, version: SNS_VERSION, params },
      creds
    )
  }

  /**
   * @operationName Publish Message
   * @description Sends a message to a topic or directly to a phone number via SMS. Provide either a topic ARN or a phone number — at least one is required alongside the message.
   * @route POST /publish
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Topic ARN","name":"topicArn","required":false,"description":"The ARN of the topic to publish to. Required if Phone Number is not provided."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","required":false,"description":"E.164 phone number to send an SMS to (e.g. +15551234567). Required if Topic ARN is not provided."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message body to publish."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":false,"description":"Optional subject line used for email subscriptions."}
   * @returns {Object}
   * @sampleResult {"messageId":"abc-123"}
   */
  async publish(topicArn, phoneNumber, message, subject) {
    if (!message) throw new Error('message is required.')
    if (!topicArn && !phoneNumber) throw new Error('Either topicArn or phoneNumber is required.')

    try {
      const params = {
        Message: message,
        ...(phoneNumber ? { PhoneNumber: phoneNumber } : { TopicArn: topicArn }),
        Subject: subject,
      }

      const res = await this.sendQuery('Publish', params)

      return { messageId: parseXmlTag(res.body, 'MessageId') }
    } catch (error) {
      this.#handleError('publish', error)
    }
  }

  /**
   * @operationName Create Topic
   * @description Creates a new SNS topic with the given name. Returns the topic ARN which can be used for publishing and subscribing.
   * @route POST /create-topic
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Topic Name","name":"name","required":true,"description":"The name for the topic. Must be unique within the account and region."}
   * @returns {Object}
   * @sampleResult {"topicArn":"arn:aws:sns:us-east-1:123456789012:MyTopic"}
   */
  async createTopic(name) {
    if (!name) throw new Error('name is required.')

    try {
      const res = await this.sendQuery('CreateTopic', { Name: name })

      return { topicArn: parseXmlTag(res.body, 'TopicArn') }
    } catch (error) {
      this.#handleError('createTopic', error)
    }
  }

  /**
   * @operationName Delete Topic
   * @description Permanently deletes the specified topic and all its subscriptions.
   * @route POST /delete-topic
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Topic ARN","name":"topicArn","required":true,"dictionary":"listTopicsDictionary","description":"The ARN of the topic to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteTopic(topicArn) {
    if (!topicArn) throw new Error('topicArn is required.')

    try {
      await this.sendQuery('DeleteTopic', { TopicArn: topicArn })

      return { success: true }
    } catch (error) {
      this.#handleError('deleteTopic', error)
    }
  }

  /**
   * @operationName Subscribe
   * @description Subscribes an endpoint (email address, phone number, URL, SQS queue, or Lambda) to a topic. Returns the subscription ARN which may be "pending confirmation" for email endpoints.
   * @route POST /subscribe
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Topic ARN","name":"topicArn","required":true,"dictionary":"listTopicsDictionary","description":"The ARN of the topic to subscribe to."}
   * @paramDef {"type":"String","label":"Protocol","name":"protocol","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["email","sms","https","http","sqs","lambda","application","firehose"]}},"description":"The delivery protocol for messages (e.g. email, sms, https, sqs, lambda)."}
   * @paramDef {"type":"String","label":"Endpoint","name":"endpoint","required":true,"description":"The endpoint that receives notifications: an email address, phone number, URL, SQS ARN, or Lambda ARN."}
   * @returns {Object}
   * @sampleResult {"subscriptionArn":"arn:aws:sns:us-east-1:123456789012:MyTopic:abc-123"}
   */
  async subscribe(topicArn, protocol, endpoint) {
    if (!topicArn) throw new Error('topicArn is required.')
    if (!protocol) throw new Error('protocol is required.')
    if (!endpoint) throw new Error('endpoint is required.')

    try {
      const res = await this.sendQuery('Subscribe', {
        TopicArn: topicArn,
        Protocol: protocol,
        Endpoint: endpoint,
        ReturnSubscriptionArn: 'true',
      })

      return { subscriptionArn: parseXmlTag(res.body, 'SubscriptionArn') }
    } catch (error) {
      this.#handleError('subscribe', error)
    }
  }

  /**
   * @operationName Unsubscribe
   * @description Removes a subscription from a topic using the subscription ARN.
   * @route POST /unsubscribe
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Subscription ARN","name":"subscriptionArn","required":true,"description":"The ARN of the subscription to remove."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async unsubscribe(subscriptionArn) {
    if (!subscriptionArn) throw new Error('subscriptionArn is required.')

    try {
      await this.sendQuery('Unsubscribe', { SubscriptionArn: subscriptionArn })

      return { success: true }
    } catch (error) {
      this.#handleError('unsubscribe', error)
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName List Topics Dictionary
   * @description Provides a searchable list of topic ARNs for dynamic dropdown selection in other operations.
   * @route POST /list-topics-dictionary
   * @paramDef {"type":"listTopicsDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"MyTopic","value":"arn:aws:sns:us-east-1:123456789012:MyTopic"}],"cursor":null}
   */
  async listTopicsDictionary(payload) {
    const { search, cursor } = payload || {}

    try {
      const res = await this.sendQuery('ListTopics', cursor ? { NextToken: cursor } : {})
      const arns = parseXmlTags(res.body, 'TopicArn')

      let items = arns.map(arn => {
        const label = arn.split(':').pop()

        return { label, value: arn }
      })

      if (search) {
        const lower = search.toLowerCase()

        items = items.filter(item => item.label.toLowerCase().includes(lower))
      }

      return {
        items,
        cursor: parseXmlTag(res.body, 'NextToken') || null,
      }
    } catch (error) {
      this.#handleError('listTopicsDictionary', error)
    }
  }

  #handleError(method, error) {
    this.logger.error(`[${ method }]`, error && error.message)

    if (error && (error.name === 'NotFound' || error.name === 'NotFoundException')) {
      throw new Error(`Resource not found: ${ error.message }. Check the topic or subscription ARN.`)
    }

    if (error && error.name === 'AuthorizationError') {
      throw new Error(`Authorization error: ${ error.message }. Verify IAM permissions for this operation.`)
    }

    if (error && error.name === 'InvalidParameter') {
      throw new Error(`Invalid parameter: ${ error.message }. Check the values provided.`)
    }

    if (error && (error.name === 'Throttled' || /throttl/i.test(error.name))) {
      throw new Error(`Request throttled: ${ error.message }. Retry with backoff.`)
    }

    throw mapAwsError(error)
  }
}

if (typeof Flowrunner !== 'undefined') {
  Flowrunner.ServerCode.addService(SNS, awsConfigItems)
}

module.exports = { SNS }
