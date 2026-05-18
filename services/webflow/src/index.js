'use strict'

const AUTH_URL = 'https://webflow.com/oauth/authorize'
const ACCESS_TOKEN_URL = 'https://api.webflow.com/oauth/access_token'
const API_BASE_URL = 'https://api.webflow.com/v2'

const USER_SCOPE_LIST = [
  'authorized_user:read',
  'assets:read',
  'assets:write',
  'cms:read',
  'cms:write',
  'custom_code:read',
  'custom_code:write',
  'ecommerce:read',
  'ecommerce:write',
  'forms:read',
  'forms:write',
  'pages:read',
  'pages:write',
  'site_activity:read',
  'sites:read',
  'sites:write',
  'users:read',
  'users:write',
]

const MethodCallTypes = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

const ApiEventsMap = {
  form_submission: 'onFormSubmit',
  ecomm_new_order: 'onNewOrder',
  ecomm_order_changed: 'onOrderChanged',
}

const EventsMap = {
  onFormSubmit: 'form_submission',
  onNewOrder: 'ecomm_new_order',
  onOrderChanged: 'ecomm_order_changed',
}

const USER_SCOPE_STRING = USER_SCOPE_LIST.join(' ')

const logger = {
  info: (...args) => console.log('[Webflow Service] info:', ...args),
  debug: (...args) => console.log('[Webflow Service] debug:', ...args),
  error: (...args) => console.log('[Webflow Service] error:', ...args),
  warn: (...args) => console.log('[Webflow Service] warn:', ...args),
}

// Webflow field types: https://developers.webflow.com/data/v2.0.0/reference/field-types-item-values
const WebflowFieldTypes = {
  COLOR: 'Color',
  DATE_TIME: 'DateTime',
  EMAIL: 'Email',
  EXT_FILE_REF: 'ExtFileRef',
  FILE: 'File',
  IMAGE: 'Image',
  IMAGE_REF: 'ImageRef',
  ITEM_REF: 'ItemRef',
  LINK: 'Link',
  MULTI_IMAGE: 'MultiImage',
  MULTI_REFERENCE: 'MultiReference',
  NUMBER: 'Number',
  OPTION: 'Option',
  PHONE: 'Phone',
  PLAIN_TEXT: 'PlainText',
  REFERENCE: 'Reference',
  RICH_TEXT: 'RichText',
  SWITCH: 'Switch',
  USER: 'User',
  VIDEO_LINK: 'VideoLink',
}

/**
 *  @requireOAuth
 *  @integrationName Webflow
 *  @integrationTriggersScope SINGLE_APP
 *  @integrationIcon /icon.png
 **/
class WebflowService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.userScope = USER_SCOPE_STRING
  }

  /**
   * @route GET /getOAuth2ConnectionURL
   * @registerAs SYSTEM
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('response_type', 'code')
    params.append('client_id', this.clientId)
    params.append('scope', this.userScope)

    return `${ AUTH_URL }?${ params.toString() }`
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   */

  /**
   * @route PUT /refreshToken
   * @registerAs SYSTEM
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(/* refreshToken*/) {
    // WebFlow tokens do not expire
    return null
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @route POST /executeCallback
   * @registerAs SYSTEM
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    let codeExchangeResponse = {}

    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('code', callbackObject.code)
    params.append('grant_type', 'authorization_code')
    params.append('redirect_uri', callbackObject.redirectURI)

    try {
      codeExchangeResponse = await Flowrunner.Request.post(ACCESS_TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug(`[executeCallback] codeExchangeResponse response: ${ JSON.stringify(codeExchangeResponse, null, 2) }`)
    } catch (error) {
      logger.error(`[executeCallback] codeExchangeResponse error: ${ JSON.stringify(error, null, 2) }`)
    }

    let userInfo = {}

    try {
      userInfo = await Flowrunner.Request.get(`${ API_BASE_URL }/token/authorized_by`).set(
        this.#getAccessTokenHeader(codeExchangeResponse['access_token'])
      )

      logger.debug(`[executeCallback] userInfo response: ${ JSON.stringify(userInfo, null, 2) }`)
    } catch (error) {
      logger.error(`[executeCallback] userInfo error: ${ error.message }`)

      return {}
    }

    return {
      token: codeExchangeResponse['access_token'],
      connectionIdentityName: `${ userInfo.firstName } ${ userInfo.lastName } (${ userInfo.email })`,
      // connectionIdentityImageURL: 'IDENTIFY THE CONNECTION IMAGE URL HERE',
      overwrite: true, // Overwrites the connection if connectionIdentityName already exists.
      userData: {}, // Stores any relevant information about the authenticated account.
    }
  }

  /**
   * @description Retrieves detailed CMS collection schema for AI agents to understand content structure, build dynamic forms, or generate content based on field definitions. Essential for automated content management, schema-driven workflows, and CMS integration.
   *
   * @route POST /getCollectionDetails
   * @operationName Get Collection Schema Info
   * @category Collection Management
   *
   * @appearanceColor #1240FF #191970
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"Webflow site to analyze. Examples: 'My Portfolio Site', 'E-commerce Store', 'Company Website'. Select from available sites in your account."}
   * @paramDef {"type":"String","label":"Collection Name","name":"collection","required":true,"dictionary":"getCollectionsDictionary","dependsOn":["site"],"description":"CMS collection to examine. Examples: 'Blog Posts', 'Products', 'Team Members', 'Case Studies'. Choose from collections in the selected site."}
   *
   * @returns {Object} Collection schema information.
   * @sampleResult {"id":"example_id_1","displayName":"Example Display Name","singularName":"Example Singular Name","fields":[{"id":"example_field_id_1","isRequired":true,"type":"PlainText","displayName":"Example Field Name","isEditable":true,"slug":"example-field-slug"}],"slug":"example-slug","createdOn":"2023-01-01T00:00:00Z","lastUpdated":"2023-01-01T00:05:00Z"}
   */
  async getCollectionDetails(site, collection) {
    return await this.#apiRequest({
      logTag: 'getCollectionInfo',
      method: 'get',
      url: `${ API_BASE_URL }/collections/${ extractId(collection) }`,
    })
  }

  /**
   * @description Retrieves comprehensive site information for AI agents to access configuration data, manage multi-site workflows, or determine site capabilities. Perfect for site-aware automation, content publishing workflows, and site management operations.
   *
   * @route GET /getSiteDetails
   * @operationName Get Site Details
   * @category Site Management
   *
   * @appearanceColor #1240FF #191970
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"Target Webflow site. Examples: 'Corporate Website', 'Marketing Site', 'Client Portal'. Select the site to examine details for."}
   *
   * @returns {Object} Site information such as name, timezone, publish date, locales and custom domains.
   * @sampleResult {"id":"example_id_1","workspaceId":"example_workspace_id_1","createdOn":"2023-01-01T00:00:00Z","displayName":"Example Display Name","shortName":"example-short-name","lastPublished":"2023-01-01T00:05:00Z","lastUpdated":"2023-01-01T00:05:00Z","previewUrl":"https://example.com/preview.png","timeZone":"Example/TimeZone","parentFolderId":"example_folder_id_1","customDomains":[{"id":"example_domain_id_1","url":"example.com","lastPublished":"2023-01-01T00:00:00Z"}],"locales":{"primary":{"id":"example_locale_id_1","cmsLocaleId":"example_cms_locale_id_1","enabled":true,"displayName":"Example Locale","displayImageId":"example_image_id_1","redirect":false,"subdirectory":"","tag":"en-US"}},"dataCollectionEnabled":true,"dataCollectionType":"always"}
   */
  async getSiteDetails(site) {
    return await this.#apiRequest({
      logTag: 'getSiteDetails',
      method: 'get',
      url: `${ API_BASE_URL }/sites/${ extractId(site) }`,
    })
  }

  /**
   * @description Retrieves custom domains for AI agents to manage multi-domain deployments, configure DNS automation, or build domain-aware content strategies. Essential for enterprise site management and automated domain operations.
   *
   * @route GET /getCustomDomains
   * @operationName Get Site Domains
   * @category Site Management
   *
   * @appearanceColor #1240FF #191970
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"A site where to create a collection item."}
   *
   * @returns {Object} A collection (list) of custom domains assigned to the site.
   * @sampleResult [{"id":"example_id_1","url":"example.com","lastPublished":"2023-01-01T00:00:00Z"},{"id":"example_id_2","url":"example.org","lastPublished":"2023-01-01T00:05:00Z"}]

   */
  async getSiteDomains(site) {
    const response = await this.#apiRequest({
      logTag: 'getSiteDetails',
      method: 'get',
      url: `${ API_BASE_URL }/sites/${ extractId(site) }/custom_domains`,
    })

    return response.customDomains
  }

  /**
   * @description Publishes site changes for AI agents to automate content deployment, trigger post-publish workflows, or manage staged content releases. Critical for automated publishing pipelines and content delivery automation.
   *
   * @route POST /publishSite
   * @operationName Publish Site
   * @category Site Management
   *
   * @appearanceColor #1240FF #191970
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"Site to publish live. Examples: 'Production Site', 'Client Website', 'Marketing Landing Pages'. This will make all staged changes visible to visitors."}
   *
   * @returns {Object} Returns a list of domains the site is published to.
   * @sampleResult {"customDomains": [{"id": "example_id_b89d", "url": "test-api-domain.com", "lastPublished": "2022-12-07T16:51:37Z"}], "publishToWebflowSubdomain": true}

   */
  async publishSite(site) {
    const response = await this.#apiRequest({
      logTag: 'publishSite',
      method: 'post',
      url: `${ API_BASE_URL }/sites/${ extractId(site) }/publish`,
    })

    return response
  }

  /**
   * @description Creates new CMS collections for AI agents to build dynamic content structures, generate database schemas, or establish content management systems. Perfect for automated site setup, content architecture generation, and CMS configuration workflows.
   *
   * @route POST /createCollection
   * @operationName Create Collection
   * @category Collection Management
   *
   * @appearanceColor #1240FF #191970
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"Target site for new collection. Examples: 'Blog Site', 'E-commerce Platform', 'Portfolio Website'. Choose where to create the content structure."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"description":"Human-readable collection name. Examples: 'Blog Posts', 'Product Catalog', 'Team Members', 'Client Testimonials'. This appears in the CMS interface."}
   * @paramDef {"type":"String","label":"Singular Name","name":"singularName","required":true,"description":"Singular form of collection name. Examples: 'Blog Post', 'Product', 'Team Member', 'Testimonial'. Used for individual items in the collection."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","required":true,"description":"URL-friendly collection identifier. Examples: 'blog-posts', 'products', 'team-members', 'testimonials'. Used in dynamic page URLs."}
   * @paramDef {"type":"Array","label":"Fields Collection","name":"fieldsCollection","required":true,"description":"Array of field definitions for the collection schema. Examples: [{displayName: 'Content', type: 'RichText'}, {displayName: 'Featured Image', type: 'Image'}]. Webflow auto-creates 'name' and 'slug' fields if not specified."}
   *
   * @returns {Object} The newly created collection object.
   * @sampleResult {"id":"example_id_1","displayName":"Example Display Name","singularName":"Example Singular Name","fields":[],"slug":"example-slug","createdOn":"2023-01-01T00:00:00Z","lastUpdated":"2023-01-01T00:05:00Z"}
   */
  async createCollection(site, displayName, singularName, slug, fieldsCollection) {
    // Build the payload using the provided arguments.
    const collectionPayload = {
      displayName,
      singularName,
      slug,
      fields: fieldsCollection,
    }

    const response = await this.#apiRequest({
      logTag: 'createCollection',
      method: 'post',
      url: `${ API_BASE_URL }/sites/${ extractId(site) }/collections`,
      body: collectionPayload,
    })

    return response
  }

  /**
   * @description Creates structured field definitions for AI agents to build dynamic content schemas, generate form structures, or define data types programmatically. Essential for automated CMS setup, schema generation, and content modeling workflows.
   *
   * @route POST /createFieldDefinition
   * @operationName Create Field Definition
   * @category Collection Field Management
   *
   * @appearanceColor #1240FF #191970
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"description":"Field name shown in CMS. Examples: 'Article Content', 'Featured Image', 'Author Name', 'Publication Date'. This appears in the content editor."}
   * @paramDef {"type":"String","label":"Field Type","name":"type","required":true, "uiComponent": {"type":"DROPDOWN", "options":{ "values":["Color", "DateTime", "Email", "File", "Image", "Link", "MultiImage", "Number", "Phone", "PlainText", "RichText", "Switch", "Video"] }}, "description":"Data type of the field."}
   * @paramDef {"type":"Boolean","label":"Is Required?","name":"isRequired","required":false,"description":"Is the field required?", "uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"String","label":"Help Text","name":"helpText","required":false,"description":"Help text displayed for the field in the WebFlow system."}
   *
   * @returns {Object} A key/value structure defining the field.
   * @sampleResult {"isRequired": true, "type": "RichText", "displayName": "Content", "helpText": "Example content"}
   */
  async createFieldDefinition(displayName, type, isRequired, helpText) {
    return { displayName, type, isRequired, helpText }
  }

  /**
   * @description Removes CMS collections for AI agents to clean up unused content structures, manage schema migrations, or automate content architecture changes. Important for site maintenance, content reorganization, and automated cleanup workflows.
   *
   * @route DELETE /deleteCollection
   * @operationName Delete Collection
   * @category Collection Management
   *
   * @appearanceColor #1240FF #191970
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"The site from which the collection will be deleted."}
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","dependsOn":["site"],"description":"The collection to delete."}
   *
   * @returns {void}

   */
  async deleteCollection(site, collection) {
    await this.#apiRequest({
      logTag: 'deleteCollection',
      method: 'delete',
      url: `${ API_BASE_URL }/collections/${ extractId(collection) }`,
    })
  }

  /**
   * @description Adds fields to existing collections for AI agents to extend content schemas, enhance data structures, or modify content models dynamically. Perfect for schema evolution, content enhancement, and automated field management.
   *
   * @route POST /createCollectionField
   * @operationName Create Collection Field
   * @category Collection Field Management
   *
   * @appearanceColor #1240FF #191970
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"The site containing the collection."}
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","dependsOn":["site"],"description":"The collection where the new field will be created."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"description":"The display name for the new field."}
   * @paramDef {"type":"String","label":"Field Type","name":"fieldType","required":true, "uiComponent": {"type":"DROPDOWN", "options":{ "values":["Color", "DateTime", "Email", "File", "Image", "Link", "MultiImage", "Number", "Phone", "PlainText", "RichText", "Switch", "Video"] }}, "description":"The data type of the field. E.g., PlainText, RichText, etc."}
   * @paramDef {"type":"Boolean","label":"Is Required?","name":"isRequired","required":false,"uiComponent":{"type":"TOGGLE"}, "description":"Indicates if the field is required."}
   * @paramDef {"type":"String","label":"Help Text","name":"helpText","required":false,"description":"Help text for the field."}
   *
   * @returns {Object} The newly created collection field object.
   * @sampleResult {"id": "example_id_00a1e2f34", "displayName": "Content", "slug": "content", "type": "RichText", "isRequired": true, "helpText": "Example content", "createdOn": "2023-04-02T12:42:00Z", "lastUpdated": "2023-04-02T12:42:00Z"}
   */
  async createCollectionField(site, collection, displayName, fieldType, isRequired, helpText) {
    // Build the payload using the provided arguments.
    const fieldPayload = {
      displayName,
      type: fieldType,
      isRequired,
      helpText,
    }

    const response = await this.#apiRequest({
      logTag: 'createCollectionField',
      method: 'post',
      url: `${ API_BASE_URL }/collections/${ extractId(collection) }/fields`,
      body: fieldPayload,
    })

    return response
  }

  /**
   * @description Modifies collection field properties for AI agents to refine content schemas, update field requirements, or enhance data validation. Essential for schema maintenance, content model evolution, and automated field updates.
   *
   * @route PUT /updateCollectionField
   * @operationName Update Collection Field
   * @category Collection Field Management
   *
   * @appearanceColor #1240FF #191970
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"The site containing the collection."}
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","dependsOn":["site"],"description":"The collection containing the field to update."}
   * @paramDef {"type":"String","label":"Field ID","name":"field","required":true,"dictionary":"getFieldsDictionary", "dependsOn":["collection"], "description":"The unique identifier of the field to update."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":false,"description":"The new display name for the field."}
   * @paramDef {"type":"String","label":"Field Type","name":"fieldType","required":false, "uiComponent": {"type":"DROPDOWN", "options":{ "values":["Color", "DateTime", "Email", "File", "Image", "Link", "MultiImage", "Number", "Phone", "PlainText", "RichText", "Switch", "Video"] }}, "description":"The new data type of the field. E.g., PlainText, RichText, etc."}
   * @paramDef {"type":"Boolean","label":"Is Required?","name":"isRequired","required":false,"uiComponent":{"type":"TOGGLE"}, "description":"Indicates if the field is required."}
   * @paramDef {"type":"String","label":"Help Text","name":"helpText","required":false,"description":"New help text for the field."}
   *
   * @returns {Object} The updated collection field object.
   * @sampleResult {"id": "example_id_1c2b3000a1e2f34", "displayName": "Updated Content", "slug": "content", "type": "RichText", "isRequired": true, "helpText": "Updated help text", "createdOn": "2023-04-02T12:42:00Z", "lastUpdated": "2023-04-02T12:42:00Z"}
   */
  async updateCollectionField(site, collection, field, displayName, fieldType, isRequired, helpText) {
    // Build the payload using the provided arguments.
    const fieldPayload = cleanupObject({
      displayName,
      helpText,
      type: fieldType,
      isRequired: !!isRequired,
    })

    const response = await this.#apiRequest({
      logTag: 'updateCollectionField',
      method: 'patch',
      url: `${ API_BASE_URL }/collections/${ extractId(collection) }/fields/${ extractId(field) }`,
      body: fieldPayload,
    })

    return response
  }

  /**
   * @description Removes fields from collections for AI agents to streamline content schemas, perform cleanup operations, or manage schema migrations. Important for content model optimization and automated field management.
   *
   * @route DELETE /deleteCollectionField
   * @operationName Delete Collection Field
   * @category Collection Field Management
   *
   * @appearanceColor #1240FF #191970
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"The site containing the collection."}
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","dependsOn":["site"],"description":"The collection containing the field to delete."}
   * @paramDef {"type":"String","label":"Field","name":"field","required":true,"dictionary":"getFieldsDictionary", "dependsOn":["collection"], "description":"The field to delete."}
   */
  async deleteCollectionField(site, collection, field) {
    const response = await this.#apiRequest({
      logTag: 'deleteCollectionField',
      method: 'delete',
      url: `${ API_BASE_URL }/collections/${ extractId(collection) }/fields/${ extractId(field) }`,
    })

    return response
  }

  /**
   * @description Retrieves collection items for AI agents to analyze content, process data at scale, or build content-driven workflows. Perfect for content auditing, bulk operations, and automated content processing pipelines.
   *
   * @route GET /getCollectionItems
   * @operationName Get Collection Items
   * @category Collection Item Management
   *
   * @appearanceColor #1240FF #191970
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"The site containing the collection."}
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","dependsOn":["site"],"description":"The collection whose staged items are to be listed."}
   * @paramDef {"type":"Boolean","label":"Retrieve Only Published Items","name":"publishedOnly","required":false,"uiComponent":{"type":"TOGGLE"}, "description":"If selected, the action will retrieve only published items, otherwise, all items are returned."}
   * @paramDef {"type":"String","label":"Sort Results By","name":"sortBy","required":false, "uiComponent": {"type":"DROPDOWN", "options":{ "values":["lastPublished", "name","slug"] } }}
   * @paramDef {"type":"Boolean","label":"Include Metadata","name":"includeMeta","required":false,"uiComponent":{"type":"TOGGLE"}, "description":"If selected, the response will include metadata for every item. The metadata consists of the following properties - createdOn, lastUpdated, lastPublished, cmsLocaleId, isArchived, and isDraft."}
   * @paramDef {"type":"Numeric","label":"Offset","name":"offset","required":false,"description":"Optional pagination offset for retrieving additional items."}

   * @returns {Object} The list of either all or onnly published items fron the collection.
   * @sampleResult {"items": [{"_id": "example_id_00a1e2f34", "fieldData": {}}], "cursor": "example_cursor_abc123"}
   */
  async getCollectionItems(site, collection, publishedOnly, sortBy, includeMeta, offset, returnPagination) {
    const query = {}

    if (sortBy) {
      query.sortBy = sortBy
    }

    if (offset) {
      query.offset = offset
    }

    // Determine the URL suffix based on the publishedOnly flag.
    const urlSuffix = publishedOnly ? '/live' : ''

    const response = await this.#apiRequest({
      logTag: 'listCollectionItems',
      method: 'get',
      url: `${ API_BASE_URL }/collections/${ extractId(collection) }/items${ urlSuffix }`,
      query: query,
    })

    const pagination = response.pagination
    const items = response.items

    const mappedItems = items.map(item => {
      // Destructure fieldData from the rest of the item properties.
      const { id, fieldData, ...metadata } = item

      // Create a new object with the fieldData properties at the top level,
      // and nest the remaining properties under "itemMetadata".
      return includeMeta ? { id, ...fieldData, itemMetadata: metadata } : { id, ...fieldData }
    })

    return returnPagination ? { items: mappedItems, pagination } : mappedItems
  }

  /**
   * @description Creates new collection items for AI agents to populate content databases, generate pages programmatically, or automate content creation workflows. Essential for automated publishing, content generation, and bulk content operations.
   *
   * @route POST /createCollectionItem
   * @operationName Create Collection Item
   * @category Collection Item Management
   *
   * @appearanceColor #1240FF #191970
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"A site where to create a collection item."}
   * @paramDef {"type":"String","label":"Collection Name","name":"collection","required":true,"dictionary":"getCollectionsDictionary","dependsOn":["site"],"description":"A collection where to create an item."}
   * @paramDef {"type":"Object","label":"Item Data","name":"fields","required":true,"schemaLoader":"getCollectionItemFieldsSchema","dependsOn":["collection"],"description":"Collection item data. Must be an object. The object must contain the \"name\" and \"slug\" properties, and may include additional fields matching your collection's schema definition. Make sure to reference other fields by the assigned \"slug\" values."}
   * @paramDef {"type":"Boolean","label":"Publish Live","name":"publishLive","required":false,"uiComponent":{"type":"TOGGLE"}, "description":"If selected, the item will be immediately published to the live site, otherwise, the item is created as Staged."}

   * @returns {Object} The saved item in the collection.
   */
  async createCollectionItem(site, collection, fields, publishLive) {
    // Determine the URL suffix based on the publishedOnly flag.
    const urlSuffix = publishLive ? '/live' : ''

    const response = await this.#apiRequest({
      logTag: 'createCollectionItem',
      method: 'post',
      url: `${ API_BASE_URL }/collections/${ extractId(collection) }/items${ urlSuffix }`,
      body: {
        isArchived: false,
        isDraft: false,
        fieldData: fields,
      },
    })
    // Destructure fieldData from the rest of the item properties.
    const { id, fieldData, ...metadata } = response

    // Create a new object with the fieldData properties at the top level,
    // and nest the remaining properties under "itemMetadata".
    return { id, ...fieldData, itemMetadata: metadata }
  }

  /**
   * @description Updates existing collection items for AI agents to maintain content accuracy, process content modifications, or manage automated content updates. Critical for content maintenance, data synchronization, and automated editing workflows.
   *
   * @route POST /updateCollectionItem
   * @operationName Update Collection Item
   * @category Collection Item Management
   *
   * @appearanceColor #1240FF #191970
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"A site where to update a collection item."}
   * @paramDef {"type":"String","label":"Collection Name","name":"collection","required":true,"dictionary":"getCollectionsDictionary","dependsOn":["site"],"description":"A collection where to update an item."}
   * @paramDef {"type":"String","label":"Item to Update","name":"item","required":false,"dictionary":"getItemsDictionary","dependsOn":["collection"],"description":"A collection of items to select an item to update. Use either item selector popup or Expression Editor to identify an item to update. If an expression is used, it must evaluate to the `id` of the item to update."}
   * @paramDef {"type":"Object","label":"Item Data","name":"fields","required":true, "description":"Data to update. Must be an object containing the properties which will be updated for the identified item in the collection. "}
   * @paramDef {"type":"Boolean","label":"Publish Live","name":"publishLive","required":false,"uiComponent":{"type":"TOGGLE"}, "description":"If selected, the updated item will be immediately published to the live site, otherwise, the item is update in the Stage environment."}

   * @returns {Object} The updated item in the collection.
   */
  async updateCollectionItem(site, collection, item, fields, publishLive) {
    // Determine the URL suffix based on the publishedOnly flag.
    const urlSuffix = publishLive ? '/live' : ''

    logger.debug(`[updateCollectionItem]  incoming fields: ${ JSON.stringify(fields, null, 2) }`)
    logger.debug(`[updateCollectionItem]  incoming item: ${ JSON.stringify(item, null, 2) }`)

    const itemId = item ? extractId(item) : fields.id
    delete fields.id
    delete fields.itemMetadata

    const response = await this.#apiRequest({
      logTag: 'updateCollectionItem',
      method: 'patch',
      url: `${ API_BASE_URL }/collections/${ extractId(collection) }/items/${ itemId }${ urlSuffix }`,
      body: {
        isArchived: false,
        isDraft: false,
        fieldData: fields,
      },
    })
    // Destructure fieldData from the rest of the item properties.
    const { id, fieldData, ...metadata } = response

    // Create a new object with the fieldData properties at the top level,
    // and nest the remaining properties under "itemMetadata".
    return { id, ...fieldData, itemMetadata: metadata }
  }

  /**
   * @description Removes collection items for AI agents to clean up outdated content, manage content lifecycle, or automate content pruning. Important for content management, automated cleanup, and data maintenance workflows.
   *
   * @route DELETE /deleteCollectionItem
   * @operationName Delete Collection Item
   * @category Collection Item Management
   *
   * @appearanceColor #1240FF #191970
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"A site where to delete a collection item."}
   * @paramDef {"type":"String","label":"Collection Name","name":"collection","required":true,"dictionary":"getCollectionsDictionary","dependsOn":["site"],"description":"A collection where to delete an item."}
   * @paramDef {"type":"String","label":"Item to Delete","name":"item","required":true,"dictionary":"getItemsDictionary","dependsOn":["collection"],"description":"A collection of items to select an item to delete. Use either item selector popup or Expression Editor to identify an item to update. If an expression is used, it must evaluate to the `id` of the item to delete."}
   * @paramDef {"type":"Boolean","label":"Delete a Live Item","name":"deleteInLive","required":false,"uiComponent":{"type":"TOGGLE"}, "description":"If selected, the updated item will be immediately published to the live site, otherwise, the item is update in the Stage environment."}
   */
  async deleteCollectionItem(site, collection, item, deleteInLive) {
    // Determine the URL suffix based on the publishedOnly flag.
    const urlSuffix = deleteInLive ? '/live' : ''

    return this.#apiRequest({
      logTag: 'deleteCollectionItem',
      method: 'delete',
      url: `${ API_BASE_URL }/collections/${ extractId(collection) }/items/${ extractId(item) }${ urlSuffix }`,
    })
  }

  /**
   * @description Retrieves form submissions for AI agents to process user input, analyze form data, or build automated response systems. Perfect for lead processing, form analytics, and automated customer interaction workflows.
   *
   * @route GET /getFormSubmissions
   * @operationName Get Form Submissions
   * @category Form Management
   *
   * @appearanceColor #1240FF #191970
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"A site where to retrieve form submissions."}
   * @paramDef {"type":"String","label":"Form","name":"form","required":true,"dictionary":"getFormsDictionary","dependsOn":["site"],"description":"A form for which to retrieve the submissions for."}
   * @paramDef {"type":"Numeric","label":"Offset","name":"offset","required":false,"description":"Offset used for pagination if the results have more than 100 records."}
   * @paramDef {"type":"Boolean","label":"Include Metadata","name":"includeMeta","required":false,"uiComponent":{"type":"TOGGLE"}, "description":"If selected, the response will include metadata for every submission. The metadata consists of the following properties - displayName, siteId, workspaceId, and dateSubmitted."}

   */
  async getFormSubmissions(site, form, offset, includeMeta) {
    const response = await this.#apiRequest({
      logTag: 'getFormSubmissions',
      method: 'get',
      url: `${ API_BASE_URL }/forms/${ extractId(form) }/submissions`,
    })

    return response.formSubmissions.map(submission => {
      // Destructure fieldData from the rest of the item properties.
      const { id, formResponse, ...metadata } = submission

      // Create a new object with the fieldData properties at the top level,
      // and nest the remaining properties under "itemMetadata".
      return includeMeta
        ? { id, ...formResponse, itemMetadata: metadata }
        : { id, ...formResponse }
    })
  }

  /**
   * @description Removes form submissions for AI agents to manage data retention, clean up processed entries, or maintain submission databases. Essential for data privacy compliance and automated submission management.
   *
   * @route DELETE /deleteFormSubmission
   * @operationName Delete Form Submission
   * @category Form Management
   *
   * @appearanceColor #1240FF #191970
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"A site where to delete a form submission."}
   * @paramDef {"type":"String","label":"Form","name":"form","required":true,"dictionary":"getFormsDictionary","dependsOn":["site"],"description":"A form for which to delete a submission."}
   * @paramDef {"type":"String","label":"Submission","name":"submissionId","required":true,"description":"Id of a form submission to delete."}
   */
  async deleteFormSubmission(site, form, submissionId) {
    return this.#apiRequest({
      logTag: 'deleteFormSubmission',
      method: 'delete',
      url: `${ API_BASE_URL }/form_submissions/${ submissionId }`,
    })
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken }`,
    }
  }

  #resolveAccessTokens() {
    if (this.accessTokensResolved) {
      return
    }

    this.userAccessToken = this.request.headers['oauth-access-token']
    this.accessTokensResolved = true
  }

  async #apiRequest({ url, method, body, query, logTag, headers }) {
    this.#resolveAccessTokens()

    method = method || 'get'

    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)
      logger.debug(`${ logTag } - api request body: [${ JSON.stringify(body) }]`)

      const reqHeaders = Object.assign(this.#getAccessTokenHeader(this.userAccessToken), headers)

      return await Flowrunner.Request[method](url)
        .set(reqHeaders)
        .query(query)
        .send(body)
    } catch (error) {
      // Handle Webflow API errors with detailed information
      if (error.body) {
        logger.debug(`${ logTag } - api error status: ${ error.status }`)
        logger.debug(`${ logTag } - api error body: ${ JSON.stringify(error.body) }`)

        // Build a comprehensive error message including details
        let errorMessage = error.body?.message || error.message || 'Unknown error'

        if (error.body?.details && Array.isArray(error.body.details) && error.body.details.length > 0) {
          const details = error.body.details.map(d => `${ d.param }: ${ d.description }`).join('; ')
          errorMessage = `${ errorMessage }. Details: ${ details }`
        }

        // Throw an error with all relevant information
        const enhancedError = new Error(errorMessage)
        enhancedError.status = error.status
        enhancedError.code = error.body?.code || error.code
        enhancedError.details = error.body?.details
        throw enhancedError
      }

      logger.error(`${ logTag } - error: ${ error.message }`)
      throw error
    }
  }

  #getUiComponentForFieldType(fieldType) {
    switch (fieldType) {
      case WebflowFieldTypes.SWITCH:
        return { type: 'TOGGLE' }
      case WebflowFieldTypes.RICH_TEXT:
        return { type: 'MULTI_LINE_TEXT' }
      case WebflowFieldTypes.NUMBER:
        return { type: 'NUMERIC_STEPPER' }
      case WebflowFieldTypes.DATE_TIME:
        return { type: 'DATE_TIME_PICKER' }
      default:
        return { type: 'SINGLE_LINE_TEXT' }
    }
  }

  #getParamTypeForFieldType(fieldType) {
    switch (fieldType) {
      case WebflowFieldTypes.NUMBER:
        return 'Number'
      case WebflowFieldTypes.SWITCH:
        return 'Boolean'
      case WebflowFieldTypes.MULTI_IMAGE:
      case WebflowFieldTypes.EXT_FILE_REF:
      case WebflowFieldTypes.MULTI_REFERENCE:
        return 'Array'
      case WebflowFieldTypes.PLAIN_TEXT:
      case WebflowFieldTypes.RICH_TEXT:
      case WebflowFieldTypes.EMAIL:
      case WebflowFieldTypes.PHONE:
      case WebflowFieldTypes.LINK:
      case WebflowFieldTypes.COLOR:
      case WebflowFieldTypes.VIDEO_LINK:
      case WebflowFieldTypes.DATE_TIME:
      case WebflowFieldTypes.USER:
        return 'String'
      case WebflowFieldTypes.FILE:
      case WebflowFieldTypes.IMAGE:
      case WebflowFieldTypes.IMAGE_REF:
      case WebflowFieldTypes.OPTION:
      case WebflowFieldTypes.REFERENCE:
      case WebflowFieldTypes.ITEM_REF:
        return 'Object'
      default:
        return 'any'
    }
  }

  // ======================================= DYNAMIC PARAM SCHEMA LOADERS ========================

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"Object","name":"payload","required":true}
   * @returns {Array}
   */
  async getCollectionItemFieldsSchema({ criteria }) {
    const { collection } = criteria

    if (!collection) {
      return []
    }

    const collectionDetails = await this.getCollectionDetails(null, collection)

    return collectionDetails.fields.map(field => {
      const baseDescription = field.helpText
      let description

      switch (field.type) {
        case WebflowFieldTypes.PLAIN_TEXT:
          description = baseDescription || 'Plain text without formatting'
          break
        case WebflowFieldTypes.RICH_TEXT:
          description = baseDescription || 'Long-form text with HTML formatting.'
          break
        case WebflowFieldTypes.IMAGE:
        case WebflowFieldTypes.IMAGE_REF:
          description = baseDescription || 'Image object with url and optional alt properties'
          break
        case WebflowFieldTypes.MULTI_IMAGE:
          description = baseDescription || 'Array of image objects with url and optional alt properties'
          break
        case WebflowFieldTypes.FILE:
          description = baseDescription || 'File object with url and optional alt properties'
          break
        case WebflowFieldTypes.EXT_FILE_REF:
          description = baseDescription || 'Array of external file references'
          break
        case WebflowFieldTypes.VIDEO_LINK:
          description = baseDescription || 'Video URL (YouTube, Vimeo, etc.)'
          break
        case WebflowFieldTypes.LINK:
          description = baseDescription || 'URL string'
          break
        case WebflowFieldTypes.EMAIL:
          description = baseDescription || 'Email address'
          break
        case WebflowFieldTypes.PHONE:
          description = baseDescription || 'Phone number'
          break
        case WebflowFieldTypes.NUMBER:
          description = baseDescription || 'Numeric value'
          break
        case WebflowFieldTypes.DATE_TIME:
          description = baseDescription || 'Date and time in ISO 8601 format'
          break
        case WebflowFieldTypes.SWITCH:
          description = baseDescription || 'Boolean value (true/false)'
          break
        case WebflowFieldTypes.COLOR:
          description = baseDescription || 'Color value (HEX, RGB, HSL, or named color)'
          break
        case WebflowFieldTypes.OPTION:
          description = baseDescription || 'Option ID from predefined list of choices'
          break
        case WebflowFieldTypes.REFERENCE:
        case WebflowFieldTypes.ITEM_REF:
          description = baseDescription || 'Reference to another collection item (Item ID)'
          break
        case WebflowFieldTypes.MULTI_REFERENCE:
          description = baseDescription || 'Array of Item IDs referencing other collection items'
          break
        case WebflowFieldTypes.USER:
          description = baseDescription || 'Read-only user ID field'
          break
        default:
          description = baseDescription || `Field type: "${ field.type }"`
      }

      return {
        type: this.#getParamTypeForFieldType(field.type),
        label: field.displayName,
        name: field.slug,
        required: field.isRequired,
        description: description,
        uiComponent: this.#getUiComponentForFieldType(field.type),
      }
    })
  }

  // ======================================= END OF DYNAMIC PARAM SCHEMA LOADERS =================

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {String} [cursor]
   * @property {Object} [criteria]
   */

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @typedef {Object} getSitesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter sites by their display name or ID. Filtering is performed locally on retrieved results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sites
   * @description Returns a list of Webflow sites available to the authorized user. Note: search functionality filters sites only within the current set of results.
   *
   * @route POST /get-sites
   *
   * @paramDef {"type":"getSitesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering sites."}
   *
   * @sampleResult {"items":[{"label":"My Site","value":"My Site (ID: abcd1234)","note":"ID: abcd1234"}]}
   * @returns {DictionaryResponse}
   */
  async getSitesDictionary({ search }) {
    const sites = await this.#apiRequest({
      logTag: 'getSites',
      method: 'get',
      url: `${ API_BASE_URL }/sites`,
    })

    let filteredSites = sites.sites

    if (search) {
      search = search.toLowerCase()

      filteredSites = sites.sites.filter(c => {
        return c.displayName?.toLowerCase().includes(search) || c.id?.toLowerCase() === search
      })
    }

    return {
      items: filteredSites.map(site => {
        return {
          label: site.displayName,
          value: `${ site.displayName } (ID: ${ site.id })`,
          note: `ID: ${ site.id }`,
        }
      }),
    }
  }

  /**
   * @typedef {Object} getCollectionsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"description":"Unique identifier of the Webflow site whose collections will be listed."}
   */

  /**
   * @typedef {Object} getCollectionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter collections by their display name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getCollectionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Webflow site."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Collections
   * @description Returns a list of collections for the specified Webflow site. Note: search functionality filters collections only within the current set of results.
   *
   * @route POST /get-collections
   *
   * @paramDef {"type":"getCollectionsDictionary__payload","label":"Payload","name":"payload","description":"Contains site ID and optional search string for filtering collections."}
   *
   * @sampleResult {"items":[{"label":"Blog Posts","value":"Blog Posts (ID: xyz789)","note":"ID: xyz789"}]}
   * @returns {DictionaryResponse}
   */
  async getCollectionsDictionary({ search, criteria: { site } }) {
    const collections = await this.#apiRequest({
      logTag: 'getCollections',
      method: 'get',
      url: `${ API_BASE_URL }/sites/${ extractId(site) }/collections`,
    })

    let filteredCollections = collections.collections

    if (search) {
      search = search.toLowerCase()

      filteredCollections = collections.collections.filter(c => {
        return c.displayName?.toLowerCase().includes(search) || c.id?.toLowerCase() === search
      })
    }

    return {
      items: filteredCollections.map(collection => {
        return {
          label: collection.displayName,
          value: `${ collection.displayName } (ID: ${ collection.id })`,
          note: `ID: ${ collection.id }`,
        }
      }),
    }
  }

  /**
   * @typedef {Object} getFieldsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"description":"Unique identifier of the Webflow collection whose fields will be listed."}
   */

  /**
   * @typedef {Object} getFieldsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter fields by their display name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getFieldsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Webflow collection."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Fields
   * @description Returns a list of fields for the specified Webflow collection. Note: search functionality filters fields only within the current set of results.
   *
   * @route POST /get-fields
   *
   * @paramDef {"type":"getFieldsDictionary__payload","label":"Payload","name":"payload","description":"Contains collection ID and optional search string for filtering fields."}
   *
   * @sampleResult {"items":[{"label":"Title","value":"Title (ID: field123)","note":"ID: field123"}]}
   * @returns {DictionaryResponse}
   */
  async getFieldsDictionary({ search, criteria: { collection } }) {
    const collectionDetails = await this.getCollectionDetails(null, collection)

    let filteredFields = collectionDetails.fields

    if (search) {
      search = search.toLowerCase()

      filteredFields = collectionDetails.fields.filter(c => {
        return c.displayName?.toLowerCase().includes(search) || c.id?.toLowerCase() === search
      })
    }

    return {
      items: filteredFields.map(field => {
        return {
          label: field.displayName,
          value: `${ field.displayName } (ID: ${ field.id })`,
          note: `ID: ${ field.id }`,
        }
      }),
    }
  }

  /**
   * @registerAs DICTIONARY
   *
   * @param {DictionaryPayload} payload
   * @returns {DictionaryResponse}
   */
  async getItemsDictionary({ search, cursor, criteria: { collection } }) {
    const items = await this.getCollectionItems(null, collection, false, undefined, false, cursor, true)

    let filteredItems = items.items
    const pagination = items.pagination

    if (search) {
      search = search.toLowerCase()

      filteredItems = items.filter(i => {
        return i.name?.toLowerCase().includes(search) || i.id?.toLowerCase() === search
      })
    }

    cursor = pagination.total > items.items.length ? cursor + items.items.length : undefined

    return {
      cursor: cursor,
      items: filteredItems.map(item => {
        return {
          label: item.name,
          value: `${ item.name } (ID: ${ item.id })`,
          note: `ID: ${ item.id }`,
        }
      }),
    }
  }

  /**
   * @typedef {Object} getFormsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"description":"Unique identifier of the Webflow site whose forms will be listed."}
   */

  /**
   * @typedef {Object} getFormsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter forms by their display name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results. Use the returned cursor to fetch additional forms."}
   * @paramDef {"type":"getFormsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Webflow site."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Forms
   * @description Returns a paginated list of forms from the specified Webflow site. Note: search functionality filters forms only within the current page of results. Use the cursor to paginate through all available forms.
   *
   * @route POST /get-forms
   *
   * @paramDef {"type":"getFormsDictionary__payload","label":"Payload","name":"payload","description":"Contains site ID, optional search string, and pagination cursor for retrieving and filtering forms."}
   *
   * @sampleResult {"cursor":"15","items":[{"label":"Contact Us (page: Homepage)","value":"Contact Us (ID: wflow456)","note":"ID: wflow456"}]}
   * @returns {DictionaryResponse}
   */
  async getFormsDictionary({ search, cursor, criteria: { site } }) {
    const collections = await this.#apiRequest({
      logTag: 'getFormsCollection',
      method: 'get',
      url: `${ API_BASE_URL }/sites/${ extractId(site) }/forms`,
      query: { offset: cursor },
    })

    let forms = collections.forms

    if (search) {
      search = search.toLowerCase()

      forms = collections.collections.filter(form => {
        return form.displayName?.toLowerCase().includes(search) || form.id?.toLowerCase() === search
      })
    }

    return {
      cursor: collections.pagination.total > forms.length ? cursor + forms.length : undefined,
      items: forms.map(form => {
        return {
          label: `${ form.displayName } (page: ${ form.pageName })`,
          value: `${ form.displayName } (ID: ${ form.id })`,
          note: `ID: ${ form.id }`,
        }
      }),
    }
  }

  // ======================================= END OF DICTIONARIES =======================================

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    const methodName = ApiEventsMap[invocation.body.triggerType]
    const events = await this[methodName](MethodCallTypes.SHAPE_EVENT, invocation)

    return {
      connectionId: invocation.queryParams.connectionId,
      events,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    const repo = new WebhookRepo(invocation.webhookData?.webhooks)

    const unusedWebhooks = repo.getUnusedWebhooks(invocation.events)
    const webhooksToCreate = repo.getWebhooksToCreate(invocation.events)

    const deletePromises = unusedWebhooks.map(async webhook => {
      repo.deleteWebhook(webhook)

      await this.#deleteWebhook(webhook.id)
    })

    const createPromises = webhooksToCreate.map(async webhook => {
      const createdWebhook = await this.#createWebhook(invocation, webhook)

      repo.addWebhook({ ...webhook, id: createdWebhook.id })
    })

    await Promise.all([...deletePromises, ...createPromises])

    return {
      webhookData: { webhooks: repo.getAllWebhooks() },
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    return this[invocation.eventName](MethodCallTypes.FILTER_TRIGGER, invocation)
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    const repo = new WebhookRepo(invocation.webhookData?.webhooks)

    const webhooks = repo.getAllWebhooks()

    await Promise.all(webhooks.map(webhook => this.#deleteWebhook(webhook.id)))

    return { webhookData: { webhooks: [] } }
  }

  /**
   * @operationName On Form Submit
   * @category Triggers
   * @description Triggers when forms are submitted for AI agents to process leads instantly, automate customer responses, or initiate follow-up workflows. Perfect for real-time lead processing, automated customer engagement, and form-driven automation.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-form-submit
   * @executionTimeoutInSeconds 120
   * @appearanceColor #f9566d #fb874b
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"The Webflow site to monitor for form submissions."}
   * @paramDef {"type":"String","label":"Form","name":"form","required":true,"dictionary":"getFormsDictionary","description":"The form on the site to listen for submissions."}
   *
   * @returns {Object}
   * @sampleResult {"triggerType":"form_submission","name":"Site name","siteId":"67e40834604163aac3a309d8","data":{"formKey":"formValue"},"id":"67e40f542dbcff9ea1551e14","formId":"67e409c5eff41604546d461b","pageId":"67e40835604163aac3a309f3","publishedPath":"/","schema":[{"fieldName":"Name","fieldType":"FormTextInput","fieldElementId":"d23c39fc-dc71-ff4a-5549-001030d4a484"},{"fieldName":"AddressLine1","fieldType":"FormTextInput","fieldElementId":"d23c39fc-dc71-ff4a-5549-001030d4a485"},{"fieldName":"AddressLine2","fieldType":"FormTextInput","fieldElementId":"d23c39fc-dc71-ff4a-5549-001030d4a486"}]}
   */
  async onFormSubmit(callType, invocation) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      const { triggerType, payload } = invocation.body

      return [
        {
          name: 'onFormSubmit',
          data: { triggerType, ...payload },
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const { triggers, eventData } = invocation
      const { siteId, formId } = eventData

      return {
        ids: triggers
          .filter(trigger => {
            const { site: triggerSite, form: triggerForm } = trigger.data

            if (extractId(triggerSite) === siteId && extractId(triggerForm) === formId) {
              return true
            }

            return false
          })
          .map(trigger => trigger.id),
      }
    }
  }

  /**
   * @operationName On New Order
   * @category Triggers
   * @description Triggers when new orders are placed for AI agents to process sales data, automate fulfillment workflows, or initiate customer communications. Essential for order processing automation, inventory management, and customer service workflows.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-new-order
   * @executionTimeoutInSeconds 120
   * @appearanceColor #f9566d #fb874b
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"The Webflow site to monitor for newly created orders."}
   *
   * @returns {Object}
   * @sampleResult {"triggerType":"ecomm_new_order","orderId":"fc7-128","status":"unfulfilled","comment":"Customer requested gift wrapping and a personalized note saying: Happy Birthday, Ford! 🎉 Please ensure the item is packed with extra bubble wrap for safe transit.","orderComment":"Please gift wrap with a personal note saying \"Happy Birthday, Ford! 🎉","acceptedOn":"2024-03-29T21:29:21Z","customerPaid":{"unit":"USD","value":"5892","string":" 118.73 USD"},"netAmount":{"unit":"USD","value":"5892","string":" 112.62 USD"},"applicationFee":{"unit":"USD","value":"5892","string":" 2.37 USD"},"allAddresses":[{"type":"billing","addressee":"Arthur Dent","line1":"20 W 34th St","line2":"Empire State Building","city":"New York","state":"New York","country":"US","postalCode":"10118"},{"type":"shipping","addressee":"Arthur Dent","line1":"20 W 34th St","line2":"Empire State Building","city":"New York","state":"New York","country":"US","postalCode":"10118"}],"shippingAddress":{"type":"shipping","japanType":"kanji","addressee":"Arthur Dent","line1":"20 W 34th St","line2":"Empire State Building","city":"New York","state":"New York","country":"US","postalCode":"10118"},"billingAddress":{"type":"billing","addressee":"Arthur Dent","line1":"20 W 34th St","line2":"Empire State Building","city":"New York","state":"New York","country":"US","postalCode":"10118"},"shippingProvider":"Shipping Company, Co.","shippingTracking":"tr00000000001","shippingTrackingURL":"https://www.shippingcompany.com/tracking/tr00000000001","customerInfo":{"fullName":"Arthur Dent","email":"arthur.dent@example.com"},"purchasedItems":[{"count":1,"rowTotal":{"unit":"USD","value":"5892","string":" 55.61 USD"},"productId":"66072fb61b89448912e26791","productName":"Luxurious Fresh Ball","productSlug":"luxurious-fresh-ball","variantId":"66072fb71b89448912e2683f","variantName":"Luxurious Fresh Ball Generic: Bronze, Practical: Plastic","variantSlug":"luxurious-fresh-ball-generic-bronze-practical-plastic","variantSKU":"luxurious-fresh-ball-generic-bronze-practical-plastic","variantImage":{"url":"https://d1otoma47x30pg.cloudfront.net/66072f39417a2a35b2589cc7/66072fb51b89448912e2672c_image14.jpeg"},"variantPrice":{"unit":"USD","value":"5892","string":" 55.61 USD"},"weight":11,"width":82,"height":70,"length":9},{"count":1,"rowTotal":{"unit":"USD","value":"5892","string":" 53.44 USD"},"productId":"66072fb61b89448912e26799","productName":"Recycled Steel Gloves","productSlug":"recycled-steel-gloves","variantId":"66072fb91b89448912e26ab9","variantName":"Recycled Steel Gloves Electronic: Granite, Handcrafted: grey","variantSlug":"recycled-steel-gloves-electronic-granite-handcrafted-grey","variantSKU":"recycled-steel-gloves-electronic-granite-handcrafted-grey","variantImage":{"url":"https://d1otoma47x30pg.cloudfront.net/66072f39417a2a35b2589cc7/66072fb51b89448912e2671e_image2.jpeg"},"variantPrice":{"unit":"USD","value":"5892","string":" 53.44 USD"},"weight":38,"width":76,"height":85,"length":40}],"purchasedItemsCount":2,"stripeDetails":{"paymentMethod":"pm_1OzmzBJYFi4lcbXWHKNdXU7j","paymentIntentId":"pi_3OzmzDJYFi4lcbXW1hTBW6ft","customerId":"cus_PpRsNHwWdUoRKR","chargeId":"ch_3OzmzDJYFi4lcbXW1ndkkrH2","refundId":"re_3OzmzDJYFi4lcbXW1kFAmlBk","refundReason":"fraudulent"},"stripeCard":{"last4":"4242","brand":"Visa","ownerName":"Arthur Dent","expires":{"year":2024,"month":4}},"customData":[{"key":"value"}],"metadata":{"isBuyNow":false},"isCustomerDeleted":false,"isShippingRequired":true,"hasDownloads":false,"paymentProcessor":"stripe","totals":{"subtotal":{"unit":"USD","value":"5892","string":" 109.05 USD"},"extras":[{"type":"tax","name":"State Taxes","description":"NY Taxes (4.00%)","price":{"unit":"USD","value":"5892","string":" 4.36 USD"}},{"type":"tax","name":"City Taxes","description":"NEW YORK Taxes (4.88%)","price":{"unit":"USD","value":"5892","string":" 5.32 USD"}},{"type":"shipping","name":"Flat","description":"","price":{"unit":"USD","value":"5892","string":" 0.00 USD"}}],"total":{"unit":"USD","value":"5892","string":" 118.73 USD"}},"downloadFiles":[{"id":"5e9a5eba75e0ac242e1b6f64","name":"New product guide","url":"https://webflow.com/dashboard/download-digital-product?payload=5d93ba5e38c6b0160ab711d3;e7634a;5eb1aac72912ec06f561278c;5e9a5eba75e0ac242e1b6f63:ka2nehxy:4a1ee0a632feaab94294350087215ed89533f2f530903e3b933b638940e921aa"}]}
   */
  async onNewOrder(callType, invocation) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      const { triggerType, payload } = invocation.body

      return [
        {
          name: 'onNewOrder',
          data: { triggerType, ...payload },
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      return {
        ids: invocation.triggers.map(trigger => trigger.id),
      }
    }
  }

  /**
   * @operationName On Order Updated
   * @category Triggers
   * @description Triggers when orders are modified for AI agents to track order changes, update inventory systems, or send status notifications. Critical for order lifecycle management, customer communication, and automated status updates.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-order-updated
   * @executionTimeoutInSeconds 120
   * @appearanceColor #f9566d #fb874b
   *
   * @paramDef {"type":"String","label":"Site","name":"site","required":true,"dictionary":"getSitesDictionary","description":"The Webflow site to monitor for order updates."}
   *
   * @returns {Object}
   * @sampleResult {"triggerType":"ecomm_order_changed","orderId":"fc7-128","status":"refunded","comment":"Customer requested gift wrapping and a personalized note saying: Happy Birthday, Ford! 🎉 Please ensure the item is packed with extra bubble wrap for safe transit.","orderComment":"Please gift wrap with a personal note saying \"Happy Birthday, Ford! 🎉","acceptedOn":"2024-03-29T21:29:21Z","fulfilledOn":"2024-03-29T21:29:21Z","refundedOn":"2024-04-08T18:25:04Z","disputedOn":"2024-03-29T21:29:21Z","disputeUpdatedOn":"2024-03-29T21:29:21Z","disputeLastStatus":"charge_refunded","customerPaid":{"unit":"USD","value":"5892","string":" 118.73 USD"},"netAmount":{"unit":"USD","value":"5892","string":" 112.62 USD"},"applicationFee":{"unit":"USD","value":"5892","string":" 2.37 USD"},"allAddresses":[{"type":"billing","addressee":"Arthur Dent","line1":"20 W 34th St","line2":"Empire State Building","city":"New York","state":"New York","country":"US","postalCode":"10118"},{"type":"shipping","addressee":"Arthur Dent","line1":"20 W 34th St","line2":"Empire State Building","city":"New York","state":"New York","country":"US","postalCode":"10118"}],"shippingAddress":{"type":"shipping","japanType":"kanji","addressee":"Arthur Dent","line1":"20 W 34th St","line2":"Empire State Building","city":"New York","state":"New York","country":"US","postalCode":"10118"},"billingAddress":{"type":"billing","addressee":"Arthur Dent","line1":"20 W 34th St","line2":"Empire State Building","city":"New York","state":"New York","country":"US","postalCode":"10118"},"shippingProvider":"Shipping Company, Co.","shippingTracking":"tr00000000001","shippingTrackingURL":"https://www.shippingcompany.com/tracking/tr00000000001","customerInfo":{"fullName":"Arthur Dent","email":"arthur.dent@example.com"},"purchasedItems":[{"count":1,"rowTotal":{"unit":"USD","value":"5892","string":" 55.61 USD"},"productId":"66072fb61b89448912e26791","productName":"Luxurious Fresh Ball","productSlug":"luxurious-fresh-ball","variantId":"66072fb71b89448912e2683f","variantName":"Luxurious Fresh Ball Generic: Bronze, Practical: Plastic","variantSlug":"luxurious-fresh-ball-generic-bronze-practical-plastic","variantSKU":"luxurious-fresh-ball-generic-bronze-practical-plastic","variantImage":{"url":"https://d1otoma47x30pg.cloudfront.net/66072f39417a2a35b2589cc7/66072fb51b89448912e2672c_image14.jpeg"},"variantPrice":{"unit":"USD","value":"5892","string":" 55.61 USD"},"weight":11,"width":82,"height":70,"length":9},{"count":1,"rowTotal":{"unit":"USD","value":"5892","string":" 53.44 USD"},"productId":"66072fb61b89448912e26799","productName":"Recycled Steel Gloves","productSlug":"recycled-steel-gloves","variantId":"66072fb91b89448912e26ab9","variantName":"Recycled Steel Gloves Electronic: Granite, Handcrafted: grey","variantSlug":"recycled-steel-gloves-electronic-granite-handcrafted-grey","variantSKU":"recycled-steel-gloves-electronic-granite-handcrafted-grey","variantImage":{"url":"https://d1otoma47x30pg.cloudfront.net/66072f39417a2a35b2589cc7/66072fb51b89448912e2671e_image2.jpeg"},"variantPrice":{"unit":"USD","value":"5892","string":" 53.44 USD"},"weight":38,"width":76,"height":85,"length":40}],"purchasedItemsCount":2,"stripeDetails":{"paymentMethod":"pm_1OzmzBJYFi4lcbXWHKNdXU7j","paymentIntentId":"pi_3OzmzDJYFi4lcbXW1hTBW6ft","customerId":"cus_PpRsNHwWdUoRKR","chargeId":"ch_3OzmzDJYFi4lcbXW1ndkkrH2","refundId":"re_3OzmzDJYFi4lcbXW1kFAmlBk","refundReason":"fraudulent"},"stripeCard":{"last4":"4242","brand":"Visa","ownerName":"Arthur Dent","expires":{"year":2024,"month":4}},"customData":[{"key":"value"}],"metadata":{"isBuyNow":false},"isCustomerDeleted":false,"isShippingRequired":true,"hasDownloads":false,"paymentProcessor":"stripe","totals":{"subtotal":{"unit":"USD","value":"5892","string":" 109.05 USD"},"extras":[{"type":"tax","name":"State Taxes","description":"NY Taxes (4.00%)","price":{"unit":"USD","value":"5892","string":" 4.36 USD"}},{"type":"tax","name":"City Taxes","description":"NEW YORK Taxes (4.88%)","price":{"unit":"USD","value":"5892","string":" 5.32 USD"}},{"type":"shipping","name":"Flat","description":"","price":{"unit":"USD","value":"5892","string":" 0.00 USD"}}],"total":{"unit":"USD","value":"5892","string":" 118.73 USD"}},"downloadFiles":[{"id":"5e9a5eba75e0ac242e1b6f64","name":"New product guide","url":"https://webflow.com/dashboard/download-digital-product?payload=5d93ba5e38c6b0160ab711d3;e7634a;5eb1aac72912ec06f561278c;5e9a5eba75e0ac242e1b6f63:ka2nehxy:4a1ee0a632feaab94294350087215ed89533f2f530903e3b933b638940e921aa"}]}
   */
  async onOrderUpdated(callType, invocation) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      const { triggerType, payload } = invocation.body

      return [
        {
          name: 'onOrderUpdated',
          data: { triggerType, ...payload },
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      return {
        ids: invocation.triggers.map(trigger => trigger.id),
      }
    }
  }

  async #deleteWebhook(id) {
    return this.#apiRequest({
      logTag: 'delete webhook',
      method: 'delete',
      url: `${ API_BASE_URL }/webhooks/${ id }`,
      headers: { 'Accept-Version': '1.0.0' },
    })
  }

  async #createWebhook(invocation, { site, eventName }) {
    return this.#apiRequest({
      logTag: `create webhook - ${ eventName }`,
      method: 'post',
      url: `${ API_BASE_URL }/sites/${ extractId(site) }/webhooks`,
      body: {
        triggerType: EventsMap[eventName],
        url: invocation.callbackUrl + `&connectionId=${ invocation.connectionId }`,
      },
      headers: { 'accept-version': '1.0.0' },
    })
  }
}

Flowrunner.ServerCode.addService(WebflowService, [
  {
    order: 0,
    displayName: 'Client Id',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientId',
    hint: 'Your OAuth 2.0 Client ID from the WebFlow Developer Portal (Used to authenticate API requests).',
  },
  {
    order: 1,
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientSecret',
    hint: 'Your OAuth 2.0 Client Secret from the WebFlow Developer Portal (Required for secure authentication).',
  },
])

function cleanupObject(data) {
  if (!data) {
    return
  }

  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function extractId(input) {
  // Regular expression to strictly match: "<Text> (ID: <alphanumeric>)"
  const regex = /^.+ \(ID:\s*([a-zA-Z0-9]+)\)$/
  const match = input?.match(regex)

  // If it matches the correct format, return the extracted ID, else return the original string.
  return match ? match[1] : input
}

class WebhookRepo {
  constructor(webhooks = []) {
    this.webhooks = new Map()

    webhooks.forEach(this.addWebhook.bind(this))
  }

  static createKey(site, eventName) {
    if (eventName === ApiEventsMap.ecomm_new_order || eventName === ApiEventsMap.ecomm_order_changed) {
      return `event=[${ eventName }]`
    }

    return `event=[${ eventName }] site=[${ site }]`
  }

  addWebhook(webhook) {
    const key = WebhookRepo.createKey(webhook.site, webhook.eventName)

    this.webhooks.set(key, webhook)
  }

  deleteWebhook(webhook) {
    const key = WebhookRepo.createKey(webhook.site, webhook.eventName)

    return this.webhooks.delete(key)
  }

  findWebhook(event) {
    const key = WebhookRepo.createKey(event.triggerData.site, event.name)

    return this.webhooks.get(key) || null
  }

  getAllWebhooks() {
    return [...this.webhooks.values()]
  }

  getWebhooksToCreate(events) {
    return events
      .filter(event => !this.findWebhook(event))
      .map(({ triggerData, name }) => ({
        site: triggerData.site,
        form: triggerData.form,
        eventName: name,
      }))
  }

  getUnusedWebhooks(events) {
    const eventKeys = new Set(events.map(({ name, triggerData }) => WebhookRepo.createKey(triggerData.site, name)))

    return this.getAllWebhooks().filter(
      webhook => !eventKeys.has(WebhookRepo.createKey(webhook.site, webhook.eventName))
    )
  }
}
