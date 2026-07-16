'use strict'

const { jsonRequest } = require('./aws-client')
const { CredentialProvider } = require('./credentials')
const { createLogger, mapAwsError } = require('./errors')
const { awsConfigItems } = require('./config-items')

const TARGET_PREFIX = 'RekognitionService'
const CONTENT_TYPE = 'application/x-amz-json-1.1'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB limit for raw image bytes

/**
 * @integrationName AWS Rekognition
 * @integrationIcon /icon.svg
 */
class Rekognition {
  constructor(config = {}) {
    this.region = config.region || 'us-east-1'
    this.logger = createLogger('AWS Rekognition')

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
      { region: this.region, service: 'rekognition', target: `${ TARGET_PREFIX }.${ operation }`, contentType: CONTENT_TYPE, body },
      creds
    )
  }

  /**
   * Resolves the API value for a friendly dropdown label, passing through unknown values.
   */
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * Builds a Rekognition Image object from either an S3 object or an image URL.
   * When an S3 bucket + name are supplied they take precedence and produce
   * { S3Object: { Bucket, Name } }. Otherwise the image URL (any HTTP(S) URL,
   * including a FlowRunner file URL) is downloaded and passed as base64 Bytes.
   * Raw bytes are limited to 5 MB by the Rekognition API.
   */
  async #buildImage(imageUrl, s3Bucket, s3Name) {
    if (s3Bucket && s3Name) {
      return { S3Object: { Bucket: s3Bucket, Name: s3Name } }
    }

    if (!imageUrl) {
      throw new Error('Provide either an image URL or both an S3 bucket and object name.')
    }

    const bytes = await Flowrunner.Request.get(imageUrl).setEncoding(null)
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new Error(`Image is ${ Math.round(buffer.length / 1024 / 1024) } MB, exceeding the 5 MB limit for raw image bytes. Store the image in S3 and pass the bucket and name instead.`)
    }

    return { Bytes: buffer.toString('base64') }
  }

  /**
   * @operationName Detect Labels
   * @description Detects real-world objects, scenes, concepts, and activities in an image, each with a confidence score, and returns bounding boxes for detected instances. Supply the image as an S3 object or an image/file URL (URLs are limited to 5 MB). Optionally cap the number of labels and set a minimum confidence.
   * @category Image Analysis
   * @route POST /detect-labels
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":false,"description":"HTTP(S) or FlowRunner file URL of the image to analyze. Ignored when an S3 bucket and object name are provided. Max 5 MB."}
   * @paramDef {"type":"String","label":"S3 Bucket","name":"s3Bucket","required":false,"description":"Name of the S3 bucket holding the image. Use with S3 Object Name instead of an Image URL."}
   * @paramDef {"type":"String","label":"S3 Object Name","name":"s3Name","required":false,"description":"Key (path/filename) of the image object within the S3 bucket."}
   * @paramDef {"type":"Number","label":"Max Labels","name":"maxLabels","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of labels to return, ordered by confidence."}
   * @paramDef {"type":"Number","label":"Min Confidence","name":"minConfidence","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Only return labels at or above this confidence percentage (0-100). Rekognition defaults to 55 when omitted."}
   * @paramDef {"type":"Boolean","label":"Include Image Properties","name":"includeImageProperties","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"When enabled, also returns dominant colors, sharpness, and brightness for the image and its foreground/background."}
   * @returns {Object}
   * @sampleResult {"labels":[{"Name":"Dog","Confidence":98.2,"Instances":[{"BoundingBox":{"Width":0.5,"Height":0.6,"Left":0.2,"Top":0.1},"Confidence":98.2}],"Parents":[{"Name":"Animal"}]}],"labelModelVersion":"3.0"}
   */
  async detectLabels(imageUrl, s3Bucket, s3Name, maxLabels, minConfidence, includeImageProperties) {
    try {
      const body = { Image: await this.#buildImage(imageUrl, s3Bucket, s3Name) }

      if (maxLabels) body.MaxLabels = maxLabels
      if (minConfidence !== undefined && minConfidence !== null) body.MinConfidence = minConfidence
      if (includeImageProperties) body.Features = ['GENERAL_LABELS', 'IMAGE_PROPERTIES']

      const res = await this.sendJson('DetectLabels', body)

      return {
        labels: res.Labels || [],
        imageProperties: res.ImageProperties || null,
        labelModelVersion: res.LabelModelVersion || null,
      }
    } catch (error) {
      this.#handleError('detectLabels', error)
    }
  }

  /**
   * @operationName Detect Text
   * @description Detects text in an image and returns each detected line and word with its confidence and bounding geometry. Useful for reading signs, labels, documents, and screenshots. Supply the image as an S3 object or an image/file URL (URLs are limited to 5 MB).
   * @category Image Analysis
   * @route POST /detect-text
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":false,"description":"HTTP(S) or FlowRunner file URL of the image to analyze. Ignored when an S3 bucket and object name are provided. Max 5 MB."}
   * @paramDef {"type":"String","label":"S3 Bucket","name":"s3Bucket","required":false,"description":"Name of the S3 bucket holding the image. Use with S3 Object Name instead of an Image URL."}
   * @paramDef {"type":"String","label":"S3 Object Name","name":"s3Name","required":false,"description":"Key (path/filename) of the image object within the S3 bucket."}
   * @returns {Object}
   * @sampleResult {"textDetections":[{"DetectedText":"STOP","Type":"LINE","Confidence":99.1,"Id":0,"Geometry":{"BoundingBox":{"Width":0.3,"Height":0.1,"Left":0.35,"Top":0.4}}}],"textModelVersion":"3.0"}
   */
  async detectText(imageUrl, s3Bucket, s3Name) {
    try {
      const body = { Image: await this.#buildImage(imageUrl, s3Bucket, s3Name) }
      const res = await this.sendJson('DetectText', body)

      return {
        textDetections: res.TextDetections || [],
        textModelVersion: res.TextModelVersion || null,
      }
    } catch (error) {
      this.#handleError('detectText', error)
    }
  }

  /**
   * @operationName Detect Faces
   * @description Detects faces in an image and returns per-face details such as bounding box, quality, pose, and (when All Attributes is enabled) age range, emotions, facial landmarks, gender, and attributes like smile, eyeglasses, and beard. Supply the image as an S3 object or an image/file URL (URLs are limited to 5 MB).
   * @category Face Analysis
   * @route POST /detect-faces
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":false,"description":"HTTP(S) or FlowRunner file URL of the image to analyze. Ignored when an S3 bucket and object name are provided. Max 5 MB."}
   * @paramDef {"type":"String","label":"S3 Bucket","name":"s3Bucket","required":false,"description":"Name of the S3 bucket holding the image. Use with S3 Object Name instead of an Image URL."}
   * @paramDef {"type":"String","label":"S3 Object Name","name":"s3Name","required":false,"description":"Key (path/filename) of the image object within the S3 bucket."}
   * @paramDef {"type":"String","label":"Attributes","name":"attributes","required":false,"defaultValue":"Default","uiComponent":{"type":"DROPDOWN","options":{"values":["Default","All"]}},"description":"'Default' returns bounding box, confidence, pose, quality, and landmarks. 'All' additionally returns age range, emotions, gender, and facial attributes."}
   * @returns {Object}
   * @sampleResult {"faceDetails":[{"BoundingBox":{"Width":0.2,"Height":0.3,"Left":0.4,"Top":0.2},"AgeRange":{"Low":25,"High":33},"Emotions":[{"Type":"HAPPY","Confidence":95.1}],"Confidence":99.9}],"faceModelVersion":"7.0"}
   */
  async detectFaces(imageUrl, s3Bucket, s3Name, attributes) {
    try {
      const body = { Image: await this.#buildImage(imageUrl, s3Bucket, s3Name) }
      const resolved = this.#resolveChoice(attributes, { Default: 'DEFAULT', All: 'ALL' })

      body.Attributes = [resolved || 'DEFAULT']

      const res = await this.sendJson('DetectFaces', body)

      return {
        faceDetails: res.FaceDetails || [],
        faceModelVersion: res.FaceModelVersion || null,
      }
    } catch (error) {
      this.#handleError('detectFaces', error)
    }
  }

  /**
   * @operationName Detect Moderation Labels
   * @description Detects unsafe or inappropriate content in an image (such as explicit or suggestive nudity, violence, drugs, hate symbols, and more), returning hierarchical moderation categories with confidence scores. Supply the image as an S3 object or an image/file URL (URLs are limited to 5 MB).
   * @category Image Analysis
   * @route POST /detect-moderation-labels
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":false,"description":"HTTP(S) or FlowRunner file URL of the image to analyze. Ignored when an S3 bucket and object name are provided. Max 5 MB."}
   * @paramDef {"type":"String","label":"S3 Bucket","name":"s3Bucket","required":false,"description":"Name of the S3 bucket holding the image. Use with S3 Object Name instead of an Image URL."}
   * @paramDef {"type":"String","label":"S3 Object Name","name":"s3Name","required":false,"description":"Key (path/filename) of the image object within the S3 bucket."}
   * @paramDef {"type":"Number","label":"Min Confidence","name":"minConfidence","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Only return moderation labels at or above this confidence percentage (0-100). Rekognition defaults to 50 when omitted."}
   * @returns {Object}
   * @sampleResult {"moderationLabels":[{"Confidence":92.4,"Name":"Explicit Nudity","ParentName":""},{"Confidence":92.4,"Name":"Nudity","ParentName":"Explicit Nudity"}],"moderationModelVersion":"7.0"}
   */
  async detectModerationLabels(imageUrl, s3Bucket, s3Name, minConfidence) {
    try {
      const body = { Image: await this.#buildImage(imageUrl, s3Bucket, s3Name) }

      if (minConfidence !== undefined && minConfidence !== null) body.MinConfidence = minConfidence

      const res = await this.sendJson('DetectModerationLabels', body)

      return {
        moderationLabels: res.ModerationLabels || [],
        moderationModelVersion: res.ModerationModelVersion || null,
      }
    } catch (error) {
      this.#handleError('detectModerationLabels', error)
    }
  }

  /**
   * @operationName Recognize Celebrities
   * @description Recognizes well-known people in an image and returns matched celebrities with their name, ID, match confidence, and known URLs, plus a count of unrecognized faces. Supply the image as an S3 object or an image/file URL (URLs are limited to 5 MB).
   * @category Face Analysis
   * @route POST /recognize-celebrities
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":false,"description":"HTTP(S) or FlowRunner file URL of the image to analyze. Ignored when an S3 bucket and object name are provided. Max 5 MB."}
   * @paramDef {"type":"String","label":"S3 Bucket","name":"s3Bucket","required":false,"description":"Name of the S3 bucket holding the image. Use with S3 Object Name instead of an Image URL."}
   * @paramDef {"type":"String","label":"S3 Object Name","name":"s3Name","required":false,"description":"Key (path/filename) of the image object within the S3 bucket."}
   * @returns {Object}
   * @sampleResult {"celebrityFaces":[{"Name":"Jane Doe","Id":"1abc","MatchConfidence":98.7,"Urls":["www.imdb.com/name/nm0000000"],"Face":{"BoundingBox":{"Width":0.2,"Height":0.3,"Left":0.4,"Top":0.2}}}],"unrecognizedFaces":[]}
   */
  async recognizeCelebrities(imageUrl, s3Bucket, s3Name) {
    try {
      const body = { Image: await this.#buildImage(imageUrl, s3Bucket, s3Name) }
      const res = await this.sendJson('RecognizeCelebrities', body)

      return {
        celebrityFaces: res.CelebrityFaces || [],
        unrecognizedFaces: res.UnrecognizedFaces || [],
      }
    } catch (error) {
      this.#handleError('recognizeCelebrities', error)
    }
  }

  /**
   * @operationName Compare Faces
   * @description Compares the largest face in a source image against faces in a target image and returns matches above a similarity threshold, along with unmatched faces. Provide each image as either an S3 object or an image/file URL (URLs are limited to 5 MB).
   * @category Face Analysis
   * @route POST /compare-faces
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Source Image URL","name":"sourceImageUrl","required":false,"description":"HTTP(S) or FlowRunner file URL of the source image (contains the reference face). Ignored when Source S3 fields are provided. Max 5 MB."}
   * @paramDef {"type":"String","label":"Source S3 Bucket","name":"sourceS3Bucket","required":false,"description":"S3 bucket holding the source image. Use with Source S3 Object Name."}
   * @paramDef {"type":"String","label":"Source S3 Object Name","name":"sourceS3Name","required":false,"description":"Key (path/filename) of the source image within the S3 bucket."}
   * @paramDef {"type":"String","label":"Target Image URL","name":"targetImageUrl","required":false,"description":"HTTP(S) or FlowRunner file URL of the target image (searched for matching faces). Ignored when Target S3 fields are provided. Max 5 MB."}
   * @paramDef {"type":"String","label":"Target S3 Bucket","name":"targetS3Bucket","required":false,"description":"S3 bucket holding the target image. Use with Target S3 Object Name."}
   * @paramDef {"type":"String","label":"Target S3 Object Name","name":"targetS3Name","required":false,"description":"Key (path/filename) of the target image within the S3 bucket."}
   * @paramDef {"type":"Number","label":"Similarity Threshold","name":"similarityThreshold","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Minimum similarity percentage (0-100) for a face to be considered a match. Rekognition defaults to 80 when omitted."}
   * @returns {Object}
   * @sampleResult {"faceMatches":[{"Similarity":99.2,"Face":{"BoundingBox":{"Width":0.2,"Height":0.3,"Left":0.4,"Top":0.2},"Confidence":99.9}}],"unmatchedFaces":[],"sourceImageFace":{"BoundingBox":{"Width":0.2,"Height":0.3,"Left":0.4,"Top":0.2},"Confidence":99.9}}
   */
  async compareFaces(sourceImageUrl, sourceS3Bucket, sourceS3Name, targetImageUrl, targetS3Bucket, targetS3Name, similarityThreshold) {
    try {
      const body = {
        SourceImage: await this.#buildImage(sourceImageUrl, sourceS3Bucket, sourceS3Name),
        TargetImage: await this.#buildImage(targetImageUrl, targetS3Bucket, targetS3Name),
      }

      if (similarityThreshold !== undefined && similarityThreshold !== null) body.SimilarityThreshold = similarityThreshold

      const res = await this.sendJson('CompareFaces', body)

      return {
        faceMatches: res.FaceMatches || [],
        unmatchedFaces: res.UnmatchedFaces || [],
        sourceImageFace: res.SourceImageFace || null,
      }
    } catch (error) {
      this.#handleError('compareFaces', error)
    }
  }

  /**
   * @operationName Detect Protective Equipment
   * @description Detects personal protective equipment (PPE) worn by people in an image, reporting per-person body parts and whether each is covered by a face cover, hand cover, or head cover, plus an overall summary of persons with and without required equipment. Supply the image as an S3 object or an image/file URL (URLs are limited to 5 MB).
   * @category Image Analysis
   * @route POST /detect-protective-equipment
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":false,"description":"HTTP(S) or FlowRunner file URL of the image to analyze. Ignored when an S3 bucket and object name are provided. Max 5 MB."}
   * @paramDef {"type":"String","label":"S3 Bucket","name":"s3Bucket","required":false,"description":"Name of the S3 bucket holding the image. Use with S3 Object Name instead of an Image URL."}
   * @paramDef {"type":"String","label":"S3 Object Name","name":"s3Name","required":false,"description":"Key (path/filename) of the image object within the S3 bucket."}
   * @paramDef {"type":"Number","label":"Min Confidence","name":"minConfidence","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Minimum confidence percentage (0-100) for the PPE summary. Rekognition defaults to 80 when omitted."}
   * @paramDef {"type":"Array<String>","label":"Required Equipment Types","name":"requiredEquipmentTypes","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Face Cover","Hand Cover","Head Cover"]}},"description":"Equipment types used to summarize which persons are and are not compliant. Defaults to all three when omitted."}
   * @returns {Object}
   * @sampleResult {"persons":[{"Id":0,"BoundingBox":{"Width":0.3,"Height":0.7,"Left":0.1,"Top":0.1},"BodyParts":[{"Name":"FACE","Confidence":99.1,"EquipmentDetections":[{"Type":"FACE_COVER","Confidence":98.2,"CoversBodyPart":{"Value":true,"Confidence":97.0}}]}]}],"summary":{"PersonsWithRequiredEquipment":[0],"PersonsWithoutRequiredEquipment":[],"PersonsIndeterminate":[]},"protectiveEquipmentModelVersion":"1.0"}
   */
  async detectProtectiveEquipment(imageUrl, s3Bucket, s3Name, minConfidence, requiredEquipmentTypes) {
    try {
      const body = { Image: await this.#buildImage(imageUrl, s3Bucket, s3Name) }
      const summarization = {}

      if (minConfidence !== undefined && minConfidence !== null) summarization.MinConfidence = minConfidence

      const equipmentMapping = { 'Face Cover': 'FACE_COVER', 'Hand Cover': 'HAND_COVER', 'Head Cover': 'HEAD_COVER' }

      if (Array.isArray(requiredEquipmentTypes) && requiredEquipmentTypes.length) {
        summarization.RequiredEquipmentTypes = requiredEquipmentTypes.map(type => this.#resolveChoice(type, equipmentMapping))
      }

      if (Object.keys(summarization).length) body.SummarizationAttributes = summarization

      const res = await this.sendJson('DetectProtectiveEquipment', body)

      return {
        persons: res.Persons || [],
        summary: res.Summary || null,
        protectiveEquipmentModelVersion: res.ProtectiveEquipmentModelVersion || null,
      }
    } catch (error) {
      this.#handleError('detectProtectiveEquipment', error)
    }
  }

  /**
   * @operationName Create Collection
   * @description Creates a face collection, a server-side container used to store searchable face vectors indexed from images. Returns the collection ARN, the face model version, and a status code. Collection IDs must be unique within a region and account.
   * @category Collections
   * @route POST /create-collection
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Collection ID","name":"collectionId","required":true,"description":"Unique identifier for the new collection (letters, digits, underscores, hyphens, and periods)."}
   * @returns {Object}
   * @sampleResult {"collectionArn":"aws:rekognition:us-east-1:111122223333:collection/my-faces","faceModelVersion":"7.0","statusCode":200}
   */
  async createCollection(collectionId) {
    if (!collectionId) throw new Error('collectionId is required.')

    try {
      const res = await this.sendJson('CreateCollection', { CollectionId: collectionId })

      return {
        collectionArn: res.CollectionArn || null,
        faceModelVersion: res.FaceModelVersion || null,
        statusCode: res.StatusCode || null,
      }
    } catch (error) {
      this.#handleError('createCollection', error)
    }
  }

  /**
   * @operationName List Collections
   * @description Lists the face collection IDs in the configured region and account, along with the face model version used by each. Supports pagination via cursor for accounts with many collections.
   * @category Collections
   * @route POST /list-collections
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of collection IDs to return (up to 100)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination token returned by a previous call. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"collectionIds":["my-faces","employees"],"faceModelVersions":["7.0","7.0"],"cursor":null}
   */
  async listCollections(maxResults, cursor) {
    try {
      const body = {}

      if (maxResults) body.MaxResults = maxResults
      if (cursor) body.NextToken = cursor

      const res = await this.sendJson('ListCollections', body)

      return {
        collectionIds: res.CollectionIds || [],
        faceModelVersions: res.FaceModelVersions || [],
        cursor: res.NextToken || null,
      }
    } catch (error) {
      this.#handleError('listCollections', error)
    }
  }

  /**
   * @operationName Delete Collection
   * @description Permanently deletes a face collection and all of the faces indexed within it. This action cannot be undone. Returns the operation status code.
   * @category Collections
   * @route POST /delete-collection
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Collection","name":"collectionId","required":true,"dictionary":"getCollectionsDictionary","description":"The ID of the collection to delete."}
   * @returns {Object}
   * @sampleResult {"statusCode":200}
   */
  async deleteCollection(collectionId) {
    if (!collectionId) throw new Error('collectionId is required.')

    try {
      const res = await this.sendJson('DeleteCollection', { CollectionId: collectionId })

      return { statusCode: res.StatusCode || null }
    } catch (error) {
      this.#handleError('deleteCollection', error)
    }
  }

  /**
   * @operationName Index Faces
   * @description Detects faces in an image and adds them to the specified collection as searchable face vectors, optionally tagging them with an external image ID. Returns the indexed face records and any faces that could not be indexed. Supply the image as an S3 object or an image/file URL (URLs are limited to 5 MB).
   * @category Collections
   * @route POST /index-faces
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Collection","name":"collectionId","required":true,"dictionary":"getCollectionsDictionary","description":"The ID of the collection to add faces to."}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":false,"description":"HTTP(S) or FlowRunner file URL of the image to index. Ignored when an S3 bucket and object name are provided. Max 5 MB."}
   * @paramDef {"type":"String","label":"S3 Bucket","name":"s3Bucket","required":false,"description":"Name of the S3 bucket holding the image. Use with S3 Object Name instead of an Image URL."}
   * @paramDef {"type":"String","label":"S3 Object Name","name":"s3Name","required":false,"description":"Key (path/filename) of the image object within the S3 bucket."}
   * @paramDef {"type":"String","label":"External Image ID","name":"externalImageId","required":false,"description":"Your own identifier (e.g. a user ID) to associate with the indexed faces for later reference in search results."}
   * @paramDef {"type":"Number","label":"Max Faces","name":"maxFaces","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of faces to index from the image, keeping the largest/highest-quality faces first."}
   * @paramDef {"type":"String","label":"Quality Filter","name":"qualityFilter","required":false,"defaultValue":"Auto","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Low","Medium","High","None"]}},"description":"How aggressively to filter out low-quality faces before indexing. 'Auto' lets Rekognition decide; 'None' disables filtering."}
   * @returns {Object}
   * @sampleResult {"faceRecords":[{"Face":{"FaceId":"a1b2c3","BoundingBox":{"Width":0.2,"Height":0.3,"Left":0.4,"Top":0.2},"ExternalImageId":"user-42","Confidence":99.9},"FaceDetail":{"Confidence":99.9}}],"unindexedFaces":[],"faceModelVersion":"7.0"}
   */
  async indexFaces(collectionId, imageUrl, s3Bucket, s3Name, externalImageId, maxFaces, qualityFilter) {
    if (!collectionId) throw new Error('collectionId is required.')

    try {
      const body = {
        CollectionId: collectionId,
        Image: await this.#buildImage(imageUrl, s3Bucket, s3Name),
      }

      if (externalImageId) body.ExternalImageId = externalImageId
      if (maxFaces) body.MaxFaces = maxFaces

      const quality = this.#resolveChoice(qualityFilter, { Auto: 'AUTO', Low: 'LOW', Medium: 'MEDIUM', High: 'HIGH', None: 'NONE' })

      if (quality) body.QualityFilter = quality

      const res = await this.sendJson('IndexFaces', body)

      return {
        faceRecords: res.FaceRecords || [],
        unindexedFaces: res.UnindexedFaces || [],
        faceModelVersion: res.FaceModelVersion || null,
      }
    } catch (error) {
      this.#handleError('indexFaces', error)
    }
  }

  /**
   * @operationName Search Faces by Image
   * @description Searches a collection for faces matching the largest face detected in the supplied image, returning matches above a similarity threshold. Use this to identify a person by comparing against previously indexed faces. Supply the image as an S3 object or an image/file URL (URLs are limited to 5 MB).
   * @category Collections
   * @route POST /search-faces-by-image
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Collection","name":"collectionId","required":true,"dictionary":"getCollectionsDictionary","description":"The ID of the collection to search."}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":false,"description":"HTTP(S) or FlowRunner file URL of the image whose face to search for. Ignored when an S3 bucket and object name are provided. Max 5 MB."}
   * @paramDef {"type":"String","label":"S3 Bucket","name":"s3Bucket","required":false,"description":"Name of the S3 bucket holding the image. Use with S3 Object Name instead of an Image URL."}
   * @paramDef {"type":"String","label":"S3 Object Name","name":"s3Name","required":false,"description":"Key (path/filename) of the image object within the S3 bucket."}
   * @paramDef {"type":"Number","label":"Face Match Threshold","name":"faceMatchThreshold","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Minimum similarity percentage (0-100) for a face to be returned as a match. Rekognition defaults to 80 when omitted."}
   * @paramDef {"type":"Number","label":"Max Faces","name":"maxFaces","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of matching faces to return, ordered by similarity (up to 4096)."}
   * @paramDef {"type":"String","label":"Quality Filter","name":"qualityFilter","required":false,"defaultValue":"Auto","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Low","Medium","High","None"]}},"description":"How aggressively to filter out a low-quality input face before searching. 'Auto' lets Rekognition decide; 'None' disables filtering."}
   * @returns {Object}
   * @sampleResult {"searchedFaceBoundingBox":{"Width":0.2,"Height":0.3,"Left":0.4,"Top":0.2},"searchedFaceConfidence":99.9,"faceMatches":[{"Similarity":99.1,"Face":{"FaceId":"a1b2c3","ExternalImageId":"user-42","Confidence":99.9}}],"faceModelVersion":"7.0"}
   */
  async searchFacesByImage(collectionId, imageUrl, s3Bucket, s3Name, faceMatchThreshold, maxFaces, qualityFilter) {
    if (!collectionId) throw new Error('collectionId is required.')

    try {
      const body = {
        CollectionId: collectionId,
        Image: await this.#buildImage(imageUrl, s3Bucket, s3Name),
      }

      if (faceMatchThreshold !== undefined && faceMatchThreshold !== null) body.FaceMatchThreshold = faceMatchThreshold
      if (maxFaces) body.MaxFaces = maxFaces

      const quality = this.#resolveChoice(qualityFilter, { Auto: 'AUTO', Low: 'LOW', Medium: 'MEDIUM', High: 'HIGH', None: 'NONE' })

      if (quality) body.QualityFilter = quality

      const res = await this.sendJson('SearchFacesByImage', body)

      return {
        searchedFaceBoundingBox: res.SearchedFaceBoundingBox || null,
        searchedFaceConfidence: res.SearchedFaceConfidence || null,
        faceMatches: res.FaceMatches || [],
        faceModelVersion: res.FaceModelVersion || null,
      }
    } catch (error) {
      this.#handleError('searchFacesByImage', error)
    }
  }

  /**
   * @operationName List Faces
   * @description Lists the faces indexed in a collection, returning each face's ID, bounding box, external image ID, and confidence. Supports pagination via cursor for collections with many faces.
   * @category Collections
   * @route POST /list-faces
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Collection","name":"collectionId","required":true,"dictionary":"getCollectionsDictionary","description":"The ID of the collection whose faces to list."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of faces to return (up to 4096)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination token returned by a previous call. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"faces":[{"FaceId":"a1b2c3","BoundingBox":{"Width":0.2,"Height":0.3,"Left":0.4,"Top":0.2},"ExternalImageId":"user-42","Confidence":99.9}],"cursor":null,"faceModelVersion":"7.0"}
   */
  async listFaces(collectionId, maxResults, cursor) {
    if (!collectionId) throw new Error('collectionId is required.')

    try {
      const body = { CollectionId: collectionId }

      if (maxResults) body.MaxResults = maxResults
      if (cursor) body.NextToken = cursor

      const res = await this.sendJson('ListFaces', body)

      return {
        faces: res.Faces || [],
        cursor: res.NextToken || null,
        faceModelVersion: res.FaceModelVersion || null,
      }
    } catch (error) {
      this.#handleError('listFaces', error)
    }
  }

  /**
   * @typedef {Object} getCollectionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to collection IDs."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token from a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Collections Dictionary
   * @description Provides a searchable list of Rekognition face collection IDs for dynamic dropdown selection in other operations.
   * @route POST /get-collections-dictionary
   * @paramDef {"type":"getCollectionsDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"my-faces","value":"my-faces"}],"cursor":null}
   */
  async getCollectionsDictionary(payload) {
    const { search, cursor } = payload || {}

    try {
      const body = { MaxResults: 100 }

      if (cursor) body.NextToken = cursor

      const res = await this.sendJson('ListCollections', body)
      let ids = res.CollectionIds || []

      if (search) {
        const lower = search.toLowerCase()

        ids = ids.filter(id => id.toLowerCase().includes(lower))
      }

      return {
        items: ids.map(id => ({ label: id, value: id })),
        cursor: res.NextToken || null,
      }
    } catch (error) {
      this.#handleError('getCollectionsDictionary', error)
    }
  }

  #handleError(method, error) {
    this.logger.error(`[${ method }]`, error && error.message)

    if (error && error.name === 'ResourceNotFoundException') {
      throw new Error(`Resource not found: ${ error.message }. Check the collection ID.`)
    }

    if (error && error.name === 'ResourceAlreadyExistsException') {
      throw new Error(`Collection already exists: ${ error.message }. Choose a different collection ID.`)
    }

    if (error && error.name === 'InvalidImageFormatException') {
      throw new Error(`Invalid image format: ${ error.message }. Rekognition supports JPEG and PNG images.`)
    }

    if (error && error.name === 'ImageTooLargeException') {
      throw new Error(`Image too large: ${ error.message }. Raw image bytes are limited to 5 MB; use an S3 object for larger images.`)
    }

    if (error && error.name === 'InvalidParameterException') {
      throw new Error(`Invalid request: ${ error.message }. Check the image input and parameters.`)
    }

    throw mapAwsError(error)
  }
}

if (typeof Flowrunner !== 'undefined') {
  Flowrunner.ServerCode.addService(Rekognition, awsConfigItems)
}

module.exports = { Rekognition }
