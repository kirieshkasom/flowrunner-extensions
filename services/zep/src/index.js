const logger = {
  info: (...args) => console.log('[Zep] info:', ...args),
  debug: (...args) => console.log('[Zep] debug:', ...args),
  error: (...args) => console.log('[Zep] error:', ...args),
  warn: (...args) => console.log('[Zep] warn:', ...args),
}

const API_BASE_URL = 'https://api.getzep.com/api/v2'

const DEFAULT_DICTIONARY_LIMIT = 25

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
 * @integrationName Zep
 * @integrationIcon /icon.png
 */
class ZepService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Api-Key ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.message || error.body?.error || error.message
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed${ status ? ` (${ status })` : '' }: ${ message }`)

      throw new Error(`Zep API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Add User
   * @category Users
   * @description Creates a new user in Zep. A user is the top-level owner of threads and a personal knowledge graph. Provide a unique user ID; email, names, and arbitrary metadata are optional. Zep begins building the user's memory graph as data is added.
   * @route POST /users
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"Unique identifier for the user in your system. Must be unique within the project."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Optional email address for the user."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Optional first name for the user."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Optional last name for the user."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Optional JSON object of arbitrary metadata to store on the user."}
   * @returns {Object}
   * @sampleResult {"uuid":"1c1c1c1c-1111-2222-3333-444444444444","user_id":"user-123","email":"jane@example.com","first_name":"Jane","last_name":"Doe","metadata":{"plan":"pro"},"created_at":"2026-07-14T10:00:00Z"}
   */
  async addUser(userId, email, firstName, lastName, metadata) {
    const logTag = '[addUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users`,
      method: 'post',
      body: clean({
        user_id: userId,
        email,
        first_name: firstName,
        last_name: lastName,
        metadata,
      }),
    })
  }

  /**
   * @operationName Get User
   * @category Users
   * @description Retrieves a single user by their user ID, including profile fields, metadata, and system timestamps.
   * @route GET /users/{userId}
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user ID to retrieve. Search and select an existing user or type an ID."}
   * @returns {Object}
   * @sampleResult {"uuid":"1c1c1c1c-1111-2222-3333-444444444444","user_id":"user-123","email":"jane@example.com","first_name":"Jane","last_name":"Doe","metadata":{"plan":"pro"},"created_at":"2026-07-14T10:00:00Z"}
   */
  async getUser(userId) {
    const logTag = '[getUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Users
   * @category Users
   * @description Lists users in the project with pagination. Returns users ordered by creation time along with the total row count. Use page number and page size to page through large user sets.
   * @route GET /users-ordered
   * @paramDef {"type":"Number","label":"Page Number","name":"pageNumber","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of users per page (max 100). Defaults to 25."}
   * @returns {Object}
   * @sampleResult {"users":[{"user_id":"user-123","email":"jane@example.com","first_name":"Jane"}],"total_count":1,"row_count":1}
   */
  async listUsers(pageNumber, pageSize) {
    const logTag = '[listUsers]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users-ordered`,
      method: 'get',
      query: {
        pageNumber: pageNumber || 1,
        pageSize: pageSize || DEFAULT_DICTIONARY_LIMIT,
      },
    })
  }

  /**
   * @operationName Update User
   * @category Users
   * @description Updates an existing user's email, names, or metadata. Only the fields you provide are changed. Metadata replaces the stored metadata object.
   * @route PATCH /users/{userId}
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user ID to update. Search and select an existing user or type an ID."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address for the user."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name for the user."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New last name for the user."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"New JSON metadata object. Replaces the existing metadata."}
   * @returns {Object}
   * @sampleResult {"uuid":"1c1c1c1c-1111-2222-3333-444444444444","user_id":"user-123","email":"jane.new@example.com","first_name":"Jane","last_name":"Smith","metadata":{"plan":"enterprise"}}
   */
  async updateUser(userId, email, firstName, lastName, metadata) {
    const logTag = '[updateUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userId) }`,
      method: 'patch',
      body: clean({
        email,
        first_name: firstName,
        last_name: lastName,
        metadata,
      }),
    })
  }

  /**
   * @operationName Delete User
   * @category Users
   * @description Permanently deletes a user and all associated threads, messages, and graph data. This action cannot be undone.
   * @route DELETE /users/{userId}
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user ID to delete. Search and select an existing user or type an ID."}
   * @returns {Object}
   * @sampleResult {"message":"user deleted"}
   */
  async deleteUser(userId) {
    const logTag = '[deleteUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userId) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Get User Node
   * @category Users
   * @description Retrieves the central graph node that represents a user in their knowledge graph, including the node's summary and attributes derived from all data Zep has ingested for that user. Useful for inspecting what Zep has learned about the user.
   * @route GET /users/{userId}/node
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user ID whose graph node to retrieve. Search and select an existing user or type an ID."}
   * @returns {Object}
   * @sampleResult {"node":{"uuid":"9a9a9a9a-0000-1111-2222-333333333333","name":"user-123","summary":"Jane is a pro-plan customer interested in AI memory.","labels":["User"],"created_at":"2026-07-14T10:00:00Z"}}
   */
  async getUserNode(userId) {
    const logTag = '[getUserNode]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userId) }/node`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Thread
   * @category Threads
   * @description Creates a conversation thread owned by a user. A thread is Zep's current unit for grouping conversation messages (it replaces the older session concept). Messages added to the thread feed the user's memory graph and power thread context retrieval.
   * @route POST /threads
   * @paramDef {"type":"String","label":"Thread ID","name":"threadId","required":true,"description":"Unique identifier for the thread. Must be unique within the project."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user ID that owns this thread. Search and select an existing user or type an ID."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Optional JSON metadata object to store on the thread."}
   * @returns {Object}
   * @sampleResult {"uuid":"5f5f5f5f-aaaa-bbbb-cccc-dddddddddddd","thread_id":"thread-abc","user_id":"user-123","created_at":"2026-07-14T10:05:00Z"}
   */
  async createThread(threadId, userId, metadata) {
    const logTag = '[createThread]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/threads`,
      method: 'post',
      body: clean({
        thread_id: threadId,
        user_id: userId,
        metadata,
      }),
    })
  }

  /**
   * @operationName Get Thread
   * @category Threads
   * @description Retrieves a thread's metadata and owning user by thread ID.
   * @route GET /threads/{threadId}
   * @paramDef {"type":"String","label":"Thread ID","name":"threadId","required":true,"description":"The thread ID to retrieve."}
   * @returns {Object}
   * @sampleResult {"uuid":"5f5f5f5f-aaaa-bbbb-cccc-dddddddddddd","thread_id":"thread-abc","user_id":"user-123","created_at":"2026-07-14T10:05:00Z"}
   */
  async getThread(threadId) {
    const logTag = '[getThread]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/threads/${ encodeURIComponent(threadId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List User Threads
   * @category Threads
   * @description Lists all threads that belong to a given user, ordered by creation time.
   * @route GET /users/{userId}/threads
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user ID whose threads to list. Search and select an existing user or type an ID."}
   * @returns {Object}
   * @sampleResult {"threads":[{"thread_id":"thread-abc","user_id":"user-123","created_at":"2026-07-14T10:05:00Z"}]}
   */
  async listUserThreads(userId) {
    const logTag = '[listUserThreads]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userId) }/threads`,
      method: 'get',
    })
  }

  /**
   * @operationName Delete Thread
   * @category Threads
   * @description Permanently deletes a thread and its messages. Graph data already extracted into the user's memory is retained. This action cannot be undone.
   * @route DELETE /threads/{threadId}
   * @paramDef {"type":"String","label":"Thread ID","name":"threadId","required":true,"description":"The thread ID to delete."}
   * @returns {Object}
   * @sampleResult {"message":"thread deleted"}
   */
  async deleteThread(threadId) {
    const logTag = '[deleteThread]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/threads/${ encodeURIComponent(threadId) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Add Messages
   * @category Memory
   * @description Adds one or more conversation messages to a thread. Each message has a role type (user, assistant, or system), the message content, and an optional speaker name. Zep ingests the messages into the user's knowledge graph and uses them to build retrievable memory. This is how you record a conversation turn.
   * @route POST /threads/{threadId}/messages
   * @paramDef {"type":"String","label":"Thread ID","name":"threadId","required":true,"description":"The thread ID to add messages to."}
   * @paramDef {"type":"Array<ZepMessage>","label":"Messages","name":"messages","required":true,"description":"Ordered list of conversation messages to add to the thread."}
   * @paramDef {"type":"Boolean","label":"Return Context","name":"returnContext","uiComponent":{"type":"TOGGLE"},"description":"When enabled, returns the updated thread context block along with the added messages. Defaults to false."}
   * @returns {Object}
   * @sampleResult {"messages":[{"uuid":"7b7b7b7b-eeee-ffff-0000-111111111111","role":"Jane","role_type":"user","content":"I just moved to Berlin."}],"context":"Jane recently relocated to Berlin."}
   */
  async addMessages(threadId, messages, returnContext) {
    const logTag = '[addMessages]'

    const normalizedMessages = (messages || []).map(message => clean({
      role: message.role || message.name,
      role_type: this.#resolveChoice(message.role_type || message.roleType, {
        User: 'user',
        Assistant: 'assistant',
        System: 'system',
      }),
      content: message.content,
    }))

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/threads/${ encodeURIComponent(threadId) }/messages`,
      method: 'post',
      body: clean({
        messages: normalizedMessages,
        return_context: returnContext === true ? true : undefined,
      }),
    })
  }

  /**
   * @operationName Get Thread Context
   * @category Memory
   * @description Returns Zep's assembled memory context for a thread: a ready-to-inject context block summarizing the most relevant facts and entities about the user, drawn from the whole knowledge graph, plus recent messages. This is the flagship retrieval operation - drop the returned context string into your LLM prompt to give the assistant long-term memory. Choose "summary" mode for a concise narrative or "basic" mode for raw relevant facts and edges.
   * @route GET /threads/{threadId}/context
   * @paramDef {"type":"String","label":"Thread ID","name":"threadId","required":true,"description":"The thread ID to build context for."}
   * @paramDef {"type":"String","label":"Mode","name":"mode","uiComponent":{"type":"DROPDOWN","options":{"values":["Summary","Basic"]}},"description":"Context assembly mode. Summary returns a concise narrative block; Basic returns relevant facts and edges. Defaults to Summary."}
   * @paramDef {"type":"Number","label":"Min Rating","name":"minRating","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional minimum relevance rating (0.0-1.0) for facts included in the context."}
   * @returns {Object}
   * @sampleResult {"context":"FACTS:\n- Jane recently relocated to Berlin.\n- Jane is on the pro plan.\n\nENTITIES:\n- Jane (User)","messages":[{"role":"Jane","role_type":"user","content":"I just moved to Berlin."}]}
   */
  async getThreadContext(threadId, mode, minRating) {
    const logTag = '[getThreadContext]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/threads/${ encodeURIComponent(threadId) }/context`,
      method: 'get',
      query: {
        mode: this.#resolveChoice(mode, { Summary: 'summary', Basic: 'basic' }),
        minRating,
      },
    })
  }

  /**
   * @operationName Get Messages
   * @category Memory
   * @description Retrieves the raw conversation messages stored on a thread, with pagination. Returns messages in chronological order along with the total count.
   * @route GET /threads/{threadId}/messages
   * @paramDef {"type":"String","label":"Thread ID","name":"threadId","required":true,"description":"The thread ID whose messages to retrieve."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of messages to return. Defaults to server limit."}
   * @paramDef {"type":"Number","label":"Cursor","name":"cursor","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Message index to start from for pagination."}
   * @returns {Object}
   * @sampleResult {"messages":[{"uuid":"7b7b7b7b-eeee-ffff-0000-111111111111","role":"Jane","role_type":"user","content":"I just moved to Berlin.","created_at":"2026-07-14T10:06:00Z"}],"total_count":1,"row_count":1}
   */
  async getMessages(threadId, limit, cursor) {
    const logTag = '[getMessages]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/threads/${ encodeURIComponent(threadId) }/messages`,
      method: 'get',
      query: {
        limit,
        cursor,
      },
    })
  }

  /**
   * @operationName Add Graph Data
   * @category Graph
   * @description Adds arbitrary data directly to a knowledge graph, bypassing the conversation flow. Provide free-form text, a JSON string, or a message string, targeted at either a user's graph (user ID) or a shared group graph (group ID). Zep extracts entities and facts and merges them into the graph. Use this to ingest documents, business records, or external knowledge into memory.
   * @route POST /graph
   * @paramDef {"type":"String","label":"Data","name":"data","required":true,"description":"The content to ingest. Plain text, a JSON string, or message text depending on the selected type."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Text","JSON","Message"]}},"description":"How to interpret the data: Text for prose, JSON for a JSON string, Message for a single conversational message."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","dictionary":"getUsersDictionary","description":"Target user graph. Provide either a User ID or a Group ID, not both."}
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","description":"Target group graph. Provide either a Group ID or a User ID, not both."}
   * @returns {Object}
   * @sampleResult {"uuid":"3d3d3d3d-cccc-dddd-eeee-ffffffffffff","type":"text","content":"Jane prefers window seats when flying.","created_at":"2026-07-14T10:10:00Z","processed":false}
   */
  async addGraphData(data, type, userId, groupId) {
    const logTag = '[addGraphData]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/graph`,
      method: 'post',
      body: clean({
        data,
        type: this.#resolveChoice(type, { Text: 'text', JSON: 'json', Message: 'message' }),
        user_id: userId,
        group_id: groupId,
      }),
    })
  }

  /**
   * @operationName Search Graph
   * @category Graph
   * @description Searches a knowledge graph for the most relevant facts (edges) or entities (nodes) given a natural-language query. Scope the search to a user's graph or a group graph, choose whether to return edges or nodes, and cap the number of results. This is the core retrieval primitive for pulling targeted memory into a prompt or tool call.
   * @route POST /graph/search
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Natural-language search query. Zep returns the graph elements most relevant to this text."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","dictionary":"getUsersDictionary","description":"Search this user's graph. Provide either a User ID or a Group ID."}
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","description":"Search this group's graph. Provide either a Group ID or a User ID."}
   * @paramDef {"type":"String","label":"Scope","name":"scope","uiComponent":{"type":"DROPDOWN","options":{"values":["Edges","Nodes","Episodes"]}},"description":"What to return: Edges (facts/relationships), Nodes (entities), or Episodes (raw ingested data). Defaults to Edges."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return (max 50). Defaults to 10."}
   * @paramDef {"type":"String","label":"Reranker","name":"reranker","uiComponent":{"type":"DROPDOWN","options":{"values":["RRF","MMR","Cross Encoder","Node Distance","Episode Mentions"]}},"description":"Reranking strategy applied to raw search hits. Defaults to RRF."}
   * @returns {Object}
   * @sampleResult {"edges":[{"uuid":"e1e1e1e1-0000-1111-2222-333333333333","fact":"Jane recently relocated to Berlin.","name":"RELOCATED_TO","source_node_uuid":"n1","target_node_uuid":"n2","created_at":"2026-07-14T10:10:00Z"}],"nodes":[]}
   */
  async searchGraph(query, userId, groupId, scope, limit, reranker) {
    const logTag = '[searchGraph]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/graph/search`,
      method: 'post',
      body: clean({
        query,
        user_id: userId,
        group_id: groupId,
        scope: this.#resolveChoice(scope, {
          Edges: 'edges',
          Nodes: 'nodes',
          Episodes: 'episodes',
        }),
        limit: limit || 10,
        reranker: this.#resolveChoice(reranker, {
          'RRF': 'rrf',
          'MMR': 'mmr',
          'Cross Encoder': 'cross_encoder',
          'Node Distance': 'node_distance',
          'Episode Mentions': 'episode_mentions',
        }),
      }),
    })
  }

  /**
   * @operationName Get User Graph Episodes
   * @category Graph
   * @description Retrieves the most recent episodes (raw ingested data chunks such as messages or documents) from a user's knowledge graph. Episodes are the source records from which Zep extracts nodes and edges.
   * @route GET /graph/episodes/user/{userId}
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user ID whose graph episodes to retrieve. Search and select an existing user or type an ID."}
   * @paramDef {"type":"Number","label":"Last N","name":"lastN","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of most recent episodes to return. Defaults to server limit."}
   * @returns {Object}
   * @sampleResult {"episodes":[{"uuid":"3d3d3d3d-cccc-dddd-eeee-ffffffffffff","content":"Jane prefers window seats when flying.","source":"text","created_at":"2026-07-14T10:10:00Z","processed":true}]}
   */
  async getUserGraphEpisodes(userId, lastN) {
    const logTag = '[getUserGraphEpisodes]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/graph/episodes/user/${ encodeURIComponent(userId) }`,
      method: 'get',
      query: {
        lastn: lastN,
      },
    })
  }

  /**
   * @operationName Add Group
   * @category Groups
   * @description Creates a group, which owns a shared knowledge graph. Group graphs hold knowledge shared across many users (for example company policies or product facts) and can be searched independently of any single user. Provide a unique group ID plus an optional name and description.
   * @route POST /groups
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","required":true,"description":"Unique identifier for the group. Must be unique within the project."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional human-readable name for the group."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description of what the group graph contains."}
   * @returns {Object}
   * @sampleResult {"uuid":"a1a1a1a1-2222-3333-4444-555555555555","group_id":"policies","name":"Company Policies","description":"Shared HR and IT policy knowledge.","created_at":"2026-07-14T10:15:00Z"}
   */
  async addGroup(groupId, name, description) {
    const logTag = '[addGroup]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/groups`,
      method: 'post',
      body: clean({
        group_id: groupId,
        name,
        description,
      }),
    })
  }

  /**
   * @operationName Get Group
   * @category Groups
   * @description Retrieves a group and its metadata by group ID.
   * @route GET /groups/{groupId}
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","required":true,"description":"The group ID to retrieve."}
   * @returns {Object}
   * @sampleResult {"uuid":"a1a1a1a1-2222-3333-4444-555555555555","group_id":"policies","name":"Company Policies","description":"Shared HR and IT policy knowledge.","created_at":"2026-07-14T10:15:00Z"}
   */
  async getGroup(groupId) {
    const logTag = '[getGroup]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupId) }`,
      method: 'get',
    })
  }

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter users by ID, email, or name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for fetching additional users."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Provides a searchable list of Zep users for selecting a user ID in user, thread, and graph operations. The option value is the user's user ID.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing users."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe (user-123)","value":"user-123","note":"jane@example.com"}],"cursor":"2"}
   */
  async getUsersDictionary(payload) {
    const logTag = '[getUsersDictionary]'
    const { search, cursor } = payload || {}

    const pageNumber = cursor ? parseInt(cursor, 10) || 1 : 1

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users-ordered`,
      method: 'get',
      query: {
        pageNumber,
        pageSize: DEFAULT_DICTIONARY_LIMIT,
      },
    })

    const users = response.users || []
    const term = (search || '').toLowerCase()

    const filtered = term
      ? users.filter(user => {
        const haystack = [user.user_id, user.email, user.first_name, user.last_name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        return haystack.includes(term)
      })
      : users

    const items = filtered.map(user => {
      const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ')
      const label = fullName ? `${ fullName } (${ user.user_id })` : user.user_id

      return {
        label,
        value: user.user_id,
        note: user.email || undefined,
      }
    })

    const hasMore = users.length === DEFAULT_DICTIONARY_LIMIT

    return {
      items,
      cursor: hasMore ? String(pageNumber + 1) : undefined,
    }
  }
}

/**
 * @typedef {Object} ZepMessage
 * @paramDef {"type":"String","label":"Role Type","name":"role_type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["User","Assistant","System"]}},"description":"The type of speaker for this message."}
 * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the message."}
 * @paramDef {"type":"String","label":"Name","name":"role","description":"Optional speaker name (for example the user's first name or the assistant's persona name)."}
 */

Flowrunner.ServerCode.addService(ZepService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Zep Cloud API key, sent as the "Authorization: Api-Key <key>" header. Get it from app.getzep.com under Project Settings > API key.',
  },
])
