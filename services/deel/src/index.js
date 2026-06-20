"use strict";

/**
 * Deel FlowRunner Service
 * ---------------------------------------------------------------------------
 *  1. Constants, logger, helpers
 *  2. Service class + constructor
 *  3. Private API helper (#deelRequest, auth headers)
 *  4. OAuth2 system methods (getOAuth2ConnectionURL / executeCallback / refreshToken)
 *  5. Dictionaries (lookups + ID pickers)
 *  6. People & HRIS actions
 *  7. Contracts (IC) actions
 *  8. EOR actions
 *  9. Time Off actions
 * 10. Adjustments actions
 * 11. Payouts actions
 * 12. Global Payroll actions
 * 13. ATS actions
 * 14. Niche modules (Immigration, Screenings, Equity, IT, Magic Link, Knowledge Hub)
 * 15. Invoices & misc actions
 * 16. Webhook REALTIME_TRIGGER + system methods
 * 17. Service registration
 * ---------------------------------------------------------------------------
 */

// =================== 1. Constants, logger, helpers ===================

const PROD_OAUTH_BASE = "https://app.deel.com";
const PROD_API_BASE = "https://api.letsdeel.com/rest/v2";
const SANDBOX_OAUTH_BASE = "https://app.demo.deel.com";
const SANDBOX_API_BASE = "https://api-sandbox.demo.deel.com/rest/v2";

// Organization-app scopes. Deel rejects User-type scopes (profile:*, worker:*, auth:*,
// candidates:*) for Organization apps with "Invalid scopes for User type".
const DEFAULT_SCOPE_LIST = [
  "people:read",
  "people:write",
  "organizations:read",
  "organizations:write",
  "contracts:read",
  "contracts:write",
  "milestones:read",
  "milestones:write",
  "tasks:read",
  "tasks:write",
  "timesheets:read",
  "timesheets:write",
  "time-tracking:read",
  "time-tracking:write",
  "time-off:read",
  "time-off:write",
  "invoice-adjustments:read",
  "invoice-adjustments:write",
  "off-cycle-payments:read",
  "off-cycle-payments:write",
  "adjustments:read",
  "adjustments:write",
  "global-payroll:read",
  "global-payroll:write",
  "payslips:read",
  "benefits:read",
  "benefits:write",
  "legal-entity:read",
  "legal-entity:write",
  "groups:read",
  "groups:write",
  "screenings:read",
  "screenings:write",
  "immigration:read",
  "immigration:write",
  "ats:read",
  "ats:write",
  "forms:read",
  "knowledge-hub:read",
  "accounting:read",
  "it-assets:read",
  "it-orders:read",
  "it-policies:read",
  "equities:write",
];

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(" ");

const MethodCallTypes = {
  SHAPE_EVENT: "SHAPE_EVENT",
  FILTER_TRIGGER: "FILTER_TRIGGER",
};

// Curated fallback list for the webhook event dropdown when /webhooks/events/types is restricted.
const COMMON_DEEL_EVENTS = [
  "contract.created",
  "contract.updated",
  "contract.signed",
  "contract.terminated",
  "contract.cancelled",
  "contract.amendment.created",
  "contract.amendment.signed",
  "contract.amendment.cancelled",
  "contract.invoice.created",
  "contract.invoice.adjustment.created",
  "contract.invoice.adjustment.approved",
  "contract.milestone.created",
  "contract.milestone.approved",
  "contract.task.created",
  "contract.task.approved",
  "contract.timesheet.created",
  "contract.timesheet.approved",
  "contract.timesheet.rejected",
  "contract.payment.created",
  "contract.payment.failed",
  "eor.contract.created",
  "eor.contract.signed",
  "eor.contract.terminated",
  "eor.payslips.available",
  "people.created",
  "people.updated",
  "people.terminated",
  "timeoff.requested",
  "timeoff.approved",
  "timeoff.rejected",
  "timeoff.cancelled",
  "payroll.report.available",
  "payroll.cycle.closed",
  "ats.application.created",
  "ats.application.updated",
  "ats.candidate.created",
  "organization.created",
  "organization.updated",
  "screening.completed",
  "immigration.case.updated",
];

const logger = {
  info: (...args) => console.log("[Deel Service] info:", ...args),
  debug: (...args) => console.log("[Deel Service] debug:", ...args),
  warn: (...args) => console.log("[Deel Service] warn:", ...args),
  error: (...args) => console.log("[Deel Service] error:", ...args),
};

function cleanupObject(data) {
  if (!data || typeof data !== "object") return data;

  const result = {};

  Object.keys(data).forEach((key) => {
    const value = data[key];

    if (value !== undefined && value !== null && value !== "") {
      result[key] = value;
    }
  });

  return Object.keys(result).length > 0 ? result : undefined;
}

function searchFilter(items, fields, search) {
  if (!search) return items;

  const needle = String(search).toLowerCase();

  return items.filter((item) =>
    fields.some((field) => {
      const value = field.split(".").reduce((acc, key) => acc?.[key], item);

      return value && String(value).toLowerCase().includes(needle);
    }),
  );
}

function toDictionaryItems(list, labelKey, valueKey, noteKey) {
  return (list || []).map((item) => ({
    label: labelKey
      ? typeof labelKey === "function"
        ? labelKey(item)
        : item[labelKey]
      : String(item),
    value: valueKey
      ? typeof valueKey === "function"
        ? valueKey(item)
        : item[valueKey]
      : item,
    note: noteKey
      ? typeof noteKey === "function"
        ? noteKey(item)
        : item[noteKey]
      : "",
  }));
}

// =================== 2. Service class ===================

/**
 * @requireOAuth
 * @integrationName Deel
 * @integrationIcon /icon.png
 * @integrationTriggersScope ALL_APPS
 */
class DeelService {
  constructor(config) {
    this.clientId = config?.clientId;
    this.clientSecret = config?.clientSecret;
    this.environment = config?.environment || "Production";
    this.scopes = DEFAULT_SCOPE_STRING;
  }

  // =================== 3. Private API helper ===================

  #oauthBase() {
    return this.environment === "Sandbox"
      ? SANDBOX_OAUTH_BASE
      : PROD_OAUTH_BASE;
  }

  #apiBase() {
    return this.environment === "Sandbox" ? SANDBOX_API_BASE : PROD_API_BASE;
  }

  #accessToken() {
    const token = this.request?.headers?.["oauth-access-token"];

    if (!token) {
      throw new Error(
        "You are not connected to Deel. Open the connection settings and sign in again.",
      );
    }

    return token;
  }

  #authHeaders() {
    if (!this.clientId) {
      throw new Error(
        "Deel Client ID is missing. Open the service settings and paste the Client ID from your Deel OAuth2 app.",
      );
    }

    return {
      Authorization: `Bearer ${this.#accessToken()}`,
      "x-client-id": this.clientId,
    };
  }

  #basicAuthHeader() {
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        "Deel Client ID and Client Secret are required. Open the service settings and fill them in.",
      );
    }

    const creds = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString(
      "base64",
    );

    return { Authorization: `Basic ${creds}` };
  }

  async #deelRequest({
    method,
    path,
    body,
    query,
    headers,
    logTag,
    rawResponse,
    rawBody,
  }) {
    method = (method || "get").toLowerCase();

    const url = `${this.#apiBase()}${path}`;
    const cleanedQuery = query ? cleanupObject(query) : undefined;

    // Deel validates that all POST/PATCH/PUT bodies are wrapped in {data: ...}.
    // We auto-envelope unless the caller already did so or explicitly opts out
    // via rawBody: true. POST without a body still sends `{data: {}}`.
    const isWriteMethod = ["post", "patch", "put"].includes(method);
    let envelopedBody = body;

    if (isWriteMethod && !rawBody) {
      if (body === undefined || body === null) {
        envelopedBody = { data: {} };
      } else {
        const isAlreadyEnveloped =
          typeof body === "object" &&
          body !== null &&
          Object.keys(body).length === 1 &&
          "data" in body;

        if (!isAlreadyEnveloped) envelopedBody = { data: body };
      }
    }

    logger.debug(
      `${logTag || method} ${method.toUpperCase()} ${url} q=${JSON.stringify(cleanedQuery || {})}`,
    );

    // Up to 2 retries on 429 (Deel allows 5 req/sec per org, no headers exposed)
    const maxRetries = 2;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const req = Flowrunner.Request[method](url)
          .set(this.#authHeaders())
          .set({ Accept: "application/json" });

        if (cleanedQuery) req.query(cleanedQuery);
        if (headers) req.set(headers);

        if (envelopedBody !== undefined && envelopedBody !== null) {
          req.set({ "Content-Type": "application/json" });

          return await req.send(envelopedBody);
        }

        return await req;
      } catch (error) {
        lastError = error;

        const apiBody = error?.body || error?.message;
        const bodyText =
          typeof apiBody === "string" ? apiBody : JSON.stringify(apiBody || "");
        const isRateLimit =
          error?.status === 429 ||
          /too many requests|rate limit/i.test(bodyText);

        if (isRateLimit && attempt < maxRetries) {
          const waitMs = 1000 * (attempt + 1);

          logger.warn(
            `${logTag || method} - 429 rate limit, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        logger.error(`${logTag || method} - api error: ${bodyText}`);

        if (rawResponse) throw error;

        throw new Error(
          this.#friendlyError(apiBody) ||
            `Deel request failed: ${method.toUpperCase()} ${path}`,
        );
      }
    }

    throw lastError;
  }

  #friendlyError(body) {
    if (!body) return null;

    if (typeof body === "string") return body;

    if (body?.errors && Array.isArray(body.errors)) {
      return body.errors
        .map((e) => e.message || e.detail || JSON.stringify(e))
        .join("; ");
    }

    if (body?.error_description) return body.error_description;
    if (body?.message) return body.message;
    if (body?.error)
      return typeof body.error === "string"
        ? body.error
        : JSON.stringify(body.error);

    return JSON.stringify(body);
  }

  // =================== 4. OAuth2 system methods ===================

  /**
   * @route GET /getOAuth2ConnectionURL
   * @registerAs SYSTEM
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams();

    params.append("client_id", this.clientId);
    params.append("scope", this.scopes);
    params.append("response_type", "code");

    return `${this.#oauthBase()}/oauth2/authorize?${params.toString()}`;
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {Number} expirationInSeconds
   * @property {String} refreshToken
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   * @property {Boolean} overwrite
   */

  /**
   * @route POST /executeCallback
   * @registerAs SYSTEM
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams();

    params.append("grant_type", "authorization_code");
    params.append("code", callbackObject.code);
    params.append("redirect_uri", callbackObject.redirectURI);

    let tokenResponse;

    try {
      tokenResponse = await Flowrunner.Request.post(
        `${this.#oauthBase()}/oauth2/tokens`,
      )
        .set(this.#basicAuthHeader())
        .set({ "Content-Type": "application/x-www-form-urlencoded" })
        .send(params.toString());
    } catch (error) {
      logger.error(
        `[executeCallback] token exchange failed: ${error?.message || JSON.stringify(error)}`,
      );
      throw new Error(
        this.#friendlyError(error?.body || error?.message) ||
          "Deel token exchange failed.",
      );
    }

    let identityName = "Deel User";
    let avatarUrl;

    try {
      const tempToken = tokenResponse.access_token;
      const profile = await Flowrunner.Request.get(
        `${this.#apiBase()}/people/me`,
      ).set({
        Authorization: `Bearer ${tempToken}`,
        "x-client-id": this.clientId,
      });

      const me = profile?.data || profile;
      const fullName = [me?.first_name, me?.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();

      identityName = fullName
        ? `${fullName}${me?.email ? ` (${me.email})` : ""}`
        : me?.email || "Deel User";
      avatarUrl = me?.profile_picture;
    } catch (error) {
      logger.warn(
        `[executeCallback] profile fetch failed (non-fatal): ${error?.message}`,
      );
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName: identityName,
      connectionIdentityImageURL: avatarUrl,
      overwrite: true,
    };
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {Number} expirationInSeconds
   * @property {String} refreshToken
   */

  /**
   * @route PUT /refreshToken
   * @registerAs SYSTEM
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const params = new URLSearchParams();

    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refreshToken);

    try {
      const response = await Flowrunner.Request.post(
        `${this.#oauthBase()}/oauth2/tokens`,
      )
        .set(this.#basicAuthHeader())
        .set({ "Content-Type": "application/x-www-form-urlencoded" })
        .send(params.toString());

      return {
        token: response.access_token,
        expirationInSeconds: response.expires_in,
        // Deel rotates refresh tokens — always return the NEW one so the framework persists it
        refreshToken: response.refresh_token || refreshToken,
      };
    } catch (error) {
      const apiBody = error?.body || error?.message;
      const friendly = this.#friendlyError(apiBody) || error?.message;

      if (
        typeof friendly === "string" &&
        friendly.toLowerCase().includes("invalid_grant")
      ) {
        throw new Error(
          "Deel refresh token expired or already used — please reconnect Deel from the connection settings.",
        );
      }

      logger.error(
        `[refreshToken] error: ${typeof apiBody === "object" ? JSON.stringify(apiBody) : apiBody}`,
      );
      throw new Error(friendly || "Deel token refresh failed.");
    }
  }

  // =================== 4a. Connection smoke test ===================

  /**
   * @operationName Test Connection
   * @category Setup
   * @description Confirms that the service can reach Deel with the connected account. Run this once after connecting to verify the setup. Returns your name, email, and organization so you can confirm the right account is linked.
   * @route POST /testConnection
   *
   * @returns {Object}
   * @sampleResult {"ok":true,"connectedAs":{"name":"Jane Doe","email":"jane@acme.com"},"organization":{"id":"org_abc123","name":"Acme Inc"}}
   */
  async testConnection() {
    const me = await this.getMyProfile();
    const org = await this.getOrganization().catch(() => null);

    return {
      ok: true,
      connectedAs: {
        name:
          [me?.first_name, me?.last_name].filter(Boolean).join(" ") ||
          me?.email,
        email: me?.email,
      },
      organization: org ? { id: org?.id, name: org?.name } : null,
    };
  }

  /**
   * @operationName Get My Profile
   * @category People
   * @description Returns the Deel profile of the currently connected user. Useful to verify identity, fetch your worker ID, or display your name in flows.
   * @route POST /getMyProfile
   *
   * @returns {Object}
   * @sampleResult {"id":"abc-123","first_name":"Jane","last_name":"Doe","email":"jane@acme.com"}
   */
  async getMyProfile() {
    const response = await this.#deelRequest({
      method: "get",
      path: "/people/me",
      logTag: "getMyProfile",
    });

    return response?.data || response;
  }

  /**
   * @operationName Get Organization
   * @category Organization
   * @description Returns details about your Deel organization. Use this to fetch your org name, ID, and the country it operates from for use in other flows.
   * @route POST /getOrganization
   *
   * @returns {Object}
   * @sampleResult {"id":"org_abc","name":"Acme Inc","country":"US"}
   */
  async getOrganization() {
    const response = await this.#deelRequest({
      method: "get",
      path: "/organizations",
      logTag: "getOrganization",
    });

    return response?.data || response;
  }

  // =================== 5. Dictionaries ===================

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
   * @property {String} [cursor]
   */

  /**
   * @typedef {Object} getCountriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Type part of a country name to filter the list."}
   */

  /**
   * @operationName Countries (Lookup)
   * @description Returns the list of countries supported by Deel. Used to populate country dropdowns in other actions.
   * @registerAs DICTIONARY
   * @route POST /getCountriesDictionary
   * @param {getCountriesDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getCountriesDictionary(payload) {
    const response = await this.#deelRequest({
      method: "get",
      path: "/lookups/countries",
      logTag: "getCountriesDictionary",
    });
    const list = response?.data || [];
    const filtered = searchFilter(list, ["name", "code"], payload?.search);

    return { items: toDictionaryItems(filtered, "name", "code", "code") };
  }

  /**
   * @typedef {Object} getCurrenciesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Type part of a currency name or code (e.g., USD, EUR) to filter."}
   */

  /**
   * @operationName Currencies (Lookup)
   * @description Returns the list of currencies supported by Deel. Used for any amount/payment fields.
   * @registerAs DICTIONARY
   * @route POST /getCurrenciesDictionary
   * @param {getCurrenciesDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getCurrenciesDictionary(payload) {
    const response = await this.#deelRequest({
      method: "get",
      path: "/lookups/currencies",
      logTag: "getCurrenciesDictionary",
    });
    const list = response?.data || [];
    const filtered = searchFilter(list, ["name", "code"], payload?.search);

    return {
      items: filtered.map((c) => ({
        label: `${c.name} (${c.code})`,
        value: c.code,
        note: c.code,
      })),
    };
  }

  /**
   * @typedef {Object} getJobTitlesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Type part of a job title to filter."}
   */

  /**
   * @operationName Job Titles (Lookup)
   * @description Returns Deel's standard job titles. Used when creating contracts or job postings.
   * @registerAs DICTIONARY
   * @route POST /getJobTitlesDictionary
   * @param {getJobTitlesDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getJobTitlesDictionary(payload) {
    const response = await this.#deelRequest({
      method: "get",
      path: "/lookups/job-titles",
      logTag: "getJobTitlesDictionary",
    });
    const list = response?.data || [];
    const filtered = searchFilter(list, ["name"], payload?.search);

    return { items: toDictionaryItems(filtered, "name", "id", "name") };
  }

  /**
   * @typedef {Object} getSeniorityLevelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Type part of a seniority level (e.g., Junior, Senior) to filter."}
   */

  /**
   * @operationName Seniority Levels (Lookup)
   * @description Returns Deel's standard seniority levels. Used when creating contracts.
   * @registerAs DICTIONARY
   * @route POST /getSeniorityLevelsDictionary
   * @param {getSeniorityLevelsDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getSeniorityLevelsDictionary(payload) {
    const response = await this.#deelRequest({
      method: "get",
      path: "/lookups/seniorities",
      logTag: "getSeniorityLevelsDictionary",
    });
    const list = response?.data || [];
    const filtered = searchFilter(list, ["name"], payload?.search);

    return { items: toDictionaryItems(filtered, "name", "id", "name") };
  }

  /**
   * @typedef {Object} getTimeOffTypesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Type part of a time-off type name (e.g., Vacation, Sick) to filter."}
   */

  /**
   * @operationName Time Off Types (Lookup)
   * @description Returns the list of time-off types (Vacation, Sick, Personal, etc.) configured for your organization.
   * @registerAs DICTIONARY
   * @route POST /getTimeOffTypesDictionary
   * @param {getTimeOffTypesDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getTimeOffTypesDictionary(payload) {
    const response = await this.#deelRequest({
      method: "get",
      path: "/lookups/time-off-types",
      logTag: "getTimeOffTypesDictionary",
    });
    const list = response?.data || [];
    const filtered = searchFilter(list, ["name", "type"], payload?.search);

    return {
      items: filtered.map((t) => ({
        label: t.name || t.type,
        value: t.type || t.id,
        note: t.type || "",
      })),
    };
  }

  /**
   * @typedef {Object} getLegalEntitiesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Type part of a legal entity name to filter."}
   */

  /**
   * @operationName Legal Entities (Lookup)
   * @description Returns the legal entities (subsidiaries) in your Deel organization. Used when creating EOR contracts, running payroll, or filtering reports.
   * @registerAs DICTIONARY
   * @route POST /getLegalEntitiesDictionary
   * @param {getLegalEntitiesDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getLegalEntitiesDictionary(payload) {
    const response = await this.#deelRequest({
      method: "get",
      path: "/legal-entities",
      logTag: "getLegalEntitiesDictionary",
    });
    const list = response?.data || [];
    const filtered = searchFilter(list, ["name", "country"], payload?.search);

    return {
      items: filtered.map((e) => ({
        label: e.name,
        value: e.id,
        note: e.country || "",
      })),
    };
  }

  /**
   * @typedef {Object} getContractsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Type part of the contract title or worker name to filter."}
   * @paramDef {"type":"Object","label":"Criteria","name":"criteria","description":"Optional filter — set type to 'Contractor (IC)', 'Employee (EOR)', or 'Global Payroll'."}
   */

  /**
   * @operationName Contracts (Lookup)
   * @description Returns the list of contracts in your Deel organization. Used to pick a contract in other actions.
   * @registerAs DICTIONARY
   * @route POST /getContractsDictionary
   * @param {getContractsDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getContractsDictionary(payload) {
    const query = { limit: 100 };
    const typeMap = {
      "Contractor (IC)": "ongoing_time_based",
      "Employee (EOR)": "eor",
      "Global Payroll": "global_payroll",
    };

    if (payload?.criteria?.type && typeMap[payload.criteria.type]) {
      query["types[]"] = typeMap[payload.criteria.type];
    }

    const response = await this.#deelRequest({
      method: "get",
      path: "/contracts",
      query,
      logTag: "getContractsDictionary",
    });
    const list = response?.data || [];
    const filtered = searchFilter(
      list,
      ["title", "worker.email", "worker.full_name"],
      payload?.search,
    );

    return {
      items: filtered.map((c) => ({
        label: c.title || c.id,
        value: c.id,
        note: c.worker?.full_name || c.worker?.email || c.status || "",
      })),
    };
  }

  /**
   * @typedef {Object} getPeopleDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Type part of a name or email to filter."}
   */

  /**
   * @operationName People (Lookup)
   * @description Returns the list of people (workers, employees, contractors) in your Deel organization. Used to pick a person in other actions.
   * @registerAs DICTIONARY
   * @route POST /getPeopleDictionary
   * @param {getPeopleDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getPeopleDictionary(payload) {
    const query = { limit: 100 };

    if (payload?.search) query.search = payload.search;

    const response = await this.#deelRequest({
      method: "get",
      path: "/people",
      query,
      logTag: "getPeopleDictionary",
    });
    const list = response?.data || [];

    return {
      items: list.map((p) => ({
        label:
          [p.first_name, p.last_name].filter(Boolean).join(" ") ||
          p.email ||
          p.id,
        value: p.id,
        note: p.email || p.country || "",
      })),
    };
  }

  /**
   * @typedef {Object} getDepartmentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Type part of a department name to filter."}
   */

  /**
   * @operationName Departments (Lookup)
   * @description Returns the departments in your Deel organization.
   * @registerAs DICTIONARY
   * @route POST /getDepartmentsDictionary
   * @param {getDepartmentsDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getDepartmentsDictionary(payload) {
    const response = await this.#deelRequest({
      method: "get",
      path: "/departments",
      logTag: "getDepartmentsDictionary",
    });
    const list = response?.data || [];
    const filtered = searchFilter(list, ["name"], payload?.search);

    return { items: toDictionaryItems(filtered, "name", "id", "name") };
  }

  /**
   * @typedef {Object} getGroupsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Type part of a group name to filter."}
   */

  /**
   * @operationName Groups (Lookup)
   * @description Returns the worker groups configured in your Deel organization. Used for access control and reporting.
   * @registerAs DICTIONARY
   * @route POST /getGroupsDictionary
   * @param {getGroupsDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getGroupsDictionary(payload) {
    const response = await this.#deelRequest({
      method: "get",
      path: "/groups",
      logTag: "getGroupsDictionary",
    });
    const list = response?.data || [];
    const filtered = searchFilter(list, ["name"], payload?.search);

    return { items: toDictionaryItems(filtered, "name", "id", "name") };
  }

  /**
   * @typedef {Object} getWebhookEventTypesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Type part of an event name (e.g., contract.signed) to filter."}
   */

  /**
   * @operationName Webhook Event Types (Lookup)
   * @description Returns all Deel webhook event types you can subscribe to. Used by the realtime trigger to pick which events to listen for.
   * @registerAs DICTIONARY
   * @route POST /getWebhookEventTypesDictionary
   * @param {getWebhookEventTypesDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getWebhookEventTypesDictionary(payload) {
    let list;

    try {
      const response = await this.#deelRequest({
        method: "get",
        path: "/webhooks/events/types",
        logTag: "getWebhookEventTypesDictionary",
      });

      list = response?.data || [];
    } catch (error) {
      // Some Deel environments restrict /webhooks/events/types — fall back to the curated common-events list
      logger.warn(
        `[getWebhookEventTypesDictionary] live list unavailable, falling back to curated events: ${error.message}`,
      );
      list = COMMON_DEEL_EVENTS.map((name) => ({ name, description: "" }));
    }

    const filtered = searchFilter(
      list,
      ["name", "description", "module_label"],
      payload?.search,
    );

    return {
      items: filtered.map((e) => ({
        label: e.name,
        value: e.name,
        note: e.description || e.module_label || "",
      })),
    };
  }

  /**
   * @typedef {Object} getAdjustmentCategoriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Type part of a category name (e.g., Bonus, Deduction) to filter."}
   */

  /**
   * @operationName Adjustment Categories (Lookup)
   * @description Returns the categories available when adding adjustments (bonuses, deductions, reimbursements).
   * @registerAs DICTIONARY
   * @route POST /getAdjustmentCategoriesDictionary
   * @param {getAdjustmentCategoriesDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getAdjustmentCategoriesDictionary(payload) {
    const response = await this.#deelRequest({
      method: "get",
      path: "/adjustments/categories",
      logTag: "getAdjustmentCategoriesDictionary",
    });
    const list = response?.data || [];
    const filtered = searchFilter(list, ["name", "type"], payload?.search);

    return {
      items: filtered.map((c) => ({
        label: c.name || c.type,
        value: c.type || c.id,
        note: c.type || "",
      })),
    };
  }

  /**
   * @typedef {Object} getContractStatusesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Type part of a status to filter."}
   */

  /**
   * @operationName Contract Statuses (Lookup)
   * @description Returns the standard Deel contract statuses (Active, Pending, Terminated, etc.).
   * @registerAs DICTIONARY
   * @route POST /getContractStatusesDictionary
   * @param {getContractStatusesDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getContractStatusesDictionary(payload) {
    const list = [
      "in_progress",
      "awaiting_deposit_payment",
      "active",
      "paused",
      "terminated",
      "cancelled",
      "completed",
    ].map((s) => ({
      name: s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      value: s,
    }));

    const filtered = searchFilter(list, ["name", "value"], payload?.search);

    return {
      items: filtered.map((s) => ({
        label: s.name,
        value: s.value,
        note: s.value,
      })),
    };
  }

  /**
   * @typedef {Object} getATSJobsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Type part of a job title to filter."}
   */

  /**
   * @operationName ATS Jobs (Lookup)
   * @description Returns the open jobs in your Deel Applicant Tracking System (ATS). Used when creating candidates or applications.
   * @registerAs DICTIONARY
   * @route POST /getATSJobsDictionary
   * @param {getATSJobsDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getATSJobsDictionary(payload) {
    const response = await this.#deelRequest({
      method: "get",
      path: "/ats/jobs",
      logTag: "getATSJobsDictionary",
    });
    const list = response?.data || [];
    const filtered = searchFilter(list, ["title", "name"], payload?.search);

    return {
      items: filtered.map((j) => ({
        label: j.title || j.name || j.id,
        value: j.id,
        note: j.status || j.department || "",
      })),
    };
  }

  // =================== 6. People & HRIS actions ===================

  /**
   * @operationName List People
   * @category People
   * @description Returns the list of people (workers, employees, contractors) in your Deel organization. Filter by status, country, or type, or search by name/email.
   * @route POST /listPeople
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive","Pending","Onboarding","Terminated"]}},"description":"Filter by employment status. Leave blank to list everyone."}
   * @paramDef {"type":"String","label":"Country","name":"country","required":false,"dictionary":"getCountriesDictionary","description":"Filter by the country where the worker is based. Leave blank for all countries."}
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Search by name, email, or ID. Examples: 'Jane Doe', 'jane@acme.com'. Leave blank to list everyone."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of people to return per page. Default 50."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"per_abc","first_name":"Jane","last_name":"Doe","email":"jane@acme.com","country":"US"}]}
   */
  async listPeople(status, country, search, limit) {
    const query = { limit: limit || 50 };

    if (status) query.hiring_status = status.toLowerCase();
    if (country) query.country = country;
    if (search) query.search = search;

    const response = await this.#deelRequest({
      method: "get",
      path: "/people",
      query,
      logTag: "listPeople",
    });

    return response;
  }

  /**
   * @operationName Get Person
   * @category People
   * @description Returns the full profile of one person in your Deel organization. Pick by their Deel ID or by an external ID from your own system.
   * @route POST /getPerson
   * @paramDef {"type":"String","label":"Person","name":"personId","required":false,"dictionary":"getPeopleDictionary","description":"Pick the person from the list. Leave blank if looking up by external ID."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","required":false,"description":"Look up by an ID from your own system. Examples: 'EMP-001'. Leave blank if picking from the list above."}
   * @returns {Object}
   * @sampleResult {"id":"per_abc","first_name":"Jane","last_name":"Doe","email":"jane@acme.com"}
   */
  async getPerson(personId, externalId) {
    if (!personId && !externalId)
      throw new Error("Provide either a Person or an External ID to look up.");

    const path = externalId
      ? `/people/external_id/${encodeURIComponent(externalId)}`
      : `/people/${encodeURIComponent(personId)}`;

    const response = await this.#deelRequest({
      method: "get",
      path,
      logTag: "getPerson",
    });

    return response?.data || response;
  }

  /**
   * @operationName Update Person
   * @category People
   * @description Updates a person's profile information (name, email, phone, etc.). Only fields you fill in will be updated.
   * @route POST /updatePerson
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"getPeopleDictionary","description":"Pick the person to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":false,"description":"New first name. Examples: 'Jane'. Leave blank to keep unchanged."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":false,"description":"New last name. Examples: 'Doe'. Leave blank to keep unchanged."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":false,"description":"New work email. Examples: 'jane@acme.com'. Leave blank to keep unchanged."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","required":false,"description":"New phone number with country code. Examples: '+1 555 123 4567'. Leave blank to keep unchanged."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","required":false,"description":"New job title. Examples: 'Senior Engineer'. Leave blank to keep unchanged."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"per_abc","first_name":"Jane","last_name":"Doe","email":"jane@acme.com"}}
   */
  async updatePerson(personId, firstName, lastName, email, phone, jobTitle) {
    const body = cleanupObject({
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      job_title: jobTitle,
    });

    if (!body) throw new Error("Provide at least one field to update.");

    return this.#deelRequest({
      method: "patch",
      path: `/people/${encodeURIComponent(personId)}`,
      body,
      logTag: "updatePerson",
    });
  }

  /**
   * @operationName Update Working Location
   * @category People
   * @description Updates the country and city where the person is currently working. Used for tax, compliance, and benefits calculations.
   * @route POST /updateWorkingLocation
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"getPeopleDictionary","description":"Pick the person to update."}
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"dictionary":"getCountriesDictionary","description":"Country where the worker is now based."}
   * @paramDef {"type":"String","label":"City","name":"city","required":false,"description":"City where the worker is now based. Examples: 'Berlin', 'San Francisco'."}
   * @paramDef {"type":"Date","label":"Effective Date","name":"effectiveDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Date the new location takes effect. Leave blank to apply immediately."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"per_abc","country":"DE","city":"Berlin"}}
   */
  async updateWorkingLocation(personId, country, city, effectiveDate) {
    const body = cleanupObject({
      country,
      city,
      effective_date: effectiveDate,
    });

    return this.#deelRequest({
      method: "patch",
      path: `/people/${encodeURIComponent(personId)}/working-location`,
      body,
      logTag: "updateWorkingLocation",
    });
  }

  /**
   * @operationName Create Person Without Contract
   * @category People
   * @description Adds a new person to Deel without immediately creating a contract. Useful for pre-onboarding workflows where you collect data before signing.
   * @route POST /createPersonWithoutContract
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"Examples: 'Jane'."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"Examples: 'Doe'."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Work email. Examples: 'jane@acme.com'."}
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"dictionary":"getCountriesDictionary","description":"Country where the person is based."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","required":false,"description":"Examples: 'Senior Engineer'."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"per_new","first_name":"Jane","last_name":"Doe","email":"jane@acme.com"}}
   */
  async createPersonWithoutContract(
    firstName,
    lastName,
    email,
    country,
    jobTitle,
  ) {
    const body = cleanupObject({
      first_name: firstName,
      last_name: lastName,
      email,
      country,
      job_title: jobTitle,
    });

    return this.#deelRequest({
      method: "post",
      path: "/people",
      body,
      logTag: "createPersonWithoutContract",
    });
  }

  /**
   * @operationName Create Direct Employee
   * @category People
   * @description Creates a direct employee record (you employ them, not Deel). For EOR-managed employees use Create EOR Worker.
   * @route POST /createDirectEmployee
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"Examples: 'Jane'."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"Examples: 'Doe'."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Work email. Examples: 'jane@acme.com'."}
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"dictionary":"getCountriesDictionary","description":"Country where the employee works."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","required":true,"description":"Examples: 'Senior Engineer'."}
   * @paramDef {"type":"Date","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"First day of work."}
   * @paramDef {"type":"String","label":"Legal Entity","name":"legalEntityId","required":false,"dictionary":"getLegalEntitiesDictionary","description":"Which legal entity employs this person. Leave blank to use the default."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"emp_new","first_name":"Jane","email":"jane@acme.com","start_date":"2026-06-01"}}
   */
  async createDirectEmployee(
    firstName,
    lastName,
    email,
    country,
    jobTitle,
    startDate,
    legalEntityId,
  ) {
    const body = cleanupObject({
      first_name: firstName,
      last_name: lastName,
      email,
      country,
      job_title: jobTitle,
      start_date: startDate,
      legal_entity_id: legalEntityId,
    });

    return this.#deelRequest({
      method: "post",
      path: "/hris/direct-employees",
      body,
      logTag: "createDirectEmployee",
    });
  }

  /**
   * @operationName List Org Structure
   * @category HRIS
   * @description Returns your organization's structure (teams, departments, hierarchies) configured in Deel.
   * @route POST /listOrgStructure
   * @returns {Object}
   * @sampleResult {"data":[{"id":"team_abc","name":"Engineering","parent_id":null}]}
   */
  async listOrgStructure() {
    return this.#deelRequest({
      method: "get",
      path: "/hris/organization_structures",
      logTag: "listOrgStructure",
    });
  }

  /**
   * @operationName Get Org Structure Node
   * @category HRIS
   * @description Returns one node (team or department) from your org structure.
   * @route POST /getOrgStructure
   * @paramDef {"type":"String","label":"Structure ID","name":"structureId","required":false,"description":"Deel's internal ID for the team/department. Leave blank if using External ID below."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","required":false,"description":"Your own ID for this team/department. Leave blank if using Structure ID above."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"team_abc","name":"Engineering","parent_id":null}}
   */
  async getOrgStructure(structureId, externalId) {
    if (!structureId && !externalId)
      throw new Error("Provide either a Structure ID or an External ID.");

    const path = externalId
      ? `/hris/organization_structures/external/${encodeURIComponent(externalId)}`
      : `/hris/organization_structures/${encodeURIComponent(structureId)}`;

    return this.#deelRequest({
      method: "get",
      path,
      logTag: "getOrgStructure",
    });
  }

  /**
   * @operationName Create Org Structure Node
   * @category HRIS
   * @description Creates a new team or department in your org structure.
   * @route POST /createOrgStructure
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name for the team/department. Examples: 'Engineering', 'Customer Success'."}
   * @paramDef {"type":"String","label":"Parent Node","name":"parentId","required":false,"description":"ID of the parent team. Leave blank for a top-level team."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","required":false,"description":"Your own ID for this node, for syncing with other systems."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"team_new","name":"Engineering"}}
   */
  async createOrgStructure(name, parentId, externalId) {
    const body = cleanupObject({
      name,
      parent_id: parentId,
      external_id: externalId,
    });

    return this.#deelRequest({
      method: "post",
      path: "/hris/organization_structures",
      body,
      logTag: "createOrgStructure",
    });
  }

  /**
   * @operationName Update Org Structure Node
   * @category HRIS
   * @description Updates a team or department's name or parent.
   * @route POST /updateOrgStructure
   * @paramDef {"type":"String","label":"Structure ID","name":"structureId","required":true,"description":"Deel's internal ID for the team/department to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":false,"description":"New display name."}
   * @paramDef {"type":"String","label":"Parent Node","name":"parentId","required":false,"description":"New parent team ID. Set to null to move to top level."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"team_abc","name":"New Name"}}
   */
  async updateOrgStructure(structureId, name, parentId) {
    const body = cleanupObject({ name, parent_id: parentId });

    return this.#deelRequest({
      method: "patch",
      path: `/hris/organization_structures/${encodeURIComponent(structureId)}`,
      body,
      logTag: "updateOrgStructure",
    });
  }

  /**
   * @operationName Delete Org Structure Node
   * @category HRIS
   * @description Removes a team or department from your org structure. Children will be reassigned to the parent.
   * @route POST /deleteOrgStructure
   * @paramDef {"type":"String","label":"Structure ID","name":"structureId","required":true,"description":"Deel's internal ID for the team/department to delete."}
   * @returns {Object}
   * @sampleResult {"ok":true}
   */
  async deleteOrgStructure(structureId) {
    await this.#deelRequest({
      method: "delete",
      path: `/hris/organization_structures/${encodeURIComponent(structureId)}`,
      logTag: "deleteOrgStructure",
    });

    return { ok: true };
  }

  /**
   * @operationName Get Custom Fields
   * @category HRIS
   * @description Returns the custom fields defined on a person, contract, or organization. Use this to discover what data is being tracked.
   * @route POST /getCustomFields
   * @paramDef {"type":"String","label":"Scope","name":"scope","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Person","Contract","Organization"]}},"description":"Which kind of record's custom fields you want to see."}
   * @paramDef {"type":"String","label":"Resource ID","name":"resourceId","required":false,"description":"For Person/Contract scope: the person or contract ID. Leave blank for Organization scope or to list all field definitions."}
   * @returns {Object}
   * @sampleResult {"data":[{"key":"slack_handle","value":"@jane"}]}
   */
  async getCustomFields(scope, resourceId) {
    const lower = (scope || "").toLowerCase();

    let path;

    if (lower === "person") {
      path = resourceId
        ? `/people/${encodeURIComponent(resourceId)}/custom-fields`
        : "/hris/people/custom-fields";
    } else if (lower === "contract") {
      path = resourceId
        ? `/contracts/${encodeURIComponent(resourceId)}/custom_fields`
        : "/hris/contracts/custom-fields";
    } else if (lower === "organization") {
      path = "/hris/organization_structures/custom-fields";
    } else {
      throw new Error("Scope must be Person, Contract, or Organization.");
    }

    return this.#deelRequest({
      method: "get",
      path,
      logTag: "getCustomFields",
    });
  }

  /**
   * @operationName Set Custom Field
   * @category HRIS
   * @description Sets the value of a custom field on a person or contract. Creates the value if it doesn't exist, updates it if it does.
   * @route POST /setCustomField
   * @paramDef {"type":"String","label":"Scope","name":"scope","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Person","Contract"]}},"description":"Which kind of record to update."}
   * @paramDef {"type":"String","label":"Resource ID","name":"resourceId","required":true,"description":"ID of the person or contract."}
   * @paramDef {"type":"String","label":"Field Key","name":"key","required":true,"description":"The custom field's key. Examples: 'slack_handle', 't_shirt_size'."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The new value to store."}
   * @returns {Object}
   * @sampleResult {"data":{"key":"slack_handle","value":"@jane"}}
   */
  async setCustomField(scope, resourceId, key, value) {
    const lower = (scope || "").toLowerCase();
    const path =
      lower === "person"
        ? `/people/${encodeURIComponent(resourceId)}/custom-fields/${encodeURIComponent(key)}`
        : `/contracts/${encodeURIComponent(resourceId)}/custom_fields/${encodeURIComponent(key)}`;

    return this.#deelRequest({
      method: "patch",
      path,
      body: { value },
      logTag: "setCustomField",
    });
  }

  /**
   * @operationName Delete Custom Field Value
   * @category HRIS
   * @description Clears a custom field's value on a person or contract.
   * @route POST /deleteCustomField
   * @paramDef {"type":"String","label":"Scope","name":"scope","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Person","Contract"]}},"description":"Which kind of record to update."}
   * @paramDef {"type":"String","label":"Resource ID","name":"resourceId","required":true,"description":"ID of the person or contract."}
   * @paramDef {"type":"String","label":"Field Key","name":"key","required":true,"description":"The custom field's key to clear."}
   * @returns {Object}
   * @sampleResult {"ok":true}
   */
  async deleteCustomField(scope, resourceId, key) {
    const lower = (scope || "").toLowerCase();
    const path =
      lower === "person"
        ? `/people/${encodeURIComponent(resourceId)}/custom-fields/${encodeURIComponent(key)}`
        : `/contracts/${encodeURIComponent(resourceId)}/custom_fields/${encodeURIComponent(key)}`;

    await this.#deelRequest({
      method: "delete",
      path,
      logTag: "deleteCustomField",
    });

    return { ok: true };
  }

  /**
   * @operationName List Worker Relations
   * @category HRIS
   * @description Returns the management and reporting relationships for a person (manager, direct reports, mentors, etc.).
   * @route POST /listWorkerRelations
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"getPeopleDictionary","description":"Pick the person whose relations you want to see."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"rel_1","type":"manager","target":{"id":"per_xyz","name":"Sarah Wilson"}}]}
   */
  async listWorkerRelations(personId) {
    return this.#deelRequest({
      method: "get",
      path: `/hris/profiles/${encodeURIComponent(personId)}/worker-relations`,
      logTag: "listWorkerRelations",
    });
  }

  // =================== 7. Contracts (IC) actions ===================

  /**
   * @operationName List Contracts
   * @category Contracts
   * @description Returns the list of contracts in your Deel organization. Filter by status, country, or type to narrow the list, or look up by external ID.
   * @route POST /listContracts
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"dictionary":"getContractStatusesDictionary","description":"Filter by contract status. Leave blank to see all."}
   * @paramDef {"type":"String","label":"Country","name":"country","required":false,"dictionary":"getCountriesDictionary","description":"Filter by worker country. Leave blank for all."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Contractor (IC)","Employee (EOR)","Global Payroll","Direct Employee"]}},"description":"Filter by contract type. Leave blank for all types."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","required":false,"description":"Look up one contract by an ID from your own system. Examples: 'CON-2026-001'. Leave blank to list multiple."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of contracts to return. Default 50."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"con_abc","title":"Senior Engineer","status":"active","worker":{"email":"jane@acme.com"}}]}
   */
  async listContracts(status, country, type, externalId, limit) {
    if (externalId) {
      return this.#deelRequest({
        method: "get",
        path: `/contracts/external_id/${encodeURIComponent(externalId)}`,
        logTag: "listContracts",
      });
    }

    const query = { limit: limit || 50 };

    if (status) query.status = status;

    if (type) {
      const typeMap = {
        "Contractor (IC)": "ongoing_time_based",
        "Employee (EOR)": "eor",
        "Global Payroll": "global_payroll",
        "Direct Employee": "shield",
      };
      if (typeMap[type]) query["types[]"] = typeMap[type];
    }

    if (country) query.country_code = country;

    return this.#deelRequest({
      method: "get",
      path: "/contracts",
      query,
      logTag: "listContracts",
    });
  }

  /**
   * @operationName Get Contract
   * @category Contracts
   * @description Returns the full details of one contract.
   * @route POST /getContract
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract to fetch."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"con_abc","title":"Senior Engineer","status":"active"}}
   */
  async getContract(contractId) {
    return this.#deelRequest({
      method: "get",
      path: `/contracts/${encodeURIComponent(contractId)}`,
      logTag: "getContract",
    });
  }

  /**
   * @operationName Create Contractor Contract
   * @category Contracts
   * @description Creates a new contractor (IC) agreement in Deel. The worker will receive an invitation to review and sign.
   * @route POST /createContractorContract
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Job title or contract name. Examples: 'Senior Engineer', 'Marketing Consultant'."}
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"dictionary":"getCountriesDictionary","description":"Country where the contractor will work from."}
   * @paramDef {"type":"String","label":"Rate Type","name":"rateType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Hourly","Daily","Weekly","Monthly","Yearly","Task-based","Milestone-based"]}},"description":"How the contractor is paid."}
   * @paramDef {"type":"Number","label":"Rate Amount","name":"rateAmount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pay rate amount. Examples: 50, 8000."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"dictionary":"getCurrenciesDictionary","description":"Pay currency. Examples: USD, EUR."}
   * @paramDef {"type":"Date","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"First day of the engagement."}
   * @paramDef {"type":"String","label":"Worker Email","name":"workerEmail","required":false,"description":"Worker's email so Deel can send the invite. Examples: 'jane@acme.com'."}
   * @paramDef {"type":"String","label":"Scope of Work","name":"scope","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What the contractor will do. Helps with legal compliance."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","required":false,"description":"Your own ID for tracking this contract. Examples: 'CON-2026-001'."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"con_new","title":"Senior Engineer","status":"in_progress"}}
   */
  async createContractorContract(
    title,
    country,
    rateType,
    rateAmount,
    currency,
    startDate,
    workerEmail,
    scope,
    externalId,
  ) {
    const rateMap = {
      Hourly: "hourly",
      Daily: "daily",
      Weekly: "weekly",
      Monthly: "monthly",
      Yearly: "yearly",
      "Task-based": "pay_as_you_go",
      "Milestone-based": "milestones",
    };

    const body = cleanupObject({
      type: "ongoing_time_based",
      title,
      country_code: country,
      start_date: startDate,
      external_id: externalId,
      job_title_name: title,
      scope,
      worker: workerEmail ? { email: workerEmail } : undefined,
      compensation_details: {
        amount: rateAmount,
        currency_code: currency,
        scale: rateMap[rateType] || "hourly",
      },
    });

    return this.#deelRequest({
      method: "post",
      path: "/contracts",
      body,
      logTag: "createContractorContract",
    });
  }

  /**
   * @operationName Send Contract to Worker
   * @category Contracts
   * @description Sends the contract to the worker for review and signature. Required step before the contract becomes active.
   * @route POST /sendContractToWorker
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract to send."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"con_abc","status":"awaiting_worker_signature"}}
   */
  async sendContractToWorker(contractId) {
    return this.#deelRequest({
      method: "post",
      path: `/contracts/${encodeURIComponent(contractId)}/invitations`,
      logTag: "sendContractToWorker",
    });
  }

  /**
   * @operationName Sign Contract
   * @category Contracts
   * @description Signs a contract on behalf of the client (your organization). Confirms the agreement and triggers worker invitation.
   * @route POST /signContract
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract to sign."}
   * @paramDef {"type":"String","label":"Signature","name":"signature","required":true,"description":"Your typed-out name as the signature. Examples: 'Jane Doe'."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"con_abc","status":"active"}}
   */
  async signContract(contractId, signature) {
    return this.#deelRequest({
      method: "post",
      path: `/contracts/${encodeURIComponent(contractId)}/signatures`,
      body: { client_signature: signature },
      logTag: "signContract",
    });
  }

  /**
   * @operationName Preview Contract Agreement
   * @category Contracts
   * @description Returns a preview of the contract PDF as a URL or base64 string. Useful for letting workers review before sending.
   * @route POST /previewContractAgreement
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract to preview."}
   * @returns {Object}
   * @sampleResult {"data":{"url":"https://deel.com/contracts/con_abc/preview.pdf"}}
   */
  async previewContractAgreement(contractId) {
    return this.#deelRequest({
      method: "get",
      path: `/contracts/${encodeURIComponent(contractId)}/preview`,
      logTag: "previewContractAgreement",
    });
  }

  /**
   * @operationName Get Worker Invite Link
   * @category Contracts
   * @description Returns the URL the worker can use to access their Deel onboarding/signing page. Useful for re-sending invitations.
   * @route POST /getWorkerInviteLink
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract."}
   * @returns {Object}
   * @sampleResult {"data":{"invite_link":"https://app.deel.com/onboarding/abc"}}
   */
  async getWorkerInviteLink(contractId) {
    return this.#deelRequest({
      method: "get",
      path: `/contracts/${encodeURIComponent(contractId)}/invite`,
      logTag: "getWorkerInviteLink",
    });
  }

  /**
   * @operationName Remove Worker Invite
   * @category Contracts
   * @description Revokes the worker invitation. Useful if the wrong person was invited or details need correcting.
   * @route POST /removeWorkerInvite
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract to revoke the invite for."}
   * @returns {Object}
   * @sampleResult {"ok":true}
   */
  async removeWorkerInvite(contractId) {
    await this.#deelRequest({
      method: "delete",
      path: `/contracts/${encodeURIComponent(contractId)}/invite`,
      logTag: "removeWorkerInvite",
    });

    return { ok: true };
  }

  /**
   * @operationName Terminate Contract
   * @category Contracts
   * @description Initiates termination of a contract. Specify the reason and last working day.
   * @route POST /terminateContract
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract to terminate."}
   * @paramDef {"type":"Date","label":"Last Working Day","name":"effectiveDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The worker's last day. Pay will be calculated up to this date."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Why the contract is ending. Examples: 'Project completed', 'Role no longer needed'."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional additional context for your records."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"term_new","status":"pending"}}
   */
  async terminateContract(contractId, effectiveDate, reason, notes) {
    const body = cleanupObject({
      completion_date: effectiveDate,
      termination_reason_description: reason,
      message: notes,
    });

    return this.#deelRequest({
      method: "post",
      path: `/contracts/${encodeURIComponent(contractId)}/terminations`,
      body,
      logTag: "terminateContract",
    });
  }

  /**
   * @operationName Amend Contract
   * @category Contracts
   * @description Creates a contract amendment (e.g., pay raise, role change, scope update). Worker may need to sign depending on the field changed.
   * @route POST /amendContract
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract to amend."}
   * @paramDef {"type":"Date","label":"Effective Date","name":"effectiveDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"When the amendment takes effect."}
   * @paramDef {"type":"String","label":"New Job Title","name":"jobTitle","required":false,"description":"Examples: 'Lead Engineer'. Leave blank if not changing."}
   * @paramDef {"type":"Number","label":"New Rate Amount","name":"rateAmount","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New pay rate. Leave blank if not changing."}
   * @paramDef {"type":"String","label":"New Currency","name":"currency","required":false,"dictionary":"getCurrenciesDictionary","description":"New pay currency. Leave blank if not changing."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Why this amendment is being made."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"amd_new","contract_id":"con_abc"}}
   */
  async amendContract(
    contractId,
    effectiveDate,
    jobTitle,
    rateAmount,
    currency,
    reason,
  ) {
    const body = cleanupObject({
      effective_date: effectiveDate,
      job_title_name: jobTitle,
      compensation_details:
        rateAmount || currency
          ? cleanupObject({ amount: rateAmount, currency_code: currency })
          : undefined,
      reason,
    });

    return this.#deelRequest({
      method: "post",
      path: `/contracts/${encodeURIComponent(contractId)}/amendments`,
      body,
      logTag: "amendContract",
    });
  }

  /**
   * @operationName List Amendments
   * @category Contracts
   * @description Returns all amendments for a contract.
   * @route POST /listAmendments
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract to list amendments for."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"amd_1","status":"pending","effective_date":"2026-06-01"}]}
   */
  async listAmendments(contractId) {
    return this.#deelRequest({
      method: "get",
      path: `/contracts/${encodeURIComponent(contractId)}/amendments`,
      logTag: "listAmendments",
    });
  }

  /**
   * @operationName List Milestones
   * @category Contracts
   * @description Returns all milestones for a milestone-based contract.
   * @route POST /listMilestones
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract to list milestones for."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"mil_1","title":"Design Phase","amount":2500,"status":"approved"}]}
   */
  async listMilestones(contractId) {
    return this.#deelRequest({
      method: "get",
      path: `/contracts/${encodeURIComponent(contractId)}/milestones`,
      logTag: "listMilestones",
    });
  }

  /**
   * @operationName Create Milestone
   * @category Contracts
   * @description Adds a new milestone to a milestone-based contract.
   * @route POST /createMilestone
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the milestone-based contract."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"What the milestone covers. Examples: 'Design Phase', 'Launch Week'."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Payment amount for this milestone."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What needs to be delivered for this milestone."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":false,"dictionary":"getCurrenciesDictionary","description":"Currency. Leave blank to use the contract's default."}
   * @paramDef {"type":"Date","label":"Due Date","name":"dueDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Expected completion date."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"mil_new","title":"Design Phase"}}
   */
  async createMilestone(
    contractId,
    title,
    amount,
    description,
    currency,
    dueDate,
  ) {
    const body = cleanupObject({
      title,
      amount,
      description,
      currency_code: currency,
      due_date: dueDate,
    });

    return this.#deelRequest({
      method: "post",
      path: `/contracts/${encodeURIComponent(contractId)}/milestones`,
      body,
      logTag: "createMilestone",
    });
  }

  /**
   * @operationName Delete Milestone
   * @category Contracts
   * @description Removes a milestone (only if it hasn't been approved yet).
   * @route POST /deleteMilestone
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract."}
   * @paramDef {"type":"String","label":"Milestone ID","name":"milestoneId","required":true,"description":"The milestone's ID."}
   * @returns {Object}
   * @sampleResult {"ok":true}
   */
  async deleteMilestone(contractId, milestoneId) {
    await this.#deelRequest({
      method: "delete",
      path: `/contracts/${encodeURIComponent(contractId)}/milestones/${encodeURIComponent(milestoneId)}`,
      logTag: "deleteMilestone",
    });

    return { ok: true };
  }

  /**
   * @operationName List Tasks
   * @category Contracts
   * @description Returns tasks (pay-as-you-go items) submitted on a contract.
   * @route POST /listTasks
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the pay-as-you-go contract."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"tsk_1","title":"Design review","amount":250,"status":"pending"}]}
   */
  async listTasks(contractId) {
    return this.#deelRequest({
      method: "get",
      path: `/contracts/${encodeURIComponent(contractId)}/tasks`,
      logTag: "listTasks",
    });
  }

  /**
   * @operationName Create Task
   * @category Contracts
   * @description Adds a billable task to a pay-as-you-go contract.
   * @route POST /createTask
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the pay-as-you-go contract."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"What was done. Examples: 'Design review for landing page'."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How much to bill."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Details about the work performed."}
   * @paramDef {"type":"Date","label":"Date Submitted","name":"submissionDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"When the work was done."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"tsk_new","title":"Design review"}}
   */
  async createTask(contractId, title, amount, description, submissionDate) {
    const body = cleanupObject({
      title,
      amount: String(amount),
      description,
      date_submitted: submissionDate,
    });

    return this.#deelRequest({
      method: "post",
      path: `/contracts/${encodeURIComponent(contractId)}/tasks`,
      body,
      logTag: "createTask",
    });
  }

  /**
   * @operationName Review Task
   * @category Contracts
   * @description Approves or rejects a contractor task before payment.
   * @route POST /reviewTask
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The task to review."}
   * @paramDef {"type":"String","label":"Decision","name":"decision","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Approve","Reject"]}},"description":"Approve to pay, Reject to send back to contractor."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Required when rejecting. Tell the contractor what to fix."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"tsk_abc","status":"approved"}}
   */
  async reviewTask(contractId, taskId, decision, reason) {
    const body = {
      status: decision === "Approve" ? "approved" : "rejected",
      reason,
    };

    return this.#deelRequest({
      method: "post",
      path: `/contracts/${encodeURIComponent(contractId)}/tasks/${encodeURIComponent(taskId)}/reviews`,
      body,
      logTag: "reviewTask",
    });
  }

  /**
   * @operationName List Timesheets
   * @category Contracts
   * @description Returns timesheet entries. Filter by contract or date range.
   * @route POST /listTimesheets
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":false,"dictionary":"getContractsDictionary","description":"Filter to one contract. Leave blank for all."}
   * @paramDef {"type":"Date","label":"From Date","name":"fromDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Earliest entry date. Leave blank for no lower bound."}
   * @paramDef {"type":"Date","label":"To Date","name":"toDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Latest entry date. Leave blank for no upper bound."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"ts_1","date_submitted":"2026-05-20","quantity":8}]}
   */
  async listTimesheets(contractId, fromDate, toDate) {
    const query = cleanupObject({ date_from: fromDate, date_to: toDate });
    const path = contractId
      ? `/contracts/${encodeURIComponent(contractId)}/timesheets`
      : "/timesheets";

    return this.#deelRequest({
      method: "get",
      path,
      query,
      logTag: "listTimesheets",
    });
  }

  /**
   * @operationName Create Timesheet Entry
   * @category Contracts
   * @description Logs an hourly/daily timesheet entry on a contract.
   * @route POST /createTimesheetEntry
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Hours or days worked. Examples: 8."}
   * @paramDef {"type":"Date","label":"Date","name":"date","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Which day the work was done."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What was done that day."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"ts_new","quantity":8}}
   */
  async createTimesheetEntry(contractId, quantity, date, description) {
    const body = cleanupObject({ quantity, date_submitted: date, description });

    return this.#deelRequest({
      method: "post",
      path: `/contracts/${encodeURIComponent(contractId)}/timesheets`,
      body,
      logTag: "createTimesheetEntry",
    });
  }

  /**
   * @operationName Update Timesheet Entry
   * @category Contracts
   * @description Updates the quantity, date, or description of a timesheet entry.
   * @route POST /updateTimesheetEntry
   * @paramDef {"type":"String","label":"Timesheet ID","name":"timesheetId","required":true,"description":"The timesheet entry ID to update."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New hours/days. Leave blank to keep unchanged."}
   * @paramDef {"type":"Date","label":"Date","name":"date","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"New date. Leave blank to keep unchanged."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description. Leave blank to keep unchanged."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"ts_abc","quantity":7}}
   */
  async updateTimesheetEntry(timesheetId, quantity, date, description) {
    const body = cleanupObject({ quantity, date_submitted: date, description });

    return this.#deelRequest({
      method: "patch",
      path: `/timesheets/${encodeURIComponent(timesheetId)}`,
      body,
      logTag: "updateTimesheetEntry",
    });
  }

  /**
   * @operationName Delete Timesheet Entry
   * @category Contracts
   * @description Removes a timesheet entry.
   * @route POST /deleteTimesheetEntry
   * @paramDef {"type":"String","label":"Timesheet ID","name":"timesheetId","required":true,"description":"The timesheet entry ID to remove."}
   * @returns {Object}
   * @sampleResult {"ok":true}
   */
  async deleteTimesheetEntry(timesheetId) {
    await this.#deelRequest({
      method: "delete",
      path: `/timesheets/${encodeURIComponent(timesheetId)}`,
      logTag: "deleteTimesheetEntry",
    });

    return { ok: true };
  }

  /**
   * @operationName Review Timesheet
   * @category Contracts
   * @description Approves or rejects a timesheet entry before payment.
   * @route POST /reviewTimesheet
   * @paramDef {"type":"String","label":"Timesheet ID","name":"timesheetId","required":true,"description":"The timesheet entry to review."}
   * @paramDef {"type":"String","label":"Decision","name":"decision","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Approve","Reject"]}},"description":"Approve to pay, Reject to send back."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Required when rejecting."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"ts_abc","status":"approved"}}
   */
  async reviewTimesheet(timesheetId, decision, reason) {
    const body = {
      status: decision === "Approve" ? "approved" : "rejected",
      reason,
    };

    return this.#deelRequest({
      method: "post",
      path: `/timesheets/${encodeURIComponent(timesheetId)}/reviews`,
      body,
      logTag: "reviewTimesheet",
    });
  }

  /**
   * @operationName List Invoice Adjustments
   * @category Contracts
   * @description Returns bonuses, deductions, and reimbursements queued for a contractor's next invoice.
   * @route POST /listInvoiceAdjustments
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":false,"dictionary":"getContractsDictionary","description":"Filter to one contract. Leave blank for all."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"adj_1","type":"bonus","amount":500}]}
   */
  async listInvoiceAdjustments(contractId) {
    const path = contractId
      ? `/contracts/${encodeURIComponent(contractId)}/invoice-adjustments`
      : "/invoice-adjustments";

    return this.#deelRequest({
      method: "get",
      path,
      logTag: "listInvoiceAdjustments",
    });
  }

  /**
   * @operationName Create Invoice Adjustment
   * @category Contracts
   * @description Adds a bonus, deduction, or reimbursement to a contractor's upcoming invoice.
   * @route POST /createInvoiceAdjustment
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Bonus","Commission","Deduction","Expense Reimbursement","Other"]}},"description":"Kind of adjustment."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How much. Use a positive number; deductions are subtracted automatically."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":false,"dictionary":"getCurrenciesDictionary","description":"Currency. Leave blank to use contract default."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"Why this adjustment exists. Examples: 'Q2 performance bonus'."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"adj_new","type":"bonus","amount":500}}
   */
  async createInvoiceAdjustment(
    contractId,
    type,
    amount,
    currency,
    description,
  ) {
    const typeMap = {
      Bonus: "bonus",
      Commission: "commission",
      Deduction: "deduction",
      "Expense Reimbursement": "expense",
      Other: "other",
    };

    const body = cleanupObject({
      type: typeMap[type] || "other",
      amount,
      currency_code: currency,
      description,
    });

    return this.#deelRequest({
      method: "post",
      path: `/contracts/${encodeURIComponent(contractId)}/invoice-adjustments`,
      body,
      logTag: "createInvoiceAdjustment",
    });
  }

  /**
   * @operationName Delete Invoice Adjustment
   * @category Contracts
   * @description Removes a pending invoice adjustment before it's billed.
   * @route POST /deleteInvoiceAdjustment
   * @paramDef {"type":"String","label":"Adjustment ID","name":"adjustmentId","required":true,"description":"The adjustment to delete."}
   * @returns {Object}
   * @sampleResult {"ok":true}
   */
  async deleteInvoiceAdjustment(adjustmentId) {
    await this.#deelRequest({
      method: "delete",
      path: `/invoice-adjustments/${encodeURIComponent(adjustmentId)}`,
      logTag: "deleteInvoiceAdjustment",
    });

    return { ok: true };
  }

  /**
   * @operationName Review Invoice Adjustment
   * @category Contracts
   * @description Approves or rejects a pending invoice adjustment.
   * @route POST /reviewInvoiceAdjustment
   * @paramDef {"type":"String","label":"Adjustment ID","name":"adjustmentId","required":true,"description":"The adjustment to review."}
   * @paramDef {"type":"String","label":"Decision","name":"decision","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Approve","Reject"]}},"description":"Approve to include on next invoice, Reject to drop."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Required when rejecting."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"adj_abc","status":"approved"}}
   */
  async reviewInvoiceAdjustment(adjustmentId, decision, reason) {
    const body = {
      status: decision === "Approve" ? "approved" : "rejected",
      reason,
    };

    return this.#deelRequest({
      method: "post",
      path: `/invoice-adjustments/${encodeURIComponent(adjustmentId)}/reviews`,
      body,
      logTag: "reviewInvoiceAdjustment",
    });
  }

  /**
   * @operationName List Off-Cycle Payments
   * @category Contracts
   * @description Returns one-off payments made to a contractor outside their normal schedule.
   * @route POST /listOffCyclePayments
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"ocp_1","amount":1000,"description":"Project bonus"}]}
   */
  async listOffCyclePayments(contractId) {
    return this.#deelRequest({
      method: "get",
      path: `/contracts/${encodeURIComponent(contractId)}/off-cycle-payments`,
      logTag: "listOffCyclePayments",
    });
  }

  /**
   * @operationName Create Off-Cycle Payment
   * @category Contracts
   * @description Sends a one-off payment to a contractor outside their normal pay schedule.
   * @route POST /createOffCyclePayment
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How much to pay."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"dictionary":"getCurrenciesDictionary","description":"Pay currency."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"What this payment covers. Examples: 'Project completion bonus'."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"ocp_new","amount":1000}}
   */
  async createOffCyclePayment(contractId, amount, currency, description) {
    const body = { amount, currency_code: currency, description };

    return this.#deelRequest({
      method: "post",
      path: `/contracts/${encodeURIComponent(contractId)}/off-cycle-payments`,
      body,
      logTag: "createOffCyclePayment",
    });
  }

  // =================== 8. EOR actions ===================

  /**
   * @operationName Calculate Employee Cost
   * @category EOR
   * @description Estimates the total cost (salary + employer taxes + Deel fees + benefits) of hiring an employee through Deel EOR in a given country.
   * @route POST /calculateEmployeeCost
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"dictionary":"getCountriesDictionary","description":"Country where the employee would work."}
   * @paramDef {"type":"Number","label":"Gross Salary","name":"salary","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Annual gross salary. Examples: 75000."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"dictionary":"getCurrenciesDictionary","description":"Salary currency. Examples: USD, EUR."}
   * @returns {Object}
   * @sampleResult {"data":{"gross_salary":75000,"employer_costs":18000,"deel_fee":600,"total_cost":93600}}
   */
  async calculateEmployeeCost(country, salary, currency) {
    // Deel requires both `country` (full name) and `country_code`. Look up the name
    // from our country dictionary so callers can just pass a country code.
    let countryName = country;

    try {
      const { items } = await this.getCountriesDictionary({ search: country });
      const match = items.find((i) => i.value === country) || items[0];
      if (match) countryName = match.label;
    } catch (error) {
      logger.warn(`country name lookup failed (using code): ${error.message}`);
    }

    const body = {
      country: countryName,
      country_code: country,
      salary,
      currency,
    };

    return this.#deelRequest({
      method: "post",
      path: "/eor/employment_cost",
      body,
      logTag: "calculateEmployeeCost",
    });
  }

  /**
   * @operationName Get Hiring Guide
   * @category EOR
   * @description Returns Deel's detailed hiring guide for a country — including required benefits, notice periods, leave, and typical compensation.
   * @route POST /getHiringGuide
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"dictionary":"getCountriesDictionary","description":"Country to fetch the hiring guide for."}
   * @returns {Object}
   * @sampleResult {"data":{"country":"DE","minimum_wage":2080,"working_hours":40,"notice_period":"4 weeks"}}
   */
  async getHiringGuide(country) {
    return this.#deelRequest({
      method: "get",
      path: `/eor/validations/${encodeURIComponent(country)}`,
      logTag: "getHiringGuide",
    });
  }

  /**
   * @operationName Get EOR Start Date
   * @category EOR
   * @description Returns the earliest possible start date for a new EOR employee in a country — accounting for visa, background check, and onboarding lead times.
   * @route POST /getEORStartDate
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"dictionary":"getCountriesDictionary","description":"Country where the employee will work."}
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"description":"The Deel team ID this hire belongs to. Required by Deel for start-date calculation."}
   * @paramDef {"type":"String","label":"Nationality","name":"nationality","required":false,"dictionary":"getCountriesDictionary","description":"Employee's nationality. Affects visa timelines."}
   * @paramDef {"type":"Boolean","label":"Needs Work Visa","name":"workVisa","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Whether a work visa will be needed."}
   * @returns {Object}
   * @sampleResult {"data":{"earliest_start_date":"2026-07-15"}}
   */
  async getEORStartDate(country, teamId, nationality, workVisa) {
    const query = cleanupObject({
      employment_country: country,
      team_id: teamId,
      employee_nationality: nationality,
      work_visa: workVisa,
    });

    return this.#deelRequest({
      method: "get",
      path: "/eor/start-date",
      query,
      logTag: "getEORStartDate",
    });
  }

  /**
   * @operationName List EOR Benefits
   * @category EOR
   * @description Returns the benefits enrolled on an EOR contract (health, retirement, etc.).
   * @route POST /listEORBenefits
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the EOR contract."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"ben_1","name":"Premium Health","monthly_cost":250}]}
   */
  async listEORBenefits(contractId) {
    return this.#deelRequest({
      method: "get",
      path: `/eor/${encodeURIComponent(contractId)}/benefits`,
      logTag: "listEORBenefits",
    });
  }

  /**
   * @operationName List Job Scope Templates
   * @category EOR
   * @description Returns Deel's predefined and custom job-scope templates for EOR contracts.
   * @route POST /listJobScopeTemplates
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":false,"description":"Filter to one team's custom templates. Leave blank for all."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"jst_1","title":"Software Engineer","scope":"..."}]}
   */
  async listJobScopeTemplates(teamId) {
    const query = cleanupObject({ team: teamId });

    return this.#deelRequest({
      method: "get",
      path: "/eor/job-scopes",
      query,
      logTag: "listJobScopeTemplates",
    });
  }

  /**
   * @operationName Validate Job Scope
   * @category EOR
   * @description Checks whether a draft job scope meets Deel's compliance standards for a country before creating the contract.
   * @route POST /validateJobScope
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"dictionary":"getCountriesDictionary","description":"Country where the role is based."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","required":true,"description":"Job title to validate."}
   * @paramDef {"type":"String","label":"Scope of Work","name":"scope","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of duties and responsibilities."}
   * @returns {Object}
   * @sampleResult {"data":{"valid":true,"suggestions":[]}}
   */
  async validateJobScope(country, jobTitle, scope) {
    const body = { country, job_title: jobTitle, scope_of_work: scope };

    return this.#deelRequest({
      method: "post",
      path: "/eor/job-scopes/validate",
      body,
      logTag: "validateJobScope",
    });
  }

  /**
   * @operationName Create EOR Contract
   * @category EOR
   * @description Creates a new EOR (Employer of Record) employment contract. Deel hires the worker on your behalf in the destination country.
   * @route POST /createEORContract
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"Employee's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"Employee's last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Employee's work email. Deel will send the onboarding invitation here."}
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"dictionary":"getCountriesDictionary","description":"Country where the employee will work."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","required":true,"description":"Examples: 'Senior Software Engineer'."}
   * @paramDef {"type":"Number","label":"Annual Salary","name":"annualSalary","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Gross annual salary."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"dictionary":"getCurrenciesDictionary","description":"Salary currency."}
   * @paramDef {"type":"Date","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"First day of employment."}
   * @paramDef {"type":"String","label":"Scope of Work","name":"scope","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the role's duties."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"eor_new","status":"pending_quote"}}
   */
  async createEORContract(
    firstName,
    lastName,
    email,
    country,
    jobTitle,
    annualSalary,
    currency,
    startDate,
    scope,
  ) {
    const body = cleanupObject({
      employee: { first_name: firstName, last_name: lastName, email },
      country_code: country,
      job_title: jobTitle,
      annual_salary: annualSalary,
      salary_currency: currency,
      start_date: startDate,
      scope_of_work: scope,
    });

    return this.#deelRequest({
      method: "post",
      path: "/eor",
      body,
      logTag: "createEORContract",
    });
  }

  /**
   * @operationName Accept EOR Quote
   * @category EOR
   * @description Accepts the cost quote for an EOR contract, moving it to the signing phase.
   * @route POST /acceptEORQuote
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the EOR contract whose quote you want to accept."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"eor_abc","status":"awaiting_signature"}}
   */
  async acceptEORQuote(contractId) {
    return this.#deelRequest({
      method: "post",
      path: `/eor/${encodeURIComponent(contractId)}/accept-quote`,
      logTag: "acceptEORQuote",
    });
  }

  /**
   * @operationName Sign EOR Contract
   * @category EOR
   * @description Signs the EOR employment contract as the client. After signing, Deel begins onboarding the employee.
   * @route POST /signEORContract
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the EOR contract to sign."}
   * @paramDef {"type":"String","label":"Signature","name":"signature","required":true,"description":"Typed signature. Examples: 'Jane Doe, CEO'."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"eor_abc","status":"signed"}}
   */
  async signEORContract(contractId, signature) {
    return this.#deelRequest({
      method: "post",
      path: `/eor/${encodeURIComponent(contractId)}/signatures`,
      body: { signature },
      logTag: "signEORContract",
    });
  }

  /**
   * @operationName Cancel EOR Contract
   * @category EOR
   * @description Cancels an EOR contract that hasn't started yet (e.g., before the employee starts).
   * @route POST /cancelEORContract
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the EOR contract to cancel."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Why you're cancelling. Required for compliance records."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"eor_abc","status":"cancelled"}}
   */
  async cancelEORContract(contractId, reason) {
    return this.#deelRequest({
      method: "post",
      path: `/eor/${encodeURIComponent(contractId)}/cancellations`,
      body: { reason },
      logTag: "cancelEORContract",
    });
  }

  /**
   * @operationName Delay EOR Onboarding
   * @category EOR
   * @description Pushes the EOR employee's start date later. Useful when the employee isn't ready to start as originally planned.
   * @route POST /delayEOROnboarding
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the EOR contract to delay."}
   * @paramDef {"type":"Date","label":"New Start Date","name":"newStartDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The new first day of work."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional reason for the change."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"eor_abc","start_date":"2026-08-01"}}
   */
  async delayEOROnboarding(contractId, newStartDate, reason) {
    const body = cleanupObject({ new_start_date: newStartDate, reason });

    return this.#deelRequest({
      method: "post",
      path: `/eor/${encodeURIComponent(contractId)}/onboarding-delays`,
      body,
      logTag: "delayEOROnboarding",
    });
  }

  /**
   * @operationName Fetch EOR Contract Document
   * @category EOR
   * @description Returns the EOR contract's signed PDF document as a download URL.
   * @route POST /fetchEORContractDocument
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the EOR contract."}
   * @returns {Object}
   * @sampleResult {"data":{"url":"https://deel.com/contracts/eor_abc/contract.pdf"}}
   */
  async fetchEORContractDocument(contractId) {
    return this.#deelRequest({
      method: "get",
      path: `/eor/${encodeURIComponent(contractId)}/document`,
      logTag: "fetchEORContractDocument",
    });
  }

  /**
   * @operationName Request EOR Termination
   * @category EOR
   * @description Initiates the offboarding process for an EOR employee. Deel handles the legal termination steps for the country.
   * @route POST /requestEORTermination
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the EOR contract."}
   * @paramDef {"type":"Date","label":"Termination Date","name":"terminationDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Employee's last day of work."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Resignation","Performance","Position eliminated","End of project","Restructuring","Other"]}},"description":"Reason for termination."}
   * @paramDef {"type":"String","label":"Additional Notes","name":"notes","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Context for the termination request."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"term_new","status":"requested"}}
   */
  async requestEORTermination(contractId, terminationDate, reason, notes) {
    const body = cleanupObject({
      termination_date: terminationDate,
      reason,
      additional_information: notes,
    });

    return this.#deelRequest({
      method: "post",
      path: `/eor/${encodeURIComponent(contractId)}/terminations`,
      body,
      logTag: "requestEORTermination",
    });
  }

  /**
   * @operationName Get Termination Details
   * @category EOR
   * @description Returns details of an in-progress EOR termination request.
   * @route POST /getTerminationDetails
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the EOR contract."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"term_abc","status":"in_progress","termination_date":"2026-07-31"}}
   */
  async getTerminationDetails(contractId) {
    return this.#deelRequest({
      method: "get",
      path: `/eor/${encodeURIComponent(contractId)}/terminations`,
      logTag: "getTerminationDetails",
    });
  }

  /**
   * @operationName List EOR Payslips
   * @category EOR
   * @description Returns the payslip records for an EOR employee.
   * @route POST /listEORPayslips
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the EOR contract."}
   * @paramDef {"type":"Date","label":"From","name":"fromDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Earliest payslip date. Leave blank for all."}
   * @paramDef {"type":"Date","label":"To","name":"toDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Latest payslip date. Leave blank for all."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"ps_1","period":"2026-04","net_pay":4200}]}
   */
  async listEORPayslips(contractId, fromDate, toDate) {
    const query = cleanupObject({ from: fromDate, to: toDate });

    return this.#deelRequest({
      method: "get",
      path: `/eor/${encodeURIComponent(contractId)}/payslips`,
      query,
      logTag: "listEORPayslips",
    });
  }

  /**
   * @operationName Download Payslip PDF
   * @category EOR
   * @description Returns a download URL for a single EOR payslip PDF.
   * @route POST /downloadPayslipPDF
   * @paramDef {"type":"String","label":"Payslip ID","name":"payslipId","required":true,"description":"The payslip ID returned by List EOR Payslips."}
   * @returns {Object}
   * @sampleResult {"data":{"url":"https://deel.com/payslips/ps_abc.pdf"}}
   */
  async downloadPayslipPDF(payslipId) {
    return this.#deelRequest({
      method: "get",
      path: `/payslips/${encodeURIComponent(payslipId)}/download`,
      logTag: "downloadPayslipPDF",
    });
  }

  /**
   * @operationName List Employee Compliance Documents
   * @category EOR
   * @description Returns the compliance documents (NDAs, IP assignments, country-required forms) requested from an EOR employee.
   * @route POST /listEmployeeComplianceDocs
   * @paramDef {"type":"String","label":"Worker","name":"workerId","required":true,"dictionary":"getPeopleDictionary","description":"Pick the worker."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"doc_1","name":"NDA","status":"signed"}]}
   */
  async listEmployeeComplianceDocs(workerId) {
    return this.#deelRequest({
      method: "get",
      path: `/people/${encodeURIComponent(workerId)}/compliance-documents`,
      logTag: "listEmployeeComplianceDocs",
    });
  }

  // =================== 9. Time Off actions ===================

  /**
   * @operationName List Time Off Requests
   * @category Time Off
   * @description Returns time-off requests across your org. Filter by person, status, or date range.
   * @route POST /listTimeOffRequests
   * @paramDef {"type":"String","label":"Person","name":"personId","required":false,"dictionary":"getPeopleDictionary","description":"Filter to one person. Leave blank for all."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Pending","Approved","Rejected","Cancelled"]}},"description":"Filter by status. Leave blank for all."}
   * @paramDef {"type":"Date","label":"From Date","name":"fromDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Earliest time-off start date."}
   * @paramDef {"type":"Date","label":"To Date","name":"toDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Latest time-off end date."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"to_1","type":"vacation","start_date":"2026-07-01","status":"approved"}]}
   */
  async listTimeOffRequests(personId, status, fromDate, toDate) {
    const query = cleanupObject({
      profile_id: personId,
      status: status ? status.toLowerCase() : undefined,
      from_date: fromDate,
      to_date: toDate,
    });

    return this.#deelRequest({
      method: "get",
      path: "/time_offs",
      query,
      logTag: "listTimeOffRequests",
    });
  }

  /**
   * @operationName Create Time Off Request
   * @category Time Off
   * @description Submits a new time-off request on behalf of a person.
   * @route POST /createTimeOffRequest
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"getPeopleDictionary","description":"Whose time off this is."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"dictionary":"getTimeOffTypesDictionary","description":"Kind of time off (Vacation, Sick, Personal, etc.)."}
   * @paramDef {"type":"Date","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"First day off."}
   * @paramDef {"type":"Date","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Last day off."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional note for the approver."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"to_new","status":"pending"}}
   */
  async createTimeOffRequest(personId, type, startDate, endDate, reason) {
    const body = cleanupObject({
      recipient_profile_id: personId,
      time_off_type: type,
      start_date: startDate,
      end_date: endDate,
      reason,
    });

    return this.#deelRequest({
      method: "post",
      path: "/time_offs",
      body,
      logTag: "createTimeOffRequest",
    });
  }

  /**
   * @operationName Update Time Off Request
   * @category Time Off
   * @description Edits a pending time-off request — change dates, type, or reason.
   * @route POST /updateTimeOffRequest
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","required":true,"description":"The time-off request to update."}
   * @paramDef {"type":"Date","label":"Start Date","name":"startDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"New first day off. Leave blank to keep unchanged."}
   * @paramDef {"type":"Date","label":"End Date","name":"endDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"New last day off. Leave blank to keep unchanged."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated reason. Leave blank to keep unchanged."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"to_abc","status":"pending"}}
   */
  async updateTimeOffRequest(requestId, startDate, endDate, reason) {
    const body = cleanupObject({
      start_date: startDate,
      end_date: endDate,
      reason,
    });

    return this.#deelRequest({
      method: "patch",
      path: `/time_offs/${encodeURIComponent(requestId)}`,
      body,
      logTag: "updateTimeOffRequest",
    });
  }

  /**
   * @operationName Cancel Time Off Request
   * @category Time Off
   * @description Cancels a pending or approved time-off request.
   * @route POST /cancelTimeOffRequest
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","required":true,"description":"The time-off request to cancel."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Why it's being cancelled."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"to_abc","status":"cancelled"}}
   */
  async cancelTimeOffRequest(requestId, reason) {
    return this.#deelRequest({
      method: "post",
      path: `/time_offs/${encodeURIComponent(requestId)}/cancel`,
      body: cleanupObject({ reason }),
      logTag: "cancelTimeOffRequest",
    });
  }

  /**
   * @operationName Review Time Off Request
   * @category Time Off
   * @description Approves or rejects a pending time-off request.
   * @route POST /reviewTimeOffRequest
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","required":true,"description":"The time-off request to review."}
   * @paramDef {"type":"String","label":"Decision","name":"decision","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Approve","Reject"]}},"description":"Approve to grant time off, Reject to deny."}
   * @paramDef {"type":"String","label":"Note","name":"note","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional note for the requester."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"to_abc","status":"approved"}}
   */
  async reviewTimeOffRequest(requestId, decision, note) {
    const action = decision === "Approve" ? "approve" : "reject";

    return this.#deelRequest({
      method: "post",
      path: `/time_offs/${encodeURIComponent(requestId)}/${action}`,
      body: cleanupObject({ note }),
      logTag: "reviewTimeOffRequest",
    });
  }

  /**
   * @operationName Validate Time Off Request
   * @category Time Off
   * @description Checks whether a time-off request would be valid (within policy, no conflicts, sufficient balance) WITHOUT actually submitting it.
   * @route POST /validateTimeOffRequest
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"getPeopleDictionary","description":"Person whose time off you're checking."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"dictionary":"getTimeOffTypesDictionary","description":"Kind of time off."}
   * @paramDef {"type":"Date","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"First day off."}
   * @paramDef {"type":"Date","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Last day off."}
   * @returns {Object}
   * @sampleResult {"data":{"valid":true,"days_used":5}}
   */
  async validateTimeOffRequest(personId, type, startDate, endDate) {
    const body = {
      profile_id: personId,
      time_off_type: type,
      start_date: startDate,
      end_date: endDate,
    };

    return this.#deelRequest({
      method: "post",
      path: "/time_offs/validate",
      body,
      logTag: "validateTimeOffRequest",
    });
  }

  /**
   * @operationName List Time Off Policies
   * @category Time Off
   * @description Returns the time-off policies assigned to a person (allowed types, accrual rules, balances).
   * @route POST /listTimeOffPolicies
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"getPeopleDictionary","description":"Pick the person whose policies you want to see."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"pol_1","name":"Standard Vacation","days_per_year":20}]}
   */
  async listTimeOffPolicies(personId) {
    return this.#deelRequest({
      method: "get",
      path: `/time_offs/profile/${encodeURIComponent(personId)}/policies`,
      logTag: "listTimeOffPolicies",
    });
  }

  /**
   * @operationName Get Entitlements
   * @category Time Off
   * @description Returns the time-off balances and entitlements for a person — how many days they've used and how many remain.
   * @route POST /getEntitlements
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"getPeopleDictionary","description":"Person to fetch entitlements for."}
   * @returns {Object}
   * @sampleResult {"data":[{"type":"vacation","total":20,"used":5,"remaining":15}]}
   */
  async getEntitlements(personId) {
    return this.#deelRequest({
      method: "get",
      path: "/time_offs/entitlements",
      query: { profile_id: personId },
      logTag: "getEntitlements",
    });
  }

  /**
   * @operationName Get Work Schedule and Holidays
   * @category Time Off
   * @description Returns the person's working hours, weekly schedule, and applicable public holidays for their country.
   * @route POST /getWorkScheduleAndHolidays
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"getPeopleDictionary","description":"Person to fetch schedule for."}
   * @returns {Object}
   * @sampleResult {"data":{"hours_per_week":40,"holidays":[{"date":"2026-12-25","name":"Christmas Day"}]}}
   */
  async getWorkScheduleAndHolidays(personId) {
    return this.#deelRequest({
      method: "get",
      path: `/hris/profiles/${encodeURIComponent(personId)}/work-schedule`,
      logTag: "getWorkScheduleAndHolidays",
    });
  }

  // =================== 10. Adjustments (org-side) ===================

  /**
   * @operationName List Adjustments
   * @category Adjustments
   * @description Returns adjustments (bonuses, deductions, reimbursements) applied to a contract's payroll.
   * @route POST /listAdjustments
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the contract."}
   * @paramDef {"type":"Date","label":"From","name":"fromDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Earliest adjustment date. Leave blank for all."}
   * @paramDef {"type":"Date","label":"To","name":"toDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Latest adjustment date. Leave blank for all."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"adj_1","category":"bonus","amount":1000}]}
   */
  async listAdjustments(contractId, fromDate, toDate) {
    const query = cleanupObject({ from_date: fromDate, to_date: toDate });

    return this.#deelRequest({
      method: "get",
      path: `/contracts/${encodeURIComponent(contractId)}/adjustments`,
      query,
      logTag: "listAdjustments",
    });
  }

  /**
   * @operationName Get Adjustment
   * @category Adjustments
   * @description Returns the full details of one adjustment.
   * @route POST /getAdjustment
   * @paramDef {"type":"String","label":"Adjustment ID","name":"adjustmentId","required":true,"description":"The adjustment to fetch."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"adj_abc","amount":1000,"category":"bonus"}}
   */
  async getAdjustment(adjustmentId) {
    return this.#deelRequest({
      method: "get",
      path: `/adjustments/${encodeURIComponent(adjustmentId)}`,
      logTag: "getAdjustment",
    });
  }

  /**
   * @operationName Create Adjustment
   * @category Adjustments
   * @description Adds a one-off bonus, deduction, or reimbursement to an employee's payroll.
   * @route POST /createAdjustment
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Which contract this adjustment applies to."}
   * @paramDef {"type":"String","label":"Category","name":"category","required":true,"dictionary":"getAdjustmentCategoriesDictionary","description":"Kind of adjustment (Bonus, Deduction, Reimbursement, etc.)."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How much. Use a positive number."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":false,"dictionary":"getCurrenciesDictionary","description":"Currency. Leave blank to use the contract's default."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"Why this adjustment exists. Examples: 'Q2 bonus'."}
   * @paramDef {"type":"Date","label":"Effective Date","name":"effectiveDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"When the adjustment applies. Leave blank for the next payroll cycle."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"adj_new","amount":1000}}
   */
  async createAdjustment(
    contractId,
    category,
    amount,
    currency,
    description,
    effectiveDate,
  ) {
    const body = cleanupObject({
      contract_id: contractId,
      category,
      amount,
      currency_code: currency,
      description,
      effective_date: effectiveDate,
    });

    return this.#deelRequest({
      method: "post",
      path: "/adjustments",
      body,
      logTag: "createAdjustment",
    });
  }

  /**
   * @operationName Update Adjustment
   * @category Adjustments
   * @description Edits a pending adjustment before it's applied to payroll.
   * @route POST /updateAdjustment
   * @paramDef {"type":"String","label":"Adjustment ID","name":"adjustmentId","required":true,"description":"The adjustment to update."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New amount. Leave blank to keep unchanged."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":false,"description":"New description."}
   * @paramDef {"type":"Date","label":"Effective Date","name":"effectiveDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"New effective date."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"adj_abc","amount":1500}}
   */
  async updateAdjustment(adjustmentId, amount, description, effectiveDate) {
    const body = cleanupObject({
      amount,
      description,
      effective_date: effectiveDate,
    });

    return this.#deelRequest({
      method: "patch",
      path: `/adjustments/${encodeURIComponent(adjustmentId)}`,
      body,
      logTag: "updateAdjustment",
    });
  }

  /**
   * @operationName Delete Adjustment
   * @category Adjustments
   * @description Removes a pending adjustment before it's applied.
   * @route POST /deleteAdjustment
   * @paramDef {"type":"String","label":"Adjustment ID","name":"adjustmentId","required":true,"description":"The adjustment to remove."}
   * @returns {Object}
   * @sampleResult {"ok":true}
   */
  async deleteAdjustment(adjustmentId) {
    await this.#deelRequest({
      method: "delete",
      path: `/adjustments/${encodeURIComponent(adjustmentId)}`,
      logTag: "deleteAdjustment",
    });

    return { ok: true };
  }

  // =================== 12. Global Payroll (GP) actions ===================

  /**
   * @operationName List GP Employees
   * @category Global Payroll
   * @description Returns the list of Global Payroll employees in your organization, optionally filtered by legal entity.
   * @route POST /listGPEmployees
   * @paramDef {"type":"String","label":"Legal Entity","name":"legalEntityId","required":false,"dictionary":"getLegalEntitiesDictionary","description":"Filter to one legal entity. Leave blank for all."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"gp_1","first_name":"Jane","last_name":"Doe","country":"DE"}]}
   */
  async listGPEmployees(legalEntityId) {
    const query = { "types[]": "global_payroll", limit: 100 };

    if (legalEntityId) query.legal_entity_id = legalEntityId;

    return this.#deelRequest({
      method: "get",
      path: "/contracts",
      query,
      logTag: "listGPEmployees",
    });
  }

  /**
   * @operationName Update GP Employee Information
   * @category Global Payroll
   * @description Updates the GP employee's profile data (name, contact info, identifiers).
   * @route POST /updateGPEmployeeInfo
   * @paramDef {"type":"String","label":"Worker","name":"workerId","required":true,"dictionary":"getPeopleDictionary","description":"Pick the GP worker to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":false,"description":"New first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":false,"description":"New last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":false,"description":"New work email."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","required":false,"description":"New phone number."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"gp_abc","email":"jane@acme.com"}}
   */
  async updateGPEmployeeInfo(workerId, firstName, lastName, email, phone) {
    const body = cleanupObject({
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
    });

    return this.#deelRequest({
      method: "patch",
      path: `/gp/workers/${encodeURIComponent(workerId)}`,
      body,
      logTag: "updateGPEmployeeInfo",
    });
  }

  /**
   * @operationName Update GP Compensation
   * @category Global Payroll
   * @description Updates the compensation (salary, bonus structure) for a Global Payroll employee.
   * @route POST /updateGPCompensation
   * @paramDef {"type":"String","label":"Worker","name":"workerId","required":true,"dictionary":"getPeopleDictionary","description":"Pick the GP worker."}
   * @paramDef {"type":"Number","label":"Annual Salary","name":"annualSalary","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New gross annual salary."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"dictionary":"getCurrenciesDictionary","description":"Salary currency."}
   * @paramDef {"type":"Date","label":"Effective Date","name":"effectiveDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"When the new compensation takes effect."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":false,"description":"Reason for the change. Examples: 'Annual raise'."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"gp_abc","annual_salary":85000}}
   */
  async updateGPCompensation(
    workerId,
    annualSalary,
    currency,
    effectiveDate,
    reason,
  ) {
    const body = cleanupObject({
      annual_salary: annualSalary,
      currency_code: currency,
      effective_date: effectiveDate,
      reason,
    });

    return this.#deelRequest({
      method: "patch",
      path: `/gp/workers/${encodeURIComponent(workerId)}/compensation`,
      body,
      logTag: "updateGPCompensation",
    });
  }

  /**
   * @operationName Update GP Address
   * @category Global Payroll
   * @description Updates the home address of a Global Payroll employee.
   * @route POST /updateGPAddress
   * @paramDef {"type":"String","label":"Worker","name":"workerId","required":true,"dictionary":"getPeopleDictionary","description":"Pick the GP worker."}
   * @paramDef {"type":"String","label":"Street","name":"street","required":true,"description":"Street and house number."}
   * @paramDef {"type":"String","label":"City","name":"city","required":true,"description":"City."}
   * @paramDef {"type":"String","label":"State / Region","name":"state","required":false,"description":"State or region (where applicable)."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","required":false,"description":"Postal or zip code."}
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"dictionary":"getCountriesDictionary","description":"Country."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"gp_abc","address_updated":true}}
   */
  async updateGPAddress(workerId, street, city, state, postalCode, country) {
    const body = cleanupObject({
      street,
      city,
      state,
      postal_code: postalCode,
      country,
    });

    return this.#deelRequest({
      method: "patch",
      path: `/gp/workers/${encodeURIComponent(workerId)}/address`,
      body,
      logTag: "updateGPAddress",
    });
  }

  /**
   * @operationName Request GP Termination
   * @category Global Payroll
   * @description Initiates the offboarding process for a Global Payroll employee.
   * @route POST /requestGPTermination
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Pick the GP contract."}
   * @paramDef {"type":"Date","label":"Termination Date","name":"terminationDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Employee's last day of work."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":true,"description":"Why the contract is ending."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"term_new","status":"requested"}}
   */
  async requestGPTermination(contractId, terminationDate, reason) {
    const body = { termination_date: terminationDate, reason };

    return this.#deelRequest({
      method: "post",
      path: `/gp/contracts/${encodeURIComponent(contractId)}/terminations`,
      body,
      logTag: "requestGPTermination",
    });
  }

  /**
   * @operationName List Payroll Cycles
   * @category Global Payroll
   * @description Returns the payroll cycles (monthly pay runs) for a legal entity.
   * @route POST /listPayrollCycles
   * @paramDef {"type":"String","label":"Legal Entity","name":"legalEntityId","required":true,"dictionary":"getLegalEntitiesDictionary","description":"Pick the legal entity."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"cyc_1","period":"2026-04","status":"closed"}]}
   */
  async listPayrollCycles(legalEntityId) {
    return this.#deelRequest({
      method: "get",
      path: `/gp/legal-entities/${encodeURIComponent(legalEntityId)}/cycles`,
      logTag: "listPayrollCycles",
    });
  }

  /**
   * @operationName Get Gross to Net Report
   * @category Global Payroll
   * @description Returns the gross-to-net breakdown for a payroll cycle (salary, taxes, deductions, net pay per employee).
   * @route POST /getGrossToNetReport
   * @paramDef {"type":"String","label":"Cycle ID","name":"cycleId","required":true,"description":"The payroll cycle ID."}
   * @returns {Object}
   * @sampleResult {"data":[{"worker_id":"gp_1","gross":5000,"tax":1200,"net":3800}]}
   */
  async getGrossToNetReport(cycleId) {
    return this.#deelRequest({
      method: "get",
      path: `/gp/reports/gross-to-net/${encodeURIComponent(cycleId)}`,
      logTag: "getGrossToNetReport",
    });
  }

  /**
   * @operationName List Shifts
   * @category Global Payroll
   * @description Returns time-tracking shifts for a contract or globally.
   * @route POST /listShifts
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":false,"dictionary":"getContractsDictionary","description":"Filter to one contract. Leave blank for all."}
   * @paramDef {"type":"Date","label":"From","name":"fromDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Earliest shift date."}
   * @paramDef {"type":"Date","label":"To","name":"toDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Latest shift date."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"sh_1","date":"2026-05-20","hours":8}]}
   */
  async listShifts(contractId, fromDate, toDate) {
    const query = cleanupObject({
      contract_id: contractId,
      from_date: fromDate,
      to_date: toDate,
    });

    return this.#deelRequest({
      method: "get",
      path: "/time_tracking/shifts",
      query,
      logTag: "listShifts",
    });
  }

  /**
   * @operationName Create Shifts
   * @category Global Payroll
   * @description Creates one or more time-tracking shifts in a single call. Provide a JSON array of shift objects.
   * @route POST /createShifts
   * @paramDef {"type":"String","label":"Contract","name":"contractId","required":true,"dictionary":"getContractsDictionary","description":"Which contract the shifts are for."}
   * @paramDef {"type":"Array<Object>","label":"Shifts","name":"shifts","required":true,"description":"List of shifts. Each shift needs date, start_time, end_time, and optionally break_minutes."}
   * @returns {Object}
   * @sampleResult {"data":{"created":3}}
   */
  async createShifts(contractId, shifts) {
    return this.#deelRequest({
      method: "post",
      path: "/time_tracking/shifts",
      body: { contract_id: contractId, shifts },
      logTag: "createShifts",
    });
  }

  /**
   * @operationName Delete Shift
   * @category Global Payroll
   * @description Removes a single time-tracking shift.
   * @route POST /deleteShift
   * @paramDef {"type":"String","label":"Shift ID","name":"shiftId","required":true,"description":"The shift to delete (Deel ID or external ID)."}
   * @paramDef {"type":"String","label":"By External ID","name":"externalId","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Toggle on if Shift ID above is YOUR external ID. Default is Deel's ID."}
   * @returns {Object}
   * @sampleResult {"ok":true}
   */
  async deleteShift(shiftId, externalId) {
    const path = externalId
      ? `/time_tracking/shifts/external_id/${encodeURIComponent(shiftId)}`
      : `/time_tracking/shifts/${encodeURIComponent(shiftId)}`;

    await this.#deelRequest({ method: "delete", path, logTag: "deleteShift" });

    return { ok: true };
  }

  /**
   * @operationName List GP Payslips
   * @category Global Payroll
   * @description Returns payslip records for a Global Payroll worker.
   * @route POST /listGPPayslips
   * @paramDef {"type":"String","label":"Worker","name":"workerId","required":false,"dictionary":"getPeopleDictionary","description":"Filter to one worker. Leave blank for all."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"ps_1","period":"2026-04","net_pay":3800}]}
   */
  async listGPPayslips(workerId) {
    if (!workerId)
      throw new Error(
        "Provide a Worker — Deel returns GP payslips per worker.",
      );

    return this.#deelRequest({
      method: "get",
      path: `/gp/workers/${encodeURIComponent(workerId)}/payslips`,
      logTag: "listGPPayslips",
    });
  }

  // =================== 13. ATS actions ===================

  /**
   * @operationName List Jobs
   * @category ATS
   * @description Returns the jobs (open positions) in your Deel Applicant Tracking System.
   * @route POST /listJobs
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed","Draft","On Hold"]}},"description":"Filter by job status."}
   * @paramDef {"type":"String","label":"Department","name":"department","required":false,"dictionary":"getDepartmentsDictionary","description":"Filter by department."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum to return."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"job_1","title":"Senior Engineer","status":"OPEN"}]}
   */
  async listJobs(status, department, limit) {
    const query = cleanupObject({
      status: status ? status.toUpperCase().replace(" ", "_") : undefined,
      department_id: department,
      limit: limit || 50,
    });

    return this.#deelRequest({
      method: "get",
      path: "/ats/jobs",
      query,
      logTag: "listJobs",
    });
  }

  /**
   * @operationName Get Job
   * @category ATS
   * @description Returns details of one job posting.
   * @route POST /getJob
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"getATSJobsDictionary","description":"Pick the job."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"job_abc","title":"Senior Engineer","status":"OPEN"}}
   */
  async getJob(jobId) {
    return this.#deelRequest({
      method: "get",
      path: `/ats/jobs/${encodeURIComponent(jobId)}`,
      logTag: "getJob",
    });
  }

  /**
   * @operationName Create Job
   * @category ATS
   * @description Creates a new job opening in your ATS.
   * @route POST /createJob
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Job title. Examples: 'Senior Software Engineer'."}
   * @paramDef {"type":"String","label":"Department","name":"department","required":false,"dictionary":"getDepartmentsDictionary","description":"Which department this role reports to."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Full job description for postings."}
   * @paramDef {"type":"String","label":"Country","name":"country","required":false,"dictionary":"getCountriesDictionary","description":"Country where the role is based (or remote)."}
   * @paramDef {"type":"String","label":"Employment Type","name":"employmentType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Full-time","Part-time","Contract","Internship"]}},"description":"Type of employment."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"job_new","title":"Senior Engineer"}}
   */
  async createJob(title, department, description, country, employmentType) {
    const body = cleanupObject({
      title,
      department_id: department,
      description,
      country,
      employment_type: employmentType
        ? employmentType.toUpperCase().replace("-", "_")
        : undefined,
    });

    return this.#deelRequest({
      method: "post",
      path: "/ats/jobs",
      body,
      logTag: "createJob",
    });
  }

  /**
   * @operationName List Candidates
   * @category ATS
   * @description Returns candidates in your ATS. Filter by stage, job, or search by name/email.
   * @route POST /listCandidates
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":false,"dictionary":"getATSJobsDictionary","description":"Filter to candidates applied to one job."}
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Search by candidate name or email."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum to return."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"cand_1","name":"Jane Doe","email":"jane@candidate.com"}]}
   */
  async listCandidates(jobId, search, limit) {
    const query = cleanupObject({ job_id: jobId, search, limit: limit || 50 });

    return this.#deelRequest({
      method: "get",
      path: "/ats/candidates",
      query,
      logTag: "listCandidates",
    });
  }

  /**
   * @operationName Create Candidate
   * @category ATS
   * @description Adds a new candidate to your ATS database.
   * @route POST /createCandidate
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"Candidate's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"Candidate's last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Candidate's email. Examples: 'jane@candidate.com'."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","required":false,"description":"Phone with country code. Examples: '+1 555 123 4567'."}
   * @paramDef {"type":"String","label":"LinkedIn URL","name":"linkedinUrl","required":false,"description":"Candidate's LinkedIn profile."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"cand_new","name":"Jane Doe"}}
   */
  async createCandidate(firstName, lastName, email, phone, linkedinUrl) {
    const body = cleanupObject({
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      linkedin_url: linkedinUrl,
    });

    return this.#deelRequest({
      method: "post",
      path: "/ats/candidates",
      body,
      logTag: "createCandidate",
    });
  }

  /**
   * @operationName Add Candidate Tags
   * @category ATS
   * @description Adds one or more tags to a candidate for filtering and organization.
   * @route POST /addCandidateTags
   * @paramDef {"type":"String","label":"Candidate ID","name":"candidateId","required":true,"description":"The candidate to tag."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","required":true,"description":"List of tag names. Examples: ['Top Pick', 'Referral']."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"cand_abc","tags":["Top Pick","Referral"]}}
   */
  async addCandidateTags(candidateId, tags) {
    return this.#deelRequest({
      method: "post",
      path: `/ats/candidates/${encodeURIComponent(candidateId)}/tags`,
      body: { tags },
      logTag: "addCandidateTags",
    });
  }

  /**
   * @operationName List Applications
   * @category ATS
   * @description Returns applications (candidate-to-job submissions). Filter by job, candidate, or stage.
   * @route POST /listApplications
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":false,"dictionary":"getATSJobsDictionary","description":"Filter to one job."}
   * @paramDef {"type":"String","label":"Candidate ID","name":"candidateId","required":false,"description":"Filter to one candidate."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"app_1","candidate_id":"cand_1","job_id":"job_1","stage":"Phone Screen"}]}
   */
  async listApplications(jobId, candidateId) {
    const query = cleanupObject({ job_id: jobId, candidate_id: candidateId });

    return this.#deelRequest({
      method: "get",
      path: "/ats/applications",
      query,
      logTag: "listApplications",
    });
  }

  /**
   * @operationName Get Application
   * @category ATS
   * @description Returns the full details of one application, including stage history and notes.
   * @route POST /getApplication
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"description":"The application to fetch."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"app_abc","candidate_id":"cand_abc","stage":"Offer"}}
   */
  async getApplication(applicationId) {
    return this.#deelRequest({
      method: "get",
      path: `/ats/applications/${encodeURIComponent(applicationId)}`,
      logTag: "getApplication",
    });
  }

  /**
   * @operationName Create Application
   * @category ATS
   * @description Submits a candidate to a job, creating a new application.
   * @route POST /createApplication
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"getATSJobsDictionary","description":"Job to apply to."}
   * @paramDef {"type":"String","label":"Candidate ID","name":"candidateId","required":true,"description":"The candidate to apply."}
   * @paramDef {"type":"String","label":"Source","name":"source","required":false,"description":"How they found the role. Examples: 'LinkedIn', 'Referral', 'Company website'."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"app_new","job_id":"job_1","candidate_id":"cand_1"}}
   */
  async createApplication(jobId, candidateId, source) {
    const body = cleanupObject({
      job_id: jobId,
      candidate_id: candidateId,
      source,
    });

    return this.#deelRequest({
      method: "post",
      path: "/ats/applications",
      body,
      logTag: "createApplication",
    });
  }

  /**
   * @operationName Add Application Note
   * @category ATS
   * @description Adds a private note (interview feedback, comment) to an application.
   * @route POST /addApplicationNote
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"description":"The application to note."}
   * @paramDef {"type":"String","label":"Note","name":"note","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The note text. Examples: 'Strong technical skills, good culture fit.'"}
   * @returns {Object}
   * @sampleResult {"data":{"id":"note_new"}}
   */
  async addApplicationNote(applicationId, note) {
    return this.#deelRequest({
      method: "post",
      path: `/ats/applications/${encodeURIComponent(applicationId)}/notes`,
      body: { note },
      logTag: "addApplicationNote",
    });
  }

  /**
   * @operationName Move Application to Stage
   * @category ATS
   * @description Moves an application to a new interview stage (e.g., Phone Screen → Onsite → Offer).
   * @route POST /moveApplicationToStage
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"description":"The application to move."}
   * @paramDef {"type":"String","label":"Stage ID","name":"stageId","required":true,"description":"The interview plan stage to move to."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"app_abc","current_stage":"Onsite"}}
   */
  async moveApplicationToStage(applicationId, stageId) {
    return this.#deelRequest({
      method: "post",
      path: `/ats/applications/${encodeURIComponent(applicationId)}/interview-plan-stages`,
      body: { stage_id: stageId },
      logTag: "moveApplicationToStage",
    });
  }

  /**
   * @operationName List Offers
   * @category ATS
   * @description Returns job offers extended to candidates.
   * @route POST /listOffers
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":false,"dictionary":"getATSJobsDictionary","description":"Filter to one job. Leave blank for all."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"offer_1","candidate":"Jane Doe","status":"sent"}]}
   */
  async listOffers(jobId) {
    const query = cleanupObject({ job_id: jobId });

    return this.#deelRequest({
      method: "get",
      path: "/ats/offers",
      query,
      logTag: "listOffers",
    });
  }

  // =================== 14. Niche modules ===================

  /**
   * @operationName Check Visa Requirements
   * @category Immigration
   * @description Returns whether a business traveler needs a visa to enter a destination country, and any business-visa options available.
   * @route POST /checkVisaRequirements
   * @paramDef {"type":"String","label":"Nationality","name":"nationality","required":true,"dictionary":"getCountriesDictionary","description":"Worker's nationality (citizenship country)."}
   * @paramDef {"type":"String","label":"Residence Country","name":"residenceCountry","required":true,"dictionary":"getCountriesDictionary","description":"Country where the worker currently lives."}
   * @paramDef {"type":"String","label":"Destination Country","name":"destinationCountry","required":true,"dictionary":"getCountriesDictionary","description":"Country they want to enter."}
   * @paramDef {"type":"Date","label":"Trip Start","name":"tripStartDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Planned arrival date."}
   * @paramDef {"type":"Date","label":"Trip End","name":"tripEndDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Planned departure date."}
   * @paramDef {"type":"String","label":"Trip Reason","name":"tripReason","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Internal business (with client work)","Internal business (no client work)","Meetings with or for a client"]}},"description":"Purpose of the visit."}
   * @returns {Object}
   * @sampleResult {"data":{"requires_visa":true,"available_visa_types":["Business Visa"]}}
   */
  async checkVisaRequirements(
    nationality,
    residenceCountry,
    destinationCountry,
    tripStartDate,
    tripEndDate,
    tripReason,
  ) {
    const reasonMap = {
      "Internal business (with client work)":
        "INTERNAL_BUSINESS_WITH_WORK_FOR_CLIENT",
      "Internal business (no client work)":
        "INTERNAL_BUSINESS_WITHOUT_WORK_FOR_CLIENT",
      "Meetings with or for a client": "MEETINGS_WITH_OR_FOR_A_CLIENT",
    };
    const query = {
      nationality,
      residence_country: residenceCountry,
      destination_country: destinationCountry,
      trip_start_date: tripStartDate,
      trip_end_date: tripEndDate,
      trip_reason: reasonMap[tripReason] || tripReason,
    };

    return this.#deelRequest({
      method: "get",
      path: "/immigration/visa-requirement/business",
      query,
      logTag: "checkVisaRequirements",
    });
  }

  /**
   * @operationName Get Visa Types
   * @category Immigration
   * @description Returns the visa types supported for working in a country.
   * @route POST /getVisaTypes
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"dictionary":"getCountriesDictionary","description":"Country to fetch visa types for."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"visa_1","name":"EU Blue Card","duration":"4 years"}]}
   */
  async getVisaTypes(country) {
    return this.#deelRequest({
      method: "get",
      path: `/immigration/visa-types/${encodeURIComponent(country)}`,
      logTag: "getVisaTypes",
    });
  }

  /**
   * @operationName List Immigration Cases
   * @category Immigration
   * @description Returns the immigration cases (visa applications, right-to-work checks) tracked by Deel.
   * @route POST /listImmigrationCases
   * @paramDef {"type":"String","label":"Worker","name":"workerId","required":false,"dictionary":"getPeopleDictionary","description":"Filter to one worker. Leave blank for all."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"imm_1","worker_id":"per_abc","status":"in_progress","case_type":"work_visa"}]}
   */
  async listImmigrationCases(workerId) {
    const query = cleanupObject({ worker_id: workerId });

    return this.#deelRequest({
      method: "get",
      path: "/immigration/client/cases",
      query,
      logTag: "listImmigrationCases",
    });
  }

  /**
   * @operationName Get Immigration Case
   * @category Immigration
   * @description Returns the full details of one immigration case, including required documents and status.
   * @route POST /getImmigrationCase
   * @paramDef {"type":"String","label":"Case ID","name":"caseId","required":true,"description":"The immigration case ID."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"imm_abc","status":"awaiting_documents"}}
   */
  async getImmigrationCase(caseId) {
    return this.#deelRequest({
      method: "get",
      path: `/immigration/client/cases/${encodeURIComponent(caseId)}`,
      logTag: "getImmigrationCase",
    });
  }

  /**
   * @operationName Get Worker KYC
   * @category Screenings
   * @description Returns Know-Your-Customer (identity verification) details for a worker.
   * @route POST /getWorkerKYC
   * @paramDef {"type":"String","label":"Worker","name":"workerId","required":true,"dictionary":"getPeopleDictionary","description":"Pick the worker."}
   * @returns {Object}
   * @sampleResult {"data":{"worker_id":"per_abc","kyc_status":"verified","verified_at":"2026-03-15"}}
   */
  async getWorkerKYC(workerId) {
    return this.#deelRequest({
      method: "get",
      path: `/screenings/kyc/${encodeURIComponent(workerId)}`,
      logTag: "getWorkerKYC",
    });
  }

  /**
   * @operationName Create Veriff Session
   * @category Screenings
   * @description Starts a Veriff video-based identity verification session for a worker. Returns a URL to send to the worker.
   * @route POST /createVeriffSession
   * @paramDef {"type":"String","label":"Worker","name":"workerId","required":true,"dictionary":"getPeopleDictionary","description":"Pick the worker to verify."}
   * @returns {Object}
   * @sampleResult {"data":{"session_id":"vrf_abc","verification_url":"https://veriff.com/v/abc"}}
   */
  async createVeriffSession(workerId) {
    return this.#deelRequest({
      method: "post",
      path: "/veriff/sessions",
      body: { worker_id: workerId },
      logTag: "createVeriffSession",
    });
  }

  /**
   * @operationName List IT Orders
   * @category IT
   * @description Returns the IT equipment orders (laptops, monitors, etc.) provisioned through Deel.
   * @route POST /listITOrders
   * @paramDef {"type":"String","label":"Worker","name":"workerId","required":false,"dictionary":"getPeopleDictionary","description":"Filter to one worker. Leave blank for all."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"ord_1","item":"MacBook Pro","status":"delivered"}]}
   */
  async listITOrders(workerId) {
    const query = cleanupObject({ worker_id: workerId });

    return this.#deelRequest({
      method: "get",
      path: "/it/orders",
      query,
      logTag: "listITOrders",
    });
  }

  /**
   * @operationName List IT Assets
   * @category IT
   * @description Returns IT assets (devices) currently issued to your workers.
   * @route POST /listITAssets
   * @paramDef {"type":"String","label":"Worker","name":"workerId","required":false,"dictionary":"getPeopleDictionary","description":"Filter to one worker. Leave blank for all."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"ast_1","item":"MacBook Pro","worker_id":"per_abc"}]}
   */
  async listITAssets(workerId) {
    const query = cleanupObject({ worker_id: workerId });

    return this.#deelRequest({
      method: "get",
      path: "/it/assets",
      query,
      logTag: "listITAssets",
    });
  }

  /**
   * @operationName List IT Hardware Policies
   * @category IT
   * @description Returns the IT hardware policies (allowed device types, budgets) for your organization.
   * @route POST /listITHardwarePolicies
   * @returns {Object}
   * @sampleResult {"data":[{"id":"pol_1","name":"Engineering MacBook","budget":2500}]}
   */
  async listITHardwarePolicies() {
    return this.#deelRequest({
      method: "get",
      path: "/it/policies",
      logTag: "listITHardwarePolicies",
    });
  }

  /**
   * @operationName Get Country Hiring Guide
   * @category Knowledge Hub
   * @description Returns Deel's Knowledge Hub country guide — covering taxes, benefits, mandatory leave, and compliance basics.
   * @route POST /getCountryHiringGuide
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"dictionary":"getCountriesDictionary","description":"Country to fetch the guide for."}
   * @returns {Object}
   * @sampleResult {"data":{"country":"DE","summary":"...","tax_rates":[]}}
   */
  async getCountryHiringGuide(country) {
    return this.#deelRequest({
      method: "get",
      path: `/knowledge-hub/country-guide/${encodeURIComponent(country)}`,
      logTag: "getCountryHiringGuide",
    });
  }

  /**
   * @operationName Create Magic Link
   * @category Access
   * @description Generates a single-use login link a manager can use to access Deel without a password.
   * @route POST /createMagicLink
   * @paramDef {"type":"String","label":"Manager Email","name":"managerEmail","required":true,"description":"Email of the manager who should receive access."}
   * @returns {Object}
   * @sampleResult {"data":{"magic_link":"https://app.deel.com/magic/abc"}}
   */
  async createMagicLink(managerEmail) {
    return this.#deelRequest({
      method: "post",
      path: "/magic-link",
      body: { email: managerEmail },
      logTag: "createMagicLink",
    });
  }

  // =================== 15. Invoices & misc actions ===================

  /**
   * @operationName List Invoices
   * @category Invoices
   * @description Returns the invoices (paid and unpaid) for your Deel account.
   * @route POST /listInvoices
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Pending","Paid","Overdue","Cancelled"]}},"description":"Filter by invoice status."}
   * @paramDef {"type":"Date","label":"From","name":"fromDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Earliest invoice date."}
   * @paramDef {"type":"Date","label":"To","name":"toDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Latest invoice date."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"inv_1","total":4500,"status":"paid"}]}
   */
  async listInvoices(status, fromDate, toDate) {
    const query = cleanupObject({
      status: status ? status.toLowerCase() : undefined,
      from_date: fromDate,
      to_date: toDate,
    });

    return this.#deelRequest({
      method: "get",
      path: "/invoices",
      query,
      logTag: "listInvoices",
    });
  }

  /**
   * @operationName Get Invoice
   * @category Invoices
   * @description Returns the full details of one invoice.
   * @route POST /getInvoice
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The invoice to fetch."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"inv_abc","total":4500,"status":"paid"}}
   */
  async getInvoice(invoiceId) {
    return this.#deelRequest({
      method: "get",
      path: `/invoices/${encodeURIComponent(invoiceId)}`,
      logTag: "getInvoice",
    });
  }

  /**
   * @operationName Download Invoice PDF
   * @category Invoices
   * @description Returns a download URL for the invoice PDF.
   * @route POST /downloadInvoicePDF
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The invoice to download."}
   * @returns {Object}
   * @sampleResult {"data":{"url":"https://deel.com/invoices/inv_abc.pdf"}}
   */
  async downloadInvoicePDF(invoiceId) {
    return this.#deelRequest({
      method: "get",
      path: `/invoices/${encodeURIComponent(invoiceId)}/download`,
      logTag: "downloadInvoicePDF",
    });
  }

  /**
   * @operationName List Refund Statements
   * @category Invoices
   * @description Returns refund statements for invoices that have been credited back.
   * @route POST /listRefundStatements
   * @returns {Object}
   * @sampleResult {"data":[{"id":"ref_1","amount":-500,"original_invoice":"inv_1"}]}
   */
  async listRefundStatements() {
    return this.#deelRequest({
      method: "get",
      path: "/refund-statements",
      logTag: "listRefundStatements",
    });
  }

  /**
   * @operationName List Managers
   * @category Organization
   * @description Returns the managers configured in your Deel organization.
   * @route POST /listManagers
   * @returns {Object}
   * @sampleResult {"data":[{"id":"mgr_1","name":"Sarah Wilson","email":"sarah@acme.com"}]}
   */
  async listManagers() {
    return this.#deelRequest({
      method: "get",
      path: "/managers",
      logTag: "listManagers",
    });
  }

  // =================== 16. Webhook trigger + system methods ===================

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(
      `handleTriggerUpsertWebhook.invocation: ${JSON.stringify(invocation)}`,
    );

    const callbackUrl = invocation?.callbackUrl;
    if (!callbackUrl)
      throw new Error("Webhook callback URL is missing from invocation.");

    // Subscribe to all events; we filter by user-selected eventType in handleTriggerSelectMatched
    const body = {
      url: callbackUrl,
      events: ["*"],
      enabled: true,
    };

    // If a webhook already exists for this org, update it instead of creating a duplicate
    if (invocation.webhookData?.id) {
      try {
        const updated = await this.#deelRequest({
          method: "patch",
          path: `/webhooks/${encodeURIComponent(invocation.webhookData.id)}`,
          body,
          logTag: "handleTriggerUpsertWebhook.patch",
        });

        return {
          webhookData: updated?.data || updated,
          eventScopeId:
            invocation.webhookData.eventScopeId || invocation.eventScopeId,
        };
      } catch (error) {
        logger.warn(
          `existing webhook patch failed, creating new: ${error.message}`,
        );
      }
    }

    const created = await this.#deelRequest({
      method: "post",
      path: "/webhooks",
      body,
      logTag: "handleTriggerUpsertWebhook.post",
    });
    const data = created?.data || created;

    let eventScopeId = invocation.eventScopeId;

    if (!eventScopeId) {
      try {
        const org = await this.getOrganization();

        eventScopeId = org?.id;
      } catch (error) {
        logger.warn(`unable to fetch org for eventScopeId: ${error.message}`);
      }
    }

    return { webhookData: data, eventScopeId };
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug(
      `handleTriggerResolveEvents.invocation: ${JSON.stringify(invocation)}`,
    );

    const body = invocation?.body;

    if (!body || !body.data) {
      logger.warn("Webhook delivery has no body.data — ignoring.");

      return null;
    }

    const headers = invocation?.headers || {};
    const signature =
      headers["x-deel-signature"] || headers["X-Deel-Signature"];
    const secret = invocation?.webhookData?.secret;

    if (secret && signature) {
      try {
        const crypto = require("crypto");
        const rawBody = invocation.rawBody || JSON.stringify(body);
        const expected = crypto
          .createHmac("sha256", secret)
          .update(rawBody)
          .digest("hex");

        const valid =
          signature.length === expected.length &&
          crypto.timingSafeEqual(
            Buffer.from(signature, "utf8"),
            Buffer.from(expected, "utf8"),
          );

        if (!valid) {
          logger.error("Webhook signature mismatch — refusing to process");
          throw new Error("Invalid Deel webhook signature");
        }
      } catch (error) {
        // crypto failure - log and re-throw to drop delivery (Deel will retry)
        logger.error(`Webhook signature verification failed: ${error.message}`);
        throw error;
      }
    }

    const meta = body.data.meta || {};
    const resource = Array.isArray(body.data.resource)
      ? body.data.resource[0]
      : body.data.resource;

    return {
      eventScopeId:
        meta.organization_id || invocation.webhookData?.eventScopeId,
      events: [
        {
          name: "onDeelEvent",
          data: {
            eventType: meta.event_type,
            eventId: meta.event_id,
            occurredAt: meta.occurred_at,
            organizationId: meta.organization_id,
            resource,
          },
        },
      ],
    };
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched: ${JSON.stringify(invocation)}`);

    const incomingType = invocation?.event?.data?.eventType;
    const triggers = invocation?.triggers || [];

    const ids = triggers
      .filter((trigger) => {
        const filterEventType =
          trigger?.data?.eventType || trigger?.params?.eventType;

        // If user didn't pick an eventType, match all
        if (!filterEventType) return true;

        return filterEventType === incomingType;
      })
      .map((trigger) => trigger.id);

    return { ids };
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug(`handleTriggerDeleteWebhook: ${JSON.stringify(invocation)}`);

    const id = invocation?.webhookData?.id;
    if (!id) return {};

    try {
      await this.#deelRequest({
        method: "delete",
        path: `/webhooks/${encodeURIComponent(id)}`,
        logTag: "handleTriggerDeleteWebhook",
      });
    } catch (error) {
      logger.warn(`Failed to delete webhook ${id}: ${error.message}`);
    }

    return {};
  }

  /**
   * @operationName On Deel Event
   * @category Triggers
   * @description Triggers whenever the selected Deel event happens (contract signed, payslip available, time off requested, etc.). Pick which event to listen for from the dropdown.
   * @registerAs REALTIME_TRIGGER
   * @route POST /onDeelEvent
   * @appearanceColor #15172A #6EE7B7
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","required":true,"dictionary":"getWebhookEventTypesDictionary","description":"Pick which Deel event triggers this flow. Examples: 'contract.signed', 'eor.payslips.available', 'timeoff.approved'."}
   * @returns {Object}
   * @sampleResult {"eventType":"contract.signed","eventId":"evt_abc","occurredAt":"2026-05-24T14:30:00Z","organizationId":"org_abc","resource":{"contract_id":"con_abc","worker_email":"jane@acme.com","status":"active"}}
   */
  onDeelEvent() {
    // The realtime trigger framework calls handleTriggerResolveEvents/SelectMatched —
    // this method exists only to register the trigger and provide its JSDoc metadata.
    return null;
  }
}

// =================== 17. Service registration ===================

Flowrunner.ServerCode.addService(DeelService, [
  {
    displayName: "Client ID",
    defaultValue: "",
    name: "clientId",
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: "OAuth2 Client ID from your Deel developer app. Find it under More → Developer → Apps in your Deel dashboard.",
  },
  {
    displayName: "Client Secret",
    defaultValue: "",
    name: "clientSecret",
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: "OAuth2 Client Secret from your Deel developer app. Shown only once at app creation — keep it safe.",
  },
  {
    displayName: "Environment",
    defaultValue: "Production",
    name: "environment",
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    required: true,
    shared: false,
    options: ["Production", "Sandbox"],
    hint: 'Pick "Sandbox" to point at Deel\'s demo environment for testing. Pick "Production" for live data.',
  },
]);
