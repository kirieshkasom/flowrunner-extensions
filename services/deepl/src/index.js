'use strict'

const PRO_API_BASE_URL = 'https://api.deepl.com'
const FREE_API_BASE_URL = 'https://api-free.deepl.com'

const FORMALITY_MAPPING = {
  'Default': 'default',
  'More Formal': 'more',
  'Less Formal': 'less',
  'Prefer More Formal': 'prefer_more',
  'Prefer Less Formal': 'prefer_less',
}

const logger = {
  info: (...args) => console.log('[DeepL] info:', ...args),
  debug: (...args) => console.log('[DeepL] debug:', ...args),
  error: (...args) => console.log('[DeepL] error:', ...args),
  warn: (...args) => console.log('[DeepL] warn:', ...args),
}

/**
 * @usesFileStorage
 * @integrationName DeepL
 * @integrationIcon /icon.svg
 */
class DeepLService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.baseUrl = (config.apiKey || '').trim().endsWith(':fx') ? FREE_API_BASE_URL : PRO_API_BASE_URL
  }

  async #apiRequest({ path, method = 'post', body, form, query, binary, logTag }) {
    const url = `${ this.baseUrl }${ path }`

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)

      let request = Flowrunner.Request[method](url)
        .query(query || {})
        .set({ 'Authorization': `DeepL-Auth-Key ${ this.apiKey }` })

      if (binary) {
        request = request.setEncoding(null).unwrapBody(false)
      }

      if (form) {
        request.form(form)
      } else if (body !== undefined) {
        request = request.set({ 'Content-Type': 'application/json' }).send(body)
      }

      return await request
    } catch (error) {
      const errorMsg = normalizeErrorMessage(error)

      logger.error(`${ logTag } - error: ${ errorMsg }`)

      throw new Error(`DeepL API error: ${ errorMsg }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #extractFileName(url, fallback) {
    const pathname = url.split('?')[0].split('#')[0]

    return decodeURIComponent(pathname.split('/').pop() || fallback)
  }

  async #downloadFile(fileUrl, logTag) {
    if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
      throw new Error(`Invalid fileUrl '${ fileUrl }'. Should start with 'http://' or 'https://'`)
    }

    logger.debug(`${ logTag } - downloading file from: ${ fileUrl }`)

    const rawBytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)

    return Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes)
  }

  #entriesToTsv(entries) {
    return Object.entries(entries)
      .map(([source, target]) => `${ source }\t${ target }`)
      .join('\n')
  }

  #tsvToEntries(tsv) {
    const entries = {}

    for (const line of String(tsv || '').split('\n')) {
      if (!line.trim()) {
        continue
      }

      const [source, ...rest] = line.split('\t')

      entries[source] = rest.join('\t')
    }

    return entries
  }

  async #languagesDictionary(payload, type) {
    const { search } = payload || {}

    let languages = await this.#apiRequest({
      path: '/v2/languages',
      method: 'get',
      query: { type },
      logTag: `${ type }LanguagesDictionary`,
    })

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      languages = languages.filter(language =>
        language.name.toLowerCase().includes(searchLower) || language.language.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: languages.map(language => ({
        label: language.name,
        value: language.language,
        note: language.supports_formality ? 'Supports formality' : undefined,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getTargetLanguagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter languages by name or code."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — DeepL's language list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Target Languages Dictionary
   * @description Provides a searchable, live list of languages DeepL can translate into, for dynamic parameter selection. Languages supporting the formality option are marked.
   * @route POST /get-target-languages-dictionary
   * @paramDef {"type":"getTargetLanguagesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering languages."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"German","value":"DE","note":"Supports formality"},{"label":"English (American)","value":"EN-US"}],"cursor":null}
   */
  async getTargetLanguagesDictionary(payload) {
    return this.#languagesDictionary(payload, 'target')
  }

  /**
   * @typedef {Object} getSourceLanguagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter languages by name or code."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — DeepL's language list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Source Languages Dictionary
   * @description Provides a searchable, live list of languages DeepL can translate from, for dynamic parameter selection.
   * @route POST /get-source-languages-dictionary
   * @paramDef {"type":"getSourceLanguagesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering languages."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"English","value":"EN"},{"label":"Japanese","value":"JA"}],"cursor":null}
   */
  async getSourceLanguagesDictionary(payload) {
    return this.#languagesDictionary(payload, 'source')
  }

  /**
   * @typedef {Object} getGlossariesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter glossaries by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — DeepL's glossary list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Glossaries Dictionary
   * @description Provides a searchable, live list of glossaries in the DeepL account for dynamic parameter selection, showing each glossary's language pairs.
   * @route POST /get-glossaries-dictionary
   * @paramDef {"type":"getGlossariesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering glossaries."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Product Terms","value":"def3a26b-3e84-45b3-84ae-0c0aaf3525f7","note":"EN → DE"}],"cursor":null}
   */
  async getGlossariesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      path: '/v3/glossaries',
      method: 'get',
      logTag: 'getGlossariesDictionary',
    })

    let glossaries = response.glossaries || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      glossaries = glossaries.filter(glossary => (glossary.name || '').toLowerCase().includes(searchLower))
    }

    return {
      items: glossaries.map(glossary => ({
        label: glossary.name,
        value: glossary.glossary_id,
        note: (glossary.dictionaries || [])
          .map(dictionary => `${ dictionary.source_lang.toUpperCase() } → ${ dictionary.target_lang.toUpperCase() }`)
          .join(', '),
      })),
      cursor: null,
    }
  }

  /**
   * @operationName Translate Text
   * @description Translates text into a target language using DeepL's neural machine translation. The source language is auto-detected unless specified. Supports formality control (for supported target languages), custom glossaries, translation context, next-generation quality-optimized models, sentence splitting control, formatting preservation and XML/HTML tag handling. Returns the translated text and the detected source language. Text is limited to 128 KiB per request.
   * @category Translation
   * @route POST /translate-text
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to translate. Up to 128 KiB of UTF-8 text."}
   * @paramDef {"type":"String","label":"Target Language","name":"targetLang","required":true,"dictionary":"getTargetLanguagesDictionary","description":"The language to translate into, e.g. 'DE' or 'EN-US'."}
   * @paramDef {"type":"String","label":"Source Language","name":"sourceLang","dictionary":"getSourceLanguagesDictionary","description":"The language of the input text, e.g. 'EN'. Auto-detected when omitted. Required when a glossary is used."}
   * @paramDef {"type":"String","label":"Formality","name":"formality","uiComponent":{"type":"DROPDOWN","options":{"values":["Default","More Formal","Less Formal","Prefer More Formal","Prefer Less Formal"]}},"defaultValue":"Default","description":"Whether the translation should lean formal or informal. Only some target languages support formality; the 'Prefer' options fall back to default instead of failing for unsupported languages."}
   * @paramDef {"type":"String","label":"Glossary","name":"glossaryId","dictionary":"getGlossariesDictionary","description":"Optional glossary to apply. Requires the Source Language parameter to be set, and the glossary must contain the source/target language pair."}
   * @paramDef {"type":"String","label":"Context","name":"context","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Additional context that influences the translation but is not translated itself and is not billed, e.g. surrounding text or a description of the domain."}
   * @paramDef {"type":"String","label":"Model Type","name":"modelType","uiComponent":{"type":"DROPDOWN","options":{"values":["Latency Optimized","Quality Optimized","Prefer Quality Optimized"]}},"description":"Which translation model to use: 'Latency Optimized' (classic, fastest), 'Quality Optimized' (next-gen model, fails for unsupported language pairs) or 'Prefer Quality Optimized' (next-gen with automatic fallback)."}
   * @paramDef {"type":"Boolean","label":"Preserve Formatting","name":"preserveFormatting","uiComponent":{"type":"TOGGLE"},"description":"When enabled, DeepL respects the original formatting (punctuation and casing) instead of correcting it. Defaults to disabled."}
   * @paramDef {"type":"String","label":"Split Sentences","name":"splitSentences","uiComponent":{"type":"DROPDOWN","options":{"values":["On","Off","No Newlines"]}},"description":"How input is split into sentences: 'On' (default — split on punctuation and newlines), 'Off' (treat input as one sentence) or 'No Newlines' (split on punctuation only, useful for text containing line breaks)."}
   * @paramDef {"type":"String","label":"Tag Handling","name":"tagHandling","uiComponent":{"type":"DROPDOWN","options":{"values":["XML","HTML"]}},"description":"Enables markup-aware translation of XML or HTML content, keeping tags intact. Leave empty for plain text."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Hallo, Welt!","detectedSourceLanguage":"EN","translations":[{"detected_source_language":"EN","text":"Hallo, Welt!"}]}
   */
  async translateText(text, targetLang, sourceLang, formality, glossaryId, context, modelType, preserveFormatting, splitSentences, tagHandling) {
    if (!text || !text.trim()) {
      throw new Error('Text is required')
    }

    if (!targetLang) {
      throw new Error('Target Language is required')
    }

    const body = {
      text: [text],
      target_lang: targetLang,
    }

    if (sourceLang) body.source_lang = sourceLang
    if (glossaryId) body.glossary_id = glossaryId
    if (context) body.context = context
    if (preserveFormatting !== undefined && preserveFormatting !== null) body.preserve_formatting = preserveFormatting

    const resolvedFormality = this.#resolveChoice(formality, FORMALITY_MAPPING)

    if (resolvedFormality && resolvedFormality !== 'default') {
      body.formality = resolvedFormality
    }

    const resolvedModelType = this.#resolveChoice(modelType, {
      'Latency Optimized': 'latency_optimized',
      'Quality Optimized': 'quality_optimized',
      'Prefer Quality Optimized': 'prefer_quality_optimized',
    })

    if (resolvedModelType) body.model_type = resolvedModelType

    const resolvedSplitSentences = this.#resolveChoice(splitSentences, {
      'On': '1', 'Off': '0', 'No Newlines': 'nonewlines',
    })

    if (resolvedSplitSentences) body.split_sentences = resolvedSplitSentences

    const resolvedTagHandling = this.#resolveChoice(tagHandling, { 'XML': 'xml', 'HTML': 'html' })

    if (resolvedTagHandling) body.tag_handling = resolvedTagHandling

    const response = await this.#apiRequest({
      path: '/v2/translate',
      body,
      logTag: 'translateText',
    })

    const translation = response.translations?.[0]

    return {
      text: translation?.text ?? null,
      detectedSourceLanguage: translation?.detected_source_language ?? null,
      translations: response.translations || [],
    }
  }

  /**
   * @operationName Improve Text
   * @description Improves the writing of a text using DeepL Write — fixing grammar, punctuation and phrasing while preserving meaning. Optionally rephrases into a specific writing style (simple, business, academic, casual) OR tone (enthusiastic, friendly, confident, diplomatic) — style and tone are mutually exclusive and cannot be combined in one request. Available for a limited set of languages (e.g. English, German, French, Spanish, Italian, Portuguese). Returns the improved text and the detected source language.
   * @category Writing
   * @route POST /improve-text
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to improve."}
   * @paramDef {"type":"String","label":"Target Language","name":"targetLang","description":"Optional language variant of the output, e.g. 'en-US', 'en-GB', 'de', 'fr'. When omitted, DeepL detects the language and keeps it."}
   * @paramDef {"type":"String","label":"Writing Style","name":"writingStyle","uiComponent":{"type":"DROPDOWN","options":{"values":["Default","Simple","Business","Academic","Casual"]}},"description":"Rewrites the text in the chosen style. Mutually exclusive with Tone — set at most one of the two."}
   * @paramDef {"type":"String","label":"Tone","name":"tone","uiComponent":{"type":"DROPDOWN","options":{"values":["Default","Enthusiastic","Friendly","Confident","Diplomatic"]}},"description":"Rewrites the text with the chosen tone. Mutually exclusive with Writing Style — set at most one of the two."}
   *
   * @returns {Object}
   * @sampleResult {"text":"We appreciate your patience while we resolve this issue.","detectedSourceLanguage":"en","targetLanguage":"en-US","improvements":[{"text":"We appreciate your patience while we resolve this issue.","target_language":"en-US","detected_source_language":"en"}]}
   */
  async improveText(text, targetLang, writingStyle, tone) {
    if (!text || !text.trim()) {
      throw new Error('Text is required')
    }

    const resolvedStyle = this.#resolveChoice(writingStyle, {
      'Default': 'default', 'Simple': 'simple', 'Business': 'business', 'Academic': 'academic', 'Casual': 'casual',
    })
    const resolvedTone = this.#resolveChoice(tone, {
      'Default': 'default', 'Enthusiastic': 'enthusiastic', 'Friendly': 'friendly', 'Confident': 'confident', 'Diplomatic': 'diplomatic',
    })

    if (resolvedStyle && resolvedStyle !== 'default' && resolvedTone && resolvedTone !== 'default') {
      throw new Error('Writing Style and Tone are mutually exclusive — set at most one of the two')
    }

    const body = { text: [text] }

    if (targetLang) body.target_lang = targetLang
    if (resolvedStyle && resolvedStyle !== 'default') body.writing_style = resolvedStyle
    if (resolvedTone && resolvedTone !== 'default') body.tone = resolvedTone

    const response = await this.#apiRequest({
      path: '/v2/write/rephrase',
      body,
      logTag: 'improveText',
    })

    const improvement = response.improvements?.[0]

    return {
      text: improvement?.text ?? null,
      detectedSourceLanguage: improvement?.detected_source_language ?? null,
      targetLanguage: improvement?.target_language ?? null,
      improvements: response.improvements || [],
    }
  }

  /**
   * @operationName Upload Document
   * @description Uploads a document (docx, pptx, xlsx, pdf, srt, txt, html, xlf and more) to DeepL for full-document translation with formatting preserved. Downloads the file from the provided URL (FlowRunner file URL or any public URL) and submits it. Returns a document_id and document_key — keep BOTH values, they are required to check translation status and to download the result. Documents are billed at a minimum of 50,000 characters each.
   * @category Documents
   * @route POST /upload-document
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"URL of the document to translate — a FlowRunner file URL or any public 'http(s)://' URL."}
   * @paramDef {"type":"String","label":"Target Language","name":"targetLang","required":true,"dictionary":"getTargetLanguagesDictionary","description":"The language to translate the document into, e.g. 'DE' or 'EN-US'."}
   * @paramDef {"type":"String","label":"Source Language","name":"sourceLang","dictionary":"getSourceLanguagesDictionary","description":"The language of the document. Auto-detected when omitted. Required when a glossary is used."}
   * @paramDef {"type":"String","label":"Formality","name":"formality","uiComponent":{"type":"DROPDOWN","options":{"values":["Default","More Formal","Less Formal","Prefer More Formal","Prefer Less Formal"]}},"defaultValue":"Default","description":"Whether the translation should lean formal or informal. Only some target languages support formality; the 'Prefer' options fall back to default instead of failing for unsupported languages."}
   * @paramDef {"type":"String","label":"Glossary","name":"glossaryId","dictionary":"getGlossariesDictionary","description":"Optional glossary to apply. Requires the Source Language parameter to be set."}
   * @paramDef {"type":"String","label":"Output Format","name":"outputFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["DOCX","PPTX","XLSX","PDF","HTML","TXT"]}},"description":"Optional file format conversion for the translated document (e.g. translate a PDF into an editable DOCX). Leave empty to keep the original format."}
   *
   * @returns {Object}
   * @sampleResult {"document_id":"04DE5AD98A02647D83285A36021911C6","document_key":"0CB0054F1C132C1625B392EADDA41CB754A742822F6877173029A6C8D190A3DF"}
   */
  async uploadDocument(fileUrl, targetLang, sourceLang, formality, glossaryId, outputFormat) {
    if (!targetLang) {
      throw new Error('Target Language is required')
    }

    const fileBuffer = await this.#downloadFile(fileUrl, 'uploadDocument')

    const form = new Flowrunner.Request.FormData()

    form.append('file', fileBuffer, { filename: this.#extractFileName(fileUrl, `document_${ Date.now() }`) })
    form.append('target_lang', targetLang)

    if (sourceLang) form.append('source_lang', sourceLang)
    if (glossaryId) form.append('glossary_id', glossaryId)

    const resolvedFormality = this.#resolveChoice(formality, FORMALITY_MAPPING)

    if (resolvedFormality && resolvedFormality !== 'default') {
      form.append('formality', resolvedFormality)
    }

    const resolvedOutputFormat = this.#resolveChoice(outputFormat, {
      'DOCX': 'docx', 'PPTX': 'pptx', 'XLSX': 'xlsx', 'PDF': 'pdf', 'HTML': 'html', 'TXT': 'txt',
    })

    if (resolvedOutputFormat) form.append('output_format', resolvedOutputFormat)

    return this.#apiRequest({
      path: '/v2/document',
      form,
      logTag: 'uploadDocument',
    })
  }

  /**
   * @operationName Get Document Status
   * @description Checks the translation status of a previously uploaded document. Returns the status ('queued', 'translating', 'done' or 'error'), the estimated seconds remaining while translating, the billed character count once done, and an error message if the translation failed. Poll this until the status is 'done', then use Download Translated Document.
   * @category Documents
   * @route POST /get-document-status
   *
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"The document_id returned by Upload Document."}
   * @paramDef {"type":"String","label":"Document Key","name":"documentKey","required":true,"description":"The document_key returned by Upload Document."}
   *
   * @returns {Object}
   * @sampleResult {"document_id":"04DE5AD98A02647D83285A36021911C6","status":"done","billed_characters":1337}
   */
  async getDocumentStatus(documentId, documentKey) {
    if (!documentId || !documentKey) {
      throw new Error('Document ID and Document Key are required')
    }

    return this.#apiRequest({
      path: `/v2/document/${ encodeURIComponent(documentId) }`,
      body: { document_key: documentKey },
      logTag: 'getDocumentStatus',
    })
  }

  /**
   * @operationName Download Translated Document
   * @description Downloads the translated document once its status is 'done' (check with Get Document Status first), saves it to FlowRunner file storage and returns its URL. Each translated document can only be downloaded for a limited time after translation completes.
   * @category Documents
   * @route POST /download-translated-document
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"The document_id returned by Upload Document."}
   * @paramDef {"type":"String","label":"Document Key","name":"documentKey","required":true,"description":"The document_key returned by Upload Document."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://example.com/files/automation/tmp/report_translated.docx","filename":"report_translated.docx"}
   */
  async downloadTranslatedDocument(documentId, documentKey, fileOptions) {
    if (!documentId || !documentKey) {
      throw new Error('Document ID and Document Key are required')
    }

    const response = await this.#apiRequest({
      path: `/v2/document/${ encodeURIComponent(documentId) }/result`,
      body: { document_key: documentKey },
      binary: true,
      logTag: 'downloadTranslatedDocument',
    })

    const rawBytes = response?.body !== undefined ? response.body : response
    const buffer = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes)

    const disposition = response?.headers?.['content-disposition'] || ''
    const dispositionMatch = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)
    const filename = dispositionMatch
      ? decodeURIComponent(dispositionMatch[1].trim())
      : `deepl_document_${ Date.now() }`

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { fileURL: url, filename }
  }

  /**
   * @operationName Create Glossary
   * @description Creates a multilingual glossary (v3) that enforces custom term translations during text and document translation. Provide the glossary name, the source and target language of the entries, and the entries as an object mapping source terms to target terms, e.g. {"artist":"Künstler"}. Advanced: pass a raw Dictionaries array instead to create multiple language pairs at once. Returns the created glossary with its glossary_id.
   * @category Glossaries
   * @route POST /create-glossary
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the glossary."}
   * @paramDef {"type":"String","label":"Source Language","name":"sourceLang","dictionary":"getSourceLanguagesDictionary","description":"The language of the entry source terms, e.g. 'EN'. Required unless a raw Dictionaries array is provided."}
   * @paramDef {"type":"String","label":"Target Language","name":"targetLang","dictionary":"getTargetLanguagesDictionary","description":"The language of the entry target terms, e.g. 'DE'. Required unless a raw Dictionaries array is provided."}
   * @paramDef {"type":"Object","label":"Entries","name":"entries","description":"Glossary entries as an object mapping source terms to target terms, e.g. {\"artist\":\"Künstler\",\"prize\":\"Gewinn\"}. Required unless a raw Dictionaries array is provided."}
   * @paramDef {"type":"Array<Object>","label":"Dictionaries","name":"dictionaries","description":"Advanced: raw DeepL v3 dictionaries array for multiple language pairs, e.g. [{\"source_lang\":\"en\",\"target_lang\":\"de\",\"entries\":\"artist\\tKünstler\",\"entries_format\":\"tsv\"}]. Overrides Source Language, Target Language and Entries when provided."}
   *
   * @returns {Object}
   * @sampleResult {"glossary_id":"def3a26b-3e84-45b3-84ae-0c0aaf3525f7","name":"Product Terms","dictionaries":[{"source_lang":"en","target_lang":"de","entry_count":2}],"creation_time":"2026-07-13T14:58:58.741Z"}
   */
  async createGlossary(name, sourceLang, targetLang, entries, dictionaries) {
    if (!name || !name.trim()) {
      throw new Error('Name is required')
    }

    let resolvedDictionaries = dictionaries

    if (!resolvedDictionaries?.length) {
      if (!sourceLang || !targetLang || !entries || !Object.keys(entries).length) {
        throw new Error('Source Language, Target Language and Entries are required (or provide a raw Dictionaries array)')
      }

      resolvedDictionaries = [{
        source_lang: sourceLang,
        target_lang: targetLang,
        entries: this.#entriesToTsv(entries),
        entries_format: 'tsv',
      }]
    }

    return this.#apiRequest({
      path: '/v3/glossaries',
      body: { name, dictionaries: resolvedDictionaries },
      logTag: 'createGlossary',
    })
  }

  /**
   * @operationName List Glossaries
   * @description Lists all glossaries in the DeepL account with their IDs, names, language-pair dictionaries and entry counts.
   * @category Glossaries
   * @route GET /list-glossaries
   *
   * @returns {Object}
   * @sampleResult {"glossaries":[{"glossary_id":"def3a26b-3e84-45b3-84ae-0c0aaf3525f7","name":"Product Terms","dictionaries":[{"source_lang":"en","target_lang":"de","entry_count":2}],"creation_time":"2026-07-13T14:58:58.741Z"}]}
   */
  async listGlossaries() {
    return this.#apiRequest({
      path: '/v3/glossaries',
      method: 'get',
      logTag: 'listGlossaries',
    })
  }

  /**
   * @operationName Get Glossary
   * @description Retrieves the metadata of a glossary by its ID, including its name, language-pair dictionaries, entry counts and creation time. Use Get Glossary Entries to fetch the actual term pairs.
   * @category Glossaries
   * @route GET /get-glossary
   *
   * @paramDef {"type":"String","label":"Glossary","name":"glossaryId","required":true,"dictionary":"getGlossariesDictionary","description":"The glossary to fetch. Pick from the list or paste a glossary ID."}
   *
   * @returns {Object}
   * @sampleResult {"glossary_id":"def3a26b-3e84-45b3-84ae-0c0aaf3525f7","name":"Product Terms","dictionaries":[{"source_lang":"en","target_lang":"de","entry_count":2}],"creation_time":"2026-07-13T14:58:58.741Z"}
   */
  async getGlossary(glossaryId) {
    if (!glossaryId) {
      throw new Error('Glossary ID is required')
    }

    return this.#apiRequest({
      path: `/v3/glossaries/${ encodeURIComponent(glossaryId) }`,
      method: 'get',
      logTag: 'getGlossary',
    })
  }

  /**
   * @operationName Get Glossary Entries
   * @description Retrieves the term pairs of one language-pair dictionary in a glossary. Returns both the raw TSV entries as provided by DeepL and a convenient parsed object mapping source terms to target terms.
   * @category Glossaries
   * @route GET /get-glossary-entries
   *
   * @paramDef {"type":"String","label":"Glossary","name":"glossaryId","required":true,"dictionary":"getGlossariesDictionary","description":"The glossary whose entries to fetch. Pick from the list or paste a glossary ID."}
   * @paramDef {"type":"String","label":"Source Language","name":"sourceLang","required":true,"dictionary":"getSourceLanguagesDictionary","description":"The source language of the dictionary to read, e.g. 'EN'."}
   * @paramDef {"type":"String","label":"Target Language","name":"targetLang","required":true,"dictionary":"getTargetLanguagesDictionary","description":"The target language of the dictionary to read, e.g. 'DE'."}
   *
   * @returns {Object}
   * @sampleResult {"sourceLang":"en","targetLang":"de","entries":{"artist":"Künstler","prize":"Gewinn"},"entriesTsv":"artist\tKünstler\nprize\tGewinn","dictionaries":[{"source_lang":"en","target_lang":"de","entries":"artist\tKünstler\nprize\tGewinn","entries_format":"tsv"}]}
   */
  async getGlossaryEntries(glossaryId, sourceLang, targetLang) {
    if (!glossaryId || !sourceLang || !targetLang) {
      throw new Error('Glossary ID, Source Language and Target Language are required')
    }

    const response = await this.#apiRequest({
      path: `/v3/glossaries/${ encodeURIComponent(glossaryId) }/entries`,
      method: 'get',
      query: { source_lang: sourceLang, target_lang: targetLang },
      logTag: 'getGlossaryEntries',
    })

    const dictionary = response.dictionaries?.[0]

    return {
      sourceLang: dictionary?.source_lang ?? sourceLang,
      targetLang: dictionary?.target_lang ?? targetLang,
      entries: this.#tsvToEntries(dictionary?.entries),
      entriesTsv: dictionary?.entries ?? '',
      dictionaries: response.dictionaries || [],
    }
  }

  /**
   * @operationName Edit Glossary
   * @description Updates a glossary (v3): rename it and/or replace the entries of one language-pair dictionary. Provide a new name, or the source/target language pair plus an entries object — the entries fully REPLACE the existing entries of that language pair. Returns the updated glossary metadata.
   * @category Glossaries
   * @route PATCH /edit-glossary
   *
   * @paramDef {"type":"String","label":"Glossary","name":"glossaryId","required":true,"dictionary":"getGlossariesDictionary","description":"The glossary to edit. Pick from the list or paste a glossary ID."}
   * @paramDef {"type":"String","label":"New Name","name":"name","description":"Optional new name for the glossary."}
   * @paramDef {"type":"String","label":"Source Language","name":"sourceLang","dictionary":"getSourceLanguagesDictionary","description":"The source language of the dictionary to replace, e.g. 'EN'. Required when Entries is provided."}
   * @paramDef {"type":"String","label":"Target Language","name":"targetLang","dictionary":"getTargetLanguagesDictionary","description":"The target language of the dictionary to replace, e.g. 'DE'. Required when Entries is provided."}
   * @paramDef {"type":"Object","label":"Entries","name":"entries","description":"Replacement entries as an object mapping source terms to target terms, e.g. {\"artist\":\"Künstler\"}. Fully replaces the existing entries of the language pair."}
   *
   * @returns {Object}
   * @sampleResult {"glossary_id":"def3a26b-3e84-45b3-84ae-0c0aaf3525f7","name":"Product Terms v2","dictionaries":[{"source_lang":"en","target_lang":"de","entry_count":3}],"creation_time":"2026-07-13T14:58:58.741Z"}
   */
  async editGlossary(glossaryId, name, sourceLang, targetLang, entries) {
    if (!glossaryId) {
      throw new Error('Glossary ID is required')
    }

    const body = {}

    if (name && name.trim()) {
      body.name = name
    }

    if (entries && Object.keys(entries).length) {
      if (!sourceLang || !targetLang) {
        throw new Error('Source Language and Target Language are required when replacing entries')
      }

      body.dictionaries = [{
        source_lang: sourceLang,
        target_lang: targetLang,
        entries: this.#entriesToTsv(entries),
        entries_format: 'tsv',
      }]
    }

    if (!Object.keys(body).length) {
      throw new Error('Nothing to update — provide a New Name and/or replacement Entries')
    }

    return this.#apiRequest({
      path: `/v3/glossaries/${ encodeURIComponent(glossaryId) }`,
      method: 'patch',
      body,
      logTag: 'editGlossary',
    })
  }

  /**
   * @operationName Delete Glossary
   * @description Permanently deletes a glossary and all of its language-pair dictionaries by its ID. Returns a deletion confirmation.
   * @category Glossaries
   * @route DELETE /delete-glossary
   *
   * @paramDef {"type":"String","label":"Glossary","name":"glossaryId","required":true,"dictionary":"getGlossariesDictionary","description":"The glossary to delete. Pick from the list or paste a glossary ID."}
   *
   * @returns {Object}
   * @sampleResult {"glossaryId":"def3a26b-3e84-45b3-84ae-0c0aaf3525f7","deleted":true}
   */
  async deleteGlossary(glossaryId) {
    if (!glossaryId) {
      throw new Error('Glossary ID is required')
    }

    await this.#apiRequest({
      path: `/v3/glossaries/${ encodeURIComponent(glossaryId) }`,
      method: 'delete',
      logTag: 'deleteGlossary',
    })

    return { glossaryId, deleted: true }
  }

  /**
   * @operationName List Source Languages
   * @description Lists all languages DeepL can translate from, with their language codes and names.
   * @category Languages
   * @route GET /list-source-languages
   *
   * @returns {Array<Object>}
   * @sampleResult [{"language":"EN","name":"English"},{"language":"DE","name":"German"},{"language":"JA","name":"Japanese"}]
   */
  async listSourceLanguages() {
    return this.#apiRequest({
      path: '/v2/languages',
      method: 'get',
      query: { type: 'source' },
      logTag: 'listSourceLanguages',
    })
  }

  /**
   * @operationName List Target Languages
   * @description Lists all languages DeepL can translate into, with their language codes, names and whether they support the formality option.
   * @category Languages
   * @route GET /list-target-languages
   *
   * @returns {Array<Object>}
   * @sampleResult [{"language":"DE","name":"German","supports_formality":true},{"language":"EN-US","name":"English (American)","supports_formality":false}]
   */
  async listTargetLanguages() {
    return this.#apiRequest({
      path: '/v2/languages',
      method: 'get',
      query: { type: 'target' },
      logTag: 'listTargetLanguages',
    })
  }

  /**
   * @operationName Get Usage
   * @description Retrieves the current billing-period usage of the DeepL account: characters translated so far and the character limit of the plan.
   * @category Account
   * @route GET /get-usage
   *
   * @returns {Object}
   * @sampleResult {"character_count":180118,"character_limit":500000}
   */
  async getUsage() {
    return this.#apiRequest({
      path: '/v2/usage',
      method: 'get',
      logTag: 'getUsage',
    })
  }
}

Flowrunner.ServerCode.addService(DeepLService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your DeepL API key from https://www.deepl.com/your-account/keys. Free plan keys end with ":fx" — the correct API base URL (free or pro) is picked automatically.',
  },
])

function normalizeErrorMessage(error) {
  if (error.body?.message) {
    return [error.body.message, error.body.detail].filter(Boolean).join(' — ')
  }

  if (error.message && typeof error.message === 'object') {
    return JSON.stringify(error.message)
  }

  return error.message || 'API request failed'
}
