'use strict'

// GoCardless splits each environment across two host pairs: `connect.*` is OAuth (authorize +
// token exchange), `api.*` is the data API. A token minted against connect.* sandbox CANNOT be
// used against api.gocardless.com (and vice-versa); environment is sticky per connection.
const ENVIRONMENTS = {
  live: {
    connectBase: 'https://connect.gocardless.com',
    apiBase: 'https://api.gocardless.com',
  },
  sandbox: {
    connectBase: 'https://connect-sandbox.gocardless.com',
    apiBase: 'https://api-sandbox.gocardless.com',
  },
}

const DEFAULT_ENVIRONMENT = 'live'

// Pinned at the SDK-current version. Don't expose to users - the response schema is contractual
// against this string and changing it silently breaks every downstream method.
const API_VERSION = '2015-07-06'

// GoCardless OAuth only ships two scopes - read_only or read_write. There's no per-resource
// scope set the way Stripe/Google have. read_write is required for create/update/cancel actions
// so we default to it; users can downgrade in their partner app dashboard if they only need reads.
const SCOPE_READ_WRITE = 'read_write'
const SCOPE_READ_ONLY = 'read_only'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 500 // GoCardless hard cap on `limit`
const DICTIONARY_PAGE_SIZE = 100
const FETCH_ALL_MAX_PAGES = 100 // safety cap; 100 * 500 = 50K records
const POLLING_MAX_PAGES = 20 // per poll, bound work even if events backlog spikes

// Re-scan this far below the stored watermark each poll so an event that becomes listable a moment
// after its created_at (clock skew / write lag) is not skipped; the seen-id set de-dups the overlap.
const POLL_OVERLAP_MS = 15 * 60 * 1000
const MAX_SEEN_EVENT_IDS = 5000 // bound the de-dup set carried in polling-trigger state

// Resource ID prefix > human label. Used by friendly errors + bank_details_lookups output shaping.
const ID_PREFIXES = {
  OR: 'Organisation',
  CR: 'Creditor',
  CU: 'Customer',
  BA: 'Bank Account',
  MD: 'Mandate',
  PM: 'Payment',
  SB: 'Subscription',
  IS: 'Instalment Schedule',
  PO: 'Payout',
  RF: 'Refund',
  EV: 'Event',
  BRQ: 'Billing Request',
  BRF: 'Billing Request Flow',
  BRT: 'Billing Request Template',
  IM: 'Mandate Import',
  BLC: 'Block',
}

// Scenario simulators (sandbox-only). The id is the simulator name; pass the target resource ID
// via links.resource. Constraints are documented per simulator in the GoCardless reference but
// the API enforces them - surface the error rather than pre-validating client-side.
const SCENARIO_SIMULATORS = {
  payment_submitted: { resource: 'payments', label: 'Payment > submitted' },
  payment_confirmed: { resource: 'payments', label: 'Payment > confirmed' },
  payment_paid_out: { resource: 'payments', label: 'Payment > paid out' },
  payment_failed: { resource: 'payments', label: 'Payment > failed' },
  payment_late_failure: {
    resource: 'payments',
    label: 'Payment > late failure',
  },
  payment_late_failure_settled: {
    resource: 'payments',
    label: 'Payment > late failure settled',
  },
  payment_charged_back: {
    resource: 'payments',
    label: 'Payment > charged back',
  },
  payment_chargeback_settled: {
    resource: 'payments',
    label: 'Payment > chargeback settled',
  },
  mandate_activated: { resource: 'mandates', label: 'Mandate > activated' },
  mandate_customer_approval_granted: {
    resource: 'mandates',
    label: 'Mandate > customer approval granted',
  },
  mandate_customer_approval_skipped: {
    resource: 'mandates',
    label: 'Mandate > customer approval skipped',
  },
  mandate_failed: { resource: 'mandates', label: 'Mandate > failed' },
  mandate_expired: { resource: 'mandates', label: 'Mandate > expired' },
  mandate_transferred: { resource: 'mandates', label: 'Mandate > transferred' },
  mandate_transferred_with_resubmission: {
    resource: 'mandates',
    label: 'Mandate > transferred w/ resubmission',
  },
  mandate_suspended_by_payer: {
    resource: 'mandates',
    label: 'Mandate > suspended by payer',
  },
  refund_paid: { resource: 'refunds', label: 'Refund > paid' },
  refund_settled: { resource: 'refunds', label: 'Refund > settled' },
  refund_bounced: { resource: 'refunds', label: 'Refund > bounced' },
  refund_returned: { resource: 'refunds', label: 'Refund > returned' },
  payout_bounced: { resource: 'payouts', label: 'Payout > bounced' },
  creditor_verification_status_action_required: {
    resource: 'creditors',
    label: 'Creditor verification > action required',
  },
  creditor_verification_status_in_review: {
    resource: 'creditors',
    label: 'Creditor verification > in review',
  },
  creditor_verification_status_successful: {
    resource: 'creditors',
    label: 'Creditor verification > successful',
  },
  billing_request_fulfilled: {
    resource: 'billing_requests',
    label: 'Billing request > fulfilled',
  },
  billing_request_fulfilled_and_payment_failed: {
    resource: 'billing_requests',
    label: 'Billing request > fulfilled, payment failed',
  },
  billing_request_fulfilled_and_payment_confirmed_to_failed: {
    resource: 'billing_requests',
    label: 'Billing request > fulfilled, confirmed>failed',
  },
  billing_request_fulfilled_and_payment_paid_out: {
    resource: 'billing_requests',
    label: 'Billing request > fulfilled, payment paid out',
  },
}

// Each polling trigger subscribes to one event resource_type. Action filter is optional and
// passed as a trigger config param so a single subscription can narrow to e.g. only "confirmed"
// payment events without re-coding the trigger.
const POLLING_TRIGGERS = {
  onPaymentEvent: { resourceType: 'payments', label: 'Payment events' },
  onMandateEvent: { resourceType: 'mandates', label: 'Mandate events' },
  onSubscriptionEvent: {
    resourceType: 'subscriptions',
    label: 'Subscription events',
  },
  onRefundEvent: { resourceType: 'refunds', label: 'Refund events' },
  onPayoutEvent: { resourceType: 'payouts', label: 'Payout events' },
  onBillingRequestEvent: {
    resourceType: 'billing_requests',
    label: 'Billing request events',
  },
}

// Period preset > relative window. Used by listPayments / listEvents / listPayouts to spare AI
// agents from computing dates. `custom` defers to explicit createdAfter/Before parameters.
const PERIOD_PRESETS = {
  today: 1,
  yesterday: 1,
  last7Days: 7,
  last30Days: 30,
  last90Days: 90,
  monthToDate: 0,
  yearToDate: 0,
  custom: 0,
}

// Currency-scheme matrix for bank-account creation hints. Used by friendly errors when GC rejects
// a bank account whose scheme/currency combo isn't supported.
const SUPPORTED_CURRENCIES = {
  GBP: { schemes: ['bacs', 'faster_payments'], country: 'GB' },
  EUR: { schemes: ['sepa_core'], country: null }, // any eurozone
  SEK: { schemes: ['autogiro'], country: 'SE' },
  AUD: { schemes: ['becs', 'pay_to'], country: 'AU' },
  NZD: { schemes: ['becs_nz'], country: 'NZ' },
  CAD: { schemes: ['pad'], country: 'CA' },
  DKK: { schemes: ['betalingsservice'], country: 'DK' },
  USD: { schemes: ['ach'], country: 'US' },
}

// -------------------------------------------------------------------------------------------
// Friendly dropdown-label > GoCardless API value maps. Dropdown params surface the plain label
// strings; methods resolve them back to wire values via resolveChoice/resolveChoices right
// before they reach a query or request body. Each map is derived 1:1 from the original
// label/value enum pairs - never invent values here.
// -------------------------------------------------------------------------------------------

const PERIOD_LABELS = {
  'Custom Range': 'custom',
  'Today': 'today',
  'Yesterday': 'yesterday',
  'Last 7 Days': 'last7Days',
  'Last 30 Days': 'last30Days',
  'Last 90 Days': 'last90Days',
  'Month to Date': 'monthToDate',
  'Year to Date': 'yearToDate',
}

const COUNTRY_LABELS = {
  'United Kingdom': 'GB',
  'Germany': 'DE',
  'France': 'FR',
  'Netherlands': 'NL',
  'Spain': 'ES',
  'Italy': 'IT',
  'Ireland': 'IE',
  'Austria': 'AT',
  'Belgium': 'BE',
  'Portugal': 'PT',
  'Finland': 'FI',
  'Luxembourg': 'LU',
  'Sweden': 'SE',
  'Denmark': 'DK',
  'Australia': 'AU',
  'New Zealand': 'NZ',
  'Canada': 'CA',
  'United States': 'US',
}

const LANGUAGE_LABELS = {
  'English': 'en',
  'German': 'de',
  'French': 'fr',
  'Spanish': 'es',
  'Italian': 'it',
  'Dutch': 'nl',
  'Portuguese': 'pt',
  'Swedish': 'sv',
  'Danish': 'da',
}

const CURRENCY_LABELS = {
  'British Pound': 'GBP',
  'Euro': 'EUR',
  'US Dollar': 'USD',
  'Swedish Krona': 'SEK',
  'Australian Dollar': 'AUD',
  'New Zealand Dollar': 'NZD',
  'Canadian Dollar': 'CAD',
  'Danish Krone': 'DKK',
}

const SCHEME_LABELS = {
  'Bacs (UK)': 'bacs',
  'SEPA Core (Europe)': 'sepa_core',
  'ACH (US)': 'ach',
  'BECS (Australia)': 'becs',
  'BECS (New Zealand)': 'becs_nz',
  'Autogiro (Sweden)': 'autogiro',
  'PAD (Canada)': 'pad',
  'PayTo (Australia)': 'pay_to',
  'Betalingsservice (Denmark)': 'betalingsservice',
  'Faster Payments (UK)': 'faster_payments',
}

const MANDATE_IMPORT_ENTRY_STATUS_LABELS = {
  'Successfully Processed': 'successfully_processed',
  'Unsuccessfully Processed': 'unsuccessfully_processed',
}

const ACCOUNT_TYPE_LABELS = {
  'Checking': 'checking',
  'Savings': 'savings',
}

const MANDATE_STATUS_LABELS = {
  'Pending Customer Approval': 'pending_customer_approval',
  'Pending Submission': 'pending_submission',
  'Submitted': 'submitted',
  'Active': 'active',
  'Failed': 'failed',
  'Cancelled': 'cancelled',
  'Expired': 'expired',
  'Consumed': 'consumed',
  'Blocked': 'blocked',
  'Suspended By Payer': 'suspended_by_payer',
}

const PAYMENT_STATUS_LABELS = {
  'Pending Customer Approval': 'pending_customer_approval',
  'Pending Submission': 'pending_submission',
  'Submitted': 'submitted',
  'Confirmed': 'confirmed',
  'Paid Out': 'paid_out',
  'Failed': 'failed',
  'Cancelled': 'cancelled',
  'Charged Back': 'charged_back',
}

const SUBSCRIPTION_STATUS_LABELS = {
  'Active': 'active',
  'Paused': 'paused',
  'Finished': 'finished',
  'Cancelled': 'cancelled',
  'Customer Approval Denied': 'customer_approval_denied',
}

const INSTALMENT_STATUS_LABELS = {
  'Pending': 'pending',
  'Active': 'active',
  'Creating': 'creating',
  'Errored': 'errored',
  'Cancelled': 'cancelled',
  'Completed': 'completed',
}

const PAYOUT_STATUS_LABELS = {
  'Pending': 'pending',
  'Paid': 'paid',
  'Bounced': 'bounced',
}

const REFUND_TYPE_LABELS = {
  'Per Payment': 'payment',
  'Whole Mandate': 'mandate',
}

const MANDATE_VERIFY_LABELS = {
  'Minimum': 'minimum',
  'Recommended (Default)': 'recommended',
  'When Available': 'when_available',
  'Always': 'always',
}

const RESOURCE_TYPE_LABELS = {
  'Billing Requests': 'billing_requests',
  'Creditors': 'creditors',
  'Customers': 'customers',
  'Instalment Schedules': 'instalment_schedules',
  'Mandates': 'mandates',
  'Outbound Payments': 'outbound_payments',
  'Payer Authorisations': 'payer_authorisations',
  'Payments': 'payments',
  'Payouts': 'payouts',
  'Refunds': 'refunds',
  'Subscriptions': 'subscriptions',
}

// Union of every event/trigger action enum - one map for listEvents and all six polling triggers.
const EVENT_ACTION_LABELS = {
  'Created': 'created',
  'Submitted': 'submitted',
  'Confirmed': 'confirmed',
  'Failed': 'failed',
  'Cancelled': 'cancelled',
  'Paid': 'paid',
  'Paid Out': 'paid_out',
  'Charged Back': 'charged_back',
  'Bounced': 'bounced',
  'Customer Approval Granted': 'customer_approval_granted',
  'Customer Approval Denied': 'customer_approval_denied',
  'Customer Approval Skipped': 'customer_approval_skipped',
  'Resubmission Requested': 'resubmission_requested',
  'Active': 'active',
  'Expired': 'expired',
  'Reinstated': 'reinstated',
  'Replaced': 'replaced',
  'Consumed': 'consumed',
  'Blocked': 'blocked',
  'Suspended By Payer': 'suspended_by_payer',
  'Paused': 'paused',
  'Resumed': 'resumed',
  'Finished': 'finished',
  'Fulfilled': 'fulfilled',
  'Fx Rate Confirmed': 'fx_rate_confirmed',
  'Late Failure Settled': 'late_failure_settled',
  'Chargeback Cancelled': 'chargeback_cancelled',
  'Chargeback Settled': 'chargeback_settled',
  'Transferred': 'transferred',
  'Payment Created': 'payment_created',
  'Scheduled Pause Started': 'scheduled_pause_started',
  'Funds Returned': 'funds_returned',
  'Refund Settled': 'refund_settled',
  'Tax Updated': 'tax_updated',
  'Customer Details Confirmed': 'customer_details_confirmed',
  'Bank Account Collected': 'bank_account_collected',
  'Flow Created': 'flow_created',
  'Flow Initialised': 'flow_initialised',
  'Flow Completed': 'flow_completed',
  'Flow Visited': 'flow_visited',
  'Flow Exited': 'flow_exited',
  'Payer Finalised Payment Details': 'payer_finalised_payment_details',
}

const SCENARIO_LABELS = {
  'Payment Submitted': 'payment_submitted',
  'Payment Confirmed': 'payment_confirmed',
  'Payment Paid Out': 'payment_paid_out',
  'Payment Failed': 'payment_failed',
  'Payment Late Failure': 'payment_late_failure',
  'Payment Late Failure Settled': 'payment_late_failure_settled',
  'Payment Charged Back': 'payment_charged_back',
  'Payment Chargeback Settled': 'payment_chargeback_settled',
  'Mandate Activated': 'mandate_activated',
  'Mandate Customer Approval Granted': 'mandate_customer_approval_granted',
  'Mandate Customer Approval Skipped': 'mandate_customer_approval_skipped',
  'Mandate Failed': 'mandate_failed',
  'Mandate Expired': 'mandate_expired',
  'Mandate Transferred': 'mandate_transferred',
  'Mandate Transferred With Resubmission': 'mandate_transferred_with_resubmission',
  'Mandate Suspended By Payer': 'mandate_suspended_by_payer',
  'Refund Paid': 'refund_paid',
  'Refund Settled': 'refund_settled',
  'Refund Bounced': 'refund_bounced',
  'Refund Returned': 'refund_returned',
  'Payout Bounced': 'payout_bounced',
  'Creditor Verification Status Action Required': 'creditor_verification_status_action_required',
  'Creditor Verification Status In Review': 'creditor_verification_status_in_review',
  'Creditor Verification Status Successful': 'creditor_verification_status_successful',
  'Billing Request Fulfilled': 'billing_request_fulfilled',
  'Billing Request Fulfilled And Payment Failed': 'billing_request_fulfilled_and_payment_failed',
  'Billing Request Fulfilled And Payment Confirmed To Failed': 'billing_request_fulfilled_and_payment_confirmed_to_failed',
  'Billing Request Fulfilled And Payment Paid Out': 'billing_request_fulfilled_and_payment_paid_out',
}

const MONTH_LABELS = {
  'January': 'january',
  'February': 'february',
  'March': 'march',
  'April': 'april',
  'May': 'may',
  'June': 'june',
  'July': 'july',
  'August': 'august',
  'September': 'september',
  'October': 'october',
  'November': 'november',
  'December': 'december',
}

const INTERVAL_UNIT_LABELS = {
  'Weekly': 'weekly',
  'Monthly': 'monthly',
  'Yearly': 'yearly',
}

module.exports = {
  ENVIRONMENTS,
  DEFAULT_ENVIRONMENT,
  API_VERSION,
  SCOPE_READ_WRITE,
  SCOPE_READ_ONLY,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  DICTIONARY_PAGE_SIZE,
  FETCH_ALL_MAX_PAGES,
  POLLING_MAX_PAGES,
  POLL_OVERLAP_MS,
  MAX_SEEN_EVENT_IDS,
  ID_PREFIXES,
  SCENARIO_SIMULATORS,
  POLLING_TRIGGERS,
  PERIOD_PRESETS,
  SUPPORTED_CURRENCIES,
  PERIOD_LABELS,
  COUNTRY_LABELS,
  LANGUAGE_LABELS,
  CURRENCY_LABELS,
  SCHEME_LABELS,
  ACCOUNT_TYPE_LABELS,
  MANDATE_IMPORT_ENTRY_STATUS_LABELS,
  MANDATE_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  INSTALMENT_STATUS_LABELS,
  PAYOUT_STATUS_LABELS,
  REFUND_TYPE_LABELS,
  MANDATE_VERIFY_LABELS,
  RESOURCE_TYPE_LABELS,
  EVENT_ACTION_LABELS,
  SCENARIO_LABELS,
  MONTH_LABELS,
  INTERVAL_UNIT_LABELS,
}
