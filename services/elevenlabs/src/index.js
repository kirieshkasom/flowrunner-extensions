'use strict'

const API_BASE_URL = 'https://api.elevenlabs.io/'

const logger = {
  info: (...args) => console.log('[ElevenLabs Service] info:', ...args),
  debug: (...args) => console.log('[ElevenLabs Service] debug:', ...args),
  error: (...args) => console.log('[ElevenLabs Service] error:', ...args),
  warn: (...args) => console.log('[ElevenLabs Service] warn:', ...args),
}

/**
 * @usesFileStorage
 * @integrationName ElevenLabs
 * @integrationIcon /icon.png
 */
class ElevenLabsService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #downloadFile(url) {
    try {
      const response = await Flowrunner.Request.get(url).setEncoding(null).unwrapBody(false)

      return response.body
    } catch (error) {
      error = normalizeError(error)

      logger.error(`Failed to download file from ${ url }: ${ error.message }`)

      throw new Error(`Failed to download file: ${ error.message }`)
    }
  }

  async #apiRequest({ url, method, query, body, binary = false, multipart = false, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method }] ${ API_BASE_URL + url }`)

      let request = Flowrunner.Request[method.toLowerCase()](API_BASE_URL + url)

      if (binary) {
        request = request.setEncoding(null).unwrapBody(false)
      }

      request = request.set({ 'xi-api-key': this.apiKey })

      if (query) {
        request = request.query(query)
      }

      if (body) {
        if (multipart) {
          request.form(body)
          request.set({ 'Content-Type': 'multipart/form-data' })
        } else {
          request = request.set({ 'Content-Type': 'application/json' }).send(body)
        }
      }

      const response = await request

      return binary && response.body ? response.body : response
    } catch (error) {
      error = normalizeError(error)

      const errorMsg = error.message || 'API request failed'

      logger.error(`${ logTag } - error: ${ errorMsg }`)

      throw new Error(errorMsg)
    }
  }

  /**
   * @operationName Text to Speech
   * @category Audio Generation
   * @description Converts text to speech using ElevenLabs AI voice synthesis. Generates high-quality, natural-sounding audio from text input with customizable voice selection and model options. The audio file is saved to file storage and the file URL is returned.
   * @route POST /text-to-speech
   *
   * @appearanceColor #6366F1 #818CF8
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content to convert to speech. Maximum length depends on your subscription tier."}
   * @paramDef {"type":"String","label":"Voice","name":"voiceId","required":true,"dictionary":"getVoicesDictionary","description":"The voice to use for speech synthesis. Select from available voices in your account."}
   * @paramDef {"type":"String","label":"Model","name":"modelId","dictionary":"getModelsDictionary","description":"The model to use for text-to-speech generation. Defaults to 'eleven_turbo_v2_5' if not specified. This model offers fast, high-quality speech synthesis."}
   * @paramDef {"type":"Number","label":"Stability","name":"stability","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Voice stability setting between 0 and 1. Higher values make the voice more consistent but less expressive. Typical range is 0.3 to 0.7."}
   * @paramDef {"type":"Number","label":"Similarity Boost","name":"similarityBoost","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Similarity boost setting between 0 and 1. Higher values enhance voice similarity to the original but may reduce clarity. Typical range is 0.5 to 0.9."}
   * @paramDef {"type":"Number","label":"Style","name":"style","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Style exaggeration setting between 0 and 1. Higher values increase expressiveness and emotion in the voice."}
   * @paramDef {"type":"Boolean","label":"Use Speaker Boost","name":"useSpeakerBoost","uiComponent":{"type":"TOGGLE"},"description":"Enable speaker boost for improved voice clarity and quality. Recommended for most use cases."}
   * @paramDef {"type":"String","label":"Language Code","name":"languageCode","description":"ISO language code (e.g., 'en', 'es', 'fr') to optimize pronunciation for multilingual models."}
   * @paramDef {"type":"String","label":"Output Format","name":"outputFormat","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"mp3_44100_128","label":"MP3 44.1 kHz 128 kbps"},{"value":"mp3_44100_192","label":"MP3 44.1 kHz 192 kbps"},{"value":"pcm_16000","label":"PCM 16 kHz"},{"value":"pcm_22050","label":"PCM 22.05 kHz"},{"value":"pcm_24000","label":"PCM 24 kHz"},{"value":"pcm_44100","label":"PCM 44.1 kHz"},{"value":"ulaw_8000","label":"u-law 8 kHz"}]}},"description":"Audio output format. Defaults to 'mp3_44100_128'. PCM formats provide uncompressed audio."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"audioUrl":"https://files.example.com/elevenlabs/audio_1234567890.mp3"}
   */
  async textToSpeech(text, voiceId, modelId, stability, similarityBoost, style, useSpeakerBoost, languageCode, outputFormat, fileOptions) {
    const requestBody = {
      text,
      model_id: modelId || 'eleven_turbo_v2_5',
    }

    if (stability !== undefined || similarityBoost !== undefined || style !== undefined || useSpeakerBoost !== undefined) {
      requestBody.voice_settings = {}

      if (stability !== undefined) {
        if (stability < 0 || stability > 1) throw new Error('Stability must be between 0 and 1')
        requestBody.voice_settings.stability = stability
      }

      if (similarityBoost !== undefined) {
        if (similarityBoost < 0 || similarityBoost > 1) throw new Error('Similarity boost must be between 0 and 1')
        requestBody.voice_settings.similarity_boost = similarityBoost
      }

      if (style !== undefined) {
        if (style < 0 || style > 1) throw new Error('Style must be between 0 and 1')
        requestBody.voice_settings.style = style
      }

      if (useSpeakerBoost !== undefined) {
        requestBody.voice_settings.use_speaker_boost = useSpeakerBoost
      }
    }

    if (languageCode !== undefined && languageCode !== null) {
      requestBody.language_code = languageCode
    }

    const query = {}

    if (outputFormat !== undefined && outputFormat !== null) {
      query.output_format = outputFormat
    }

    const audioBuffer = await this.#apiRequest({
      url: `v1/text-to-speech/${ voiceId }`,
      method: 'post',
      body: requestBody,
      query: Object.keys(query).length > 0 ? query : undefined,
      binary: true,
      logTag: 'textToSpeech',
    })

    let fileExtension = 'mp3'

    if (outputFormat && outputFormat.startsWith('pcm')) {
      fileExtension = 'pcm'
    } else if (outputFormat && outputFormat.startsWith('ulaw')) {
      fileExtension = 'ulaw'
    }

    const result = await this.flowrunner.Files.uploadFile(audioBuffer, {
      filename: `audio_${ Date.now() }.${ fileExtension }`,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { audioUrl: result.url }
  }

  /**
   * @operationName Get User Info
   * @category Account
   * @description Retrieves information about your ElevenLabs account including subscription tier, character quota, and usage statistics. Use this to monitor your API usage and remaining credits.
   * @route POST /get-user-info
   *
   * @appearanceColor #6366F1 #818CF8
   *
   * @returns {Object}
   * @sampleResult {"user_id":"LTQcj5miL9RB1bSj49R7gjdhDyf1","subscription":{"tier":"free","character_count":264,"character_limit":10000,"can_extend_character_limit":false,"next_character_count_reset_unix":1762571130,"voice_limit":3,"professional_voice_limit":0,"can_use_instant_voice_cloning":false,"can_use_professional_voice_cloning":false,"status":"free","billing_period":"monthly_period","character_refresh_period":"monthly_period"},"is_new_user":true}
   */
  async getUserInfo() {
    return await this.#apiRequest({
      url: 'v1/user',
      method: 'get',
      logTag: 'getUserInfo',
    })
  }

  /**
   * @operationName Delete Voice
   * @category Voice Management
   * @description Deletes a custom voice from your ElevenLabs account. Only custom voices you have created can be deleted. Pre-made voices cannot be removed. Use this to manage your voice library and stay within voice limits.
   * @route POST /delete-voice
   *
   * @appearanceColor #EF4444 #F87171
   *
   * @paramDef {"type":"String","label":"Voice ID","name":"voiceId","required":true,"dictionary":"getVoicesDictionary","description":"The unique identifier of the voice to delete. Only custom voices can be deleted."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"voiceId":"21m00Tcm4TlvDq8ikWAM","message":"Voice deleted successfully"}
   */
  async deleteVoice(voiceId) {
    await this.#apiRequest({
      url: `v1/voices/${ voiceId }`,
      method: 'delete',
      logTag: 'deleteVoice',
    })

    return {
      success: true,
      voiceId,
      message: 'Voice deleted successfully',
    }
  }

  /**
   * @typedef {Object} getVoicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter voices by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Voices Dictionary
   * @description Provides a searchable list of available voices for dynamic parameter selection in text-to-speech operations.
   * @route POST /get-voices-dictionary
   * @paramDef {"type":"getVoicesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering voices."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Rachel (premade)","value":"21m00Tcm4TlvDq8ikWAM","note":"Category: premade"},{"label":"Domi (premade)","value":"AZnzlk1XvdvUeBnXmlld","note":"Category: premade"}],"cursor":null}
   */
  async getVoicesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: 'v1/voices',
      method: 'get',
      logTag: 'getVoicesDictionary',
    })

    let voices = response.voices || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()
      voices = voices.filter(voice => voice.name.toLowerCase().includes(searchLower))
    }

    return {
      items: voices.map(voice => ({
        label: `${ voice.name } (${ voice.category || 'custom' })`,
        value: voice.voice_id,
        note: `Category: ${ voice.category || 'custom' }`,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Models Dictionary
   * @description Provides a searchable list of available text-to-speech models for dynamic parameter selection. Different models offer varying quality and language support.
   * @route POST /get-models-dictionary
   * @paramDef {"type":"getModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Eleven Monolingual v1","value":"eleven_monolingual_v1","note":"English only"},{"label":"Eleven Multilingual v1","value":"eleven_multilingual_v1","note":"Multiple languages"},{"label":"Eleven Multilingual v2","value":"eleven_multilingual_v2","note":"Enhanced multilingual"}],"cursor":null}
   */
  async getModelsDictionary(payload) {
    const { search } = payload || {}

    const models = await this.#apiRequest({
      url: 'v1/models',
      method: 'get',
      logTag: 'getModelsDictionary',
    })

    let filteredModels = models || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      filteredModels = filteredModels.filter(model =>
        model.name.toLowerCase().includes(searchLower) ||
        model.model_id.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: filteredModels.map(model => ({
        label: model.name,
        value: model.model_id,
        note: model.description || model.model_id,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getHistoryDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter history items by their spoken text or voice name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get History Dictionary
   * @description Provides a searchable list of past generations so a history item can be picked by its text and voice instead of pasting an ID.
   * @route POST /get-history-dictionary
   * @paramDef {"type":"getHistoryDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string and pagination cursor for retrieving and filtering history items."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Rachel: Hello world","value":"VW7YKqPnjY4h39yTbx2L","note":"Rachel"}],"cursor":null}
   */
  async getHistoryDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: 'v1/history',
      method: 'get',
      logTag: 'getHistoryDictionary',
    })

    let history = response.history || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      history = history.filter(item =>
        (item.text || '').toLowerCase().includes(searchLower) ||
        (item.voice_name || '').toLowerCase().includes(searchLower)
      )
    }

    return {
      items: history.map(item => ({
        label: `${ item.voice_name || 'Unknown voice' }: ${ (item.text || '').slice(0, 60) }`,
        value: item.history_item_id,
        note: item.voice_name || '',
      })),
      cursor: null,
    }
  }

  /**
   * @operationName Speech to Text
   * @category Audio Processing
   * @description Converts audio from a file URL to text transcription using ElevenLabs speech recognition. Supports multiple audio formats including MP3, WAV, and more.
   * @route POST /speech-to-text
   *
   * @appearanceColor #10B981 #34D399
   *
   * @paramDef {"type":"String","label":"Audio File URL","name":"audioFileUrl","required":true,"description":"The URL of the audio file to transcribe. Must be a publicly accessible URL pointing to an audio file."}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"The model to use for speech-to-text transcription.","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"scribe_v1","label":"Scribe v1"}]}}}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Language code for the audio (e.g., 'en', 'es', 'fr'). Auto-detected if not specified."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Hello, this is a sample transcription of the audio file.","audio_duration":5.2}
   */
  async speechToText(audioFileUrl, model, language) {
    const formData = new Flowrunner.Request.FormData()

    formData.append('model_id', model || 'scribe_v1')
    formData.append('cloud_storage_url', audioFileUrl)

    if (language !== undefined && language !== null) {
      formData.append('language', language)
    }

    return await this.#apiRequest({
      url: 'v1/speech-to-text',
      method: 'post',
      body: formData,
      multipart: true,
      logTag: 'speechToText',
    })
  }



  /**
   * @operationName Text to Sound Effects
   * @category Audio Generation
   * @description Generates sound effects from text descriptions using ElevenLabs AI. Create realistic sound effects by describing what you want to hear.
   * @route POST /text-to-sound-effects
   *
   * @appearanceColor #F59E0B #FBBF24
   *
   * @paramDef {"type":"String","label":"Text Description","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the sound effect to generate (e.g., 'dog barking', 'thunder storm', 'door creaking')."}
   * @paramDef {"type":"Number","label":"Duration Seconds","name":"durationSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Duration of the sound effect in seconds. Range: 0.5 to 22 seconds."}
   * @paramDef {"type":"Number","label":"Prompt Influence","name":"promptInfluence","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How closely to follow the text prompt, between 0 and 1. Higher values stick closer to the description."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"audioUrl":"https://files.example.com/elevenlabs/sfx_1234567890.mp3"}
   */
  async textToSoundEffects(text, durationSeconds, promptInfluence, fileOptions) {
    const requestBody = { text }

    if (durationSeconds !== undefined) requestBody.duration_seconds = durationSeconds
    if (promptInfluence !== undefined) requestBody.prompt_influence = promptInfluence

    const audioBuffer = await this.#apiRequest({
      url: 'v1/sound-generation',
      method: 'post',
      body: requestBody,
      binary: true,
      logTag: 'textToSoundEffects',
    })

    const result = await this.flowrunner.Files.uploadFile(audioBuffer, {
      filename: `sfx_${ Date.now() }.mp3`,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { audioUrl: result.url }
  }

  /**
   * @operationName Get Voice
   * @category Voice Management
   * @description Retrieves detailed information about a specific voice including settings, metadata, and availability.
   * @route POST /get-voice
   *
   * @appearanceColor #6366F1 #818CF8
   *
   * @paramDef {"type":"String","label":"Voice ID","name":"voiceId","required":true,"dictionary":"getVoicesDictionary","description":"The unique identifier of the voice to retrieve information for."}
   *
   * @returns {Object}
   * @sampleResult {"voice_id":"21m00Tcm4TlvDq8ikWAM","name":"Rachel","category":"premade","description":"A calm and professional female voice","labels":{"accent":"american","description":"calm","age":"young"},"settings":{"stability":0.5,"similarity_boost":0.75}}
   */
  async getVoice(voiceId) {
    return await this.#apiRequest({
      url: `v1/voices/${ voiceId }`,
      method: 'get',
      logTag: 'getVoice',
    })
  }

  /**
   * @operationName Edit Voice
   * @category Voice Management
   * @description Updates voice metadata including name, description, and labels. This endpoint uses multipart/form-data to modify voice properties. Only available for custom voices.
   * @route POST /edit-voice
   *
   * @appearanceColor #6366F1 #818CF8
   *
   * @paramDef {"type":"String","label":"Voice ID","name":"voiceId","required":true,"dictionary":"getVoicesDictionary","description":"The unique identifier of the voice to edit. Only custom voices can be edited."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name for the voice. If not provided, the current name is retained."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New description for the voice. If not provided, the current description is retained."}
   * @paramDef {"type":"Object","label":"Labels","name":"labels","freeform":true,"description":"Voice labels as free-form key-value pairs (e.g., {\"accent\":\"american\",\"age\":\"young\"}); ElevenLabs accepts arbitrary label keys, so there is no fixed sub-form. If not provided, current labels are retained."}
   * @paramDef {"type":"Boolean","label":"Remove Background Noise","name":"removeBackgroundNoise","uiComponent":{"type":"TOGGLE"},"description":"Enable background noise removal for this voice."}
   *
   * @returns {Object}
   * @sampleResult {"status":"ok"}
   */
  async editVoice(voiceId, name, description, labels, removeBackgroundNoise) {
    const formData = new Flowrunner.Request.FormData()

    if (name !== undefined && name !== null) {
      formData.append('name', name)
    }

    if (description !== undefined && description !== null) {
      formData.append('description', description)
    }

    if (labels !== undefined && labels !== null) {
      formData.append('labels', typeof labels === 'string' ? labels : JSON.stringify(labels))
    }

    if (removeBackgroundNoise !== undefined && removeBackgroundNoise !== null) {
      formData.append('remove_background_noise', removeBackgroundNoise.toString())
    }

    return await this.#apiRequest({
      url: `v1/voices/${ voiceId }/edit`,
      method: 'post',
      body: formData,
      multipart: true,
      logTag: 'editVoice',
    })
  }

  /**
   * @operationName Create Voice (Instant Clone)
   * @category Voice Management
   * @description Creates an instant voice clone (IVC) from audio samples. Upload audio files to quickly create a custom voice. This method is faster than PVC but may have lower quality for some use cases.
   * @route POST /create-voice-ivc
   *
   * @appearanceColor #10B981 #34D399
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name for the new voice clone. This will be used to identify the voice in your account."}
   * @paramDef {"type":"String","label":"Audio File URL","name":"audioFileUrl","required":true,"description":"URL of an audio file containing the voice sample. Must be a publicly accessible URL."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description for the voice clone to help identify its characteristics."}
   * @paramDef {"type":"Object","label":"Labels","name":"labels","freeform":true,"description":"Voice labels as free-form key-value pairs (e.g., {\"accent\":\"american\",\"age\":\"young\",\"gender\":\"male\"}); ElevenLabs accepts arbitrary label keys, so there is no fixed sub-form."}
   * @paramDef {"type":"Boolean","label":"Remove Background Noise","name":"removeBackgroundNoise","uiComponent":{"type":"TOGGLE"},"description":"Enable background noise removal from the audio sample for cleaner voice cloning."}
   *
   * @returns {Object}
   * @sampleResult {"voice_id":"xyz123abc456","requires_verification":false}
   */
  async createVoiceIVC(name, audioFileUrl, description, labels, removeBackgroundNoise) {
    const audioBuffer = await this.#downloadFile(audioFileUrl)

    const formData = new Flowrunner.Request.FormData()

    formData.append('name', name)
    formData.append('files', audioBuffer, { filename: 'audio.mp3' })

    if (description !== undefined && description !== null) {
      formData.append('description', description)
    }

    if (labels !== undefined && labels !== null) {
      formData.append('labels', typeof labels === 'string' ? labels : JSON.stringify(labels))
    }

    if (removeBackgroundNoise !== undefined && removeBackgroundNoise !== null) {
      formData.append('remove_background_noise', removeBackgroundNoise.toString())
    }

    return await this.#apiRequest({
      url: 'v1/voices/add',
      method: 'post',
      body: formData,
      multipart: true,
      logTag: 'createVoiceIVC',
    })
  }

  /**
   * @operationName Create Voice (Professional)
   * @category Voice Management
   * @description Creates a professional voice clone (PVC) with metadata only. Audio samples must be added separately using the Add Voice Samples endpoint. PVC offers higher quality than IVC.
   * @route POST /create-voice-pvc
   *
   * @appearanceColor #10B981 #34D399
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name for the new professional voice clone."}
   * @paramDef {"type":"String","label":"Language","name":"language","required":true,"description":"Language code for the voice (e.g., 'en', 'es', 'fr', 'de'). This optimizes the voice for the specified language."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description for the voice clone to help identify its characteristics."}
   * @paramDef {"type":"Object","label":"Labels","name":"labels","freeform":true,"description":"Voice labels as free-form key-value pairs (e.g., {\"accent\":\"american\",\"age\":\"middle-aged\",\"gender\":\"female\"}); ElevenLabs accepts arbitrary label keys, so there is no fixed sub-form."}
   *
   * @returns {Object}
   * @sampleResult {"voice_id":"abc123xyz456"}
   */
  async createVoicePVC(name, language, description, labels) {
    const requestBody = {
      name,
      language,
    }

    if (description !== undefined && description !== null) {
      requestBody.description = description
    }

    if (labels !== undefined && labels !== null) {
      requestBody.labels = labels
    }

    return await this.#apiRequest({
      url: 'v1/voices/pvc',
      method: 'post',
      body: requestBody,
      logTag: 'createVoicePVC',
    })
  }

  /**
   * @operationName Add Voice Samples
   * @category Voice Management
   * @description Adds audio samples to an existing professional voice clone (PVC). Multiple samples improve voice quality and consistency. Each sample should be clear audio of the target voice.
   * @route POST /add-voice-samples
   *
   * @appearanceColor #10B981 #34D399
   *
   * @paramDef {"type":"String","label":"Voice ID","name":"voiceId","required":true,"dictionary":"getVoicesDictionary","description":"The unique identifier of the PVC voice to add samples to."}
   * @paramDef {"type":"String","label":"Audio File URL","name":"audioFileUrl","required":true,"description":"URL of an audio file to add as a voice sample. Must be a publicly accessible URL."}
   * @paramDef {"type":"Boolean","label":"Remove Background Noise","name":"removeBackgroundNoise","uiComponent":{"type":"TOGGLE"},"description":"Enable background noise removal from the audio sample for better voice quality."}
   *
   * @returns {Array}
   * @sampleResult [{"sample_id":"sample_abc123","file_name":"audio.mp3","mime_type":"audio/mpeg","size_bytes":245760,"hash":"a1b2c3d4","duration_secs":15.5,"remove_background_noise":true}]
   */
  async addVoiceSamples(voiceId, audioFileUrl, removeBackgroundNoise) {
    const audioBuffer = await this.#downloadFile(audioFileUrl)

    const formData = new Flowrunner.Request.FormData()

    formData.append('files', audioBuffer, { filename: 'sample.mp3' })

    if (removeBackgroundNoise !== undefined && removeBackgroundNoise !== null) {
      formData.append('remove_background_noise', removeBackgroundNoise.toString())
    }

    return await this.#apiRequest({
      url: `v1/voices/pvc/${ voiceId }/samples`,
      method: 'post',
      body: formData,
      multipart: true,
      logTag: 'addVoiceSamples',
    })
  }

  /**
   * @operationName Design Voice from Text
   * @category Voice Generation
   * @description Generates AI voice previews from a text description. Describe the voice characteristics you want and ElevenLabs will generate preview samples. You can then create an actual voice from your favorite preview.
   * @route POST /design-voice
   *
   * @appearanceColor #8B5CF6 #A78BFA
   *
   * @paramDef {"type":"String","label":"Voice Description","name":"voiceDescription","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Describe the voice characteristics you want (e.g., 'A deep, authoritative male voice with a British accent', 'A cheerful young female voice')."}
   * @paramDef {"type":"String","label":"Sample Text","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text to use for preview generation. If not provided, text will be auto-generated based on the description."}
   * @paramDef {"type":"String","label":"Model","name":"model","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"eleven_multilingual_ttv_v2","label":"Eleven Multilingual TTV v2"},{"value":"eleven_ttv_v3","label":"Eleven TTV v3"}]}},"description":"The model to use for voice generation. Defaults to 'eleven_multilingual_ttv_v2'."}
   * @paramDef {"type":"String","label":"Output Format","name":"outputFormat","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"mp3_44100_128","label":"MP3 44.1 kHz 128 kbps"},{"value":"mp3_44100_192","label":"MP3 44.1 kHz 192 kbps"},{"value":"pcm_16000","label":"PCM 16 kHz"},{"value":"pcm_22050","label":"PCM 22.05 kHz"},{"value":"pcm_24000","label":"PCM 24 kHz"},{"value":"pcm_44100","label":"PCM 44.1 kHz"}]}},"description":"Audio output format for previews."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"previews":[{"generated_voice_id":"abc123","audio_url":"https://files.example.com/elevenlabs/voice_preview_abc123.mp3","media_type":"audio/mpeg"}],"is_already_pro":false}
   */
  async designVoice(voiceDescription, text, model, outputFormat, fileOptions) {
    const requestBody = {
      voice_description: voiceDescription,
      model_id: model || 'eleven_multilingual_ttv_v2',
    }

    if (text !== undefined && text !== null) {
      requestBody.text = text
      requestBody.auto_generate_text = false
    } else {
      requestBody.auto_generate_text = true
    }

    const query = {}

    if (outputFormat !== undefined && outputFormat !== null) {
      query.output_format = outputFormat
    }

    const response = await this.#apiRequest({
      url: 'v1/text-to-voice/design',
      method: 'post',
      body: requestBody,
      query: Object.keys(query).length > 0 ? query : undefined,
      logTag: 'designVoice',
    })

    if (response.previews && Array.isArray(response.previews)) {
      for (const preview of response.previews) {
        if (preview.audio_base_64) {
          const audioBuffer = Buffer.from(preview.audio_base_64, 'base64')

          const result = await this.flowrunner.Files.uploadFile(audioBuffer, {
            filename: `voice_preview_${ preview.generated_voice_id }.mp3`,
            generateUrl: true,
            overwrite: true,
            ...(fileOptions || { scope: 'FLOW' }),
          })

          preview.audio_url = result.url
          delete preview.audio_base_64
        }
      }
    }

    return response
  }

  /**
   * @operationName Create Voice from Generation
   * @category Voice Generation
   * @description Creates a usable voice from a generated preview. After using Design Voice to generate previews, use this to save your favorite preview as an actual voice you can use for text-to-speech.
   * @route POST /create-voice-from-generation
   *
   * @appearanceColor #8B5CF6 #A78BFA
   *
   * @paramDef {"type":"String","label":"Voice Name","name":"voiceName","required":true,"description":"Name for the new voice. This will be used to identify the voice in your account."}
   * @paramDef {"type":"String","label":"Voice Description","name":"voiceDescription","required":true,"description":"Description of the voice characteristics (same as used in Design Voice)."}
   * @paramDef {"type":"String","label":"Generated Voice ID","name":"generatedVoice","required":true,"description":"The generated_voice_id from the preview you want to save (from the Design Voice response). This value comes from the previous step, not a stored list, so it has no picker."}
   * @paramDef {"type":"Object","label":"Labels","name":"labels","freeform":true,"description":"Voice labels as free-form key-value pairs (e.g., {\"accent\":\"american\",\"age\":\"young\",\"gender\":\"male\"}); ElevenLabs accepts arbitrary label keys, so there is no fixed sub-form."}
   *
   * @returns {Object}
   * @sampleResult {"voice_id":"xyz789","name":"My Generated Voice","category":"generated"}
   */
  async createVoiceFromGeneration(voiceName, voiceDescription, generatedVoice, labels) {
    const requestBody = {
      voice_name: voiceName,
      voice_description: voiceDescription,
      generated_voice_id: generatedVoice,
    }

    if (labels !== undefined && labels !== null) {
      requestBody.labels = labels
    }

    return await this.#apiRequest({
      url: 'v1/text-to-voice',
      method: 'post',
      body: requestBody,
      logTag: 'createVoiceFromGeneration',
    })
  }

  /**
   * @operationName Get Models
   * @category Models
   * @description Retrieves a list of all available text-to-speech and speech-to-text models with their capabilities and supported languages.
   * @route POST /get-models
   *
   * @appearanceColor #6366F1 #818CF8
   *
   * @returns {Array}
   * @sampleResult [{"model_id":"eleven_monolingual_v1","name":"Eleven Monolingual v1","languages":[{"language_id":"en","name":"English"}]},{"model_id":"eleven_multilingual_v2","name":"Eleven Multilingual v2","languages":[{"language_id":"en","name":"English"},{"language_id":"es","name":"Spanish"}]}]
   */
  async getModels() {
    return await this.#apiRequest({
      url: 'v1/models',
      method: 'get',
      logTag: 'getModels',
    })
  }

  /**
   * @operationName Get Voices
   * @category Voice Management
   * @description Retrieves a list of all available voices in your account including pre-made and custom voices.
   * @route POST /get-voices
   *
   * @appearanceColor #6366F1 #818CF8
   *
   * @returns {Object}
   * @sampleResult {"voices":[{"voice_id":"21m00Tcm4TlvDq8ikWAM","name":"Rachel","category":"premade","labels":{"accent":"american","description":"calm","age":"young"}},{"voice_id":"AZnzlk1XvdvUeBnXmlld","name":"Domi","category":"premade","labels":{"accent":"american","description":"strong","age":"young"}}]}
   */
  async getVoices() {
    return await this.#apiRequest({
      url: 'v1/voices',
      method: 'get',
      logTag: 'getVoices',
    })
  }

  /**
   * @operationName Get History
   * @category History
   * @description Retrieves the history of all text-to-speech generations made with your account. Results can be filtered and paginated.
   * @route POST /get-history
   *
   * @appearanceColor #8B5CF6 #A78BFA
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of history items to return per page. Defaults to 100."}
   * @paramDef {"type":"String","label":"Start After History Item ID","name":"startAfterHistoryItemId","dictionary":"getHistoryDictionary","description":"History item ID to start pagination after."}
   * @paramDef {"type":"String","label":"Voice ID","name":"voiceId","dictionary":"getVoicesDictionary","description":"Filter history by specific voice."}
   *
   * @returns {Object}
   * @sampleResult {"history":[{"history_item_id":"VW7YKqPnjY4h39yTbx2L","voice_id":"21m00Tcm4TlvDq8ikWAM","voice_name":"Rachel","text":"Hello world","date_unix":1699564800,"character_count":11}],"last_history_item_id":"VW7YKqPnjY4h39yTbx2L","has_more":false}
   */
  async getHistory(pageSize, startAfterHistoryItemId, voiceId) {
    const query = {}

    if (pageSize) query.page_size = pageSize
    if (startAfterHistoryItemId) query.start_after_history_item_id = startAfterHistoryItemId
    if (voiceId) query.voice_id = voiceId

    return await this.#apiRequest({
      url: 'v1/history',
      method: 'get',
      query,
      logTag: 'getHistory',
    })
  }

  /**
   * @operationName Get History Item Audio
   * @category History
   * @description Downloads the audio file for a specific history item and saves it to file storage.
   * @route POST /get-history-item-audio
   *
   * @appearanceColor #8B5CF6 #A78BFA
   *
   * @paramDef {"type":"String","label":"History Item ID","name":"historyItemId","required":true,"dictionary":"getHistoryDictionary","description":"The unique identifier of the history item to download audio for."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"audioUrl":"https://files.example.com/elevenlabs/history_VW7YKqPnjY4h39yTbx2L.mp3"}
   */
  async getHistoryItemAudio(historyItemId, fileOptions) {
    const audioBuffer = await this.#apiRequest({
      url: `v1/history/${ historyItemId }/audio`,
      method: 'get',
      binary: true,
      logTag: 'getHistoryItemAudio',
    })

    const result = await this.flowrunner.Files.uploadFile(audioBuffer, {
      filename: `history_${ historyItemId }.mp3`,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { audioUrl: result.url }
  }

  /**
   * @operationName Delete History Item
   * @category History
   * @description Deletes a specific history item from your account. This removes the audio file and metadata permanently.
   * @route POST /delete-history-item
   *
   * @appearanceColor #EF4444 #F87171
   *
   * @paramDef {"type":"String","label":"History Item ID","name":"historyItemId","required":true,"dictionary":"getHistoryDictionary","description":"The unique identifier of the history item to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"historyItemId":"VW7YKqPnjY4h39yTbx2L"}
   */
  async deleteHistoryItem(historyItemId) {
    return await this.#apiRequest({
      url: `v1/history/${ historyItemId }`,
      method: 'delete',
      logTag: 'deleteHistoryItem',
    })
  }
}

Flowrunner.ServerCode.addService(ElevenLabsService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your ElevenLabs API key from https://elevenlabs.io/app/settings/api-keys',
  },
])

function normalizeError(error) {
  if (error.body?.detail?.message) {
    error.message = error.body.detail.message
  } else if (error.body?.detail) {
    error.message = typeof error.body.detail === 'string' ? error.body.detail : JSON.stringify(error.body.detail)
  } else if (error.message && typeof error.message === 'object') {
    error.message = JSON.stringify(error.message)
  }

  return error
}