const logger = {
  info: (...args) => console.log('[Google Cloud Natural Language] info:', ...args),
  debug: (...args) => console.log('[Google Cloud Natural Language] debug:', ...args),
  error: (...args) => console.log('[Google Cloud Natural Language] error:', ...args),
  warn: (...args) => console.log('[Google Cloud Natural Language] warn:', ...args),
}

const API_BASE_URL = 'https://language.googleapis.com'

const DOCUMENT_TYPE_MAP = {
  'Plain Text': 'PLAIN_TEXT',
  HTML: 'HTML',
}

/**
 * @integrationName Google Cloud Natural Language
 * @integrationIcon /icon.svg
 */
class GoogleNaturalLanguageService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * Builds the Document object shared by every operation. v2 endpoints use the
   * `languageCode` field while v1 endpoints use `language`; the caller passes the
   * correct field name via `languageField`.
   */
  #buildDocument(content, documentType, language, languageField) {
    const document = {
      type: this.#resolveChoice(documentType, DOCUMENT_TYPE_MAP) || 'PLAIN_TEXT',
      content: content || '',
    }

    if (language) {
      document[languageField] = language
    }

    return document
  }

  /**
   * Single request helper for all Natural Language calls. `version` is the API
   * path segment (`v1` or `v2`) and `analysisMethod` is the `documents:<method>`
   * resource verb.
   */
  async #apiRequest({ version, analysisMethod, body, logTag }) {
    const url = `${ API_BASE_URL }/${ version }/documents:${ analysisMethod }`

    try {
      logger.debug(`${ logTag } - [POST::${ url }]`)

      const request = Flowrunner.Request.post(url)
        .set({ 'Content-Type': 'application/json' })
        .query({ key: this.apiKey })

      return await request.send(body)
    } catch (error) {
      const message = error.body?.error?.message || error.body?.message || error.message
      const status = error.body?.error?.status || error.status || error.statusCode

      logger.error(`${ logTag } - failed (${ status || 'error' }): ${ message }`)

      throw new Error(`Google Cloud Natural Language API error: ${ message }`)
    }
  }

  /**
   * @operationName Analyze Entities
   * @category Text Analysis
   * @description Identifies known entities (people, organizations, locations, events, works of art, consumer goods, numbers, dates, and more) in the supplied text and returns their type, salience, mentions with character offsets, and any associated metadata (such as Wikipedia URLs and Knowledge Graph MIDs). Uses the v2 endpoint.
   * @route POST /analyze-entities
   * @appearanceColor #4285F4 #669DF6
   *
   * @paramDef {"type":"String","label":"Text Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to analyze. Provide plain text or HTML markup matching the selected document type."}
   * @paramDef {"type":"String","label":"Document Type","name":"documentType","uiComponent":{"type":"DROPDOWN","options":{"values":["Plain Text","HTML"]}},"description":"How the text content is interpreted. Defaults to Plain Text."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional BCP-47 language code of the text (e.g. en, es, ja). If omitted, the language is auto-detected."}
   * @paramDef {"type":"String","label":"Encoding Type","name":"encodingType","uiComponent":{"type":"DROPDOWN","options":{"values":["UTF8","UTF16","UTF32","NONE"]}},"description":"Text encoding used to compute the character offsets returned in mentions. Defaults to UTF8."}
   *
   * @returns {Object}
   * @sampleResult {"entities":[{"name":"Google","type":"ORGANIZATION","metadata":{"mid":"/m/045c7b","wikipedia_url":"https://en.wikipedia.org/wiki/Google"},"salience":0.65,"mentions":[{"text":{"content":"Google","beginOffset":0},"type":"PROPER"}]}],"languageCode":"en","languageSupported":true}
   */
  async analyzeEntities(content, documentType, language, encodingType) {
    return await this.#apiRequest({
      version: 'v2',
      analysisMethod: 'analyzeEntities',
      logTag: '[analyzeEntities]',
      body: {
        document: this.#buildDocument(content, documentType, language, 'languageCode'),
        encodingType: this.#resolveEncoding(encodingType),
      },
    })
  }

  /**
   * @operationName Analyze Sentiment
   * @category Text Analysis
   * @description Determines the overall emotional attitude of the supplied text, returning a document-level sentiment score (-1.0 negative to +1.0 positive) and magnitude (overall emotional strength), plus a per-sentence sentiment breakdown. Uses the v2 endpoint.
   * @route POST /analyze-sentiment
   * @appearanceColor #4285F4 #669DF6
   *
   * @paramDef {"type":"String","label":"Text Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to analyze. Provide plain text or HTML markup matching the selected document type."}
   * @paramDef {"type":"String","label":"Document Type","name":"documentType","uiComponent":{"type":"DROPDOWN","options":{"values":["Plain Text","HTML"]}},"description":"How the text content is interpreted. Defaults to Plain Text."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional BCP-47 language code of the text (e.g. en, es, ja). If omitted, the language is auto-detected."}
   * @paramDef {"type":"String","label":"Encoding Type","name":"encodingType","uiComponent":{"type":"DROPDOWN","options":{"values":["UTF8","UTF16","UTF32","NONE"]}},"description":"Text encoding used to compute the character offsets returned per sentence. Defaults to UTF8."}
   *
   * @returns {Object}
   * @sampleResult {"documentSentiment":{"magnitude":0.8,"score":0.8},"languageCode":"en","sentences":[{"text":{"content":"I love this product.","beginOffset":0},"sentiment":{"magnitude":0.8,"score":0.8}}],"languageSupported":true}
   */
  async analyzeSentiment(content, documentType, language, encodingType) {
    return await this.#apiRequest({
      version: 'v2',
      analysisMethod: 'analyzeSentiment',
      logTag: '[analyzeSentiment]',
      body: {
        document: this.#buildDocument(content, documentType, language, 'languageCode'),
        encodingType: this.#resolveEncoding(encodingType),
      },
    })
  }

  /**
   * @operationName Analyze Entity Sentiment
   * @category Text Analysis
   * @description Combines entity extraction with sentiment analysis, returning each detected entity along with the aggregate sentiment expressed toward it across the document and the sentiment of each individual mention. Useful for understanding how the author feels about specific people, products, or organizations. Uses the v1 endpoint.
   * @route POST /analyze-entity-sentiment
   * @appearanceColor #4285F4 #669DF6
   *
   * @paramDef {"type":"String","label":"Text Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to analyze. Provide plain text or HTML markup matching the selected document type."}
   * @paramDef {"type":"String","label":"Document Type","name":"documentType","uiComponent":{"type":"DROPDOWN","options":{"values":["Plain Text","HTML"]}},"description":"How the text content is interpreted. Defaults to Plain Text."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional BCP-47 language code of the text (e.g. en, es, ja). If omitted, the language is auto-detected."}
   * @paramDef {"type":"String","label":"Encoding Type","name":"encodingType","uiComponent":{"type":"DROPDOWN","options":{"values":["UTF8","UTF16","UTF32","NONE"]}},"description":"Text encoding used to compute the character offsets returned in mentions. Defaults to UTF8."}
   *
   * @returns {Object}
   * @sampleResult {"entities":[{"name":"food","type":"OTHER","salience":0.5,"sentiment":{"magnitude":0.9,"score":0.9},"mentions":[{"text":{"content":"food","beginOffset":10},"type":"COMMON","sentiment":{"magnitude":0.9,"score":0.9}}]}],"language":"en"}
   */
  async analyzeEntitySentiment(content, documentType, language, encodingType) {
    return await this.#apiRequest({
      version: 'v1',
      analysisMethod: 'analyzeEntitySentiment',
      logTag: '[analyzeEntitySentiment]',
      body: {
        document: this.#buildDocument(content, documentType, language, 'language'),
        encodingType: this.#resolveEncoding(encodingType),
      },
    })
  }

  /**
   * @operationName Analyze Syntax
   * @category Text Analysis
   * @description Performs syntactic analysis of the supplied text, breaking it into sentences and tokens and returning each token's part of speech, lemma (base form), and dependency-tree relationship to other tokens. Useful for grammatical parsing and linguistic feature extraction. Uses the v1 endpoint.
   * @route POST /analyze-syntax
   * @appearanceColor #4285F4 #669DF6
   *
   * @paramDef {"type":"String","label":"Text Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to analyze. Provide plain text or HTML markup matching the selected document type."}
   * @paramDef {"type":"String","label":"Document Type","name":"documentType","uiComponent":{"type":"DROPDOWN","options":{"values":["Plain Text","HTML"]}},"description":"How the text content is interpreted. Defaults to Plain Text."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional BCP-47 language code of the text (e.g. en, es, ja). If omitted, the language is auto-detected."}
   * @paramDef {"type":"String","label":"Encoding Type","name":"encodingType","uiComponent":{"type":"DROPDOWN","options":{"values":["UTF8","UTF16","UTF32","NONE"]}},"description":"Text encoding used to compute the character offsets returned for tokens and sentences. Defaults to UTF8."}
   *
   * @returns {Object}
   * @sampleResult {"sentences":[{"text":{"content":"The cat sat.","beginOffset":0}}],"tokens":[{"text":{"content":"The","beginOffset":0},"partOfSpeech":{"tag":"DET"},"dependencyEdge":{"headTokenIndex":1,"label":"DET"},"lemma":"The"}],"language":"en"}
   */
  async analyzeSyntax(content, documentType, language, encodingType) {
    return await this.#apiRequest({
      version: 'v1',
      analysisMethod: 'analyzeSyntax',
      logTag: '[analyzeSyntax]',
      body: {
        document: this.#buildDocument(content, documentType, language, 'language'),
        encodingType: this.#resolveEncoding(encodingType),
      },
    })
  }

  /**
   * @operationName Classify Text
   * @category Text Analysis
   * @description Classifies the supplied text into one or more content categories (such as "/Computers & Electronics" or "/Finance/Investing"), each with a confidence score. Requires at least 20 tokens (roughly 20 words) of text to produce a classification. Uses the v2 endpoint.
   * @route POST /classify-text
   * @appearanceColor #4285F4 #669DF6
   *
   * @paramDef {"type":"String","label":"Text Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to classify. Must contain at least 20 tokens (roughly 20 words) for the API to return categories."}
   * @paramDef {"type":"String","label":"Document Type","name":"documentType","uiComponent":{"type":"DROPDOWN","options":{"values":["Plain Text","HTML"]}},"description":"How the text content is interpreted. Defaults to Plain Text."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional BCP-47 language code of the text (e.g. en, es, ja). If omitted, the language is auto-detected."}
   *
   * @returns {Object}
   * @sampleResult {"categories":[{"name":"/Computers & Electronics/Programming","confidence":0.92}],"languageCode":"en","languageSupported":true}
   */
  async classifyText(content, documentType, language) {
    return await this.#apiRequest({
      version: 'v2',
      analysisMethod: 'classifyText',
      logTag: '[classifyText]',
      body: {
        document: this.#buildDocument(content, documentType, language, 'languageCode'),
      },
    })
  }

  /**
   * @operationName Moderate Text
   * @category Text Analysis
   * @description Scans the supplied text for potentially harmful or sensitive content and returns a list of safety moderation categories (such as Toxic, Violent, Sexual, Insult, or Profanity), each with a confidence score between 0 and 1. Uses the v2 endpoint.
   * @route POST /moderate-text
   * @appearanceColor #4285F4 #669DF6
   *
   * @paramDef {"type":"String","label":"Text Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to moderate. Provide plain text or HTML markup matching the selected document type."}
   * @paramDef {"type":"String","label":"Document Type","name":"documentType","uiComponent":{"type":"DROPDOWN","options":{"values":["Plain Text","HTML"]}},"description":"How the text content is interpreted. Defaults to Plain Text."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional BCP-47 language code of the text (e.g. en, es, ja). If omitted, the language is auto-detected."}
   *
   * @returns {Object}
   * @sampleResult {"moderationCategories":[{"name":"Toxic","confidence":0.12},{"name":"Insult","confidence":0.05}],"languageCode":"en","languageSupported":true}
   */
  async moderateText(content, documentType, language) {
    return await this.#apiRequest({
      version: 'v2',
      analysisMethod: 'moderateText',
      logTag: '[moderateText]',
      body: {
        document: this.#buildDocument(content, documentType, language, 'languageCode'),
      },
    })
  }

  /**
   * @operationName Annotate Text
   * @category Text Analysis
   * @description Runs multiple analyses on the supplied text in a single request. Enable any combination of entity extraction, document sentiment, text classification, and content moderation via the feature toggles; the response contains only the sections for the enabled features. Note that classification requires at least 20 tokens. Uses the v2 endpoint.
   * @route POST /annotate-text
   * @appearanceColor #4285F4 #669DF6
   *
   * @paramDef {"type":"String","label":"Text Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to analyze. Provide plain text or HTML markup matching the selected document type."}
   * @paramDef {"type":"String","label":"Document Type","name":"documentType","uiComponent":{"type":"DROPDOWN","options":{"values":["Plain Text","HTML"]}},"description":"How the text content is interpreted. Defaults to Plain Text."}
   * @paramDef {"type":"Boolean","label":"Extract Entities","name":"extractEntities","uiComponent":{"type":"CHECKBOX"},"description":"Include entity extraction in the results. Defaults to true."}
   * @paramDef {"type":"Boolean","label":"Extract Document Sentiment","name":"extractDocumentSentiment","uiComponent":{"type":"CHECKBOX"},"description":"Include document-level sentiment in the results. Defaults to true."}
   * @paramDef {"type":"Boolean","label":"Classify Text","name":"classifyText","uiComponent":{"type":"CHECKBOX"},"description":"Include content classification in the results. Requires at least 20 tokens. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Moderate Text","name":"moderateText","uiComponent":{"type":"CHECKBOX"},"description":"Include content safety moderation in the results. Defaults to false."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional BCP-47 language code of the text (e.g. en, es, ja). If omitted, the language is auto-detected."}
   * @paramDef {"type":"String","label":"Encoding Type","name":"encodingType","uiComponent":{"type":"DROPDOWN","options":{"values":["UTF8","UTF16","UTF32","NONE"]}},"description":"Text encoding used to compute the character offsets returned in mentions. Defaults to UTF8."}
   *
   * @returns {Object}
   * @sampleResult {"entities":[{"name":"Google","type":"ORGANIZATION","salience":0.65}],"documentSentiment":{"magnitude":0.8,"score":0.8},"categories":[{"name":"/Computers & Electronics","confidence":0.88}],"moderationCategories":[{"name":"Toxic","confidence":0.02}],"languageCode":"en","languageSupported":true}
   */
  async annotateText(content, documentType, extractEntities, extractDocumentSentiment, classifyText, moderateText, language, encodingType) {
    return await this.#apiRequest({
      version: 'v2',
      analysisMethod: 'annotateText',
      logTag: '[annotateText]',
      body: {
        document: this.#buildDocument(content, documentType, language, 'languageCode'),
        features: {
          extractEntities: extractEntities !== false,
          extractDocumentSentiment: extractDocumentSentiment !== false,
          classifyText: classifyText === true,
          moderateText: moderateText === true,
        },
        encodingType: this.#resolveEncoding(encodingType),
      },
    })
  }

  #resolveEncoding(encodingType) {
    const allowed = ['UTF8', 'UTF16', 'UTF32', 'NONE']

    return allowed.includes(encodingType) ? encodingType : 'UTF8'
  }
}

Flowrunner.ServerCode.addService(GoogleNaturalLanguageService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Google Cloud API key with the Cloud Natural Language API enabled (console.cloud.google.com).',
  },
])
