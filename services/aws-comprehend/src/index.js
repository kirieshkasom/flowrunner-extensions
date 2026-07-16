'use strict'

const { jsonRequest } = require('./aws-client')
const { CredentialProvider } = require('./credentials')
const { createLogger, mapAwsError } = require('./errors')
const { awsConfigItems } = require('./config-items')

const TARGET_PREFIX = 'Comprehend_20171127'
const CONTENT_TYPE = 'application/x-amz-json-1.1'

// Friendly language labels shown in dropdowns -> Comprehend language codes.
const LANGUAGE_MAP = {
  'English': 'en',
  'Spanish': 'es',
  'French': 'fr',
  'German': 'de',
  'Italian': 'it',
  'Portuguese': 'pt',
  'Arabic': 'ar',
  'Hindi': 'hi',
  'Japanese': 'ja',
  'Korean': 'ko',
  'Chinese (Simplified)': 'zh',
  'Chinese (Traditional)': 'zh-TW',
}

/**
 * @integrationName AWS Comprehend
 * @integrationIcon /icon.svg
 */
class Comprehend {
  constructor(config = {}) {
    this.region = config.region || 'us-east-1'
    this.logger = createLogger('AWS Comprehend')

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
      { region: this.region, service: 'comprehend', target: `${ TARGET_PREFIX }.${ operation }`, contentType: CONTENT_TYPE, body },
      creds
    )
  }

  // Maps a friendly dropdown label to the API value; passes through raw codes unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #requireText(text) {
    if (!text || typeof text !== 'string') throw new Error('text is required and must be a non-empty string.')
  }

  #requireLanguage(languageCode) {
    const resolved = this.#resolveChoice(languageCode, LANGUAGE_MAP)

    if (!resolved) throw new Error('languageCode is required.')

    return resolved
  }

  /**
   * @operationName Detect Sentiment
   * @description Analyzes a single document and returns the prevailing sentiment (POSITIVE, NEGATIVE, NEUTRAL, or MIXED) along with confidence scores for each sentiment class. Synchronous, single-document call; the input text must not exceed 5,000 UTF-8 bytes.
   * @category Sentiment
   * @route POST /detect-sentiment
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The UTF-8 text to analyze. Maximum 5,000 bytes."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["English","Spanish","French","German","Italian","Portuguese","Arabic","Hindi","Japanese","Korean","Chinese (Simplified)","Chinese (Traditional)"]}},"description":"The language of the input text."}
   * @returns {Object}
   * @sampleResult {"sentiment":"POSITIVE","sentimentScore":{"Positive":0.98,"Negative":0.001,"Neutral":0.018,"Mixed":0.001}}
   */
  async detectSentiment(text, languageCode) {
    this.#requireText(text)
    const language = this.#requireLanguage(languageCode)

    try {
      const res = await this.sendJson('DetectSentiment', { Text: text, LanguageCode: language })

      return { sentiment: res.Sentiment || null, sentimentScore: res.SentimentScore || null }
    } catch (error) {
      this.#handleError('detectSentiment', error)
    }
  }

  /**
   * @operationName Detect Entities
   * @description Identifies named entities (people, places, organizations, dates, quantities, and more) in a single document, returning each entity's type, text, confidence score, and character offsets. Synchronous, single-document call; the input text must not exceed 5,000 UTF-8 bytes.
   * @category Entities
   * @route POST /detect-entities
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The UTF-8 text to analyze. Maximum 5,000 bytes."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["English","Spanish","French","German","Italian","Portuguese","Arabic","Hindi","Japanese","Korean","Chinese (Simplified)","Chinese (Traditional)"]}},"description":"The language of the input text."}
   * @returns {Object}
   * @sampleResult {"entities":[{"Type":"PERSON","Text":"John","Score":0.999,"BeginOffset":0,"EndOffset":4}]}
   */
  async detectEntities(text, languageCode) {
    this.#requireText(text)
    const language = this.#requireLanguage(languageCode)

    try {
      const res = await this.sendJson('DetectEntities', { Text: text, LanguageCode: language })

      return { entities: res.Entities || [] }
    } catch (error) {
      this.#handleError('detectEntities', error)
    }
  }

  /**
   * @operationName Detect Key Phrases
   * @description Extracts the key noun phrases from a single document, returning each phrase's text, confidence score, and character offsets. Synchronous, single-document call; the input text must not exceed 5,000 UTF-8 bytes.
   * @category Key Phrases
   * @route POST /detect-key-phrases
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The UTF-8 text to analyze. Maximum 5,000 bytes."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["English","Spanish","French","German","Italian","Portuguese","Arabic","Hindi","Japanese","Korean","Chinese (Simplified)","Chinese (Traditional)"]}},"description":"The language of the input text."}
   * @returns {Object}
   * @sampleResult {"keyPhrases":[{"Text":"the quick report","Score":0.999,"BeginOffset":0,"EndOffset":16}]}
   */
  async detectKeyPhrases(text, languageCode) {
    this.#requireText(text)
    const language = this.#requireLanguage(languageCode)

    try {
      const res = await this.sendJson('DetectKeyPhrases', { Text: text, LanguageCode: language })

      return { keyPhrases: res.KeyPhrases || [] }
    } catch (error) {
      this.#handleError('detectKeyPhrases', error)
    }
  }

  /**
   * @operationName Detect Dominant Language
   * @description Determines the dominant language of a single document, returning candidate language codes ranked by confidence score. No language must be supplied; the input text must not exceed 5,000 UTF-8 bytes.
   * @category Language
   * @route POST /detect-dominant-language
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The UTF-8 text to analyze. Maximum 5,000 bytes."}
   * @returns {Object}
   * @sampleResult {"languages":[{"LanguageCode":"en","Score":0.99}]}
   */
  async detectDominantLanguage(text) {
    this.#requireText(text)

    try {
      const res = await this.sendJson('DetectDominantLanguage', { Text: text })

      return { languages: res.Languages || [] }
    } catch (error) {
      this.#handleError('detectDominantLanguage', error)
    }
  }

  /**
   * @operationName Detect PII Entities
   * @description Locates personally identifiable information (PII) such as names, addresses, emails, phone numbers, and account identifiers in a single document, returning each entity's type, confidence score, and character offsets. English only. Synchronous, single-document call; the input text must not exceed 5,000 UTF-8 bytes.
   * @category Entities
   * @route POST /detect-pii-entities
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The UTF-8 text to analyze. Maximum 5,000 bytes."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["English"]}},"description":"The language of the input text. PII detection currently supports English only (default English)."}
   * @returns {Object}
   * @sampleResult {"entities":[{"Type":"EMAIL","Score":0.999,"BeginOffset":10,"EndOffset":27}]}
   */
  async detectPiiEntities(text, languageCode) {
    this.#requireText(text)
    const language = this.#resolveChoice(languageCode, LANGUAGE_MAP) || 'en'

    try {
      const res = await this.sendJson('DetectPiiEntities', { Text: text, LanguageCode: language })

      return { entities: res.Entities || [] }
    } catch (error) {
      this.#handleError('detectPiiEntities', error)
    }
  }

  /**
   * @operationName Detect Syntax
   * @description Performs part-of-speech tagging on a single document, returning each token's text, part-of-speech tag, confidence score, and character offsets. Supported languages: English, Spanish, French, German, Italian, and Portuguese. Synchronous, single-document call; the input text must not exceed 5,000 UTF-8 bytes.
   * @category Syntax
   * @route POST /detect-syntax
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The UTF-8 text to analyze. Maximum 5,000 bytes."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["English","Spanish","French","German","Italian","Portuguese"]}},"description":"The language of the input text. Syntax analysis supports English, Spanish, French, German, Italian, and Portuguese only."}
   * @returns {Object}
   * @sampleResult {"tokens":[{"TokenId":1,"Text":"They","BeginOffset":0,"EndOffset":4,"PartOfSpeech":{"Tag":"PRON","Score":0.99}}]}
   */
  async detectSyntax(text, languageCode) {
    this.#requireText(text)
    const language = this.#requireLanguage(languageCode)

    try {
      const res = await this.sendJson('DetectSyntax', { Text: text, LanguageCode: language })

      return { tokens: res.SyntaxTokens || [] }
    } catch (error) {
      this.#handleError('detectSyntax', error)
    }
  }

  /**
   * @operationName Detect Targeted Sentiment
   * @description Performs entity-level (targeted) sentiment analysis on a single document, returning each identified entity along with its mentions and the sentiment expressed toward it. Currently supports English only. Synchronous, single-document call; the input text must not exceed 5,000 UTF-8 bytes.
   * @category Sentiment
   * @route POST /detect-targeted-sentiment
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The UTF-8 text to analyze. Maximum 5,000 bytes."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["English"]}},"description":"The language of the input text. Targeted sentiment currently supports English only (default English)."}
   * @returns {Object}
   * @sampleResult {"entities":[{"DescriptiveMentionIndex":[0],"Mentions":[{"Text":"food","Type":"OTHER","Score":0.99,"BeginOffset":4,"EndOffset":8,"GroupScore":1,"MentionSentiment":{"Sentiment":"POSITIVE","SentimentScore":{"Positive":0.98,"Negative":0.001,"Neutral":0.018,"Mixed":0.001}}}]}]}
   */
  async detectTargetedSentiment(text, languageCode) {
    this.#requireText(text)
    const language = this.#resolveChoice(languageCode, LANGUAGE_MAP) || 'en'

    try {
      const res = await this.sendJson('DetectTargetedSentiment', { Text: text, LanguageCode: language })

      return { entities: res.Entities || [] }
    } catch (error) {
      this.#handleError('detectTargetedSentiment', error)
    }
  }

  /**
   * @operationName Batch Detect Sentiment
   * @description Analyzes up to 25 documents in a single request and returns the prevailing sentiment and confidence scores for each. Returns a resultList (successful documents, each keyed by its input Index) and an errorList (documents that failed). Each document must not exceed 5,000 UTF-8 bytes.
   * @category Sentiment
   * @route POST /batch-detect-sentiment
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"Array<String>","label":"Text List","name":"textList","required":true,"description":"The documents to analyze, one string per document. Maximum 25 documents, each up to 5,000 bytes."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["English","Spanish","French","German","Italian","Portuguese","Arabic","Hindi","Japanese","Korean","Chinese (Simplified)","Chinese (Traditional)"]}},"description":"The language of the input documents. All documents must be in the same language."}
   * @returns {Object}
   * @sampleResult {"resultList":[{"Index":0,"Sentiment":"POSITIVE","SentimentScore":{"Positive":0.98,"Negative":0.001,"Neutral":0.018,"Mixed":0.001}}],"errorList":[]}
   */
  async batchDetectSentiment(textList, languageCode) {
    this.#requireTextList(textList)
    const language = this.#requireLanguage(languageCode)

    try {
      const res = await this.sendJson('BatchDetectSentiment', { TextList: textList, LanguageCode: language })

      return { resultList: res.ResultList || [], errorList: res.ErrorList || [] }
    } catch (error) {
      this.#handleError('batchDetectSentiment', error)
    }
  }

  /**
   * @operationName Batch Detect Entities
   * @description Identifies named entities in up to 25 documents in a single request. Returns a resultList (successful documents, each keyed by its input Index with its detected entities) and an errorList (documents that failed). Each document must not exceed 5,000 UTF-8 bytes.
   * @category Entities
   * @route POST /batch-detect-entities
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"Array<String>","label":"Text List","name":"textList","required":true,"description":"The documents to analyze, one string per document. Maximum 25 documents, each up to 5,000 bytes."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["English","Spanish","French","German","Italian","Portuguese","Arabic","Hindi","Japanese","Korean","Chinese (Simplified)","Chinese (Traditional)"]}},"description":"The language of the input documents. All documents must be in the same language."}
   * @returns {Object}
   * @sampleResult {"resultList":[{"Index":0,"Entities":[{"Type":"PERSON","Text":"John","Score":0.999,"BeginOffset":0,"EndOffset":4}]}],"errorList":[]}
   */
  async batchDetectEntities(textList, languageCode) {
    this.#requireTextList(textList)
    const language = this.#requireLanguage(languageCode)

    try {
      const res = await this.sendJson('BatchDetectEntities', { TextList: textList, LanguageCode: language })

      return { resultList: res.ResultList || [], errorList: res.ErrorList || [] }
    } catch (error) {
      this.#handleError('batchDetectEntities', error)
    }
  }

  #requireTextList(textList) {
    if (!Array.isArray(textList) || textList.length === 0) {
      throw new Error('textList must be a non-empty array of strings.')
    }

    if (textList.length > 25) {
      throw new Error('textList can contain a maximum of 25 documents.')
    }
  }

  #handleError(method, error) {
    this.logger.error(`[${ method }]`, error && error.message)

    if (error && error.name === 'TextSizeLimitExceededException') {
      throw new Error('Text size limit exceeded: each document may be at most 5,000 UTF-8 bytes. Use a smaller document.')
    }

    if (error && error.name === 'UnsupportedLanguageException') {
      throw new Error(`Unsupported language: ${ error.message }. This operation does not support the selected language.`)
    }

    if (error && error.name === 'BatchSizeLimitExceededException') {
      throw new Error('Batch size limit exceeded: a maximum of 25 documents is allowed per batch request.')
    }

    if (error && error.name === 'InvalidRequestException') {
      throw new Error(`Invalid request: ${ error.message }. Check the input text and language.`)
    }

    throw mapAwsError(error)
  }
}

if (typeof Flowrunner !== 'undefined') {
  Flowrunner.ServerCode.addService(Comprehend, awsConfigItems)
}

module.exports = { Comprehend }
