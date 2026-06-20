"use strict";

const crypto = require("crypto");

/**
 * ============================================================================
 *  FreshBooks Service — FlowRunner extension
 * ============================================================================
 *  Section map:
 *    1. Constants (URLs, scopes, friendly enum maps)
 *    2. Helpers (logger, cleanup, money/date, errors)
 *    3. Class: private helpers (auth, dual-id routing, request)
 *    4. OAuth2 system methods
 *    5. Dictionaries (select-by-name pickers)
 *    6. Resources (added in later phases)
 *    7. Service registration + config items
 * ============================================================================
 */

// ============================== 1. CONSTANTS ===============================

const OAUTH_AUTH_URL = "https://auth.freshbooks.com/oauth/authorize/";
const TOKEN_URL = "https://api.freshbooks.com/auth/oauth/token";
const IDENTITY_URL = "https://api.freshbooks.com/auth/api/v1/users/me";
const API_BASE = "https://api.freshbooks.com";

// Scopes are immutable once a token is issued, so we request the full set up front.
const DEFAULT_SCOPE_LIST = [
  "user:profile:read",
  "user:business:read",
  "user:clients:read",
  "user:clients:write",
  "user:invoices:read",
  "user:invoices:write",
  "user:estimates:read",
  "user:estimates:write",
  "user:expenses:read",
  "user:expenses:write",
  "user:payments:read",
  "user:payments:write",
  "user:credit_notes:read",
  "user:credit_notes:write",
  "user:billable_items:read",
  "user:billable_items:write",
  "user:taxes:read",
  "user:taxes:write",
  "user:other_income:read",
  "user:other_income:write",
  "user:projects:read",
  "user:projects:write",
  "user:time_entries:read",
  "user:time_entries:write",
  "user:bills:read",
  "user:bills:write",
  "user:bill_vendors:read",
  "user:bill_vendors:write",
  "user:bill_payments:read",
  "user:bill_payments:write",
  "user:online_payments:read",
  "user:online_payments:write",
  "user:teams:read",
  "user:teams:write",
  "user:reports:read",
];

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(" ");

const DEFAULT_PER_PAGE = 100;

// Friendly currency list for the Currency picker (FreshBooks has no list endpoint for these).
const COMMON_CURRENCIES = [
  ["USD", "US Dollar"],
  ["EUR", "Euro"],
  ["GBP", "British Pound"],
  ["CAD", "Canadian Dollar"],
  ["AUD", "Australian Dollar"],
  ["NZD", "New Zealand Dollar"],
  ["JPY", "Japanese Yen"],
  ["CHF", "Swiss Franc"],
  ["INR", "Indian Rupee"],
  ["SGD", "Singapore Dollar"],
  ["HKD", "Hong Kong Dollar"],
  ["ZAR", "South African Rand"],
  ["MXN", "Mexican Peso"],
  ["BRL", "Brazilian Real"],
  ["SEK", "Swedish Krona"],
  ["NOK", "Norwegian Krone"],
  ["DKK", "Danish Krone"],
  ["PLN", "Polish Zloty"],
  ["AED", "UAE Dirham"],
];

// Friendly invoice status label -> FreshBooks v3_status value (used for filtering).
const INVOICE_STATUS_FILTER = {
  Draft: "draft",
  Sent: "sent",
  Viewed: "viewed",
  Paid: "paid",
  "Partially Paid": "partial",
  Overdue: "overdue",
  Disputed: "disputed",
};

// Friendly recurring-frequency label -> FreshBooks frequency code (<n><unit>).
const RECURRING_FREQUENCY = {
  Weekly: "w",
  "Every 2 Weeks": "2w",
  Monthly: "m",
  "Every 3 Months": "3m",
  "Every 6 Months": "6m",
  Yearly: "y",
};

// Friendly other-income category label -> FreshBooks category_name.
const OTHER_INCOME_CATEGORY = {
  Advertising: "advertising",
  "In-Person Sales": "in_person_sales",
  "Online Sales": "online_sales",
  Rentals: "rentals",
  Other: "other",
};

// Friendly report name -> FreshBooks accounting report slug.
const REPORT_SLUGS = {
  "Profit & Loss": "profitloss",
  "Tax Summary": "taxsummary",
  "Accounts Aging": "accounts_aging",
  "Invoice Details": "invoice_details",
  "Payments Collected": "payments_collected",
  "Expense Summary": "expense_summary",
};

// Friendly trigger event label -> FreshBooks webhook event name.
const TRIGGER_EVENTS = {
  "New Invoice": "invoice.create",
  "Invoice Updated": "invoice.update",
  "New Payment": "payment.create",
  "New Client": "client.create",
  "Client Updated": "client.update",
  "New Estimate": "estimate.create",
  "New Expense": "expense.create",
  "New Credit Note": "credit_note.create",
  "New Item": "item.create",
  "New Project": "project.create",
  "New Time Entry": "time_entry.create",
  "New Bill": "bill.create",
  "New Tax": "tax.create",
};

const logger = {
  info: (...args) => console.log("[FreshBooks Service] info:", ...args),
  debug: (...args) => console.log("[FreshBooks Service] debug:", ...args),
  error: (...args) => console.log("[FreshBooks Service] error:", ...args),
  warn: (...args) => console.log("[FreshBooks Service] warn:", ...args),
};

// ============================== 2. HELPERS =================================

function cleanupObject(data) {
  if (!data) return data;

  const result = {};

  Object.keys(data).forEach((key) => {
    if (data[key] !== undefined && data[key] !== null && data[key] !== "") {
      result[key] = data[key];
    }
  });

  return Object.keys(result).length > 0 ? result : undefined;
}

// Filters a list client-side across one or more (possibly nested) properties.
function searchFilter(list, props, searchString) {
  if (!searchString) return list;

  const needle = searchString.toLowerCase();

  return list.filter((item) =>
    props.some((prop) => {
      const value = prop.split(".").reduce((acc, key) => acc?.[key], item);

      return (
        value !== undefined &&
        value !== null &&
        String(value).toLowerCase().includes(needle)
      );
    }),
  );
}

// FreshBooks money is always an object: { amount: "240.00", code: "USD" }.
function toMoney(amount, code) {
  if (amount === undefined || amount === null || amount === "")
    return undefined;

  return { amount: String(amount), code: code || "USD" };
}

function formatMoney(money) {
  if (!money || money.amount === undefined) return "";

  return `${money.code || ""} ${Number(money.amount).toFixed(2)}`.trim();
}

// Accepts whatever a DATE_PICKER hands us and returns the YYYY-MM-DD form FreshBooks expects.
function formatDate(value) {
  if (!value) return undefined;

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return undefined;

  return date.toISOString().slice(0, 10);
}

// Time entries store length in seconds; users think in hours.
function hoursToSeconds(hours) {
  if (hours === undefined || hours === null || hours === "") return undefined;

  return Math.round(Number(hours) * 3600);
}

// Builds the ISO-8601 UTC timestamp the time-tracking API expects (noon avoids date drift).
function startedAt(date) {
  const day = formatDate(date);

  return day ? `${day}T12:00:00.000Z` : new Date().toISOString();
}

// FreshBooks sets an invoice due date as an offset (in days) from its issue date.
function dueOffsetDays(createDate, dueDate) {
  if (!dueDate) return undefined;

  const start = createDate ? new Date(createDate) : new Date();
  const end = new Date(dueDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    return undefined;

  const diff = Math.round((end.getTime() - start.getTime()) / 86400000);

  return diff >= 0 ? diff : undefined;
}

// Turns a FreshBooks error body into a plain-English message. Covers the three shapes
// the API uses: accounting { response: { errors: [...] } }, projects/time { error: "..." },
// and OAuth { error_description: "..." }.
function describeError(error, fallback) {
  const body = error?.body || error;

  const fbErrors = body?.response?.errors;

  if (Array.isArray(fbErrors) && fbErrors.length > 0) {
    return fbErrors
      .map((e) => e.message)
      .filter(Boolean)
      .join("; ");
  }

  if (typeof body?.error === "string") return body.error;

  if (body?.error && typeof body.error === "object") {
    if (body.error.message) return body.error.message;

    const fieldMessages = Object.values(body.error).filter(
      (v) => typeof v === "string",
    );

    if (fieldMessages.length > 0) return fieldMessages.join("; ");
  }

  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    return body.errors
      .map((e) => (typeof e === "string" ? e : e.message))
      .filter(Boolean)
      .join("; ");
  }

  if (body?.error_description) return body.error_description;
  if (body?.message && typeof body.message === "string") return body.message;
  if (typeof body === "string") return body;

  return fallback || "Unexpected FreshBooks error.";
}

// ============================== 3. SERVICE =================================

/**
 * @requireOAuth
 * @integrationName FreshBooks
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class FreshBooksService {
  constructor(config) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.scopes = DEFAULT_SCOPE_STRING;
  }

  // -------------------------- auth + dual-id routing ------------------------

  #getAccessToken() {
    const token = this.request.headers["oauth-access-token"];

    if (!token) {
      throw new Error(
        "Not connected to FreshBooks. Please connect your FreshBooks account.",
      );
    }

    return token;
  }

  #getAccessTokenHeader() {
    return { Authorization: `Bearer ${this.#getAccessToken()}` };
  }

  #getSecretTokenHeader() {
    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");

    return { Authorization: `Basic ${credentials}` };
  }

  // account_id (alphanumeric) drives all /accounting/account/<id>/... calls.
  #getAccountId() {
    const accountId = this.request.headers["oauth-user-data-accountid"];

    if (!accountId) {
      throw new Error(
        "FreshBooks account not identified. Please reconnect your FreshBooks account.",
      );
    }

    return accountId;
  }

  // business_id (integer) drives /projects/business/<id>/... and /timetracking/business/<id>/... calls.
  #getBusinessId() {
    const businessId = this.request.headers["oauth-user-data-businessid"];

    if (!businessId) {
      throw new Error(
        "FreshBooks business not identified. Please reconnect your FreshBooks account.",
      );
    }

    return businessId;
  }

  #accountingUrl(path) {
    return `${API_BASE}/accounting/account/${this.#getAccountId()}/${path}`;
  }

  #projectsUrl(path) {
    return `${API_BASE}/projects/business/${this.#getBusinessId()}/${path}`;
  }

  #timeUrl(path) {
    return `${API_BASE}/timetracking/business/${this.#getBusinessId()}/${path}`;
  }

  #commentsUrl(path) {
    return `${API_BASE}/comments/business/${this.#getBusinessId()}/${path}`;
  }

  #eventsUrl(path) {
    return `${API_BASE}/events/account/${this.#getAccountId()}/${path}`;
  }

  /**
   * Unified request wrapper. Content-Type is only set when there is a body, which
   * also satisfies FreshBooks' rule that Projects/Time GETs must omit Content-Type.
   */
  async #apiRequest({ url, method, body, query, logTag, headers }) {
    method = method || "get";

    logger.debug(
      `${logTag} - [${method}::${url}] q=[${JSON.stringify(query || {})}]`,
    );

    try {
      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .set({ Accept: "application/json", "Api-Version": "alpha" });

      if (query) {
        request.query(cleanupObject(query) || {});
      }

      if (headers) {
        request.set(headers);
      }

      if (body !== undefined) {
        request.set({ "Content-Type": "application/json" });

        return await request.send(body);
      }

      return await request;
    } catch (error) {
      const message = describeError(error, `${logTag} failed.`);

      logger.error(`${logTag} - ${message}`);

      throw new Error(message);
    }
  }

  // Unwraps the accounting envelope: { response: { result: { <key>: ... } } }.
  #unwrap(body, key) {
    return body?.response?.result?.[key];
  }

  // Unwraps an accounting list, returning items plus paging meta.
  #unwrapList(body, key) {
    const result = body?.response?.result || {};

    return {
      items: result[key] || [],
      page: result.page,
      pages: result.pages,
      total: result.total,
    };
  }

  async #me() {
    const body = await Flowrunner.Request.get(IDENTITY_URL)
      .set(this.#getAccessTokenHeader())
      .set({ Accept: "application/json", "Api-Version": "alpha" });

    return body?.response || body;
  }

  // ============================ 4. OAUTH2 ==================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams();

    params.append("client_id", this.clientId);
    params.append("response_type", "code");
    params.append("scope", this.scopes);

    return `${OAUTH_AUTH_URL}?${params.toString()}`;
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
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams();

    params.append("grant_type", "authorization_code");
    params.append("client_id", this.clientId);
    params.append("client_secret", this.clientSecret);
    params.append("code", callbackObject.code);
    params.append("redirect_uri", callbackObject.redirectURI);

    const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ "Content-Type": "application/x-www-form-urlencoded" })
      .send(params.toString());

    // Resolve the primary business so every method can route accounting vs projects/time calls.
    let accountId = "";
    let businessId = "";
    let businessName = "FreshBooks";

    try {
      const identity = await Flowrunner.Request.get(IDENTITY_URL)
        .set({ Authorization: `Bearer ${tokenResponse.access_token}` })
        .set({ Accept: "application/json", "Api-Version": "alpha" });

      const memberships =
        (identity?.response || identity)?.business_memberships || [];
      const primary =
        memberships.find((m) => m?.business?.account_id) || memberships[0];

      if (primary?.business) {
        accountId = primary.business.account_id || "";
        businessId = String(primary.business.id || "");
        businessName = primary.business.name || businessName;
      }
    } catch (error) {
      logger.warn(
        `executeCallback - could not resolve identity: ${error.message}`,
      );
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName: businessName,
      connectionIdentityImageURL: null,
      overwrite: true,
      userData: {
        accountId,
        businessId,
        businessName,
      },
    };
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   * @property {String} [refreshToken]
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const params = new URLSearchParams();

    params.append("grant_type", "refresh_token");
    params.append("client_id", this.clientId);
    params.append("client_secret", this.clientSecret);
    params.append("refresh_token", refreshToken);

    const response = await Flowrunner.Request.post(TOKEN_URL)
      .set({ "Content-Type": "application/x-www-form-urlencoded" })
      .send(params.toString());

    // FreshBooks rotates + single-uses refresh tokens, so always persist the new one.
    return {
      token: response.access_token,
      expirationInSeconds: response.expires_in,
      refreshToken: response.refresh_token || refreshToken,
    };
  }

  // ============================ 5. DICTIONARIES ============================

  /**
   * @typedef {Object} getClientsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter clients by name, business, or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Clients
   * @description Provides a searchable list of clients to pick from when filling in other actions.
   * @route POST /get-clients-dictionary
   * @paramDef {"type":"getClientsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Corp","value":"2280","note":"billing@acme.com"}],"cursor":null}
   */
  async getClientsDictionary(payload) {
    const { search, cursor } = payload || {};
    const page = cursor ? parseInt(cursor) : 1;

    const body = await this.#apiRequest({
      url: this.#accountingUrl("users/clients"),
      query: { per_page: DEFAULT_PER_PAGE, page },
      logTag: "getClientsDictionary",
    });

    const { items, pages } = this.#unwrapList(body, "clients");
    const filtered = searchFilter(
      items,
      ["organization", "fname", "lname", "email"],
      search,
    );

    return {
      cursor: page < (pages || 1) ? String(page + 1) : null,
      items: filtered.map((client) => ({
        label:
          client.organization ||
          `${client.fname || ""} ${client.lname || ""}`.trim() ||
          `Client ${client.id}`,
        value: String(client.id),
        note: client.email || `ID: ${client.id}`,
      })),
    };
  }

  /**
   * @typedef {Object} getInvoicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter invoices by number or client."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Invoices
   * @description Provides a searchable list of invoices to pick from when filling in other actions.
   * @route POST /get-invoices-dictionary
   * @paramDef {"type":"getInvoicesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#0001 - Acme Corp (USD 1500.00)","value":"987","note":"Status: paid"}],"cursor":null}
   */
  async getInvoicesDictionary(payload) {
    const { search, cursor } = payload || {};
    const page = cursor ? parseInt(cursor) : 1;

    const body = await this.#apiRequest({
      url: this.#accountingUrl("invoices/invoices"),
      query: { per_page: DEFAULT_PER_PAGE, page },
      logTag: "getInvoicesDictionary",
    });

    const { items, pages } = this.#unwrapList(body, "invoices");
    const filtered = searchFilter(
      items,
      ["invoice_number", "current_organization", "fname", "lname"],
      search,
    );

    return {
      cursor: page < (pages || 1) ? String(page + 1) : null,
      items: filtered.map((invoice) => ({
        label: `#${invoice.invoice_number || invoice.invoiceid} - ${
          invoice.current_organization ||
          `${invoice.fname || ""} ${invoice.lname || ""}`.trim() ||
          "Client"
        } (${formatMoney(invoice.amount)})`,
        value: String(invoice.invoiceid || invoice.id),
        note: `Status: ${invoice.v3_status || invoice.display_status || "unknown"}`,
      })),
    };
  }

  /**
   * @typedef {Object} getItemsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter items by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Items
   * @description Provides a searchable list of saved products and services to pick from.
   * @route POST /get-items-dictionary
   * @paramDef {"type":"getItemsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Design work","value":"55","note":"USD 120.00"}],"cursor":null}
   */
  async getItemsDictionary(payload) {
    const { search, cursor } = payload || {};
    const page = cursor ? parseInt(cursor) : 1;

    const body = await this.#apiRequest({
      url: this.#accountingUrl("items/items"),
      query: { per_page: DEFAULT_PER_PAGE, page },
      logTag: "getItemsDictionary",
    });

    const { items, pages } = this.#unwrapList(body, "items");
    const filtered = searchFilter(
      items,
      ["name", "description", "sku"],
      search,
    );

    return {
      cursor: page < (pages || 1) ? String(page + 1) : null,
      items: filtered.map((item) => ({
        label: item.name || `Item ${item.itemid}`,
        value: String(item.itemid || item.id),
        note: item.unit_cost ? formatMoney(item.unit_cost) : item.sku || "",
      })),
    };
  }

  /**
   * @typedef {Object} getTaxesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter taxes by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Taxes
   * @description Provides a searchable list of saved tax rates to apply to invoices and expenses.
   * @route POST /get-taxes-dictionary
   * @paramDef {"type":"getTaxesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"GST (5%)","value":"GST","note":"5%"}],"cursor":null}
   */
  async getTaxesDictionary(payload) {
    const { search, cursor } = payload || {};
    const page = cursor ? parseInt(cursor) : 1;

    const body = await this.#apiRequest({
      url: this.#accountingUrl("taxes/taxes"),
      query: { per_page: DEFAULT_PER_PAGE, page },
      logTag: "getTaxesDictionary",
    });

    const { items, pages } = this.#unwrapList(body, "taxes");
    const filtered = searchFilter(items, ["name", "number"], search);

    return {
      cursor: page < (pages || 1) ? String(page + 1) : null,
      // Value is the tax name (what an invoice line stores); the rate travels in the note.
      items: filtered.map((tax) => ({
        label: `${tax.name}${tax.amount ? ` (${tax.amount}%)` : ""}`,
        value: tax.name,
        note: tax.amount ? `${tax.amount}%` : "",
      })),
    };
  }

  /**
   * @typedef {Object} getExpenseCategoriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter categories by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Expense Categories
   * @description Provides a searchable list of expense categories to classify spending.
   * @route POST /get-expense-categories-dictionary
   * @paramDef {"type":"getExpenseCategoriesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Meals & Entertainment","value":"121374834","note":""}],"cursor":null}
   */
  async getExpenseCategoriesDictionary(payload) {
    const { search, cursor } = payload || {};
    const page = cursor ? parseInt(cursor) : 1;

    const body = await this.#apiRequest({
      url: this.#accountingUrl("expenses/categories"),
      query: { per_page: DEFAULT_PER_PAGE, page },
      logTag: "getExpenseCategoriesDictionary",
    });

    const { items, pages } = this.#unwrapList(body, "categories");
    const filtered = searchFilter(items, ["category"], search);

    return {
      cursor: page < (pages || 1) ? String(page + 1) : null,
      items: filtered.map((category) => ({
        label: category.category || `Category ${category.categoryid}`,
        value: String(category.categoryid || category.id),
        note: "",
      })),
    };
  }

  /**
   * @typedef {Object} getVendorsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter vendors by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Vendors
   * @description Provides a searchable list of vendors (suppliers) to pick from when recording bills.
   * @route POST /get-vendors-dictionary
   * @paramDef {"type":"getVendorsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Office Supplies Co","value":"1562","note":"orders@supplies.co"}],"cursor":null}
   */
  async getVendorsDictionary(payload) {
    const { search, cursor } = payload || {};
    const page = cursor ? parseInt(cursor) : 1;

    const body = await this.#apiRequest({
      url: this.#accountingUrl("bill_vendors/bill_vendors"),
      query: { per_page: DEFAULT_PER_PAGE, page },
      logTag: "getVendorsDictionary",
    });

    const { items, pages } = this.#unwrapList(body, "bill_vendors");
    const filtered = searchFilter(
      items,
      ["vendor_name", "primary_contact_email"],
      search,
    );

    return {
      cursor: page < (pages || 1) ? String(page + 1) : null,
      items: filtered.map((vendor) => ({
        label: vendor.vendor_name || `Vendor ${vendor.vendorid}`,
        value: String(vendor.vendorid || vendor.id),
        note: vendor.primary_contact_email || "",
      })),
    };
  }

  /**
   * @typedef {Object} getProjectsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter projects by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Projects
   * @description Provides a searchable list of projects to pick from when logging time or expenses.
   * @route POST /get-projects-dictionary
   * @paramDef {"type":"getProjectsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Website Redesign","value":"153125","note":"fixed price"}],"cursor":null}
   */
  async getProjectsDictionary(payload) {
    const { search, cursor } = payload || {};
    const page = cursor ? parseInt(cursor) : 1;

    const body = await this.#apiRequest({
      url: this.#projectsUrl("projects"),
      query: { per_page: DEFAULT_PER_PAGE, page },
      logTag: "getProjectsDictionary",
    });

    const projects = body?.projects || [];
    const pages = body?.meta?.pages;
    const filtered = searchFilter(projects, ["title", "description"], search);

    return {
      cursor: page < (pages || 1) ? String(page + 1) : null,
      items: filtered.map((project) => ({
        label: project.title || `Project ${project.id}`,
        value: String(project.id),
        note: (project.project_type || "").replace("_", " "),
      })),
    };
  }

  /**
   * @typedef {Object} getCurrenciesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter currencies."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Currencies
   * @description Provides a list of common currencies to choose from.
   * @route POST /get-currencies-dictionary
   * @paramDef {"type":"getCurrenciesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"US Dollar (USD)","value":"USD","note":""}],"cursor":null}
   */
  async getCurrenciesDictionary(payload) {
    const { search } = payload || {};
    const needle = (search || "").toLowerCase();

    const items = COMMON_CURRENCIES.filter(
      ([code, name]) =>
        !needle ||
        code.toLowerCase().includes(needle) ||
        name.toLowerCase().includes(needle),
    ).map(([code, name]) => ({
      label: `${name} (${code})`,
      value: code,
      note: "",
    }));

    return { cursor: null, items };
  }

  // ============================ 6. RESOURCES ==============================

  // ------------------------------- helpers --------------------------------

  // Builds a { taxName -> percent } map so a picked tax name applies its saved rate.
  async #getTaxMap() {
    try {
      const body = await this.#apiRequest({
        url: this.#accountingUrl("taxes/taxes"),
        query: { per_page: DEFAULT_PER_PAGE },
        logTag: "getTaxMap",
      });

      const map = {};

      this.#unwrapList(body, "taxes").items.forEach((tax) => {
        if (tax.name) map[String(tax.name).toLowerCase()] = tax.amount;
      });

      return map;
    } catch (error) {
      logger.warn(`getTaxMap - ${error.message}`);

      return {};
    }
  }

  // Resolves the logged-in user's identity id (required when logging time).
  async #getIdentityId() {
    if (this.__identityId) return this.__identityId;

    try {
      const identity = await this.#me();

      this.__identityId = identity?.id;
    } catch (error) {
      logger.warn(`getIdentityId - ${error.message}`);
    }

    return this.__identityId;
  }

  // Resolves the account's staff id (required when creating expenses). Owner is usually 1.
  async #getDefaultStaffId() {
    if (this.__staffId) return this.__staffId;

    try {
      const body = await this.#apiRequest({
        url: this.#accountingUrl("users/staffs"),
        query: { per_page: 1 },
        logTag: "getDefaultStaffId",
      });

      const staff = this.#unwrapList(body, "staff").items;

      this.__staffId = staff[0]?.id || staff[0]?.userid || 1;
    } catch (error) {
      this.__staffId = 1;
    }

    return this.__staffId;
  }

  // Maps the friendly LineItem shape to FreshBooks invoice/estimate lines.
  async #mapLineItems(lineItems, currency) {
    if (!Array.isArray(lineItems) || lineItems.length === 0) return undefined;

    const taxMap = lineItems.some((li) => li && li.tax)
      ? await this.#getTaxMap()
      : {};

    return lineItems.map((li) => {
      const price = li.unitPrice ?? li.unit_cost;

      const line = {
        name: li.description || li.name,
        qty: li.quantity ?? li.qty,
        unit_cost: currency
          ? { amount: String(price ?? 0), code: currency }
          : { amount: String(price ?? 0) },
      };

      if (li.tax) {
        line.taxName1 = li.tax;

        const pct = taxMap[String(li.tax).toLowerCase()];

        if (pct !== undefined) line.taxAmount1 = pct;
      }

      return cleanupObject(line);
    });
  }

  // -------------------------------- Clients -------------------------------

  /**
   * @operationName Find Clients
   * @category Clients
   * @description Lists your clients, with optional filters. Use this to look up customers or pull a list to work through.
   * @route POST /find-clients
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by name, business, or email. Leave blank to list everyone."}
   * @paramDef {"type":"Boolean","label":"Only With Money Owed","name":"onlyWithOutstanding","uiComponent":{"type":"TOGGLE"},"description":"Show only clients who currently owe you money."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"id":2280,"fname":"Jane","lname":"Doe","organization":"Acme Corp","email":"jane@acme.com","vis_state":0}]
   */
  async findClients(search, onlyWithOutstanding, maxResults) {
    const query = {
      per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
      page: 1,
    };

    if (onlyWithOutstanding) query["search[has_outstanding]"] = true;

    const body = await this.#apiRequest({
      url: this.#accountingUrl("users/clients"),
      query,
      logTag: "findClients",
    });

    return searchFilter(
      this.#unwrapList(body, "clients").items,
      ["organization", "fname", "lname", "email"],
      search,
    );
  }

  /**
   * @operationName Get Client
   * @category Clients
   * @description Retrieves the full details of one client.
   * @route POST /get-client
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"The client to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":2280,"fname":"Jane","lname":"Doe","organization":"Acme Corp","email":"jane@acme.com","vis_state":0}
   */
  async getClient(clientId) {
    if (!clientId) throw new Error('"Client" is required.');

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`users/clients/${clientId}`),
      logTag: "getClient",
    });

    return this.#unwrap(body, "client");
  }

  /**
   * @operationName Create Client
   * @category Clients
   * @description Adds a new client — the person or business you invoice. Use this when onboarding a new customer.
   * @route POST /create-client
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Client's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Client's last name."}
   * @paramDef {"type":"String","label":"Business Name","name":"organization","description":"The client's company or business name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Where invoices and receipts are sent."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Client's phone number."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Currency you bill this client in. Defaults to your account currency."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","description":"Street address."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"addressLine2","description":"Apartment, suite, unit, etc."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"City."}
   * @paramDef {"type":"String","label":"State / Province","name":"state","description":"State or province."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"ZIP or postal code."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Country."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Private notes about this client (not shown to them)."}
   * @returns {Object}
   * @sampleResult {"id":2280,"fname":"Jane","lname":"Doe","organization":"Acme Corp","email":"jane@acme.com","vis_state":0}
   */
  async createClient(
    firstName,
    lastName,
    organization,
    email,
    phone,
    currency,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country,
    notes,
  ) {
    const client = cleanupObject({
      fname: firstName,
      lname: lastName,
      organization,
      email,
      mob_phone: phone,
      currency_code: currency,
      p_street: addressLine1,
      p_street2: addressLine2,
      p_city: city,
      p_province: state,
      p_code: postalCode,
      p_country: country,
      note: notes,
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl("users/clients"),
      method: "post",
      body: { client },
      logTag: "createClient",
    });

    return this.#unwrap(body, "client");
  }

  /**
   * @operationName Update Client
   * @category Clients
   * @description Changes details on an existing client. Only the fields you fill in are updated.
   * @route POST /update-client
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"The client to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Updated first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Updated last name."}
   * @paramDef {"type":"String","label":"Business Name","name":"organization","description":"Updated company or business name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Updated email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Updated phone number."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Updated billing currency."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","description":"Updated street address."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"addressLine2","description":"Updated apartment, suite, unit, etc."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"Updated city."}
   * @paramDef {"type":"String","label":"State / Province","name":"state","description":"Updated state or province."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"Updated ZIP or postal code."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Updated country."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated private notes."}
   * @returns {Object}
   * @sampleResult {"id":2280,"fname":"Jane","lname":"Doe","organization":"Acme Corp","email":"jane@acme.com","vis_state":0}
   */
  async updateClient(
    clientId,
    firstName,
    lastName,
    organization,
    email,
    phone,
    currency,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country,
    notes,
  ) {
    if (!clientId) throw new Error('"Client" is required.');

    const client = cleanupObject({
      fname: firstName,
      lname: lastName,
      organization,
      email,
      mob_phone: phone,
      currency_code: currency,
      p_street: addressLine1,
      p_street2: addressLine2,
      p_city: city,
      p_province: state,
      p_code: postalCode,
      p_country: country,
      note: notes,
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`users/clients/${clientId}`),
      method: "put",
      body: { client: client || {} },
      logTag: "updateClient",
    });

    return this.#unwrap(body, "client");
  }

  /**
   * @operationName Delete Client
   * @category Clients
   * @description Removes a client. By default it is deleted; turn on archiving to keep a hidden copy instead.
   * @route POST /delete-client
   * @appearanceColor #D64242 #E8635F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"The client to remove."}
   * @paramDef {"type":"Boolean","label":"Archive Instead of Delete","name":"archiveInstead","uiComponent":{"type":"TOGGLE"},"description":"Keep an archived (hidden) copy instead of permanently deleting."}
   * @returns {Object}
   * @sampleResult {"id":"2280","deleted":true,"archived":false}
   */
  async deleteClient(clientId, archiveInstead) {
    if (!clientId) throw new Error('"Client" is required.');

    await this.#apiRequest({
      url: this.#accountingUrl(`users/clients/${clientId}`),
      method: "put",
      body: { client: { vis_state: archiveInstead ? 2 : 1 } },
      logTag: "deleteClient",
    });

    return {
      id: clientId,
      deleted: !archiveInstead,
      archived: !!archiveInstead,
    };
  }

  // -------------------------------- Invoices ------------------------------

  /**
   * @typedef {Object} LineItem
   * @property {String} description - What you're billing for (e.g. "Design work").
   * @property {Number} quantity - How many units.
   * @property {Number} unitPrice - Price for a single unit.
   * @property {String} [tax] - Optional tax name to apply (e.g. "GST"). The saved rate is applied automatically.
   */

  /**
   * @operationName Find Invoices
   * @category Invoices
   * @description Lists invoices, with optional filters by client, status, and date. Use this to find invoices to act on or report.
   * @route POST /find-invoices
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Client","name":"clientId","dictionary":"getClientsDictionary","description":"Only show invoices for this client."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Sent","Viewed","Paid","Partially Paid","Overdue","Disputed"]}},"description":"Only show invoices in this state."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only show invoices dated on or after this day."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only show invoices dated on or before this day."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"invoiceid":987,"invoice_number":"0001","customerid":2280,"amount":{"amount":"1500.00","code":"USD"},"v3_status":"paid","create_date":"2026-05-01"}]
   */
  async findInvoices(clientId, status, fromDate, toDate, maxResults) {
    const query = {
      per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
      page: 1,
    };

    if (clientId) query["search[customerid]"] = clientId;
    if (formatDate(fromDate)) query["search[date_min]"] = formatDate(fromDate);
    if (formatDate(toDate)) query["search[date_max]"] = formatDate(toDate);

    const body = await this.#apiRequest({
      url: this.#accountingUrl("invoices/invoices"),
      query,
      logTag: "findInvoices",
    });

    let items = this.#unwrapList(body, "invoices").items;

    const wanted = INVOICE_STATUS_FILTER[status];

    if (wanted) items = items.filter((invoice) => invoice.v3_status === wanted);

    return items;
  }

  /**
   * @operationName Get Invoice
   * @category Invoices
   * @description Retrieves one invoice in full, including its line items.
   * @route POST /get-invoice
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice to retrieve."}
   * @returns {Object}
   * @sampleResult {"invoiceid":987,"invoice_number":"0001","customerid":2280,"amount":{"amount":"1500.00","code":"USD"},"outstanding":{"amount":"0.00","code":"USD"},"v3_status":"paid","lines":[{"name":"Design work","qty":"10","unit_cost":{"amount":"120.00","code":"USD"}}]}
   */
  async getInvoice(invoiceId) {
    if (!invoiceId) throw new Error('"Invoice" is required.');

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`invoices/invoices/${invoiceId}`),
      query: { "include[]": "lines" },
      logTag: "getInvoice",
    });

    return this.#unwrap(body, "invoice");
  }

  /**
   * @operationName Create Invoice
   * @category Invoices
   * @description Creates a new invoice for a client with one or more line items. The invoice starts as a draft — use Send Invoice to deliver it.
   * @route POST /create-invoice
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"The client this invoice is for."}
   * @paramDef {"type":"Array.<LineItem>","label":"Line Items","name":"lineItems","required":true,"description":"The products or services being billed. Add a row for each item."}
   * @paramDef {"type":"String","label":"Invoice Date","name":"invoiceDate","uiComponent":{"type":"DATE_PICKER"},"description":"The date shown on the invoice. Leave blank for today."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"When payment is due. Leave blank for due on receipt."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Currency for this invoice. Defaults to your account currency."}
   * @paramDef {"type":"String","label":"Invoice Number","name":"invoiceNumber","description":"A custom invoice number. Leave blank to auto-number."}
   * @paramDef {"type":"String","label":"PO Number","name":"poNumber","description":"The client's purchase order number, if any."}
   * @paramDef {"type":"Number","label":"Discount (%)","name":"discountPercent","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Percentage discount applied to the whole invoice (0-100)."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes shown to the client (e.g. bank details)."}
   * @paramDef {"type":"String","label":"Terms","name":"terms","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Payment terms shown on the invoice."}
   * @returns {Object}
   * @sampleResult {"invoiceid":987,"invoice_number":"0001","customerid":2280,"amount":{"amount":"1200.00","code":"USD"},"v3_status":"draft"}
   */
  async createInvoice(
    clientId,
    lineItems,
    invoiceDate,
    dueDate,
    currency,
    invoiceNumber,
    poNumber,
    discountPercent,
    notes,
    terms,
  ) {
    if (!clientId) throw new Error('"Client" is required.');

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" is required — add at least one item.');
    }

    const createDate = formatDate(invoiceDate);

    const invoice = cleanupObject({
      customerid: clientId,
      create_date: createDate,
      currency_code: currency,
      invoice_number: invoiceNumber,
      po_number: poNumber,
      discount_value: discountPercent,
      due_offset_days: dueOffsetDays(createDate, formatDate(dueDate)),
      notes,
      terms,
      lines: await this.#mapLineItems(lineItems, currency),
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl("invoices/invoices"),
      method: "post",
      body: { invoice },
      logTag: "createInvoice",
    });

    return this.#unwrap(body, "invoice");
  }

  /**
   * @operationName Update Invoice
   * @category Invoices
   * @description Changes an existing invoice. Only the fields you fill in are updated. Providing line items replaces all existing ones.
   * @route POST /update-invoice
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice to update."}
   * @paramDef {"type":"String","label":"Client","name":"clientId","dictionary":"getClientsDictionary","description":"Move the invoice to a different client."}
   * @paramDef {"type":"Array.<LineItem>","label":"Line Items","name":"lineItems","description":"Replacement line items. Leave blank to keep existing ones."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Updated due date."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Updated currency."}
   * @paramDef {"type":"String","label":"PO Number","name":"poNumber","description":"Updated purchase order number."}
   * @paramDef {"type":"Number","label":"Discount (%)","name":"discountPercent","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated whole-invoice discount percentage."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated notes for the client."}
   * @paramDef {"type":"String","label":"Terms","name":"terms","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated payment terms."}
   * @returns {Object}
   * @sampleResult {"invoiceid":987,"invoice_number":"0001","v3_status":"draft","amount":{"amount":"1300.00","code":"USD"}}
   */
  async updateInvoice(
    invoiceId,
    clientId,
    lineItems,
    dueDate,
    currency,
    poNumber,
    discountPercent,
    notes,
    terms,
  ) {
    if (!invoiceId) throw new Error('"Invoice" is required.');

    const invoice = cleanupObject({
      customerid: clientId,
      currency_code: currency,
      po_number: poNumber,
      discount_value: discountPercent,
      due_offset_days: dueOffsetDays(undefined, formatDate(dueDate)),
      notes,
      terms,
      lines: await this.#mapLineItems(lineItems, currency),
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`invoices/invoices/${invoiceId}`),
      method: "put",
      body: { invoice: invoice || {} },
      logTag: "updateInvoice",
    });

    return this.#unwrap(body, "invoice");
  }

  /**
   * @operationName Send Invoice
   * @category Invoices
   * @description Sends an invoice to your client by email, or simply marks it as sent. Use this after creating a draft.
   * @route POST /send-invoice
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice to send."}
   * @paramDef {"type":"String","label":"How to Send","name":"sendMethod","uiComponent":{"type":"DROPDOWN","options":{"values":["Email to client","Mark as sent only"]}},"description":"Email it to the client, or just mark it sent without emailing."}
   * @paramDef {"type":"Array<String>","label":"Send To","name":"recipients","description":"Email addresses to send to. Leave blank to use the client's email on file."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Custom email subject line."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Custom email message to the client."}
   * @paramDef {"type":"Boolean","label":"Attach PDF","name":"includePdf","uiComponent":{"type":"TOGGLE"},"description":"Attach a PDF copy of the invoice to the email."}
   * @returns {Object}
   * @sampleResult {"id":"987","sent":true,"status":"sent"}
   */
  async sendInvoice(
    invoiceId,
    sendMethod,
    recipients,
    subject,
    message,
    includePdf,
  ) {
    if (!invoiceId) throw new Error('"Invoice" is required.');

    let invoice;

    if (sendMethod === "Mark as sent only") {
      invoice = { action_mark_as_sent: true };
    } else {
      invoice = cleanupObject({
        action_email: true,
        email_recipients: Array.isArray(recipients)
          ? recipients
          : recipients
            ? [recipients]
            : undefined,
        email_include_pdf: includePdf === undefined ? undefined : !!includePdf,
        invoice_customized_email: cleanupObject({ subject, body: message }),
      });
    }

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`invoices/invoices/${invoiceId}`),
      method: "put",
      body: { invoice },
      logTag: "sendInvoice",
    });

    return {
      id: invoiceId,
      sent: true,
      status: this.#unwrap(body, "invoice")?.v3_status,
    };
  }

  /**
   * @operationName Delete Invoice
   * @category Invoices
   * @description Removes an invoice. By default it is deleted; turn on archiving to keep a hidden copy instead.
   * @route POST /delete-invoice
   * @appearanceColor #D64242 #E8635F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice to remove."}
   * @paramDef {"type":"Boolean","label":"Archive Instead of Delete","name":"archiveInstead","uiComponent":{"type":"TOGGLE"},"description":"Keep an archived (hidden) copy instead of permanently deleting."}
   * @returns {Object}
   * @sampleResult {"id":"987","deleted":true,"archived":false}
   */
  async deleteInvoice(invoiceId, archiveInstead) {
    if (!invoiceId) throw new Error('"Invoice" is required.');

    await this.#apiRequest({
      url: this.#accountingUrl(`invoices/invoices/${invoiceId}`),
      method: "put",
      body: { invoice: { vis_state: archiveInstead ? 2 : 1 } },
      logTag: "deleteInvoice",
    });

    return {
      id: invoiceId,
      deleted: !archiveInstead,
      archived: !!archiveInstead,
    };
  }

  // -------------------------------- Estimates -----------------------------

  /**
   * @operationName Find Estimates
   * @category Estimates
   * @description Lists estimates (quotes), with optional filters by client and date.
   * @route POST /find-estimates
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Client","name":"clientId","dictionary":"getClientsDictionary","description":"Only show estimates for this client."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only show estimates dated on or after this day."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only show estimates dated on or before this day."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"estimateid":55,"estimate_number":"E-0001","customerid":2280,"amount":{"amount":"800.00","code":"USD"},"ui_status":"sent"}]
   */
  async findEstimates(clientId, fromDate, toDate, maxResults) {
    const query = {
      per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
      page: 1,
    };

    if (clientId) query["search[customerid]"] = clientId;
    if (formatDate(fromDate)) query["search[date_min]"] = formatDate(fromDate);
    if (formatDate(toDate)) query["search[date_max]"] = formatDate(toDate);

    const body = await this.#apiRequest({
      url: this.#accountingUrl("estimates/estimates"),
      query,
      logTag: "findEstimates",
    });

    return this.#unwrapList(body, "estimates").items;
  }

  /**
   * @operationName Get Estimate
   * @category Estimates
   * @description Retrieves one estimate in full, including its line items.
   * @route POST /get-estimate
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Estimate","name":"estimateId","required":true,"description":"The ID of the estimate to retrieve."}
   * @returns {Object}
   * @sampleResult {"estimateid":55,"estimate_number":"E-0001","customerid":2280,"amount":{"amount":"800.00","code":"USD"},"ui_status":"sent","lines":[{"name":"Consulting","qty":"8","unit_cost":{"amount":"100.00","code":"USD"}}]}
   */
  async getEstimate(estimateId) {
    if (!estimateId) throw new Error('"Estimate" is required.');

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`estimates/estimates/${estimateId}`),
      query: { "include[]": "lines" },
      logTag: "getEstimate",
    });

    return this.#unwrap(body, "estimate");
  }

  /**
   * @operationName Create Estimate
   * @category Estimates
   * @description Creates a new estimate (quote) for a client. Send it for approval, then convert it to an invoice once accepted.
   * @route POST /create-estimate
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"The client this estimate is for."}
   * @paramDef {"type":"Array.<LineItem>","label":"Line Items","name":"lineItems","required":true,"description":"The products or services being quoted. Add a row for each item."}
   * @paramDef {"type":"String","label":"Estimate Date","name":"estimateDate","uiComponent":{"type":"DATE_PICKER"},"description":"The date shown on the estimate. Leave blank for today."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Currency for this estimate. Defaults to your account currency."}
   * @paramDef {"type":"String","label":"PO Number","name":"poNumber","description":"The client's purchase order number, if any."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes shown to the client."}
   * @paramDef {"type":"String","label":"Terms","name":"terms","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Terms shown on the estimate."}
   * @returns {Object}
   * @sampleResult {"estimateid":55,"estimate_number":"E-0001","customerid":2280,"amount":{"amount":"800.00","code":"USD"},"ui_status":"draft"}
   */
  async createEstimate(
    clientId,
    lineItems,
    estimateDate,
    currency,
    poNumber,
    notes,
    terms,
  ) {
    if (!clientId) throw new Error('"Client" is required.');

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" is required — add at least one item.');
    }

    const estimate = cleanupObject({
      customerid: clientId,
      create_date: formatDate(estimateDate),
      currency_code: currency,
      po_number: poNumber,
      notes,
      terms,
      lines: await this.#mapLineItems(lineItems, currency),
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl("estimates/estimates"),
      method: "post",
      body: { estimate },
      logTag: "createEstimate",
    });

    return this.#unwrap(body, "estimate");
  }

  /**
   * @operationName Update Estimate
   * @category Estimates
   * @description Changes an existing estimate. Only the fields you fill in are updated. Providing line items replaces all existing ones.
   * @route POST /update-estimate
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Estimate","name":"estimateId","required":true,"description":"The ID of the estimate to update."}
   * @paramDef {"type":"Array.<LineItem>","label":"Line Items","name":"lineItems","description":"Replacement line items. Leave blank to keep existing ones."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Updated currency."}
   * @paramDef {"type":"String","label":"PO Number","name":"poNumber","description":"Updated purchase order number."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated notes for the client."}
   * @paramDef {"type":"String","label":"Terms","name":"terms","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated terms."}
   * @returns {Object}
   * @sampleResult {"estimateid":55,"estimate_number":"E-0001","ui_status":"draft","amount":{"amount":"900.00","code":"USD"}}
   */
  async updateEstimate(
    estimateId,
    lineItems,
    currency,
    poNumber,
    notes,
    terms,
  ) {
    if (!estimateId) throw new Error('"Estimate" is required.');

    const estimate = cleanupObject({
      currency_code: currency,
      po_number: poNumber,
      notes,
      terms,
      lines: await this.#mapLineItems(lineItems, currency),
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`estimates/estimates/${estimateId}`),
      method: "put",
      body: { estimate: estimate || {} },
      logTag: "updateEstimate",
    });

    return this.#unwrap(body, "estimate");
  }

  /**
   * @operationName Send Estimate
   * @category Estimates
   * @description Sends an estimate to your client by email, or simply marks it as sent.
   * @route POST /send-estimate
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Estimate","name":"estimateId","required":true,"description":"The ID of the estimate to send."}
   * @paramDef {"type":"String","label":"How to Send","name":"sendMethod","uiComponent":{"type":"DROPDOWN","options":{"values":["Email to client","Mark as sent only"]}},"description":"Email it to the client, or just mark it sent without emailing."}
   * @paramDef {"type":"Array<String>","label":"Send To","name":"recipients","description":"Email addresses to send to. Leave blank to use the client's email on file."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Custom email subject line."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Custom email message to the client."}
   * @returns {Object}
   * @sampleResult {"id":"55","sent":true,"status":"sent"}
   */
  async sendEstimate(estimateId, sendMethod, recipients, subject, message) {
    if (!estimateId) throw new Error('"Estimate" is required.');

    let estimate;

    if (sendMethod === "Mark as sent only") {
      estimate = { action_mark_as_sent: true };
    } else {
      estimate = cleanupObject({
        action_email: true,
        email_recipients: Array.isArray(recipients)
          ? recipients
          : recipients
            ? [recipients]
            : undefined,
        invoice_customized_email: cleanupObject({ subject, body: message }),
      });
    }

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`estimates/estimates/${estimateId}`),
      method: "put",
      body: { estimate },
      logTag: "sendEstimate",
    });

    return {
      id: estimateId,
      sent: true,
      status: this.#unwrap(body, "estimate")?.ui_status,
    };
  }

  /**
   * @operationName Convert Estimate to Invoice
   * @category Estimates
   * @description Turns an accepted estimate into a new invoice, copying its client and line items.
   * @route POST /convert-estimate-to-invoice
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Estimate","name":"estimateId","required":true,"description":"The ID of the estimate to convert."}
   * @returns {Object}
   * @sampleResult {"invoiceid":988,"invoice_number":"0002","customerid":2280,"amount":{"amount":"800.00","code":"USD"},"v3_status":"draft"}
   */
  async convertEstimateToInvoice(estimateId) {
    if (!estimateId) throw new Error('"Estimate" is required.');

    const estBody = await this.#apiRequest({
      url: this.#accountingUrl(`estimates/estimates/${estimateId}`),
      query: { "include[]": "lines" },
      logTag: "convertEstimate:get",
    });

    const estimate = this.#unwrap(estBody, "estimate");

    if (!estimate) throw new Error("Estimate not found.");

    const lines = (estimate.lines || []).map((line) =>
      cleanupObject({
        name: line.name,
        description: line.description,
        qty: line.qty,
        unit_cost: line.unit_cost,
        taxName1: line.taxName1,
        taxAmount1: line.taxAmount1,
      }),
    );

    const invoice = cleanupObject({
      customerid: estimate.customerid,
      create_date: formatDate(new Date().toISOString()),
      currency_code: estimate.currency_code,
      estimateid: estimateId,
      lines,
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl("invoices/invoices"),
      method: "post",
      body: { invoice },
      logTag: "convertEstimate:create",
    });

    return this.#unwrap(body, "invoice");
  }

  /**
   * @operationName Delete Estimate
   * @category Estimates
   * @description Removes an estimate. By default it is deleted; turn on archiving to keep a hidden copy instead.
   * @route POST /delete-estimate
   * @appearanceColor #D64242 #E8635F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Estimate","name":"estimateId","required":true,"description":"The ID of the estimate to remove."}
   * @paramDef {"type":"Boolean","label":"Archive Instead of Delete","name":"archiveInstead","uiComponent":{"type":"TOGGLE"},"description":"Keep an archived (hidden) copy instead of permanently deleting."}
   * @returns {Object}
   * @sampleResult {"id":"55","deleted":true,"archived":false}
   */
  async deleteEstimate(estimateId, archiveInstead) {
    if (!estimateId) throw new Error('"Estimate" is required.');

    await this.#apiRequest({
      url: this.#accountingUrl(`estimates/estimates/${estimateId}`),
      method: "put",
      body: { estimate: { vis_state: archiveInstead ? 2 : 1 } },
      logTag: "deleteEstimate",
    });

    return {
      id: estimateId,
      deleted: !archiveInstead,
      archived: !!archiveInstead,
    };
  }

  // -------------------------------- Expenses ------------------------------

  /**
   * @operationName Find Expenses
   * @category Expenses
   * @description Lists expenses, with optional filters by category, client, and date.
   * @route POST /find-expenses
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Category","name":"categoryId","dictionary":"getExpenseCategoriesDictionary","description":"Only show expenses in this category."}
   * @paramDef {"type":"String","label":"Client","name":"clientId","dictionary":"getClientsDictionary","description":"Only show expenses linked to this client."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only show expenses dated on or after this day."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only show expenses dated on or before this day."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"expenseid":1569533,"amount":{"amount":"42.00","code":"USD"},"categoryid":11228587,"vendor":"Staples","date":"2026-05-10"}]
   */
  async findExpenses(categoryId, clientId, fromDate, toDate, maxResults) {
    const query = {
      per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
      page: 1,
    };

    if (categoryId) query["search[categoryid]"] = categoryId;
    if (clientId) query["search[clientid]"] = clientId;
    if (formatDate(fromDate)) query["search[date_min]"] = formatDate(fromDate);
    if (formatDate(toDate)) query["search[date_max]"] = formatDate(toDate);

    const body = await this.#apiRequest({
      url: this.#accountingUrl("expenses/expenses"),
      query,
      logTag: "findExpenses",
    });

    return this.#unwrapList(body, "expenses").items;
  }

  /**
   * @operationName Get Expense
   * @category Expenses
   * @description Retrieves one expense in full.
   * @route POST /get-expense
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Expense","name":"expenseId","required":true,"description":"The ID of the expense to retrieve."}
   * @returns {Object}
   * @sampleResult {"expenseid":1569533,"amount":{"amount":"42.00","code":"USD"},"categoryid":11228587,"vendor":"Staples","date":"2026-05-10","notes":"Printer paper"}
   */
  async getExpense(expenseId) {
    if (!expenseId) throw new Error('"Expense" is required.');

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`expenses/expenses/${expenseId}`),
      logTag: "getExpense",
    });

    return this.#unwrap(body, "expense");
  }

  /**
   * @operationName Create Expense
   * @category Expenses
   * @description Records a business expense (money you spent). Use this to track costs and optionally bill them back to a client.
   * @route POST /create-expense
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How much was spent."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Currency of the amount. Defaults to your account currency."}
   * @paramDef {"type":"String","label":"Category","name":"categoryId","required":true,"dictionary":"getExpenseCategoriesDictionary","description":"What kind of expense this is."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"The date the money was spent. Leave blank for today."}
   * @paramDef {"type":"String","label":"Vendor","name":"vendorName","description":"Who you paid (e.g. the store or supplier name)."}
   * @paramDef {"type":"String","label":"Bill to Client","name":"clientId","dictionary":"getClientsDictionary","description":"Link this expense to a client so you can bill it back."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","dictionary":"getProjectsDictionary","description":"Link this expense to a project."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What the expense was for."}
   * @returns {Object}
   * @sampleResult {"expenseid":1569533,"amount":{"amount":"42.00","code":"USD"},"categoryid":11228587,"vendor":"Staples","date":"2026-05-10"}
   */
  async createExpense(
    amount,
    currency,
    categoryId,
    date,
    vendorName,
    clientId,
    projectId,
    notes,
  ) {
    if (amount === undefined || amount === null || amount === "")
      throw new Error('"Amount" is required.');
    if (!categoryId) throw new Error('"Category" is required.');

    const expense = cleanupObject({
      amount: toMoney(amount, currency),
      categoryid: categoryId,
      staffid: await this.#getDefaultStaffId(),
      date: formatDate(date) || formatDate(new Date().toISOString()),
      vendor: vendorName,
      clientid: clientId,
      projectid: projectId,
      notes,
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl("expenses/expenses"),
      method: "post",
      body: { expense },
      logTag: "createExpense",
    });

    return this.#unwrap(body, "expense");
  }

  /**
   * @operationName Update Expense
   * @category Expenses
   * @description Changes an existing expense. Only the fields you fill in are updated.
   * @route POST /update-expense
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Expense","name":"expenseId","required":true,"description":"The ID of the expense to update."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated amount spent."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Updated currency."}
   * @paramDef {"type":"String","label":"Category","name":"categoryId","dictionary":"getExpenseCategoriesDictionary","description":"Updated category."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Updated date of the expense."}
   * @paramDef {"type":"String","label":"Vendor","name":"vendorName","description":"Updated vendor name."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated notes."}
   * @returns {Object}
   * @sampleResult {"expenseid":1569533,"amount":{"amount":"50.00","code":"USD"},"categoryid":11228587,"vendor":"Staples","date":"2026-05-10"}
   */
  async updateExpense(
    expenseId,
    amount,
    currency,
    categoryId,
    date,
    vendorName,
    notes,
  ) {
    if (!expenseId) throw new Error('"Expense" is required.');

    const expense = cleanupObject({
      amount: toMoney(amount, currency),
      categoryid: categoryId,
      date: formatDate(date),
      vendor: vendorName,
      notes,
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`expenses/expenses/${expenseId}`),
      method: "put",
      body: { expense: expense || {} },
      logTag: "updateExpense",
    });

    return this.#unwrap(body, "expense");
  }

  /**
   * @operationName Delete Expense
   * @category Expenses
   * @description Removes an expense. By default it is deleted; turn on archiving to keep a hidden copy instead.
   * @route POST /delete-expense
   * @appearanceColor #D64242 #E8635F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Expense","name":"expenseId","required":true,"description":"The ID of the expense to remove."}
   * @paramDef {"type":"Boolean","label":"Archive Instead of Delete","name":"archiveInstead","uiComponent":{"type":"TOGGLE"},"description":"Keep an archived (hidden) copy instead of permanently deleting."}
   * @returns {Object}
   * @sampleResult {"id":"1569533","deleted":true,"archived":false}
   */
  async deleteExpense(expenseId, archiveInstead) {
    if (!expenseId) throw new Error('"Expense" is required.');

    await this.#apiRequest({
      url: this.#accountingUrl(`expenses/expenses/${expenseId}`),
      method: "put",
      body: { expense: { vis_state: archiveInstead ? 2 : 1 } },
      logTag: "deleteExpense",
    });

    return {
      id: expenseId,
      deleted: !archiveInstead,
      archived: !!archiveInstead,
    };
  }

  // -------------------------------- Payments ------------------------------

  /**
   * @operationName Find Payments
   * @category Payments
   * @description Lists payments received, with optional filters by client and date.
   * @route POST /find-payments
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Client","name":"clientId","dictionary":"getClientsDictionary","description":"Only show payments from this client."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only show payments dated on or after this day."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only show payments dated on or before this day."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"id":42,"invoiceid":987,"amount":{"amount":"1500.00","code":"USD"},"date":"2026-05-12","type":"Check"}]
   */
  async findPayments(clientId, fromDate, toDate, maxResults) {
    const query = {
      per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
      page: 1,
    };

    if (clientId) query["search[clientid]"] = clientId;
    if (formatDate(fromDate)) query["search[date_min]"] = formatDate(fromDate);
    if (formatDate(toDate)) query["search[date_max]"] = formatDate(toDate);

    const body = await this.#apiRequest({
      url: this.#accountingUrl("payments/payments"),
      query,
      logTag: "findPayments",
    });

    return this.#unwrapList(body, "payments").items;
  }

  /**
   * @operationName Get Payment
   * @category Payments
   * @description Retrieves one payment in full.
   * @route POST /get-payment
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Payment","name":"paymentId","required":true,"description":"The ID of the payment to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":42,"invoiceid":987,"amount":{"amount":"1500.00","code":"USD"},"date":"2026-05-12","type":"Check","note":"Thanks"}
   */
  async getPayment(paymentId) {
    if (!paymentId) throw new Error('"Payment" is required.');

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`payments/payments/${paymentId}`),
      logTag: "getPayment",
    });

    return this.#unwrap(body, "payment");
  }

  /**
   * @operationName Record Payment
   * @category Payments
   * @description Records a payment received against an invoice. Use this to mark an invoice paid (in full or partially).
   * @route POST /record-payment
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice this payment is for."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How much was received."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Currency of the payment. Defaults to your account currency."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"The date the payment was received. Leave blank for today."}
   * @paramDef {"type":"String","label":"Payment Method","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Check","Credit Card","Cash","Bank Transfer","PayPal","Credit","Debit","Money Order","Other"]}},"description":"How the client paid."}
   * @paramDef {"type":"Boolean","label":"Notify Client","name":"notifyClient","uiComponent":{"type":"TOGGLE"},"description":"Email the client a payment receipt."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A note about this payment."}
   * @returns {Object}
   * @sampleResult {"id":42,"invoiceid":987,"amount":{"amount":"1500.00","code":"USD"},"date":"2026-05-12","type":"Check"}
   */
  async recordPayment(
    invoiceId,
    amount,
    currency,
    date,
    type,
    notifyClient,
    note,
  ) {
    if (!invoiceId) throw new Error('"Invoice" is required.');
    if (amount === undefined || amount === null || amount === "")
      throw new Error('"Amount" is required.');

    const payment = cleanupObject({
      invoiceid: invoiceId,
      amount: toMoney(amount, currency),
      date: formatDate(date) || formatDate(new Date().toISOString()),
      type,
      send_client_notification:
        notifyClient === undefined ? undefined : !!notifyClient,
      note,
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl("payments/payments"),
      method: "post",
      body: { payment },
      logTag: "recordPayment",
    });

    return this.#unwrap(body, "payment");
  }

  /**
   * @operationName Update Payment
   * @category Payments
   * @description Changes an existing payment. Only the fields you fill in are updated.
   * @route POST /update-payment
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Payment","name":"paymentId","required":true,"description":"The ID of the payment to update."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated amount received."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Updated currency."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Updated payment date."}
   * @paramDef {"type":"String","label":"Payment Method","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Check","Credit Card","Cash","Bank Transfer","PayPal","Credit","Debit","Money Order","Other"]}},"description":"Updated payment method."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated note."}
   * @returns {Object}
   * @sampleResult {"id":42,"invoiceid":987,"amount":{"amount":"1000.00","code":"USD"},"date":"2026-05-12","type":"Cash"}
   */
  async updatePayment(paymentId, amount, currency, date, type, note) {
    if (!paymentId) throw new Error('"Payment" is required.');

    const payment = cleanupObject({
      amount: toMoney(amount, currency),
      date: formatDate(date),
      type,
      note,
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`payments/payments/${paymentId}`),
      method: "put",
      body: { payment: payment || {} },
      logTag: "updatePayment",
    });

    return this.#unwrap(body, "payment");
  }

  /**
   * @operationName Delete Payment
   * @category Payments
   * @description Removes a payment record. This reopens the related invoice's balance.
   * @route POST /delete-payment
   * @appearanceColor #D64242 #E8635F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Payment","name":"paymentId","required":true,"description":"The ID of the payment to remove."}
   * @returns {Object}
   * @sampleResult {"id":"42","deleted":true}
   */
  async deletePayment(paymentId) {
    if (!paymentId) throw new Error('"Payment" is required.');

    await this.#apiRequest({
      url: this.#accountingUrl(`payments/payments/${paymentId}`),
      method: "put",
      body: { payment: { vis_state: 1 } },
      logTag: "deletePayment",
    });

    return { id: paymentId, deleted: true };
  }

  // -------------------------------- Items ---------------------------------

  /**
   * @operationName Find Items
   * @category Items
   * @description Lists your saved products and services (reusable line items).
   * @route POST /find-items
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by item name, description, or SKU."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"itemid":55,"name":"Design work","unit_cost":{"amount":"120.00","code":"USD"},"sku":"DSGN"}]
   */
  async findItems(search, maxResults) {
    const body = await this.#apiRequest({
      url: this.#accountingUrl("items/items"),
      query: {
        per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
        page: 1,
      },
      logTag: "findItems",
    });

    return searchFilter(
      this.#unwrapList(body, "items").items,
      ["name", "description", "sku"],
      search,
    );
  }

  /**
   * @operationName Get Item
   * @category Items
   * @description Retrieves one saved product or service.
   * @route POST /get-item
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"The item to retrieve."}
   * @returns {Object}
   * @sampleResult {"itemid":55,"name":"Design work","description":"Hourly design","unit_cost":{"amount":"120.00","code":"USD"},"sku":"DSGN"}
   */
  async getItem(itemId) {
    if (!itemId) throw new Error('"Item" is required.');

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`items/items/${itemId}`),
      logTag: "getItem",
    });

    return this.#unwrap(body, "item");
  }

  /**
   * @operationName Create Item
   * @category Items
   * @description Saves a reusable product or service you can drop onto invoices and estimates.
   * @route POST /create-item
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the product or service."}
   * @paramDef {"type":"Number","label":"Unit Price","name":"unitPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Default price for one unit."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Currency for the price. Defaults to your account currency."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","description":"Your internal product code, if any."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What this item is."}
   * @returns {Object}
   * @sampleResult {"itemid":55,"name":"Design work","unit_cost":{"amount":"120.00","code":"USD"},"sku":"DSGN"}
   */
  async createItem(name, unitPrice, currency, sku, description) {
    if (!name) throw new Error('"Name" is required.');

    const item = cleanupObject({
      name,
      description,
      sku,
      unit_cost:
        unitPrice === undefined || unitPrice === null || unitPrice === ""
          ? undefined
          : toMoney(unitPrice, currency),
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl("items/items"),
      method: "post",
      body: { item },
      logTag: "createItem",
    });

    return this.#unwrap(body, "item");
  }

  /**
   * @operationName Update Item
   * @category Items
   * @description Changes a saved product or service. Only the fields you fill in are updated.
   * @route POST /update-item
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"The item to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Updated name."}
   * @paramDef {"type":"Number","label":"Unit Price","name":"unitPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated unit price."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Updated currency."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","description":"Updated product code."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated description."}
   * @returns {Object}
   * @sampleResult {"itemid":55,"name":"Design work","unit_cost":{"amount":"130.00","code":"USD"}}
   */
  async updateItem(itemId, name, unitPrice, currency, sku, description) {
    if (!itemId) throw new Error('"Item" is required.');

    const item = cleanupObject({
      name,
      description,
      sku,
      unit_cost:
        unitPrice === undefined || unitPrice === null || unitPrice === ""
          ? undefined
          : toMoney(unitPrice, currency),
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`items/items/${itemId}`),
      method: "put",
      body: { item: item || {} },
      logTag: "updateItem",
    });

    return this.#unwrap(body, "item");
  }

  /**
   * @operationName Delete Item
   * @category Items
   * @description Removes a saved product or service. By default it is deleted; turn on archiving to keep a hidden copy instead.
   * @route POST /delete-item
   * @appearanceColor #D64242 #E8635F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"The item to remove."}
   * @paramDef {"type":"Boolean","label":"Archive Instead of Delete","name":"archiveInstead","uiComponent":{"type":"TOGGLE"},"description":"Keep an archived (hidden) copy instead of permanently deleting."}
   * @returns {Object}
   * @sampleResult {"id":"55","deleted":true,"archived":false}
   */
  async deleteItem(itemId, archiveInstead) {
    if (!itemId) throw new Error('"Item" is required.');

    await this.#apiRequest({
      url: this.#accountingUrl(`items/items/${itemId}`),
      method: "put",
      body: { item: { vis_state: archiveInstead ? 2 : 1 } },
      logTag: "deleteItem",
    });

    return { id: itemId, deleted: !archiveInstead, archived: !!archiveInstead };
  }

  // -------------------------------- Taxes ---------------------------------

  /**
   * @operationName Find Taxes
   * @category Taxes
   * @description Lists your saved tax rates.
   * @route POST /find-taxes
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by tax name."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"taxid":3,"name":"GST","amount":"5","number":"R123"}]
   */
  async findTaxes(search, maxResults) {
    const body = await this.#apiRequest({
      url: this.#accountingUrl("taxes/taxes"),
      query: {
        per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
        page: 1,
      },
      logTag: "findTaxes",
    });

    return searchFilter(
      this.#unwrapList(body, "taxes").items,
      ["name", "number"],
      search,
    );
  }

  /**
   * @operationName Create Tax
   * @category Taxes
   * @description Creates a reusable tax rate you can apply to invoices, estimates, and expenses.
   * @route POST /create-tax
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the tax (e.g. GST, VAT, Sales Tax)."}
   * @paramDef {"type":"Number","label":"Percentage","name":"percentage","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The tax rate as a percentage (e.g. 5 for 5%)."}
   * @paramDef {"type":"String","label":"Registration Number","name":"number","description":"Your tax registration / filing number, if any."}
   * @paramDef {"type":"Boolean","label":"Compound","name":"compound","uiComponent":{"type":"TOGGLE"},"description":"Apply this tax on top of other taxes (compound tax)."}
   * @returns {Object}
   * @sampleResult {"taxid":3,"name":"GST","amount":"5","number":"R123"}
   */
  async createTax(name, percentage, number, compound) {
    if (!name) throw new Error('"Name" is required.');

    const tax = cleanupObject({
      name,
      amount:
        percentage === undefined || percentage === null || percentage === ""
          ? undefined
          : String(percentage),
      number,
      compound: compound === undefined ? undefined : !!compound,
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl("taxes/taxes"),
      method: "post",
      body: { tax },
      logTag: "createTax",
    });

    return this.#unwrap(body, "tax");
  }

  /**
   * @operationName Update Tax
   * @category Taxes
   * @description Changes a saved tax rate. Only the fields you fill in are updated.
   * @route POST /update-tax
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Tax","name":"taxId","required":true,"description":"The ID of the tax to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Updated tax name."}
   * @paramDef {"type":"Number","label":"Percentage","name":"percentage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated rate as a percentage."}
   * @paramDef {"type":"String","label":"Registration Number","name":"number","description":"Updated registration number."}
   * @returns {Object}
   * @sampleResult {"taxid":3,"name":"GST","amount":"7"}
   */
  async updateTax(taxId, name, percentage, number) {
    if (!taxId) throw new Error('"Tax" is required.');

    const tax = cleanupObject({
      name,
      amount:
        percentage === undefined || percentage === null || percentage === ""
          ? undefined
          : String(percentage),
      number,
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`taxes/taxes/${taxId}`),
      method: "put",
      body: { tax: tax || {} },
      logTag: "updateTax",
    });

    return this.#unwrap(body, "tax");
  }

  /**
   * @operationName Delete Tax
   * @category Taxes
   * @description Permanently removes a saved tax rate.
   * @route POST /delete-tax
   * @appearanceColor #D64242 #E8635F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Tax","name":"taxId","required":true,"description":"The ID of the tax to remove."}
   * @returns {Object}
   * @sampleResult {"id":"3","deleted":true}
   */
  async deleteTax(taxId) {
    if (!taxId) throw new Error('"Tax" is required.');

    await this.#apiRequest({
      url: this.#accountingUrl(`taxes/taxes/${taxId}`),
      method: "delete",
      logTag: "deleteTax",
    });

    return { id: taxId, deleted: true };
  }

  // ----------------------------- Other Income ----------------------------

  /**
   * @operationName Find Other Income
   * @category Other Income
   * @description Lists income recorded outside of invoices (e.g. online sales, rentals).
   * @route POST /find-other-income
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"incomeid":12,"amount":{"amount":"250.00","code":"USD"},"category_name":"online_sales","date":"2026-05-10","source":"Shopify"}]
   */
  async findOtherIncome(maxResults) {
    const body = await this.#apiRequest({
      url: this.#accountingUrl("other_incomes/other_incomes"),
      query: {
        per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
        page: 1,
      },
      logTag: "findOtherIncome",
    });

    return this.#unwrapList(body, "other_incomes").items;
  }

  /**
   * @operationName Record Other Income
   * @category Other Income
   * @description Records income received outside of an invoice, such as online or in-person sales.
   * @route POST /record-other-income
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How much was received."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Currency of the amount. Defaults to your account currency."}
   * @paramDef {"type":"String","label":"Category","name":"category","uiComponent":{"type":"DROPDOWN","options":{"values":["Advertising","In-Person Sales","Online Sales","Rentals","Other"]}},"description":"What kind of income this is."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"The date the income was received. Leave blank for today."}
   * @paramDef {"type":"String","label":"Source","name":"source","description":"Where it came from (e.g. Shopify, Etsy)."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A note about this income."}
   * @returns {Object}
   * @sampleResult {"incomeid":12,"amount":{"amount":"250.00","code":"USD"},"category_name":"online_sales","date":"2026-05-10","source":"Shopify"}
   */
  async recordOtherIncome(amount, currency, category, date, source, note) {
    if (amount === undefined || amount === null || amount === "")
      throw new Error('"Amount" is required.');

    const otherIncome = cleanupObject({
      amount: toMoney(amount, currency),
      category_name: OTHER_INCOME_CATEGORY[category],
      date: formatDate(date) || formatDate(new Date().toISOString()),
      source,
      note,
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl("other_incomes/other_incomes"),
      method: "post",
      body: { other_income: otherIncome },
      logTag: "recordOtherIncome",
    });

    return this.#unwrap(body, "other_income");
  }

  /**
   * @operationName Update Other Income
   * @category Other Income
   * @description Changes a recorded other-income entry. Only the fields you fill in are updated.
   * @route POST /update-other-income
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Income","name":"incomeId","required":true,"description":"The ID of the income entry to update."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated amount received."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Updated currency."}
   * @paramDef {"type":"String","label":"Category","name":"category","uiComponent":{"type":"DROPDOWN","options":{"values":["Advertising","In-Person Sales","Online Sales","Rentals","Other"]}},"description":"Updated category."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Date of the income. Leave blank to use today."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated note."}
   * @returns {Object}
   * @sampleResult {"incomeid":12,"amount":{"amount":"300.00","code":"USD"},"category_name":"online_sales"}
   */
  async updateOtherIncome(incomeId, amount, currency, category, date, note) {
    if (!incomeId) throw new Error('"Income" is required.');

    const otherIncome = cleanupObject({
      amount: toMoney(amount, currency),
      category_name: OTHER_INCOME_CATEGORY[category],
      // FreshBooks requires a date on every other-income update.
      date: formatDate(date) || formatDate(new Date().toISOString()),
      note,
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`other_incomes/other_incomes/${incomeId}`),
      method: "put",
      body: { other_income: otherIncome || {} },
      logTag: "updateOtherIncome",
    });

    return this.#unwrap(body, "other_income");
  }

  /**
   * @operationName Delete Other Income
   * @category Other Income
   * @description Permanently removes a recorded other-income entry.
   * @route POST /delete-other-income
   * @appearanceColor #D64242 #E8635F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Income","name":"incomeId","required":true,"description":"The ID of the income entry to remove."}
   * @returns {Object}
   * @sampleResult {"id":"12","deleted":true}
   */
  async deleteOtherIncome(incomeId) {
    if (!incomeId) throw new Error('"Income" is required.');

    await this.#apiRequest({
      url: this.#accountingUrl(`other_incomes/other_incomes/${incomeId}`),
      method: "delete",
      logTag: "deleteOtherIncome",
    });

    return { id: incomeId, deleted: true };
  }

  // -------------------------------- Tasks ---------------------------------

  /**
   * @operationName Find Tasks
   * @category Tasks
   * @description Lists your saved billable tasks (reusable services with a rate).
   * @route POST /find-tasks
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by task name."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"taskid":8,"name":"Consulting","rate":{"amount":"150.00","code":"USD"},"billable":true}]
   */
  async findTasks(search, maxResults) {
    const body = await this.#apiRequest({
      url: this.#accountingUrl("projects/tasks"),
      query: {
        per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
        page: 1,
      },
      logTag: "findTasks",
    });

    return searchFilter(
      this.#unwrapList(body, "tasks").items,
      ["name", "description"],
      search,
    );
  }

  /**
   * @operationName Create Task
   * @category Tasks
   * @description Creates a reusable billable task with a default hourly rate.
   * @route POST /create-task
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the task."}
   * @paramDef {"type":"Number","label":"Hourly Rate","name":"rate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Default hourly rate for this task."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Currency for the rate. Defaults to your account currency."}
   * @paramDef {"type":"Boolean","label":"Billable","name":"billable","uiComponent":{"type":"TOGGLE"},"description":"Whether time on this task can be billed to clients."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What this task involves."}
   * @returns {Object}
   * @sampleResult {"taskid":8,"name":"Consulting","rate":{"amount":"150.00","code":"USD"},"billable":true}
   */
  async createTask(name, rate, currency, billable, description) {
    if (!name) throw new Error('"Name" is required.');

    const task = cleanupObject({
      name,
      description,
      rate:
        rate === undefined || rate === null || rate === ""
          ? undefined
          : toMoney(rate, currency),
      billable: billable === undefined ? undefined : !!billable,
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl("projects/tasks"),
      method: "post",
      body: { task },
      logTag: "createTask",
    });

    return this.#unwrap(body, "task");
  }

  /**
   * @operationName Update Task
   * @category Tasks
   * @description Changes a saved task. Only the fields you fill in are updated.
   * @route POST /update-task
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"description":"The ID of the task to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Updated task name."}
   * @paramDef {"type":"Number","label":"Hourly Rate","name":"rate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated hourly rate."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Updated currency."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated description."}
   * @returns {Object}
   * @sampleResult {"taskid":8,"name":"Consulting","rate":{"amount":"160.00","code":"USD"}}
   */
  async updateTask(taskId, name, rate, currency, description) {
    if (!taskId) throw new Error('"Task" is required.');

    const task = cleanupObject({
      name,
      description,
      rate:
        rate === undefined || rate === null || rate === ""
          ? undefined
          : toMoney(rate, currency),
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`projects/tasks/${taskId}`),
      method: "put",
      body: { task: task || {} },
      logTag: "updateTask",
    });

    return this.#unwrap(body, "task");
  }

  /**
   * @operationName Delete Task
   * @category Tasks
   * @description Removes a saved task. By default it is deleted; turn on archiving to keep a hidden copy instead.
   * @route POST /delete-task
   * @appearanceColor #D64242 #E8635F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"description":"The ID of the task to remove."}
   * @paramDef {"type":"Boolean","label":"Archive Instead of Delete","name":"archiveInstead","uiComponent":{"type":"TOGGLE"},"description":"Keep an archived (hidden) copy instead of permanently deleting."}
   * @returns {Object}
   * @sampleResult {"id":"8","deleted":true,"archived":false}
   */
  async deleteTask(taskId, archiveInstead) {
    if (!taskId) throw new Error('"Task" is required.');

    await this.#apiRequest({
      url: this.#accountingUrl(`projects/tasks/${taskId}`),
      method: "put",
      body: { task: { vis_state: archiveInstead ? 2 : 1 } },
      logTag: "deleteTask",
    });

    return { id: taskId, deleted: !archiveInstead, archived: !!archiveInstead };
  }

  // ----------------------------- Credit Notes -----------------------------

  /**
   * @operationName Find Credit Notes
   * @category Credit Notes
   * @description Lists credit notes (credits issued to clients), optionally filtered by client.
   * @route POST /find-credit-notes
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Client","name":"clientId","dictionary":"getClientsDictionary","description":"Only show credit notes for this client."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"creditid":7,"clientid":2280,"amount":{"amount":"50.00","code":"USD"},"credit_number":"CN-0001"}]
   */
  async findCreditNotes(clientId, maxResults) {
    const query = {
      per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
      page: 1,
    };

    if (clientId) query["search[clientid]"] = clientId;

    const body = await this.#apiRequest({
      url: this.#accountingUrl("credit_notes/credit_notes"),
      query,
      logTag: "findCreditNotes",
    });

    return this.#unwrapList(body, "credit_notes").items;
  }

  /**
   * @operationName Get Credit Note
   * @category Credit Notes
   * @description Retrieves one credit note in full.
   * @route POST /get-credit-note
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Credit Note","name":"creditNoteId","required":true,"description":"The ID of the credit note to retrieve."}
   * @returns {Object}
   * @sampleResult {"creditid":7,"clientid":2280,"amount":{"amount":"50.00","code":"USD"},"credit_number":"CN-0001","lines":[{"name":"Refund","unit_cost":{"amount":"50.00","code":"USD"}}]}
   */
  async getCreditNote(creditNoteId) {
    if (!creditNoteId) throw new Error('"Credit Note" is required.');

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`credit_notes/credit_notes/${creditNoteId}`),
      query: { "include[]": "lines" },
      logTag: "getCreditNote",
    });

    return this.#unwrap(body, "credit_note");
  }

  /**
   * @operationName Create Credit Note
   * @category Credit Notes
   * @description Issues a credit note to a client (a credit they can apply to future invoices).
   * @route POST /create-credit-note
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"The client to credit."}
   * @paramDef {"type":"Array.<LineItem>","label":"Line Items","name":"lineItems","required":true,"description":"What the credit is for. Add a row for each item."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"The date of the credit note. Leave blank for today."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Currency for the credit. Defaults to your account currency."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes shown on the credit note."}
   * @returns {Object}
   * @sampleResult {"creditid":7,"clientid":2280,"amount":{"amount":"50.00","code":"USD"},"credit_number":"CN-0001"}
   */
  async createCreditNote(clientId, lineItems, date, currency, notes) {
    if (!clientId) throw new Error('"Client" is required.');

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" is required — add at least one item.');
    }

    const creditNote = cleanupObject({
      clientid: clientId,
      create_date: formatDate(date),
      currency_code: currency,
      notes,
      lines: await this.#mapLineItems(lineItems, currency),
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl("credit_notes/credit_notes"),
      method: "post",
      body: { credit_note: creditNote },
      logTag: "createCreditNote",
    });

    return this.#unwrap(body, "credit_note");
  }

  /**
   * @operationName Update Credit Note
   * @category Credit Notes
   * @description Changes a credit note. Only the fields you fill in are updated. Providing line items replaces all existing ones.
   * @route POST /update-credit-note
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Credit Note","name":"creditNoteId","required":true,"description":"The ID of the credit note to update."}
   * @paramDef {"type":"Array.<LineItem>","label":"Line Items","name":"lineItems","description":"Replacement line items. Leave blank to keep existing ones."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Updated currency."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated notes."}
   * @returns {Object}
   * @sampleResult {"creditid":7,"amount":{"amount":"60.00","code":"USD"},"credit_number":"CN-0001"}
   */
  async updateCreditNote(creditNoteId, lineItems, currency, notes) {
    if (!creditNoteId) throw new Error('"Credit Note" is required.');

    const creditNote = cleanupObject({
      currency_code: currency,
      notes,
      lines: await this.#mapLineItems(lineItems, currency),
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`credit_notes/credit_notes/${creditNoteId}`),
      method: "put",
      body: { credit_note: creditNote || {} },
      logTag: "updateCreditNote",
    });

    return this.#unwrap(body, "credit_note");
  }

  /**
   * @operationName Delete Credit Note
   * @category Credit Notes
   * @description Removes a credit note. By default it is deleted; turn on archiving to keep a hidden copy instead.
   * @route POST /delete-credit-note
   * @appearanceColor #D64242 #E8635F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Credit Note","name":"creditNoteId","required":true,"description":"The ID of the credit note to remove."}
   * @paramDef {"type":"Boolean","label":"Archive Instead of Delete","name":"archiveInstead","uiComponent":{"type":"TOGGLE"},"description":"Keep an archived (hidden) copy instead of permanently deleting."}
   * @returns {Object}
   * @sampleResult {"id":"7","deleted":true,"archived":false}
   */
  async deleteCreditNote(creditNoteId, archiveInstead) {
    if (!creditNoteId) throw new Error('"Credit Note" is required.');

    await this.#apiRequest({
      url: this.#accountingUrl(`credit_notes/credit_notes/${creditNoteId}`),
      method: "put",
      body: { credit_note: { vis_state: archiveInstead ? 2 : 1 } },
      logTag: "deleteCreditNote",
    });

    return {
      id: creditNoteId,
      deleted: !archiveInstead,
      archived: !!archiveInstead,
    };
  }

  // -------------------------- Recurring Invoices --------------------------

  /**
   * @operationName Find Recurring Invoices
   * @category Recurring Invoices
   * @description Lists recurring invoice profiles (invoices that send automatically on a schedule).
   * @route POST /find-recurring-invoices
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Client","name":"clientId","dictionary":"getClientsDictionary","description":"Only show recurring invoices for this client."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"id":4,"customerid":2280,"frequency":"m","amount":{"amount":"99.00","code":"USD"}}]
   */
  async findRecurringInvoices(clientId, maxResults) {
    const query = {
      per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
      page: 1,
    };

    if (clientId) query["search[customerid]"] = clientId;

    const body = await this.#apiRequest({
      url: this.#accountingUrl("invoice_profiles/invoice_profiles"),
      query,
      logTag: "findRecurringInvoices",
    });

    return this.#unwrapList(body, "invoice_profiles").items;
  }

  /**
   * @operationName Get Recurring Invoice
   * @category Recurring Invoices
   * @description Retrieves one recurring invoice profile in full.
   * @route POST /get-recurring-invoice
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Recurring Invoice","name":"profileId","required":true,"description":"The ID of the recurring invoice profile to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":4,"customerid":2280,"frequency":"m","amount":{"amount":"99.00","code":"USD"},"lines":[{"name":"Subscription","unit_cost":{"amount":"99.00","code":"USD"}}]}
   */
  async getRecurringInvoice(profileId) {
    if (!profileId) throw new Error('"Recurring Invoice" is required.');

    const body = await this.#apiRequest({
      url: this.#accountingUrl(
        `invoice_profiles/invoice_profiles/${profileId}`,
      ),
      query: { "include[]": "lines" },
      logTag: "getRecurringInvoice",
    });

    return this.#unwrap(body, "invoice_profile");
  }

  /**
   * @operationName Create Recurring Invoice
   * @category Recurring Invoices
   * @description Sets up an invoice that is created and sent automatically on a repeating schedule.
   * @route POST /create-recurring-invoice
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"The client to bill on a schedule."}
   * @paramDef {"type":"Array.<LineItem>","label":"Line Items","name":"lineItems","required":true,"description":"What to bill each time. Add a row for each item."}
   * @paramDef {"type":"String","label":"Repeats","name":"frequency","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Weekly","Every 2 Weeks","Monthly","Every 3 Months","Every 6 Months","Yearly"]}},"description":"How often the invoice is generated."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"When the first invoice goes out. Leave blank for today."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Currency for the invoice. Defaults to your account currency."}
   * @paramDef {"type":"Number","label":"Number of Times","name":"occurrences","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many invoices to send in total. Leave blank or 0 for unlimited."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes shown on each invoice."}
   * @returns {Object}
   * @sampleResult {"id":4,"customerid":2280,"frequency":"m","amount":{"amount":"99.00","code":"USD"}}
   */
  async createRecurringInvoice(
    clientId,
    lineItems,
    frequency,
    startDate,
    currency,
    occurrences,
    notes,
  ) {
    if (!clientId) throw new Error('"Client" is required.');

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" is required — add at least one item.');
    }

    const profile = cleanupObject({
      customerid: clientId,
      create_date:
        formatDate(startDate) || formatDate(new Date().toISOString()),
      frequency: RECURRING_FREQUENCY[frequency],
      currency_code: currency,
      numberRecurring:
        occurrences === undefined || occurrences === null || occurrences === ""
          ? undefined
          : Number(occurrences),
      notes,
      lines: await this.#mapLineItems(lineItems, currency),
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl("invoice_profiles/invoice_profiles"),
      method: "post",
      body: { invoice_profile: profile },
      logTag: "createRecurringInvoice",
    });

    return this.#unwrap(body, "invoice_profile");
  }

  /**
   * @operationName Update Recurring Invoice
   * @category Recurring Invoices
   * @description Changes a recurring invoice profile. Only the fields you fill in are updated.
   * @route POST /update-recurring-invoice
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Recurring Invoice","name":"profileId","required":true,"description":"The ID of the recurring invoice profile to update."}
   * @paramDef {"type":"Array.<LineItem>","label":"Line Items","name":"lineItems","description":"Replacement line items. Leave blank to keep existing ones."}
   * @paramDef {"type":"String","label":"Repeats","name":"frequency","uiComponent":{"type":"DROPDOWN","options":{"values":["Weekly","Every 2 Weeks","Monthly","Every 3 Months","Every 6 Months","Yearly"]}},"description":"Updated schedule."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Updated currency."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated notes."}
   * @returns {Object}
   * @sampleResult {"id":4,"frequency":"3m","amount":{"amount":"99.00","code":"USD"}}
   */
  async updateRecurringInvoice(
    profileId,
    lineItems,
    frequency,
    currency,
    notes,
  ) {
    if (!profileId) throw new Error('"Recurring Invoice" is required.');

    const profile = cleanupObject({
      frequency: RECURRING_FREQUENCY[frequency],
      currency_code: currency,
      notes,
      lines: await this.#mapLineItems(lineItems, currency),
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl(
        `invoice_profiles/invoice_profiles/${profileId}`,
      ),
      method: "put",
      body: { invoice_profile: profile || {} },
      logTag: "updateRecurringInvoice",
    });

    return this.#unwrap(body, "invoice_profile");
  }

  /**
   * @operationName Delete Recurring Invoice
   * @category Recurring Invoices
   * @description Stops and removes a recurring invoice profile. By default it is deleted; turn on archiving to keep a hidden copy instead.
   * @route POST /delete-recurring-invoice
   * @appearanceColor #D64242 #E8635F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Recurring Invoice","name":"profileId","required":true,"description":"The ID of the recurring invoice profile to remove."}
   * @paramDef {"type":"Boolean","label":"Archive Instead of Delete","name":"archiveInstead","uiComponent":{"type":"TOGGLE"},"description":"Keep an archived (hidden) copy instead of permanently deleting."}
   * @returns {Object}
   * @sampleResult {"id":"4","deleted":true,"archived":false}
   */
  async deleteRecurringInvoice(profileId, archiveInstead) {
    if (!profileId) throw new Error('"Recurring Invoice" is required.');

    await this.#apiRequest({
      url: this.#accountingUrl(
        `invoice_profiles/invoice_profiles/${profileId}`,
      ),
      method: "put",
      body: { invoice_profile: { vis_state: archiveInstead ? 2 : 1 } },
      logTag: "deleteRecurringInvoice",
    });

    return {
      id: profileId,
      deleted: !archiveInstead,
      archived: !!archiveInstead,
    };
  }

  // -------------------------------- Vendors -------------------------------

  /**
   * @operationName Find Vendors
   * @category Vendors
   * @description Lists your vendors (suppliers you buy from and record bills for).
   * @route POST /find-vendors
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by vendor name or email."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"vendorid":1562,"vendor_name":"Office Supplies Co","primary_contact_email":"orders@supplies.co"}]
   */
  async findVendors(search, maxResults) {
    const body = await this.#apiRequest({
      url: this.#accountingUrl("bill_vendors/bill_vendors"),
      query: {
        per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
        page: 1,
      },
      logTag: "findVendors",
    });

    return searchFilter(
      this.#unwrapList(body, "bill_vendors").items,
      ["vendor_name", "primary_contact_email", "account_number"],
      search,
    );
  }

  /**
   * @operationName Create Vendor
   * @category Vendors
   * @description Adds a vendor (supplier) you can record bills against.
   * @route POST /create-vendor
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Vendor Name","name":"vendorName","required":true,"description":"The vendor's business name."}
   * @paramDef {"type":"String","label":"Contact First Name","name":"contactFirstName","description":"First name of your main contact."}
   * @paramDef {"type":"String","label":"Contact Last Name","name":"contactLastName","description":"Last name of your main contact."}
   * @paramDef {"type":"String","label":"Contact Email","name":"contactEmail","description":"Email of your main contact."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Vendor phone number."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Currency you pay this vendor in."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"City."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Country."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes about this vendor."}
   * @returns {Object}
   * @sampleResult {"vendorid":1562,"vendor_name":"Office Supplies Co","primary_contact_email":"orders@supplies.co"}
   */
  async createVendor(
    vendorName,
    contactFirstName,
    contactLastName,
    contactEmail,
    phone,
    currency,
    city,
    country,
    notes,
  ) {
    if (!vendorName) throw new Error('"Vendor Name" is required.');

    const vendor = cleanupObject({
      vendor_name: vendorName,
      primary_contact_first_name: contactFirstName,
      primary_contact_last_name: contactLastName,
      primary_contact_email: contactEmail,
      phone,
      currency_code: currency,
      language: "en", // FreshBooks rejects an empty language on vendor create.
      city,
      country,
      note: notes,
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl("bill_vendors/bill_vendors"),
      method: "post",
      body: { bill_vendor: vendor },
      logTag: "createVendor",
    });

    return this.#unwrap(body, "bill_vendor");
  }

  /**
   * @operationName Update Vendor
   * @category Vendors
   * @description Changes a vendor's details. Only the fields you fill in are updated.
   * @route POST /update-vendor
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"getVendorsDictionary","description":"The vendor to update."}
   * @paramDef {"type":"String","label":"Vendor Name","name":"vendorName","description":"Updated vendor name."}
   * @paramDef {"type":"String","label":"Contact Email","name":"contactEmail","description":"Updated contact email."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Updated phone number."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Updated currency."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated notes."}
   * @returns {Object}
   * @sampleResult {"vendorid":1562,"vendor_name":"Office Supplies Co"}
   */
  async updateVendor(
    vendorId,
    vendorName,
    contactEmail,
    phone,
    currency,
    notes,
  ) {
    if (!vendorId) throw new Error('"Vendor" is required.');

    const vendor = cleanupObject({
      vendor_name: vendorName,
      primary_contact_email: contactEmail,
      phone,
      currency_code: currency,
      note: notes,
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`bill_vendors/bill_vendors/${vendorId}`),
      method: "put",
      body: { bill_vendor: vendor || {} },
      logTag: "updateVendor",
    });

    return this.#unwrap(body, "bill_vendor");
  }

  /**
   * @operationName Delete Vendor
   * @category Vendors
   * @description Removes a vendor. By default it is deleted; turn on archiving to keep a hidden copy instead.
   * @route POST /delete-vendor
   * @appearanceColor #D64242 #E8635F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"getVendorsDictionary","description":"The vendor to remove."}
   * @paramDef {"type":"Boolean","label":"Archive Instead of Delete","name":"archiveInstead","uiComponent":{"type":"TOGGLE"},"description":"Keep an archived (hidden) copy instead of permanently deleting."}
   * @returns {Object}
   * @sampleResult {"id":"1562","deleted":true,"archived":false}
   */
  async deleteVendor(vendorId, archiveInstead) {
    if (!vendorId) throw new Error('"Vendor" is required.');

    await this.#apiRequest({
      url: this.#accountingUrl(`bill_vendors/bill_vendors/${vendorId}`),
      method: "put",
      body: { bill_vendor: { vis_state: archiveInstead ? 2 : 1 } },
      logTag: "deleteVendor",
    });

    return {
      id: vendorId,
      deleted: !archiveInstead,
      archived: !!archiveInstead,
    };
  }

  // --------------------------------- Bills --------------------------------

  /**
   * @typedef {Object} BillLine
   * @property {String} category - The expense category id for this line (use the Get Expense Categories picker).
   * @property {String} description - What the line is for.
   * @property {Number} quantity - How many units.
   * @property {Number} unitPrice - Cost per unit.
   * @property {String} [taxName] - Optional tax name.
   * @property {Number} [taxPercent] - Optional tax percentage.
   */

  async #mapBillLines(billLines, currency) {
    if (!Array.isArray(billLines) || billLines.length === 0) return undefined;

    return billLines.map((li) => {
      const price = li.unitPrice ?? li.unit_cost;

      return cleanupObject({
        categoryid: li.category || li.categoryid,
        description: li.description,
        quantity: li.quantity ?? li.qty,
        unit_cost: currency
          ? { amount: String(price ?? 0), code: currency }
          : { amount: String(price ?? 0) },
        tax_name1: li.taxName,
        tax_percent1: li.taxPercent,
      });
    });
  }

  /**
   * @operationName Find Bills
   * @category Bills
   * @description Lists bills you owe to vendors, optionally filtered by vendor.
   * @route POST /find-bills
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","dictionary":"getVendorsDictionary","description":"Only show bills from this vendor."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"id":33,"vendorid":1562,"amount":{"amount":"600.00","code":"USD"},"status":"unpaid","due_date":"2026-06-16"}]
   */
  async findBills(vendorId, maxResults) {
    const query = {
      per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
      page: 1,
    };

    if (vendorId) query["search[vendorid]"] = vendorId;

    const body = await this.#apiRequest({
      url: this.#accountingUrl("bills/bills"),
      query,
      logTag: "findBills",
    });

    return this.#unwrapList(body, "bills").items;
  }

  /**
   * @operationName Get Bill
   * @category Bills
   * @description Retrieves one bill in full, including its line items.
   * @route POST /get-bill
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"description":"The ID of the bill to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":33,"vendorid":1562,"amount":{"amount":"600.00","code":"USD"},"status":"unpaid","lines":[{"description":"Supplies","unit_cost":{"amount":"600.00","code":"USD"}}]}
   */
  async getBill(billId) {
    if (!billId) throw new Error('"Bill" is required.');

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`bills/bills/${billId}`),
      logTag: "getBill",
    });

    return this.#unwrap(body, "bill");
  }

  /**
   * @operationName Create Bill
   * @category Bills
   * @description Records a bill you owe to a vendor (accounts payable).
   * @route POST /create-bill
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"getVendorsDictionary","description":"The vendor this bill is from."}
   * @paramDef {"type":"Array.<BillLine>","label":"Line Items","name":"billLines","required":true,"description":"What's on the bill. Each line needs an expense category. Add a row for each item."}
   * @paramDef {"type":"String","label":"Issue Date","name":"issueDate","uiComponent":{"type":"DATE_PICKER"},"description":"The date on the bill. Leave blank for today."}
   * @paramDef {"type":"Number","label":"Due In (days)","name":"dueInDays","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many days until payment is due."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Currency of the bill. Defaults to your account currency."}
   * @returns {Object}
   * @sampleResult {"id":33,"vendorid":1562,"amount":{"amount":"600.00","code":"USD"},"status":"unpaid"}
   */
  async createBill(vendorId, billLines, issueDate, dueInDays, currency) {
    if (!vendorId) throw new Error('"Vendor" is required.');

    if (!Array.isArray(billLines) || billLines.length === 0) {
      throw new Error('"Line Items" is required — add at least one line.');
    }

    const bill = cleanupObject({
      vendorid: vendorId,
      issue_date: formatDate(issueDate) || formatDate(new Date().toISOString()),
      due_offset_days:
        dueInDays === undefined || dueInDays === null || dueInDays === ""
          ? undefined
          : Number(dueInDays),
      currency_code: currency,
      language: "en", // FreshBooks rejects an empty language on bill create.
      lines: await this.#mapBillLines(billLines, currency),
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl("bills/bills"),
      method: "post",
      body: { bill },
      logTag: "createBill",
    });

    return this.#unwrap(body, "bill");
  }

  /**
   * @operationName Update Bill
   * @category Bills
   * @description Changes a bill. Only the fields you fill in are updated. Providing line items replaces all existing ones.
   * @route POST /update-bill
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"description":"The ID of the bill to update."}
   * @paramDef {"type":"Array.<BillLine>","label":"Line Items","name":"billLines","description":"Replacement line items. Leave blank to keep existing ones."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Updated currency."}
   * @returns {Object}
   * @sampleResult {"id":33,"vendorid":1562,"amount":{"amount":"650.00","code":"USD"},"status":"unpaid"}
   */
  async updateBill(billId, billLines, currency) {
    if (!billId) throw new Error('"Bill" is required.');

    const bill = cleanupObject({
      currency_code: currency,
      lines: await this.#mapBillLines(billLines, currency),
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`bills/bills/${billId}`),
      method: "put",
      body: { bill: bill || {} },
      logTag: "updateBill",
    });

    return this.#unwrap(body, "bill");
  }

  /**
   * @operationName Delete Bill
   * @category Bills
   * @description Removes a bill. By default it is deleted; turn on archiving to keep a hidden copy instead.
   * @route POST /delete-bill
   * @appearanceColor #D64242 #E8635F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"description":"The ID of the bill to remove."}
   * @paramDef {"type":"Boolean","label":"Archive Instead of Delete","name":"archiveInstead","uiComponent":{"type":"TOGGLE"},"description":"Keep an archived (hidden) copy instead of permanently deleting."}
   * @returns {Object}
   * @sampleResult {"id":"33","deleted":true,"archived":false}
   */
  async deleteBill(billId, archiveInstead) {
    if (!billId) throw new Error('"Bill" is required.');

    await this.#apiRequest({
      url: this.#accountingUrl(`bills/bills/${billId}`),
      method: "put",
      body: { bill: { vis_state: archiveInstead ? 2 : 1 } },
      logTag: "deleteBill",
    });

    return { id: billId, deleted: !archiveInstead, archived: !!archiveInstead };
  }

  // ----------------------------- Bill Payments ----------------------------

  /**
   * @operationName Find Bill Payments
   * @category Bill Payments
   * @description Lists payments you've made against vendor bills.
   * @route POST /find-bill-payments
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"id":9,"billid":33,"amount":{"amount":"600.00","code":"USD"},"payment_type":"Check","paid_date":"2026-06-10"}]
   */
  async findBillPayments(maxResults) {
    const body = await this.#apiRequest({
      url: this.#accountingUrl("bill_payments/bill_payments"),
      query: {
        per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
        page: 1,
      },
      logTag: "findBillPayments",
    });

    return this.#unwrapList(body, "bill_payments").items;
  }

  /**
   * @operationName Record Bill Payment
   * @category Bill Payments
   * @description Records a payment you made against a vendor bill.
   * @route POST /record-bill-payment
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"description":"The ID of the bill being paid."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How much was paid."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Currency of the payment. Defaults to your account currency."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"The date you paid. Leave blank for today."}
   * @paramDef {"type":"String","label":"Payment Method","name":"paymentType","uiComponent":{"type":"DROPDOWN","options":{"values":["Check","Credit Card","Cash","Bank Transfer","PayPal","Credit","Debit","Money Order","Other"]}},"description":"How you paid."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A note about this payment."}
   * @returns {Object}
   * @sampleResult {"id":9,"billid":33,"amount":{"amount":"600.00","code":"USD"},"payment_type":"Check"}
   */
  async recordBillPayment(billId, amount, currency, date, paymentType, note) {
    if (!billId) throw new Error('"Bill" is required.');
    if (amount === undefined || amount === null || amount === "")
      throw new Error('"Amount" is required.');

    const billPayment = cleanupObject({
      billid: billId,
      amount: toMoney(amount, currency),
      paid_date: formatDate(date) || formatDate(new Date().toISOString()),
      payment_type: paymentType,
      note,
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl("bill_payments/bill_payments"),
      method: "post",
      body: { bill_payment: billPayment },
      logTag: "recordBillPayment",
    });

    return this.#unwrap(body, "bill_payment");
  }

  /**
   * @operationName Update Bill Payment
   * @category Bill Payments
   * @description Changes a recorded bill payment. Only the fields you fill in are updated.
   * @route POST /update-bill-payment
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Bill Payment","name":"billPaymentId","required":true,"description":"The ID of the bill payment to update."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated amount paid."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Updated currency."}
   * @paramDef {"type":"String","label":"Payment Method","name":"paymentType","uiComponent":{"type":"DROPDOWN","options":{"values":["Check","Credit Card","Cash","Bank Transfer","PayPal","Credit","Debit","Money Order","Other"]}},"description":"Updated payment method."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated note."}
   * @returns {Object}
   * @sampleResult {"id":9,"billid":33,"amount":{"amount":"300.00","code":"USD"},"payment_type":"Cash"}
   */
  async updateBillPayment(billPaymentId, amount, currency, paymentType, note) {
    if (!billPaymentId) throw new Error('"Bill Payment" is required.');

    const billPayment = cleanupObject({
      amount: toMoney(amount, currency),
      payment_type: paymentType,
      note,
    });

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`bill_payments/bill_payments/${billPaymentId}`),
      method: "put",
      body: { bill_payment: billPayment || {} },
      logTag: "updateBillPayment",
    });

    return this.#unwrap(body, "bill_payment");
  }

  /**
   * @operationName Delete Bill Payment
   * @category Bill Payments
   * @description Removes a recorded bill payment. This reopens the bill's balance.
   * @route POST /delete-bill-payment
   * @appearanceColor #D64242 #E8635F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Bill Payment","name":"billPaymentId","required":true,"description":"The ID of the bill payment to remove."}
   * @returns {Object}
   * @sampleResult {"id":"9","deleted":true}
   */
  async deleteBillPayment(billPaymentId) {
    if (!billPaymentId) throw new Error('"Bill Payment" is required.');

    await this.#apiRequest({
      url: this.#accountingUrl(`bill_payments/bill_payments/${billPaymentId}`),
      method: "put",
      body: { bill_payment: { vis_state: 1 } },
      logTag: "deleteBillPayment",
    });

    return { id: billPaymentId, deleted: true };
  }

  // ---------------------------- Reports & Account -------------------------

  /**
   * @operationName Get Financial Report
   * @category Reports
   * @description Pulls a financial report for a date range — profit & loss, tax summary, aging, and more.
   * @route POST /get-financial-report
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 180
   * @paramDef {"type":"String","label":"Report","name":"report","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Profit & Loss","Tax Summary","Accounts Aging","Invoice Details","Payments Collected","Expense Summary"]}},"description":"Which report to run."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Start of the reporting period."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"End of the reporting period."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Currency to report in. Defaults to your account currency."}
   * @returns {Object}
   * @sampleResult {"profitloss":{"currency_code":"USD","start_date":"2026-01-01","end_date":"2026-05-31","total_income":{"amount":"12000.00"}}}
   */
  async getFinancialReport(report, fromDate, toDate, currency) {
    const slug = REPORT_SLUGS[report];

    if (!slug) throw new Error("Please choose a valid report.");

    const body = await this.#apiRequest({
      url: this.#accountingUrl(`reports/accounting/${slug}`),
      query: cleanupObject({
        start_date: formatDate(fromDate),
        end_date: formatDate(toDate),
        currency_code: currency,
      }),
      logTag: `getFinancialReport:${slug}`,
    });

    return body?.response?.result || body;
  }

  /**
   * @operationName Get Account Info
   * @category Account
   * @description Returns details about the connected FreshBooks business — name, identifiers, and address.
   * @route POST /get-account-info
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @returns {Object}
   * @sampleResult {"businessName":"My Company","accountId":"ZykWor","businessId":14691043,"email":"owner@example.com"}
   */
  async getAccountInfo() {
    const identity = await this.#me();
    const accountId = this.#getAccountId();

    const memberships = identity?.business_memberships || [];
    const membership =
      memberships.find((m) => m?.business?.account_id === accountId) ||
      memberships[0];
    const business = membership?.business || {};

    return cleanupObject({
      businessName: business.name,
      accountId: business.account_id || accountId,
      businessId: business.id,
      email: identity?.email,
      ownerName: [identity?.first_name, identity?.last_name]
        .filter(Boolean)
        .join(" "),
      address: business.address,
      role: membership?.role,
    });
  }

  // ------------------------------- Projects -------------------------------
  // Projects, Time Tracking and Services live under the business_id root and return
  // their objects directly (no response.result envelope).

  /**
   * @operationName Find Projects
   * @category Projects
   * @description Lists your projects, optionally filtered by a search term.
   * @route POST /find-projects
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by project title or description."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"id":153125,"title":"Website Redesign","client_id":2280,"project_type":"fixed_price","fixed_price":"5000"}]
   */
  async findProjects(search, maxResults) {
    const body = await this.#apiRequest({
      url: this.#projectsUrl("projects"),
      query: {
        per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
        page: 1,
      },
      logTag: "findProjects",
    });

    return searchFilter(body?.projects || [], ["title", "description"], search);
  }

  /**
   * @operationName Get Project
   * @category Projects
   * @description Retrieves one project in full.
   * @route POST /get-project
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":153125,"title":"Website Redesign","client_id":2280,"project_type":"fixed_price","fixed_price":"5000","logged_duration":7200}
   */
  async getProject(projectId) {
    if (!projectId) throw new Error('"Project" is required.');

    const body = await this.#apiRequest({
      url: this.#projectsUrl(`project/${projectId}`),
      logTag: "getProject",
    });

    return body?.project;
  }

  /**
   * @operationName Create Project
   * @category Projects
   * @description Creates a project for a client, billed either as a flat price or by the hour.
   * @route POST /create-project
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Name of the project."}
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"The client this project is for."}
   * @paramDef {"type":"String","label":"Billing Type","name":"billingType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Fixed Price","Hourly Rate"]}},"description":"Charge a single flat price, or bill by the hour."}
   * @paramDef {"type":"Number","label":"Price or Hourly Rate","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The flat price (for Fixed Price) or the hourly rate (for Hourly Rate)."}
   * @paramDef {"type":"Number","label":"Budget (hours)","name":"budgetHours","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional time budget for the project, in hours."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Target completion date."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What the project is about."}
   * @returns {Object}
   * @sampleResult {"id":153125,"title":"Website Redesign","client_id":2280,"project_type":"fixed_price","fixed_price":"5000"}
   */
  async createProject(
    title,
    clientId,
    billingType,
    amount,
    budgetHours,
    dueDate,
    description,
  ) {
    if (!title) throw new Error('"Title" is required.');
    if (!clientId) throw new Error('"Client" is required.');

    const hourly = billingType === "Hourly Rate";
    const hasAmount = amount !== undefined && amount !== null && amount !== "";

    const project = cleanupObject({
      title,
      client_id: Number(clientId),
      project_type: hourly ? "hourly_rate" : "fixed_price",
      fixed_price: !hourly && hasAmount ? String(amount) : undefined,
      rate: hourly && hasAmount ? String(amount) : undefined,
      budget:
        budgetHours === undefined || budgetHours === null || budgetHours === ""
          ? undefined
          : Math.round(Number(budgetHours) * 60),
      due_date: formatDate(dueDate),
      description,
    });

    const body = await this.#apiRequest({
      url: this.#projectsUrl("project"),
      method: "post",
      body: { project },
      logTag: "createProject",
    });

    return body?.project;
  }

  /**
   * @operationName Update Project
   * @category Projects
   * @description Changes an existing project. Only the fields you fill in are updated.
   * @route POST /update-project
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Updated project name."}
   * @paramDef {"type":"Number","label":"Price or Hourly Rate","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated flat price or hourly rate (matches the project's billing type)."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Updated target completion date."}
   * @paramDef {"type":"Boolean","label":"Mark Complete","name":"complete","uiComponent":{"type":"TOGGLE"},"description":"Mark the project as finished."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated description."}
   * @returns {Object}
   * @sampleResult {"id":153125,"title":"Website Redesign v2","complete":false}
   */
  async updateProject(
    projectId,
    title,
    amount,
    dueDate,
    complete,
    description,
  ) {
    if (!projectId) throw new Error('"Project" is required.');

    const hasAmount = amount !== undefined && amount !== null && amount !== "";

    const project = cleanupObject({
      title,
      // Sent under both keys; FreshBooks applies the one matching the project's billing type.
      fixed_price: hasAmount ? String(amount) : undefined,
      due_date: formatDate(dueDate),
      complete: complete === undefined ? undefined : !!complete,
      description,
    });

    const body = await this.#apiRequest({
      url: this.#projectsUrl(`project/${projectId}`),
      method: "put",
      body: { project: project || {} },
      logTag: "updateProject",
    });

    return body?.project;
  }

  /**
   * @operationName Delete Project
   * @category Projects
   * @description Permanently removes a project.
   * @route POST /delete-project
   * @appearanceColor #D64242 #E8635F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project to remove."}
   * @returns {Object}
   * @sampleResult {"id":"153125","deleted":true}
   */
  async deleteProject(projectId) {
    if (!projectId) throw new Error('"Project" is required.');

    await this.#apiRequest({
      url: this.#projectsUrl(`project/${projectId}`),
      method: "delete",
      logTag: "deleteProject",
    });

    return { id: projectId, deleted: true };
  }

  // ----------------------------- Time Tracking ----------------------------

  /**
   * @operationName Find Time Entries
   * @category Time Tracking
   * @description Lists logged time, optionally filtered by client, project, and date range.
   * @route POST /find-time-entries
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Client","name":"clientId","dictionary":"getClientsDictionary","description":"Only show time for this client."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","dictionary":"getProjectsDictionary","description":"Only show time for this project."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only show time logged on or after this day."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only show time logged on or before this day."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"id":5095,"duration":7200,"note":"Design work","client_id":2280,"project_id":153125,"billable":true}]
   */
  async findTimeEntries(clientId, projectId, fromDate, toDate, maxResults) {
    const query = {
      per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
      page: 1,
    };

    if (clientId) query.client_id = clientId;
    if (projectId) query.project_id = projectId;
    if (formatDate(fromDate))
      query.started_from = `${formatDate(fromDate)}T00:00:00Z`;
    if (formatDate(toDate))
      query.started_to = `${formatDate(toDate)}T23:59:59Z`;

    const body = await this.#apiRequest({
      url: this.#timeUrl("time_entries"),
      query,
      logTag: "findTimeEntries",
    });

    return body?.time_entries || [];
  }

  /**
   * @operationName Get Time Entry
   * @category Time Tracking
   * @description Retrieves one time entry in full.
   * @route POST /get-time-entry
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Time Entry","name":"timeEntryId","required":true,"description":"The ID of the time entry to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":5095,"duration":7200,"note":"Design work","client_id":2280,"project_id":153125,"billable":true,"started_at":"2026-05-10T12:00:00Z"}
   */
  async getTimeEntry(timeEntryId) {
    if (!timeEntryId) throw new Error('"Time Entry" is required.');

    const body = await this.#apiRequest({
      url: this.#timeUrl(`time_entries/${timeEntryId}`),
      logTag: "getTimeEntry",
    });

    return body?.time_entry;
  }

  /**
   * @operationName Log Time
   * @category Time Tracking
   * @description Logs time worked, optionally against a client and project, ready to bill.
   * @route POST /log-time
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"Number","label":"Hours","name":"hours","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many hours to log (e.g. 1.5 for an hour and a half)."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"The day the work was done. Leave blank for today."}
   * @paramDef {"type":"String","label":"Client","name":"clientId","dictionary":"getClientsDictionary","description":"The client the work was for."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","dictionary":"getProjectsDictionary","description":"The project the work was for."}
   * @paramDef {"type":"Boolean","label":"Billable","name":"billable","uiComponent":{"type":"TOGGLE"},"description":"Whether this time can be billed to the client."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What you worked on."}
   * @returns {Object}
   * @sampleResult {"id":5095,"duration":5400,"note":"Design work","client_id":2280,"project_id":153125,"billable":true}
   */
  async logTime(hours, date, clientId, projectId, billable, note) {
    if (hours === undefined || hours === null || hours === "")
      throw new Error('"Hours" is required.');

    const timeEntry = cleanupObject({
      is_logged: true,
      duration: hoursToSeconds(hours),
      started_at: startedAt(date),
      identity_id: await this.#getIdentityId(),
      client_id: clientId ? Number(clientId) : undefined,
      project_id: projectId ? Number(projectId) : undefined,
      billable: billable === undefined ? undefined : !!billable,
      note,
    });

    const body = await this.#apiRequest({
      url: this.#timeUrl("time_entries"),
      method: "post",
      body: { time_entry: timeEntry },
      logTag: "logTime",
    });

    return body?.time_entry;
  }

  /**
   * @operationName Update Time Entry
   * @category Time Tracking
   * @description Changes a logged time entry. Only the fields you fill in are updated.
   * @route POST /update-time-entry
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Time Entry","name":"timeEntryId","required":true,"description":"The ID of the time entry to update."}
   * @paramDef {"type":"Number","label":"Hours","name":"hours","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated number of hours."}
   * @paramDef {"type":"Boolean","label":"Billable","name":"billable","uiComponent":{"type":"TOGGLE"},"description":"Updated billable setting."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated note."}
   * @returns {Object}
   * @sampleResult {"id":5095,"duration":3600,"note":"Revised","billable":false}
   */
  async updateTimeEntry(timeEntryId, hours, billable, note) {
    if (!timeEntryId) throw new Error('"Time Entry" is required.');

    // FreshBooks requires started_at + is_logged on every update, so carry the existing ones over.
    const existing = await this.getTimeEntry(timeEntryId);

    const timeEntry = cleanupObject({
      is_logged: true,
      started_at: existing?.started_at,
      duration: hoursToSeconds(hours) ?? existing?.duration,
      billable: billable === undefined ? existing?.billable : !!billable,
      note: note === undefined ? existing?.note : note,
    });

    const body = await this.#apiRequest({
      url: this.#timeUrl(`time_entries/${timeEntryId}`),
      method: "put",
      body: { time_entry: timeEntry },
      logTag: "updateTimeEntry",
    });

    return body?.time_entry;
  }

  /**
   * @operationName Delete Time Entry
   * @category Time Tracking
   * @description Permanently removes a logged time entry.
   * @route POST /delete-time-entry
   * @appearanceColor #D64242 #E8635F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Time Entry","name":"timeEntryId","required":true,"description":"The ID of the time entry to remove."}
   * @returns {Object}
   * @sampleResult {"id":"5095","deleted":true}
   */
  async deleteTimeEntry(timeEntryId) {
    if (!timeEntryId) throw new Error('"Time Entry" is required.');

    await this.#apiRequest({
      url: this.#timeUrl(`time_entries/${timeEntryId}`),
      method: "delete",
      logTag: "deleteTimeEntry",
    });

    return { id: timeEntryId, deleted: true };
  }

  // ------------------------------- Services -------------------------------

  /**
   * @typedef {Object} getServicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter services by name."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Services
   * @description Provides a searchable list of services to categorize time and projects.
   * @route POST /get-services-dictionary
   * @paramDef {"type":"getServicesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Consulting","value":"4054453","note":""}],"cursor":null}
   */
  async getServicesDictionary(payload) {
    const { search } = payload || {};

    const body = await this.#apiRequest({
      url: this.#commentsUrl("services"),
      query: { per_page: DEFAULT_PER_PAGE, page: 1 },
      logTag: "getServicesDictionary",
    });

    const services = searchFilter(body?.services || [], ["name"], search);

    return {
      cursor: null,
      items: services.map((service) => ({
        label: service.name || `Service ${service.id}`,
        value: String(service.id),
        note: service.billable ? "billable" : "",
      })),
    };
  }

  /**
   * @operationName Find Services
   * @category Services
   * @description Lists your services — the categories of work used on projects and time entries.
   * @route POST /find-services
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by service name."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many to return at most (up to 100)."}
   * @returns {Array}
   * @sampleResult [{"id":4054453,"name":"Consulting","billable":true,"vis_state":0}]
   */
  async findServices(search, maxResults) {
    const body = await this.#apiRequest({
      url: this.#commentsUrl("services"),
      query: {
        per_page: Math.min(maxResults || DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
        page: 1,
      },
      logTag: "findServices",
    });

    return searchFilter(body?.services || [], ["name"], search);
  }

  /**
   * @operationName Create Service
   * @category Services
   * @description Creates a service (a type of work) you can attach to projects and time entries.
   * @route POST /create-service
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the service (e.g. Consulting, Design)."}
   * @paramDef {"type":"Boolean","label":"Billable","name":"billable","uiComponent":{"type":"TOGGLE"},"description":"Whether time on this service can be billed."}
   * @returns {Object}
   * @sampleResult {"id":4054453,"name":"Consulting","billable":true,"vis_state":0}
   */
  async createService(name, billable) {
    if (!name) throw new Error('"Name" is required.');

    const service = cleanupObject({
      name,
      billable: billable === undefined ? undefined : !!billable,
    });

    const body = await this.#apiRequest({
      url: this.#commentsUrl("service"),
      method: "post",
      body: { service },
      logTag: "createService",
    });

    return body?.service;
  }

  /**
   * @operationName Set Service Rate
   * @category Services
   * @description Sets the hourly rate for a service.
   * @route POST /set-service-rate
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Service","name":"serviceId","required":true,"dictionary":"getServicesDictionary","description":"The service to set a rate for."}
   * @paramDef {"type":"Number","label":"Hourly Rate","name":"hourlyRate","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The hourly rate for this service."}
   * @returns {Object}
   * @sampleResult {"service_id":4054453,"rate":"100.00"}
   */
  async setServiceRate(serviceId, hourlyRate) {
    if (!serviceId) throw new Error('"Service" is required.');
    if (hourlyRate === undefined || hourlyRate === null || hourlyRate === "")
      throw new Error('"Hourly Rate" is required.');

    const body = await this.#apiRequest({
      url: this.#commentsUrl(`service/${serviceId}/rate`),
      method: "post",
      body: { service_rate: { rate: String(hourlyRate) } },
      logTag: "setServiceRate",
    });

    return body?.service_rate || body;
  }

  // ============================ 6b. TRIGGER ===============================

  /**
   * @operationName Record Created or Changed
   * @category Event Tracking
   * @description Starts a flow when something happens in FreshBooks — a new invoice, a payment received, a new client, and more. Pick which event to listen for.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-record-event
   * @appearanceColor #0075DD #21C0E8
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["New Invoice","Invoice Updated","New Payment","New Client","Client Updated","New Estimate","New Expense","New Credit Note","New Item","New Project","New Time Entry","New Bill","New Tax"]}},"description":"Which FreshBooks event should start this flow."}
   * @returns {Object}
   * @sampleResult {"event":"invoice.create","objectId":987,"accountId":"ZykWor","businessId":14691043}
   */
  onRecordEvent() {}

  // Reproduces FreshBooks' HMAC: base64( HMAC-SHA256( verifier, python-json.dumps(params) ) ).
  #computeWebhookSignature(verifier, params) {
    const stringified = {};

    Object.keys(params).forEach((key) => {
      stringified[key] = String(params[key]);
    });

    // Python's json.dumps default uses ", " and ": " separators.
    const message = JSON.stringify(stringified)
      .replace(/":"/g, '": "')
      .replace(/","/g, '", "');

    return crypto
      .createHmac("sha256", verifier)
      .update(message, "utf8")
      .digest("base64");
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    const accountId = this.#getAccountId();

    // OAuth services must carry the connection id so delivered events can be authenticated.
    const separator = invocation.callbackUrl.includes("?") ? "&" : "?";
    const uri = invocation.connectionId
      ? `${invocation.callbackUrl}${separator}connectionId=${encodeURIComponent(invocation.connectionId)}`
      : invocation.callbackUrl;

    const desired = [
      ...new Set(
        (invocation.events || [])
          .map((e) => TRIGGER_EVENTS[e.triggerData?.event])
          .filter(Boolean),
      ),
    ];
    const existing = invocation.webhookData?.callbacks || [];
    const kept = [];

    // Remove callbacks that are no longer wanted.
    for (const cb of existing) {
      if (desired.includes(cb.event)) {
        kept.push(cb);
      } else {
        try {
          await this.#apiRequest({
            url: this.#eventsUrl(`events/callbacks/${cb.callbackid}`),
            method: "delete",
            logTag: "trigger:deleteCallback",
          });
        } catch (error) {
          logger.warn(
            `trigger upsert - delete ${cb.callbackid}: ${error.message}`,
          );
        }
      }
    }

    // Create callbacks for newly wanted events.
    for (const event of desired) {
      if (kept.find((c) => c.event === event)) continue;

      try {
        const body = await this.#apiRequest({
          url: this.#eventsUrl("events/callbacks"),
          method: "post",
          body: { callback: { event, uri } },
          logTag: "trigger:createCallback",
        });

        const callback = body?.response?.result?.callback;

        if (callback)
          kept.push({ event, callbackid: callback.callbackid || callback.id });
      } catch (error) {
        logger.error(`trigger upsert - create ${event}: ${error.message}`);
      }
    }

    return {
      webhookData: {
        accountId,
        connectionId: invocation.connectionId,
        callbacks: kept,
      },
    };
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    const body = invocation.body || {};

    // Verification handshake: FreshBooks POSTs a verifier; echo it back to activate the callback.
    if (body.verifier) {
      try {
        const accountId =
          body.account_id ||
          invocation.webhookData?.accountId ||
          this.#getAccountId();

        await this.#apiRequest({
          url: `${API_BASE}/events/account/${accountId}/events/callbacks/${body.object_id}`,
          method: "put",
          body: { callback: { verifier: body.verifier } },
          logTag: "trigger:verify",
        });
      } catch (error) {
        logger.error(`trigger verify - ${error.message}`);
      }

      return { handshake: true, responseToExternalService: "" };
    }

    if (!body.name) return null;

    // Best-effort signature check when the verifier is available.
    const verifier = invocation.webhookData?.verifier;
    const signature =
      invocation.headers?.["x-freshbooks-hmac-sha256"] ||
      invocation.headers?.["X-FreshBooks-Hmac-SHA256"];

    if (
      verifier &&
      signature &&
      this.#computeWebhookSignature(verifier, body) !== signature
    ) {
      logger.warn(
        "trigger resolve - webhook signature mismatch, ignoring event.",
      );

      return null;
    }

    return {
      connectionId:
        invocation.connectionId || invocation.queryParams?.connectionId,
      events: [
        {
          name: "onRecordEvent",
          data: {
            event: body.name,
            objectId: body.object_id,
            accountId: body.account_id,
            businessId: body.business_id,
          },
        },
      ],
    };
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    const firedEvent = invocation.eventData?.event;

    const ids = (invocation.triggers || [])
      .filter((trigger) => {
        const picked = trigger.data?.event;

        if (!picked) return true;

        return TRIGGER_EVENTS[picked] === firedEvent;
      })
      .map((trigger) => trigger.id);

    return { ids };
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    const accountId = invocation.webhookData?.accountId;
    const callbacks = invocation.webhookData?.callbacks || [];

    for (const cb of callbacks) {
      try {
        await this.#apiRequest({
          url: `${API_BASE}/events/account/${accountId}/events/callbacks/${cb.callbackid}`,
          method: "delete",
          logTag: "trigger:deleteWebhook",
        });
      } catch (error) {
        logger.warn(`trigger delete - ${cb.callbackid}: ${error.message}`);
      }
    }

    return { webhookData: {} };
  }
}

// ============================ 7. REGISTRATION ==============================

Flowrunner.ServerCode.addService(FreshBooksService, [
  {
    name: "clientId",
    displayName: "Client ID",
    defaultValue: "",
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: "OAuth Client ID from your FreshBooks app (my.freshbooks.com/#/developer).",
  },
  {
    name: "clientSecret",
    displayName: "Client Secret",
    defaultValue: "",
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: "OAuth Client Secret from your FreshBooks app.",
  },
]);
