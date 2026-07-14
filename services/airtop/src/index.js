const logger = {
  info: (...args) => console.log('[Airtop] info:', ...args),
  debug: (...args) => console.log('[Airtop] debug:', ...args),
  error: (...args) => console.log('[Airtop] error:', ...args),
  warn: (...args) => console.log('[Airtop] warn:', ...args),
}

const API_BASE_URL = 'https://api.airtop.ai/api/v1'

const DEFAULT_DICTIONARY_LIMIT = 25

function clean(obj) {
  if (!obj || typeof obj !== 'object') {
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
 * @usesFileStorage
 * @integrationName Airtop
 * @integrationIcon /icon.png
 */
class AirtopService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, encoding, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      let request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(clean(query) || {})

      if (encoding !== undefined) {
        request = request.setEncoding(encoding)
      }

      return body !== undefined ? await request.send(clean(body)) : await request
    } catch (error) {
      const message = error.body?.error || error.body?.message || error.message
      const status = error.status || error.statusCode
      logger.error(`${ logTag } - failed${ status ? ` (${ status })` : '' }: ${ message }`)
      throw new Error(`Airtop API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Session
   * @category Sessions
   * @description Starts a new cloud browser session. A session is a stateful, isolated browser instance that persists across calls until it times out or is terminated. This is the first step of the Airtop lifecycle: create a session, open one or more windows (tabs) at URLs, run scrape/query/interaction operations, then terminate the session to release resources. Optionally load a saved profile to reuse persistent authentication (logged-in cookies), enable a proxy, set an idle timeout, or turn on captcha solving and session recording.
   * @route POST /sessions
   * @appearanceColor #6E56CF #9E8CF0
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"Number","label":"Idle Timeout (Minutes)","name":"timeoutMinutes","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Minutes of inactivity after which the session terminates automatically. Resets on each request to the session. Defaults to 10."}
   * @paramDef {"type":"String","label":"Profile Name","name":"profileName","description":"Name of a previously saved profile to load into the session, restoring cookies and logged-in state for reused authentication. Leave empty for a fresh browser."}
   * @paramDef {"type":"Boolean","label":"Enable Proxy","name":"proxy","uiComponent":{"type":"TOGGLE"},"description":"Route the session through Airtop's built-in proxy. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Solve Captcha","name":"solveCaptcha","uiComponent":{"type":"TOGGLE"},"description":"Automatically attempt to solve captcha challenges encountered during the session. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Record Session","name":"record","uiComponent":{"type":"TOGGLE"},"description":"Record the session for later playback. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"6a4b8f7e-1c2d-4e5f-9a0b-1c2d3e4f5a6b","status":"running","cdpWsUrl":"wss://...","profileName":"my-profile"}}
   */
  async createSession(timeoutMinutes, profileName, proxy, solveCaptcha, record) {
    const logTag = '[createSession]'

    const configuration = clean({
      timeoutMinutes,
      profileName,
      proxy: proxy === true ? true : undefined,
      solveCaptcha: solveCaptcha === true ? true : undefined,
      record: record === true ? true : undefined,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions`,
      method: 'post',
      body: { configuration },
    })
  }

  /**
   * @operationName Get Session
   * @category Sessions
   * @description Retrieves details and current status for a single browser session by its ID, including whether it is running, its connection info, and configuration. Use this to confirm a session is still active before opening windows or running operations.
   * @route GET /sessions/{id}
   * @appearanceColor #6E56CF #9E8CF0
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"ID of the session to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"6a4b8f7e-1c2d-4e5f-9a0b-1c2d3e4f5a6b","status":"running"}}
   */
  async getSession(sessionId) {
    const logTag = '[getSession]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Sessions
   * @category Sessions
   * @description Lists browser sessions for the account, optionally filtered by status. Returns paginated results with each session's ID, status, and metadata. Useful for finding active sessions to reuse or terminating stale ones.
   * @route GET /sessions
   * @appearanceColor #6E56CF #9E8CF0
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Awaiting Capacity","Initializing","Running","Ended"]}},"description":"Filter sessions by status. Defaults to All."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of sessions to return per page. Defaults to 25."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of sessions to skip for pagination. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"sessions":[{"id":"6a4b8f7e-1c2d-4e5f-9a0b-1c2d3e4f5a6b","status":"running"}],"pagination":{"totalItems":1}}}
   */
  async listSessions(status, limit, offset) {
    const logTag = '[listSessions]'

    const resolvedStatus = this.#resolveChoice(status, {
      All: undefined,
      'Awaiting Capacity': 'awaitingCapacity',
      Initializing: 'initializing',
      Running: 'running',
      Ended: 'ended',
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions`,
      method: 'get',
      query: {
        status: resolvedStatus,
        limit: limit || DEFAULT_DICTIONARY_LIMIT,
        offset: offset || 0,
      },
    })
  }

  /**
   * @operationName Terminate Session
   * @category Sessions
   * @description Ends a browser session immediately, closing all its windows and releasing resources. Always terminate sessions you no longer need — sessions bill until they end or hit their idle timeout. This is the final step of the Airtop lifecycle.
   * @route DELETE /sessions/{id}
   * @appearanceColor #6E56CF #9E8CF0
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"ID of the session to terminate."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async terminateSession(sessionId) {
    const logTag = '[terminateSession]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }`,
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName Save Profile On Termination
   * @category Sessions
   * @description Marks a running session so that when it terminates, its browser profile (cookies, local storage, logged-in state) is saved under the given profile name. Load that profile in a future Create Session to skip logging in again — the core pattern for persistent authentication in Airtop.
   * @route PUT /sessions/{sessionId}/save-profile-on-termination/{profileName}
   * @appearanceColor #6E56CF #9E8CF0
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"ID of the running session whose profile should be saved on termination."}
   * @paramDef {"type":"String","label":"Profile Name","name":"profileName","required":true,"description":"Name to save the profile under. Reuse this name in Create Session's Profile Name to restore the authenticated state."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async saveProfileOnTermination(sessionId, profileName) {
    const logTag = '[saveProfileOnTermination]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/save-profile-on-termination/${ encodeURIComponent(profileName) }`,
      method: 'put',
    })

    return { success: true }
  }

  // ---------------------------------------------------------------------------
  // Windows
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Window
   * @category Windows
   * @description Opens a new browser window (tab) inside an existing session and navigates it to the given URL. Returns the window ID used by all content and interaction operations. Optionally wait for a specific page-load milestone before returning.
   * @route POST /sessions/{sessionId}/windows
   * @appearanceColor #6E56CF #9E8CF0
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"ID of the session to open the window in."}
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The URL to navigate the new window to, e.g. https://example.com."}
   * @paramDef {"type":"String","label":"Wait Until","name":"waitUntil","uiComponent":{"type":"DROPDOWN","options":{"values":["Load","DOM Content Loaded","Complete And No Network Activity","No Wait"]}},"description":"Page-load milestone to wait for before returning. Defaults to Load."}
   * @paramDef {"type":"Number","label":"Wait Timeout (Seconds)","name":"waitUntilTimeoutSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum seconds to wait for the Wait Until milestone before continuing anyway."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"windowId":"win_9a0b1c2d"}}
   */
  async createWindow(sessionId, url, waitUntil, waitUntilTimeoutSeconds) {
    const logTag = '[createWindow]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/windows`,
      method: 'post',
      body: {
        url,
        waitUntil: this.#resolveWaitUntil(waitUntil),
        waitUntilTimeoutSeconds,
      },
    })
  }

  /**
   * @operationName Get Window Info
   * @category Windows
   * @description Retrieves information about an open window, including its live-view URL — a shareable link that streams a real-time, optionally interactive view of the browser tab so a human can watch or take over (for example to complete a manual login or captcha). Optionally include a navigation bar in the live view.
   * @route GET /sessions/{sessionId}/windows/{windowId}
   * @appearanceColor #6E56CF #9E8CF0
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"ID of the session the window belongs to."}
   * @paramDef {"type":"String","label":"Window ID","name":"windowId","required":true,"description":"ID of the window to retrieve, as returned by Create Window."}
   * @paramDef {"type":"Boolean","label":"Include Navigation Bar","name":"includeNavigationBar","uiComponent":{"type":"TOGGLE"},"description":"Render a navigation bar in the returned live-view URL so users can navigate. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"windowId":"win_9a0b1c2d","targetId":"target_1","liveViewUrl":"https://portal.airtop.ai/live/..."}}
   */
  async getWindowInfo(sessionId, windowId, includeNavigationBar) {
    const logTag = '[getWindowInfo]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/windows/${ encodeURIComponent(windowId) }`,
      method: 'get',
      query: {
        includeNavigationBar: includeNavigationBar === true ? true : undefined,
      },
    })
  }

  /**
   * @operationName Load URL
   * @category Windows
   * @description Navigates an existing window to a new URL, reusing the same tab and its session state (cookies, authentication). Optionally wait for a page-load milestone before returning.
   * @route POST /sessions/{sessionId}/windows/{windowId}
   * @appearanceColor #6E56CF #9E8CF0
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"ID of the session the window belongs to."}
   * @paramDef {"type":"String","label":"Window ID","name":"windowId","required":true,"description":"ID of the window to navigate."}
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The URL to navigate the window to."}
   * @paramDef {"type":"String","label":"Wait Until","name":"waitUntil","uiComponent":{"type":"DROPDOWN","options":{"values":["Load","DOM Content Loaded","Complete And No Network Activity","No Wait"]}},"description":"Page-load milestone to wait for before returning. Defaults to Load."}
   * @paramDef {"type":"Number","label":"Wait Timeout (Seconds)","name":"waitUntilTimeoutSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum seconds to wait for the Wait Until milestone before continuing anyway."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"windowId":"win_9a0b1c2d"}}
   */
  async loadUrl(sessionId, windowId, url, waitUntil, waitUntilTimeoutSeconds) {
    const logTag = '[loadUrl]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/windows/${ encodeURIComponent(windowId) }`,
      method: 'post',
      body: {
        url,
        waitUntil: this.#resolveWaitUntil(waitUntil),
        waitUntilTimeoutSeconds,
      },
    })
  }

  /**
   * @operationName Close Window
   * @category Windows
   * @description Closes a single window (tab) within a session while leaving the session itself running. Use this to free a tab you are done with without ending the whole session.
   * @route DELETE /sessions/{sessionId}/windows/{windowId}
   * @appearanceColor #6E56CF #9E8CF0
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"ID of the session the window belongs to."}
   * @paramDef {"type":"String","label":"Window ID","name":"windowId","required":true,"description":"ID of the window to close."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async closeWindow(sessionId, windowId) {
    const logTag = '[closeWindow]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/windows/${ encodeURIComponent(windowId) }`,
      method: 'delete',
    })

    return { success: true }
  }

  // ---------------------------------------------------------------------------
  // AI Content operations
  // ---------------------------------------------------------------------------

  /**
   * @operationName Scrape Content
   * @category Content
   * @description Extracts the full content of the currently loaded page in a window as structured text/markdown, suitable for downstream processing or feeding to an AI. Returns the page content without requiring a natural-language prompt. Use Page Query instead when you want a specific answer rather than the whole page.
   * @route POST /sessions/{sessionId}/windows/{windowId}/scrape-content
   * @appearanceColor #6E56CF #9E8CF0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"ID of the session the window belongs to."}
   * @paramDef {"type":"String","label":"Window ID","name":"windowId","required":true,"description":"ID of the window whose page content to scrape."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"modelResponse":"# Example Domain\n\nThis domain is for use in illustrative examples..."},"meta":{"credits":1}}
   */
  async scrapeContent(sessionId, windowId) {
    const logTag = '[scrapeContent]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/windows/${ encodeURIComponent(windowId) }/scrape-content`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @operationName Page Query
   * @category Content
   * @description Asks a natural-language question about the page currently loaded in a window and returns an AI-generated answer. Use it to extract specific data ("What is the product price?"), answer yes/no questions ("Is the user logged in?"), or pull structured fields. Provide an optional JSON Schema to force the answer into a structured JSON shape. Enable Follow Pagination Links to let Airtop click through pagination or load-more controls to gather more content (costs more credits).
   * @route POST /sessions/{sessionId}/windows/{windowId}/page-query
   * @appearanceColor #6E56CF #9E8CF0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"ID of the session the window belongs to."}
   * @paramDef {"type":"String","label":"Window ID","name":"windowId","required":true,"description":"ID of the window to query."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The natural-language question or extraction instruction about the page content."}
   * @paramDef {"type":"String","label":"Output Schema","name":"outputSchema","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional JSON Schema (as a JSON string) describing the structure to return. When provided, the answer is coerced into matching JSON."}
   * @paramDef {"type":"Boolean","label":"Follow Pagination Links","name":"followPaginationLinks","uiComponent":{"type":"TOGGLE"},"description":"Best-effort follow pagination/load-more controls to include more content. More costly. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"modelResponse":"The product price is $49.99."},"meta":{"credits":2}}
   */
  async pageQuery(sessionId, windowId, prompt, outputSchema, followPaginationLinks) {
    const logTag = '[pageQuery]'

    const configuration = outputSchema ? { outputSchema: this.#parseSchema(outputSchema, logTag) } : undefined

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/windows/${ encodeURIComponent(windowId) }/page-query`,
      method: 'post',
      body: {
        prompt,
        configuration,
        followPaginationLinks: followPaginationLinks === true ? true : undefined,
      },
    })
  }

  /**
   * @operationName Paginated Extract
   * @category Content
   * @description Extracts a list of results that spans multiple pages, automatically paginating (following next-page links, load-more buttons, or infinite scroll) and aggregating the items. Ideal for scraping search results, product listings, or tables that continue across pages. Provide an optional JSON Schema to shape each item.
   * @route POST /sessions/{sessionId}/windows/{windowId}/paginated-extraction
   * @appearanceColor #6E56CF #9E8CF0
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"ID of the session the window belongs to."}
   * @paramDef {"type":"String","label":"Window ID","name":"windowId","required":true,"description":"ID of the window to extract from."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Natural-language instruction describing the list of items to extract across pages, e.g. 'Extract every product name and price'."}
   * @paramDef {"type":"String","label":"Output Schema","name":"outputSchema","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional JSON Schema (as a JSON string) describing each extracted item's structure."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"modelResponse":"[{\"name\":\"Widget\",\"price\":\"$9.99\"}]"},"meta":{"credits":6}}
   */
  async paginatedExtract(sessionId, windowId, prompt, outputSchema) {
    const logTag = '[paginatedExtract]'

    const configuration = outputSchema ? { outputSchema: this.#parseSchema(outputSchema, logTag) } : undefined

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/windows/${ encodeURIComponent(windowId) }/paginated-extraction`,
      method: 'post',
      body: {
        prompt,
        configuration,
      },
    })
  }

  /**
   * @operationName Summarize Content
   * @category Content
   * @description Produces an AI-generated summary of the page currently loaded in a window. Optionally steer the summary with a prompt (e.g. 'Summarize the key pricing points in three bullets'). Useful for condensing long articles or documentation into a short digest.
   * @route POST /sessions/{sessionId}/windows/{windowId}/summarize-content
   * @appearanceColor #6E56CF #9E8CF0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"ID of the session the window belongs to."}
   * @paramDef {"type":"String","label":"Window ID","name":"windowId","required":true,"description":"ID of the window whose page to summarize."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional instruction to steer the summary, e.g. focus areas or desired length. Leave empty for a general summary."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"modelResponse":"The page explains how to create an Airtop session and open windows to automate browsing."},"meta":{"credits":2}}
   */
  async summarizeContent(sessionId, windowId, prompt) {
    const logTag = '[summarizeContent]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/windows/${ encodeURIComponent(windowId) }/summarize-content`,
      method: 'post',
      body: {
        prompt,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------

  /**
   * @operationName Click Element
   * @category Interactions
   * @description Clicks an element on the page identified by a natural-language description rather than a CSS selector — Airtop's AI locates the matching element visually. For example: 'the blue Sign In button' or 'the first search result link'. Optionally wait for navigation to finish after the click.
   * @route POST /sessions/{sessionId}/windows/{windowId}/click
   * @appearanceColor #6E56CF #9E8CF0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"ID of the session the window belongs to."}
   * @paramDef {"type":"String","label":"Window ID","name":"windowId","required":true,"description":"ID of the window to interact with."}
   * @paramDef {"type":"String","label":"Element Description","name":"elementDescription","required":true,"description":"Natural-language description of the element to click, e.g. 'the Add to Cart button'."}
   * @paramDef {"type":"Boolean","label":"Wait For Navigation","name":"waitForNavigation","uiComponent":{"type":"TOGGLE"},"description":"Wait for a page navigation to complete after the click before returning. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"modelResponse":"Clicked the Add to Cart button."},"meta":{"credits":1}}
   */
  async clickElement(sessionId, windowId, elementDescription, waitForNavigation) {
    const logTag = '[clickElement]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/windows/${ encodeURIComponent(windowId) }/click`,
      method: 'post',
      body: {
        elementDescription,
        waitForNavigation: waitForNavigation === true ? true : undefined,
      },
    })
  }

  /**
   * @operationName Type Text
   * @category Interactions
   * @description Types text into an input field identified by a natural-language description (e.g. 'the email address field'). Airtop's AI locates the field visually. Optionally clear the field first, and press Enter or Tab after typing to submit or advance a form.
   * @route POST /sessions/{sessionId}/windows/{windowId}/type
   * @appearanceColor #6E56CF #9E8CF0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"ID of the session the window belongs to."}
   * @paramDef {"type":"String","label":"Window ID","name":"windowId","required":true,"description":"ID of the window to interact with."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"description":"The text to type into the field."}
   * @paramDef {"type":"String","label":"Element Description","name":"elementDescription","required":true,"description":"Natural-language description of the input field, e.g. 'the search box'."}
   * @paramDef {"type":"Boolean","label":"Clear Field First","name":"clearInputField","uiComponent":{"type":"TOGGLE"},"description":"Clear any existing value in the field before typing. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Press Enter","name":"pressEnterKey","uiComponent":{"type":"TOGGLE"},"description":"Press the Enter key after typing, e.g. to submit the form. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Press Tab","name":"pressTabKey","uiComponent":{"type":"TOGGLE"},"description":"Press the Tab key after typing, e.g. to move to the next field. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"modelResponse":"Typed the query into the search box."},"meta":{"credits":1}}
   */
  async typeText(sessionId, windowId, text, elementDescription, clearInputField, pressEnterKey, pressTabKey) {
    const logTag = '[typeText]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/windows/${ encodeURIComponent(windowId) }/type`,
      method: 'post',
      body: {
        text,
        elementDescription,
        clearInputField: clearInputField === true ? true : undefined,
        pressEnterKey: pressEnterKey === true ? true : undefined,
        pressTabKey: pressTabKey === true ? true : undefined,
      },
    })
  }

  /**
   * @operationName Hover Element
   * @category Interactions
   * @description Moves the mouse over an element identified by a natural-language description, triggering hover states such as dropdown menus or tooltips. Airtop's AI locates the element visually.
   * @route POST /sessions/{sessionId}/windows/{windowId}/hover
   * @appearanceColor #6E56CF #9E8CF0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"ID of the session the window belongs to."}
   * @paramDef {"type":"String","label":"Window ID","name":"windowId","required":true,"description":"ID of the window to interact with."}
   * @paramDef {"type":"String","label":"Element Description","name":"elementDescription","required":true,"description":"Natural-language description of the element to hover over, e.g. 'the Products menu item'."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"modelResponse":"Hovered over the Products menu item."},"meta":{"credits":1}}
   */
  async hoverElement(sessionId, windowId, elementDescription) {
    const logTag = '[hoverElement]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/windows/${ encodeURIComponent(windowId) }/hover`,
      method: 'post',
      body: {
        elementDescription,
      },
    })
  }

  /**
   * @operationName Scroll Page
   * @category Interactions
   * @description Scrolls a window's page. Choose to scroll to an edge (top, bottom, left, right) or scroll toward an element described in natural language (e.g. 'the footer links'). Useful for loading lazy content or bringing a target into view before interacting with it.
   * @route POST /sessions/{sessionId}/windows/{windowId}/scroll
   * @appearanceColor #6E56CF #9E8CF0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"ID of the session the window belongs to."}
   * @paramDef {"type":"String","label":"Window ID","name":"windowId","required":true,"description":"ID of the window to scroll."}
   * @paramDef {"type":"String","label":"Scroll To Edge","name":"scrollToEdge","uiComponent":{"type":"DROPDOWN","options":{"values":["Top","Bottom","Left","Right"]}},"description":"Scroll to a page edge. Leave empty if scrolling to an element instead."}
   * @paramDef {"type":"String","label":"Scroll To Element","name":"scrollToElement","description":"Natural-language description of an element to scroll into view, e.g. 'the reviews section'. Leave empty if using Scroll To Edge."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"modelResponse":"Scrolled to the bottom of the page."},"meta":{"credits":1}}
   */
  async scrollPage(sessionId, windowId, scrollToEdge, scrollToElement) {
    const logTag = '[scrollPage]'

    const resolvedEdge = this.#resolveChoice(scrollToEdge, {
      Top: 'top',
      Bottom: 'bottom',
      Left: 'left',
      Right: 'right',
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/windows/${ encodeURIComponent(windowId) }/scroll`,
      method: 'post',
      body: {
        scrollToEdge: resolvedEdge,
        scrollToElement: scrollToElement || undefined,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Screenshot
  // ---------------------------------------------------------------------------

  /**
   * @operationName Take Screenshot
   * @category Screenshot
   * @description Captures a screenshot of the page currently loaded in a window and saves it to FlowRunner file storage, returning a downloadable URL. Use it to visually verify page state or capture evidence during an automation.
   * @route POST /sessions/{sessionId}/windows/{windowId}/screenshot
   * @appearanceColor #6E56CF #9E8CF0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"ID of the session the window belongs to."}
   * @paramDef {"type":"String","label":"Window ID","name":"windowId","required":true,"description":"ID of the window to screenshot."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"],"description":"Where to store the resulting screenshot file (FLOW, WORKSPACE, or EXECUTION scope)."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.io/airtop_screenshot_1720000000000.png","filename":"airtop_screenshot_1720000000000.png"}
   */
  async takeScreenshot(sessionId, windowId, fileOptions) {
    const logTag = '[takeScreenshot]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/windows/${ encodeURIComponent(windowId) }/screenshot`,
      method: 'post',
      body: {},
    })

    const dataUrl = this.#extractScreenshotDataUrl(response)

    if (!dataUrl) {
      throw new Error('Airtop API error: screenshot response did not include image data')
    }

    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
    const buffer = Buffer.from(base64, 'base64')
    const filename = `airtop_screenshot_${ Date.now() }.png`

    const uploaded = await this.flowrunner.Files.uploadFile(buffer, {
      filename,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { url: uploaded.url, filename }
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getSessionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match against session IDs."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) for fetching the next page of sessions."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sessions Dictionary
   * @description Provides a selectable list of active browser sessions for session-ID parameters across the service. The option value is the session ID.
   * @route POST /get-sessions-dictionary
   * @paramDef {"type":"getSessionsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing sessions."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"6a4b8f7e (running)","value":"6a4b8f7e-1c2d-4e5f-9a0b-1c2d3e4f5a6b","note":"running"}],"cursor":"25"}
   */
  async getSessionsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getSessionsDictionary]'

    const offset = cursor ? parseInt(cursor, 10) || 0 : 0

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sessions`,
      method: 'get',
      query: {
        limit: DEFAULT_DICTIONARY_LIMIT,
        offset,
      },
    })

    const sessions = response?.data?.sessions || []
    const searchLower = (search || '').toLowerCase()

    const filtered = searchLower
      ? sessions.filter(session => (session.id || '').toLowerCase().includes(searchLower))
      : sessions

    const items = filtered.map(session => {
      const shortId = (session.id || '').split('-')[0]

      return {
        label: session.status ? `${ shortId } (${ session.status })` : session.id,
        value: session.id,
        note: session.status || undefined,
      }
    })

    const returned = filtered.length
    const nextCursor = returned === DEFAULT_DICTIONARY_LIMIT ? String(offset + DEFAULT_DICTIONARY_LIMIT) : undefined

    return { items, cursor: nextCursor }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  #resolveWaitUntil(waitUntil) {
    return this.#resolveChoice(waitUntil, {
      Load: 'load',
      'DOM Content Loaded': 'domContentLoaded',
      'Complete And No Network Activity': 'complete',
      'No Wait': 'noWait',
    })
  }

  #parseSchema(schemaString, logTag) {
    if (typeof schemaString !== 'string') {
      return schemaString
    }

    try {
      return JSON.parse(schemaString)
    } catch (error) {
      logger.warn(`${ logTag } - Output Schema is not valid JSON; sending as-is: ${ error.message }`)

      return schemaString
    }
  }

  #extractScreenshotDataUrl(response) {
    const data = response?.data

    if (!data) {
      return undefined
    }

    if (typeof data.screenshot === 'string') {
      return data.screenshot
    }

    if (data.screenshot?.dataUrl) {
      return data.screenshot.dataUrl
    }

    if (Array.isArray(data.screenshots) && data.screenshots.length) {
      const first = data.screenshots[0]

      return first?.dataUrl || first?.data || (typeof first === 'string' ? first : undefined)
    }

    return data.dataUrl || undefined
  }
}

Flowrunner.ServerCode.addService(AirtopService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Airtop API key, sent as a Bearer token. Create one at portal.airtop.ai under API Keys.',
  },
])
