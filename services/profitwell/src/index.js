const logger = {
  info: (...args) => console.log('[ProfitWell] info:', ...args),
  debug: (...args) => console.log('[ProfitWell] debug:', ...args),
  error: (...args) => console.log('[ProfitWell] error:', ...args),
  warn: (...args) => console.log('[ProfitWell] warn:', ...args),
}

const API_BASE_URL = 'https://api.profitwell.com/v2'

// Metric names exposed by ProfitWell Metrics (Paddle). Values are the API tokens;
// labels are the human-readable form shown in dropdowns.
const METRIC_MAP = {
  'Recurring Revenue': 'recurring_revenue',
  'Active Customers': 'active_customers',
  'Average Revenue Per User': 'average_revenue_per_user',
  'New Recurring Revenue': 'new_recurring_revenue',
  'Upgrades': 'upgrades',
  'Downgrades': 'downgrades',
  'Reactivations': 'reactivations',
  'New Customers': 'new_customers',
  'Churned Customers': 'churned_customers',
  'Churned Revenue': 'churned_revenue',
  'Net New Revenue': 'net_new_revenue',
  'Plan Change Revenue': 'plan_change_revenue',
}

// Removes undefined / null / empty-string values so they are not sent to the API.
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
 * @integrationName ProfitWell
 * @integrationIcon /icon.png
 */
class ProfitWellService {
  constructor(config) {
    this.apiToken = config.apiToken
  }

  // Maps a friendly dropdown label to its API value, passing through any value not in the map.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': this.apiToken,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.message || error.body?.error || error.message

      logger.error(`${ logTag } - failed${ status ? ` (${ status })` : '' }: ${ message }`)

      throw new Error(`ProfitWell API error${ status ? ` [${ status }]` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Get Monthly Metrics
   * @category Metrics
   * @description Retrieves month-over-month ProfitWell financial metrics for your account (recurring revenue/MRR, active customers, ARPU, new/churned customers, upgrades, downgrades, reactivations, and more). Provide a start month and an optional end month in YYYY-MM format; omit end to return through the latest available month. Requires a metrics-enabled API token.
   * @route GET /metrics/monthly
   * @appearanceColor #3B3E42 #5FC2AC
   *
   * @paramDef {"type":"String","label":"Start Month","name":"month","required":true,"description":"First month to include, in YYYY-MM format (e.g. 2025-01)."}
   * @paramDef {"type":"String","label":"End Month","name":"monthEnd","description":"Last month to include, in YYYY-MM format. Leave empty to return through the most recent month."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"recurring_revenue":[{"date":"2025-01","value":125000},{"date":"2025-02","value":131200}],"active_customers":[{"date":"2025-01","value":842},{"date":"2025-02","value":867}]}}
   */
  async getMonthlyMetrics(month, monthEnd) {
    const logTag = '[getMonthlyMetrics]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/metrics/monthly/`,
      method: 'get',
      query: {
        month,
        month_end: monthEnd,
      },
    })
  }

  /**
   * @operationName Get Daily Metrics
   * @category Metrics
   * @description Retrieves day-by-day ProfitWell financial metrics for a single month (recurring revenue/MRR, active customers, ARPU, new/churned customers, upgrades, downgrades, and more). Provide the target month in YYYY-MM format. Requires a metrics-enabled API token.
   * @route GET /metrics/daily
   * @appearanceColor #3B3E42 #5FC2AC
   *
   * @paramDef {"type":"String","label":"Month","name":"month","required":true,"description":"Month to return daily metrics for, in YYYY-MM format (e.g. 2025-06)."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"recurring_revenue":[{"date":"2025-06-01","value":131200},{"date":"2025-06-02","value":131450}],"active_customers":[{"date":"2025-06-01","value":867},{"date":"2025-06-02","value":869}]}}
   */
  async getDailyMetrics(month) {
    const logTag = '[getDailyMetrics]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/metrics/daily/`,
      method: 'get',
      query: {
        month,
      },
    })
  }

  /**
   * @operationName Get Metric Detail
   * @category Metrics
   * @description Retrieves a breakdown of a single ProfitWell metric over time, optionally sliced by plan. Choose the metric (e.g. Recurring Revenue, Active Customers, Churned Customers) and set the resolution to monthly or daily. For daily resolution provide a month (YYYY-MM); for monthly, optionally provide a start and end month. Optionally filter by a specific plan ID. Requires a metrics-enabled API token.
   * @route GET /metrics/detail
   * @appearanceColor #3B3E42 #5FC2AC
   *
   * @paramDef {"type":"String","label":"Metric","name":"metric","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Recurring Revenue","Active Customers","Average Revenue Per User","New Recurring Revenue","Upgrades","Downgrades","Reactivations","New Customers","Churned Customers","Churned Revenue","Net New Revenue","Plan Change Revenue"]}},"description":"The metric to break down."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"DROPDOWN","options":{"values":["Monthly","Daily"]}},"defaultValue":"Monthly","description":"Time resolution of the breakdown. Defaults to Monthly."}
   * @paramDef {"type":"String","label":"Start Month","name":"month","description":"For daily resolution, the month to return (YYYY-MM). For monthly resolution, the first month to include (YYYY-MM)."}
   * @paramDef {"type":"String","label":"End Month","name":"monthEnd","description":"For monthly resolution only: the last month to include (YYYY-MM). Ignored for daily resolution."}
   * @paramDef {"type":"String","label":"Plan ID","name":"planId","description":"Optional plan ID to slice the metric by a single plan."}
   *
   * @returns {Object}
   * @sampleResult {"metric":"recurring_revenue","resolution":"monthly","data":[{"date":"2025-01","value":125000},{"date":"2025-02","value":131200}]}
   */
  async getMetricDetail(metric, resolution, month, monthEnd, planId) {
    const logTag = '[getMetricDetail]'

    const metricValue = this.#resolveChoice(metric, METRIC_MAP)
    const resolutionValue = this.#resolveChoice(resolution || 'Monthly', { Monthly: 'monthly', Daily: 'daily' })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/metrics/${ resolutionValue }/`,
      method: 'get',
      query: {
        type: metricValue,
        month,
        month_end: resolutionValue === 'monthly' ? monthEnd : undefined,
        plan_id: planId,
      },
    })
  }

  /**
   * @operationName Create Subscription
   * @category Subscriptions
   * @description Pushes a new subscription into a manual/API-based ProfitWell account so it is counted in your metrics. Provide the customer's user ID, a unique subscription ID, plan details (name/ID, billing interval, ISO currency), the subscription value in cents, and the effective start date. Values take up to ~90 minutes to appear in metrics. Requires an API-based (manual) ProfitWell account.
   * @route POST /subscriptions
   * @appearanceColor #3B3E42 #5FC2AC
   *
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"Your unique identifier for the customer/user this subscription belongs to."}
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"Your unique identifier for this subscription (used later to update or churn it)."}
   * @paramDef {"type":"String","label":"Plan ID","name":"planId","required":true,"description":"Identifier of the plan the customer is subscribed to."}
   * @paramDef {"type":"String","label":"Plan Interval","name":"planInterval","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Monthly","Yearly"]}},"description":"Billing interval of the plan."}
   * @paramDef {"type":"String","label":"Plan Currency","name":"planCurrency","required":true,"description":"Three-letter ISO 4217 currency code in lowercase (e.g. usd, eur, gbp)."}
   * @paramDef {"type":"Number","label":"Value","name":"value","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Subscription amount in the smallest currency unit (cents), e.g. 4900 for $49.00."}
   * @paramDef {"type":"String","label":"Effective Date","name":"effectiveDate","required":true,"description":"Date the subscription started. Accepts a YYYY-MM-DD date or a Unix timestamp."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Optional customer email address, used for churn recovery when Retain is enabled."}
   *
   * @returns {Object}
   * @sampleResult {"user_id":"user_123","subscription_id":"sub_456","plan_id":"pro-monthly","plan_interval":"month","plan_currency":"usd","status":"active","value":4900,"effective_date":1704067200}
   */
  async createSubscription(userId, subscriptionId, planId, planInterval, planCurrency, value, effectiveDate, email) {
    const logTag = '[createSubscription]'

    const intervalValue = this.#resolveChoice(planInterval, { Monthly: 'month', Yearly: 'year' })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/subscriptions/`,
      method: 'post',
      body: clean({
        user_id: userId,
        subscription_id: subscriptionId,
        plan_id: planId,
        plan_interval: intervalValue,
        plan_currency: planCurrency,
        value,
        effective_date: effectiveDate,
        email,
      }),
    })
  }

  /**
   * @operationName Update Subscription
   * @category Subscriptions
   * @description Records a change to an existing subscription in a manual/API-based ProfitWell account, such as an upgrade or downgrade (expansion/contraction MRR). Identify the subscription by its subscription ID and provide the new value and/or plan details along with the effective date. Requires an API-based (manual) ProfitWell account.
   * @route PUT /subscriptions/{subscriptionId}
   * @appearanceColor #3B3E42 #5FC2AC
   *
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The subscription ID used when the subscription was created."}
   * @paramDef {"type":"Number","label":"Value","name":"value","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New subscription amount in the smallest currency unit (cents), e.g. 9900 for $99.00."}
   * @paramDef {"type":"String","label":"Effective Date","name":"effectiveDate","required":true,"description":"Date this change takes effect. Accepts a YYYY-MM-DD date or a Unix timestamp."}
   * @paramDef {"type":"String","label":"Plan ID","name":"planId","description":"Optional new plan identifier if the plan changed."}
   * @paramDef {"type":"String","label":"Plan Interval","name":"planInterval","uiComponent":{"type":"DROPDOWN","options":{"values":["Monthly","Yearly"]}},"description":"Optional new billing interval if the plan changed."}
   * @paramDef {"type":"String","label":"Plan Currency","name":"planCurrency","description":"Optional new three-letter ISO 4217 currency code in lowercase (e.g. usd)."}
   *
   * @returns {Object}
   * @sampleResult {"subscription_id":"sub_456","plan_id":"pro-yearly","plan_interval":"year","plan_currency":"usd","status":"active","value":9900,"effective_date":1706745600}
   */
  async updateSubscription(subscriptionId, value, effectiveDate, planId, planInterval, planCurrency) {
    const logTag = '[updateSubscription]'

    const intervalValue = this.#resolveChoice(planInterval, { Monthly: 'month', Yearly: 'year' })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/subscriptions/${ encodeURIComponent(subscriptionId) }/`,
      method: 'put',
      body: clean({
        value,
        effective_date: effectiveDate,
        plan_id: planId,
        plan_interval: intervalValue,
        plan_currency: planCurrency,
      }),
    })
  }

  /**
   * @operationName Churn Subscription
   * @category Subscriptions
   * @description Marks a subscription as churned in a manual/API-based ProfitWell account. Identify the subscription by its subscription ID, set the effective churn date, and choose the churn type: voluntary (customer cancelled) or delinquent (failed payment). When Retain is enabled, delinquent churns can trigger recovery workflows. Requires an API-based (manual) ProfitWell account.
   * @route DELETE /subscriptions/{subscriptionId}
   * @appearanceColor #3B3E42 #5FC2AC
   *
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The subscription ID used when the subscription was created."}
   * @paramDef {"type":"String","label":"Effective Date","name":"effectiveDate","required":true,"description":"Date the churn takes effect. Accepts a YYYY-MM-DD date or a Unix timestamp."}
   * @paramDef {"type":"String","label":"Churn Type","name":"churnType","uiComponent":{"type":"DROPDOWN","options":{"values":["Voluntary","Delinquent"]}},"defaultValue":"Voluntary","description":"Voluntary (customer cancelled) or Delinquent (failed payment). Defaults to Voluntary."}
   *
   * @returns {Object}
   * @sampleResult {"subscription_id":"sub_456","status":"churned","churn_type":"voluntary","effective_date":1709251200}
   */
  async churnSubscription(subscriptionId, effectiveDate, churnType) {
    const logTag = '[churnSubscription]'

    const churnTypeValue = this.#resolveChoice(churnType || 'Voluntary', { Voluntary: 'voluntary', Delinquent: 'delinquent' })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/subscriptions/${ encodeURIComponent(subscriptionId) }/`,
      method: 'delete',
      query: {
        effective_date: effectiveDate,
        churn_type: churnTypeValue,
      },
    })
  }

  /**
   * @operationName Get Subscriptions
   * @category Subscriptions
   * @description Retrieves the subscription history for a customer in a manual/API-based ProfitWell account. Look the customer up by their user ID (the identifier you supplied when creating subscriptions) or by a specific subscription ID. Returns the subscriptions and their current status. Requires an API-based (manual) ProfitWell account.
   * @route GET /subscriptions/{lookupId}
   * @appearanceColor #3B3E42 #5FC2AC
   *
   * @paramDef {"type":"String","label":"Lookup ID","name":"lookupId","required":true,"description":"The customer user ID or subscription ID to look up."}
   *
   * @returns {Object}
   * @sampleResult {"subscriptions":[{"subscription_id":"sub_456","user_id":"user_123","plan_id":"pro-monthly","plan_interval":"month","plan_currency":"usd","status":"active","value":4900,"effective_date":1704067200}]}
   */
  async getSubscriptions(lookupId) {
    const logTag = '[getSubscriptions]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/subscriptions/${ encodeURIComponent(lookupId) }/`,
      method: 'get',
    })
  }

  /**
   * @operationName Migrate Subscription
   * @category Subscriptions
   * @description Changes the plan of an existing subscription in a manual/API-based ProfitWell account, capturing the resulting expansion or contraction MRR as a plan change. Identify the subscription by its subscription ID and provide the new plan details, value, and effective date. Requires an API-based (manual) ProfitWell account.
   * @route PUT /subscriptions/{subscriptionId}/migrate
   * @appearanceColor #3B3E42 #5FC2AC
   *
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The subscription ID used when the subscription was created."}
   * @paramDef {"type":"String","label":"Plan ID","name":"planId","required":true,"description":"Identifier of the plan the customer is migrating to."}
   * @paramDef {"type":"Number","label":"Value","name":"value","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New subscription amount in the smallest currency unit (cents), e.g. 9900 for $99.00."}
   * @paramDef {"type":"String","label":"Effective Date","name":"effectiveDate","required":true,"description":"Date the migration takes effect. Accepts a YYYY-MM-DD date or a Unix timestamp."}
   * @paramDef {"type":"String","label":"Plan Interval","name":"planInterval","uiComponent":{"type":"DROPDOWN","options":{"values":["Monthly","Yearly"]}},"description":"Billing interval of the new plan."}
   * @paramDef {"type":"String","label":"Plan Currency","name":"planCurrency","description":"Optional three-letter ISO 4217 currency code in lowercase (e.g. usd)."}
   *
   * @returns {Object}
   * @sampleResult {"subscription_id":"sub_456","plan_id":"enterprise-yearly","plan_interval":"year","plan_currency":"usd","status":"active","value":9900,"effective_date":1706745600}
   */
  async migrateSubscription(subscriptionId, planId, value, effectiveDate, planInterval, planCurrency) {
    const logTag = '[migrateSubscription]'

    const intervalValue = this.#resolveChoice(planInterval, { Monthly: 'month', Yearly: 'year' })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/subscriptions/${ encodeURIComponent(subscriptionId) }/migrate/`,
      method: 'put',
      body: clean({
        plan_id: planId,
        value,
        effective_date: effectiveDate,
        plan_interval: intervalValue,
        plan_currency: planCurrency,
      }),
    })
  }
}

Flowrunner.ServerCode.addService(ProfitWellService, [
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your private ProfitWell (Paddle) API token, sent as the raw Authorization header value. Find it in the ProfitWell app under Account Settings → API keys.',
  },
])
