const logger = {
  info: (...args) => console.log('[Perspective] info:', ...args),
  debug: (...args) => console.log('[Perspective] debug:', ...args),
  error: (...args) => console.log('[Perspective] error:', ...args),
  warn: (...args) => console.log('[Perspective] warn:', ...args),
}

const API_BASE_URL = 'https://commentanalyzer.googleapis.com/v1alpha1'

const DEFAULT_LANGUAGES = ['en']

// All attributes exposed by the service, with friendly dropdown labels mapped
// to the raw Perspective attribute names submitted to the API.
const ATTRIBUTE_LABEL_TO_NAME = {
  'Toxicity': 'TOXICITY',
  'Severe Toxicity': 'SEVERE_TOXICITY',
  'Identity Attack': 'IDENTITY_ATTACK',
  'Insult': 'INSULT',
  'Profanity': 'PROFANITY',
  'Threat': 'THREAT',
  'Sexually Explicit': 'SEXUALLY_EXPLICIT',
  'Flirtation': 'FLIRTATION',
}

const DEFAULT_ATTRIBUTES = ['Toxicity']

function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @integrationName Perspective
 * @integrationIcon /icon.png
 */
class PerspectiveService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Maps a friendly attribute label (or a raw attribute name passed through) to
  // the raw Perspective attribute name.
  #resolveAttribute(value) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(ATTRIBUTE_LABEL_TO_NAME, value)
      ? ATTRIBUTE_LABEL_TO_NAME[value]
      : value
  }

  // Builds the requestedAttributes object ({ NAME: {} }) from a list of selected
  // attribute labels. Falls back to TOXICITY when nothing is selected.
  #buildRequestedAttributes(attributes) {
    const list = Array.isArray(attributes) && attributes.length ? attributes : DEFAULT_ATTRIBUTES
    const requested = {}

    for (const attr of list) {
      const name = this.#resolveAttribute(attr)

      if (name) {
        requested[name] = {}
      }
    }

    return requested
  }

  // Single private request helper — all Perspective calls go through here.
  async #apiRequest({ path, body, logTag }) {
    const url = `${ API_BASE_URL }${ path }`

    try {
      logger.debug(`${ logTag } - [POST::${ url }]`)

      const request = Flowrunner.Request.post(url)
        .set({ 'Content-Type': 'application/json' })
        .query({ key: this.apiKey })

      return await request.send(body)
    } catch (error) {
      const apiError = error.body?.error
      const message = apiError?.message || error.message
      const status = apiError?.status || error.status || error.statusCode

      logger.error(`${ logTag } - failed (${ status || 'unknown' }): ${ message }`)

      throw new Error(`Perspective API error: ${ message }`)
    }
  }

  /**
   * @operationName Analyze Comment
   * @category Analysis
   * @description Analyzes a piece of text for a set of attributes such as toxicity, insults, threats, and profanity using Google's Perspective Comment Analyzer API. Returns per-attribute scores, each with a summaryScore (a probability from 0 to 1 that the attribute applies) and, when span annotations are enabled, per-sentence spanScores. Select one or more attributes to score; TOXICITY, SEVERE_TOXICITY, IDENTITY_ATTACK, INSULT, PROFANITY, and THREAT are production attributes with broader language support, while SEXUALLY_EXPLICIT and FLIRTATION are experimental and English-only. Not every attribute supports every language; requesting an unsupported combination returns a LANGUAGE_NOT_SUPPORTED_BY_ATTRIBUTE error, and text over the API limit returns COMMENT_TOO_LONG. By default doNotStore is true so submitted text is not retained by Google for research.
   * @route POST /comments:analyze
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The comment text to analyze (PLAIN_TEXT). Must be within the Perspective length limit or the request fails with COMMENT_TOO_LONG."}
   * @paramDef {"type":"Array<String>","label":"Attributes","name":"attributes","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Toxicity","Severe Toxicity","Identity Attack","Insult","Profanity","Threat","Sexually Explicit","Flirtation"]}},"description":"One or more attributes to score. Sexually Explicit and Flirtation are experimental and English-only. Defaults to Toxicity."}
   * @paramDef {"type":"Array<String>","label":"Languages","name":"languages","description":"ISO 639-1 language codes of the text (e.g. en, es, fr). Leave empty to let Perspective auto-detect, or set explicitly. Defaults to [\"en\"]. An attribute that does not support the given language returns LANGUAGE_NOT_SUPPORTED_BY_ATTRIBUTE."}
   * @paramDef {"type":"Boolean","label":"Do Not Store","name":"doNotStore","uiComponent":{"type":"TOGGLE"},"description":"When true (default), Google does not store the submitted text for future research. Set false only if you have permission to share the comment."}
   * @paramDef {"type":"Boolean","label":"Span Annotations","name":"spanAnnotations","uiComponent":{"type":"TOGGLE"},"description":"When true, the response includes spanScores giving scores for individual spans (sentences) of the text in addition to the overall summaryScore."}
   *
   * @returns {Object}
   * @sampleResult {"attributeScores":{"TOXICITY":{"spanScores":[{"begin":0,"end":24,"score":{"value":0.91,"type":"PROBABILITY"}}],"summaryScore":{"value":0.91,"type":"PROBABILITY"}}},"languages":["en"],"detectedLanguages":["en"]}
   */
  async analyzeComment(text, attributes, languages, doNotStore, spanAnnotations) {
    const logTag = '[analyzeComment]'

    const body = {
      comment: {
        text,
        type: 'PLAIN_TEXT',
      },
      languages: Array.isArray(languages) && languages.length ? languages : DEFAULT_LANGUAGES,
      requestedAttributes: this.#buildRequestedAttributes(attributes),
      doNotStore: doNotStore === undefined ? true : doNotStore,
      spanAnnotations: spanAnnotations === true,
    }

    return await this.#apiRequest({
      logTag,
      path: '/comments:analyze',
      body,
    })
  }

  /**
   * @operationName Suggest Comment Score
   * @category Feedback
   * @description Submits a suggested score for a comment to provide feedback to the Perspective models (the SuggestCommentScore method). Use this to tell Perspective what score you believe an attribute should have for a given piece of text — for example, flagging a comment the model mis-scored. Provide the comment text, the attribute to give feedback on, and the suggested summary score (a probability from 0 to 1). This does not return attribute scores; it acknowledges receipt of the feedback and helps improve the models over time.
   * @route POST /comments:suggestscore
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The comment text the suggested score applies to."}
   * @paramDef {"type":"String","label":"Attribute","name":"attribute","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Toxicity","Severe Toxicity","Identity Attack","Insult","Profanity","Threat","Sexually Explicit","Flirtation"]}},"description":"The attribute to submit feedback for. Sexually Explicit and Flirtation are experimental and English-only."}
   * @paramDef {"type":"Number","label":"Suggested Score","name":"suggestedScore","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The suggested summary score for the attribute, a probability between 0 and 1 (e.g. 0.9 to indicate the text strongly exhibits the attribute)."}
   * @paramDef {"type":"Array<String>","label":"Languages","name":"languages","description":"ISO 639-1 language codes of the text (e.g. en, es). Defaults to [\"en\"]."}
   *
   * @returns {Object}
   * @sampleResult {"clientToken":"","detectedLanguages":["en"]}
   */
  async suggestCommentScore(text, attribute, suggestedScore, languages) {
    const logTag = '[suggestCommentScore]'

    const attributeName = this.#resolveAttribute(attribute)

    const body = {
      comment: { text },
      attributeScores: {
        [attributeName]: {
          summaryScore: { value: suggestedScore },
        },
      },
      languages: Array.isArray(languages) && languages.length ? languages : DEFAULT_LANGUAGES,
    }

    return await this.#apiRequest({
      logTag,
      path: '/comments:suggestscore',
      body: clean(body),
    })
  }
}

Flowrunner.ServerCode.addService(PerspectiveService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Google Cloud API key with the Perspective Comment Analyzer API enabled. Access must be requested at https://developers.perspectiveapi.com. Sent as the ?key= query parameter.',
  },
])
