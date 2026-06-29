'use strict'

const API_BASE_URL = 'https://www.googleapis.com/youtube/v3'
const UPLOAD_BASE_URL = 'https://www.googleapis.com/upload/youtube/v3'
const ANALYTICS_API_BASE_URL = 'https://youtubeanalytics.googleapis.com/v2'
const REPORTING_API_BASE_URL = 'https://youtubereporting.googleapis.com/v1'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const SCOPE_GROUPS = {
  data: [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/youtube.channel-memberships.creator',
  ],
  analyticsBasic: [
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ],
  analyticsMonetary: [
    'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
  ],
  identity: [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
}

const DEFAULT_PAGE_SIZE = 50
const MAX_DICTIONARY_PAGE_SIZE = 50

function buildScopeString({ enableMonetary } = {}) {
  const scopes = [
    ...SCOPE_GROUPS.data,
    ...SCOPE_GROUPS.analyticsBasic,
    ...SCOPE_GROUPS.identity,
  ]

  if (enableMonetary) {
    scopes.push(...SCOPE_GROUPS.analyticsMonetary)
  }

  return scopes.join(' ')
}

module.exports = {
  API_BASE_URL,
  UPLOAD_BASE_URL,
  ANALYTICS_API_BASE_URL,
  REPORTING_API_BASE_URL,
  TOKEN_URL,
  OAUTH_URL,
  USER_INFO_URL,
  SCOPE_GROUPS,
  DEFAULT_PAGE_SIZE,
  MAX_DICTIONARY_PAGE_SIZE,
  buildScopeString,
}
