const logger = {
  info: (...args) => console.log('[Figma] info:', ...args),
  debug: (...args) => console.log('[Figma] debug:', ...args),
  error: (...args) => console.log('[Figma] error:', ...args),
  warn: (...args) => console.log('[Figma] warn:', ...args),
}

const API_BASE_URL = 'https://api.figma.com/v1'
const API_V2_BASE_URL = 'https://api.figma.com/v2'

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
 * Extracts a Figma file key from a full Figma URL or returns the input unchanged
 * if it already looks like a bare key. Supports figma.com/file/{key}/...,
 * figma.com/design/{key}/..., figma.com/proto/{key}/... and board/slides variants.
 */
function extractFileKey(input) {
  if (!input) {
    return input
  }

  const match = String(input).match(/figma\.com\/(?:file|design|proto|board|slides)\/([A-Za-z0-9]+)/)

  return match ? match[1] : String(input).trim()
}

/**
 * Extracts a Figma team id from a team URL or returns the input unchanged.
 * Supports figma.com/files/team/{teamId}/... and figma.com/team/{teamId}/...
 */
function extractTeamId(input) {
  if (!input) {
    return input
  }

  const match = String(input).match(/figma\.com\/(?:files\/)?team\/(\d+)/)

  return match ? match[1] : String(input).trim()
}

/**
 * @integrationName Figma
 * @integrationIcon /icon.svg
 * @usesFileStorage
 */
class FigmaService {
  constructor(config) {
    this.accessToken = config.accessToken
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'X-Figma-Token': this.accessToken,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.err || error.body?.message || error.message
      logger.error(`${ logTag } - failed${ status ? ` (${ status })` : '' }: ${ message }`)
      throw new Error(`Figma API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #toBuffer(bytes) {
    return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  }

  // ==========================================================================
  // Files
  // ==========================================================================

  /**
   * @operationName Get File
   * @category Files
   * @description Retrieves the full document JSON tree for a Figma file, including the node hierarchy, components, styles, and metadata. For large files this response can be very big, so use Depth to limit how many levels of the node tree are returned, or use Node IDs to fetch only specific nodes. Accepts a raw file key or a full figma.com/file or /design URL.
   * @route GET /files
   *
   * @paramDef {"type":"String","label":"Team ID or URL","name":"teamId","dictionary":"getTeamProjectsDictionary","description":"Optional helper: pick a team to populate the Project picker. Not sent to Figma."}
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","dictionary":"getTeamProjectsDictionary","dependsOn":["teamId"],"description":"Optional helper: pick a project to populate the File picker. Not sent to Figma."}
   * @paramDef {"type":"String","label":"File Key or URL","name":"fileKey","required":true,"dictionary":"getProjectFilesDictionary","dependsOn":["projectId"],"description":"Figma file key, or a full Figma URL such as https://www.figma.com/design/abc123/My-File. Pick a team and project above to browse files, or paste a key/URL directly."}
   * @paramDef {"type":"String","label":"Version ID","name":"version","description":"Optional specific version ID to retrieve (from Get File Versions). Defaults to the current version."}
   * @paramDef {"type":"Number","label":"Depth","name":"depth","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many levels of the node tree to return. Use 1 for pages only, 2 for pages plus their top-level children. Strongly recommended for large files to reduce response size."}
   * @paramDef {"type":"Array<String>","label":"Node IDs","name":"ids","description":"Optional list of node IDs. When set, only these nodes and their subtrees are returned instead of the whole document."}
   * @paramDef {"type":"Boolean","label":"Include Geometry","name":"geometry","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, includes vector geometry (paths) in the response. Set to true only when you need path data."}
   *
   * @returns {Object}
   * @sampleResult {"name":"My File","lastModified":"2024-01-15T10:30:00Z","thumbnailUrl":"https://s3.figma.com/thumb.png","version":"123456","document":{"id":"0:0","name":"Document","type":"DOCUMENT","children":[]},"components":{},"styles":{}}
   */
  async getFile(teamId, projectId, fileKey, version, depth, ids, geometry) {
    const logTag = '[getFile]'
    const key = extractFileKey(fileKey)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(key) }`,
      method: 'get',
      query: {
        version,
        depth,
        ids: Array.isArray(ids) && ids.length ? ids.join(',') : undefined,
        geometry: geometry ? 'paths' : undefined,
      },
    })
  }

  /**
   * @operationName Get File Nodes
   * @category Files
   * @description Retrieves only the specified nodes from a Figma file rather than the entire document tree, producing a much lighter response than Get File. Returns a map of node ID to its document subtree, components, and styles. Ideal when you already know which frames or components you need.
   * @route GET /files/nodes
   *
   * @paramDef {"type":"String","label":"File Key or URL","name":"fileKey","required":true,"description":"Figma file key or full Figma URL. The key is extracted automatically."}
   * @paramDef {"type":"Array<String>","label":"Node IDs","name":"ids","required":true,"description":"List of node IDs to fetch (e.g. 1:23, 4:56). Node IDs appear in the URL when a node is selected in Figma."}
   * @paramDef {"type":"String","label":"Version ID","name":"version","description":"Optional specific version ID. Defaults to the current version."}
   * @paramDef {"type":"Number","label":"Depth","name":"depth","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many levels of each node's subtree to return. Limits response size for deep nodes."}
   *
   * @returns {Object}
   * @sampleResult {"name":"My File","lastModified":"2024-01-15T10:30:00Z","version":"123456","nodes":{"1:23":{"document":{"id":"1:23","name":"Frame","type":"FRAME","children":[]},"components":{},"styles":{}}}}
   */
  async getFileNodes(fileKey, ids, version, depth) {
    const logTag = '[getFileNodes]'
    const key = extractFileKey(fileKey)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(key) }/nodes`,
      method: 'get',
      query: {
        ids: Array.isArray(ids) ? ids.join(',') : ids,
        version,
        depth,
      },
    })
  }

  /**
   * @operationName Get File Metadata
   * @category Files
   * @description Retrieves lightweight metadata for a Figma file without the node tree: name, last modified timestamp, thumbnail URL, version, editor type, role, and link access. Use this as a fast way to check a file's identity and freshness before deciding whether to fetch the full document.
   * @route GET /files/meta
   *
   * @paramDef {"type":"String","label":"File Key or URL","name":"fileKey","required":true,"description":"Figma file key or full Figma URL. The key is extracted automatically."}
   *
   * @returns {Object}
   * @sampleResult {"file":{"name":"My File","folder_name":"Design","last_touched_at":"2024-01-15T10:30:00Z","thumbnail_url":"https://s3.figma.com/thumb.png","editorType":"figma","role":"owner","link_access":"view","version":"123456"}}
   */
  async getFileMetadata(fileKey) {
    const logTag = '[getFileMetadata]'
    const key = extractFileKey(fileKey)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(key) }/meta`,
      method: 'get',
    })
  }

  /**
   * @operationName Get File Versions
   * @category Files
   * @description Retrieves the version history of a Figma file, listing each saved version with its ID, label, description, creation time, and the user who created it. Version IDs returned here can be passed to Get File, Get File Nodes, or Export Image to work with a historical snapshot.
   * @route GET /files/versions
   *
   * @paramDef {"type":"String","label":"File Key or URL","name":"fileKey","required":true,"description":"Figma file key or full Figma URL. The key is extracted automatically."}
   *
   * @returns {Object}
   * @sampleResult {"versions":[{"id":"123456","created_at":"2024-01-15T10:30:00Z","label":"Draft","description":"Initial layout","user":{"id":"u1","handle":"Jane","img_url":"https://s3.figma.com/u1.png"}}],"pagination":{"prev_page":null,"next_page":null}}
   */
  async getFileVersions(fileKey) {
    const logTag = '[getFileVersions]'
    const key = extractFileKey(fileKey)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(key) }/versions`,
      method: 'get',
    })
  }

  // ==========================================================================
  // Images
  // ==========================================================================

  /**
   * @operationName Export Image
   * @category Images
   * @description Renders one or more nodes of a Figma file to images and returns a map of node ID to a temporary Figma-hosted image URL (these URLs expire after roughly 30 days). Supports PNG, JPG, SVG, and PDF output at a configurable scale. When Save To Storage is enabled, each rendered image is downloaded and re-hosted in FlowRunner file storage and the returned URLs point at those permanent copies instead.
   * @route GET /images
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"File Key or URL","name":"fileKey","required":true,"description":"Figma file key or full Figma URL. The key is extracted automatically."}
   * @paramDef {"type":"Array<String>","label":"Node IDs","name":"ids","required":true,"description":"List of node IDs to render (e.g. 1:23). Each node is rendered separately."}
   * @paramDef {"type":"String","label":"Format","name":"format","uiComponent":{"type":"DROPDOWN","options":{"values":["PNG","JPG","SVG","PDF"]}},"description":"Output image format. Defaults to PNG."}
   * @paramDef {"type":"Number","label":"Scale","name":"scale","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Rendering scale between 0.01 and 4 (e.g. 2 for @2x). Applies to PNG and JPG only. Defaults to 1."}
   * @paramDef {"type":"Boolean","label":"Save To Storage","name":"saveToStorage","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, downloads each rendered image and re-hosts it in FlowRunner file storage, returning permanent hosted URLs instead of Figma's temporary ones."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"],"description":"Storage scope used when Save To Storage is enabled (FLOW, WORKSPACE, or EXECUTION). Defaults to FLOW."}
   *
   * @returns {Object}
   * @sampleResult {"err":null,"images":{"1:23":"https://s3.figma.com/img/abc/1-23.png"},"hosted":{"1:23":"https://files.flowrunner.io/figma_1-23_1700000000000.png"}}
   */
  async exportImage(fileKey, ids, format, scale, saveToStorage, fileOptions) {
    const logTag = '[exportImage]'
    const key = extractFileKey(fileKey)
    const resolvedFormat = this.#resolveChoice(format, { PNG: 'png', JPG: 'jpg', SVG: 'svg', PDF: 'pdf' }) || 'png'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/images/${ encodeURIComponent(key) }`,
      method: 'get',
      query: {
        ids: Array.isArray(ids) ? ids.join(',') : ids,
        format: resolvedFormat,
        scale,
      },
    })

    if (!saveToStorage) {
      return response
    }

    const images = response.images || {}
    const hosted = {}

    for (const nodeId of Object.keys(images)) {
      const imageUrl = images[nodeId]

      if (!imageUrl) {
        hosted[nodeId] = null
        continue
      }

      const bytes = await Flowrunner.Request.get(imageUrl).setEncoding(null)
      const buffer = this.#toBuffer(bytes)
      const safeNode = nodeId.replace(/[^A-Za-z0-9]/g, '-')

      const { url } = await this.flowrunner.Files.uploadFile(buffer, {
        filename: `figma_${ safeNode }_${ Date.now() }.${ resolvedFormat }`,
        generateUrl: true,
        overwrite: true,
        ...(fileOptions || { scope: 'FLOW' }),
      })

      hosted[nodeId] = url
    }

    return { ...response, hosted }
  }

  /**
   * @operationName Get Image Fills
   * @category Images
   * @description Retrieves download URLs for all images used as fills within a Figma file, returned as a map of image reference to a temporary Figma-hosted URL. These are the raw uploaded images referenced by imageRef in node fills, as opposed to Export Image which renders nodes on demand.
   * @route GET /files/images
   *
   * @paramDef {"type":"String","label":"File Key or URL","name":"fileKey","required":true,"description":"Figma file key or full Figma URL. The key is extracted automatically."}
   *
   * @returns {Object}
   * @sampleResult {"error":false,"status":200,"meta":{"images":{"a1b2c3":"https://s3.figma.com/img/a1b2c3"}}}
   */
  async getImageFills(fileKey) {
    const logTag = '[getImageFills]'
    const key = extractFileKey(fileKey)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(key) }/images`,
      method: 'get',
    })
  }

  // ==========================================================================
  // Comments
  // ==========================================================================

  /**
   * @operationName Get Comments
   * @category Comments
   * @description Retrieves all comments on a Figma file, including their message text, author, creation time, resolution status, and pin location (node or canvas coordinates). Replies are linked to their parent comment via the parent_id field.
   * @route GET /files/comments
   *
   * @paramDef {"type":"String","label":"File Key or URL","name":"fileKey","required":true,"description":"Figma file key or full Figma URL. The key is extracted automatically."}
   * @paramDef {"type":"Boolean","label":"As Markdown","name":"asMarkdown","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, comment messages are returned as Markdown-formatted text instead of plain text."}
   *
   * @returns {Object}
   * @sampleResult {"comments":[{"id":"123","message":"Looks great!","user":{"handle":"Jane","img_url":"https://s3.figma.com/u1.png"},"created_at":"2024-01-15T10:30:00Z","resolved_at":null,"order_id":"1","parent_id":"","client_meta":{"node_id":"1:23","node_offset":{"x":10,"y":20}}}]}
   */
  async getComments(fileKey, asMarkdown) {
    const logTag = '[getComments]'
    const key = extractFileKey(fileKey)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(key) }/comments`,
      method: 'get',
      query: {
        as_md: asMarkdown ? true : undefined,
      },
    })
  }

  /**
   * @operationName Post Comment
   * @category Comments
   * @description Posts a new comment on a Figma file, or a reply to an existing comment. A comment can be pinned to a specific node (by node ID, with optional x/y offset within that node) or to an absolute canvas position (x/y), or left unpinned. To reply to an existing comment, provide its comment ID.
   * @route POST /files/comments
   *
   * @paramDef {"type":"String","label":"File Key or URL","name":"fileKey","required":true,"description":"Figma file key or full Figma URL. The key is extracted automatically."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The comment text to post."}
   * @paramDef {"type":"String","label":"Reply To Comment ID","name":"commentId","description":"Optional. When set, this comment is posted as a reply to the given comment ID and pin settings are ignored."}
   * @paramDef {"type":"String","label":"Pin To Node ID","name":"nodeId","description":"Optional node ID to pin the comment to (e.g. 1:23). Combine with Pin X/Pin Y for an offset within the node."}
   * @paramDef {"type":"Number","label":"Pin X","name":"x","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"X coordinate for the pin. Used as an offset within the node when Pin To Node ID is set, otherwise as an absolute canvas position."}
   * @paramDef {"type":"Number","label":"Pin Y","name":"y","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Y coordinate for the pin. Used as an offset within the node when Pin To Node ID is set, otherwise as an absolute canvas position."}
   *
   * @returns {Object}
   * @sampleResult {"id":"456","message":"Please review this section","user":{"handle":"Jane","img_url":"https://s3.figma.com/u1.png"},"created_at":"2024-01-15T11:00:00Z","file_key":"abc123","parent_id":"","client_meta":{"node_id":"1:23","node_offset":{"x":10,"y":20}}}
   */
  async postComment(fileKey, message, commentId, nodeId, x, y) {
    const logTag = '[postComment]'
    const key = extractFileKey(fileKey)

    const body = { message }

    if (commentId) {
      body.comment_id = commentId
    } else if (nodeId) {
      body.client_meta = { node_id: nodeId, node_offset: { x: x || 0, y: y || 0 } }
    } else if (x !== undefined && x !== null && y !== undefined && y !== null) {
      body.client_meta = { x, y }
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(key) }/comments`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Delete Comment
   * @category Comments
   * @description Permanently deletes a comment from a Figma file. Only the comment's author can delete it. Deleting a top-level comment also removes its replies.
   * @route DELETE /comments
   *
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"ID of the comment to delete (from Get Comments)."}
   *
   * @returns {Object}
   * @sampleResult {"status":200,"error":false}
   */
  async deleteComment(commentId) {
    const logTag = '[deleteComment]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/comments/${ encodeURIComponent(commentId) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Get Comment Reactions
   * @category Comments
   * @description Retrieves all emoji reactions on a specific comment, including the reacting user and the emoji shortcode used.
   * @route GET /comments/reactions
   *
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"ID of the comment whose reactions to list (from Get Comments)."}
   *
   * @returns {Object}
   * @sampleResult {"reactions":[{"user":{"handle":"Jane","img_url":"https://s3.figma.com/u1.png"},"emoji":":eyes:","created_at":"2024-01-15T12:00:00Z"}],"pagination":{"prev_page":null,"next_page":null}}
   */
  async getCommentReactions(commentId) {
    const logTag = '[getCommentReactions]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/comments/${ encodeURIComponent(commentId) }/reactions`,
      method: 'get',
    })
  }

  /**
   * @operationName Add Comment Reaction
   * @category Comments
   * @description Adds an emoji reaction to a comment. The emoji must be provided as a Figma-supported shortcode such as :eyes:, :heart_eyes:, :thumbsup:, or :thumbsdown:.
   * @route POST /comments/reactions
   *
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"ID of the comment to react to (from Get Comments)."}
   * @paramDef {"type":"String","label":"Emoji","name":"emoji","required":true,"description":"Emoji shortcode to add, e.g. :eyes:, :heart_eyes:, :thumbsup:, :thumbsdown:, :fire:."}
   *
   * @returns {Object}
   * @sampleResult {"status":200,"error":false}
   */
  async addCommentReaction(commentId, emoji) {
    const logTag = '[addCommentReaction]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/comments/${ encodeURIComponent(commentId) }/reactions`,
      method: 'post',
      body: { emoji },
    })
  }

  // ==========================================================================
  // Projects & Teams
  // ==========================================================================

  /**
   * @operationName Get Team Projects
   * @category Projects
   * @description Lists all projects belonging to a Figma team. The team ID is the number in a team URL such as figma.com/files/team/{teamId}. Use Get Project Files to list the files within a returned project.
   * @route GET /teams/projects
   *
   * @paramDef {"type":"String","label":"Team ID or URL","name":"teamId","required":true,"description":"Figma team ID, or a full team URL such as https://www.figma.com/files/team/12345/My-Team. The ID is extracted automatically."}
   *
   * @returns {Object}
   * @sampleResult {"name":"My Team","projects":[{"id":"789","name":"Website Redesign"}]}
   */
  async getTeamProjects(teamId) {
    const logTag = '[getTeamProjects]'
    const id = extractTeamId(teamId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/teams/${ encodeURIComponent(id) }/projects`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Project Files
   * @category Projects
   * @description Lists all files within a Figma project, returning each file's key, name, thumbnail URL, and last modified time. Use a returned file key with Get File, Export Image, or the comment operations.
   * @route GET /projects/files
   *
   * @paramDef {"type":"String","label":"Team ID or URL","name":"teamId","dictionary":"getTeamProjectsDictionary","description":"Optional helper: pick a team to populate the Project dictionary below. Not sent to Figma — files are fetched by project ID."}
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","required":true,"dictionary":"getTeamProjectsDictionary","dependsOn":["teamId"],"description":"ID of the project whose files to list. Pick a team above, then a project, or paste a project ID from Get Team Projects."}
   * @paramDef {"type":"Boolean","label":"Include Branch Data","name":"branchData","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, includes branch metadata for files that have branches."}
   *
   * @returns {Object}
   * @sampleResult {"name":"Website Redesign","files":[{"key":"abc123","name":"Landing Page","thumbnail_url":"https://s3.figma.com/thumb.png","last_modified":"2024-01-15T10:30:00Z"}]}
   */
  async getProjectFiles(teamId, projectId, branchData) {
    const logTag = '[getProjectFiles]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ encodeURIComponent(projectId) }/files`,
      method: 'get',
      query: {
        branch_data: branchData ? true : undefined,
      },
    })
  }

  // ==========================================================================
  // Components & Styles
  // ==========================================================================

  /**
   * @operationName Get Team Components
   * @category Components & Styles
   * @description Lists the published components in a Figma team's libraries, with pagination. Each entry includes the component key, name, description, thumbnail, containing file, and update times. Use a component key with Get Component for full metadata.
   * @route GET /teams/components
   *
   * @paramDef {"type":"String","label":"Team ID or URL","name":"teamId","required":true,"description":"Figma team ID or full team URL. The ID is extracted automatically."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of components per page (default 30, max 1000)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor: returns components after this cursor position. Use the next_page value from a previous response."}
   *
   * @returns {Object}
   * @sampleResult {"meta":{"components":[{"key":"comp_key_1","name":"Button","description":"Primary button","file_key":"abc123","node_id":"1:23","thumbnail_url":"https://s3.figma.com/c1.png"}],"cursor":{"after":30}}}
   */
  async getTeamComponents(teamId, pageSize, after) {
    const logTag = '[getTeamComponents]'
    const id = extractTeamId(teamId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/teams/${ encodeURIComponent(id) }/components`,
      method: 'get',
      query: {
        page_size: pageSize,
        after,
      },
    })
  }

  /**
   * @operationName Get File Components
   * @category Components & Styles
   * @description Lists all published components defined within a single Figma file, including each component's key, name, description, and node location. Unlike Get Team Components this is scoped to one file and does not require library publishing at the team level.
   * @route GET /files/components
   *
   * @paramDef {"type":"String","label":"File Key or URL","name":"fileKey","required":true,"description":"Figma file key or full Figma URL. The key is extracted automatically."}
   *
   * @returns {Object}
   * @sampleResult {"meta":{"components":[{"key":"comp_key_1","name":"Button","description":"Primary button","node_id":"1:23","thumbnail_url":"https://s3.figma.com/c1.png"}]}}
   */
  async getFileComponents(fileKey) {
    const logTag = '[getFileComponents]'
    const key = extractFileKey(fileKey)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(key) }/components`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Component
   * @category Components & Styles
   * @description Retrieves full metadata for a single published component by its component key, including its name, description, containing file, node ID, thumbnail, and the component set it belongs to (if any). Component keys are returned by Get Team Components and Get File Components.
   * @route GET /components
   *
   * @paramDef {"type":"String","label":"Component Key","name":"componentKey","required":true,"description":"The published component key (from Get Team Components or Get File Components)."}
   *
   * @returns {Object}
   * @sampleResult {"meta":{"key":"comp_key_1","name":"Button","description":"Primary button","file_key":"abc123","node_id":"1:23","thumbnail_url":"https://s3.figma.com/c1.png","containing_frame":{}}}
   */
  async getComponent(componentKey) {
    const logTag = '[getComponent]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/components/${ encodeURIComponent(componentKey) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Team Component Sets
   * @category Components & Styles
   * @description Lists the published component sets (variant groupings) in a Figma team's libraries, with pagination. Each entry includes the set key, name, description, containing file, and thumbnail.
   * @route GET /teams/component-sets
   *
   * @paramDef {"type":"String","label":"Team ID or URL","name":"teamId","required":true,"description":"Figma team ID or full team URL. The ID is extracted automatically."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of component sets per page (default 30, max 1000)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor: returns component sets after this cursor position. Use the next_page value from a previous response."}
   *
   * @returns {Object}
   * @sampleResult {"meta":{"component_sets":[{"key":"set_key_1","name":"Button","description":"Button variants","file_key":"abc123","node_id":"2:34","thumbnail_url":"https://s3.figma.com/s1.png"}],"cursor":{"after":30}}}
   */
  async getTeamComponentSets(teamId, pageSize, after) {
    const logTag = '[getTeamComponentSets]'
    const id = extractTeamId(teamId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/teams/${ encodeURIComponent(id) }/component_sets`,
      method: 'get',
      query: {
        page_size: pageSize,
        after,
      },
    })
  }

  /**
   * @operationName Get Team Styles
   * @category Components & Styles
   * @description Lists the published styles (color, text, effect, and grid styles) in a Figma team's libraries, with pagination. Each entry includes the style key, name, description, style type, and containing file.
   * @route GET /teams/styles
   *
   * @paramDef {"type":"String","label":"Team ID or URL","name":"teamId","required":true,"description":"Figma team ID or full team URL. The ID is extracted automatically."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of styles per page (default 30, max 1000)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor: returns styles after this cursor position. Use the next_page value from a previous response."}
   *
   * @returns {Object}
   * @sampleResult {"meta":{"styles":[{"key":"style_key_1","name":"Primary/500","description":"Brand primary","style_type":"FILL","file_key":"abc123","node_id":"3:45"}],"cursor":{"after":30}}}
   */
  async getTeamStyles(teamId, pageSize, after) {
    const logTag = '[getTeamStyles]'
    const id = extractTeamId(teamId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/teams/${ encodeURIComponent(id) }/styles`,
      method: 'get',
      query: {
        page_size: pageSize,
        after,
      },
    })
  }

  /**
   * @operationName Get File Styles
   * @category Components & Styles
   * @description Lists all published styles defined within a single Figma file, including each style's key, name, description, and style type (FILL, TEXT, EFFECT, or GRID). Scoped to one file, unlike Get Team Styles.
   * @route GET /files/styles
   *
   * @paramDef {"type":"String","label":"File Key or URL","name":"fileKey","required":true,"description":"Figma file key or full Figma URL. The key is extracted automatically."}
   *
   * @returns {Object}
   * @sampleResult {"meta":{"styles":[{"key":"style_key_1","name":"Primary/500","description":"Brand primary","style_type":"FILL","node_id":"3:45"}]}}
   */
  async getFileStyles(fileKey) {
    const logTag = '[getFileStyles]'
    const key = extractFileKey(fileKey)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(key) }/styles`,
      method: 'get',
    })
  }

  // ==========================================================================
  // User
  // ==========================================================================

  /**
   * @operationName Get Me
   * @category User
   * @description Retrieves the profile of the user who owns the configured personal access token: their user ID, email, handle, and avatar. Useful as a quick connection and credential check.
   * @route GET /me
   *
   * @returns {Object}
   * @sampleResult {"id":"12345","email":"jane@example.com","handle":"Jane","img_url":"https://s3.figma.com/u1.png"}
   */
  async getMe() {
    const logTag = '[getMe]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/me`,
      method: 'get',
    })
  }

  // ==========================================================================
  // Webhooks (management only — not wired as a FlowRunner trigger)
  // ==========================================================================

  /**
   * @operationName List Webhooks
   * @category Webhooks
   * @description Lists Figma v2 webhooks visible to the token, scoped by context. Webhooks deliver events (file updates, comments, version updates, library publishes) to an external HTTPS endpoint you control. Note: these operations only manage webhook subscriptions in Figma; Figma requires a stable, passcode-verified receiving endpoint, so event delivery is NOT wired to a FlowRunner trigger by this service.
   * @route GET /webhooks
   *
   * @paramDef {"type":"String","label":"Context","name":"context","uiComponent":{"type":"DROPDOWN","options":{"values":["Team","Project","File"]}},"description":"The type of context to list webhooks for. Defaults to Team."}
   * @paramDef {"type":"String","label":"Context ID","name":"contextId","required":true,"description":"ID of the team, project, or file (matching Context). For Team, this is the team ID; for Project, the project ID; for File, the file key."}
   *
   * @returns {Object}
   * @sampleResult {"webhooks":[{"id":"whk_1","event_type":"FILE_UPDATE","team_id":"12345","status":"ACTIVE","endpoint":"https://example.com/hook","passcode":"secret","description":"My hook"}]}
   */
  async listWebhooks(context, contextId) {
    const logTag = '[listWebhooks]'
    const resolvedContext = this.#resolveChoice(context, { Team: 'team', Project: 'project', File: 'file' }) || 'team'
    const id = resolvedContext === 'team' ? extractTeamId(contextId) : extractFileKey(contextId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_V2_BASE_URL }/webhooks`,
      method: 'get',
      query: {
        context: resolvedContext,
        context_id: id,
      },
    })
  }

  /**
   * @operationName Create Webhook
   * @category Webhooks
   * @description Creates a Figma v2 webhook that posts events to an external HTTPS endpoint you control. On creation Figma sends a PING to verify the endpoint, and every delivery includes the passcode so your receiver can authenticate it. Note: this only registers the subscription in Figma; delivery is NOT wired to a FlowRunner trigger, so you must host and verify the receiving endpoint yourself.
   * @route POST /webhooks
   *
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["FILE_UPDATE","FILE_COMMENT","FILE_VERSION_UPDATE","LIBRARY_PUBLISH"]}},"description":"The event that triggers the webhook."}
   * @paramDef {"type":"String","label":"Context","name":"context","uiComponent":{"type":"DROPDOWN","options":{"values":["Team","Project","File"]}},"description":"The type of context the webhook watches. Defaults to Team."}
   * @paramDef {"type":"String","label":"Context ID","name":"contextId","required":true,"description":"ID of the team, project, or file to watch (matching Context). For Team this is the team ID; for File the file key."}
   * @paramDef {"type":"String","label":"Endpoint URL","name":"endpoint","required":true,"description":"HTTPS URL that Figma will POST events to. Must be publicly reachable and respond to Figma's PING."}
   * @paramDef {"type":"String","label":"Passcode","name":"passcode","required":true,"description":"Secret string (max 100 chars) included in every delivery so your endpoint can verify the request came from this webhook."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional human-readable description for the webhook (max 150 chars)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"whk_1","event_type":"FILE_UPDATE","team_id":"12345","status":"ACTIVE","client_id":null,"endpoint":"https://example.com/hook","passcode":"secret","description":"My hook"}
   */
  async createWebhook(eventType, context, contextId, endpoint, passcode, description) {
    const logTag = '[createWebhook]'
    const resolvedContext = this.#resolveChoice(context, { Team: 'team', Project: 'project', File: 'file' }) || 'team'
    const id = resolvedContext === 'team' ? extractTeamId(contextId) : extractFileKey(contextId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_V2_BASE_URL }/webhooks`,
      method: 'post',
      body: clean({
        event_type: eventType,
        context: resolvedContext,
        context_id: id,
        endpoint,
        passcode,
        description,
      }),
    })
  }

  /**
   * @operationName Delete Webhook
   * @category Webhooks
   * @description Deletes a Figma v2 webhook by its ID, stopping all future event deliveries to its endpoint.
   * @route DELETE /webhooks
   *
   * @paramDef {"type":"String","label":"Webhook ID","name":"webhookId","required":true,"description":"ID of the webhook to delete (from List Webhooks or Create Webhook)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"whk_1","event_type":"FILE_UPDATE","status":"ACTIVE","endpoint":"https://example.com/hook","passcode":"secret","description":"My hook"}
   */
  async deleteWebhook(webhookId) {
    const logTag = '[deleteWebhook]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_V2_BASE_URL }/webhooks/${ encodeURIComponent(webhookId) }`,
      method: 'delete',
    })
  }

  // ==========================================================================
  // Dictionaries
  // ==========================================================================

  /**
   * @typedef {Object} getTeamProjectsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter projects by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Figma returns all projects in one call, so this is unused but kept for API compatibility."}
   * @paramDef {"type":"getTeamProjectsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependent selection criteria carrying the selected team ID."}
   */

  /**
   * @typedef {Object} getTeamProjectsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Team ID or URL","name":"teamId","description":"Figma team ID or full team URL whose projects should be listed."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Team Projects Dictionary
   * @description Provides a searchable list of a team's projects for selecting a project in dependent parameters. The option value is the project ID.
   * @route POST /get-team-projects-dictionary
   * @paramDef {"type":"getTeamProjectsDictionary__payload","label":"Payload","name":"payload","description":"Search text and the selected team ID used to list projects."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Website Redesign","value":"789","note":"Project"}],"cursor":null}
   */
  async getTeamProjectsDictionary(payload) {
    const logTag = '[getTeamProjectsDictionary]'
    const { search, criteria } = payload || {}
    const teamId = extractTeamId(criteria?.teamId)

    if (!teamId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/teams/${ encodeURIComponent(teamId) }/projects`,
      method: 'get',
    })

    const projects = response.projects || []
    const term = (search || '').toLowerCase()

    return {
      items: projects
        .filter(project => !term || (project.name || '').toLowerCase().includes(term))
        .map(project => ({
          label: project.name,
          value: String(project.id),
          note: 'Project',
        })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getProjectFilesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter files by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Figma returns all files in one call, so this is unused but kept for API compatibility."}
   * @paramDef {"type":"getProjectFilesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependent selection criteria carrying the selected project ID."}
   */

  /**
   * @typedef {Object} getProjectFilesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","description":"ID of the project whose files should be listed."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Project Files Dictionary
   * @description Provides a searchable list of a project's files for selecting a file in dependent parameters. The option value is the file key.
   * @route POST /get-project-files-dictionary
   * @paramDef {"type":"getProjectFilesDictionary__payload","label":"Payload","name":"payload","description":"Search text and the selected project ID used to list files."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Landing Page","value":"abc123","note":"Modified 2024-01-15"}],"cursor":null}
   */
  async getProjectFilesDictionary(payload) {
    const logTag = '[getProjectFilesDictionary]'
    const { search, criteria } = payload || {}
    const projectId = criteria?.projectId

    if (!projectId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ encodeURIComponent(projectId) }/files`,
      method: 'get',
    })

    const files = response.files || []
    const term = (search || '').toLowerCase()

    return {
      items: files
        .filter(file => !term || (file.name || '').toLowerCase().includes(term))
        .map(file => ({
          label: file.name,
          value: file.key,
          note: file.last_modified ? `Modified ${ String(file.last_modified).slice(0, 10) }` : undefined,
        })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(FigmaService, [
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Figma personal access token, sent as the X-Figma-Token header. Generate one in Figma under Settings > Security > Personal access tokens, granting the scopes you need (e.g. file content read, comments, projects).',
  },
])
