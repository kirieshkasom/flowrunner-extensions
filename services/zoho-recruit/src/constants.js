'use strict'

// Recruit's API lives at `recruit.zoho.{tld}` — the generic `www.zohoapis.{tld}` gateway returns
// a Zoho "Invalid URL" error page for /recruit/v2 paths. Zoho's token response sometimes hands
// back the generic gateway as `api_domain`; executeCallback swaps it via ZOHOAPIS_TO_RECRUIT.
const DATA_CENTERS = {
  US: {
    accountsServer: 'https://accounts.zoho.com',
    apiDomain: 'https://recruit.zoho.com',
  },
  EU: {
    accountsServer: 'https://accounts.zoho.eu',
    apiDomain: 'https://recruit.zoho.eu',
  },
  IN: {
    accountsServer: 'https://accounts.zoho.in',
    apiDomain: 'https://recruit.zoho.in',
  },
  AU: {
    accountsServer: 'https://accounts.zoho.com.au',
    apiDomain: 'https://recruit.zoho.com.au',
  },
  JP: {
    accountsServer: 'https://accounts.zoho.jp',
    apiDomain: 'https://recruit.zoho.jp',
  },
  CA: {
    accountsServer: 'https://accounts.zoho.ca',
    apiDomain: 'https://recruit.zoho.ca',
  },
  CN: {
    accountsServer: 'https://accounts.zoho.com.cn',
    apiDomain: 'https://recruit.zoho.com.cn',
  },
  SA: {
    accountsServer: 'https://accounts.zoho.sa',
    apiDomain: 'https://recruit.zoho.sa',
  },
}

const ZOHOAPIS_TO_RECRUIT = {
  'https://www.zohoapis.com': 'https://recruit.zoho.com',
  'https://www.zohoapis.eu': 'https://recruit.zoho.eu',
  'https://www.zohoapis.in': 'https://recruit.zoho.in',
  'https://www.zohoapis.com.au': 'https://recruit.zoho.com.au',
  'https://www.zohoapis.jp': 'https://recruit.zoho.jp',
  'https://www.zohoapis.ca': 'https://recruit.zoho.ca',
  'https://www.zohoapis.com.cn': 'https://recruit.zoho.com.cn',
  'https://www.zohoapis.sa': 'https://recruit.zoho.sa',
}

const DEFAULT_DATA_CENTER = 'US'

// Verified-against-Zoho scope list (2026-05-10). Trim only if your org needs least-privilege.
// Beware: any non-existent scope causes the authorize endpoint to reject the WHOLE request with
// "Invalid OAuth Scope" — there's no per-scope warning. Notable absences vs. CRM: no .search,
// no .coql, no .mass_update, and notifications has no .ALL aggregate.
const DEFAULT_SCOPE_LIST = [
  'ZohoRecruit.modules.ALL',
  'ZohoRecruit.settings.ALL',
  'ZohoRecruit.users.ALL',
  'ZohoRecruit.org.ALL',
  'ZohoRecruit.bulk.ALL',
  'ZohoRecruit.notifications.READ',
  'ZohoRecruit.notifications.CREATE',
  'ZohoRecruit.notifications.UPDATE',
  'ZohoRecruit.notifications.DELETE',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

// Built-in Recruit modules. `primaryFields` drives the OR-criteria fallback for free-text search
// (#buildWordCriteria). Custom modules pass through #resolveModuleApiName and use a default field
// set if not listed here.
const CORE_MODULES = {
  Candidates: {
    label: 'Candidates',
    primaryFields: ['Last_Name', 'First_Name', 'Email', 'Phone'],
  },
  JobOpenings: {
    label: 'Job Openings',
    primaryFields: ['Posting_Title', 'Job_Opening_Status', 'Client_Name'],
  },
  Applications: {
    label: 'Applications',
    primaryFields: ['Name', 'Status', 'Candidate_Id', 'Job_Opening_Id'],
  },
  Interviews: {
    label: 'Interviews',
    primaryFields: [
      'Interview_Name',
      'Start_DateTime',
      'End_DateTime',
      'Candidate_Id',
    ],
  },
  Contacts: {
    label: 'Contacts (HR / Hiring Managers)',
    primaryFields: ['Last_Name', 'Email', 'Account_Name'],
  },
  Accounts: {
    label: 'Clients (Companies)',
    primaryFields: ['Account_Name', 'Industry'],
  },
  Vendors: { label: 'Vendors', primaryFields: ['Vendor_Name', 'Email'] },
  Tasks: { label: 'Tasks', primaryFields: ['Subject', 'Status', 'Due_Date'] },
  Events: {
    label: 'Events',
    primaryFields: ['Event_Title', 'Start_DateTime', 'End_DateTime'],
  },
  Calls: {
    label: 'Calls',
    primaryFields: ['Subject', 'Call_Type', 'Call_Start_Time'],
  },
}

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200 // Zoho hard cap on per_page for list/search
const DICTIONARY_PAGE_SIZE = 100
const POLLING_MAX_PAGES = 50
const FETCH_ALL_MAX_PAGES = 100 // safety cap for fetchAll (=20K records)

// Trigger operationName → Notification API events. Recruit event names are
// `{ModuleApiName}.{create|edit|delete}`; one trigger may subscribe to multiple events.
const REALTIME_TRIGGERS = {
  onCandidateCreatedRT: { module: 'Candidates', events: ['Candidates.create'] },
  onCandidateUpdatedRT: { module: 'Candidates', events: ['Candidates.edit'] },
  onCandidateDeletedRT: { module: 'Candidates', events: ['Candidates.delete'] },
  onJobOpeningCreatedRT: {
    module: 'JobOpenings',
    events: ['JobOpenings.create'],
  },
  onJobOpeningUpdatedRT: {
    module: 'JobOpenings',
    events: ['JobOpenings.edit'],
  },
  onApplicationCreatedRT: {
    module: 'Applications',
    events: ['Applications.create'],
  },
  onApplicationUpdatedRT: {
    module: 'Applications',
    events: ['Applications.edit'],
  },
  onInterviewCreatedRT: { module: 'Interviews', events: ['Interviews.create'] },
  onInterviewUpdatedRT: { module: 'Interviews', events: ['Interviews.edit'] },
}

// Inverse: event-name → trigger operationName. Used by handleTriggerResolveEvents.
const EVENT_TO_TRIGGER = Object.fromEntries(
  Object.entries(REALTIME_TRIGGERS).flatMap(([name, def]) =>
    def.events.map(ev => [ev, name])
  )
)

// Notification channels expire ≤24h server-side. We request 23h so handleTriggerRefreshWebhook
// has slack to renew before Zoho cuts the channel.
const WEBHOOK_EXPIRY_MS = 23 * 60 * 60 * 1000

module.exports = {
  DATA_CENTERS,
  ZOHOAPIS_TO_RECRUIT,
  DEFAULT_DATA_CENTER,
  DEFAULT_SCOPE_LIST,
  DEFAULT_SCOPE_STRING,
  CORE_MODULES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  DICTIONARY_PAGE_SIZE,
  POLLING_MAX_PAGES,
  FETCH_ALL_MAX_PAGES,
  REALTIME_TRIGGERS,
  EVENT_TO_TRIGGER,
  WEBHOOK_EXPIRY_MS,
}
