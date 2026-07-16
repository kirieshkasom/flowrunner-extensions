'use strict'

const https = require('https')

const { jsonRequest } = require('./aws-client')
const { CredentialProvider } = require('./credentials')
const { createLogger, mapAwsError } = require('./errors')
const { awsConfigItems } = require('./config-items')

const TARGET_PREFIX = 'Transcribe'
const CONTENT_TYPE = 'application/x-amz-json-1.1'

// Common set of language codes surfaced in dropdowns. The full list is far larger
// (see https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html);
// users may also type any valid code directly.
const LANGUAGE_CODES = [
  'en-US', 'en-GB', 'en-AU', 'en-IN', 'es-US', 'es-ES', 'fr-FR', 'fr-CA',
  'de-DE', 'it-IT', 'pt-BR', 'pt-PT', 'ja-JP', 'ko-KR', 'zh-CN', 'nl-NL',
  'ru-RU', 'ar-SA', 'hi-IN', 'pl-PL', 'tr-TR', 'sv-SE', 'th-TH', 'vi-VN',
]

const MEDIA_FORMATS = ['mp3', 'mp4', 'wav', 'flac', 'ogg', 'amr', 'webm', 'm4a']
const JOB_STATUSES = ['QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED']
const VOCABULARY_STATES = ['PENDING', 'READY', 'FAILED']

/**
 * @typedef {Object} getVocabulariesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter matched against vocabulary names."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call."}
 */

/**
 * @typedef {Object} getTranscriptionJobsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter matched against job names."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call."}
 */

/**
 * @integrationName AWS Transcribe
 * @integrationIcon /icon.svg
 */
class Transcribe {
  constructor(config = {}) {
    this.region = config.region || 'us-east-1'
    this.logger = createLogger('AWS Transcribe')

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
      { region: this.region, service: 'transcribe', target: `${ TARGET_PREFIX }.${ operation }`, contentType: CONTENT_TYPE, body },
      creds
    )
  }

  /**
   * @operationName Start Transcription Job
   * @description Starts an asynchronous transcription job for an audio or video file already stored in Amazon S3. Provide the S3 URI of the media file (e.g. s3://my-bucket/audio.mp3); Transcribe processes it in the background. Specify a single language code, or enable Identify Language to auto-detect the spoken language. When Output Bucket Name is omitted, the transcript is written to a Transcribe-managed S3 location and a TranscriptFileUri is returned. Poll the job with Get Transcription Job until its status is COMPLETED, then read the transcript from TranscriptFileUri.
   * @category Transcription Jobs
   * @route POST /start-transcription-job
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Job Name","name":"transcriptionJobName","required":true,"description":"A unique name for the job within your AWS account. Case sensitive, no spaces, allowed characters are letters, numbers, period, underscore, and hyphen. Reusing an existing name returns a ConflictException."}
   * @paramDef {"type":"String","label":"Media File URI","name":"mediaFileUri","required":true,"description":"The Amazon S3 URI of the input audio/video file, e.g. s3://my-bucket/path/audio.mp3. The file must already be uploaded to S3 and Transcribe must have read access to it."}
   * @paramDef {"type":"String","label":"Language Code","name":"languageCode","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["en-US","en-GB","en-AU","en-IN","es-US","es-ES","fr-FR","fr-CA","de-DE","it-IT","pt-BR","pt-PT","ja-JP","ko-KR","zh-CN","nl-NL","ru-RU","ar-SA","hi-IN","pl-PL","tr-TR","sv-SE","th-TH","vi-VN"]}},"description":"The language spoken in the media file (e.g. en-US). Provide either this or enable Identify Language, not both. You may also type any other valid Transcribe language code."}
   * @paramDef {"type":"Boolean","label":"Identify Language","name":"identifyLanguage","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Automatically detect the single language spoken in the media instead of specifying Language Code. Do not combine with Language Code."}
   * @paramDef {"type":"String","label":"Media Format","name":"mediaFormat","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["mp3","mp4","wav","flac","ogg","amr","webm","m4a"]}},"description":"The format of the input media file. Optional; Transcribe auto-detects the format when omitted."}
   * @paramDef {"type":"String","label":"Output Bucket Name","name":"outputBucketName","required":false,"description":"Name of an S3 bucket (without the s3:// prefix) where the transcript is stored. Transcribe must have write access. When omitted, the transcript is stored in a Transcribe-managed bucket and returned as a presigned TranscriptFileUri."}
   * @paramDef {"type":"Boolean","label":"Show Speaker Labels","name":"showSpeakerLabels","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Enable speaker partitioning (diarization) to label which speaker said what. Requires Max Speaker Labels."}
   * @paramDef {"type":"Number","label":"Max Speaker Labels","name":"maxSpeakerLabels","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of speakers to identify (2-30). Required when Show Speaker Labels is enabled."}
   * @paramDef {"type":"Boolean","label":"Channel Identification","name":"channelIdentification","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Transcribe each audio channel separately and combine the output. Useful for stereo recordings such as call center audio. Cannot be combined with speaker partitioning."}
   * @paramDef {"type":"String","label":"Vocabulary Name","name":"vocabularyName","required":false,"dictionary":"getVocabulariesDictionary","description":"Name of a custom vocabulary to apply to the transcription. Its language must match the media language."}
   * @paramDef {"type":"Array<String>","label":"Subtitle Formats","name":"subtitleFormats","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["vtt","srt"]}},"description":"Generate subtitle files in the chosen formats (WebVTT and/or SubRip). URIs are returned in the job details once complete."}
   * @returns {Object}
   * @sampleResult {"transcriptionJobName":"meeting-2024","status":"IN_PROGRESS","languageCode":"en-US","mediaFileUri":"s3://my-bucket/audio.mp3","creationTime":"2024-01-01T00:00:00Z"}
   */
  async startTranscriptionJob(
    transcriptionJobName,
    mediaFileUri,
    languageCode,
    identifyLanguage,
    mediaFormat,
    outputBucketName,
    showSpeakerLabels,
    maxSpeakerLabels,
    channelIdentification,
    vocabularyName,
    subtitleFormats
  ) {
    if (!transcriptionJobName) throw new Error('transcriptionJobName is required.')
    if (!mediaFileUri) throw new Error('mediaFileUri (an S3 URI) is required.')

    try {
      const body = {
        TranscriptionJobName: transcriptionJobName,
        Media: { MediaFileUri: mediaFileUri },
      }

      if (identifyLanguage) {
        body.IdentifyLanguage = true
      } else {
        if (!languageCode) throw new Error('Provide a languageCode or enable identifyLanguage.')
        body.LanguageCode = languageCode
      }

      if (mediaFormat) body.MediaFormat = mediaFormat
      if (outputBucketName) body.OutputBucketName = outputBucketName

      const settings = {}

      if (showSpeakerLabels) {
        settings.ShowSpeakerLabels = true
        settings.MaxSpeakerLabels = maxSpeakerLabels || 2
      }

      if (channelIdentification) settings.ChannelIdentification = true
      if (vocabularyName) settings.VocabularyName = vocabularyName
      if (Object.keys(settings).length) body.Settings = settings

      if (Array.isArray(subtitleFormats) && subtitleFormats.length) {
        body.Subtitles = { Formats: subtitleFormats }
      }

      const res = await this.sendJson('StartTranscriptionJob', body)

      return this.#formatJob(res.TranscriptionJob)
    } catch (error) {
      this.#handleError('startTranscriptionJob', error)
    }
  }

  /**
   * @operationName Get Transcription Job
   * @description Retrieves the current status and details of a transcription job. When the job status is COMPLETED, the result includes the TranscriptFileUri where the transcript JSON is stored. If the transcript is at a Transcribe-managed (presigned) URI and Fetch Transcript Text is enabled, this operation also downloads the transcript JSON and returns the plain transcript text. For jobs written to your own Output Bucket, the URI points into your S3 bucket and typically requires S3 access to read, so text fetching may not succeed without a publicly reachable URI.
   * @category Transcription Jobs
   * @route GET /get-transcription-job
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Job Name","name":"transcriptionJobName","required":true,"dictionary":"getTranscriptionJobsDictionary","description":"The name of the transcription job to retrieve."}
   * @paramDef {"type":"Boolean","label":"Fetch Transcript Text","name":"fetchTranscriptText","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"When the job is COMPLETED and the transcript is at a publicly reachable/presigned URI, download and parse the transcript JSON and return the plain transcript text."}
   * @returns {Object}
   * @sampleResult {"transcriptionJobName":"meeting-2024","status":"COMPLETED","languageCode":"en-US","transcriptFileUri":"https://s3.amazonaws.com/aws-transcribe/meeting-2024.json","transcriptText":"Hello and welcome to the meeting.","completionTime":"2024-01-01T00:05:00Z"}
   */
  async getTranscriptionJob(transcriptionJobName, fetchTranscriptText) {
    if (!transcriptionJobName) throw new Error('transcriptionJobName is required.')

    try {
      const res = await this.sendJson('GetTranscriptionJob', { TranscriptionJobName: transcriptionJobName })
      const job = this.#formatJob(res.TranscriptionJob)

      if (fetchTranscriptText && job.status === 'COMPLETED' && job.transcriptFileUri) {
        job.transcriptText = await this.#downloadTranscriptText(job.transcriptFileUri)
      }

      return job
    } catch (error) {
      this.#handleError('getTranscriptionJob', error)
    }
  }

  /**
   * @operationName List Transcription Jobs
   * @description Lists transcription jobs in your account, most recent first. Optionally filter by status or by a substring of the job name, and page through results using the returned cursor.
   * @category Transcription Jobs
   * @route GET /list-transcription-jobs
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["QUEUED","IN_PROGRESS","COMPLETED","FAILED"]}},"description":"Return only jobs with this status. When omitted, jobs of all statuses are returned."}
   * @paramDef {"type":"String","label":"Job Name Contains","name":"jobNameContains","required":false,"description":"Return only jobs whose name contains this string (case insensitive)."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of jobs to return per page (1-100). Defaults to 5."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor returned by a previous call. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"jobs":[{"transcriptionJobName":"meeting-2024","status":"COMPLETED","languageCode":"en-US","creationTime":"2024-01-01T00:00:00Z"}],"cursor":null}
   */
  async listTranscriptionJobs(status, jobNameContains, maxResults, cursor) {
    try {
      const body = {}

      if (status) body.Status = status
      if (jobNameContains) body.JobNameContains = jobNameContains
      if (maxResults) body.MaxResults = maxResults
      if (cursor) body.NextToken = cursor

      const res = await this.sendJson('ListTranscriptionJobs', body)

      return {
        jobs: (res.TranscriptionJobSummaries || []).map(s => ({
          transcriptionJobName: s.TranscriptionJobName,
          status: s.TranscriptionJobStatus,
          languageCode: s.LanguageCode,
          creationTime: s.CreationTime,
          completionTime: s.CompletionTime,
          failureReason: s.FailureReason,
          outputLocationType: s.OutputLocationType,
        })),
        cursor: res.NextToken || null,
      }
    } catch (error) {
      this.#handleError('listTranscriptionJobs', error)
    }
  }

  /**
   * @operationName Delete Transcription Job
   * @description Permanently deletes a transcription job and its metadata. This does not delete any transcript file already written to your own S3 output bucket. This action cannot be undone.
   * @category Transcription Jobs
   * @route DELETE /delete-transcription-job
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Job Name","name":"transcriptionJobName","required":true,"dictionary":"getTranscriptionJobsDictionary","description":"The name of the transcription job to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"transcriptionJobName":"meeting-2024"}
   */
  async deleteTranscriptionJob(transcriptionJobName) {
    if (!transcriptionJobName) throw new Error('transcriptionJobName is required.')

    try {
      await this.sendJson('DeleteTranscriptionJob', { TranscriptionJobName: transcriptionJobName })

      return { deleted: true, transcriptionJobName }
    } catch (error) {
      this.#handleError('deleteTranscriptionJob', error)
    }
  }

  /**
   * @operationName Create Vocabulary
   * @description Creates a custom vocabulary to improve transcription accuracy for domain-specific terms, names, and acronyms. Provide the terms as a list of phrases. Vocabulary creation is asynchronous; the returned state is typically PENDING and becomes READY (or FAILED) once processed. Use Get Vocabulary to check the state before applying it to a transcription job.
   * @category Custom Vocabularies
   * @route POST /create-vocabulary
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Vocabulary Name","name":"vocabularyName","required":true,"description":"A unique name for the vocabulary within your AWS account. Reusing an existing name returns a ConflictException."}
   * @paramDef {"type":"String","label":"Language Code","name":"languageCode","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["en-US","en-GB","en-AU","en-IN","es-US","es-ES","fr-FR","fr-CA","de-DE","it-IT","pt-BR","pt-PT","ja-JP","ko-KR","zh-CN","nl-NL","ru-RU","ar-SA","hi-IN","pl-PL","tr-TR","sv-SE","th-TH","vi-VN"]}},"description":"The language of the vocabulary terms. Must match the language of the media you transcribe with it. You may also type any other valid Transcribe language code."}
   * @paramDef {"type":"Array<String>","label":"Phrases","name":"phrases","required":true,"description":"The words and phrases to include in the vocabulary, one entry per term. Use hyphens to join multi-word terms exactly as they should appear (e.g. Los-Angeles)."}
   * @returns {Object}
   * @sampleResult {"vocabularyName":"medical-terms","languageCode":"en-US","vocabularyState":"PENDING","lastModifiedTime":"2024-01-01T00:00:00Z"}
   */
  async createVocabulary(vocabularyName, languageCode, phrases) {
    if (!vocabularyName) throw new Error('vocabularyName is required.')
    if (!languageCode) throw new Error('languageCode is required.')
    if (!Array.isArray(phrases) || phrases.length === 0) throw new Error('phrases must be a non-empty array.')

    try {
      const res = await this.sendJson('CreateVocabulary', {
        VocabularyName: vocabularyName,
        LanguageCode: languageCode,
        Phrases: phrases,
      })

      return this.#formatVocabulary(res)
    } catch (error) {
      this.#handleError('createVocabulary', error)
    }
  }

  /**
   * @operationName Get Vocabulary
   * @description Retrieves information about a custom vocabulary, including its processing state (PENDING, READY, or FAILED) and a temporary download URI for the vocabulary contents when available.
   * @category Custom Vocabularies
   * @route GET /get-vocabulary
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Vocabulary Name","name":"vocabularyName","required":true,"dictionary":"getVocabulariesDictionary","description":"The name of the custom vocabulary to retrieve."}
   * @returns {Object}
   * @sampleResult {"vocabularyName":"medical-terms","languageCode":"en-US","vocabularyState":"READY","lastModifiedTime":"2024-01-01T00:00:00Z","downloadUri":"https://s3.amazonaws.com/aws-transcribe/vocab.txt"}
   */
  async getVocabulary(vocabularyName) {
    if (!vocabularyName) throw new Error('vocabularyName is required.')

    try {
      const res = await this.sendJson('GetVocabulary', { VocabularyName: vocabularyName })

      return this.#formatVocabulary(res)
    } catch (error) {
      this.#handleError('getVocabulary', error)
    }
  }

  /**
   * @operationName List Vocabularies
   * @description Lists the custom vocabularies in your account. Optionally filter by processing state or by a substring of the vocabulary name, and page through results using the returned cursor.
   * @category Custom Vocabularies
   * @route GET /list-vocabularies
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"State","name":"stateEquals","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["PENDING","READY","FAILED"]}},"description":"Return only vocabularies with this processing state. When omitted, all vocabularies are returned."}
   * @paramDef {"type":"String","label":"Name Contains","name":"nameContains","required":false,"description":"Return only vocabularies whose name contains this string (case insensitive)."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of vocabularies to return per page (1-100). Defaults to 5."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor returned by a previous call. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"vocabularies":[{"vocabularyName":"medical-terms","languageCode":"en-US","vocabularyState":"READY","lastModifiedTime":"2024-01-01T00:00:00Z"}],"cursor":null}
   */
  async listVocabularies(stateEquals, nameContains, maxResults, cursor) {
    try {
      const body = {}

      if (stateEquals) body.StateEquals = stateEquals
      if (nameContains) body.NameContains = nameContains
      if (maxResults) body.MaxResults = maxResults
      if (cursor) body.NextToken = cursor

      const res = await this.sendJson('ListVocabularies', body)

      return {
        vocabularies: (res.Vocabularies || []).map(this.#formatVocabulary),
        cursor: res.NextToken || null,
      }
    } catch (error) {
      this.#handleError('listVocabularies', error)
    }
  }

  /**
   * @operationName Delete Vocabulary
   * @description Permanently deletes a custom vocabulary. Any in-progress transcription jobs already using it are unaffected, but it can no longer be applied to new jobs. This action cannot be undone.
   * @category Custom Vocabularies
   * @route DELETE /delete-vocabulary
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Vocabulary Name","name":"vocabularyName","required":true,"dictionary":"getVocabulariesDictionary","description":"The name of the custom vocabulary to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"vocabularyName":"medical-terms"}
   */
  async deleteVocabulary(vocabularyName) {
    if (!vocabularyName) throw new Error('vocabularyName is required.')

    try {
      await this.sendJson('DeleteVocabulary', { VocabularyName: vocabularyName })

      return { deleted: true, vocabularyName }
    } catch (error) {
      this.#handleError('deleteVocabulary', error)
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Vocabularies Dictionary
   * @description Provides a searchable list of custom vocabulary names for dynamic dropdown selection in other operations.
   * @route POST /get-vocabularies-dictionary
   * @paramDef {"type":"getVocabulariesDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"medical-terms","value":"medical-terms","note":"READY"}],"cursor":null}
   */
  async getVocabulariesDictionary(payload) {
    const { search, cursor } = payload || {}

    try {
      const body = { MaxResults: 100 }

      if (search) body.NameContains = search
      if (cursor) body.NextToken = cursor

      const res = await this.sendJson('ListVocabularies', body)

      return {
        items: (res.Vocabularies || []).map(v => ({
          label: v.VocabularyName,
          value: v.VocabularyName,
          note: v.VocabularyState,
        })),
        cursor: res.NextToken || null,
      }
    } catch (error) {
      this.#handleError('getVocabulariesDictionary', error)
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Transcription Jobs Dictionary
   * @description Provides a searchable list of transcription job names for dynamic dropdown selection in other operations.
   * @route POST /get-transcription-jobs-dictionary
   * @paramDef {"type":"getTranscriptionJobsDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"meeting-2024","value":"meeting-2024","note":"COMPLETED"}],"cursor":null}
   */
  async getTranscriptionJobsDictionary(payload) {
    const { search, cursor } = payload || {}

    try {
      const body = { MaxResults: 100 }

      if (search) body.JobNameContains = search
      if (cursor) body.NextToken = cursor

      const res = await this.sendJson('ListTranscriptionJobs', body)

      return {
        items: (res.TranscriptionJobSummaries || []).map(s => ({
          label: s.TranscriptionJobName,
          value: s.TranscriptionJobName,
          note: s.TranscriptionJobStatus,
        })),
        cursor: res.NextToken || null,
      }
    } catch (error) {
      this.#handleError('getTranscriptionJobsDictionary', error)
    }
  }

  #formatJob(job = {}) {
    return {
      transcriptionJobName: job.TranscriptionJobName,
      status: job.TranscriptionJobStatus,
      languageCode: job.LanguageCode,
      languageCodes: job.LanguageCodes,
      identifyLanguage: job.IdentifyLanguage,
      mediaFormat: job.MediaFormat,
      mediaFileUri: job.Media && job.Media.MediaFileUri,
      transcriptFileUri: job.Transcript && job.Transcript.TranscriptFileUri,
      subtitleFileUris: job.Subtitles && job.Subtitles.SubtitleFileUris,
      settings: job.Settings,
      creationTime: job.CreationTime,
      startTime: job.StartTime,
      completionTime: job.CompletionTime,
      failureReason: job.FailureReason,
    }
  }

  #formatVocabulary(vocab = {}) {
    return {
      vocabularyName: vocab.VocabularyName,
      languageCode: vocab.LanguageCode,
      vocabularyState: vocab.VocabularyState,
      lastModifiedTime: vocab.LastModifiedTime,
      failureReason: vocab.FailureReason,
      downloadUri: vocab.DownloadUri,
    }
  }

  #downloadTranscriptText(uri) {
    return new Promise(resolve => {
      try {
        https.get(uri, res => {
          if (res.statusCode >= 300) {
            res.resume()
            resolve(null)

            return
          }

          const chunks = []

          res.on('data', chunk => chunks.push(chunk))
          res.on('error', () => resolve(null))

          res.on('end', () => {
            try {
              const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
              const transcripts = parsed.results && parsed.results.transcripts

              resolve(Array.isArray(transcripts) && transcripts.length ? transcripts[0].transcript : null)
            } catch (err) {
              this.logger.warn('Failed to parse transcript JSON:', err && err.message)
              resolve(null)
            }
          })
        }).on('error', err => {
          this.logger.warn('Failed to download transcript:', err && err.message)
          resolve(null)
        })
      } catch (err) {
        this.logger.warn('Failed to download transcript:', err && err.message)
        resolve(null)
      }
    })
  }

  #handleError(method, error) {
    this.logger.error(`[${ method }]`, error && error.message)

    if (error && error.name === 'ConflictException') {
      throw new Error(`Conflict: ${ error.message }. A job or vocabulary with this name already exists; names must be unique within your AWS account.`)
    }

    if (error && error.name === 'BadRequestException') {
      throw new Error(`Invalid request: ${ error.message }. Check the job/vocabulary name, S3 media URI, and language code.`)
    }

    if (error && error.name === 'NotFoundException') {
      throw new Error(`Not found: ${ error.message }. Check the job or vocabulary name.`)
    }

    if (error && error.name === 'LimitExceededException') {
      throw new Error(`Limit exceeded: ${ error.message }. You have sent too many requests or the input file is too long; wait and retry.`)
    }

    throw mapAwsError(error)
  }
}

if (typeof Flowrunner !== 'undefined') {
  Flowrunner.ServerCode.addService(Transcribe, awsConfigItems)
}

module.exports = { Transcribe, LANGUAGE_CODES, MEDIA_FORMATS, JOB_STATUSES, VOCABULARY_STATES }
