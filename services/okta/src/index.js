// Okta identity & access management extension: users, groups, applications, factors,
// network zones, hooks, devices, authorization servers, and system-log polling triggers.

// ============================================================================
//  CONSTANTS
// ============================================================================
const EXPRESSION_TYPE = 'urn:okta:expression:1.0'

// Curated set of common, subscribable Okta System Log event types, sourced from the Okta
// event-types catalog (https://developer.okta.com/docs/reference/api/event-types/). Okta exposes
// no public "list all eventTypes" endpoint, so event hooks pick from this cited static catalog.
const EVENT_TYPE_CATALOG = [
  { value: 'user.lifecycle.create', label: 'User Created' },
  { value: 'user.lifecycle.activate', label: 'User Activated' },
  { value: 'user.lifecycle.deactivate', label: 'User Deactivated' },
  { value: 'user.lifecycle.suspend', label: 'User Suspended' },
  { value: 'user.lifecycle.unsuspend', label: 'User Unsuspended' },
  { value: 'user.lifecycle.delete.initiated', label: 'User Deletion Initiated' },
  { value: 'user.account.update_profile', label: 'User Profile Updated' },
  { value: 'user.account.lock', label: 'User Locked Out' },
  { value: 'user.account.unlock', label: 'User Unlocked' },
  { value: 'group.user_membership.add', label: 'User Added to Group' },
  { value: 'group.user_membership.remove', label: 'User Removed from Group' },
  { value: 'application.user_membership.add', label: 'User Assigned to App' },
  { value: 'application.user_membership.remove', label: 'User Unassigned from App' },
  { value: 'user.session.start', label: 'User Login' },
  { value: 'user.session.end', label: 'User Logout' },
  { value: 'user.authentication.auth_via_mfa', label: 'MFA Authentication' },
]

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[Okta] info:', ...args),
  debug: (...args) => console.log('[Okta] debug:', ...args),
  error: (...args) => console.log('[Okta] error:', ...args),
  warn: (...args) => console.log('[Okta] warn:', ...args),
}

// Friendly, remediating error map - never leak a raw API body that halts a flow.
const ERROR_HINTS = {
  401: 'Authentication failed — check the API Token in this connection (Security → API → Tokens in Okta).',
  403: 'Insufficient permission — the API token lacks the admin role required for this operation.',
  404: 'Not found — the ID may be wrong; use the matching Get/List action to pick a valid one.',
  429: 'Okta rate limit hit — retry in a moment.',
}


// ============================================================================
//  DROPDOWN LABEL -> API VALUE MAPS (friendly labels resolve back to Okta wire values)
// ============================================================================
const STATUS_LABELS = { 'Active': 'ACTIVE', 'Inactive': 'INACTIVE' }
const AUTHENTICATOR_METHOD_LABELS = { 'SMS': 'sms', 'Voice Call': 'voice', 'Email': 'email', 'Push': 'push', 'TOTP': 'totp', 'OTP': 'otp', 'WebAuthn': 'webauthn', 'Signed Nonce (Okta FastPass)': 'signed_nonce', 'Security Question': 'security_question', 'Password': 'password', 'Certificate': 'cert', 'Duo': 'duo', 'IdP': 'idp', 'Temporary Access Code': 'tac' }
const POLICY_TYPE_LABELS = { 'Global Session (Okta Sign-On)': 'OKTA_SIGN_ON', 'Password': 'PASSWORD', 'Authenticator Enrollment (MFA Enroll)': 'MFA_ENROLL', 'App Sign-On (Access Policy)': 'ACCESS_POLICY', 'User Profile (Profile Enrollment)': 'PROFILE_ENROLLMENT', 'IdP Discovery': 'IDP_DISCOVERY', 'Entity Risk': 'ENTITY_RISK', 'Post-Auth Session': 'POST_AUTH_SESSION', 'Device Signal Collection': 'DEVICE_SIGNAL_COLLECTION', 'Session Violation Detection': 'SESSION_VIOLATION_DETECTION', 'Client Update': 'CLIENT_UPDATE', 'Identity Claim Sourcing': 'IDENTITY_CLAIM_SOURCING' }
const IDP_TYPE_LABELS = { 'Generic OpenID Connect': 'OIDC', 'Generic SAML 2.0': 'SAML2', 'Google': 'GOOGLE', 'Facebook': 'FACEBOOK', 'Microsoft': 'MICROSOFT', 'Apple': 'APPLE', 'LinkedIn': 'LINKEDIN', 'GitHub': 'GITHUB', 'GitLab': 'GITLAB', 'Amazon': 'AMAZON', 'Salesforce': 'SALESFORCE', 'Spotify': 'SPOTIFY', 'Discord': 'DISCORD', 'PayPal': 'PAYPAL', 'Xero': 'XERO', 'Yahoo': 'YAHOO', 'Smart Card (X.509)': 'X509', 'Okta Org2Org': 'OKTA_INTEGRATION' }
const NETWORK_ZONE_TYPE_LABELS = { 'IP': 'IP', 'Dynamic (Geo/ASN)': 'DYNAMIC', 'Dynamic V2': 'DYNAMIC_V2' }
const NETWORK_ZONE_USAGE_LABELS = { 'Policy': 'POLICY', 'Blocklist': 'BLOCKLIST' }
const TRUSTED_ORIGIN_SCOPE_LABELS = { 'CORS': 'CORS', 'Redirect': 'REDIRECT', 'Iframe Embed': 'IFRAME_EMBED' }
const IFRAME_APP_LABELS = { 'Okta End-User Dashboard': 'OKTA_ENDUSER', 'Okta Admin Console': 'OKTA_ADMIN_CONSOLE' }
const INLINE_HOOK_TYPE_LABELS = { 'OAuth2 Token Transform': 'com.okta.oauth2.tokens.transform', 'SAML Token Transform': 'com.okta.saml.tokens.transform', 'Import Transform': 'com.okta.import.transform', 'User Pre-Registration': 'com.okta.user.pre-registration', 'Password Import': 'com.okta.user.credential.password.import', 'Telephony Provider': 'com.okta.telephony.provider' }
const SIGN_ON_MODE_LABELS = { 'Bookmark (Link Tile)': 'BOOKMARK', 'SWA Auto-Login': 'AUTO_LOGIN' }
const BEHAVIOR_TYPE_LABELS = { 'Velocity (impossible travel)': 'VELOCITY', 'Anomalous Location': 'ANOMALOUS_LOCATION', 'Anomalous IP': 'ANOMALOUS_IP', 'Anomalous Device': 'ANOMALOUS_DEVICE', 'Anomalous ASN': 'ANOMALOUS_ASN' }
const POLICY_RULE_TYPE_LABELS = { 'Sign-On': 'SIGN_ON', 'Password': 'PASSWORD', 'MFA Enroll': 'MFA_ENROLL', 'IdP Discovery': 'IDP_DISCOVERY', 'Access Policy': 'ACCESS_POLICY', 'Profile Enrollment': 'PROFILE_ENROLLMENT' }
const ISSUER_MODE_LABELS = { 'Org URL': 'ORG_URL', 'Custom URL': 'CUSTOM_URL', 'Dynamic': 'DYNAMIC' }
const CONSENT_LABELS = { 'Implicit (no dialog)': 'IMPLICIT', 'Required': 'REQUIRED', 'Flexible': 'FLEXIBLE' }
const METADATA_PUBLISH_LABELS = { 'No Clients': 'NO_CLIENTS', 'All Clients': 'ALL_CLIENTS' }
const CLAIM_TYPE_LABELS = { 'Access Token (Resource)': 'RESOURCE', 'ID Token (Identity)': 'IDENTITY' }
const CLAIM_VALUE_TYPE_LABELS = { 'Expression (Okta EL)': 'EXPRESSION', 'Groups': 'GROUPS', 'System': 'SYSTEM' }
const GROUP_FILTER_TYPE_LABELS = { 'Contains': 'CONTAINS', 'Equals': 'EQUALS', 'Starts With': 'STARTS_WITH', 'Regex': 'REGEX' }
const AUTHENTICATOR_KEY_LABELS = { 'Duo Security': 'duo', 'Temporary Access Code': 'tac', 'Custom App (Push)': 'custom_app', 'On-Prem MFA': 'onprem_mfa', 'Symantec VIP': 'symantec_vip', 'YubiKey OTP': 'yubikey_token', 'WebAuthn / FIDO2': 'webauthn', 'Smart Card IdP': 'smart_card_idp' }
const JWK_USE_LABELS = { 'Signing': 'sig', 'Encryption': 'enc' }
const ADMIN_ROLE_LABELS = { 'Super Administrator': 'SUPER_ADMIN', 'Organizational Administrator': 'ORG_ADMIN', 'Application Administrator': 'APP_ADMIN', 'Group Administrator (User Admin)': 'USER_ADMIN', 'Help Desk Administrator': 'HELP_DESK_ADMIN', 'Read-Only Administrator': 'READ_ONLY_ADMIN', 'Group Membership Administrator': 'GROUP_MEMBERSHIP_ADMIN', 'API Access Management Administrator': 'API_ACCESS_MANAGEMENT_ADMIN', 'Report Administrator': 'REPORT_ADMIN' }
const ENROLL_FACTOR_TYPE_LABELS = { 'SMS (Text Message)': 'sms', 'Voice Call': 'call', 'Email': 'email', 'Authenticator App (TOTP)': 'token:software:totp', 'Okta Verify Push': 'push' }
const FACTOR_PROVIDER_LABELS = { 'Okta': 'OKTA', 'Google': 'GOOGLE', 'RSA': 'RSA', 'Symantec': 'SYMANTEC' }
const LOG_SORT_ORDER_LABELS = { 'Oldest First': 'ASCENDING', 'Newest First': 'DESCENDING' }
const THREAT_INSIGHT_ACTION_LABELS = { 'None (disabled)': 'none', 'Audit (log only)': 'audit', 'Block (log and block)': 'block' }
const DEVICE_EXPAND_LABELS = { 'Full user details': 'user', 'User summaries': 'userSummary' }
const RESEND_FACTOR_TYPE_LABELS = { 'SMS': 'sms', 'Voice Call': 'call', 'Email': 'email' }
const OWNER_TYPE_LABELS = { 'User': 'USER', 'Group': 'GROUP' }
const GRANT_EXPAND_LABELS = { 'Include Scope Details': 'scope' }
const SYSTEM_LOG_EVENT_TYPE_LABELS = { 'All Events': '', 'User Created': 'user.lifecycle.create', 'User Activated': 'user.lifecycle.activate', 'User Deactivated': 'user.lifecycle.deactivate', 'User Suspended': 'user.lifecycle.suspend', 'User Profile Updated': 'user.account.update_profile', 'User Added to Group': 'group.user_membership.add', 'User Removed from Group': 'group.user_membership.remove', 'User Assigned to App': 'application.user_membership.add', 'User Unassigned from App': 'application.user_membership.remove', 'MFA Authentication': 'user.authentication.auth_via_mfa' }
const ROTATE_KEY_USE_LABELS = { 'Signing': 'sig' }

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getUsersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match a user's first name, last name, or email."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getGroupsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match a group by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getApplicationsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match an application by name or label."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getGroupRulesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter group rules by name (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getUserFactorsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"User","name":"userId","required":true,"description":"The user whose enrolled factors to list."}
 */

/**
 * @typedef {Object} getUserFactorsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter factors locally."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — factors return in one page)."}
 * @paramDef {"type":"getUserFactorsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the user whose factors to list."}
 */

/**
 * @typedef {Object} getUserRoleAssignmentsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"User","name":"userId","required":true,"description":"The user whose admin-role assignments to list."}
 */

/**
 * @typedef {Object} getUserRoleAssignmentsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter role assignments locally."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — role assignments return in one page)."}
 * @paramDef {"type":"getUserRoleAssignmentsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the user whose role assignments to list."}
 */

/**
 * @typedef {Object} getNetworkZonesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match a zone by name (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getTrustedOriginsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional keyword to match a trusted origin by name or URL."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getEventHooksDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match an event hook by name (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — event hooks return in one page)."}
 */

/**
 * @typedef {Object} getEventTypesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the event-type catalog."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — the curated catalog returns in one page)."}
 */

/**
 * @typedef {Object} getInlineHooksDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match an inline hook by name (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — inline hooks return in one page)."}
 */

/**
 * @typedef {Object} getBehaviorRulesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match a behavior rule by name (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getUserTypesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match a user type by name or display name (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — user types return in one page)."}
 */

/**
 * @typedef {Object} getDevicesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional SCIM filter to narrow devices (e.g. status eq \"ACTIVE\")."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getLinkedObjectsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match a linked-object relationship by primary or associated name/title (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — linked-object definitions return in one page)."}
 */

/**
 * @typedef {Object} getPoliciesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Policy Type","name":"type","description":"The PolicyType to list (Okta requires it; defaults to OKTA_SIGN_ON)."}
 */

/**
 * @typedef {Object} getPoliciesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match a policy by name (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getPoliciesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Carries the required policy type."}
 */

/**
 * @typedef {Object} getPolicyRulesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"description":"The parent policy whose rules to list."}
 */

/**
 * @typedef {Object} getPolicyRulesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter rules by name (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — rules return in one page)."}
 * @paramDef {"type":"getPolicyRulesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent policy."}
 */

/**
 * @typedef {Object} getAuthServersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match an authorization server by name or audiences."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getScopesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"description":"The authorization server whose scopes to list."}
 */

/**
 * @typedef {Object} getScopesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter scopes by name (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getScopesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the authorization server."}
 */

/**
 * @typedef {Object} getClaimsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"description":"The authorization server whose claims to list."}
 */

/**
 * @typedef {Object} getClaimsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter claims by name (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — claims return in one page)."}
 * @paramDef {"type":"getClaimsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the authorization server."}
 */

/**
 * @typedef {Object} getProfileMappingsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter mappings by source/target name (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getIdpsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match an IdP by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getAuthenticatorsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter authenticators by name (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — authenticators return in one page)."}
 */

/**
 * @typedef {Object} getUserGrantsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"User","name":"userId","required":true,"description":"The user whose OAuth grants to list."}
 */

/**
 * @typedef {Object} getUserGrantsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter grants by scope id (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getUserGrantsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the user."}
 */

/**
 * @typedef {Object} getUserClientsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"User","name":"userId","required":true,"description":"The user whose OAuth clients to list."}
 */

/**
 * @typedef {Object} getUserClientsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter clients by name (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getUserClientsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the user."}
 */

/**
 * @typedef {Object} getUserTokensDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"User","name":"userId","required":true,"description":"The user the refresh tokens belong to."}
 * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"description":"The OAuth client that holds the refresh tokens."}
 */

/**
 * @typedef {Object} getUserTokensDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tokens by id (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getUserTokensDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the user and OAuth client."}
 */

/**
 * @typedef {Object} getAuthServerPoliciesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"description":"The authorization server whose access policies to list."}
 */

/**
 * @typedef {Object} getAuthServerPoliciesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter policies by name (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — policies return in one page)."}
 * @paramDef {"type":"getAuthServerPoliciesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the authorization server."}
 */

/**
 * @typedef {Object} getAuthServerPolicyRulesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"description":"The authorization server."}
 * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"description":"The access policy whose rules to list."}
 */

/**
 * @typedef {Object} getAuthServerPolicyRulesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter rules by name (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — rules return in one page)."}
 * @paramDef {"type":"getAuthServerPolicyRulesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the authorization server and policy."}
 */

/**
 * @typedef {Object} getApplicationKeysDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"description":"The application whose SSO signing keys to list."}
 */

/**
 * @typedef {Object} getApplicationKeysDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter keys by kid (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — keys return in one page)."}
 * @paramDef {"type":"getApplicationKeysDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the application."}
 */

/**
 * @typedef {Object} getAppCsrsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"description":"The application whose CSRs to list."}
 */

/**
 * @typedef {Object} getAppCsrsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter CSRs by id (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — CSRs return in one page)."}
 * @paramDef {"type":"getAppCsrsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the application."}
 */

/**
 * @typedef {Object} getAppJwksDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"description":"The OAuth/OIDC client application whose JSON Web Keys to list."}
 */

/**
 * @typedef {Object} getAppJwksDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter keys by kid (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — keys return in one page)."}
 * @paramDef {"type":"getAppJwksDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the application."}
 */

/**
 * @typedef {Object} getAppSecretsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"description":"The OAuth/OIDC client application whose client secrets to list."}
 */

/**
 * @typedef {Object} getAppSecretsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter secrets by id (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — secrets return in one page)."}
 * @paramDef {"type":"getAppSecretsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the application."}
 */

/**
 * @typedef {Object} getResourceServerKeysDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"description":"The authorization server (resource server) whose JWKs to list."}
 */

/**
 * @typedef {Object} getResourceServerKeysDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter keys by kid (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — keys return in one page)."}
 * @paramDef {"type":"getResourceServerKeysDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the authorization server."}
 */

/**
 * @typedef {Object} getOrgIdpKeysDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter org IdP keys by kid (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getIdpSigningKeysDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"description":"The IdP whose signing keys to list."}
 */

/**
 * @typedef {Object} getIdpSigningKeysDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter keys by kid (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — keys return in one page)."}
 * @paramDef {"type":"getIdpSigningKeysDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the identity provider."}
 */

/**
 * @typedef {Object} getIdpCsrsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"description":"The IdP whose CSRs to list."}
 */

/**
 * @typedef {Object} getIdpCsrsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter CSRs by id (filtered locally)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused — CSRs return in one page)."}
 * @paramDef {"type":"getIdpCsrsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the identity provider."}
 */

/**
 * @integrationName Okta
 * @integrationIcon /icon.svg
 */
class Okta {
  constructor(config) {
    this.config = config || {}
    this.orgUrl = String(this.config.orgUrl || '').replace(/\/+$/, '')
    this.apiToken = this.config.apiToken
  }

  // ==========================================================================
  //  CORE - every external call goes through #apiRequest
  // ==========================================================================
  // Resolves the full response (`.unwrapBody(false)`) so we can read the Link header
  // for cursor pagination, then returns { body, cursor } where cursor is the parsed
  // rel="next" `after` value (null when there is no next page).
  async #apiRequest({ path, method, body, query, logTag, allow404, contentType }) {
    method = method || 'get'

    if (!this.orgUrl) {
      throw new Error('Okta Org URL is not configured — set it in this connection (e.g. https://dev-123456.okta.com).')
    }

    if (!this.apiToken) {
      throw new Error('API Token is not configured — set an SSWS API token in this connection.')
    }

    const url = `${ this.orgUrl }${ path }`

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const request = Flowrunner.Request[method](url)
        .set(this.#headers(contentType))
        .query(query || {})
        .unwrapBody(false)

      const response = body
        ? await request.send(body)
        : await request

      return { body: response?.body, cursor: this.#parseNextCursor(response?.headers) }
    } catch (error) {
      // When the caller opts in, a 404 means "the resource is already gone" - treat it as a
      // soft success (idempotent delete) and signal it with a sentinel instead of throwing.
      if (allow404 && (error?.status || error?.code || error?.body?.status) === 404) {
        logger.debug(`${ logTag } got 404 — treating as already-removed (idempotent)`)

        return { body: null, cursor: null, notFound: true }
      }

      this.#handleError(error, logTag)
    }
  }

  #headers(contentType) {
    return {
      Authorization: `SSWS ${ this.apiToken }`,
      Accept: 'application/json',
      'Content-Type': contentType || 'application/json',
    }
  }

  // Okta paginates via the HTTP Link header: <...?after=CURSOR>; rel="next".
  // Returns the `after` value of the rel="next" link, or null.
  #parseNextCursor(headers) {
    const link = headers?.link || headers?.Link

    if (!link) {
      return null
    }

    const parts = String(link).split(',')

    for (const part of parts) {
      if (!/rel="next"/.test(part)) {
        continue
      }

      const urlMatch = /<([^>]+)>/.exec(part)

      if (!urlMatch) {
        continue
      }

      const afterMatch = /[?&]after=([^&]+)/.exec(urlMatch[1])

      if (afterMatch) {
        return decodeURIComponent(afterMatch[1])
      }
    }

    return null
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.code || error?.body?.status
    const apiMessage = error?.body?.errorSummary || error?.body?.error?.message || error?.body?.message || error?.message || 'Request failed'
    const hint = ERROR_HINTS[status]

    logger.error(`${ logTag } failed: ${ apiMessage }`)

    throw new Error(hint ? `${ hint } (${ apiMessage })` : apiMessage)
  }

  // Shapes a list response into { items, cursor } from a raw array body.
  #listResult(result) {
    return {
      items: Array.isArray(result?.body) ? result.body : [],
      cursor: result?.cursor || null,
    }
  }


  // Resolve a friendly dropdown label back to its Okta API value. Unknown values (raw API
  // values or custom input) pass through untouched, so both label and wire forms are accepted.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Multi-select variant: resolves each element to its API value before any join. Accepts an
  // array or comma-separated string; returns an array (undefined when empty).
  #resolveChoices(input, mapping) {
    if (input === undefined || input === null) return undefined
    const arr = Array.isArray(input) ? input : String(input).split(',').map(s => s.trim()).filter(Boolean)
    const out = arr.map(v => this.#resolveChoice(v, mapping))

    return out.length ? out : undefined
  }

  // ==========================================================================
  //  USERS - CRUD
  // ==========================================================================
  /**
   * @operationName Create User
   * @category Users
   * @description Creates a new user in your Okta org with a profile (name, email, login) and optionally a starting password. Use this to provision someone - turn off "Activate on Create" to stage the account for later activation.
   * @route POST /create-user
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"User's given name (profile.firstName)."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"User's family name (profile.lastName)."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"User's primary email (profile.email)."}
   * @paramDef {"type":"String","label":"Login (Username)","name":"login","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Unique sign-in username (profile.login); usually the email."}
   * @paramDef {"type":"String","label":"Mobile Phone","name":"mobilePhone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional mobile phone (profile.mobilePhone)."}
   * @paramDef {"type":"String","label":"Password","name":"password","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional initial password (credentials.password.value). Leave blank to invite/activate by email."}
   * @paramDef {"type":"Boolean","label":"Activate on Create","name":"activate","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When on, runs the activation lifecycle (?activate=true). Turn off to stage the user."}
   * @returns {Object}
   * @sampleResult {"id":"00ub0oNGTSWTBKOLGLNR","status":"ACTIVE","profile":{"firstName":"Isaac","lastName":"Brock","email":"isaac.brock@example.com","login":"isaac.brock@example.com","mobilePhone":"555-415-1337"}}
   */
  async createUser(firstName, lastName, email, login, mobilePhone, password, activate) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/User/ (Create a User)
    const profile = { firstName, lastName, email, login }

    if (mobilePhone) {
      profile.mobilePhone = mobilePhone
    }

    const body = { profile }

    if (password) {
      body.credentials = { password: { value: password } }
    }

    const result = await this.#apiRequest({
      path: '/api/v1/users',
      method: 'post',
      query: { activate: activate === undefined ? true : activate },
      body,
      logTag: 'createUser',
    })

    return result.body
  }

  /**
   * @operationName Get User
   * @category Users
   * @description Retrieves a single user's full profile and status by id, login, or email. Use this to read a user before updating or acting on them.
   * @route POST /get-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user to retrieve. Pick from the list, or paste a user id, login, or email."}
   * @returns {Object}
   * @sampleResult {"id":"00ub0oNGTSWTBKOLGLNR","status":"ACTIVE","profile":{"firstName":"Isaac","lastName":"Brock","email":"isaac.brock@example.com","login":"isaac.brock@example.com"}}
   */
  async getUser(userId) {
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }`,
      logTag: 'getUser',
    })

    return result.body
  }

  /**
   * @operationName List Users
   * @category Users
   * @description Lists users in your org, optionally narrowed by a quick search or a SCIM-style filter expression. Returns a page plus a cursor for the next page. Use this to find or enumerate users.
   * @route POST /list-users
   * @paramDef {"type":"String","label":"Quick Search","name":"q","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Matches firstName, lastName, or email (starts-with). Leave blank to list all."}
   * @paramDef {"type":"String","label":"Search Expression","name":"searchExpression","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"SCIM-style filter, e.g. status eq \"ACTIVE\". Advanced; overrides Quick Search."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","defaultValue":200,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max results per page (default 200, max 200)."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"after","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from the previous page's next link, to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"00ub0oNGTSWTBKOLGLNR","status":"ACTIVE","profile":{"firstName":"Isaac","lastName":"Brock","email":"isaac.brock@example.com"}}],"cursor":"00ub0oNGTSWTBKOLGLNS"}
   */
  async listUsers(q, searchExpression, limit, after) {
    const query = { limit: limit || 200 }

    if (searchExpression) {
      query.search = searchExpression
    } else if (q) {
      query.q = q
    }

    if (after) {
      query.after = after
    }

    const result = await this.#apiRequest({ path: '/api/v1/users', query, logTag: 'listUsers' })

    return this.#listResult(result)
  }

  /**
   * @operationName Update User
   * @category Users
   * @description Partially updates a user's profile - only the fields you provide are changed; the rest are left as-is. Use this to edit a name, email, or phone without replacing the whole profile.
   * @route POST /update-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New first name (only sent if provided — partial update)."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New last name (only sent if provided)."}
   * @paramDef {"type":"String","label":"Email","name":"email","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New primary email (only sent if provided)."}
   * @paramDef {"type":"String","label":"Mobile Phone","name":"mobilePhone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New mobile phone (only sent if provided)."}
   * @returns {Object}
   * @sampleResult {"id":"00ub0oNGTSWTBKOLGLNR","status":"ACTIVE","profile":{"firstName":"Isaac","email":"isaac.brock@update.example.com"}}
   */
  async updateUser(userId, firstName, lastName, email, mobilePhone) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/User/ (Update a User - partial POST)
    const profile = {}

    if (firstName !== undefined && firstName !== null && firstName !== '') {
      profile.firstName = firstName
    }

    if (lastName !== undefined && lastName !== null && lastName !== '') {
      profile.lastName = lastName
    }

    if (email !== undefined && email !== null && email !== '') {
      profile.email = email
    }

    if (mobilePhone !== undefined && mobilePhone !== null && mobilePhone !== '') {
      profile.mobilePhone = mobilePhone
    }

    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }`,
      method: 'post',
      body: { profile },
      logTag: 'updateUser',
    })

    return result.body
  }

  /**
   * @operationName Delete User
   * @category Users
   * @description Removes a user. An ACTIVE user is deactivated by the first delete; enable "Permanently Delete" to deactivate then permanently delete. Already-deactivated (DEPROVISIONED) users are handled gracefully - permanent delete works in a single step and a missing user is treated as already removed. Destructive - use with care.
   * @route POST /delete-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user to delete. An ACTIVE user is deactivated by the first delete; turn on Permanently Delete to remove for good."}
   * @paramDef {"type":"Boolean","label":"Permanently Delete","name":"confirmPermanentDelete","defaultValue":false,"uiComponent":{"type":"TOGGLE"},"description":"When on, the method deactivates (if needed) then permanently deletes. When off, deactivate only."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"userId":"00ub0oNGTSWTBKOLGLNR","permanent":true}
   */
  async deleteUser(userId, confirmPermanentDelete) {
    // docs: https://developer.okta.com/docs/reference/api/users/ (Delete User - must first be deactivated;
    // a single DELETE on an already-DEPROVISIONED user permanently removes it)
    // Idempotent: Okta's delete is two-phase (deactivate, then permanent). Sending the deactivate
    // DELETE against an already-DEPROVISIONED user, then a second DELETE, makes the second 404. Read
    // the current status first so we only fire the deactivate step when it is actually needed, and
    // swallow a 404 on the permanent step (the user is already gone) so a successful delete never
    // surfaces as an error.
    let status

    try {
      const user = await this.#apiRequest({
        path: `/api/v1/users/${ encodeURIComponent(userId) }`,
        logTag: 'deleteUser/status',
        allow404: true,
      })

      if (user.notFound) {
        return { deleted: true, userId, permanent: Boolean(confirmPermanentDelete), alreadyGone: true }
      }

      status = user.body?.status
    } catch (error) {
      // If we cannot read the status, fall through to the delete and let it report any real failure.
      status = undefined
    }

    const alreadyDeprovisioned = status === 'DEPROVISIONED'

    // Phase 1 - deactivate. Skip it when the user is already DEPROVISIONED: a DELETE on such a user
    // is itself the permanent delete, so deactivating again would consume the permanent step.
    if (!alreadyDeprovisioned) {
      await this.#apiRequest({
        path: `/api/v1/users/${ encodeURIComponent(userId) }`,
        method: 'delete',
        logTag: 'deleteUser/deactivate',
        allow404: true,
      })
    }

    if (!confirmPermanentDelete) {
      return { deleted: true, userId, permanent: false }
    }

    // Phase 2 - permanent delete. A 404 here means the user was already permanently removed
    // (e.g. the deactivate step on an ACTIVE user that Okta already had as DEPROVISIONED), which is
    // a success for an idempotent delete, not an error.
    await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }`,
      method: 'delete',
      logTag: 'deleteUser/permanent',
      allow404: true,
    })

    return { deleted: true, userId, permanent: true }
  }

  /**
   * @operationName Get User Groups
   * @category Users
   * @description Lists every group a user belongs to. Use this to audit a user's group memberships.
   * @route POST /get-user-groups
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"List every group this user belongs to."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"00g1emaKYZTWRYYRRTSK","profile":{"name":"West Coast users"},"type":"OKTA_GROUP"}]}
   */
  async getUserGroups(userId) {
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/groups`,
      logTag: 'getUserGroups',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName List Assigned App Links
   * @category Users
   * @description Lists the application links (apps) assigned to a user - the apps they see on their Okta dashboard. Use this to see what a user can access.
   * @route POST /list-assigned-app-links
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"List the application links (apps) assigned to this user."}
   * @returns {Object}
   * @sampleResult {"items":[{"appName":"salesforce","appInstanceId":"0oafxqCAJWWGELFTYASJ","label":"Salesforce","linkUrl":"https://org.okta.com/home/salesforce/0oa/link","logoUrl":"https://org.okta.com/img/logos/salesforce_logo.png"}]}
   */
  async listAssignedAppLinks(userId) {
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/appLinks`,
      logTag: 'listAssignedAppLinks',
    })

    return this.#listResult(result)
  }

  // ==========================================================================
  //  USER LIFECYCLE
  // ==========================================================================
  /**
   * @operationName Activate User
   * @category User Lifecycle
   * @description Activates a STAGED or DEPROVISIONED user (status moves to ACTIVE, asynchronously). With the email off, returns an activation URL/token you can deliver yourself.
   * @route POST /activate-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Activate a STAGED or DEPROVISIONED user. Async — status moves to ACTIVE."}
   * @paramDef {"type":"Boolean","label":"Send Activation Email","name":"sendEmail","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When on, Okta emails the user an activation link. When off, returns an activation URL/token."}
   * @returns {Object}
   * @sampleResult {"activationUrl":"https://org.okta.com/welcome/XE6wE17zmphl3KqAPFxO","activationToken":"XE6wE17zmphl3KqAPFxO"}
   */
  async activateUser(userId, sendEmail) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserLifecycle/ (Activate a User)
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/lifecycle/activate`,
      method: 'post',
      query: { sendEmail: sendEmail === undefined ? true : sendEmail },
      logTag: 'activateUser',
    })

    return result.body || {}
  }

  /**
   * @operationName Deactivate User
   * @category User Lifecycle
   * @description Deactivates a user (status moves to DEPROVISIONED), removing their access. Use this to offboard someone without permanently deleting the account.
   * @route POST /deactivate-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Deactivate a user (status moves to DEPROVISIONED). Removes their access."}
   * @paramDef {"type":"Boolean","label":"Send Deactivation Email","name":"sendEmail","defaultValue":false,"uiComponent":{"type":"TOGGLE"},"description":"When on, Okta emails the user that their account was deactivated."}
   * @returns {Object}
   * @sampleResult {"result":"DEPROVISIONED","userId":"00ub0oNGTSWTBKOLGLNR"}
   */
  async deactivateUser(userId, sendEmail) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserLifecycle/ (Deactivate a User)
    await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/lifecycle/deactivate`,
      method: 'post',
      query: { sendEmail: sendEmail === undefined ? false : sendEmail },
      logTag: 'deactivateUser',
    })

    return { result: 'DEPROVISIONED', userId }
  }

  /**
   * @operationName Suspend User
   * @category User Lifecycle
   * @description Suspends an ACTIVE user (status moves to SUSPENDED) so they cannot sign in, while keeping their assignments. Use this for a temporary hold; unsuspend to restore.
   * @route POST /suspend-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Suspend an ACTIVE user (status moves to SUSPENDED). They cannot sign in; assignments are retained."}
   * @returns {Object}
   * @sampleResult {"result":"SUSPENDED","userId":"00ub0oNGTSWTBKOLGLNR"}
   */
  async suspendUser(userId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserLifecycle/ (Suspend a User)
    await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/lifecycle/suspend`,
      method: 'post',
      logTag: 'suspendUser',
    })

    return { result: 'SUSPENDED', userId }
  }

  /**
   * @operationName Unsuspend User
   * @category User Lifecycle
   * @description Returns a SUSPENDED user to ACTIVE so they can sign in again. Use this to restore access after a temporary suspension.
   * @route POST /unsuspend-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Return a SUSPENDED user to ACTIVE."}
   * @returns {Object}
   * @sampleResult {"result":"ACTIVE","userId":"00ub0oNGTSWTBKOLGLNR"}
   */
  async unsuspendUser(userId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserLifecycle/ (Unsuspend a User)
    await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/lifecycle/unsuspend`,
      method: 'post',
      logTag: 'unsuspendUser',
    })

    return { result: 'ACTIVE', userId }
  }

  /**
   * @operationName Unlock User
   * @category User Lifecycle
   * @description Unlocks a LOCKED_OUT user (returns to ACTIVE) so they can sign in with their current password. Use this when too many failed sign-ins have locked someone out.
   * @route POST /unlock-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Unlock a LOCKED_OUT user so they can sign in with their current password."}
   * @returns {Object}
   * @sampleResult {"result":"ACTIVE","userId":"00ub0oNGTSWTBKOLGLNR"}
   */
  async unlockUser(userId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserLifecycle/ (Unlock a User)
    await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/lifecycle/unlock`,
      method: 'post',
      logTag: 'unlockUser',
    })

    return { result: 'ACTIVE', userId }
  }

  /**
   * @operationName Expire Password
   * @category User Lifecycle
   * @description Expires a user's password (status moves to PASSWORD_EXPIRED), forcing a reset at their next sign-in. Use this to require a password change.
   * @route POST /expire-password
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Force the user to reset their password at next sign-in (status moves to PASSWORD_EXPIRED)."}
   * @returns {Object}
   * @sampleResult {"id":"00ub0oNGTSWTBKOLGLNR","status":"PASSWORD_EXPIRED"}
   */
  async expirePassword(userId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserCred/ (Expire Password)
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/lifecycle/expire_password`,
      method: 'post',
      logTag: 'expirePassword',
    })

    return result.body || { id: userId, status: 'PASSWORD_EXPIRED' }
  }

  /**
   * @operationName Reset Password
   * @category User Lifecycle
   * @description Begins a password reset for a user. With the email off, returns a one-time reset URL you can deliver yourself. Use this to help a user recover access.
   * @route POST /reset-password
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Begin a password reset. With email off, returns a one-time reset URL you can deliver yourself."}
   * @paramDef {"type":"Boolean","label":"Send Reset Email","name":"sendEmail","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When on, Okta emails the reset link. When off, returns resetPasswordUrl."}
   * @returns {Object}
   * @sampleResult {"resetPasswordUrl":"https://org.okta.com/reset_password/XE6wE17zmphl3KqAPFxO"}
   */
  async resetPassword(userId, sendEmail) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserCred/ (Reset Password)
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/lifecycle/reset_password`,
      method: 'post',
      query: { sendEmail: sendEmail === undefined ? true : sendEmail },
      logTag: 'resetPassword',
    })

    return result.body || {}
  }

  /**
   * @operationName Reset Factors
   * @category User Lifecycle
   * @description Resets (clears) all enrolled MFA factors for a user, forcing re-enrollment. Use this when a user loses their device or you suspect their MFA is compromised.
   * @route POST /reset-factors
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Reset (clear) all enrolled MFA factors for the user, forcing re-enrollment."}
   * @returns {Object}
   * @sampleResult {"result":"RESET","userId":"00ub0oNGTSWTBKOLGLNR"}
   */
  async resetFactors(userId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserLifecycle/ (Reset Factors)
    await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/lifecycle/reset_factors`,
      method: 'post',
      logTag: 'resetFactors',
    })

    return { result: 'RESET', userId }
  }

  /**
   * @operationName Change Password
   * @category User Lifecycle
   * @description Changes a user's password when the current password is known (self-service style). The new password must meet the org's password policy. (Mutates live credentials.)
   * @route POST /change-password
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Change a user's password when the current password is known (self-service style)."}
   * @paramDef {"type":"String","label":"Current Password","name":"oldPassword","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user's current password (sent as oldPassword.value)."}
   * @paramDef {"type":"String","label":"New Password","name":"newPassword","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The new password (sent as newPassword.value); must meet the org's password policy."}
   * @paramDef {"type":"Boolean","label":"Revoke Other Sessions","name":"revokeSessions","defaultValue":false,"uiComponent":{"type":"TOGGLE"},"description":"When on, signs the user out of all other sessions."}
   * @returns {Object}
   * @sampleResult {"credentials":{"provider":{"type":"OKTA","name":"OKTA"}}}
   */
  async changePassword(userId, oldPassword, newPassword, revokeSessions) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserCred/ (Change Password)
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/credentials/change_password`,
      method: 'post',
      body: {
        oldPassword: { value: oldPassword },
        newPassword: { value: newPassword },
        revokeSessions: revokeSessions === undefined ? false : revokeSessions,
      },
      logTag: 'changePassword',
    })

    return result.body
  }

  /**
   * @operationName Set Password
   * @category User Lifecycle
   * @description Admin-sets a user's password directly, with no current password needed. Use this to reset the password for a user you manage. The new password must meet the org's password policy.
   * @route POST /set-password
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Admin-set a user's password directly (no current password needed). Use to reset for a user you manage."}
   * @paramDef {"type":"String","label":"New Password","name":"newPassword","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The new password (sent as credentials.password.value); must meet the org's password policy."}
   * @returns {Object}
   * @sampleResult {"id":"00ub0oNGTSWTBKOLGLNR","status":"ACTIVE","credentials":{"provider":{"type":"OKTA","name":"OKTA"}}}
   */
  async setPassword(userId, newPassword) {
    // docs: https://developer.okta.com/docs/reference/api/users/ (Credentials object -> password.value; partial update POST /users/{id})
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }`,
      method: 'post',
      body: { credentials: { password: { value: newPassword } } },
      logTag: 'setPassword',
    })

    return result.body
  }

  // ==========================================================================
  //  GROUPS - CRUD + membership
  // ==========================================================================
  /**
   * @operationName Create Group
   * @category Groups
   * @description Creates a new Okta group with a name and optional description. Use this to organize users for access assignment or rules.
   * @route POST /create-group
   * @paramDef {"type":"String","label":"Group Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The group's display name (profile.name)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description (profile.description)."}
   * @returns {Object}
   * @sampleResult {"id":"00g1emaKYZTWRYYRRTSK","type":"OKTA_GROUP","profile":{"name":"West Coast users","description":"All users West of The Rockies"}}
   */
  async createGroup(name, description) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Group/ (Create a Group)
    const profile = { name }

    if (description) {
      profile.description = description
    }

    const result = await this.#apiRequest({
      path: '/api/v1/groups',
      method: 'post',
      body: { profile },
      logTag: 'createGroup',
    })

    return result.body
  }

  /**
   * @operationName Get Group
   * @category Groups
   * @description Retrieves a single group's details by id. Use this to read a group before updating it or managing its membership.
   * @route POST /get-group
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The group to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"00g1emaKYZTWRYYRRTSK","type":"OKTA_GROUP","profile":{"name":"West Coast users"}}
   */
  async getGroup(groupId) {
    const result = await this.#apiRequest({
      path: `/api/v1/groups/${ encodeURIComponent(groupId) }`,
      logTag: 'getGroup',
    })

    return result.body
  }

  /**
   * @operationName List Groups
   * @category Groups
   * @description Lists groups in your org, optionally narrowed by a quick search or a SCIM-style filter. Returns a page plus a cursor for the next page. Use this to find or enumerate groups.
   * @route POST /list-groups
   * @paramDef {"type":"String","label":"Quick Search","name":"q","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Matches the group name (starts-with). Leave blank to list all groups."}
   * @paramDef {"type":"String","label":"Search Expression","name":"searchExpression","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"SCIM-style filter, e.g. type eq \"OKTA_GROUP\". Advanced."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","defaultValue":200,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max results per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"after","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from the previous page's next link."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"00g1emaKYZTWRYYRRTSK","type":"OKTA_GROUP","profile":{"name":"West Coast users"}}],"cursor":null}
   */
  async listGroups(q, searchExpression, limit, after) {
    const query = { limit: limit || 200 }

    if (searchExpression) {
      query.search = searchExpression
    } else if (q) {
      query.q = q
    }

    if (after) {
      query.after = after
    }

    const result = await this.#apiRequest({ path: '/api/v1/groups', query, logTag: 'listGroups' })

    return this.#listResult(result)
  }

  /**
   * @operationName Update Group
   * @category Groups
   * @description Replaces an Okta group's profile (name and description). Only OKTA_GROUP profiles can be edited - app and built-in groups cannot. Use this to rename or re-describe a group.
   * @route POST /update-group
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OKTA_GROUP to update. App/built-in group profiles cannot be edited."}
   * @paramDef {"type":"String","label":"Group Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The group's name (replaces profile.name)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The group's description (replaces profile.description)."}
   * @returns {Object}
   * @sampleResult {"id":"00g1emaKYZTWRYYRRTSK","type":"OKTA_GROUP","profile":{"name":"West Coast users","description":"All users West of The Rockies"}}
   */
  async updateGroup(groupId, name, description) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Group/ (Update a Group - PUT)
    const profile = { name }

    if (description !== undefined && description !== null) {
      profile.description = description
    }

    const result = await this.#apiRequest({
      path: `/api/v1/groups/${ encodeURIComponent(groupId) }`,
      method: 'put',
      body: { profile },
      logTag: 'updateGroup',
    })

    return result.body
  }

  /**
   * @operationName Delete Group
   * @category Groups
   * @description Permanently deletes an Okta group. Members are not deleted, only the group. Destructive - use with care.
   * @route POST /delete-group
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Permanently delete an OKTA_GROUP."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"groupId":"00g1emaKYZTWRYYRRTSK"}
   */
  async deleteGroup(groupId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Group/ (Delete a Group)
    await this.#apiRequest({
      path: `/api/v1/groups/${ encodeURIComponent(groupId) }`,
      method: 'delete',
      logTag: 'deleteGroup',
    })

    return { deleted: true, groupId }
  }

  /**
   * @operationName Add User to Group
   * @category Groups
   * @description Adds a user to a group. Use this to grant the user whatever access the group confers.
   * @route POST /add-user-to-group
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The group to add the user to."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user to add."}
   * @returns {Object}
   * @sampleResult {"added":true,"groupId":"00g1emaKYZTWRYYRRTSK","userId":"00ub0oNGTSWTBKOLGLNR"}
   */
  async addUserToGroup(groupId, userId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Group/ (Assign a User to a Group - PUT, empty body)
    await this.#apiRequest({
      path: `/api/v1/groups/${ encodeURIComponent(groupId) }/users/${ encodeURIComponent(userId) }`,
      method: 'put',
      logTag: 'addUserToGroup',
    })

    return { added: true, groupId, userId }
  }

  /**
   * @operationName Remove User from Group
   * @category Groups
   * @description Removes a user from a group, revoking any access the group conferred. Destructive - use with care.
   * @route POST /remove-user-from-group
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The group to remove the user from."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user to remove."}
   * @returns {Object}
   * @sampleResult {"removed":true,"groupId":"00g1emaKYZTWRYYRRTSK","userId":"00ub0oNGTSWTBKOLGLNR"}
   */
  async removeUserFromGroup(groupId, userId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Group/ (Unassign a User from a Group)
    await this.#apiRequest({
      path: `/api/v1/groups/${ encodeURIComponent(groupId) }/users/${ encodeURIComponent(userId) }`,
      method: 'delete',
      logTag: 'removeUserFromGroup',
    })

    return { removed: true, groupId, userId }
  }

  /**
   * @operationName List Group Members
   * @category Groups
   * @description Lists the users who are members of a group. Returns a page plus a cursor for the next page. Use this to audit who is in a group.
   * @route POST /list-group-members
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"List the users who are members of this group."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","defaultValue":200,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max results per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"after","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from the previous page's next link."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"00ub0oNGTSWTBKOLGLNR","status":"ACTIVE","profile":{"firstName":"Isaac","lastName":"Brock","email":"isaac.brock@example.com"}}],"cursor":null}
   */
  async listGroupMembers(groupId, limit, after) {
    const query = { limit: limit || 200 }

    if (after) {
      query.after = after
    }

    const result = await this.#apiRequest({
      path: `/api/v1/groups/${ encodeURIComponent(groupId) }/users`,
      query,
      logTag: 'listGroupMembers',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName List Assigned Apps for Group
   * @category Groups
   * @description Lists the applications assigned to a group - every member of the group gets these apps. Use this to see what access a group grants.
   * @route POST /list-assigned-apps-for-group
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"List the applications assigned to this group."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"0oafxqCAJWWGELFTYASJ","name":"salesforce","label":"Salesforce","status":"ACTIVE"}]}
   */
  async listAssignedAppsForGroup(groupId) {
    const result = await this.#apiRequest({
      path: `/api/v1/groups/${ encodeURIComponent(groupId) }/apps`,
      logTag: 'listAssignedAppsForGroup',
    })

    return this.#listResult(result)
  }

  // ==========================================================================
  //  GROUP RULES
  // ==========================================================================
  /**
   * @operationName Create Group Rule
   * @category Group Rules
   * @description Creates a group rule that auto-assigns matching users into one or more groups based on an Okta Expression Language condition. Created INACTIVE - activate it to start applying. Use this to automate group membership.
   * @route POST /create-group-rule
   * @paramDef {"type":"String","label":"Rule Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A name for the rule (e.g. Engineering group rule)."}
   * @paramDef {"type":"String","label":"Match Expression","name":"expression","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Okta Expression Language condition, e.g. user.role==\"Engineer\". Users matching it are auto-assigned."}
   * @paramDef {"type":"Array<String>","label":"Target Groups","name":"groupIds","required":true,"dictionary":"getGroupsDictionary","description":"The groups matching users are assigned to (actions.assignUserToGroups.groupIds). Pick one or more."}
   * @paramDef {"type":"Array<String>","label":"Excluded Users","name":"excludeUserIds","dictionary":"getUsersDictionary","description":"Optional users to exclude from the rule (conditions.people.users.exclude)."}
   * @returns {Object}
   * @sampleResult {"id":"0pr3f7zMZZHPgUoWO0g4","status":"INACTIVE","name":"Engineering group rule","actions":{"assignUserToGroups":{"groupIds":["00gjitX9HqABSoqTB0g3"]}}}
   */
  async createGroupRule(name, expression, groupIds, excludeUserIds) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/GroupRule/ (Create a Group Rule)
    const groups = Array.isArray(groupIds) ? groupIds : String(groupIds || '').split(',').map(s => s.trim()).filter(Boolean)
    const excludeUsers = Array.isArray(excludeUserIds)
      ? excludeUserIds
      : String(excludeUserIds || '').split(',').map(s => s.trim()).filter(Boolean)

    const body = {
      type: 'group_rule',
      name,
      conditions: {
        people: {
          users: { exclude: excludeUsers },
          groups: { exclude: [] },
        },
        expression: { value: expression, type: EXPRESSION_TYPE },
      },
      actions: { assignUserToGroups: { groupIds: groups } },
    }

    const result = await this.#apiRequest({
      path: '/api/v1/groups/rules',
      method: 'post',
      body,
      logTag: 'createGroupRule',
    })

    return result.body
  }

  /**
   * @operationName List Group Rules
   * @category Group Rules
   * @description Lists the group rules in your org. Returns a page plus a cursor for the next page. Use this to find a rule to activate, deactivate, or delete.
   * @route POST /list-group-rules
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","defaultValue":50,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max rules per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"after","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from the previous page's next link."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"0pr3f7zMZZHPgUoWO0g4","status":"ACTIVE","name":"Engineering group rule"}],"cursor":null}
   */
  async listGroupRules(limit, after) {
    const query = { limit: limit || 50 }

    if (after) {
      query.after = after
    }

    const result = await this.#apiRequest({ path: '/api/v1/groups/rules', query, logTag: 'listGroupRules' })

    return this.#listResult(result)
  }

  /**
   * @operationName Activate Group Rule
   * @category Group Rules
   * @description Activates a group rule so it begins evaluating and assigning matching users. Use this after creating or editing a rule.
   * @route POST /activate-group-rule
   * @paramDef {"type":"String","label":"Group Rule","name":"ruleId","required":true,"dictionary":"getGroupRulesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The rule to activate (start applying it)."}
   * @returns {Object}
   * @sampleResult {"activated":true,"ruleId":"0pr3f7zMZZHPgUoWO0g4"}
   */
  async activateGroupRule(ruleId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/GroupRule/ (Activate a Group Rule)
    await this.#apiRequest({
      path: `/api/v1/groups/rules/${ encodeURIComponent(ruleId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateGroupRule',
    })

    return { activated: true, ruleId }
  }

  /**
   * @operationName Deactivate Group Rule
   * @category Group Rules
   * @description Deactivates a group rule so it stops evaluating. A rule must be deactivated before it can be deleted. Use this to pause automated assignment.
   * @route POST /deactivate-group-rule
   * @paramDef {"type":"String","label":"Group Rule","name":"ruleId","required":true,"dictionary":"getGroupRulesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The rule to deactivate (stop applying it). Required before deletion."}
   * @returns {Object}
   * @sampleResult {"deactivated":true,"ruleId":"0pr3f7zMZZHPgUoWO0g4"}
   */
  async deactivateGroupRule(ruleId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/GroupRule/ (Deactivate a Group Rule)
    await this.#apiRequest({
      path: `/api/v1/groups/rules/${ encodeURIComponent(ruleId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateGroupRule',
    })

    return { deactivated: true, ruleId }
  }

  /**
   * @operationName Delete Group Rule
   * @category Group Rules
   * @description Deletes a group rule. The rule must be INACTIVE first (deactivate it before deleting). Destructive - use with care.
   * @route POST /delete-group-rule
   * @paramDef {"type":"String","label":"Group Rule","name":"ruleId","required":true,"dictionary":"getGroupRulesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Delete a rule. The rule must be INACTIVE (deactivate it first)."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"ruleId":"0pr3f7zMZZHPgUoWO0g4"}
   */
  async deleteGroupRule(ruleId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/GroupRule/ (Delete a Group Rule)
    await this.#apiRequest({
      path: `/api/v1/groups/rules/${ encodeURIComponent(ruleId) }`,
      method: 'delete',
      logTag: 'deleteGroupRule',
    })

    return { deleted: true, ruleId }
  }

  // ==========================================================================
  //  APPLICATIONS - list/read + assignments
  // ==========================================================================
  /**
   * @operationName List Applications
   * @category Applications
   * @description Lists the applications configured in your org, optionally narrowed by a quick search or filter. Returns a page plus a cursor for the next page. Use this to find an app to assign users or groups to.
   * @route POST /list-applications
   * @paramDef {"type":"String","label":"Quick Search","name":"q","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Matches the app name/label. Leave blank to list all apps."}
   * @paramDef {"type":"String","label":"Filter Expression","name":"searchExpression","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"SCIM-style filter, e.g. status eq \"ACTIVE\". Advanced."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","defaultValue":20,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max results per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"after","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from the previous page's next link."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"0oafxqCAJWWGELFTYASJ","name":"salesforce","label":"Salesforce","status":"ACTIVE","signOnMode":"SAML_2_0"}],"cursor":null}
   */
  async listApplications(q, searchExpression, limit, after) {
    const query = { limit: limit || 20 }

    if (searchExpression) {
      query.filter = searchExpression
    } else if (q) {
      query.q = q
    }

    if (after) {
      query.after = after
    }

    const result = await this.#apiRequest({ path: '/api/v1/apps', query, logTag: 'listApplications' })

    return this.#listResult(result)
  }

  /**
   * @operationName Get Application
   * @category Applications
   * @description Retrieves a single application's details by id. Use this to inspect an app's sign-on mode and status before assigning users or groups.
   * @route POST /get-application
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"0oafxqCAJWWGELFTYASJ","name":"salesforce","label":"Salesforce","status":"ACTIVE","signOnMode":"SAML_2_0"}
   */
  async getApplication(appId) {
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }`,
      logTag: 'getApplication',
    })

    return result.body
  }

  /**
   * @operationName Assign User to Application
   * @category Applications
   * @description Assigns a user to an application, optionally with an app-specific username. Use this to grant one person access to an app. (Requires a pre-configured app instance.)
   * @route POST /assign-user-to-application
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application to assign the user to."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user to assign (sent as the body id)."}
   * @paramDef {"type":"String","label":"App Username","name":"appUsername","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional username for the user in the target app (credentials.userName). Defaults to the Okta login."}
   * @returns {Object}
   * @sampleResult {"id":"00ub0oNGTSWTBKOLGLNR","scope":"USER","status":"ACTIVE","credentials":{"userName":"isaac.brock@example.com"}}
   */
  async assignUserToApplication(appId, userId, appUsername) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Application/ (Assign a User to an Application)
    const body = { id: userId, scope: 'USER' }

    if (appUsername) {
      body.credentials = { userName: appUsername }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/users`,
      method: 'post',
      body,
      logTag: 'assignUserToApplication',
    })

    return result.body
  }

  /**
   * @operationName Unassign User from Application
   * @category Applications
   * @description Removes a user's assignment to an application, revoking their access to it. Destructive - use with care.
   * @route POST /unassign-user-from-application
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application to remove the user from."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user to unassign."}
   * @returns {Object}
   * @sampleResult {"removed":true,"appId":"0oafxqCAJWWGELFTYASJ","userId":"00ub0oNGTSWTBKOLGLNR"}
   */
  async unassignUserFromApplication(appId, userId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Application/ (Unassign a User from an Application)
    await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/users/${ encodeURIComponent(userId) }`,
      method: 'delete',
      logTag: 'unassignUserFromApplication',
    })

    return { removed: true, appId, userId }
  }

  /**
   * @operationName Assign Group to Application
   * @category Applications
   * @description Assigns a group to an application - every member of the group gets the app. Optionally set an assignment priority. Use this to grant a whole team access at once. (Requires a pre-configured app instance.)
   * @route POST /assign-group-to-application
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application to assign the group to."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The group to assign — all its members get the app."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional assignment priority (lower wins on conflicts)."}
   * @returns {Object}
   * @sampleResult {"id":"00g1emaKYZTWRYYRRTSK","priority":0,"profile":{}}
   */
  async assignGroupToApplication(appId, groupId, priority) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Application/ (Assign a Group to an Application - PUT, optional body)
    const body = priority === undefined || priority === null ? undefined : { priority }

    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/groups/${ encodeURIComponent(groupId) }`,
      method: 'put',
      body,
      logTag: 'assignGroupToApplication',
    })

    return result.body
  }

  /**
   * @operationName Remove Group from Application
   * @category Applications
   * @description Removes a group's assignment to an application, revoking the app for its members (unless granted another way). Destructive - use with care.
   * @route POST /remove-group-from-application
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application to remove the group from."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The group to unassign."}
   * @returns {Object}
   * @sampleResult {"removed":true,"appId":"0oafxqCAJWWGELFTYASJ","groupId":"00g1emaKYZTWRYYRRTSK"}
   */
  async removeGroupFromApplication(appId, groupId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Application/ (Unassign a Group from an Application)
    await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/groups/${ encodeURIComponent(groupId) }`,
      method: 'delete',
      logTag: 'removeGroupFromApplication',
    })

    return { removed: true, appId, groupId }
  }

  /**
   * @operationName List Application Users
   * @category Applications
   * @description Lists the users assigned to an application. Returns a page plus a cursor for the next page. Use this to audit who has access to an app.
   * @route POST /list-application-users
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"List the users assigned to this application."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","defaultValue":50,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max results per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"after","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from the previous page's next link."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"00ub0oNGTSWTBKOLGLNR","scope":"USER","status":"ACTIVE","credentials":{"userName":"isaac.brock@example.com"}}],"cursor":null}
   */
  async listApplicationUsers(appId, limit, after) {
    const query = { limit: limit || 50 }

    if (after) {
      query.after = after
    }

    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/users`,
      query,
      logTag: 'listApplicationUsers',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName List Application Group Assignments
   * @category Applications
   * @description Lists the group assignments for an application - which groups grant this app to their members. Use this to audit group-based access to an app.
   * @route POST /list-application-group-assignments
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"List the group assignments for this application."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"00g1emaKYZTWRYYRRTSK","priority":0,"profile":{}}]}
   */
  async listApplicationGroupAssignments(appId) {
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/groups`,
      logTag: 'listApplicationGroupAssignments',
    })

    return this.#listResult(result)
  }

  // ==========================================================================
  //  ADMIN ROLES (user)
  // ==========================================================================
  /**
   * @operationName Assign Role to User
   * @category Admin Roles
   * @description Grants a standard Okta admin role to a user. Use this to delegate administrative privileges such as Help Desk or App Administrator.
   * @route POST /assign-role-to-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user to grant an admin role to."}
   * @paramDef {"type":"String","label":"Admin Role","name":"roleType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Super Administrator","Organizational Administrator","Application Administrator","Group Administrator (User Admin)","Help Desk Administrator","Read-Only Administrator","Group Membership Administrator","API Access Management Administrator","Report Administrator"]}},"description":"The standard admin role to assign (body type)."}
   * @returns {Object}
   * @sampleResult {"id":"ra1b2c3d4e5","label":"API Access Management Administrator","type":"API_ACCESS_MANAGEMENT_ADMIN","status":"ACTIVE"}
   */
  async assignRoleToUser(userId, roleType) {
    roleType = this.#resolveChoice(roleType, ADMIN_ROLE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/RoleAssignmentAUser/ (Assign a Role to a User)
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/roles`,
      method: 'post',
      body: { type: roleType },
      logTag: 'assignRoleToUser',
    })

    return result.body
  }

  /**
   * @operationName List Roles Assigned to User
   * @category Admin Roles
   * @description Lists the admin roles assigned to a user. Use this to audit a user's administrative privileges, or to find the assignment id needed to remove a role.
   * @route POST /list-roles-assigned-to-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"List the admin roles assigned to this user."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"ra1b2c3d4e5","label":"Application Administrator","type":"APP_ADMIN","status":"ACTIVE"}]}
   */
  async listRolesAssignedToUser(userId) {
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/roles`,
      logTag: 'listRolesAssignedToUser',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Remove Role from User
   * @category Admin Roles
   * @description Removes an admin role from a user using the role ASSIGNMENT id (from List Roles Assigned to User - not the role type). Destructive - use with care.
   * @route POST /remove-role-from-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user to remove a role from."}
   * @paramDef {"type":"String","label":"Role Assignment","name":"roleAssignmentId","required":true,"dictionary":"getUserRoleAssignmentsDictionary","dependsOn":["userId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The role ASSIGNMENT id to remove (from List Roles Assigned to User — not the role type)."}
   * @returns {Object}
   * @sampleResult {"removed":true,"userId":"00ub0oNGTSWTBKOLGLNR","roleAssignmentId":"ra1b2c3d4e5"}
   */
  async removeRoleFromUser(userId, roleAssignmentId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/RoleAssignmentAUser/ (Unassign a Role from a User)
    await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/roles/${ encodeURIComponent(roleAssignmentId) }`,
      method: 'delete',
      logTag: 'removeRoleFromUser',
    })

    return { removed: true, userId, roleAssignmentId }
  }

  // ==========================================================================
  //  MFA FACTORS
  // ==========================================================================
  /**
   * @operationName List Factors
   * @category MFA Factors
   * @description Lists the MFA factors a user has enrolled (SMS, TOTP app, push, etc.) with their status. Use this to audit a user's multi-factor setup or to find a factor to activate or reset.
   * @route POST /list-factors
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"List the MFA factors this user has enrolled."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"sms1Ll5Gn79kQ80T0g4","factorType":"sms","provider":"OKTA","status":"ACTIVE","profile":{"phoneNumber":"+1 XXX-XXX-1337"}}]}
   */
  async listFactors(userId) {
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/factors`,
      logTag: 'listFactors',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Enroll Factor
   * @category MFA Factors
   * @description Enrolls a new MFA factor for a user (e.g. SMS, voice, email, or an authenticator app). SMS/voice/email enrollment sends a real message that the user confirms via Activate Factor. Use this to set up multi-factor for someone.
   * @route POST /enroll-factor
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user to enroll a new MFA factor for."}
   * @paramDef {"type":"String","label":"Factor Type","name":"factorType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["SMS (Text Message)","Voice Call","Email","Authenticator App (TOTP)","Okta Verify Push"]}},"description":"The kind of MFA factor to enroll. (The Security Question factor is not offered here — it needs a question and answer this action does not collect.)"}
   * @paramDef {"type":"String","label":"Provider","name":"provider","required":true,"defaultValue":"Okta","uiComponent":{"type":"DROPDOWN","options":{"values":["Okta","Google","RSA","Symantec"]}},"description":"The factor provider (usually Okta)."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Phone number for SMS/Voice factors (profile.phoneNumber), e.g. +1-555-415-1337."}
   * @paramDef {"type":"String","label":"Email","name":"email","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email address for the email factor (profile.email)."}
   * @returns {Object}
   * @sampleResult {"id":"sms1Ll5Gn79kQ80T0g4","factorType":"sms","provider":"OKTA","status":"PENDING_ACTIVATION","profile":{"phoneNumber":"+1-555-415-1337"}}
   */
  async enrollFactor(userId, factorType, provider, phoneNumber, email) {
    factorType = this.#resolveChoice(factorType, ENROLL_FACTOR_TYPE_LABELS)
    provider = this.#resolveChoice(provider, FACTOR_PROVIDER_LABELS)

    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserFactor/ (Enroll a Factor)
    // Guard the factor types that require a profile field so a missing value is a clear message
    // here, not an opaque provider 400 mid-flow.
    if ((factorType === 'sms' || factorType === 'call') && !phoneNumber) {
      throw new Error('Phone Number is required for SMS and Voice Call factors — provide it in E.164 form, e.g. +1-555-415-1337.')
    }

    if (factorType === 'email' && !email) {
      throw new Error('Email is required for the Email factor — provide the address to send the code to.')
    }

    const profile = {}

    if (phoneNumber) {
      profile.phoneNumber = phoneNumber
    }

    if (email) {
      profile.email = email
    }

    const body = { factorType, provider: provider || 'OKTA' }

    if (Object.keys(profile).length > 0) {
      body.profile = profile
    }

    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/factors`,
      method: 'post',
      body,
      logTag: 'enrollFactor',
    })

    return result.body
  }

  /**
   * @operationName Activate Factor
   * @category MFA Factors
   * @description Activates a PENDING_ACTIVATION factor using the one-time code the user received out-of-band (SMS/email/TOTP). Use this to finish enrolling a factor after Enroll Factor.
   * @route POST /activate-factor
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user whose factor is being activated."}
   * @paramDef {"type":"String","label":"Factor","name":"factorId","required":true,"dictionary":"getUserFactorsDictionary","dependsOn":["userId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The PENDING_ACTIVATION factor to activate (from List Factors / Enroll Factor)."}
   * @paramDef {"type":"String","label":"Pass Code","name":"passCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The one-time code the user received (SMS/email/TOTP) to confirm enrollment."}
   * @returns {Object}
   * @sampleResult {"id":"sms1Ll5Gn79kQ80T0g4","factorType":"sms","provider":"OKTA","status":"ACTIVE"}
   */
  async activateFactor(userId, factorId, passCode) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserFactor/ (Activate a Factor)
    const body = passCode ? { passCode } : undefined

    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/factors/${ encodeURIComponent(factorId) }/lifecycle/activate`,
      method: 'post',
      body,
      logTag: 'activateFactor',
    })

    return result.body
  }

  /**
   * @operationName Reset Factor
   * @category MFA Factors
   * @description Removes (unenrolls) an enrolled MFA factor for a user. Use this to clear a single factor - e.g. an old phone - without resetting all of the user's factors. Destructive - use with care.
   * @route POST /reset-factor
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user whose factor is being reset."}
   * @paramDef {"type":"String","label":"Factor","name":"factorId","required":true,"dictionary":"getUserFactorsDictionary","dependsOn":["userId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The enrolled factor to remove (unenroll)."}
   * @returns {Object}
   * @sampleResult {"removed":true,"userId":"00ub0oNGTSWTBKOLGLNR","factorId":"sms1Ll5Gn79kQ80T0g4"}
   */
  async resetFactor(userId, factorId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserFactor/ (Unenroll a Factor)
    await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/factors/${ encodeURIComponent(factorId) }`,
      method: 'delete',
      logTag: 'resetFactor',
    })

    return { removed: true, userId, factorId }
  }

  // ==========================================================================
  //  SYSTEM LOG
  // ==========================================================================
  /**
   * @operationName Get Logs
   * @category System Log
   * @description Reads the org's System Log (audit trail) within a time window, optionally filtered by event type or a keyword. Returns a page plus a cursor for the next page. Use this to investigate activity or pull events for reporting.
   * @route POST /get-logs
   * @paramDef {"type":"String","label":"Since","name":"since","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Lower time bound (ISO-8601) on event publish time. Default: 7 days ago."}
   * @paramDef {"type":"String","label":"Until","name":"until","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Upper time bound (ISO-8601). Default: now."}
   * @paramDef {"type":"String","label":"Event Type Filter","name":"eventType","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional SCIM filter on eventType, e.g. user.lifecycle.create or application.user_membership.add."}
   * @paramDef {"type":"String","label":"Keyword Search","name":"q","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Case-insensitive keyword search across the event (target names, actor, etc)."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","defaultValue":"Oldest First","uiComponent":{"type":"DROPDOWN","options":{"values":["Oldest First","Newest First"]}},"description":"Order results by publish time."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","defaultValue":100,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max events per page (1-1000)."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"after","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from the previous page's next link."}
   * @returns {Object}
   * @sampleResult {"items":[{"uuid":"dc9fd3c0-598c-11ef-8478-2b7584bf8d5a","published":"2024-08-13T15:58:20.353Z","eventType":"user.session.start","severity":"INFO","displayMessage":"User login to Okta","actor":{"id":"00uttidj01jqL21aM1d6","type":"User","displayName":"John Doe"},"outcome":{"result":"SUCCESS","reason":null}}],"cursor":null}
   */
  async getLogs(since, until, eventType, q, sortOrder, limit, after) {
    sortOrder = this.#resolveChoice(sortOrder, LOG_SORT_ORDER_LABELS)
    const result = await this.#apiRequest({
      path: '/api/v1/logs',
      query: this.#buildLogQuery({ since, until, eventType, q, sortOrder, limit, after }),
      logTag: 'getLogs',
    })

    return this.#listResult(result)
  }

  // Builds the System Log query, mapping eventType -> a SCIM `filter` expression.
  #buildLogQuery({ since, until, eventType, q, sortOrder, limit, after }) {
    const query = {}

    if (since) {
      query.since = since
    }

    if (until) {
      query.until = until
    }

    if (eventType) {
      query.filter = `eventType eq "${ eventType }"`
    }

    if (q) {
      query.q = q
    }

    if (sortOrder) {
      query.sortOrder = sortOrder
    }

    if (limit) {
      query.limit = limit
    }

    if (after) {
      query.after = after
    }

    return query
  }

  // ==========================================================================
  //  NETWORK ZONES - CRUD + activate/deactivate
  // ==========================================================================
  /**
   * @operationName List Network Zones
   * @category Network Zones
   * @description Lists the IP and dynamic network zones in your org, optionally narrowed by a SCIM filter. Returns a page plus a cursor for the next page. Use this to find a zone to view, edit, or use in a sign-on policy.
   * @route POST /list-network-zones
   * @paramDef {"type":"String","label":"Filter","name":"filter","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional SCIM filter, e.g. (usage eq \"POLICY\"). Leave blank to list all zones."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","defaultValue":20,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max zones per page (default 20)."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The cursor from a prior page's result; leave blank for the first page."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"nzowc1U5Jh5xuAK0o0g3","name":"MyIpZone","type":"IP","status":"ACTIVE","usage":"POLICY","gateways":[{"type":"CIDR","value":"1.2.3.4/24"}]}],"cursor":null}
   */
  async listNetworkZones(filter, limit, cursor) {
    const query = { limit: limit || 20 }

    if (filter) {
      query.filter = filter
    }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({ path: '/api/v1/zones', query, logTag: 'listNetworkZones' })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Network Zone
   * @category Network Zones
   * @description Creates a network zone - an IP zone (explicit CIDR/range list) or a dynamic zone (geo/ASN-based). Use a Policy zone in sign-on rules, or a Blocklist zone to always block its addresses.
   * @route POST /create-network-zone
   * @paramDef {"type":"String","label":"Zone Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name of the network zone."}
   * @paramDef {"type":"String","label":"Zone Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["IP","Dynamic (Geo/ASN)","Dynamic V2"]}},"description":"IP = explicit CIDR/range list; Dynamic = geo/ASN-based."}
   * @paramDef {"type":"String","label":"Usage","name":"usage","uiComponent":{"type":"DROPDOWN","options":{"values":["Policy","Blocklist"]}},"description":"Policy = used in sign-on policies; Blocklist = always block these IPs. Default Policy."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Initial status. Default Active."}
   * @paramDef {"type":"Array<Object>","label":"Gateway IP Ranges","name":"gateways","uiComponent":{"type":"MULTI_LINE_TEXT"},"schemaLoader":"networkZoneAddressSchema","description":"IP ranges that make up this zone (for IP zones). Each item: {type, value}."}
   * @paramDef {"type":"Array<Object>","label":"Trusted Proxy Ranges","name":"proxies","uiComponent":{"type":"MULTI_LINE_TEXT"},"schemaLoader":"networkZoneAddressSchema","description":"Optional trusted proxy IP ranges. Each item: {type, value}."}
   * @returns {Object}
   * @sampleResult {"id":"nzowb8T5Jh5xuAJ0o0g7","name":"newNetworkZone","type":"IP","status":"ACTIVE","usage":"POLICY","gateways":[{"type":"CIDR","value":"1.2.3.4/24"}],"proxies":[{"type":"CIDR","value":"2.2.3.4/24"}]}
   */
  async createNetworkZone(name, type, usage, status, gateways, proxies) {
    type = this.#resolveChoice(type, NETWORK_ZONE_TYPE_LABELS)
    usage = this.#resolveChoice(usage, NETWORK_ZONE_USAGE_LABELS)
    status = this.#resolveChoice(status, STATUS_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/NetworkZone/ (Create a Network Zone - CreateIPPolicyNetworkZone)
    const body = { name, type }

    if (usage) {
      body.usage = usage
    }

    if (status) {
      body.status = status
    }

    const gw = this.#normalizeAddressList(gateways)
    const px = this.#normalizeAddressList(proxies)

    if (gw) {
      body.gateways = gw
    }

    if (px) {
      body.proxies = px
    }

    const result = await this.#apiRequest({
      path: '/api/v1/zones',
      method: 'post',
      body,
      logTag: 'createNetworkZone',
    })

    return result.body
  }

  /**
   * @operationName Get Network Zone
   * @category Network Zones
   * @description Retrieves a single network zone by id, including its gateways and proxies. Use this to inspect a zone before editing it.
   * @route POST /get-network-zone
   * @paramDef {"type":"String","label":"Network Zone","name":"zoneId","required":true,"dictionary":"getNetworkZonesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The network zone to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"nzowc1U5Jh5xuAK0o0g3","name":"MyIpZone","type":"IP","status":"ACTIVE","usage":"POLICY","gateways":[{"type":"CIDR","value":"1.2.3.4/24"}]}
   */
  async getNetworkZone(zoneId) {
    const result = await this.#apiRequest({
      path: `/api/v1/zones/${ encodeURIComponent(zoneId) }`,
      logTag: 'getNetworkZone',
    })

    return result.body
  }

  /**
   * @operationName Update Network Zone
   * @category Network Zones
   * @description Replaces a network zone (PUT is a full replace - supply the name, type, and the complete set of gateways/proxies). Use this to edit a zone's address ranges or usage.
   * @route POST /update-network-zone
   * @paramDef {"type":"String","label":"Network Zone","name":"zoneId","required":true,"dictionary":"getNetworkZonesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The zone to replace. PUT is a full replace — supply name, type and all gateways/proxies."}
   * @paramDef {"type":"String","label":"Zone Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name."}
   * @paramDef {"type":"String","label":"Zone Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["IP","Dynamic (Geo/ASN)","Dynamic V2"]}},"description":"Must match the existing zone's type."}
   * @paramDef {"type":"String","label":"Usage","name":"usage","uiComponent":{"type":"DROPDOWN","options":{"values":["Policy","Blocklist"]}},"description":"Policy or Blocklist."}
   * @paramDef {"type":"Array<Object>","label":"Gateway IP Ranges","name":"gateways","uiComponent":{"type":"MULTI_LINE_TEXT"},"schemaLoader":"networkZoneAddressSchema","description":"Full replacement set of gateway ranges. Each item: {type, value}."}
   * @paramDef {"type":"Array<Object>","label":"Trusted Proxy Ranges","name":"proxies","uiComponent":{"type":"MULTI_LINE_TEXT"},"schemaLoader":"networkZoneAddressSchema","description":"Full replacement set of trusted proxy ranges. Each item: {type, value}."}
   * @returns {Object}
   * @sampleResult {"id":"nzovw2rFz2YoqmvwZ0g9","name":"UpdatedNetZone","type":"IP","status":"ACTIVE","usage":"POLICY"}
   */
  async updateNetworkZone(zoneId, name, type, usage, gateways, proxies) {
    type = this.#resolveChoice(type, NETWORK_ZONE_TYPE_LABELS)
    usage = this.#resolveChoice(usage, NETWORK_ZONE_USAGE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/NetworkZone/ (Replace a Network Zone - ReplaceNetworkZone)
    const body = { id: zoneId, name, type }

    if (usage) {
      body.usage = usage
    }

    const gw = this.#normalizeAddressList(gateways)
    const px = this.#normalizeAddressList(proxies)

    if (gw) {
      body.gateways = gw
    }

    if (px) {
      body.proxies = px
    }

    const result = await this.#apiRequest({
      path: `/api/v1/zones/${ encodeURIComponent(zoneId) }`,
      method: 'put',
      body,
      logTag: 'updateNetworkZone',
    })

    return result.body
  }

  /**
   * @operationName Delete Network Zone
   * @category Network Zones
   * @description Deletes a network zone. The zone must be INACTIVE first - deactivate it before deleting. Destructive - use with care.
   * @route POST /delete-network-zone
   * @paramDef {"type":"String","label":"Network Zone","name":"zoneId","required":true,"dictionary":"getNetworkZonesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The zone to delete. Deactivate it first — only INACTIVE zones can be deleted."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"zoneId":"nzovw2rFz2YoqmvwZ0g9"}
   */
  async deleteNetworkZone(zoneId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/NetworkZone/ (Delete a Network Zone - 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/zones/${ encodeURIComponent(zoneId) }`,
      method: 'delete',
      logTag: 'deleteNetworkZone',
    })

    return { deleted: true, zoneId }
  }

  /**
   * @operationName Activate Network Zone
   * @category Network Zones
   * @description Activates a network zone so it can be referenced in policies. Use this after creating or editing a zone.
   * @route POST /activate-network-zone
   * @paramDef {"type":"String","label":"Network Zone","name":"zoneId","required":true,"dictionary":"getNetworkZonesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The zone to activate."}
   * @returns {Object}
   * @sampleResult {"id":"nzowc1U5Jh5xuAK0o0g3","name":"MyIpZone","status":"ACTIVE"}
   */
  async activateNetworkZone(zoneId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/NetworkZone/ (Activate a Network Zone - empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/zones/${ encodeURIComponent(zoneId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateNetworkZone',
    })

    return result.body
  }

  /**
   * @operationName Deactivate Network Zone
   * @category Network Zones
   * @description Deactivates a network zone (required before it can be deleted). Use this to take a zone out of service.
   * @route POST /deactivate-network-zone
   * @paramDef {"type":"String","label":"Network Zone","name":"zoneId","required":true,"dictionary":"getNetworkZonesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The zone to deactivate (required before delete)."}
   * @returns {Object}
   * @sampleResult {"id":"nzowc1U5Jh5xuAK0o0g3","name":"MyIpZone","status":"INACTIVE"}
   */
  async deactivateNetworkZone(zoneId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/NetworkZone/ (Deactivate a Network Zone - empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/zones/${ encodeURIComponent(zoneId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateNetworkZone',
    })

    return result.body
  }

  // Normalizes a gateway/proxy list to the cited [{type,value}] shape. Accepts an array of objects
  // (from the schemaLoader sub-form) or a JSON string (when the UI passes the multi-line text raw).
  // Returns null when there is nothing to send so the field is omitted from the body.
  #normalizeAddressList(list) {
    let arr = list

    if (typeof arr === 'string') {
      const trimmed = arr.trim()

      if (!trimmed) {
        return null
      }

      try {
        arr = JSON.parse(trimmed)
      } catch (error) {
        throw new Error('Gateway/Proxy ranges must be a list of {type, value} entries (e.g. [{"type":"CIDR","value":"1.2.3.4/24"}]).')
      }
    }

    if (!Array.isArray(arr) || arr.length === 0) {
      return null
    }

    return arr
      .filter(item => item && (item.value !== undefined && item.value !== null && item.value !== ''))
      .map(item => ({ type: item.type || 'CIDR', value: item.value }))
  }

  // ==========================================================================
  //  TRUSTED ORIGINS - CRUD + activate/deactivate
  // ==========================================================================
  /**
   * @operationName List Trusted Origins
   * @category Trusted Origins
   * @description Lists the trusted origins (CORS / redirect / iframe-embed) registered in your org. Returns a page plus a cursor for the next page. Use this to find an origin to view or edit.
   * @route POST /list-trusted-origins
   * @paramDef {"type":"String","label":"Search","name":"search","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional keyword to match against the origin name/URL."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","defaultValue":20,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max per page (default 20)."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from a prior page; blank for first page."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"tos10hu7rkbtrFt1M0g4","name":"New trusted origin","origin":"http://example.com","status":"ACTIVE","scopes":[{"type":"CORS"},{"type":"REDIRECT"}]}],"cursor":null}
   */
  async listTrustedOrigins(search, limit, cursor) {
    const query = { limit: limit || 20 }

    if (search) {
      query.q = search
    }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({ path: '/api/v1/trustedOrigins', query, logTag: 'listTrustedOrigins' })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Trusted Origin
   * @category Trusted Origins
   * @description Registers a trusted origin and what it is trusted for (CORS, Redirect, and/or Iframe Embed). Use this to allow a web app at a specific URL to make CORS calls or be a redirect target.
   * @route POST /create-trusted-origin
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A display name for this trusted origin."}
   * @paramDef {"type":"String","label":"Origin URL","name":"origin","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The full origin including scheme and host, e.g. https://app.example.com (no path)."}
   * @paramDef {"type":"Array<String>","label":"Scopes","name":"scopes","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["CORS","Redirect","Iframe Embed"]}},"description":"What this origin is trusted for. Pick one or more."}
   * @paramDef {"type":"Array<String>","label":"Allowed Okta Apps (Iframe Embed)","name":"allowedOktaApps","uiComponent":{"type":"DROPDOWN","options":{"values":["Okta End-User Dashboard","Okta Admin Console"]}},"description":"Only when 'Iframe Embed' is selected — which Okta apps may embed this origin in an iframe."}
   * @returns {Object}
   * @sampleResult {"id":"tos10hu7rkbtrFt1M0g4","name":"New trusted origin","origin":"http://example.com","status":"ACTIVE","scopes":[{"type":"CORS"},{"type":"REDIRECT"}]}
   */
  async createTrustedOrigin(name, origin, scopes, allowedOktaApps) {
    scopes = this.#resolveChoices(scopes, TRUSTED_ORIGIN_SCOPE_LABELS)
    allowedOktaApps = this.#resolveChoices(allowedOktaApps, IFRAME_APP_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/TrustedOrigin/ (Create a Trusted Origin - TrustedOriginBody / WithIframeEmbedding)
    const body = { name, origin, scopes: this.#buildOriginScopes(scopes, allowedOktaApps) }

    const result = await this.#apiRequest({
      path: '/api/v1/trustedOrigins',
      method: 'post',
      body,
      logTag: 'createTrustedOrigin',
    })

    return result.body
  }

  /**
   * @operationName Get Trusted Origin
   * @category Trusted Origins
   * @description Retrieves a single trusted origin by id. Use this to inspect an origin's scopes and status before editing it.
   * @route POST /get-trusted-origin
   * @paramDef {"type":"String","label":"Trusted Origin","name":"trustedOriginId","required":true,"dictionary":"getTrustedOriginsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The trusted origin to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"tos10hu7rkbtrFt1M0g4","name":"New trusted origin","origin":"http://example.com","status":"ACTIVE","scopes":[{"type":"CORS"},{"type":"REDIRECT"}]}
   */
  async getTrustedOrigin(trustedOriginId) {
    const result = await this.#apiRequest({
      path: `/api/v1/trustedOrigins/${ encodeURIComponent(trustedOriginId) }`,
      logTag: 'getTrustedOrigin',
    })

    return result.body
  }

  /**
   * @operationName Update Trusted Origin
   * @category Trusted Origins
   * @description Replaces a trusted origin (PUT is a full replace - supply the name, origin, and the complete set of scopes). Use this to rename an origin or change what it is trusted for.
   * @route POST /update-trusted-origin
   * @paramDef {"type":"String","label":"Trusted Origin","name":"trustedOriginId","required":true,"dictionary":"getTrustedOriginsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The trusted origin to replace (PUT is a full replace)."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name."}
   * @paramDef {"type":"String","label":"Origin URL","name":"origin","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Full origin scheme+host."}
   * @paramDef {"type":"Array<String>","label":"Scopes","name":"scopes","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["CORS","Redirect","Iframe Embed"]}},"description":"Full replacement set of scopes."}
   * @paramDef {"type":"Array<String>","label":"Allowed Okta Apps (Iframe Embed)","name":"allowedOktaApps","uiComponent":{"type":"DROPDOWN","options":{"values":["Okta End-User Dashboard","Okta Admin Console"]}},"description":"Only when 'Iframe Embed' is in the scopes — which Okta apps may embed this origin."}
   * @returns {Object}
   * @sampleResult {"id":"tosue7JvguwJ7U6kz0g3","name":"Updated Example trusted origin","origin":"http://updated.example.com","status":"ACTIVE","scopes":[{"type":"CORS"},{"type":"REDIRECT"}]}
   */
  async updateTrustedOrigin(trustedOriginId, name, origin, scopes, allowedOktaApps) {
    scopes = this.#resolveChoices(scopes, TRUSTED_ORIGIN_SCOPE_LABELS)
    allowedOktaApps = this.#resolveChoices(allowedOktaApps, IFRAME_APP_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/TrustedOrigin/ (Replace a Trusted Origin - flat TrustedOrigin body; value-envelope is example-only)
    const body = { id: trustedOriginId, name, origin, scopes: this.#buildOriginScopes(scopes, allowedOktaApps) }

    const result = await this.#apiRequest({
      path: `/api/v1/trustedOrigins/${ encodeURIComponent(trustedOriginId) }`,
      method: 'put',
      body,
      logTag: 'updateTrustedOrigin',
    })

    return result.body
  }

  /**
   * @operationName Delete Trusted Origin
   * @category Trusted Origins
   * @description Deletes a trusted origin, revoking the trust it conferred. Destructive - use with care.
   * @route POST /delete-trusted-origin
   * @paramDef {"type":"String","label":"Trusted Origin","name":"trustedOriginId","required":true,"dictionary":"getTrustedOriginsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The trusted origin to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"trustedOriginId":"tos10hu7rkbtrFt1M0g4"}
   */
  async deleteTrustedOrigin(trustedOriginId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/TrustedOrigin/ (Delete a Trusted Origin - 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/trustedOrigins/${ encodeURIComponent(trustedOriginId) }`,
      method: 'delete',
      logTag: 'deleteTrustedOrigin',
    })

    return { deleted: true, trustedOriginId }
  }

  /**
   * @operationName Activate Trusted Origin
   * @category Trusted Origins
   * @description Activates a trusted origin so its trust takes effect. Use this to re-enable a previously deactivated origin.
   * @route POST /activate-trusted-origin
   * @paramDef {"type":"String","label":"Trusted Origin","name":"trustedOriginId","required":true,"dictionary":"getTrustedOriginsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The trusted origin to activate."}
   * @returns {Object}
   * @sampleResult {"id":"tos10hu7rkbtrFt1M0g4","status":"ACTIVE"}
   */
  async activateTrustedOrigin(trustedOriginId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/TrustedOrigin/ (Activate a Trusted Origin - empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/trustedOrigins/${ encodeURIComponent(trustedOriginId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateTrustedOrigin',
    })

    return result.body
  }

  /**
   * @operationName Deactivate Trusted Origin
   * @category Trusted Origins
   * @description Deactivates a trusted origin so its trust no longer applies. Use this to temporarily disable an origin without deleting it.
   * @route POST /deactivate-trusted-origin
   * @paramDef {"type":"String","label":"Trusted Origin","name":"trustedOriginId","required":true,"dictionary":"getTrustedOriginsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The trusted origin to deactivate."}
   * @returns {Object}
   * @sampleResult {"id":"tos10hu7rkbtrFt1M0g4","status":"INACTIVE"}
   */
  async deactivateTrustedOrigin(trustedOriginId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/TrustedOrigin/ (Deactivate a Trusted Origin - empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/trustedOrigins/${ encodeURIComponent(trustedOriginId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateTrustedOrigin',
    })

    return result.body
  }

  // Maps the chosen scope codes to the cited [{type}] / [{type,allowedOktaApps}] shape.
  #buildOriginScopes(scopes, allowedOktaApps) {
    const codes = Array.isArray(scopes)
      ? scopes
      : String(scopes || '').split(',').map(s => s.trim()).filter(Boolean)
    const apps = Array.isArray(allowedOktaApps)
      ? allowedOktaApps
      : String(allowedOktaApps || '').split(',').map(s => s.trim()).filter(Boolean)

    return codes.map(type => {
      if (type === 'IFRAME_EMBED' && apps.length > 0) {
        return { type, allowedOktaApps: apps }
      }

      return { type }
    })
  }

  // ==========================================================================
  //  EVENT HOOKS - CRUD + activate/deactivate + verify
  // ==========================================================================
  /**
   * @operationName List Event Hooks
   * @category Event Hooks
   * @description Lists the outbound event hooks in your org - registrations that POST Okta events to an external HTTPS endpoint. Use this to find a hook to view, edit, or activate.
   * @route POST /list-event-hooks
   * @returns {Object}
   * @sampleResult {"items":[{"id":"who8tsqyrhCdmetzx135","name":"Event Hook Test","status":"ACTIVE","verificationStatus":"VERIFIED","events":{"type":"EVENT_TYPE","items":["user.lifecycle.activate"]},"channel":{"type":"HTTP","config":{"uri":"https://example_external_service/userDeactivate"}}}],"cursor":null}
   */
  async listEventHooks() {
    const result = await this.#apiRequest({ path: '/api/v1/eventHooks', logTag: 'listEventHooks' })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Event Hook
   * @category Event Hooks
   * @description Registers an event hook that POSTs the chosen Okta events to your HTTPS endpoint. After creating, verify the hook so Okta confirms your endpoint, then activate it. Use this to push Okta events to an external service.
   * @route POST /create-event-hook
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name for the event hook."}
   * @paramDef {"type":"Array<String>","label":"Event Types","name":"eventTypes","required":true,"dictionary":"getEventTypesDictionary","description":"Which Okta events trigger this hook (e.g. user.lifecycle.activate, group.user_membership.add). Pick one or more."}
   * @paramDef {"type":"String","label":"Delivery URL","name":"channelUri","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The HTTPS endpoint Okta POSTs events to. Must be reachable and serve the verification challenge."}
   * @paramDef {"type":"String","label":"Auth Header Name","name":"authHeaderKey","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Header name Okta sends to authenticate to your endpoint (default Authorization)."}
   * @paramDef {"type":"String","label":"Auth Header Secret","name":"authHeaderValue","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The shared-secret value sent in the auth header."}
   * @paramDef {"type":"Array<Object>","label":"Extra Headers","name":"extraHeaders","uiComponent":{"type":"MULTI_LINE_TEXT"},"schemaLoader":"hookHeaderSchema","description":"Optional additional static headers on each delivery. Each item: {key, value}."}
   * @paramDef {"type":"String","label":"Filter Expression (EL)","name":"filterExpression","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional Okta Expression Language filter; only matching events are delivered. Leave blank for all events of the chosen types."}
   * @returns {Object}
   * @sampleResult {"id":"who8vt36qfNpCGz9H1e6","name":"Event Hook Test","status":"ACTIVE","verificationStatus":"VERIFIED","events":{"type":"EVENT_TYPE","items":["group.user_membership.add"]},"channel":{"type":"HTTP","config":{"uri":"https://example_external_service/userAdded"}}}
   */
  async createEventHook(name, eventTypes, channelUri, authHeaderKey, authHeaderValue, extraHeaders, filterExpression) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/EventHook/ (Create an Event Hook - CreateAnEventHook)
    const items = this.#toStringList(eventTypes)
    const body = {
      name,
      events: { type: 'EVENT_TYPE', items },
      channel: { type: 'HTTP', version: '1.0.0', config: this.#buildHookHttpConfig(channelUri, authHeaderKey, authHeaderValue, extraHeaders) },
    }

    if (filterExpression) {
      body.events.filter = {
        type: 'EXPRESSION_LANGUAGE',
        eventFilterMap: [{ event: items[0], condition: { expression: filterExpression } }],
      }
    }

    const result = await this.#apiRequest({
      path: '/api/v1/eventHooks',
      method: 'post',
      body,
      logTag: 'createEventHook',
    })

    return result.body
  }

  /**
   * @operationName Get Event Hook
   * @category Event Hooks
   * @description Retrieves a single event hook by id, including its events and channel config. Use this to inspect a hook before editing or verifying it.
   * @route POST /get-event-hook
   * @paramDef {"type":"String","label":"Event Hook","name":"eventHookId","required":true,"dictionary":"getEventHooksDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The event hook to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"who8vt36qfNpCGz9H1e6","name":"Event Hook Test","status":"ACTIVE","verificationStatus":"VERIFIED"}
   */
  async getEventHook(eventHookId) {
    const result = await this.#apiRequest({
      path: `/api/v1/eventHooks/${ encodeURIComponent(eventHookId) }`,
      logTag: 'getEventHook',
    })

    return result.body
  }

  /**
   * @operationName Update Event Hook
   * @category Event Hooks
   * @description Replaces an event hook's name, events, and channel (full replace). Use this to change which events fire, the delivery URL, or the filter expression.
   * @route POST /update-event-hook
   * @paramDef {"type":"String","label":"Event Hook","name":"eventHookId","required":true,"dictionary":"getEventHooksDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The event hook to replace."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name."}
   * @paramDef {"type":"Array<String>","label":"Event Types","name":"eventTypes","required":true,"dictionary":"getEventTypesDictionary","description":"Replacement set of event types."}
   * @paramDef {"type":"String","label":"Delivery URL","name":"channelUri","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"HTTPS delivery endpoint."}
   * @paramDef {"type":"String","label":"Auth Header Name","name":"authHeaderKey","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Auth header name (default Authorization)."}
   * @paramDef {"type":"String","label":"Auth Header Secret","name":"authHeaderValue","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Shared-secret value."}
   * @paramDef {"type":"Array<Object>","label":"Extra Headers","name":"extraHeaders","uiComponent":{"type":"MULTI_LINE_TEXT"},"schemaLoader":"hookHeaderSchema","description":"Optional static headers per delivery. Each item: {key, value}."}
   * @paramDef {"type":"String","label":"Filter Expression (EL)","name":"filterExpression","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional Okta Expression Language filter; only matching events are delivered."}
   * @returns {Object}
   * @sampleResult {"id":"who8vt36qfNpCGz9H1e6","name":"Event Hook with Filter","status":"ACTIVE","verificationStatus":"VERIFIED"}
   */
  async updateEventHook(eventHookId, name, eventTypes, channelUri, authHeaderKey, authHeaderValue, extraHeaders, filterExpression) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/EventHook/ (Replace an Event Hook - ReplaceAnEventHook)
    const items = this.#toStringList(eventTypes)
    const body = {
      name,
      events: { type: 'EVENT_TYPE', items },
      channel: { type: 'HTTP', version: '1.0.0', config: this.#buildHookHttpConfig(channelUri, authHeaderKey, authHeaderValue, extraHeaders) },
    }

    if (filterExpression) {
      body.events.filter = {
        type: 'EXPRESSION_LANGUAGE',
        eventFilterMap: [{ event: items[0], condition: { expression: filterExpression } }],
      }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/eventHooks/${ encodeURIComponent(eventHookId) }`,
      method: 'put',
      body,
      logTag: 'updateEventHook',
    })

    return result.body
  }

  /**
   * @operationName Delete Event Hook
   * @category Event Hooks
   * @description Deletes an event hook. The hook must be INACTIVE first - deactivate it before deleting. Destructive - use with care.
   * @route POST /delete-event-hook
   * @paramDef {"type":"String","label":"Event Hook","name":"eventHookId","required":true,"dictionary":"getEventHooksDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Deactivate the hook first — only INACTIVE hooks can be deleted."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"eventHookId":"who8vt36qfNpCGz9H1e6"}
   */
  async deleteEventHook(eventHookId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/EventHook/ (Delete an Event Hook - 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/eventHooks/${ encodeURIComponent(eventHookId) }`,
      method: 'delete',
      logTag: 'deleteEventHook',
    })

    return { deleted: true, eventHookId }
  }

  /**
   * @operationName Activate Event Hook
   * @category Event Hooks
   * @description Activates an event hook so Okta begins delivering its events. Use this after the hook is verified.
   * @route POST /activate-event-hook
   * @paramDef {"type":"String","label":"Event Hook","name":"eventHookId","required":true,"dictionary":"getEventHooksDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The hook to activate."}
   * @returns {Object}
   * @sampleResult {"id":"who8vt36qfNpCGz9H1e6","status":"ACTIVE"}
   */
  async activateEventHook(eventHookId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/EventHook/ (Activate an Event Hook - empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/eventHooks/${ encodeURIComponent(eventHookId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateEventHook',
    })

    return result.body
  }

  /**
   * @operationName Deactivate Event Hook
   * @category Event Hooks
   * @description Deactivates an event hook so Okta stops delivering its events (required before delete). Use this to pause a hook.
   * @route POST /deactivate-event-hook
   * @paramDef {"type":"String","label":"Event Hook","name":"eventHookId","required":true,"dictionary":"getEventHooksDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The hook to deactivate."}
   * @returns {Object}
   * @sampleResult {"id":"who8vt36qfNpCGz9H1e6","status":"INACTIVE"}
   */
  async deactivateEventHook(eventHookId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/EventHook/ (Deactivate an Event Hook - empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/eventHooks/${ encodeURIComponent(eventHookId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateEventHook',
    })

    return result.body
  }

  /**
   * @operationName Verify Event Hook
   * @category Event Hooks
   * @description Triggers Okta's one-time verification handshake against the hook's delivery URL. The endpoint must echo the X-Okta-Verification-Challenge header. Run this once after creating a hook, before activating it. (Requires a live external endpoint that answers the challenge.)
   * @route POST /verify-event-hook
   * @paramDef {"type":"String","label":"Event Hook","name":"eventHookId","required":true,"dictionary":"getEventHooksDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Triggers Okta's one-time verification handshake against the hook's delivery URL. The endpoint must echo the X-Okta-Verification-Challenge."}
   * @returns {Object}
   * @sampleResult {"id":"who8vt36qfNpCGz9H1e6","status":"ACTIVE","verificationStatus":"VERIFIED"}
   */
  async verifyEventHook(eventHookId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/EventHook/ (Verify an Event Hook - empty body; live endpoint echoes the challenge)
    const result = await this.#apiRequest({
      path: `/api/v1/eventHooks/${ encodeURIComponent(eventHookId) }/lifecycle/verify`,
      method: 'post',
      logTag: 'verifyEventHook',
    })

    return result.body
  }

  // ==========================================================================
  //  INLINE HOOKS - CRUD + activate/deactivate + execute
  // ==========================================================================
  /**
   * @operationName List Inline Hooks
   * @category Inline Hooks
   * @description Lists the inline hooks in your org - synchronous hooks Okta calls mid-flow (token transform, registration, password import, etc.). Optionally filter by type. Use this to find a hook to view or edit.
   * @route POST /list-inline-hooks
   * @paramDef {"type":"String","label":"Hook Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["OAuth2 Token Transform","SAML Token Transform","Import Transform","User Pre-Registration","Password Import","Telephony Provider"]}},"description":"Optionally filter by inline hook type."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"calb7gacafgwgE7hc5e4","name":"Token hook with HTTP authentication","type":"com.okta.oauth2.tokens.transform","status":"ACTIVE","channel":{"type":"HTTP","config":{"uri":"https://example.com/tokenHook"}}}],"cursor":null}
   */
  async listInlineHooks(type) {
    type = this.#resolveChoice(type, INLINE_HOOK_TYPE_LABELS)
    const query = {}

    if (type) {
      query.type = type
    }

    const result = await this.#apiRequest({ path: '/api/v1/inlineHooks', query, logTag: 'listInlineHooks' })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Inline Hook
   * @category Inline Hooks
   * @description Creates an inline hook - a synchronous call Okta makes to your HTTPS endpoint mid-flow that can modify the outcome. The type (which flow it plugs into) is immutable after creation. Use this to customize token, registration, or password-import behavior.
   * @route POST /create-inline-hook
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name."}
   * @paramDef {"type":"String","label":"Hook Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["OAuth2 Token Transform","SAML Token Transform","Import Transform","User Pre-Registration","Password Import","Telephony Provider"]}},"description":"Which Okta flow this hook plugs into. Immutable after creation."}
   * @paramDef {"type":"String","label":"Endpoint URL","name":"channelUri","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The HTTPS endpoint Okta calls synchronously during the flow."}
   * @paramDef {"type":"String","label":"Auth Header Name","name":"authHeaderKey","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Header name used to authenticate to your endpoint (default Authorization)."}
   * @paramDef {"type":"String","label":"Auth Header Secret","name":"authHeaderValue","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The shared-secret value sent in the auth header."}
   * @paramDef {"type":"Array<Object>","label":"Extra Headers","name":"extraHeaders","uiComponent":{"type":"MULTI_LINE_TEXT"},"schemaLoader":"hookHeaderSchema","description":"Optional static headers per call. Each item: {key, value}."}
   * @returns {Object}
   * @sampleResult {"id":"calb7gacafgwgE7hc5e4","name":"Token hook with HTTP authentication","type":"com.okta.oauth2.tokens.transform","status":"ACTIVE","version":"1.0.0","channel":{"type":"HTTP","config":{"uri":"https://example.com/tokenHook"}}}
   */
  async createInlineHook(name, type, channelUri, authHeaderKey, authHeaderValue, extraHeaders) {
    type = this.#resolveChoice(type, INLINE_HOOK_TYPE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/InlineHook/ (Create an Inline Hook - CreateInlineHookHTTP)
    const config = this.#buildHookHttpConfig(channelUri, authHeaderKey, authHeaderValue, extraHeaders)

    config.method = 'POST'

    const body = {
      name,
      type,
      version: '1.0.0',
      channel: { type: 'HTTP', version: '1.0.0', config },
    }

    const result = await this.#apiRequest({
      path: '/api/v1/inlineHooks',
      method: 'post',
      body,
      logTag: 'createInlineHook',
    })

    return result.body
  }

  /**
   * @operationName Get Inline Hook
   * @category Inline Hooks
   * @description Retrieves a single inline hook by id, including its type and channel config. Use this to inspect a hook before editing it.
   * @route POST /get-inline-hook
   * @paramDef {"type":"String","label":"Inline Hook","name":"inlineHookId","required":true,"dictionary":"getInlineHooksDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The inline hook to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"calb7gacafgwgE7hc5e4","name":"Token hook with HTTP authentication","type":"com.okta.oauth2.tokens.transform","status":"ACTIVE"}
   */
  async getInlineHook(inlineHookId) {
    const result = await this.#apiRequest({
      path: `/api/v1/inlineHooks/${ encodeURIComponent(inlineHookId) }`,
      logTag: 'getInlineHook',
    })

    return result.body
  }

  /**
   * @operationName Update Inline Hook
   * @category Inline Hooks
   * @description Updates an inline hook's name and channel (the type is immutable). Use this to change the endpoint URL, auth, or display name of a hook.
   * @route POST /update-inline-hook
   * @paramDef {"type":"String","label":"Inline Hook","name":"inlineHookId","required":true,"dictionary":"getInlineHooksDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The inline hook to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name."}
   * @paramDef {"type":"String","label":"Endpoint URL","name":"channelUri","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"HTTPS endpoint."}
   * @paramDef {"type":"String","label":"Auth Header Name","name":"authHeaderKey","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Auth header name (default Authorization)."}
   * @paramDef {"type":"String","label":"Auth Header Secret","name":"authHeaderValue","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Shared-secret value."}
   * @paramDef {"type":"Array<Object>","label":"Extra Headers","name":"extraHeaders","uiComponent":{"type":"MULTI_LINE_TEXT"},"schemaLoader":"hookHeaderSchema","description":"Static headers per call. Each item: {key, value}."}
   * @returns {Object}
   * @sampleResult {"id":"calb7gacafgwgE7hc5e4","name":"New name token hook with HTTP authentication","type":"com.okta.oauth2.tokens.transform","status":"ACTIVE"}
   */
  async updateInlineHook(inlineHookId, name, channelUri, authHeaderKey, authHeaderValue, extraHeaders) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/InlineHook/ (Update an Inline Hook - UpdateInlineHookHTTP, partial POST)
    const config = this.#buildHookHttpConfig(channelUri, authHeaderKey, authHeaderValue, extraHeaders)

    config.method = 'POST'

    const body = {
      name,
      version: '1.0.0',
      channel: { type: 'HTTP', version: '1.0.0', config },
    }

    const result = await this.#apiRequest({
      path: `/api/v1/inlineHooks/${ encodeURIComponent(inlineHookId) }`,
      method: 'post',
      body,
      logTag: 'updateInlineHook',
    })

    return result.body
  }

  /**
   * @operationName Delete Inline Hook
   * @category Inline Hooks
   * @description Deletes an inline hook. The hook must be INACTIVE first - deactivate it before deleting. Destructive - use with care.
   * @route POST /delete-inline-hook
   * @paramDef {"type":"String","label":"Inline Hook","name":"inlineHookId","required":true,"dictionary":"getInlineHooksDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Deactivate the hook first — only INACTIVE hooks can be deleted."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"inlineHookId":"calb7gacafgwgE7hc5e4"}
   */
  async deleteInlineHook(inlineHookId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/InlineHook/ (Delete an Inline Hook - 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/inlineHooks/${ encodeURIComponent(inlineHookId) }`,
      method: 'delete',
      logTag: 'deleteInlineHook',
    })

    return { deleted: true, inlineHookId }
  }

  /**
   * @operationName Activate Inline Hook
   * @category Inline Hooks
   * @description Activates an inline hook so Okta begins calling it during the relevant flow. Use this after creating or editing a hook.
   * @route POST /activate-inline-hook
   * @paramDef {"type":"String","label":"Inline Hook","name":"inlineHookId","required":true,"dictionary":"getInlineHooksDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The hook to activate."}
   * @returns {Object}
   * @sampleResult {"id":"calj4fythrqj5Bxol5e5","status":"ACTIVE"}
   */
  async activateInlineHook(inlineHookId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/InlineHook/ (Activate an Inline Hook - empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/inlineHooks/${ encodeURIComponent(inlineHookId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateInlineHook',
    })

    return result.body
  }

  /**
   * @operationName Deactivate Inline Hook
   * @category Inline Hooks
   * @description Deactivates an inline hook so Okta stops calling it (required before delete). Use this to pause a hook.
   * @route POST /deactivate-inline-hook
   * @paramDef {"type":"String","label":"Inline Hook","name":"inlineHookId","required":true,"dictionary":"getInlineHooksDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The hook to deactivate."}
   * @returns {Object}
   * @sampleResult {"id":"calb7gacafgwgE7hc5e4","status":"INACTIVE"}
   */
  async deactivateInlineHook(inlineHookId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/InlineHook/ (Deactivate an Inline Hook - empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/inlineHooks/${ encodeURIComponent(inlineHookId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateInlineHook',
    })

    return result.body
  }

  /**
   * @operationName Execute Inline Hook
   * @category Inline Hooks
   * @description Test-fires an inline hook against your endpoint with a sample CloudEvents payload, returning the commands your endpoint responds with. Use this to validate a hook end to end. (Requires a live external endpoint reachable from Okta.)
   * @route POST /execute-inline-hook
   * @paramDef {"type":"String","label":"Inline Hook","name":"inlineHookId","required":true,"dictionary":"getInlineHooksDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The hook to test-fire."}
   * @paramDef {"type":"Object","label":"Sample Payload","name":"payload","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A CloudEvents-shaped test payload matching the hook's type (see the docs example for the chosen type). This is an open envelope whose data shape varies per hook type, so it is supplied as raw JSON."}
   * @returns {Object}
   * @sampleResult {"commands":[{"type":"com.okta.action.update","value":{"credential":"VERIFIED"}}]}
   */
  async executeInlineHook(inlineHookId, payload) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/InlineHook/ (Execute an Inline Hook - cited CloudEvents payload; the body is the caller-supplied test envelope)
    let body = payload

    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch (error) {
        throw new Error('Sample Payload must be valid JSON (a CloudEvents-shaped test envelope for the chosen hook type).')
      }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/inlineHooks/${ encodeURIComponent(inlineHookId) }/execute`,
      method: 'post',
      body,
      logTag: 'executeInlineHook',
    })

    return result.body
  }

  // Builds the HTTP channel config for event/inline hooks from the friendly auth + headers fields.
  // Traced to the `config` object in CreateAnEventHook / CreateInlineHookHTTP.
  #buildHookHttpConfig(uri, authHeaderKey, authHeaderValue, extraHeaders) {
    const config = { uri }
    const headers = this.#normalizeHeaderList(extraHeaders)

    if (headers) {
      config.headers = headers
    }

    if (authHeaderValue) {
      config.authScheme = { type: 'HEADER', key: authHeaderKey || 'Authorization', value: authHeaderValue }
    }

    return config
  }

  // Normalizes the Extra Headers field to the cited [{key,value}] shape; accepts an array of
  // objects (schemaLoader sub-form) or a JSON string. Returns null when empty so it is omitted.
  #normalizeHeaderList(list) {
    let arr = list

    if (typeof arr === 'string') {
      const trimmed = arr.trim()

      if (!trimmed) {
        return null
      }

      try {
        arr = JSON.parse(trimmed)
      } catch (error) {
        throw new Error('Extra Headers must be a list of {key, value} entries (e.g. [{"key":"X-Trace","value":"abc"}]).')
      }
    }

    if (!Array.isArray(arr) || arr.length === 0) {
      return null
    }

    return arr
      .filter(item => item && item.key)
      .map(item => ({ key: item.key, value: item.value === undefined || item.value === null ? '' : item.value }))
  }

  // Coerces a comma-string or array into a clean string array (event-type items).
  #toStringList(value) {
    return Array.isArray(value)
      ? value.filter(Boolean)
      : String(value || '').split(',').map(s => s.trim()).filter(Boolean)
  }

  // Parses an Object-typed param that the UI may hand over as raw JSON text or an object.
  // Returns null for an empty value so the field can be omitted from the body.
  #parseObjectParam(value, fieldLabel) {
    if (value === undefined || value === null || value === '') {
      return null
    }

    if (typeof value !== 'string') {
      return value
    }

    const trimmed = value.trim()

    if (!trimmed) {
      return null
    }

    try {
      return JSON.parse(trimmed)
    } catch (error) {
      throw new Error(`${ fieldLabel } must be valid JSON.`)
    }
  }

  // ==========================================================================
  //  APPLICATIONS - full instance lifecycle (create/replace/delete/activate/deactivate)
  //  Completes the Application resource on top of the already-shipped list/read + assignments.
  // ==========================================================================
  // Builds the per-signOnMode app `settings` object from the friendly sub-form (schemaLoader).
  // Traced to the BOOKMARK / AUTO_LOGIN create+replace evidence in the DESIGN contract.
  #buildAppSettings(signOnMode, settings) {
    const parsed = this.#parseObjectParam(settings, 'App Settings') || {}

    if (signOnMode === 'BOOKMARK') {
      return { app: { url: parsed.url } }
    }

    // AUTO_LOGIN (SWA): signOn.loginUrl is required; redirectUrl is optional.
    const signOn = { loginUrl: parsed.loginUrl }

    if (parsed.redirectUrl) {
      signOn.redirectUrl = parsed.redirectUrl
    }

    return { signOn }
  }

  /**
   * @operationName Create Application
   * @category Applications
   * @description Creates an app instance in your org. Bookmark = a clickable link tile on the dashboard; SWA Auto-Login = a form-fill SSO app. The settings fields change with the chosen sign-on mode. (OIDC/SAML apps are configured in the Admin Console, not here.)
   * @route POST /create-application
   * @paramDef {"type":"String","label":"App Label","name":"label","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The display name users see in their dashboard."}
   * @paramDef {"type":"String","label":"Sign-On Mode","name":"signOnMode","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Bookmark (Link Tile)","SWA Auto-Login"]}},"description":"How users sign in to this app. Bookmark = a link tile; SWA Auto-Login = form-fill SSO."}
   * @paramDef {"type":"Object","label":"App Settings","name":"settings","required":true,"schemaLoader":"appSettingsSchema","dependsOn":["signOnMode"],"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Settings for the chosen sign-on mode. The form fields change based on Sign-On Mode."}
   * @paramDef {"type":"Boolean","label":"Activate on Create","name":"activate","uiComponent":{"type":"TOGGLE"},"description":"Activate the app immediately. Default on."}
   * @returns {Object}
   * @sampleResult {"id":"0oafxqCAJWWGELFTYASJ","status":"ACTIVE","signOnMode":"BOOKMARK","label":"Sample Bookmark App"}
   */
  async createApplication(label, signOnMode, settings, activate) {
    signOnMode = this.#resolveChoice(signOnMode, SIGN_ON_MODE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Application/ (Create an Application - BOOKMARK / AUTO_LOGIN request bodies)
    const body = { label, signOnMode, settings: this.#buildAppSettings(signOnMode, settings), credentials: {} }

    if (signOnMode === 'BOOKMARK') {
      body.name = 'bookmark'
    }

    const query = {}

    if (activate === false) {
      query.activate = false
    }

    const result = await this.#apiRequest({
      path: '/api/v1/apps',
      method: 'post',
      body,
      query,
      logTag: 'createApplication',
    })

    return result.body
  }

  /**
   * @operationName Replace Application
   * @category Applications
   * @description Replaces an app instance (PUT is a full replace - supply the label, sign-on mode and the complete settings). Use this to edit a Bookmark or SWA app's URLs.
   * @route POST /replace-application
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The app to replace (PUT is a full replace)."}
   * @paramDef {"type":"String","label":"App Label","name":"label","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name."}
   * @paramDef {"type":"String","label":"Sign-On Mode","name":"signOnMode","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Bookmark (Link Tile)","SWA Auto-Login"]}},"description":"Must match the existing app's sign-on mode."}
   * @paramDef {"type":"Object","label":"App Settings","name":"settings","required":true,"schemaLoader":"appSettingsSchema","dependsOn":["signOnMode"],"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Replacement settings for the chosen mode."}
   * @returns {Object}
   * @sampleResult {"id":"0oafxqCAJWWGELFTYASJ","status":"ACTIVE","label":"Sample Bookmark App updated","signOnMode":"BOOKMARK"}
   */
  async replaceApplication(appId, label, signOnMode, settings) {
    signOnMode = this.#resolveChoice(signOnMode, SIGN_ON_MODE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Application/ (Replace an Application - BOOKMARK / AUTO_LOGIN request bodies)
    const body = { label, signOnMode, settings: this.#buildAppSettings(signOnMode, settings), credentials: {} }

    if (signOnMode === 'BOOKMARK') {
      body.name = 'bookmark'
    }

    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }`,
      method: 'put',
      body,
      logTag: 'replaceApplication',
    })

    return result.body
  }

  /**
   * @operationName Delete Application
   * @category Applications
   * @description Permanently deletes an app instance. The app must be INACTIVE first - deactivate it before deleting. Destructive - use with care.
   * @route POST /delete-application
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The app to delete. Deactivate it first — only INACTIVE apps can be deleted."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"appId":"0oafxqCAJWWGELFTYASJ"}
   */
  async deleteApplication(appId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Application/ (Delete an Application - 204 No Content; app must be INACTIVE)
    await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }`,
      method: 'delete',
      logTag: 'deleteApplication',
    })

    return { deleted: true, appId }
  }

  /**
   * @operationName Activate Application
   * @category Applications
   * @description Activates an app instance so it appears for assigned users. Use this after creating or editing an app.
   * @route POST /activate-application
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The app to activate."}
   * @returns {Object}
   * @sampleResult {"activated":true,"appId":"0oafxqCAJWWGELFTYASJ"}
   */
  async activateApplication(appId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Application/ (Activate an Application - empty body)
    await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateApplication',
    })

    return { activated: true, appId }
  }

  /**
   * @operationName Deactivate Application
   * @category Applications
   * @description Deactivates an app instance (required before it can be deleted). Use this to take an app out of service.
   * @route POST /deactivate-application
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The app to deactivate (required before delete)."}
   * @returns {Object}
   * @sampleResult {"deactivated":true,"appId":"0oafxqCAJWWGELFTYASJ"}
   */
  async deactivateApplication(appId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Application/ (Deactivate an Application - empty body)
    await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateApplication',
    })

    return { deactivated: true, appId }
  }

  // ==========================================================================
  //  BEHAVIORS - behavior detection rules: CRUD + activate/deactivate
  // ==========================================================================
  /**
   * @operationName List Behavior Rules
   * @category Behaviors
   * @description Lists the behavior detection rules in your org (velocity / impossible-travel, anomalous location / IP / device / ASN). Use this to find a rule to view, edit, or use in a risk-based sign-on policy.
   * @route POST /list-behavior-rules
   * @returns {Object}
   * @sampleResult {"items":[{"id":"abcd1234","name":"My Behavior Rule","type":"VELOCITY","status":"ACTIVE","settings":{"velocityKph":805}}]}
   */
  async listBehaviorRules() {
    const result = await this.#apiRequest({ path: '/api/v1/behaviors', logTag: 'listBehaviorRules' })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Behavior Rule
   * @category Behaviors
   * @description Creates a behavior detection rule. Pick the anomaly type (e.g. Velocity for impossible travel) and the tuning fields adjust to it. Reference the rule in a sign-on policy to trigger step-up MFA on suspicious behavior.
   * @route POST /create-behavior-rule
   * @paramDef {"type":"String","label":"Rule Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name for the behavior detection rule (max 128 chars)."}
   * @paramDef {"type":"String","label":"Behavior Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Velocity (impossible travel)","Anomalous Location","Anomalous IP","Anomalous Device","Anomalous ASN"]}},"description":"What anomaly this rule detects."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Initial status. Default Active."}
   * @paramDef {"type":"Object","label":"Detection Settings","name":"settings","schemaLoader":"behaviorRuleSettingsSchema","dependsOn":["type"],"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Tuning parameters specific to the chosen Behavior Type."}
   * @returns {Object}
   * @sampleResult {"id":"abcd1234","name":"My Behavior Rule","type":"VELOCITY","status":"ACTIVE","settings":{"velocityKph":805}}
   */
  async createBehaviorRule(name, type, status, settings) {
    type = this.#resolveChoice(type, BEHAVIOR_TYPE_LABELS)
    status = this.#resolveChoice(status, STATUS_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Behavior/ (Create a behavior detection rule - BehaviorRuleRequest {name,type}; settings sub-schemas per type)
    const body = { name, type }

    if (status) {
      body.status = status
    }

    const parsedSettings = this.#parseObjectParam(settings, 'Detection Settings')

    if (parsedSettings) {
      body.settings = parsedSettings
    }

    const result = await this.#apiRequest({
      path: '/api/v1/behaviors',
      method: 'post',
      body,
      logTag: 'createBehaviorRule',
    })

    return result.body
  }

  /**
   * @operationName Get Behavior Rule
   * @category Behaviors
   * @description Retrieves a single behavior detection rule by id, including its type and tuning settings. Use this to inspect a rule before editing it.
   * @route POST /get-behavior-rule
   * @paramDef {"type":"String","label":"Behavior Rule","name":"behaviorId","required":true,"dictionary":"getBehaviorRulesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The behavior detection rule to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"abcd1234","name":"My Behavior Rule","type":"VELOCITY","status":"ACTIVE","settings":{"velocityKph":805}}
   */
  async getBehaviorRule(behaviorId) {
    const result = await this.#apiRequest({
      path: `/api/v1/behaviors/${ encodeURIComponent(behaviorId) }`,
      logTag: 'getBehaviorRule',
    })

    return result.body
  }

  /**
   * @operationName Update Behavior Rule
   * @category Behaviors
   * @description Replaces a behavior detection rule (PUT is a full replace - supply name, type and the complete settings). Use this to retune a rule's thresholds.
   * @route POST /update-behavior-rule
   * @paramDef {"type":"String","label":"Behavior Rule","name":"behaviorId","required":true,"dictionary":"getBehaviorRulesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The rule to replace. PUT is a full replace — supply name, type and settings."}
   * @paramDef {"type":"String","label":"Rule Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name."}
   * @paramDef {"type":"String","label":"Behavior Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Velocity (impossible travel)","Anomalous Location","Anomalous IP","Anomalous Device","Anomalous ASN"]}},"description":"Must match the existing rule's type."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Active or Inactive."}
   * @paramDef {"type":"Object","label":"Detection Settings","name":"settings","schemaLoader":"behaviorRuleSettingsSchema","dependsOn":["type"],"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Full replacement tuning parameters for the chosen type."}
   * @returns {Object}
   * @sampleResult {"id":"abcd1234","name":"My Behavior Rule","type":"VELOCITY","status":"ACTIVE","settings":{"velocityKph":805}}
   */
  async updateBehaviorRule(behaviorId, name, type, status, settings) {
    type = this.#resolveChoice(type, BEHAVIOR_TYPE_LABELS)
    status = this.#resolveChoice(status, STATUS_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Behavior/ (Replace a behavior detection rule - BehaviorRuleRequest {name,type}; settings sub-schemas per type)
    const body = { name, type }

    if (status) {
      body.status = status
    }

    const parsedSettings = this.#parseObjectParam(settings, 'Detection Settings')

    if (parsedSettings) {
      body.settings = parsedSettings
    }

    const result = await this.#apiRequest({
      path: `/api/v1/behaviors/${ encodeURIComponent(behaviorId) }`,
      method: 'put',
      body,
      logTag: 'updateBehaviorRule',
    })

    return result.body
  }

  /**
   * @operationName Delete Behavior Rule
   * @category Behaviors
   * @description Deletes a behavior detection rule. Destructive - once removed it can no longer be referenced by policies.
   * @route POST /delete-behavior-rule
   * @paramDef {"type":"String","label":"Behavior Rule","name":"behaviorId","required":true,"dictionary":"getBehaviorRulesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The behavior detection rule to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"behaviorId":"abcd1234"}
   */
  async deleteBehaviorRule(behaviorId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Behavior/ (Delete a behavior detection rule - 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/behaviors/${ encodeURIComponent(behaviorId) }`,
      method: 'delete',
      logTag: 'deleteBehaviorRule',
    })

    return { deleted: true, behaviorId }
  }

  /**
   * @operationName Activate Behavior Rule
   * @category Behaviors
   * @description Activates a behavior detection rule so it starts evaluating sign-ins. Use this after creating or retuning a rule.
   * @route POST /activate-behavior-rule
   * @paramDef {"type":"String","label":"Behavior Rule","name":"behaviorId","required":true,"dictionary":"getBehaviorRulesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The rule to activate."}
   * @returns {Object}
   * @sampleResult {"id":"abcd1234","name":"My Behavior Rule","type":"VELOCITY","status":"ACTIVE"}
   */
  async activateBehaviorRule(behaviorId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Behavior/ (Activate a behavior detection rule - empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/behaviors/${ encodeURIComponent(behaviorId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateBehaviorRule',
    })

    return result.body
  }

  /**
   * @operationName Deactivate Behavior Rule
   * @category Behaviors
   * @description Deactivates a behavior detection rule so it stops evaluating sign-ins. Use this to pause a rule without deleting it.
   * @route POST /deactivate-behavior-rule
   * @paramDef {"type":"String","label":"Behavior Rule","name":"behaviorId","required":true,"dictionary":"getBehaviorRulesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The rule to deactivate."}
   * @returns {Object}
   * @sampleResult {"id":"abcd1234","name":"My Behavior Rule","type":"VELOCITY","status":"INACTIVE"}
   */
  async deactivateBehaviorRule(behaviorId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Behavior/ (Deactivate a behavior detection rule - empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/behaviors/${ encodeURIComponent(behaviorId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateBehaviorRule',
    })

    return result.body
  }

  // ==========================================================================
  //  USER TYPES - CRUD over meta/types/user
  // ==========================================================================
  /**
   * @operationName List User Types
   * @category User Types
   * @description Lists the user types in your org (the default type plus any custom types). Each type can carry its own profile schema. Use this to find a type to assign at user creation or to edit.
   * @route POST /list-user-types
   * @returns {Object}
   * @sampleResult {"items":[{"id":"otyfnly5cQjJT9PnR0g4","name":"newUserType","displayName":"New user type","description":"A new custom user type","default":false}]}
   */
  async listUserTypes() {
    const result = await this.#apiRequest({ path: '/api/v1/meta/types/user', logTag: 'listUserTypes' })

    return this.#listResult(result)
  }

  /**
   * @operationName Create User Type
   * @category User Types
   * @description Creates a custom user type. The machine name is immutable after creation; only the display name and description can change later. An org allows the default type plus up to 9 custom types.
   * @route POST /create-user-type
   * @paramDef {"type":"String","label":"Type Name (immutable)","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Machine name of the user type. Cannot be changed after creation."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Human-friendly name shown in the Admin Console."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description of this user type."}
   * @returns {Object}
   * @sampleResult {"id":"otyfnly5cQjJT9PnR0g4","name":"newUserType","displayName":"New user type","description":"A new custom user type","default":false}
   */
  async createUserType(name, displayName, description) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserType/ (Create a user type - CreateUserRequest {name,displayName,description})
    const body = { name, displayName }

    if (description) {
      body.description = description
    }

    const result = await this.#apiRequest({
      path: '/api/v1/meta/types/user',
      method: 'post',
      body,
      logTag: 'createUserType',
    })

    return result.body
  }

  /**
   * @operationName Get User Type
   * @category User Types
   * @description Retrieves a single user type by id. Pick a type from the dropdown, or use the org default. Use this to inspect a type before editing.
   * @route POST /get-user-type
   * @paramDef {"type":"String","label":"User Type","name":"typeId","required":true,"dictionary":"getUserTypesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user type to retrieve. Pick a type, or use the org default."}
   * @returns {Object}
   * @sampleResult {"id":"otyfnly5cQjJT9PnR0g4","name":"newUserType","displayName":"New user type","default":false}
   */
  async getUserType(typeId) {
    const result = await this.#apiRequest({
      path: `/api/v1/meta/types/user/${ encodeURIComponent(typeId) }`,
      logTag: 'getUserType',
    })

    return result.body
  }

  /**
   * @operationName Update User Type
   * @category User Types
   * @description Partially updates a user type - only the display name and description are mutable (the machine name is fixed). Leave a field blank to keep its current value.
   * @route POST /update-user-type
   * @paramDef {"type":"String","label":"User Type","name":"typeId","required":true,"dictionary":"getUserTypesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user type to update (partial). Only the display name and description can change."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New display name. Leave blank to keep the current one."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description. Leave blank to keep the current one."}
   * @returns {Object}
   * @sampleResult {"id":"otyfnly5cQjJT9PnR0g4","name":"newUserType","displayName":"Updated Display Name","default":false}
   */
  async updateUserType(typeId, displayName, description) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserType/ (Update a user type - UpdateUserTypePostRequest {displayName?,description?}; partial)
    const body = {}

    if (displayName !== undefined && displayName !== null && displayName !== '') {
      body.displayName = displayName
    }

    if (description !== undefined && description !== null && description !== '') {
      body.description = description
    }

    const result = await this.#apiRequest({
      path: `/api/v1/meta/types/user/${ encodeURIComponent(typeId) }`,
      method: 'post',
      body,
      logTag: 'updateUserType',
    })

    return result.body
  }

  /**
   * @operationName Replace User Type
   * @category User Types
   * @description Fully replaces a user type. PUT requires the machine name echoed back (it stays immutable - it must equal the existing name) plus the new display name and description.
   * @route POST /replace-user-type
   * @paramDef {"type":"String","label":"User Type","name":"typeId","required":true,"dictionary":"getUserTypesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user type to replace (full update)."}
   * @paramDef {"type":"String","label":"Type Name (immutable)","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Must equal the existing machine name — PUT requires it echoed back; it cannot change."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Replacement display name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Replacement description."}
   * @returns {Object}
   * @sampleResult {"id":"otyfnly5cQjJT9PnR0g4","name":"newUserType","displayName":"Replacement Display Name","description":"Replacement description","default":false}
   */
  async replaceUserType(typeId, name, displayName, description) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserType/ (Replace a user type - ReplaceUserTypePutRequest {name,displayName,description})
    const body = { name, displayName }

    if (description !== undefined && description !== null && description !== '') {
      body.description = description
    }

    const result = await this.#apiRequest({
      path: `/api/v1/meta/types/user/${ encodeURIComponent(typeId) }`,
      method: 'put',
      body,
      logTag: 'replaceUserType',
    })

    return result.body
  }

  /**
   * @operationName Delete User Type
   * @category User Types
   * @description Deletes a custom user type. You cannot delete the default type or a type that is currently assigned to users. Destructive - use with care.
   * @route POST /delete-user-type
   * @paramDef {"type":"String","label":"User Type","name":"typeId","required":true,"dictionary":"getUserTypesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user type to delete. Cannot be the default type or a type assigned to users."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"typeId":"otyfnly5cQjJT9PnR0g4"}
   */
  async deleteUserType(typeId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserType/ (Delete a user type - 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/meta/types/user/${ encodeURIComponent(typeId) }`,
      method: 'delete',
      logTag: 'deleteUserType',
    })

    return { deleted: true, typeId }
  }

  // ==========================================================================
  //  THREATINSIGHT - org-wide ThreatInsight configuration (singleton)
  // ==========================================================================
  /**
   * @operationName Get ThreatInsight Configuration
   * @category ThreatInsight
   * @description Retrieves your org's ThreatInsight configuration - how Okta responds to sign-ins from suspicious IPs and which network zones are excluded. Read this before updating it.
   * @route POST /get-threat-insight-configuration
   * @returns {Object}
   * @sampleResult {"action":"none","excludeZones":[],"created":"2020-08-05T22:18:30.629Z","lastUpdated":"2020-08-05T22:18:30.629Z"}
   */
  async getThreatInsightConfiguration() {
    const result = await this.#apiRequest({ path: '/api/v1/threats/configuration', logTag: 'getThreatInsightConfiguration' })

    return result.body
  }

  /**
   * @operationName Update ThreatInsight Configuration
   * @category ThreatInsight
   * @description Sets how Okta responds to sign-ins from suspicious IPs (None / Audit / Block) and optionally excludes trusted network zones from ThreatInsight. Read the current config first, then write your change.
   * @route POST /update-threat-insight-configuration
   * @paramDef {"type":"String","label":"ThreatInsight Action","name":"action","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["None (disabled)","Audit (log only)","Block (log and block)"]}},"description":"How Okta responds to sign-in attempts from suspicious IPs. None = disabled; Audit = log to System Log; Block = log and block."}
   * @paramDef {"type":"Array<String>","label":"Excluded Network Zones","name":"excludeZones","dictionary":"getNetworkZonesDictionary","uiComponent":{"type":"DROPDOWN"},"description":"Network zones whose IPs are never logged or blocked by ThreatInsight (e.g. your trusted office ranges)."}
   * @returns {Object}
   * @sampleResult {"action":"audit","excludeZones":["nzo1q7jEOsoCnoKcj0g4","nzouagptWUz5DlLfM0g3"],"created":"2020-08-05T22:18:30.629Z","lastUpdated":"2020-10-13T21:23:10.178Z"}
   */
  async updateThreatInsightConfiguration(action, excludeZones) {
    action = this.#resolveChoice(action, THREAT_INSIGHT_ACTION_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ThreatInsight/ (Update the ThreatInsight configuration - {action,excludeZones})
    const body = { action }
    const zones = this.#toStringList(excludeZones)

    if (zones.length > 0) {
      body.excludeZones = zones
    }

    const result = await this.#apiRequest({
      path: '/api/v1/threats/configuration',
      method: 'post',
      body,
      logTag: 'updateThreatInsightConfiguration',
    })

    return result.body
  }

  // ==========================================================================
  //  DEVICES - read + lifecycle of managed/enrolled devices (no create - devices enroll via clients)
  // ==========================================================================
  /**
   * @operationName List Devices
   * @category Devices
   * @description Lists the managed/enrolled devices in your org, optionally narrowed by a SCIM filter (e.g. status eq "ACTIVE" or profile.platform eq "WINDOWS"). Returns a page plus a cursor for the next page. (Devices enroll via Okta Verify / client agents - they are not created through this API.)
   * @route POST /list-devices
   * @paramDef {"type":"String","label":"Search Filter","name":"search","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional SCIM filter, e.g. status eq \"ACTIVE\" or profile.platform eq \"WINDOWS\". Leave blank for all."}
   * @paramDef {"type":"String","label":"Include Users","name":"expand","uiComponent":{"type":"DROPDOWN","options":{"values":["Full user details","User summaries"]}},"description":"Optionally embed associated user details."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","defaultValue":20,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max devices per page (1..200, default 20)."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The cursor from a prior page; leave blank for the first page."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"guo8jx5vVoxfvJeLb0w4","status":"ACTIVE","profile":{"displayName":"DESKTOP-EHAD3IE","platform":"WINDOWS","registered":true},"resourceType":"UDDevice"}],"cursor":null}
   */
  async listDevices(search, expand, limit, cursor) {
    expand = this.#resolveChoice(expand, DEVICE_EXPAND_LABELS)
    const query = { limit: limit || 20 }

    if (search) {
      query.search = search
    }

    if (expand) {
      query.expand = expand
    }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({ path: '/api/v1/devices', query, logTag: 'listDevices' })

    return this.#listResult(result)
  }

  /**
   * @operationName Get Device
   * @category Devices
   * @description Retrieves a single device by id, including its profile (display name, platform, OS, encryption status). Use this to inspect a device before acting on it.
   * @route POST /get-device
   * @paramDef {"type":"String","label":"Device","name":"deviceId","required":true,"dictionary":"getDevicesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The device to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"guo8jx5vVoxfvJeLb0w4","status":"ACTIVE","profile":{"displayName":"DESKTOP-EHAD3IE","platform":"WINDOWS","registered":true,"diskEncryptionType":"NONE"},"resourceType":"UDDevice"}
   */
  async getDevice(deviceId) {
    const result = await this.#apiRequest({
      path: `/api/v1/devices/${ encodeURIComponent(deviceId) }`,
      logTag: 'getDevice',
    })

    return result.body
  }

  /**
   * @operationName Delete Device
   * @category Devices
   * @description Permanently deletes a device. The device must be DEACTIVATED first - deactivate it before deleting. Destructive - use with care.
   * @route POST /delete-device
   * @paramDef {"type":"String","label":"Device","name":"deviceId","required":true,"dictionary":"getDevicesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The device to delete. Deactivate it first — only DEACTIVATED devices can be deleted. Destructive."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"deviceId":"guo8jx5vVoxfvJeLb0w4"}
   */
  async deleteDevice(deviceId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Device/ (Delete a device - 204 No Content; device must be DEACTIVATED)
    await this.#apiRequest({
      path: `/api/v1/devices/${ encodeURIComponent(deviceId) }`,
      method: 'delete',
      logTag: 'deleteDevice',
    })

    return { deleted: true, deviceId }
  }

  /**
   * @operationName Activate Device
   * @category Devices
   * @description Activates a device, returning it to the ACTIVE state. Use this to bring a deactivated or new device back into service.
   * @route POST /activate-device
   * @paramDef {"type":"String","label":"Device","name":"deviceId","required":true,"dictionary":"getDevicesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The device to activate."}
   * @returns {Object}
   * @sampleResult {"activated":true,"deviceId":"guo8jx5vVoxfvJeLb0w4"}
   */
  async activateDevice(deviceId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Device/ (Activate a device - empty body; 204 No Content; sets status ACTIVE)
    await this.#apiRequest({
      path: `/api/v1/devices/${ encodeURIComponent(deviceId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateDevice',
    })

    return { activated: true, deviceId }
  }

  /**
   * @operationName Deactivate Device
   * @category Devices
   * @description Deactivates a device (required before it can be deleted). This is destructive to the device's factors and certificates. Use with care.
   * @route POST /deactivate-device
   * @paramDef {"type":"String","label":"Device","name":"deviceId","required":true,"dictionary":"getDevicesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The device to deactivate (required before delete). Destructive to device factors/certs."}
   * @returns {Object}
   * @sampleResult {"deactivated":true,"deviceId":"guo8jx5vVoxfvJeLb0w4"}
   */
  async deactivateDevice(deviceId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Device/ (Deactivate a device - empty body; 204 No Content; sets status DEACTIVATED)
    await this.#apiRequest({
      path: `/api/v1/devices/${ encodeURIComponent(deviceId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateDevice',
    })

    return { deactivated: true, deviceId }
  }

  /**
   * @operationName Suspend Device
   * @category Devices
   * @description Temporarily suspends a device (non-destructive). A suspended device cannot be used for sign-in until unsuspended.
   * @route POST /suspend-device
   * @paramDef {"type":"String","label":"Device","name":"deviceId","required":true,"dictionary":"getDevicesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The device to suspend (temporary, non-destructive)."}
   * @returns {Object}
   * @sampleResult {"suspended":true,"deviceId":"guo8jx5vVoxfvJeLb0w4"}
   */
  async suspendDevice(deviceId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Device/ (Suspend a Device - empty body; 204 No Content; sets status SUSPENDED)
    await this.#apiRequest({
      path: `/api/v1/devices/${ encodeURIComponent(deviceId) }/lifecycle/suspend`,
      method: 'post',
      logTag: 'suspendDevice',
    })

    return { suspended: true, deviceId }
  }

  /**
   * @operationName Unsuspend Device
   * @category Devices
   * @description Unsuspends a previously suspended device, returning it to ACTIVE. Only SUSPENDED devices can be unsuspended.
   * @route POST /unsuspend-device
   * @paramDef {"type":"String","label":"Device","name":"deviceId","required":true,"dictionary":"getDevicesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The device to unsuspend (only SUSPENDED devices)."}
   * @returns {Object}
   * @sampleResult {"unsuspended":true,"deviceId":"guo8jx5vVoxfvJeLb0w4"}
   */
  async unsuspendDevice(deviceId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Device/ (Unsuspend a Device - empty body; 204 No Content; returns status ACTIVE)
    await this.#apiRequest({
      path: `/api/v1/devices/${ encodeURIComponent(deviceId) }/lifecycle/unsuspend`,
      method: 'post',
      logTag: 'unsuspendDevice',
    })

    return { unsuspended: true, deviceId }
  }

  /**
   * @operationName List Device Users
   * @category Devices
   * @description Lists the users linked to a device, with each user's management status and screen-lock type. Use this to see who a device belongs to.
   * @route POST /list-device-users
   * @paramDef {"type":"String","label":"Device","name":"deviceId","required":true,"dictionary":"getDevicesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The device whose linked users to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"managementStatus":"NOT_MANAGED","screenLockType":"BIOMETRIC","user":{"id":"00u17vh0q8ov8IU881d7","status":"ACTIVE","profile":{"login":"bunk.moreland@example.com","email":"bunk.moreland@example.com"}}}]}
   */
  async listDeviceUsers(deviceId) {
    const result = await this.#apiRequest({
      path: `/api/v1/devices/${ encodeURIComponent(deviceId) }/users`,
      logTag: 'listDeviceUsers',
    })

    return this.#listResult(result)
  }

  // ==========================================================================
  //  PARAM SCHEMA DEFINITIONS - sub-forms for Array<Object> params
  // ==========================================================================
  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @returns {Object}
   */
  async networkZoneAddressSchema() {
    return [
      {
        type: 'String',
        name: 'type',
        label: 'Address Type',
        required: true,
        uiComponent: { type: 'DROPDOWN', options: { values: ['CIDR', 'RANGE'] } },
        description: 'Whether the value is a CIDR block or an IP range.',
      },
      {
        type: 'String',
        name: 'value',
        label: 'Address Value',
        required: true,
        uiComponent: { type: 'SINGLE_LINE_TEXT' },
        description: 'A CIDR block or an IP range, matching the chosen type.',
      },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @returns {Object}
   */
  async hookHeaderSchema() {
    return [
      {
        type: 'String',
        name: 'key',
        label: 'Header Name',
        required: true,
        uiComponent: { type: 'SINGLE_LINE_TEXT' },
        description: 'The HTTP header name to send on each delivery.',
      },
      {
        type: 'String',
        name: 'value',
        label: 'Header Value',
        required: true,
        uiComponent: { type: 'SINGLE_LINE_TEXT' },
        description: 'The value sent for this header.',
      },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"String","name":"signOnMode","required":true}
   * @returns {Object}
   */
  async appSettingsSchema({ criteria } = {}) {
    const signOnMode = criteria?.signOnMode

    if (signOnMode === 'BOOKMARK') {
      return [
        {
          type: 'String',
          name: 'url',
          label: 'Bookmark URL',
          required: true,
          uiComponent: { type: 'SINGLE_LINE_TEXT' },
          description: 'The URL the bookmark tile links to.',
        },
      ]
    }

    if (signOnMode === 'AUTO_LOGIN') {
      return [
        {
          type: 'String',
          name: 'loginUrl',
          label: 'Login URL',
          required: true,
          uiComponent: { type: 'SINGLE_LINE_TEXT' },
          description: "The app's sign-in form URL Okta auto-fills.",
        },
        {
          type: 'String',
          name: 'redirectUrl',
          label: 'Redirect URL',
          required: false,
          uiComponent: { type: 'SINGLE_LINE_TEXT' },
          description: 'Optional post-login redirect URL.',
        },
      ]
    }

    return null
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"String","name":"type","required":true}
   * @returns {Object}
   */
  async behaviorRuleSettingsSchema({ criteria } = {}) {
    const type = criteria?.type

    if (type === 'VELOCITY') {
      return [
        {
          type: 'Number',
          name: 'velocityKph',
          label: 'Velocity (km/h)',
          required: true,
          uiComponent: { type: 'NUMERIC' },
          description: 'Max plausible travel speed in km/h. Default 805 (~speed of a commercial jet).',
        },
      ]
    }

    if (type === 'ANOMALOUS_LOCATION') {
      return [
        {
          type: 'String',
          name: 'granularity',
          label: 'Location Granularity',
          required: true,
          uiComponent: { type: 'DROPDOWN', options: { values: ['CITY', 'COUNTRY', 'SUBDIVISION', 'LAT_LONG'] } },
          description: 'How precisely a location anomaly is measured.',
        },
        {
          type: 'Number',
          name: 'radiusKilometers',
          label: 'Radius (km)',
          required: false,
          uiComponent: { type: 'NUMERIC' },
          description: 'Required when granularity is Latitude/Longitude — radius in km from the known coordinates.',
        },
        {
          type: 'Number',
          name: 'maxEventsUsedForEvaluation',
          label: 'Max Events Evaluated',
          required: false,
          uiComponent: { type: 'NUMERIC' },
          description: '1..100, default 20.',
        },
        {
          type: 'Number',
          name: 'minEventsNeededForEvaluation',
          label: 'Min Events Needed',
          required: false,
          uiComponent: { type: 'NUMERIC' },
          description: '0..10, default 0.',
        },
      ]
    }

    // ANOMALOUS_IP / ANOMALOUS_DEVICE / ANOMALOUS_ASN - history-based settings.
    return [
      {
        type: 'Number',
        name: 'maxEventsUsedForEvaluation',
        label: 'Max Events Evaluated',
        required: false,
        uiComponent: { type: 'NUMERIC' },
        description: 'For IP: 0..100, default 50; otherwise 1..100, default 20.',
      },
      {
        type: 'Number',
        name: 'minEventsNeededForEvaluation',
        label: 'Min Events Needed',
        required: false,
        uiComponent: { type: 'NUMERIC' },
        description: '0..10, default 0.',
      },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"String","name":"type","required":true}
   * @returns {Object}
   */
  async policyConditionsSchema() {
    return [
      {
        type: 'Array',
        name: 'peopleGroupsInclude',
        label: 'Apply to Groups',
        required: false,
        uiComponent: { type: 'DROPDOWN' },
        dictionary: 'getGroupsDictionary',
        description: 'Group IDs this policy applies to (conditions.people.groups.include).',
      },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"String","name":"type","required":true}
   * @returns {Object}
   */
  async policyActionsSchema() {
    // OKTA_SIGN_ON enforcement lives on the policy's RULES, not the policy body - no fields here.
    // PASSWORD complexity/age settings would surface here for an OIE org's password policy.
    return []
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"String","name":"type","required":true}
   * @returns {Object}
   */
  async policyRuleConditionsSchema() {
    return [
      {
        type: 'String',
        name: 'networkConnection',
        label: 'Network Connection',
        required: false,
        uiComponent: { type: 'DROPDOWN', options: { values: ['ANYWHERE', 'ZONE', 'ON_NETWORK', 'OFF_NETWORK'] } },
        description: 'Where the rule applies, by network location (conditions.network.connection).',
      },
      {
        type: 'String',
        name: 'riskScoreLevel',
        label: 'Risk Level',
        required: false,
        uiComponent: { type: 'DROPDOWN', options: { values: ['ANY', 'LOW', 'MEDIUM', 'HIGH'] } },
        description: 'Match by sign-in risk level (conditions.riskScore.level).',
      },
      {
        type: 'Array',
        name: 'peopleGroupsInclude',
        label: 'Apply to Groups',
        required: false,
        uiComponent: { type: 'DROPDOWN' },
        dictionary: 'getGroupsDictionary',
        description: 'Group IDs this rule applies to (conditions.people.groups.include).',
      },
      {
        type: 'Array',
        name: 'peopleUsersExclude',
        label: 'Exclude Users',
        required: false,
        uiComponent: { type: 'DROPDOWN' },
        dictionary: 'getUsersDictionary',
        description: 'User IDs to exclude from the rule (conditions.people.users.exclude).',
      },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"String","name":"type","required":true}
   * @returns {Object}
   */
  async policyRuleActionsSchema() {
    return [
      {
        type: 'String',
        name: 'signonAccess',
        label: 'Access',
        required: false,
        uiComponent: { type: 'DROPDOWN', options: { values: ['ALLOW', 'DENY'] } },
        description: 'Allow or deny sign-in when the rule matches (actions.signon.access).',
      },
      {
        type: 'Boolean',
        name: 'requireFactor',
        label: 'Require MFA',
        required: false,
        uiComponent: { type: 'TOGGLE' },
        description: 'Whether an additional authentication factor is required (actions.signon.requireFactor).',
      },
      {
        type: 'String',
        name: 'factorPromptMode',
        label: 'Factor Prompt Mode',
        required: false,
        uiComponent: { type: 'DROPDOWN', options: { values: ['ALWAYS', 'SESSION', 'DEVICE', 'NEVER'] } },
        description: 'How often to prompt for the factor (actions.signon.factorPromptMode).',
      },
      {
        type: 'Number',
        name: 'maxSessionIdleMinutes',
        label: 'Max Idle (minutes)',
        required: false,
        uiComponent: { type: 'NUMERIC' },
        description: 'Idle timeout in minutes (actions.signon.session.maxSessionIdleMinutes).',
      },
      {
        type: 'Number',
        name: 'maxSessionLifetimeMinutes',
        label: 'Max Lifetime (minutes)',
        required: false,
        uiComponent: { type: 'NUMERIC' },
        description: 'Absolute session lifetime in minutes; 0 = unlimited (actions.signon.session.maxSessionLifetimeMinutes).',
      },
      {
        type: 'Boolean',
        name: 'usePersistentCookie',
        label: 'Remember Device',
        required: false,
        uiComponent: { type: 'TOGGLE' },
        description: 'Whether to set a persistent (remember-me) cookie (actions.signon.session.usePersistentCookie).',
      },
      {
        type: 'String',
        name: 'primaryFactor',
        label: 'Primary Factor',
        required: false,
        uiComponent: { type: 'DROPDOWN', options: { values: ['PASSWORD_IDP_ANY_FACTOR', 'PASSWORD_IDP'] } },
        description: 'Which credential satisfies the primary factor (actions.signon.primaryFactor).',
      },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"String","name":"type","required":true}
   * @returns {Object}
   */
  async idpProtocolSchema({ criteria } = {}) {
    const type = criteria?.type

    // SAML2 takes an issuer/SSO-URL/signing-cert shape; everything else (OIDC + social) takes the
    // OIDC client-credentials + endpoints shape. Traced to CreateGenericOidcIdPRequest.protocol /
    // the SAML protocol schema.
    if (type === 'SAML2') {
      return [
        { type: 'String', name: 'issuerUrl', label: 'IdP Issuer URI', required: true, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The SAML IdP entity id / issuer URI.' },
        { type: 'String', name: 'ssoUrl', label: 'SSO URL', required: true, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The IdP single-sign-on (authentication) URL.' },
        { type: 'String', name: 'ssoBinding', label: 'SSO Binding', required: false, uiComponent: { type: 'DROPDOWN', options: { values: ['HTTP-POST', 'HTTP-REDIRECT'] } }, description: 'The HTTP binding for the SSO request. Defaults to HTTP POST.' },
        { type: 'String', name: 'signatureAlgorithm', label: 'Signature Algorithm', required: false, uiComponent: { type: 'DROPDOWN', options: { values: ['SHA-256', 'SHA-1'] } }, description: 'The request signature algorithm. Defaults to SHA-256.' },
      ]
    }

    return [
      { type: 'String', name: 'clientId', label: 'Client ID', required: true, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The OAuth client id issued by the provider.' },
      { type: 'String', name: 'clientSecret', label: 'Client Secret', required: true, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The OAuth client secret issued by the provider.' },
      { type: 'String', name: 'issuerUrl', label: 'Issuer URL', required: true, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The provider issuer URL.' },
      { type: 'String', name: 'authorizationUrl', label: 'Authorization URL', required: true, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The provider authorization endpoint.' },
      { type: 'String', name: 'tokenUrl', label: 'Token URL', required: true, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The provider token endpoint.' },
      { type: 'String', name: 'userInfoUrl', label: 'User Info URL', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The provider userinfo endpoint.' },
      { type: 'String', name: 'jwksUrl', label: 'JWKS URL', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The provider JWKS (keys) endpoint.' },
      { type: 'String', name: 'scopes', label: 'Scopes', required: false, uiComponent: { type: 'MULTI_LINE_TEXT' }, description: 'OAuth scopes to request, one per line. Defaults to openid, profile, email.' },
      { type: 'Boolean', name: 'pkceRequired', label: 'PKCE Required', required: false, uiComponent: { type: 'TOGGLE' }, description: 'Whether the provider requires PKCE.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"String","name":"type","required":true}
   * @returns {Object}
   */
  async idpPolicySchema() {
    // Account-link / provisioning / subject-matching policy. Same shape for all IdP types.
    // Traced to CreateGenericOidcIdPRequest.policy.
    return [
      { type: 'String', name: 'accountLinkAction', label: 'Account Link Action', required: false, uiComponent: { type: 'DROPDOWN', options: { values: ['AUTO', 'DISABLED'] } }, description: 'How an external user links to an existing Okta user. Defaults to Automatic.' },
      { type: 'String', name: 'provisioningAction', label: 'Provisioning Action', required: false, uiComponent: { type: 'DROPDOWN', options: { values: ['AUTO', 'DISABLED', 'CALLOUT'] } }, description: 'How new external users are provisioned in Okta. Defaults to Automatic.' },
      { type: 'String', name: 'subjectMatchType', label: 'Subject Match Type', required: false, uiComponent: { type: 'DROPDOWN', options: { values: ['USERNAME', 'EMAIL', 'USERNAME_OR_EMAIL', 'CUSTOM_ATTRIBUTE'] } }, description: 'How the external identity is matched to an Okta user. Defaults to Username.' },
      { type: 'String', name: 'userNameTemplate', label: 'Username Template', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'Okta Expression that derives the username (e.g. idpuser.email). Defaults to idpuser.email.' },
      { type: 'Number', name: 'maxClockSkew', label: 'Max Clock Skew (ms)', required: false, uiComponent: { type: 'NUMERIC' }, description: 'Maximum allowed clock skew, in milliseconds. Defaults to 120000.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"String","name":"key","required":true}
   * @returns {Object}
   */
  async authenticatorProviderSchema({ criteria } = {}) {
    const key = criteria?.key

    // Duo provider config - traced to AuthenticatorRequestDuo.provider.
    if (key === 'duo') {
      return [
        { type: 'String', name: 'integrationKey', label: 'Integration Key', required: true, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'Duo integration (client) key.' },
        { type: 'String', name: 'secretKey', label: 'Secret Key', required: true, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'Duo secret key.' },
        { type: 'String', name: 'host', label: 'API Host', required: true, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'Duo API hostname, e.g. https://api-xxxxxxxx.duosecurity.com.' },
        { type: 'String', name: 'userNameTemplate', label: 'Username Template', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'Okta Expression mapping the Okta user to the Duo username. Defaults to oktaId.' },
      ]
    }

    // TAC (Temporary Access Code) config - traced to AuthenticatorRequestTac.provider.
    if (key === 'tac') {
      return [
        { type: 'Number', name: 'minTtl', label: 'Min TTL (min)', required: false, uiComponent: { type: 'NUMERIC' }, description: 'Minimum code lifetime in minutes. Defaults to 10.' },
        { type: 'Number', name: 'maxTtl', label: 'Max TTL (min)', required: false, uiComponent: { type: 'NUMERIC' }, description: 'Maximum code lifetime in minutes. Defaults to 14400.' },
        { type: 'Number', name: 'defaultTtl', label: 'Default TTL (min)', required: false, uiComponent: { type: 'NUMERIC' }, description: 'Default code lifetime in minutes. Defaults to 120.' },
        { type: 'Number', name: 'length', label: 'Code Length', required: false, uiComponent: { type: 'NUMERIC' }, description: 'Number of characters in the code. Defaults to 16.' },
        { type: 'Boolean', name: 'numbers', label: 'Include Numbers', required: false, uiComponent: { type: 'TOGGLE' }, description: 'Allow digits in the code. Defaults to on.' },
        { type: 'Boolean', name: 'letters', label: 'Include Letters', required: false, uiComponent: { type: 'TOGGLE' }, description: 'Allow letters in the code. Defaults to on.' },
        { type: 'Boolean', name: 'specialCharacters', label: 'Include Special Characters', required: false, uiComponent: { type: 'TOGGLE' }, description: 'Allow special characters in the code. Defaults to on.' },
        { type: 'Boolean', name: 'multiUseAllowed', label: 'Multi-Use Allowed', required: false, uiComponent: { type: 'TOGGLE' }, description: 'Allow the code to be used more than once.' },
      ]
    }

    // Other authenticator types (webauthn, security_key, smart_card_idp, ...) take no provider config.
    return []
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"String","name":"methodType","required":true}
   * @returns {Object}
   */
  async authenticatorMethodSettingsSchema({ criteria } = {}) {
    const methodType = criteria?.methodType

    // Only WebAuthn carries settings - traced to AuthenticatorMethodWebAuthn.settings.
    if (methodType === 'webauthn') {
      return [
        { type: 'String', name: 'userVerification', label: 'User Verification', required: false, uiComponent: { type: 'DROPDOWN', options: { values: ['REQUIRED', 'PREFERRED', 'DISCOURAGED'] } }, description: 'Whether the security key must verify the user. Defaults to Discouraged.' },
        { type: 'String', name: 'attachment', label: 'Attachment', required: false, uiComponent: { type: 'DROPDOWN', options: { values: ['ANY', 'PLATFORM', 'CROSS_PLATFORM'] } }, description: 'Whether the authenticator is built-in (Platform) or removable (Cross-Platform). Defaults to Any.' },
      ]
    }

    return []
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @returns {Object}
   */
  async aaguidCharacteristicsSchema() {
    // Traced to CustomAAGUIDCreateRequestObject.authenticatorCharacteristics.
    return [
      { type: 'Boolean', name: 'platformAttached', label: 'Platform Attached', required: false, uiComponent: { type: 'TOGGLE' }, description: 'Whether the authenticator is built into the device.' },
      { type: 'Boolean', name: 'fipsCompliant', label: 'FIPS Compliant', required: false, uiComponent: { type: 'TOGGLE' }, description: 'Whether the authenticator is FIPS 140-2 compliant.' },
      { type: 'Boolean', name: 'hardwareProtected', label: 'Hardware Protected', required: false, uiComponent: { type: 'TOGGLE' }, description: 'Whether the authenticator stores keys in hardware.' },
    ]
  }

  // ==========================================================================
  //  USER RESOURCES & LIFECYCLE GAPS - blocks, devices, reactivate, recovery
  // ==========================================================================
  /**
   * @operationName List User Blocks
   * @category Users
   * @description Lists the IP/device blocks currently applied to a user (e.g. from a suspicious-activity event). Use this to see why a user may be locked out from certain locations or devices.
   * @route POST /list-user-blocks
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"List the IP/device blocks currently applied to this user."}
   * @returns {Object}
   * @sampleResult {"items":[{"type":"UNKNOWN_DEVICE","_embedded":{"devices":["8.8.8.8"]}}],"cursor":null}
   */
  async listUserBlocks(userId) {
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/blocks`,
      logTag: 'listUserBlocks',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName List User Devices
   * @category Users
   * @description Lists the devices enrolled or managed for a user, with each device's status and platform. Use this to audit which devices a user signs in from.
   * @route POST /list-user-devices
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"List devices enrolled/managed for this user."}
   * @returns {Object}
   * @sampleResult {"items":[{"device":{"id":"guo4a5u7JHHhjXrMK0g4","status":"ACTIVE","profile":{"displayName":"Example Device","platform":"MACOS"}},"managementStatus":"MANAGED"}],"cursor":null}
   */
  async listUserDevices(userId) {
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/devices`,
      logTag: 'listUserDevices',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Reactivate User
   * @category Users
   * @description Restarts the activation flow for a user in the PROVISIONED or DEPROVISIONED state. With "Send Email" off, returns a fresh activation URL/token you can deliver yourself. Use this to re-invite a staged or deactivated user.
   * @route POST /reactivate-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A user in PROVISIONED or DEPROVISIONED state to reactivate."}
   * @paramDef {"type":"Boolean","label":"Send Email","name":"sendEmail","uiComponent":{"type":"TOGGLE"},"description":"If on, Okta emails an activation link to the user. If off, the response returns the activation URL/token."}
   * @returns {Object}
   * @sampleResult {"activationUrl":"https://your-org.okta.com/welcome/XE6wE17zmphl3KqAPFxO","activationToken":"XE6wE17zmphl3KqAPFxO"}
   */
  async reactivateUser(userId, sendEmail) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserLifecycle/ (Reactivate a user)
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/lifecycle/reactivate`,
      method: 'post',
      query: { sendEmail: sendEmail === undefined ? false : sendEmail },
      logTag: 'reactivateUser',
    })

    return result.body
  }

  /**
   * @operationName Forgot Password
   * @category Users
   * @description Starts the self-service password reset flow for a user. With "Send Email" off, returns a one-time reset URL you can deliver yourself instead of emailing it. Use this to help a user who is locked out.
   * @route POST /forgot-password
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Start the self-service password reset flow for this user."}
   * @paramDef {"type":"Boolean","label":"Send Email","name":"sendEmail","uiComponent":{"type":"TOGGLE"},"description":"If on, Okta emails the reset link. If off, the response returns the reset URL."}
   * @returns {Object}
   * @sampleResult {"resetPasswordUrl":"https://your-org.okta.com/signin/reset-password/XE6wE17zmphl3KqAPFxO"}
   */
  async forgotPassword(userId, sendEmail) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserCred/ (Initiate forgot-password flow)
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/credentials/forgot_password`,
      method: 'post',
      query: { sendEmail: sendEmail === undefined ? false : sendEmail },
      logTag: 'forgotPassword',
    })

    return result.body
  }

  /**
   * @operationName Reset Password via Recovery Question
   * @category Users
   * @description Resets a user's password by answering their existing recovery question. Use this for a self-service reset where the user knows their recovery answer but not their password.
   * @route POST /forgot-password-set-new-password
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Reset this user's password by answering their recovery question."}
   * @paramDef {"type":"String","label":"New Password","name":"newPassword","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The new password value to set."}
   * @paramDef {"type":"String","label":"Recovery Answer","name":"recoveryAnswer","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The answer to the user's existing recovery question."}
   * @paramDef {"type":"Boolean","label":"Send Email","name":"sendEmail","uiComponent":{"type":"TOGGLE"},"description":"Whether to send a confirmation email."}
   * @returns {Object}
   * @sampleResult {"password":{},"recovery_question":{"question":"Who's a major player in the cowboy scene?"},"provider":{"type":"OKTA","name":"OKTA"}}
   */
  async forgotPasswordSetNewPassword(userId, newPassword, recoveryAnswer, sendEmail) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserCred/ (Reset password with recovery question - ForgotPwdRecoveryQuestionRequest)
    const body = {
      password: { value: newPassword },
      recovery_question: { answer: recoveryAnswer },
    }

    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/credentials/forgot_password_recovery_question`,
      method: 'post',
      query: { sendEmail: sendEmail === undefined ? false : sendEmail },
      body,
      logTag: 'forgotPasswordSetNewPassword',
    })

    return result.body
  }

  /**
   * @operationName Change Recovery Question
   * @category Users
   * @description Changes a user's recovery question and answer, validating the change against their current password. Use this to update the question a user answers during self-service password recovery.
   * @route POST /change-recovery-question
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Change this user's recovery question (requires their current password)."}
   * @paramDef {"type":"String","label":"Current Password","name":"currentPassword","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user's current password (validates the change)."}
   * @paramDef {"type":"String","label":"Recovery Question","name":"question","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The new recovery question text."}
   * @paramDef {"type":"String","label":"Recovery Answer","name":"answer","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The answer to the new recovery question."}
   * @returns {Object}
   * @sampleResult {"password":{},"recovery_question":{"question":"How many roads must a man walk down?"},"provider":{"type":"OKTA","name":"OKTA"}}
   */
  async changeRecoveryQuestion(userId, currentPassword, question, answer) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserCred/ (Change recovery question - UpdateRecQuestionRequest)
    const body = {
      password: { value: currentPassword },
      recovery_question: { question, answer },
    }

    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/credentials/change_recovery_question`,
      method: 'post',
      body,
      logTag: 'changeRecoveryQuestion',
    })

    return result.body
  }

  // ==========================================================================
  //  USER FACTOR GAPS - verify, resend, supported-factor & question catalogs
  // ==========================================================================
  /**
   * @operationName Verify Factor
   * @category MFA Factors
   * @description Verifies an enrolled MFA factor by submitting its passcode (sms/call/email/totp/token) or its security-question answer. Leave the passcode empty on the first call to trigger a CHALLENGE that sends the code. Use this to complete a step-up verification.
   * @route POST /verify-factor
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user whose factor to verify."}
   * @paramDef {"type":"String","label":"Factor","name":"factorId","required":true,"dictionary":"getUserFactorsDictionary","dependsOn":["userId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The enrolled factor to verify."}
   * @paramDef {"type":"String","label":"Passcode","name":"passCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OTP/SMS/TOTP passcode. Provide this for sms/call/email/totp/token factors. Leave empty on the first call to trigger a CHALLENGE (sends the code)."}
   * @paramDef {"type":"String","label":"Security Answer","name":"answer","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The answer — provide this only for a security-question factor."}
   * @returns {Object}
   * @sampleResult {"factorResult":"SUCCESS"}
   */
  async verifyFactor(userId, factorId, passCode, answer) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserFactor/ (Verify a factor - FactorPasscodeRequest / UserFactorVerifySecurityQuestionRequest)
    const body = {}

    if (passCode) {
      body.passCode = passCode
    }

    if (answer) {
      body.answer = answer
    }

    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/factors/${ encodeURIComponent(factorId) }/verify`,
      method: 'post',
      body,
      logTag: 'verifyFactor',
    })

    return result.body
  }

  /**
   * @operationName Resend Enrollment Challenge
   * @category MFA Factors
   * @description Re-sends the activation challenge for a factor that is still PENDING_ACTIVATION (e.g. resend the SMS or email code). Use this when the original code expired or never arrived.
   * @route POST /resend-enroll-factor
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user."}
   * @paramDef {"type":"String","label":"Factor","name":"factorId","required":true,"dictionary":"getUserFactorsDictionary","dependsOn":["userId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The PENDING_ACTIVATION factor to resend the activation challenge for (e.g. resend the SMS code)."}
   * @paramDef {"type":"String","label":"Factor Type","name":"factorType","uiComponent":{"type":"DROPDOWN","options":{"values":["SMS","Voice Call","Email"]}},"description":"The factor type being resent (echoed in the resend body). Defaults to the factor's own type."}
   * @returns {Object}
   * @sampleResult {"id":"mbl1nz9JHJGHWRKMTLHP","factorType":"sms","provider":"OKTA","status":"PENDING_ACTIVATION","profile":{"phoneNumber":"+1-555-415-1337"}}
   */
  async resendEnrollFactor(userId, factorId, factorType) {
    factorType = this.#resolveChoice(factorType, RESEND_FACTOR_TYPE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserFactor/ (Resend a factor enrollment - ResendUserFactor; empty body also accepted)
    const body = {}

    if (factorType) {
      body.factorType = factorType
    }

    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/factors/${ encodeURIComponent(factorId) }/resend`,
      method: 'post',
      body,
      logTag: 'resendEnrollFactor',
    })

    return result.body
  }

  /**
   * @operationName List Supported Factors
   * @category MFA Factors
   * @description Lists the MFA factor types a user is eligible to enroll, filtered by your org's policy. Use this to show a user only the factors they can actually set up.
   * @route POST /list-supported-factors
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"List the factor types this user is eligible to enroll (org-policy filtered)."}
   * @returns {Object}
   * @sampleResult {"items":[{"factorType":"question","provider":"OKTA","vendorName":"OKTA"},{"factorType":"token:software:totp","provider":"GOOGLE"}],"cursor":null}
   */
  async listSupportedFactors(userId) {
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/factors/catalog`,
      logTag: 'listSupportedFactors',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName List Security Questions
   * @category MFA Factors
   * @description Lists the security questions available for a user to enroll as a recovery/MFA factor. Use this to populate a question picker before enrolling the security-question factor.
   * @route POST /list-supported-security-questions
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"List the security questions available for this user to enroll."}
   * @returns {Object}
   * @sampleResult {"items":[{"question":"disliked_food","questionText":"What is the food you least liked as a child?"},{"question":"name_of_first_plush_toy","questionText":"What is the name of your first stuffed animal?"}],"cursor":null}
   */
  async listSupportedSecurityQuestions(userId) {
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/factors/questions`,
      logTag: 'listSupportedSecurityQuestions',
    })

    return this.#listResult(result)
  }

  // ==========================================================================
  //  GROUP RULE GAPS + GROUP OWNERS
  // ==========================================================================
  /**
   * @operationName Get Group Rule
   * @category Group Rules
   * @description Retrieves a single group rule by id - its match expression, target groups, exclusions, and status. Turn on "Expand Group Names" to embed a group-id->name map so the result is easier to read.
   * @route POST /get-group-rule
   * @paramDef {"type":"String","label":"Group Rule","name":"ruleId","required":true,"dictionary":"getGroupRulesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The group rule to retrieve."}
   * @paramDef {"type":"Boolean","label":"Expand Group Names","name":"expand","uiComponent":{"type":"TOGGLE"},"description":"If on, embeds a group-id→group-name map (sends expand=groupIdToGroupNameMap)."}
   * @returns {Object}
   * @sampleResult {"type":"group_rule","id":"0pr3f7zMZZHPgUoWO0g4","status":"INACTIVE","name":"Engineering group rule","conditions":{"expression":{"value":"user.role==\"Engineer\"","type":"urn:okta:expression:1.0"}},"actions":{"assignUserToGroups":{"groupIds":["00gjitX9HqABSoqTB0g3"]}}}
   */
  async getGroupRule(ruleId, expand) {
    const query = {}

    if (expand) {
      query.expand = 'groupIdToGroupNameMap'
    }

    const result = await this.#apiRequest({
      path: `/api/v1/groups/rules/${ encodeURIComponent(ruleId) }`,
      query,
      logTag: 'getGroupRule',
    })

    return result.body
  }

  /**
   * @operationName Replace Group Rule
   * @category Group Rules
   * @description Fully replaces a group rule's name, match expression, target groups, and exclusions. The rule must be INACTIVE first (deactivate it before replacing). Use this to edit how an auto-assignment rule works.
   * @route POST /replace-group-rule
   * @paramDef {"type":"String","label":"Group Rule","name":"ruleId","required":true,"dictionary":"getGroupRulesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The INACTIVE group rule to replace (deactivate it first)."}
   * @paramDef {"type":"String","label":"Rule Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name of the rule."}
   * @paramDef {"type":"String","label":"Expression","name":"expression","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Okta Expression Language condition (e.g. user.role==\"Engineer\"). Sent as conditions.expression.value with type urn:okta:expression:1.0."}
   * @paramDef {"type":"Array<String>","label":"Assign To Groups","name":"assignToGroupIds","required":true,"dictionary":"getGroupsDictionary","description":"Group IDs to assign matching users into (maps to actions.assignUserToGroups.groupIds). Pick one or more."}
   * @paramDef {"type":"Array<String>","label":"Exclude Users","name":"excludeUserIds","dictionary":"getUsersDictionary","description":"User IDs to exclude from the rule (conditions.people.users.exclude)."}
   * @paramDef {"type":"Array<String>","label":"Exclude Groups","name":"excludeGroupIds","dictionary":"getGroupsDictionary","description":"Group IDs to exclude (conditions.people.groups.exclude)."}
   * @returns {Object}
   * @sampleResult {"type":"group_rule","id":"0pr3f7zMZZHPgUoWO0g4","status":"INACTIVE","name":"Engineering group rule","conditions":{"expression":{"value":"user.role==\"Engineer\"","type":"urn:okta:expression:1.0"}},"actions":{"assignUserToGroups":{"groupIds":["00gjitX9HqABSoqTB0g3"]}}}
   */
  async replaceGroupRule(ruleId, name, expression, assignToGroupIds, excludeUserIds, excludeGroupIds) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/GroupRule/ (Replace a Group Rule - group-rule-example)
    const groups = this.#toIdArray(assignToGroupIds)
    const excludeUsers = this.#toIdArray(excludeUserIds)
    const excludeGroups = this.#toIdArray(excludeGroupIds)

    const body = {
      type: 'group_rule',
      name,
      conditions: {
        expression: { value: expression, type: EXPRESSION_TYPE },
        people: {
          users: { exclude: excludeUsers },
          groups: { exclude: excludeGroups },
        },
      },
      actions: { assignUserToGroups: { groupIds: groups } },
    }

    const result = await this.#apiRequest({
      path: `/api/v1/groups/rules/${ encodeURIComponent(ruleId) }`,
      method: 'put',
      body,
      logTag: 'replaceGroupRule',
    })

    return result.body
  }

  /**
   * @operationName List Group Owners
   * @category Groups
   * @description Lists the owners assigned to a group - the users or groups that can manage its membership. Use this to audit who controls a group.
   * @route POST /list-group-owners
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The group whose owners to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"00u1cmc03xjzePoWD0h8","type":"USER","displayName":"Oliver Putnam","originType":"OKTA_DIRECTORY"}],"cursor":null}
   */
  async listGroupOwners(groupId) {
    const result = await this.#apiRequest({
      path: `/api/v1/groups/${ encodeURIComponent(groupId) }/owners`,
      logTag: 'listGroupOwners',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Assign Group Owner
   * @category Groups
   * @description Assigns a user or group as an owner of a group, letting them manage its membership. Pick the owner type, then paste the user or group ID. Use this to delegate group administration.
   * @route POST /assign-group-owner
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The group to assign an owner to."}
   * @paramDef {"type":"String","label":"Owner Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["User","Group"]}},"description":"Whether the owner is a user or a group."}
   * @paramDef {"type":"String","label":"Owner","name":"ownerId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user or group ID to make an owner (maps to body.id). Pick a user from the list when Owner Type is User, or paste a group ID when Owner Type is Group."}
   * @returns {Object}
   * @sampleResult {"id":"00u1cmc03xjzePoWD0h8","type":"USER","resolved":true,"originType":"OKTA_DIRECTORY","displayName":"Oliver Putnam","lastUpdated":"Wed Mar 29 18:34:31 UTC 2023"}
   */
  async assignGroupOwner(groupId, type, ownerId) {
    type = this.#resolveChoice(type, OWNER_TYPE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/GroupOwner/ (Assign a group owner - AssignGroupOwnerRequest)
    const body = { id: ownerId, type }

    const result = await this.#apiRequest({
      path: `/api/v1/groups/${ encodeURIComponent(groupId) }/owners`,
      method: 'post',
      body,
      logTag: 'assignGroupOwner',
    })

    return result.body
  }

  /**
   * @operationName Remove Group Owner
   * @category Groups
   * @description Removes an owner from a group, revoking their ability to manage its membership. Use the owner id from List Group Owners. Destructive.
   * @route POST /delete-group-owner
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The group."}
   * @paramDef {"type":"String","label":"Owner","name":"ownerId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The owner id to remove (from List Group Owners). Pick a user from the list, or paste a group owner ID."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"groupId":"00g1emaKYZTWRYYRRTSK","ownerId":"00u1cmc03xjzePoWD0h8"}
   */
  async deleteGroupOwner(groupId, ownerId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/GroupOwner/ (Delete a group owner)
    await this.#apiRequest({
      path: `/api/v1/groups/${ encodeURIComponent(groupId) }/owners/${ encodeURIComponent(ownerId) }`,
      method: 'delete',
      logTag: 'deleteGroupOwner',
    })

    return { deleted: true, groupId, ownerId }
  }

  // ==========================================================================
  //  LINKED OBJECTS - custom user-to-user relationship definitions + values
  // ==========================================================================
  /**
   * @operationName List Linked Object Definitions
   * @category Linked Objects
   * @description Lists the custom user-to-user relationship definitions in your org (e.g. manager/subordinate, mentor/mentee). Use this to see which linked-object relationships exist before linking users.
   * @route POST /list-linked-object-definitions
   * @returns {Object}
   * @sampleResult {"items":[{"primary":{"name":"manager","title":"manager","type":"USER"},"associated":{"name":"subordinate","title":"subordinate","type":"USER"}}],"cursor":null}
   */
  async listLinkedObjectDefinitions() {
    const result = await this.#apiRequest({
      path: '/api/v1/meta/schemas/user/linkedObjects',
      logTag: 'listLinkedObjectDefinitions',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Linked Object Definition
   * @category Linked Objects
   * @description Creates a custom user-to-user relationship definition with a primary side and an associated side (e.g. manager / subordinate). Use this once to define a relationship you can then assign between users.
   * @route POST /create-linked-object-definition
   * @paramDef {"type":"String","label":"Primary Name","name":"primaryName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"API name of the primary side of the relationship (e.g. manager). Used in URLs — lowercase, no spaces."}
   * @paramDef {"type":"String","label":"Primary Title","name":"primaryTitle","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display title for the primary side (e.g. Manager)."}
   * @paramDef {"type":"String","label":"Primary Description","name":"primaryDescription","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the primary link property."}
   * @paramDef {"type":"String","label":"Associated Name","name":"associatedName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"API name of the associated side (e.g. subordinate)."}
   * @paramDef {"type":"String","label":"Associated Title","name":"associatedTitle","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display title for the associated side (e.g. Subordinate)."}
   * @paramDef {"type":"String","label":"Associated Description","name":"associatedDescription","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the associated link property."}
   * @returns {Object}
   * @sampleResult {"primary":{"name":"manager","title":"manager","description":"Manager link property","type":"USER"},"associated":{"name":"subordinate","title":"subordinate","description":"Subordinate link property","type":"USER"}}
   */
  async createLinkedObjectDefinition(primaryName, primaryTitle, primaryDescription, associatedName, associatedTitle, associatedDescription) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/LinkedObject/ (Create a linked-object definition - CreateLinkedObjectRequest)
    const primary = { name: primaryName, title: primaryTitle, type: 'USER' }

    if (primaryDescription) {
      primary.description = primaryDescription
    }

    const associated = { name: associatedName, title: associatedTitle, type: 'USER' }

    if (associatedDescription) {
      associated.description = associatedDescription
    }

    const result = await this.#apiRequest({
      path: '/api/v1/meta/schemas/user/linkedObjects',
      method: 'post',
      body: { primary, associated },
      logTag: 'createLinkedObjectDefinition',
    })

    return result.body
  }

  /**
   * @operationName Get Linked Object Definition
   * @category Linked Objects
   * @description Retrieves a single linked-object definition by its primary or associated name. Use this to inspect a relationship's two sides before linking users.
   * @route POST /get-linked-object-definition
   * @paramDef {"type":"String","label":"Linked Object","name":"linkedObjectName","required":true,"dictionary":"getLinkedObjectsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The linked-object definition (by primary or associated name)."}
   * @returns {Object}
   * @sampleResult {"primary":{"name":"manager","title":"manager","type":"USER"},"associated":{"name":"subordinate","title":"subordinate","type":"USER"}}
   */
  async getLinkedObjectDefinition(linkedObjectName) {
    const result = await this.#apiRequest({
      path: `/api/v1/meta/schemas/user/linkedObjects/${ encodeURIComponent(linkedObjectName) }`,
      logTag: 'getLinkedObjectDefinition',
    })

    return result.body
  }

  /**
   * @operationName Delete Linked Object Definition
   * @category Linked Objects
   * @description Deletes a whole linked-object relationship definition (both sides). Specify either the primary or associated name. Destructive - any user links using this relationship are removed.
   * @route POST /delete-linked-object-definition
   * @paramDef {"type":"String","label":"Linked Object","name":"linkedObjectName","required":true,"dictionary":"getLinkedObjectsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Delete the whole definition (specify either the primary or associated name)."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"linkedObjectName":"manager"}
   */
  async deleteLinkedObjectDefinition(linkedObjectName) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/LinkedObject/ (Delete a linked-object definition)
    await this.#apiRequest({
      path: `/api/v1/meta/schemas/user/linkedObjects/${ encodeURIComponent(linkedObjectName) }`,
      method: 'delete',
      logTag: 'deleteLinkedObjectDefinition',
    })

    return { deleted: true, linkedObjectName }
  }

  /**
   * @operationName Link Users
   * @category Linked Objects
   * @description Links two users in a relationship: the "Associated User" becomes the associated side (e.g. the subordinate) and the "Primary User" becomes the primary side (e.g. the manager) for the chosen relationship. Use this to set a manager, mentor, or other custom link.
   * @route POST /assign-linked-object-value-for-primary
   * @paramDef {"type":"String","label":"Associated User","name":"userIdOrLogin","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user who becomes the ASSOCIATED side (e.g. the subordinate)."}
   * @paramDef {"type":"String","label":"Relationship","name":"primaryRelationshipName","required":true,"dictionary":"getLinkedObjectsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The primary relationship name (e.g. manager)."}
   * @paramDef {"type":"String","label":"Primary User","name":"primaryUserId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user who becomes the PRIMARY side (e.g. the manager)."}
   * @returns {Object}
   * @sampleResult {"assigned":true,"associatedUserId":"00uASSOCIATED","primaryUserId":"00uPRIMARY","relationship":"manager"}
   */
  async assignLinkedObjectValueForPrimary(userIdOrLogin, primaryRelationshipName, primaryUserId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserLinkedObject/ (Assign a linked-object value - empty PUT body, path-only)
    await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userIdOrLogin) }/linkedObjects/${ encodeURIComponent(primaryRelationshipName) }/${ encodeURIComponent(primaryUserId) }`,
      method: 'put',
      logTag: 'assignLinkedObjectValueForPrimary',
    })

    return { assigned: true, associatedUserId: userIdOrLogin, primaryUserId, relationship: primaryRelationshipName }
  }

  /**
   * @operationName List User Linked Values
   * @category Linked Objects
   * @description Lists a user's linked values for a relationship - the link to their primary (if they are associated) or their associated users (if they are primary). Use this to read who a user reports to or who reports to them.
   * @route POST /list-linked-objects-for-user
   * @paramDef {"type":"String","label":"User","name":"userIdOrLogin","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user whose linked values to list."}
   * @paramDef {"type":"String","label":"Relationship","name":"relationshipName","required":true,"dictionary":"getLinkedObjectsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Relationship name (primary or associated)."}
   * @returns {Object}
   * @sampleResult {"items":[{"_links":{"manager":{"href":"https://your-org.okta.com/api/v1/users/00uPRIMARY"}}}],"cursor":null}
   */
  async listLinkedObjectsForUser(userIdOrLogin, relationshipName) {
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userIdOrLogin) }/linkedObjects/${ encodeURIComponent(relationshipName) }`,
      logTag: 'listLinkedObjectsForUser',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Unlink User
   * @category Linked Objects
   * @description Removes a user's relationship link for the named relationship (clears the link on the associated user's side). Use this to unset a manager, mentor, or other custom link. Destructive.
   * @route POST /delete-linked-object-for-user
   * @paramDef {"type":"String","label":"Associated User","name":"userIdOrLogin","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The associated user whose relationship to clear."}
   * @paramDef {"type":"String","label":"Relationship","name":"relationshipName","required":true,"dictionary":"getLinkedObjectsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The primary relationship name that defines the link to remove."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"userId":"00uASSOCIATED","relationship":"manager"}
   */
  async deleteLinkedObjectForUser(userIdOrLogin, relationshipName) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserLinkedObject/ (Delete a linked-object value for a user)
    await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userIdOrLogin) }/linkedObjects/${ encodeURIComponent(relationshipName) }`,
      method: 'delete',
      logTag: 'deleteLinkedObjectForUser',
    })

    return { deleted: true, userId: userIdOrLogin, relationship: relationshipName }
  }

  // Normalizes an Array-or-comma/newline-string of ids into a clean string[].
  #toIdArray(value) {
    if (Array.isArray(value)) {
      return value.map(item => String(item).trim()).filter(Boolean)
    }

    return String(value || '')
      .split(/[\n,]/)
      .map(item => item.trim())
      .filter(Boolean)
  }

  // Maps the flat sub-form values returned by the POLICY_* schemaLoaders into Okta's nested
  // conditions object: {people:{groups:{include:[...]},users:{exclude:[...]}}, network:{connection},
  // riskScore:{level}}. Returns undefined when nothing is set (so the body omits `conditions`).
  // Traced to the cited create-okta-sign-on-policy-response.conditions / sign-on-policy-rule.conditions.
  #buildPolicyConditions(conditions) {
    if (!conditions || typeof conditions !== 'object') {
      return undefined
    }

    const out = {}
    const include = this.#toIdArray(conditions.peopleGroupsInclude)
    const exclude = this.#toIdArray(conditions.peopleUsersExclude)

    if (include.length || exclude.length) {
      out.people = {}

      if (include.length) {
        out.people.groups = { include }
      }

      if (exclude.length) {
        out.people.users = { exclude }
      }
    }

    if (conditions.networkConnection) {
      out.network = { connection: conditions.networkConnection }
    }

    if (conditions.riskScoreLevel) {
      out.riskScore = { level: conditions.riskScoreLevel }
    }

    return Object.keys(out).length ? out : undefined
  }

  // Maps the flat sub-form values from POLICY_RULE_ACTIONS_SCHEMA into Okta's nested signon
  // actions object. Traced to the cited sign-on-policy-rule.actions.signon shape.
  #buildPolicyRuleActions(actions) {
    if (!actions || typeof actions !== 'object') {
      return undefined
    }

    const signon = {}

    if (actions.signonAccess) {
      signon.access = actions.signonAccess
    }

    if (actions.requireFactor !== undefined) {
      signon.requireFactor = actions.requireFactor
    }

    if (actions.factorPromptMode) {
      signon.factorPromptMode = actions.factorPromptMode
    }

    if (actions.primaryFactor) {
      signon.primaryFactor = actions.primaryFactor
    }

    const session = {}

    if (actions.maxSessionIdleMinutes !== undefined) {
      session.maxSessionIdleMinutes = actions.maxSessionIdleMinutes
    }

    if (actions.maxSessionLifetimeMinutes !== undefined) {
      session.maxSessionLifetimeMinutes = actions.maxSessionLifetimeMinutes
    }

    if (actions.usePersistentCookie !== undefined) {
      session.usePersistentCookie = actions.usePersistentCookie
    }

    if (Object.keys(session).length) {
      signon.session = session
    }

    return Object.keys(signon).length ? { signon } : undefined
  }

  // ==========================================================================
  //  POLICIES - CRUD + activate/deactivate (tag Policy)
  // ==========================================================================
  /**
   * @operationName List Policies
   * @category Policies
   * @description Lists policies of a given type (e.g. Global Session, Password, MFA Enroll). Okta requires the policy type - pick it from the dropdown. Use this to find a policy id before editing it or its rules.
   * @route POST /list-policies
   * @paramDef {"type":"String","label":"Policy Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Global Session (Okta Sign-On)","Password","Authenticator Enrollment (MFA Enroll)","App Sign-On (Access Policy)","User Profile (Profile Enrollment)","IdP Discovery","Entity Risk","Post-Auth Session","Device Signal Collection","Session Violation Detection","Client Update","Identity Claim Sourcing"]}},"description":"The policy type to list (required by Okta)."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Filter by policy status."}
   * @paramDef {"type":"String","label":"Name Prefix","name":"q","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Filter policies whose name starts with this prefix."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max policies per page."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous page's next link."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"policyId","type":"OKTA_SIGN_ON","name":"Policy name","status":"ACTIVE","priority":1,"system":false}],"cursor":null}
   */
  async listPolicies(type, status, q, limit, after) {
    type = this.#resolveChoice(type, POLICY_TYPE_LABELS)
    status = this.#resolveChoice(status, STATUS_LABELS)
    const query = { type }

    if (status) {
      query.status = status
    }

    if (q) {
      query.q = q
    }

    if (limit) {
      query.limit = limit
    }

    if (after) {
      query.after = after
    }

    const result = await this.#apiRequest({ path: '/api/v1/policies', query, logTag: 'listPolicies' })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Policy
   * @category Policies
   * @description Creates a policy of the chosen type. OKTA_SIGN_ON (Global Session) and PASSWORD work on any org; ACCESS_POLICY / PROFILE_ENROLLMENT require an Identity Engine org. Conditions and actions are type-specific sub-forms.
   * @route POST /create-policy
   * @paramDef {"type":"String","label":"Policy Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Global Session (Okta Sign-On)","Password","Authenticator Enrollment (MFA Enroll)","App Sign-On (Access Policy)","User Profile (Profile Enrollment)","IdP Discovery","Entity Risk","Post-Auth Session","Device Signal Collection","Session Violation Detection","Client Update","Identity Claim Sourcing"]}},"description":"Type of policy to create. OKTA_SIGN_ON and PASSWORD work on any org; ACCESS_POLICY/PROFILE_ENROLLMENT require an Identity Engine org."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Policy name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Human-readable description."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Evaluation priority (1 = highest). Optional; Okta assigns one if omitted."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Initial status. Defaults to ACTIVE."}
   * @paramDef {"type":"Object","label":"Conditions","name":"conditions","schemaLoader":"policyConditionsSchema","dependsOn":["type"],"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Who/when the policy applies (e.g. include groups). Sub-form fields depend on the chosen policy type."}
   * @paramDef {"type":"Object","label":"Actions","name":"actions","schemaLoader":"policyActionsSchema","dependsOn":["type"],"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What the policy enforces. For PASSWORD: complexity/age. Fields depend on policy type; omit to accept Okta defaults."}
   * @returns {Object}
   * @sampleResult {"type":"OKTA_SIGN_ON","id":"policyId","status":"ACTIVE","name":"Policy name","description":"Policy description","priority":1,"system":false,"conditions":{"people":{"groups":{"include":["groupId"]}}},"created":"2024-04-25T17:35:02.000Z","lastUpdated":"2024-04-25T17:35:02.000Z"}
   */
  async createPolicy(type, name, description, priority, status, conditions, actions) {
    type = this.#resolveChoice(type, POLICY_TYPE_LABELS)
    status = this.#resolveChoice(status, STATUS_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Policy/ (Create a policy - CreateOrUpdatePolicy; required type+name)
    const body = { type, name }

    if (description) {
      body.description = description
    }

    if (priority !== undefined && priority !== null) {
      body.priority = priority
    }

    if (status) {
      body.status = status
    }

    const cond = this.#buildPolicyConditions(conditions)

    if (cond) {
      body.conditions = cond
    }

    if (actions && typeof actions === 'object' && Object.keys(actions).length) {
      body.actions = actions
    }

    const result = await this.#apiRequest({
      path: '/api/v1/policies',
      method: 'post',
      body,
      logTag: 'createPolicy',
    })

    return result.body
  }

  /**
   * @operationName Get Policy
   * @category Policies
   * @description Retrieves a single policy by id, including its conditions. Use this to inspect a policy before editing it or its rules.
   * @route POST /get-policy
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getPoliciesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"policyId","type":"OKTA_SIGN_ON","name":"Policy name","status":"ACTIVE","priority":1,"system":false,"conditions":{"people":{"groups":{"include":["groupId"]}}}}
   */
  async getPolicy(policyId) {
    const result = await this.#apiRequest({
      path: `/api/v1/policies/${ encodeURIComponent(policyId) }`,
      logTag: 'getPolicy',
    })

    return result.body
  }

  /**
   * @operationName Replace Policy
   * @category Policies
   * @description Fully replaces a policy (PUT overwrite). The type is immutable and must match the existing policy. Use this to rename a policy or change its conditions/actions.
   * @route POST /replace-policy
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getPoliciesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy to replace (full overwrite)."}
   * @paramDef {"type":"String","label":"Policy Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Global Session (Okta Sign-On)","Password","Authenticator Enrollment (MFA Enroll)","App Sign-On (Access Policy)","User Profile (Profile Enrollment)","IdP Discovery","Entity Risk","Post-Auth Session","Device Signal Collection","Session Violation Detection","Client Update","Identity Claim Sourcing"]}},"description":"Must match the existing policy's type."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New policy name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New priority."}
   * @paramDef {"type":"Object","label":"Conditions","name":"conditions","schemaLoader":"policyConditionsSchema","dependsOn":["type"],"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Replacement conditions (see Create Policy)."}
   * @paramDef {"type":"Object","label":"Actions","name":"actions","schemaLoader":"policyActionsSchema","dependsOn":["type"],"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Replacement actions (see Create Policy)."}
   * @returns {Object}
   * @sampleResult {"id":"policyId","type":"OKTA_SIGN_ON","name":"Updated policy name","status":"ACTIVE","priority":1,"lastUpdated":"2024-04-25T17:40:00.000Z"}
   */
  async replacePolicy(policyId, type, name, description, priority, conditions, actions) {
    type = this.#resolveChoice(type, POLICY_TYPE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Policy/ (Replace a policy - CreateOrUpdatePolicy; required type+name)
    const body = { type, name }

    if (description) {
      body.description = description
    }

    if (priority !== undefined && priority !== null) {
      body.priority = priority
    }

    const cond = this.#buildPolicyConditions(conditions)

    if (cond) {
      body.conditions = cond
    }

    if (actions && typeof actions === 'object' && Object.keys(actions).length) {
      body.actions = actions
    }

    const result = await this.#apiRequest({
      path: `/api/v1/policies/${ encodeURIComponent(policyId) }`,
      method: 'put',
      body,
      logTag: 'replacePolicy',
    })

    return result.body
  }

  /**
   * @operationName Delete Policy
   * @category Policies
   * @description Deletes a policy permanently. Destructive - its rules go with it. Use with care.
   * @route POST /delete-policy
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getPoliciesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"policyId":"policyId"}
   */
  async deletePolicy(policyId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Policy/ (Delete a policy - 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/policies/${ encodeURIComponent(policyId) }`,
      method: 'delete',
      logTag: 'deletePolicy',
    })

    return { deleted: true, policyId }
  }

  /**
   * @operationName Activate Policy
   * @category Policies
   * @description Activates a policy so it is evaluated at sign-in. Use this after creating or editing a policy.
   * @route POST /activate-policy
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getPoliciesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy to activate."}
   * @returns {Object}
   * @sampleResult {"activated":true,"policyId":"policyId"}
   */
  async activatePolicy(policyId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Policy/ (Activate a policy - empty body, 204)
    await this.#apiRequest({
      path: `/api/v1/policies/${ encodeURIComponent(policyId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activatePolicy',
    })

    return { activated: true, policyId }
  }

  /**
   * @operationName Deactivate Policy
   * @category Policies
   * @description Deactivates a policy (required before it can be deleted in some cases). Use this to take a policy out of evaluation without deleting it.
   * @route POST /deactivate-policy
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getPoliciesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy to deactivate."}
   * @returns {Object}
   * @sampleResult {"deactivated":true,"policyId":"policyId"}
   */
  async deactivatePolicy(policyId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Policy/ (Deactivate a policy - empty body, 204)
    await this.#apiRequest({
      path: `/api/v1/policies/${ encodeURIComponent(policyId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivatePolicy',
    })

    return { deactivated: true, policyId }
  }

  // ==========================================================================
  //  POLICY RULES - CRUD + activate/deactivate (tag Policy, rule endpoints)
  // ==========================================================================
  /**
   * @operationName List Policy Rules
   * @category Policy Rules
   * @description Lists the rules inside a policy, in evaluation order. Use this to find a rule id before editing or reordering it.
   * @route POST /list-policy-rules
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getPoliciesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy whose rules to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max rules per page."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"0prh1sd28q5sXGW08697","type":"SIGN_ON","name":"Test Sign On","status":"ACTIVE","priority":0,"system":false}],"cursor":null}
   */
  async listPolicyRules(policyId, limit) {
    const query = {}

    if (limit) {
      query.limit = limit
    }

    const result = await this.#apiRequest({
      path: `/api/v1/policies/${ encodeURIComponent(policyId) }/rules`,
      query,
      logTag: 'listPolicyRules',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Policy Rule
   * @category Policy Rules
   * @description Adds a rule to a policy. The rule type must match the parent policy (e.g. SIGN_ON for a Global Session policy). Conditions and actions are type-specific sub-forms.
   * @route POST /create-policy-rule
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getPoliciesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy to add a rule to."}
   * @paramDef {"type":"String","label":"Rule Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Sign-On","Password","MFA Enroll","IdP Discovery","Access Policy","Profile Enrollment"]}},"description":"Rule type — must match the parent policy's type (e.g. SIGN_ON for a Global Session policy)."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Rule name."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Evaluation order (0 = first). Optional."}
   * @paramDef {"type":"Object","label":"Conditions","name":"conditions","schemaLoader":"policyRuleConditionsSchema","dependsOn":["type"],"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"When the rule matches. For SIGN_ON: network/riskScore + people. Fields depend on rule type."}
   * @paramDef {"type":"Object","label":"Actions","name":"actions","schemaLoader":"policyRuleActionsSchema","dependsOn":["type"],"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What the rule does when matched. For SIGN_ON: access (ALLOW/DENY), requireFactor, session timeouts."}
   * @returns {Object}
   * @sampleResult {"type":"SIGN_ON","name":"Test Sign On","id":"0prh1sd28q5sXGW08697","priority":0,"status":"ACTIVE","system":false,"actions":{"signon":{"access":"ALLOW","requireFactor":false,"factorPromptMode":"ALWAYS","session":{"maxSessionIdleMinutes":720,"maxSessionLifetimeMinutes":0,"usePersistentCookie":false},"primaryFactor":"PASSWORD_IDP_ANY_FACTOR"}}}
   */
  async createPolicyRule(policyId, type, name, priority, conditions, actions) {
    type = this.#resolveChoice(type, POLICY_RULE_TYPE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Policy/ (Create a policy rule - spec example sign-on-policy-rule)
    const body = { type, name }

    if (priority !== undefined && priority !== null) {
      body.priority = priority
    }

    const cond = this.#buildPolicyConditions(conditions)

    if (cond) {
      body.conditions = cond
    }

    const act = this.#buildPolicyRuleActions(actions)

    if (act) {
      body.actions = act
    }

    const result = await this.#apiRequest({
      path: `/api/v1/policies/${ encodeURIComponent(policyId) }/rules`,
      method: 'post',
      body,
      logTag: 'createPolicyRule',
    })

    return result.body
  }

  /**
   * @operationName Get Policy Rule
   * @category Policy Rules
   * @description Retrieves a single rule inside a policy by id. Use this to inspect a rule's conditions and actions before editing.
   * @route POST /get-policy-rule
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getPoliciesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The parent policy."}
   * @paramDef {"type":"String","label":"Rule","name":"ruleId","required":true,"dictionary":"getPolicyRulesDictionary","dependsOn":["policyId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The rule to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"0prh1sd28q5sXGW08697","type":"SIGN_ON","name":"Test Sign On","status":"ACTIVE","priority":0,"system":false}
   */
  async getPolicyRule(policyId, ruleId) {
    const result = await this.#apiRequest({
      path: `/api/v1/policies/${ encodeURIComponent(policyId) }/rules/${ encodeURIComponent(ruleId) }`,
      logTag: 'getPolicyRule',
    })

    return result.body
  }

  /**
   * @operationName Replace Policy Rule
   * @category Policy Rules
   * @description Fully replaces a rule inside a policy (PUT overwrite). The rule type is immutable and must match the existing rule. Use this to change a rule's conditions or actions.
   * @route POST /replace-policy-rule
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getPoliciesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The parent policy."}
   * @paramDef {"type":"String","label":"Rule","name":"ruleId","required":true,"dictionary":"getPolicyRulesDictionary","dependsOn":["policyId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The rule to replace."}
   * @paramDef {"type":"String","label":"Rule Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Sign-On","Password","MFA Enroll","IdP Discovery","Access Policy","Profile Enrollment"]}},"description":"Must match the existing rule's type."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New rule name."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New priority."}
   * @paramDef {"type":"Object","label":"Conditions","name":"conditions","schemaLoader":"policyRuleConditionsSchema","dependsOn":["type"],"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Replacement conditions (see Create Policy Rule)."}
   * @paramDef {"type":"Object","label":"Actions","name":"actions","schemaLoader":"policyRuleActionsSchema","dependsOn":["type"],"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Replacement actions (see Create Policy Rule)."}
   * @returns {Object}
   * @sampleResult {"id":"0prh1sd28q5sXGW08697","type":"SIGN_ON","name":"Updated Sign On","status":"ACTIVE","priority":0}
   */
  async replacePolicyRule(policyId, ruleId, type, name, priority, conditions, actions) {
    type = this.#resolveChoice(type, POLICY_RULE_TYPE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Policy/ (Replace a policy rule - spec example sign-on-policy-rule, full replacement)
    const body = { type, name }

    if (priority !== undefined && priority !== null) {
      body.priority = priority
    }

    const cond = this.#buildPolicyConditions(conditions)

    if (cond) {
      body.conditions = cond
    }

    const act = this.#buildPolicyRuleActions(actions)

    if (act) {
      body.actions = act
    }

    const result = await this.#apiRequest({
      path: `/api/v1/policies/${ encodeURIComponent(policyId) }/rules/${ encodeURIComponent(ruleId) }`,
      method: 'put',
      body,
      logTag: 'replacePolicyRule',
    })

    return result.body
  }

  /**
   * @operationName Delete Policy Rule
   * @category Policy Rules
   * @description Deletes a rule from a policy permanently. Destructive - use with care.
   * @route POST /delete-policy-rule
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getPoliciesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The parent policy."}
   * @paramDef {"type":"String","label":"Rule","name":"ruleId","required":true,"dictionary":"getPolicyRulesDictionary","dependsOn":["policyId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The rule to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"ruleId":"0prh1sd28q5sXGW08697"}
   */
  async deletePolicyRule(policyId, ruleId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Policy/ (Delete a policy rule - 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/policies/${ encodeURIComponent(policyId) }/rules/${ encodeURIComponent(ruleId) }`,
      method: 'delete',
      logTag: 'deletePolicyRule',
    })

    return { deleted: true, ruleId }
  }

  /**
   * @operationName Activate Policy Rule
   * @category Policy Rules
   * @description Activates a rule inside a policy so it is evaluated. Use this after creating or editing a rule.
   * @route POST /activate-policy-rule
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getPoliciesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The parent policy."}
   * @paramDef {"type":"String","label":"Rule","name":"ruleId","required":true,"dictionary":"getPolicyRulesDictionary","dependsOn":["policyId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The rule to activate."}
   * @returns {Object}
   * @sampleResult {"activated":true,"ruleId":"0prh1sd28q5sXGW08697"}
   */
  async activatePolicyRule(policyId, ruleId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Policy/ (Activate a policy rule - empty body, 204)
    await this.#apiRequest({
      path: `/api/v1/policies/${ encodeURIComponent(policyId) }/rules/${ encodeURIComponent(ruleId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activatePolicyRule',
    })

    return { activated: true, ruleId }
  }

  /**
   * @operationName Deactivate Policy Rule
   * @category Policy Rules
   * @description Deactivates a rule inside a policy (required before it can be deleted). Use this to disable a rule without deleting it.
   * @route POST /deactivate-policy-rule
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getPoliciesDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The parent policy."}
   * @paramDef {"type":"String","label":"Rule","name":"ruleId","required":true,"dictionary":"getPolicyRulesDictionary","dependsOn":["policyId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The rule to deactivate."}
   * @returns {Object}
   * @sampleResult {"deactivated":true,"ruleId":"0prh1sd28q5sXGW08697"}
   */
  async deactivatePolicyRule(policyId, ruleId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Policy/ (Deactivate a policy rule - empty body, 204)
    await this.#apiRequest({
      path: `/api/v1/policies/${ encodeURIComponent(policyId) }/rules/${ encodeURIComponent(ruleId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivatePolicyRule',
    })

    return { deactivated: true, ruleId }
  }

  // ==========================================================================
  //  AUTHORIZATION SERVERS - CRUD + activate/deactivate (tag AuthorizationServer)
  // ==========================================================================
  /**
   * @operationName List Authorization Servers
   * @category Authorization Servers
   * @description Lists custom OAuth 2.0 / OIDC authorization servers in your org. Use this to find a server id before managing its scopes, claims, or lifecycle. Requires the API Access Management add-on.
   * @route POST /list-authorization-servers
   * @paramDef {"type":"String","label":"Search","name":"q","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Match against authorization server name and audiences."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max servers per page (max 200)."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"aus1234","name":"Sample Authorization Server","audiences":["api://default"],"issuer":"https://example.okta.com/oauth2/aus1234","status":"ACTIVE"}],"cursor":null}
   */
  async listAuthorizationServers(q, limit, after) {
    const query = {}

    if (q) {
      query.q = q
    }

    if (limit) {
      query.limit = limit
    }

    if (after) {
      query.after = after
    }

    const result = await this.#apiRequest({ path: '/api/v1/authorizationServers', query, logTag: 'listAuthorizationServers' })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Authorization Server
   * @category Authorization Servers
   * @description Creates a custom OAuth 2.0 / OIDC authorization server with one or more token audiences. Use this to issue API access tokens with custom scopes and claims. Requires the API Access Management add-on.
   * @route POST /create-authorization-server
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Authorization server name."}
   * @paramDef {"type":"Array","label":"Audiences","name":"audiences","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Resource URI(s) the issued tokens are intended for (e.g. api://default). One per line / array of strings."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Human-readable description."}
   * @paramDef {"type":"String","label":"Issuer Mode","name":"issuerMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Org URL","Custom URL","Dynamic"]}},"description":"How the issuer URL is constructed in tokens. Defaults to ORG_URL."}
   * @returns {Object}
   * @sampleResult {"id":"{authorizationServerId}","name":"Sample Authorization Server","description":"Sample Authorization Server description","audiences":["api://default"],"issuer":"https://{yourOktaDomain}/oauth2/{authorizationServerId}","issuerMode":"ORG_URL","status":"ACTIVE","created":"2023-05-17T22:25:57.000Z","lastUpdated":"2023-05-17T22:25:57.000Z"}
   */
  async createAuthorizationServer(name, audiences, description, issuerMode) {
    issuerMode = this.#resolveChoice(issuerMode, ISSUER_MODE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServer/ (Create an authorization server - CreateAuthServerBody; required name+audiences)
    const body = { name, audiences: this.#toIdArray(audiences) }

    if (description) {
      body.description = description
    }

    if (issuerMode) {
      body.issuerMode = issuerMode
    }

    const result = await this.#apiRequest({
      path: '/api/v1/authorizationServers',
      method: 'post',
      body,
      logTag: 'createAuthorizationServer',
    })

    return result.body
  }

  /**
   * @operationName Get Authorization Server
   * @category Authorization Servers
   * @description Retrieves a single authorization server by id, including its audiences, issuer, and signing credentials. Use this to inspect a server before editing it.
   * @route POST /get-authorization-server
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The authorization server to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"aus1234","name":"Sample Authorization Server","audiences":["api://default"],"issuer":"https://example.okta.com/oauth2/aus1234","issuerMode":"ORG_URL","status":"ACTIVE"}
   */
  async getAuthorizationServer(authServerId) {
    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }`,
      logTag: 'getAuthorizationServer',
    })

    return result.body
  }

  /**
   * @operationName Replace Authorization Server
   * @category Authorization Servers
   * @description Fully replaces an authorization server (PUT overwrite - supply name and the complete audience list). Use this to rename a server or change its audiences/issuer mode.
   * @route POST /replace-authorization-server
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The server to replace (full overwrite)."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New name."}
   * @paramDef {"type":"Array","label":"Audiences","name":"audiences","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New audience URI(s). One per line / array of strings."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"String","label":"Issuer Mode","name":"issuerMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Org URL","Custom URL","Dynamic"]}},"description":"New issuer mode."}
   * @returns {Object}
   * @sampleResult {"id":"aus1234","name":"Sample Authorization Server","audiences":["api://default"],"status":"ACTIVE","lastUpdated":"2023-05-17T22:30:00.000Z"}
   */
  async replaceAuthorizationServer(authServerId, name, audiences, description, issuerMode) {
    issuerMode = this.#resolveChoice(issuerMode, ISSUER_MODE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServer/ (Replace an authorization server - CreateAuthServerBody; required name+audiences)
    const body = { name, audiences: this.#toIdArray(audiences) }

    if (description) {
      body.description = description
    }

    if (issuerMode) {
      body.issuerMode = issuerMode
    }

    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }`,
      method: 'put',
      body,
      logTag: 'replaceAuthorizationServer',
    })

    return result.body
  }

  /**
   * @operationName Delete Authorization Server
   * @category Authorization Servers
   * @description Deletes an authorization server permanently. It must be deactivated first (Okta returns 403 if it is active). Destructive - use with care.
   * @route POST /delete-authorization-server
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The server to delete. Must be deactivated first (Okta 403s if active)."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"authServerId":"aus1234"}
   */
  async deleteAuthorizationServer(authServerId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServer/ (Delete an authorization server - 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }`,
      method: 'delete',
      logTag: 'deleteAuthorizationServer',
    })

    return { deleted: true, authServerId }
  }

  /**
   * @operationName Activate Authorization Server
   * @category Authorization Servers
   * @description Activates an authorization server so it can issue tokens. Use this after creating or editing a server.
   * @route POST /activate-authorization-server
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The server to activate."}
   * @returns {Object}
   * @sampleResult {"activated":true,"authServerId":"aus1234"}
   */
  async activateAuthorizationServer(authServerId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServer/ (Activate an authorization server - empty body, 204)
    await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateAuthorizationServer',
    })

    return { activated: true, authServerId }
  }

  /**
   * @operationName Deactivate Authorization Server
   * @category Authorization Servers
   * @description Deactivates an authorization server (required before it can be deleted). Use this to stop a server from issuing tokens without deleting it.
   * @route POST /deactivate-authorization-server
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The server to deactivate."}
   * @returns {Object}
   * @sampleResult {"deactivated":true,"authServerId":"aus1234"}
   */
  async deactivateAuthorizationServer(authServerId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServer/ (Deactivate an authorization server - empty body, 204)
    await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateAuthorizationServer',
    })

    return { deactivated: true, authServerId }
  }

  // ==========================================================================
  //  AUTH SERVER SCOPES & CLAIMS (tags AuthorizationServerScopes / Claims)
  // ==========================================================================
  /**
   * @operationName List Token Scopes
   * @category Authorization Server Scopes
   * @description Lists the custom OAuth scopes defined on an authorization server. Use this to find a scope id before editing or deleting it.
   * @route POST /list-oauth2-scopes
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max scopes per page."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"scp1234","name":"car:drive","displayName":"Saml Jackson","consent":"REQUIRED","default":false,"system":false}],"cursor":null}
   */
  async listOAuth2Scopes(authServerId, limit, after) {
    const query = {}

    if (limit) {
      query.limit = limit
    }

    if (after) {
      query.after = after
    }

    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/scopes`,
      query,
      logTag: 'listOAuth2Scopes',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Token Scope
   * @category Authorization Server Scopes
   * @description Creates a custom OAuth scope on an authorization server. Use this to define a permission (e.g. car:drive) that apps can request. Requires the API Access Management add-on.
   * @route POST /create-oauth2-scope
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Scope Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Scope identifier (e.g. car:drive)."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Friendly name shown on the consent dialog."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What the scope grants."}
   * @paramDef {"type":"String","label":"Consent","name":"consent","uiComponent":{"type":"DROPDOWN","options":{"values":["Implicit (no dialog)","Required","Flexible"]}},"description":"Whether a user consent dialog is needed. Defaults to Implicit."}
   * @paramDef {"type":"String","label":"Publish in Metadata","name":"metadataPublish","uiComponent":{"type":"DROPDOWN","options":{"values":["No Clients","All Clients"]}},"description":"Whether the scope appears in the server's discovery metadata. Defaults to No Clients."}
   * @returns {Object}
   * @sampleResult {"id":"scp1234","name":"car:drive","description":"Drive car","displayName":"Saml Jackson","consent":"REQUIRED","metadataPublish":"NO_CLIENTS","default":false,"system":false}
   */
  async createOAuth2Scope(authServerId, name, displayName, description, consent, metadataPublish) {
    consent = this.#resolveChoice(consent, CONSENT_LABELS)
    metadataPublish = this.#resolveChoice(metadataPublish, METADATA_PUBLISH_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerScopes/ (Create a custom token scope - CreateOAuth2ScopeRequest; required name)
    const body = this.#buildScopeBody(name, displayName, description, consent, metadataPublish)

    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/scopes`,
      method: 'post',
      body,
      logTag: 'createOAuth2Scope',
    })

    return result.body
  }

  /**
   * @operationName Get Token Scope
   * @category Authorization Server Scopes
   * @description Retrieves a single custom OAuth scope by id. Use this to inspect a scope before editing it.
   * @route POST /get-oauth2-scope
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Scope","name":"scopeId","required":true,"dictionary":"getScopesDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The scope to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"scp1234","name":"car:drive","displayName":"Saml Jackson","consent":"REQUIRED","default":false,"system":false}
   */
  async getOAuth2Scope(authServerId, scopeId) {
    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/scopes/${ encodeURIComponent(scopeId) }`,
      logTag: 'getOAuth2Scope',
    })

    return result.body
  }

  /**
   * @operationName Replace Token Scope
   * @category Authorization Server Scopes
   * @description Fully replaces a custom OAuth scope (PUT overwrite). Use this to rename a scope or change its consent behavior.
   * @route POST /replace-oauth2-scope
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Scope","name":"scopeId","required":true,"dictionary":"getScopesDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The scope to replace."}
   * @paramDef {"type":"String","label":"Scope Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Scope identifier."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Friendly name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What the scope grants."}
   * @paramDef {"type":"String","label":"Consent","name":"consent","uiComponent":{"type":"DROPDOWN","options":{"values":["Implicit (no dialog)","Required","Flexible"]}},"description":"Consent behavior."}
   * @paramDef {"type":"String","label":"Publish in Metadata","name":"metadataPublish","uiComponent":{"type":"DROPDOWN","options":{"values":["No Clients","All Clients"]}},"description":"Metadata visibility."}
   * @returns {Object}
   * @sampleResult {"id":"scp1234","name":"car:drive","displayName":"Drive","consent":"IMPLICIT"}
   */
  async replaceOAuth2Scope(authServerId, scopeId, name, displayName, description, consent, metadataPublish) {
    consent = this.#resolveChoice(consent, CONSENT_LABELS)
    metadataPublish = this.#resolveChoice(metadataPublish, METADATA_PUBLISH_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerScopes/ (Replace a custom token scope - CreateOAuth2ScopeRequest; required name)
    const body = this.#buildScopeBody(name, displayName, description, consent, metadataPublish)

    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/scopes/${ encodeURIComponent(scopeId) }`,
      method: 'put',
      body,
      logTag: 'replaceOAuth2Scope',
    })

    return result.body
  }

  /**
   * @operationName Delete Token Scope
   * @category Authorization Server Scopes
   * @description Deletes a custom OAuth scope from an authorization server permanently. Destructive - use with care.
   * @route POST /delete-oauth2-scope
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Scope","name":"scopeId","required":true,"dictionary":"getScopesDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The scope to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"scopeId":"scp1234"}
   */
  async deleteOAuth2Scope(authServerId, scopeId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerScopes/ (Delete a custom token scope - 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/scopes/${ encodeURIComponent(scopeId) }`,
      method: 'delete',
      logTag: 'deleteOAuth2Scope',
    })

    return { deleted: true, scopeId }
  }

  /**
   * @operationName List Token Claims
   * @category Authorization Server Claims
   * @description Lists the custom token claims defined on an authorization server. Use this to find a claim id before editing or deleting it.
   * @route POST /list-oauth2-claims
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"clm1234","name":"Support","status":"ACTIVE","claimType":"IDENTITY","valueType":"GROUPS","value":"Support"}],"cursor":null}
   */
  async listOAuth2Claims(authServerId) {
    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/claims`,
      logTag: 'listOAuth2Claims',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Token Claim
   * @category Authorization Server Claims
   * @description Creates a custom token claim on an authorization server - a value (Okta Expression or a group match) injected into the access or ID token. Requires the API Access Management add-on.
   * @route POST /create-oauth2-claim
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Claim Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Name of the claim as it appears in the token."}
   * @paramDef {"type":"String","label":"Claim Type","name":"claimType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Access Token (Resource)","ID Token (Identity)"]}},"description":"Whether the claim goes in the access token (Resource) or the ID token (Identity)."}
   * @paramDef {"type":"String","label":"Value Type","name":"valueType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Expression (Okta EL)","Groups","System"]}},"description":"How the value is interpreted: an Okta Expression Language expression, a set of groups, or a system claim."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"An Okta EL expression (if Expression) or a literal matched against group names (if Groups)."}
   * @paramDef {"type":"Boolean","label":"Always Include In Token","name":"alwaysIncludeInToken","uiComponent":{"type":"TOGGLE"},"description":"Include the claim even when the token is requested with the access token / authorization_code. Always true for access-token claims."}
   * @paramDef {"type":"Array","label":"Scopes","name":"scopes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Scopes that this claim is bound to (maps to conditions.scopes). One per line / array."}
   * @paramDef {"type":"String","label":"Group Filter Type","name":"groupFilterType","uiComponent":{"type":"DROPDOWN","options":{"values":["Contains","Equals","Starts With","Regex"]}},"description":"How the value matches group names. Used only when Value Type is Groups."}
   * @returns {Object}
   * @sampleResult {"id":"{claimId}","name":"Support","status":"ACTIVE","claimType":"IDENTITY","valueType":"GROUPS","value":"Support","group_filter_type":"CONTAINS","conditions":{"scopes":["profile"]}}
   */
  async createOAuth2Claim(authServerId, name, claimType, valueType, value, alwaysIncludeInToken, scopes, groupFilterType) {
    claimType = this.#resolveChoice(claimType, CLAIM_TYPE_LABELS)
    valueType = this.#resolveChoice(valueType, CLAIM_VALUE_TYPE_LABELS)
    groupFilterType = this.#resolveChoice(groupFilterType, GROUP_FILTER_TYPE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerClaims/ (Create a custom token claim - CreateCustomTokenClaimBody; required name+claimType+value+valueType)
    const body = this.#buildClaimBody(name, claimType, valueType, value, alwaysIncludeInToken, scopes, groupFilterType)

    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/claims`,
      method: 'post',
      body,
      logTag: 'createOAuth2Claim',
    })

    return result.body
  }

  /**
   * @operationName Get Token Claim
   * @category Authorization Server Claims
   * @description Retrieves a single custom token claim by id. Use this to inspect a claim before editing it.
   * @route POST /get-oauth2-claim
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Claim","name":"claimId","required":true,"dictionary":"getClaimsDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The claim to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"clm1234","name":"Support","status":"ACTIVE","claimType":"IDENTITY","valueType":"GROUPS","value":"Support"}
   */
  async getOAuth2Claim(authServerId, claimId) {
    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/claims/${ encodeURIComponent(claimId) }`,
      logTag: 'getOAuth2Claim',
    })

    return result.body
  }

  /**
   * @operationName Replace Token Claim
   * @category Authorization Server Claims
   * @description Fully replaces a custom token claim (PUT overwrite). Use this to change a claim's value, type, or scope binding.
   * @route POST /replace-oauth2-claim
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Claim","name":"claimId","required":true,"dictionary":"getClaimsDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The claim to replace."}
   * @paramDef {"type":"String","label":"Claim Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Claim name."}
   * @paramDef {"type":"String","label":"Claim Type","name":"claimType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Access Token (Resource)","ID Token (Identity)"]}},"description":"Access vs ID token."}
   * @paramDef {"type":"String","label":"Value Type","name":"valueType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Expression (Okta EL)","Groups","System"]}},"description":"Value interpretation."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"EL expression or group literal."}
   * @paramDef {"type":"Boolean","label":"Always Include In Token","name":"alwaysIncludeInToken","uiComponent":{"type":"TOGGLE"},"description":"Force inclusion in token."}
   * @paramDef {"type":"Array","label":"Scopes","name":"scopes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Bound scopes (conditions.scopes). One per line / array."}
   * @paramDef {"type":"String","label":"Group Filter Type","name":"groupFilterType","uiComponent":{"type":"DROPDOWN","options":{"values":["Contains","Equals","Starts With","Regex"]}},"description":"Group match mode (Groups only)."}
   * @returns {Object}
   * @sampleResult {"id":"clm1234","name":"Support","status":"ACTIVE","claimType":"IDENTITY","valueType":"GROUPS","value":"Support"}
   */
  async replaceOAuth2Claim(authServerId, claimId, name, claimType, valueType, value, alwaysIncludeInToken, scopes, groupFilterType) {
    claimType = this.#resolveChoice(claimType, CLAIM_TYPE_LABELS)
    valueType = this.#resolveChoice(valueType, CLAIM_VALUE_TYPE_LABELS)
    groupFilterType = this.#resolveChoice(groupFilterType, GROUP_FILTER_TYPE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerClaims/ (Replace a custom token claim - CreateCustomTokenClaimBody; required name+claimType+value+valueType)
    const body = this.#buildClaimBody(name, claimType, valueType, value, alwaysIncludeInToken, scopes, groupFilterType)

    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/claims/${ encodeURIComponent(claimId) }`,
      method: 'put',
      body,
      logTag: 'replaceOAuth2Claim',
    })

    return result.body
  }

  /**
   * @operationName Delete Token Claim
   * @category Authorization Server Claims
   * @description Deletes a custom token claim from an authorization server permanently. Destructive - use with care.
   * @route POST /delete-oauth2-claim
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Claim","name":"claimId","required":true,"dictionary":"getClaimsDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The claim to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"claimId":"clm1234"}
   */
  async deleteOAuth2Claim(authServerId, claimId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerClaims/ (Delete a custom token claim - 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/claims/${ encodeURIComponent(claimId) }`,
      method: 'delete',
      logTag: 'deleteOAuth2Claim',
    })

    return { deleted: true, claimId }
  }

  // Builds an OAuth2Scope create/replace body. Traced to CreateOAuth2ScopeRequest (required name).
  #buildScopeBody(name, displayName, description, consent, metadataPublish) {
    const body = { name }

    if (displayName) {
      body.displayName = displayName
    }

    if (description) {
      body.description = description
    }

    if (consent) {
      body.consent = consent
    }

    if (metadataPublish) {
      body.metadataPublish = metadataPublish
    }

    return body
  }

  // Builds a CreateCustomTokenClaimBody. Required: name, claimType, value, valueType. Optional:
  // alwaysIncludeInToken, conditions.scopes, group_filter_type (snake_case per the spec field name).
  // Traced to the cited CreateCustomTokenClaimBody example.
  #buildClaimBody(name, claimType, valueType, value, alwaysIncludeInToken, scopes, groupFilterType) {
    const body = { name, claimType, valueType, value }

    if (alwaysIncludeInToken !== undefined && alwaysIncludeInToken !== null) {
      body.alwaysIncludeInToken = alwaysIncludeInToken
    }

    const scopeList = this.#toIdArray(scopes)

    if (scopeList.length) {
      body.conditions = { scopes: scopeList }
    }

    if (groupFilterType) {
      body.group_filter_type = groupFilterType
    }

    return body
  }

  // ==========================================================================
  //  SCHEMAS & PROFILE MAPPINGS (tags Schema / ProfileMapping)
  // ==========================================================================
  /**
   * @operationName Get User Schema
   * @category Schemas
   * @description Retrieves a user profile schema (base + custom attributes). Use 'default' for the default user type, or a type's schema id from List User Types. Use this to inspect the available profile attributes before mapping or updating them.
   * @route POST /get-user-schema
   * @paramDef {"type":"String","label":"User Schema","name":"schema","defaultValue":"default","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Schema id, or 'default' for the default user type. Get a type's schema id from List User Types."}
   * @returns {Object}
   * @sampleResult {"id":"https://{yourOktaDomain}/meta/schemas/user/default","name":"user","title":"Default Okta user","definitions":{"base":{"properties":{"login":{"title":"Username","type":"string"}}},"custom":{"properties":{}}}}
   */
  async getUserSchema(schema) {
    const id = schema || 'default'

    const result = await this.#apiRequest({
      path: `/api/v1/meta/schemas/user/${ encodeURIComponent(id) }`,
      logTag: 'getUserSchema',
    })

    return result.body
  }

  /**
   * @operationName Update User Schema
   * @category Schemas
   * @description Adds, edits, or removes custom user profile attributes by sending a JSON-Schema Draft 4 fragment. Use this to extend the user profile with org-specific fields. Set a property to null to remove it.
   * @route POST /update-user-profile
   * @paramDef {"type":"String","label":"User Schema","name":"schema","defaultValue":"default","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Schema id or 'default'."}
   * @paramDef {"type":"Object","label":"Schema Definitions","name":"definitions","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON-Schema Draft 4 fragment. To add a custom property: {\"custom\":{\"id\":\"#custom\",\"type\":\"object\",\"properties\":{\"<name>\":{\"title\":\"...\",\"type\":\"string\",\"permissions\":[{\"principal\":\"SELF\",\"action\":\"READ_WRITE\"}]}},\"required\":[]}}. Set a property to null to remove it."}
   * @returns {Object}
   * @sampleResult {"id":"https://{yourOktaDomain}/meta/schemas/user/oscmlha7lcRyMn82P1d7","name":"user","definitions":{"custom":{"properties":{"salesforceUserName":{"title":"Salesforce username","type":"string","minLength":1,"maxLength":20}}}}}
   */
  async updateUserProfile(schema, definitions) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Schema/ (Update the user profile schema - UserSchemaAddRequest; body { definitions })
    const id = schema || 'default'

    const result = await this.#apiRequest({
      path: `/api/v1/meta/schemas/user/${ encodeURIComponent(id) }`,
      method: 'post',
      body: { definitions: this.#parseJsonObject(definitions, 'Schema Definitions') },
      logTag: 'updateUserProfile',
    })

    return result.body
  }

  /**
   * @operationName Get Group Schema
   * @category Schemas
   * @description Retrieves the group profile schema (base + custom attributes). Use this to inspect the available group profile attributes.
   * @route POST /get-group-schema
   * @returns {Object}
   * @sampleResult {"$schema":"http://json-schema.org/draft-04/schema#","definitions":{"base":{"id":"#base","required":["name"]},"custom":{"id":"#custom","properties":{}}}}
   */
  async getGroupSchema() {
    const result = await this.#apiRequest({
      path: '/api/v1/meta/schemas/group/default',
      logTag: 'getGroupSchema',
    })

    return result.body
  }

  /**
   * @operationName Update Group Schema
   * @category Schemas
   * @description Adds, edits, or removes custom group profile attributes via a JSON-Schema fragment. Base group properties cannot be changed. Set a property to null to remove it.
   * @route POST /update-group-schema
   * @paramDef {"type":"Object","label":"Schema Definitions","name":"definitions","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON-Schema fragment for the group custom profile. e.g. {\"custom\":{\"id\":\"#custom\",\"type\":\"object\",\"properties\":{\"groupContact\":{\"title\":\"Group administrative contact\",\"type\":\"string\"}},\"required\":[]}}. Base group properties cannot be changed."}
   * @returns {Object}
   * @sampleResult {"definitions":{"custom":{"properties":{"groupContact":{"title":"Group administrative contact","type":"string"}}}}}
   */
  async updateGroupSchema(definitions) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Schema/ (Update the group profile schema - GroupSchemaAddRequest; body { definitions })
    const result = await this.#apiRequest({
      path: '/api/v1/meta/schemas/group/default',
      method: 'post',
      body: { definitions: this.#parseJsonObject(definitions, 'Schema Definitions') },
      logTag: 'updateGroupSchema',
    })

    return result.body
  }

  /**
   * @operationName Get App User Schema
   * @category Schemas
   * @description Retrieves an application's user profile schema (the attributes Okta provisions to that app). Use this to inspect app-user attributes before editing mappings.
   * @route POST /get-application-user-schema
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The app whose user schema to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"https://{yourOktaDomain}/meta/schemas/apps/0oa25gejWwdXNnFH90g4/default","name":"Example app","definitions":{"base":{"properties":{"userName":{"title":"Username","type":"string","required":true}}},"custom":{"properties":{}}}}
   */
  async getApplicationUserSchema(appId) {
    const result = await this.#apiRequest({
      path: `/api/v1/meta/schemas/apps/${ encodeURIComponent(appId) }/default`,
      logTag: 'getApplicationUserSchema',
    })

    return result.body
  }

  /**
   * @operationName Update App User Schema
   * @category Schemas
   * @description Adds, edits, or removes custom attributes on an application's user schema via a JSON-Schema fragment. App custom properties may carry an externalName. Set a property to null to remove it.
   * @route POST /update-application-user-profile
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The app whose user schema to update."}
   * @paramDef {"type":"Object","label":"Schema Definitions","name":"definitions","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON-Schema fragment for the app-user custom profile. App custom properties also carry an optional externalName. e.g. {\"custom\":{\"id\":\"#custom\",\"type\":\"object\",\"properties\":{\"salesforceUserName\":{\"title\":\"Salesforce username\",\"externalName\":\"salesforceUserName\",\"type\":\"string\"}},\"required\":[]}}."}
   * @returns {Object}
   * @sampleResult {"id":"https://{yourOktaDomain}/meta/schemas/apps/0oa25gejWwdXNnFH90g4/default","definitions":{"custom":{"properties":{"salesforceUserName":{"title":"Salesforce username","externalName":"salesforceUserName","type":"string"}}}}}
   */
  async updateApplicationUserProfile(appId, definitions) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Schema/ (Update the app user profile schema - AppUserSchemaAddRequest; body { definitions })
    const result = await this.#apiRequest({
      path: `/api/v1/meta/schemas/apps/${ encodeURIComponent(appId) }/default`,
      method: 'post',
      body: { definitions: this.#parseJsonObject(definitions, 'Schema Definitions') },
      logTag: 'updateApplicationUserProfile',
    })

    return result.body
  }

  /**
   * @operationName List Profile Mappings
   * @category Profile Mappings
   * @description Lists the attribute mappings between sources and targets (e.g. Okta user -> an app's user profile). Use this to find a mapping id before retrieving or editing it.
   * @route POST /list-profile-mappings
   * @paramDef {"type":"String","label":"Source","name":"source","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Filter to mappings whose source (user-type or app) is this id."}
   * @paramDef {"type":"String","label":"Target","name":"target","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Filter to mappings whose target is this id."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (default 20, max 200)."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor (from the Link header)."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"prm1k47ghydIQOTBW0g4","source":{"id":"otysbePhQ3yqt4cVv0g3","name":"user","type":"user"},"target":{"id":"0oa1qmn4LZQQEH0wZ0g4","name":"okta_org2org","type":"appuser"}}],"cursor":null}
   */
  async listProfileMappings(source, target, limit, after) {
    const query = {}

    if (source) {
      query.sourceId = source
    }

    if (target) {
      query.targetId = target
    }

    if (limit) {
      query.limit = limit
    }

    if (after) {
      query.after = after
    }

    const result = await this.#apiRequest({ path: '/api/v1/mappings', query, logTag: 'listProfileMappings' })

    return this.#listResult(result)
  }

  /**
   * @operationName Get Profile Mapping
   * @category Profile Mappings
   * @description Retrieves a single profile mapping by id, including each target property's expression and push status. Use this to inspect a mapping before editing it.
   * @route POST /get-profile-mapping
   * @paramDef {"type":"String","label":"Profile Mapping","name":"mappingId","required":true,"dictionary":"getProfileMappingsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The mapping to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"prm1k47ghydIQOTBW0g4","source":{"id":"otysbePhQ3yqt4cVv0g3","name":"user","type":"user"},"target":{"id":"0oa1qmn4LZQQEH0wZ0g4","name":"okta_org2org","type":"appuser"},"properties":{"fullName":{"expression":"user.firstName + user.lastName","pushStatus":"PUSH"}}}
   */
  async getProfileMapping(mappingId) {
    const result = await this.#apiRequest({
      path: `/api/v1/mappings/${ encodeURIComponent(mappingId) }`,
      logTag: 'getProfileMapping',
    })

    return result.body
  }

  /**
   * @operationName Update Profile Mapping
   * @category Profile Mappings
   * @description Updates the attribute mappings on a profile mapping. Each target property maps to {expression, pushStatus}. Use this to control which attributes flow to a downstream app. Set a property to null to remove its mapping.
   * @route POST /update-profile-mapping
   * @paramDef {"type":"String","label":"Profile Mapping","name":"mappingId","required":true,"dictionary":"getProfileMappingsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The mapping to update."}
   * @paramDef {"type":"Object","label":"Property Mappings","name":"properties","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Map of target-property → {expression, pushStatus}. e.g. {\"fullName\":{\"expression\":\"user.firstName + user.lastName\",\"pushStatus\":\"PUSH\"}}. pushStatus is PUSH or DONT_PUSH. Set a property to null to remove its mapping."}
   * @returns {Object}
   * @sampleResult {"id":"prm1k47ghydIQOTBW0g4","properties":{"fullName":{"expression":"user.firstName + user.lastName","pushStatus":"PUSH"},"nickName":{"expression":"user.nickName","pushStatus":"PUSH"}}}
   */
  async updateProfileMapping(mappingId, properties) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ProfileMapping/ (Update a profile mapping - AddMappingBody; body { properties })
    const result = await this.#apiRequest({
      path: `/api/v1/mappings/${ encodeURIComponent(mappingId) }`,
      method: 'post',
      body: { properties: this.#parseJsonObject(properties, 'Property Mappings') },
      logTag: 'updateProfileMapping',
    })

    return result.body
  }

  // Accepts an already-parsed object (FlowRunner passes Object params through) or a JSON string
  // (raw freeform entry / AI-tool call). Returns a plain object; throws a friendly error otherwise.
  #parseJsonObject(value, label) {
    if (value && typeof value === 'object') {
      return value
    }

    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value)

        if (parsed && typeof parsed === 'object') {
          return parsed
        }
      } catch {
        throw new Error(`${ label } must be a valid JSON object.`)
      }
    }

    throw new Error(`${ label } is required and must be a JSON object.`)
  }

  // ==========================================================================
  //  SESSIONS (tags Session / UserSessions)
  // ==========================================================================
  /**
   * @operationName Get Session
   * @category Sessions
   * @description Retrieves a single sign-in session by its id, including the user, status, and expiry. Use this to inspect a live session (the id comes from a prior authentication or a System Log event). There is no list-sessions endpoint, so the id is entered directly.
   * @route POST /get-session
   * @paramDef {"type":"String","label":"Session ID","name":"session","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The session ID (from a prior authentication or a System Log event). No dictionary — sessions are short-lived and not enumerable via the admin API."}
   * @returns {Object}
   * @sampleResult {"id":"l7FbDVqS8zHSy65uJD85","login":"user@example.com","userId":"00u0abcdefGHIJKLMNOP","status":"ACTIVE","amr":["pwd"],"createdAt":"2019-08-24T14:15:22Z","expiresAt":"2019-08-24T14:15:22Z"}
   */
  async getSession(session) {
    const result = await this.#apiRequest({
      path: `/api/v1/sessions/${ encodeURIComponent(session) }`,
      logTag: 'getSession',
    })

    return result.body
  }

  /**
   * @operationName Refresh Session
   * @category Sessions
   * @description Extends a sign-in session's lifetime (its expiry is pushed out). Use this to keep an active session alive.
   * @route POST /refresh-session
   * @paramDef {"type":"String","label":"Session ID","name":"session","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The session to refresh; its expiresAt is extended."}
   * @returns {Object}
   * @sampleResult {"id":"l7FbDVqS8zHSy65uJD85","userId":"00u0abcdefGHIJKLMNOP","status":"ACTIVE","expiresAt":"2019-08-24T15:15:22Z"}
   */
  async refreshSession(session) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Session/ (Refresh a session - POST .../lifecycle/refresh, empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/sessions/${ encodeURIComponent(session) }/lifecycle/refresh`,
      method: 'post',
      logTag: 'refreshSession',
    })

    return result.body
  }

  /**
   * @operationName Revoke Session
   * @category Sessions
   * @description Immediately ends a single sign-in session - the user is signed out of it. Destructive - use with care.
   * @route POST /revoke-session
   * @paramDef {"type":"String","label":"Session ID","name":"session","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The session to revoke (immediately ends it)."}
   * @returns {Object}
   * @sampleResult {"revoked":true,"sessionId":"l7FbDVqS8zHSy65uJD85"}
   */
  async revokeSession(session) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Session/ (Revoke a session - DELETE, 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/sessions/${ encodeURIComponent(session) }`,
      method: 'delete',
      logTag: 'revokeSession',
    })

    return { revoked: true, sessionId: session }
  }

  /**
   * @operationName Revoke All User Sessions
   * @category Sessions
   * @description Ends all of a user's sign-in sessions, forcing them to re-authenticate everywhere. Optionally also revoke their OAuth tokens and clear remembered devices. Use this to lock out a compromised account.
   * @route POST /revoke-user-sessions
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user whose sessions to revoke (forces re-authentication)."}
   * @paramDef {"type":"Boolean","label":"Also Revoke OAuth Tokens","name":"oauthTokens","uiComponent":{"type":"TOGGLE"},"description":"Also revoke the user's OIDC/OAuth refresh and access tokens. Default off."}
   * @paramDef {"type":"Boolean","label":"Forget Remembered Devices","name":"forgetDevices","uiComponent":{"type":"TOGGLE"},"description":"Clear the user's remembered MFA factors on all devices. Default on."}
   * @returns {Object}
   * @sampleResult {"revoked":true,"userId":"00u0abcdefGHIJKLMNOP"}
   */
  async revokeUserSessions(userId, oauthTokens, forgetDevices) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserSessions/ (Revoke all user sessions - DELETE, query { oauthTokens?, forgetDevices? }, 204 No Content)
    const query = {}

    if (oauthTokens !== undefined && oauthTokens !== null) {
      query.oauthTokens = oauthTokens
    }

    if (forgetDevices !== undefined && forgetDevices !== null) {
      query.forgetDevices = forgetDevices
    }

    await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/sessions`,
      method: 'delete',
      query,
      logTag: 'revokeUserSessions',
    })

    return { revoked: true, userId }
  }

  // ==========================================================================
  //  AUTHENTICATORS (tag Authenticator)
  // ==========================================================================
  /**
   * @operationName List Authenticators
   * @category Authenticators
   * @description Lists the MFA authenticators configured in your org (email, phone, security key, etc.) with each one's status. Use this to find an authenticator id before editing it.
   * @route POST /list-authenticators
   * @paramDef {"type":"String","label":"Expand","name":"expand","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional embed, e.g. 'methods' to include each authenticator's methods."}
   * @returns {Object}
   * @sampleResult {"items":[{"type":"email","id":"aut1nbsPHh7jNjjyP0g4","key":"okta_email","status":"ACTIVE","name":"Email","settings":{"allowedFor":"any","tokenLifetimeInMinutes":5}}],"cursor":null}
   */
  async listAuthenticators(expand) {
    const query = {}

    if (expand) {
      query.expand = expand
    }

    const result = await this.#apiRequest({ path: '/api/v1/authenticators', query, logTag: 'listAuthenticators' })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Authenticator
   * @category Authenticators
   * @description Adds an MFA authenticator to your org (e.g. Duo Security or a Temporary Access Code). Fill in the connection settings for the chosen type. Use this to offer a new sign-in factor.
   * @route POST /create-authenticator
   * @paramDef {"type":"String","label":"Authenticator Type","name":"key","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Duo Security","Temporary Access Code","Custom App (Push)","On-Prem MFA","Symantec VIP","YubiKey OTP","WebAuthn / FIDO2","Smart Card IdP"]}},"description":"Which authenticator to add. Each type has its own connection settings below."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name for this authenticator."}
   * @paramDef {"type":"Object","label":"Provider Settings","name":"provider","schemaLoader":"authenticatorProviderSchema","dependsOn":["key"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Connection settings for the chosen authenticator. Fields depend on the type."}
   * @returns {Object}
   * @sampleResult {"type":"app","id":"aut9gnvcjUHIWb37J0g4","key":"duo","status":"ACTIVE","name":"Duo Security","provider":{"type":"DUO","configuration":{"host":"https://api-xxxxxxxx.duosecurity.com","userNameTemplate":{"template":"oktaId"}}}}
   */
  async createAuthenticator(key, name, provider) {
    key = this.#resolveChoice(key, AUTHENTICATOR_KEY_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Authenticator/#tag/Authenticator/operation/createAuthenticator (AuthenticatorRequestDuo / AuthenticatorRequestTac; body { key, name, provider })
    const body = this.#buildAuthenticatorBody(key, name, provider)

    const result = await this.#apiRequest({
      path: '/api/v1/authenticators',
      method: 'post',
      body,
      logTag: 'createAuthenticator',
    })

    return result.body
  }

  /**
   * @operationName Get Authenticator
   * @category Authenticators
   * @description Retrieves a single authenticator by id, including its settings and status. Use this to inspect an authenticator before editing it.
   * @route POST /get-authenticator
   * @paramDef {"type":"String","label":"Authenticator","name":"authenticatorId","required":true,"dictionary":"getAuthenticatorsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The authenticator to retrieve."}
   * @returns {Object}
   * @sampleResult {"type":"phone","id":"aut1nbuyD8m1ckAYc0g4","key":"phone_number","status":"INACTIVE","name":"Phone","settings":{"allowedFor":"none"}}
   */
  async getAuthenticator(authenticatorId) {
    const result = await this.#apiRequest({
      path: `/api/v1/authenticators/${ encodeURIComponent(authenticatorId) }`,
      logTag: 'getAuthenticator',
    })

    return result.body
  }

  /**
   * @operationName Replace Authenticator
   * @category Authenticators
   * @description Fully replaces an authenticator's configuration (PUT overwrite). The type must match the existing one. Built-in authenticators (email/password/phone/security question) are configured this way.
   * @route POST /replace-authenticator
   * @paramDef {"type":"String","label":"Authenticator","name":"authenticatorId","required":true,"dictionary":"getAuthenticatorsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The authenticator to update (full replace)."}
   * @paramDef {"type":"String","label":"Authenticator Type","name":"key","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Duo Security","Temporary Access Code","Custom App (Push)","On-Prem MFA","Symantec VIP","YubiKey OTP","WebAuthn / FIDO2","Smart Card IdP"]}},"description":"Must match the existing authenticator's type."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New display name."}
   * @paramDef {"type":"Object","label":"Provider Settings","name":"provider","schemaLoader":"authenticatorProviderSchema","dependsOn":["key"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Replacement provider settings (see Create)."}
   * @returns {Object}
   * @sampleResult {"type":"app","id":"aut9gnvcjUHIWb37J0g4","key":"duo","status":"ACTIVE","name":"Duo Security"}
   */
  async replaceAuthenticator(authenticatorId, key, name, provider) {
    key = this.#resolveChoice(key, AUTHENTICATOR_KEY_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Authenticator/#tag/Authenticator/operation/replaceAuthenticator (AuthenticatorRequestDuo shape; full replacement)
    const body = this.#buildAuthenticatorBody(key, name, provider)

    const result = await this.#apiRequest({
      path: `/api/v1/authenticators/${ encodeURIComponent(authenticatorId) }`,
      method: 'put',
      body,
      logTag: 'replaceAuthenticator',
    })

    return result.body
  }

  /**
   * @operationName Activate Authenticator
   * @category Authenticators
   * @description Activates an authenticator so users can enroll and use it for MFA. Use this after adding or configuring one.
   * @route POST /activate-authenticator
   * @paramDef {"type":"String","label":"Authenticator","name":"authenticatorId","required":true,"dictionary":"getAuthenticatorsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The authenticator to activate (enable for enrollment)."}
   * @returns {Object}
   * @sampleResult {"id":"aut1nbuyD8m1ckAYc0g4","key":"phone_number","status":"ACTIVE"}
   */
  async activateAuthenticator(authenticatorId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Authenticator/#tag/Authenticator/operation/activateAuthenticator (POST .../lifecycle/activate, empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/authenticators/${ encodeURIComponent(authenticatorId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateAuthenticator',
    })

    return result.body
  }

  /**
   * @operationName Deactivate Authenticator
   * @category Authenticators
   * @description Deactivates an authenticator so users can no longer enroll or use it for MFA. Use with care - existing enrollments may be affected.
   * @route POST /deactivate-authenticator
   * @paramDef {"type":"String","label":"Authenticator","name":"authenticatorId","required":true,"dictionary":"getAuthenticatorsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The authenticator to deactivate."}
   * @returns {Object}
   * @sampleResult {"id":"aut1nbsPHh7jNjjyP0g4","key":"okta_email","status":"INACTIVE"}
   */
  async deactivateAuthenticator(authenticatorId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Authenticator/#tag/Authenticator/operation/deactivateAuthenticator (POST .../lifecycle/deactivate, empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/authenticators/${ encodeURIComponent(authenticatorId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateAuthenticator',
    })

    return result.body
  }

  /**
   * @operationName List Authenticator Methods
   * @category Authenticators
   * @description Lists the methods within an authenticator (e.g. SMS and voice under the Phone authenticator) with each method's status. Use this to find a method type before editing it.
   * @route POST /list-authenticator-methods
   * @paramDef {"type":"String","label":"Authenticator","name":"authenticatorId","required":true,"dictionary":"getAuthenticatorsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The authenticator whose methods to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"type":"sms","status":"ACTIVE"},{"type":"voice","status":"INACTIVE"}],"cursor":null}
   */
  async listAuthenticatorMethods(authenticatorId) {
    const result = await this.#apiRequest({
      path: `/api/v1/authenticators/${ encodeURIComponent(authenticatorId) }/methods`,
      logTag: 'listAuthenticatorMethods',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Get Authenticator Method
   * @category Authenticators
   * @description Retrieves a single method within an authenticator, including its settings. Use this to inspect a method before editing it.
   * @route POST /get-authenticator-method
   * @paramDef {"type":"String","label":"Authenticator","name":"authenticatorId","required":true,"dictionary":"getAuthenticatorsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The authenticator."}
   * @paramDef {"type":"String","label":"Method","name":"methodType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["SMS","Voice Call","Email","Push","TOTP","OTP","WebAuthn","Signed Nonce (Okta FastPass)","Security Question","Password","Certificate","Duo","IdP","Temporary Access Code"]}},"description":"The method type within the authenticator."}
   * @returns {Object}
   * @sampleResult {"type":"sms","status":"ACTIVE"}
   */
  async getAuthenticatorMethod(authenticatorId, methodType) {
    methodType = this.#resolveChoice(methodType, AUTHENTICATOR_METHOD_LABELS)
    const result = await this.#apiRequest({
      path: `/api/v1/authenticators/${ encodeURIComponent(authenticatorId) }/methods/${ encodeURIComponent(methodType) }`,
      logTag: 'getAuthenticatorMethod',
    })

    return result.body
  }

  /**
   * @operationName Replace Authenticator Method
   * @category Authenticators
   * @description Updates a method within an authenticator (its status and any method-specific settings, e.g. WebAuthn user verification). Use this to tune how a method behaves.
   * @route POST /replace-authenticator-method
   * @paramDef {"type":"String","label":"Authenticator","name":"authenticatorId","required":true,"dictionary":"getAuthenticatorsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The authenticator."}
   * @paramDef {"type":"String","label":"Method","name":"methodType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["SMS","Voice Call","Email","Push","TOTP","OTP","WebAuthn","Signed Nonce (Okta FastPass)","Security Question","Password","Certificate","Duo","IdP","Temporary Access Code"]}},"description":"The method type to replace."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Whether this method is enabled."}
   * @paramDef {"type":"Object","label":"Method Settings","name":"settings","schemaLoader":"authenticatorMethodSettingsSchema","dependsOn":["methodType"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Method-specific settings (e.g. WebAuthn userVerification/attachment). Optional."}
   * @returns {Object}
   * @sampleResult {"type":"webauthn","status":"ACTIVE","settings":{"userVerification":"DISCOURAGED","attachment":"ANY"}}
   */
  async replaceAuthenticatorMethod(authenticatorId, methodType, status, settings) {
    methodType = this.#resolveChoice(methodType, AUTHENTICATOR_METHOD_LABELS)
    status = this.#resolveChoice(status, STATUS_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Authenticator/#tag/Authenticator/operation/replaceAuthenticatorMethod (AuthenticatorMethodBase; body { type, status?, settings? })
    const body = { type: methodType }

    if (status) {
      body.status = status
    }

    const parsedSettings = settings && (typeof settings === 'object' || (typeof settings === 'string' && settings.trim()))
      ? this.#parseJsonObject(settings, 'Method Settings')
      : null

    if (parsedSettings && Object.keys(parsedSettings).length) {
      body.settings = parsedSettings
    }

    const result = await this.#apiRequest({
      path: `/api/v1/authenticators/${ encodeURIComponent(authenticatorId) }/methods/${ encodeURIComponent(methodType) }`,
      method: 'put',
      body,
      logTag: 'replaceAuthenticatorMethod',
    })

    return result.body
  }

  /**
   * @operationName Activate Authenticator Method
   * @category Authenticators
   * @description Activates a method within an authenticator (e.g. enable SMS under Phone). Use this to let users enroll that method.
   * @route POST /activate-authenticator-method
   * @paramDef {"type":"String","label":"Authenticator","name":"authenticatorId","required":true,"dictionary":"getAuthenticatorsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The authenticator."}
   * @paramDef {"type":"String","label":"Method","name":"methodType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["SMS","Voice Call","Email","Push","TOTP","OTP","WebAuthn","Signed Nonce (Okta FastPass)","Security Question","Password","Certificate","Duo","IdP","Temporary Access Code"]}},"description":"The method to activate."}
   * @returns {Object}
   * @sampleResult {"type":"sms","status":"ACTIVE"}
   */
  async activateAuthenticatorMethod(authenticatorId, methodType) {
    methodType = this.#resolveChoice(methodType, AUTHENTICATOR_METHOD_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Authenticator/#tag/Authenticator/operation/activateAuthenticatorMethod (POST .../methods/{methodType}/lifecycle/activate, empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/authenticators/${ encodeURIComponent(authenticatorId) }/methods/${ encodeURIComponent(methodType) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateAuthenticatorMethod',
    })

    return result.body
  }

  /**
   * @operationName Deactivate Authenticator Method
   * @category Authenticators
   * @description Deactivates a method within an authenticator (e.g. disable voice under Phone). Use with care.
   * @route POST /deactivate-authenticator-method
   * @paramDef {"type":"String","label":"Authenticator","name":"authenticatorId","required":true,"dictionary":"getAuthenticatorsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The authenticator."}
   * @paramDef {"type":"String","label":"Method","name":"methodType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["SMS","Voice Call","Email","Push","TOTP","OTP","WebAuthn","Signed Nonce (Okta FastPass)","Security Question","Password","Certificate","Duo","IdP","Temporary Access Code"]}},"description":"The method to deactivate."}
   * @returns {Object}
   * @sampleResult {"type":"voice","status":"INACTIVE"}
   */
  async deactivateAuthenticatorMethod(authenticatorId, methodType) {
    methodType = this.#resolveChoice(methodType, AUTHENTICATOR_METHOD_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Authenticator/#tag/Authenticator/operation/deactivateAuthenticatorMethod (POST .../methods/{methodType}/lifecycle/deactivate, empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/authenticators/${ encodeURIComponent(authenticatorId) }/methods/${ encodeURIComponent(methodType) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateAuthenticatorMethod',
    })

    return result.body
  }

  /**
   * @operationName List Custom AAGUIDs
   * @category Authenticators
   * @description Lists the custom WebAuthn AAGUIDs (security-key vendor/model allowlist) on an authenticator. Use this to see which security-key models are permitted.
   * @route POST /list-all-custom-aaguids
   * @paramDef {"type":"String","label":"Authenticator","name":"authenticatorId","required":true,"dictionary":"getAuthenticatorsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A WebAuthn/custom-app authenticator whose allowed AAGUIDs to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"aaguid":"cb69481e-8ff7-4039-93ec-0a272911111","name":"My Security Key"}],"cursor":null}
   */
  async listAllCustomAAGUIDs(authenticatorId) {
    const result = await this.#apiRequest({
      path: `/api/v1/authenticators/${ encodeURIComponent(authenticatorId) }/aaguids`,
      logTag: 'listAllCustomAAGUIDs',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Custom AAGUID
   * @category Authenticators
   * @description Adds a custom WebAuthn AAGUID (a security-key vendor/model) to an authenticator's allowlist, with its attestation root certificate(s). Use this to permit a specific security-key model.
   * @route POST /create-custom-aaguid
   * @paramDef {"type":"String","label":"Authenticator","name":"authenticatorId","required":true,"dictionary":"getAuthenticatorsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The WebAuthn authenticator to add this AAGUID to."}
   * @paramDef {"type":"String","label":"AAGUID","name":"aaguid","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The authenticator's AAGUID (vendor/model identifier, a GUID)."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Friendly name for this security-key model."}
   * @paramDef {"type":"Object","label":"Characteristics","name":"authenticatorCharacteristics","schemaLoader":"aaguidCharacteristicsSchema","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Key characteristics (platform-attached, FIPS, hardware-protected)."}
   * @paramDef {"type":"Array<Object>","label":"Attestation Root Certificates","name":"attestationRootCertificates","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"List of attestation root certs as {\"x5c\":\"...\"} objects. Irreducible vendor cert blobs — entered as raw JSON array."}
   * @returns {Object}
   * @sampleResult {"aaguid":"cb69481e-8ff7-4039-93ec-0a272911111","name":"My Security Key","authenticatorCharacteristics":{"platformAttached":false,"fipsCompliant":false,"hardwareProtected":false}}
   */
  async createCustomAAGUID(authenticatorId, aaguid, name, authenticatorCharacteristics, attestationRootCertificates) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Authenticator/#tag/Authenticator/operation/createCustomAAGUID (CustomAAGUIDCreateRequestObject; body { aaguid, name, authenticatorCharacteristics?, attestationRootCertificates? })
    const body = this.#buildAaguidBody(aaguid, name, authenticatorCharacteristics, attestationRootCertificates)

    const result = await this.#apiRequest({
      path: `/api/v1/authenticators/${ encodeURIComponent(authenticatorId) }/aaguids`,
      method: 'post',
      body,
      logTag: 'createCustomAAGUID',
    })

    return result.body
  }

  /**
   * @operationName Get Custom AAGUID
   * @category Authenticators
   * @description Retrieves a single custom WebAuthn AAGUID by id. Use this to inspect an allowed security-key model.
   * @route POST /get-custom-aaguid
   * @paramDef {"type":"String","label":"Authenticator","name":"authenticatorId","required":true,"dictionary":"getAuthenticatorsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The authenticator."}
   * @paramDef {"type":"String","label":"AAGUID","name":"aaguid","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The AAGUID to retrieve."}
   * @returns {Object}
   * @sampleResult {"aaguid":"cb69481e-8ff7-4039-93ec-0a272911111","name":"My Security Key"}
   */
  async getCustomAAGUID(authenticatorId, aaguid) {
    const result = await this.#apiRequest({
      path: `/api/v1/authenticators/${ encodeURIComponent(authenticatorId) }/aaguids/${ encodeURIComponent(aaguid) }`,
      logTag: 'getCustomAAGUID',
    })

    return result.body
  }

  /**
   * @operationName Replace Custom AAGUID
   * @category Authenticators
   * @description Fully replaces a custom WebAuthn AAGUID (PUT overwrite). Use this to rename it or update its attestation certificates.
   * @route POST /replace-custom-aaguid
   * @paramDef {"type":"String","label":"Authenticator","name":"authenticatorId","required":true,"dictionary":"getAuthenticatorsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The authenticator."}
   * @paramDef {"type":"String","label":"AAGUID","name":"aaguid","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The AAGUID to replace (full overwrite)."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New friendly name."}
   * @paramDef {"type":"Object","label":"Characteristics","name":"authenticatorCharacteristics","schemaLoader":"aaguidCharacteristicsSchema","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Replacement characteristics (see Create)."}
   * @paramDef {"type":"Array<Object>","label":"Attestation Root Certificates","name":"attestationRootCertificates","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Replacement attestation root certs as {\"x5c\":\"...\"} objects (raw JSON array)."}
   * @returns {Object}
   * @sampleResult {"aaguid":"cb69481e-8ff7-4039-93ec-0a272911111","name":"My Security Key v2"}
   */
  async replaceCustomAAGUID(authenticatorId, aaguid, name, authenticatorCharacteristics, attestationRootCertificates) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Authenticator/#tag/Authenticator/operation/replaceCustomAAGUID (CustomAAGUIDCreateRequestObject; full replacement)
    const body = this.#buildAaguidBody(aaguid, name, authenticatorCharacteristics, attestationRootCertificates)

    const result = await this.#apiRequest({
      path: `/api/v1/authenticators/${ encodeURIComponent(authenticatorId) }/aaguids/${ encodeURIComponent(aaguid) }`,
      method: 'put',
      body,
      logTag: 'replaceCustomAAGUID',
    })

    return result.body
  }

  /**
   * @operationName Delete Custom AAGUID
   * @category Authenticators
   * @description Removes a custom WebAuthn AAGUID from an authenticator's allowlist. That security-key model is no longer permitted. Destructive - use with care.
   * @route POST /delete-custom-aaguid
   * @paramDef {"type":"String","label":"Authenticator","name":"authenticatorId","required":true,"dictionary":"getAuthenticatorsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The authenticator."}
   * @paramDef {"type":"String","label":"AAGUID","name":"aaguid","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The AAGUID to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"aaguid":"cb69481e-8ff7-4039-93ec-0a272911111"}
   */
  async deleteCustomAAGUID(authenticatorId, aaguid) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Authenticator/#tag/Authenticator/operation/deleteCustomAAGUID (DELETE, 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/authenticators/${ encodeURIComponent(authenticatorId) }/aaguids/${ encodeURIComponent(aaguid) }`,
      method: 'delete',
      logTag: 'deleteCustomAAGUID',
    })

    return { deleted: true, aaguid }
  }

  /**
   * @operationName Get Well-Known App Authenticator Config
   * @category Authenticators
   * @description Retrieves the public discovery document for a custom-app (push) authenticator - its enroll endpoint and supported methods - for a given OAuth client id. Read-only.
   * @route POST /get-well-known-app-authenticator-configuration
   * @paramDef {"type":"String","label":"OAuth Client ID","name":"oauthClient","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom-app (push) authenticator's OAuth client id."}
   * @returns {Object}
   * @sampleResult {"appAuthenticatorEnrollEndpoint":"https://{yourOktaDomain}/idp/authenticators","supportedMethods":[{"type":"push"}]}
   */
  async getWellKnownAppAuthenticatorConfiguration(oauthClient) {
    const result = await this.#apiRequest({
      path: '/.well-known/app-authenticator-configuration',
      query: { oauthClientId: oauthClient },
      logTag: 'getWellKnownAppAuthenticatorConfiguration',
    })

    return result.body
  }

  // Builds the polymorphic Authenticator create/replace body. `provider` arrives as the flat sub-form
  // object from authenticatorProviderSchema. Traced to AuthenticatorRequestDuo / AuthenticatorRequestTac.
  #buildAuthenticatorBody(key, name, provider) {
    const body = { key, name }
    const p = provider && (typeof provider === 'object' || (typeof provider === 'string' && provider.trim()))
      ? this.#parseJsonObject(provider, 'Provider Settings')
      : null

    if (key === 'duo' && p) {
      body.provider = {
        type: 'DUO',
        configuration: {
          integrationKey: p.integrationKey,
          secretKey: p.secretKey,
          host: p.host,
          userNameTemplate: { template: p.userNameTemplate || 'oktaId' },
        },
      }
    } else if (key === 'tac' && p) {
      const configuration = {
        complexity: {
          numbers: p.numbers === undefined ? true : p.numbers,
          letters: p.letters === undefined ? true : p.letters,
          specialCharacters: p.specialCharacters === undefined ? true : p.specialCharacters,
        },
      }

      this.#assignIfSet(configuration, 'minTtl', p.minTtl)
      this.#assignIfSet(configuration, 'maxTtl', p.maxTtl)
      this.#assignIfSet(configuration, 'defaultTtl', p.defaultTtl)
      this.#assignIfSet(configuration, 'length', p.length)
      this.#assignIfSet(configuration, 'multiUseAllowed', p.multiUseAllowed)

      body.provider = { type: 'tac', configuration }
    } else if (p && Object.keys(p).length) {
      // Any other provider-bearing type: pass the raw configuration through verbatim.
      body.provider = p
    }

    return body
  }

  // Builds a CustomAAGUIDCreateRequestObject. `authenticatorCharacteristics` is the flat sub-form
  // object; `attestationRootCertificates` is a raw JSON array of {x5c} cert blobs.
  #buildAaguidBody(aaguid, name, authenticatorCharacteristics, attestationRootCertificates) {
    const body = { aaguid, name }

    const characteristics = authenticatorCharacteristics &&
      (typeof authenticatorCharacteristics === 'object' || (typeof authenticatorCharacteristics === 'string' && authenticatorCharacteristics.trim()))
      ? this.#parseJsonObject(authenticatorCharacteristics, 'Characteristics')
      : null

    if (characteristics && Object.keys(characteristics).length) {
      body.authenticatorCharacteristics = characteristics
    }

    const certs = this.#parseJsonArray(attestationRootCertificates)

    if (certs.length) {
      body.attestationRootCertificates = certs
    }

    return body
  }

  // Assigns key only when value is not null/undefined (lets defaults stand server-side).
  #assignIfSet(target, key, value) {
    if (value !== undefined && value !== null) {
      target[key] = value
    }
  }

  // Parses an already-array value or a JSON-array string into an array; returns [] when empty/invalid.
  #parseJsonArray(value) {
    if (Array.isArray(value)) {
      return value
    }

    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value)

        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }

    return []
  }

  // ==========================================================================
  //  IDENTITY PROVIDERS (tags IdentityProvider / IdentityProviderUsers)
  // ==========================================================================
  /**
   * @operationName List Identity Providers
   * @category Identity Providers
   * @description Lists the external identity providers (social and enterprise IdPs) configured in your org. Use this to find an IdP id before editing, activating, or deleting it.
   * @route POST /list-identity-providers
   * @paramDef {"type":"String","label":"Name Prefix","name":"q","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Filter IdPs whose name starts with this prefix."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Generic OpenID Connect","Generic SAML 2.0","Google","Facebook","Microsoft","Apple","LinkedIn","GitHub","GitLab","Amazon","Salesforce","Spotify","Discord","PayPal","Xero","Yahoo","Smart Card (X.509)","Okta Org2Org"]}},"description":"Filter by IdP type."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max IdPs per page."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"0oa1k5d68qR2954hb0g4","type":"OIDC","name":"Example OpenID Connect IdP","status":"ACTIVE"}],"cursor":null}
   */
  async listIdentityProviders(q, type, limit, after) {
    type = this.#resolveChoice(type, IDP_TYPE_LABELS)
    const query = {}

    if (q) {
      query.q = q
    }

    if (type) {
      query.type = type
    }

    if (limit) {
      query.limit = limit
    }

    if (after) {
      query.after = after
    }

    const result = await this.#apiRequest({ path: '/api/v1/idps', query, logTag: 'listIdentityProviders' })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Identity Provider
   * @category Identity Providers
   * @description Adds an external identity provider so users can sign in through it (e.g. Google, a generic OIDC, or SAML 2.0 provider). Fill in the connection settings for the chosen type. Use this to enable social or enterprise federated sign-in.
   * @route POST /create-identity-provider
   * @paramDef {"type":"String","label":"IdP Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Generic OpenID Connect","Generic SAML 2.0","Google","Facebook","Microsoft","Apple","LinkedIn","GitHub","GitLab","Amazon","Salesforce","Spotify","Discord","PayPal","Xero","Yahoo","Smart Card (X.509)","Okta Org2Org"]}},"description":"The social or enterprise provider type. OIDC and SAML2 are the generic configurable types."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name for this IdP."}
   * @paramDef {"type":"Object","label":"Protocol","name":"protocol","required":true,"schemaLoader":"idpProtocolSchema","dependsOn":["type"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Connection settings for the chosen provider. Fields depend on type."}
   * @paramDef {"type":"Object","label":"Policy","name":"policy","required":true,"schemaLoader":"idpPolicySchema","dependsOn":["type"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Account-link, provisioning, and subject-matching policy. Sensible defaults provided."}
   * @returns {Object}
   * @sampleResult {"id":"0oa1k5d68qR2954hb0g4","type":"OIDC","name":"Example OpenID Connect IdP","status":"ACTIVE","protocol":{"type":"OIDC","scopes":["openid","profile","email"]},"policy":{"provisioning":{"action":"AUTO"},"subject":{"matchType":"USERNAME"}}}
   */
  async createIdentityProvider(type, name, protocol, policy) {
    type = this.#resolveChoice(type, IDP_TYPE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/IdentityProvider/ (Create an identity provider - CreateGenericOidcIdPRequest; body { type, name, protocol, policy })
    const body = this.#buildIdpBody(type, name, protocol, policy)

    const result = await this.#apiRequest({
      path: '/api/v1/idps',
      method: 'post',
      body,
      logTag: 'createIdentityProvider',
    })

    return result.body
  }

  /**
   * @operationName Get Identity Provider
   * @category Identity Providers
   * @description Retrieves a single identity provider by id, including its protocol and policy configuration. Use this to inspect an IdP before editing it.
   * @route POST /get-identity-provider
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"0oa1k5d68qR2954hb0g4","type":"OIDC","name":"Example OpenID Connect IdP","status":"ACTIVE"}
   */
  async getIdentityProvider(idpId) {
    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }`,
      logTag: 'getIdentityProvider',
    })

    return result.body
  }

  /**
   * @operationName Replace Identity Provider
   * @category Identity Providers
   * @description Fully replaces an identity provider's configuration (PUT overwrite). The type must match the existing IdP. Use this to update connection settings or policy.
   * @route POST /replace-identity-provider
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP to replace (full overwrite)."}
   * @paramDef {"type":"String","label":"IdP Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Generic OpenID Connect","Generic SAML 2.0","Google","Facebook","Microsoft","Apple","LinkedIn","GitHub","GitLab","Amazon","Salesforce","Spotify","Discord","PayPal","Xero","Yahoo","Smart Card (X.509)","Okta Org2Org"]}},"description":"Must match the existing IdP's type."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New display name."}
   * @paramDef {"type":"Object","label":"Protocol","name":"protocol","required":true,"schemaLoader":"idpProtocolSchema","dependsOn":["type"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Replacement protocol settings (see Create)."}
   * @paramDef {"type":"Object","label":"Policy","name":"policy","required":true,"schemaLoader":"idpPolicySchema","dependsOn":["type"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Replacement policy settings (see Create)."}
   * @returns {Object}
   * @sampleResult {"id":"0oa1k5d68qR2954hb0g4","type":"OIDC","name":"Updated IdP","status":"ACTIVE"}
   */
  async replaceIdentityProvider(idpId, type, name, protocol, policy) {
    type = this.#resolveChoice(type, IDP_TYPE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/IdentityProvider/ (Replace an identity provider - CreateGenericOidcIdPRequest shape; full replacement)
    const body = this.#buildIdpBody(type, name, protocol, policy)

    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }`,
      method: 'put',
      body,
      logTag: 'replaceIdentityProvider',
    })

    return result.body
  }

  /**
   * @operationName Delete Identity Provider
   * @category Identity Providers
   * @description Deletes an identity provider permanently. Deactivate it first. Destructive - use with care.
   * @route POST /delete-identity-provider
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP to delete (deactivate first)."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"idpId":"0oa1k5d68qR2954hb0g4"}
   */
  async deleteIdentityProvider(idpId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/IdentityProvider/ (Delete an identity provider - DELETE, 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }`,
      method: 'delete',
      logTag: 'deleteIdentityProvider',
    })

    return { deleted: true, idpId }
  }

  /**
   * @operationName Activate Identity Provider
   * @category Identity Providers
   * @description Activates an identity provider so users can sign in through it. Use this after creating or reconfiguring an IdP.
   * @route POST /activate-identity-provider
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP to activate."}
   * @returns {Object}
   * @sampleResult {"id":"0oa1k5d68qR2954hb0g4","status":"ACTIVE"}
   */
  async activateIdentityProvider(idpId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/IdentityProvider/ (Activate an identity provider - POST .../lifecycle/activate, empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateIdentityProvider',
    })

    return result.body
  }

  /**
   * @operationName Deactivate Identity Provider
   * @category Identity Providers
   * @description Deactivates an identity provider so users can no longer sign in through it. Required before deleting.
   * @route POST /deactivate-identity-provider
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP to deactivate."}
   * @returns {Object}
   * @sampleResult {"id":"0oa1k5d68qR2954hb0g4","status":"INACTIVE"}
   */
  async deactivateIdentityProvider(idpId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/IdentityProvider/ (Deactivate an identity provider - POST .../lifecycle/deactivate, empty body)
    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateIdentityProvider',
    })

    return result.body
  }

  /**
   * @operationName List IdP Users
   * @category Identity Providers
   * @description Lists the Okta users linked to an identity provider. Use this to audit which users authenticate through an external IdP.
   * @route POST /list-identity-provider-users
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP whose linked users to list."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"SCIM filter expression."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max users per page."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"00ub0oNGTSWTBKOLGLNR","externalId":"121749775026145","profile":{}}],"cursor":null}
   */
  async listIdentityProviderUsers(idpId, filter, limit, after) {
    const query = {}

    if (filter) {
      query.filter = filter
    }

    if (limit) {
      query.limit = limit
    }

    if (after) {
      query.after = after
    }

    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/users`,
      query,
      logTag: 'listIdentityProviderUsers',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Get IdP User
   * @category Identity Providers
   * @description Retrieves a single IdP-linked user, including the external id mapping. Use this to inspect a user's link to an external IdP.
   * @route POST /get-identity-provider-user
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The Okta user linked to this IdP."}
   * @returns {Object}
   * @sampleResult {"id":"00ub0oNGTSWTBKOLGLNR","externalId":"121749775026145","profile":{}}
   */
  async getIdentityProviderUser(idpId, userId) {
    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/users/${ encodeURIComponent(userId) }`,
      logTag: 'getIdentityProviderUser',
    })

    return result.body
  }

  /**
   * @operationName Link User to IdP
   * @category Identity Providers
   * @description Links an Okta user to an external identity provider by external id, so they can sign in through it. Use this for SAML/social IdPs that map by a known subject id.
   * @route POST /link-user-to-identity-provider
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The SAML/social IdP to link to (SAML must have honorPersistentNameId=true)."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The Okta user to link."}
   * @paramDef {"type":"String","label":"External ID","name":"externalSubject","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP-specific identifier for this user (the subject NameID at the external provider)."}
   * @returns {Object}
   * @sampleResult {"id":"00ub0oNGTSWTBKOLGLNR","externalId":"121749775026145","created":"2024-04-25T17:35:02.000Z","profile":{}}
   */
  async linkUserToIdentityProvider(idpId, userId, externalSubject) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/IdentityProviderUsers/ (Link a user to an IdP - UserIdentityProviderLinkRequest; body { externalId })
    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/users/${ encodeURIComponent(userId) }`,
      method: 'post',
      body: { externalId: externalSubject },
      logTag: 'linkUserToIdentityProvider',
    })

    return result.body
  }

  /**
   * @operationName Unlink User from IdP
   * @category Identity Providers
   * @description Removes the link between an Okta user and an external identity provider. The user can no longer sign in through that IdP. Use with care.
   * @route POST /unlink-user-from-identity-provider
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The Okta user to unlink."}
   * @returns {Object}
   * @sampleResult {"unlinked":true,"idpId":"0oa1k5d68qR2954hb0g4","userId":"00ub0oNGTSWTBKOLGLNR"}
   */
  async unlinkUserFromIdentityProvider(idpId, userId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/IdentityProviderUsers/ (Unlink a user from an IdP - DELETE, 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/users/${ encodeURIComponent(userId) }`,
      method: 'delete',
      logTag: 'unlinkUserFromIdentityProvider',
    })

    return { unlinked: true, idpId, userId }
  }

  // Builds the polymorphic IdP create/replace body. `protocol`/`policy` arrive as the flat sub-form
  // objects produced by idpProtocolSchema / idpPolicySchema, and are mapped here into the nested
  // CreateGenericOidcIdPRequest structure. Traced to the cited CreateGenericOidcIdPRequest example.
  #buildIdpBody(type, name, protocol, policy) {
    const proto = this.#parseJsonObject(protocol, 'Protocol')
    const pol = this.#parseJsonObject(policy, 'Policy')

    const body = { type, name }

    body.protocol = type === 'SAML2'
      ? this.#buildSamlProtocol(proto)
      : this.#buildOidcProtocol(proto)

    body.policy = this.#buildIdpPolicy(pol)

    return body
  }

  // OIDC / social protocol - traced to CreateGenericOidcIdPRequest.protocol.
  #buildOidcProtocol(p) {
    const scopes = this.#toIdArray(p.scopes)
    const protocol = {
      type: 'OIDC',
      scopes: scopes.length ? scopes : ['openid', 'profile', 'email'],
      credentials: { client: { client_id: p.clientId, client_secret: p.clientSecret } },
      endpoints: {
        authorization: { binding: 'HTTP-REDIRECT', url: p.authorizationUrl },
        token: { binding: 'HTTP-POST', url: p.tokenUrl },
      },
      issuer: { url: p.issuerUrl },
    }

    if (p.pkceRequired !== undefined && p.pkceRequired !== null) {
      protocol.credentials.client.pkce_required = String(p.pkceRequired)
    }

    if (p.userInfoUrl) {
      protocol.endpoints.userInfo = { binding: 'HTTP-REDIRECT', url: p.userInfoUrl }
    }

    if (p.jwksUrl) {
      protocol.endpoints.jwks = { binding: 'HTTP-REDIRECT', url: p.jwksUrl }
    }

    return protocol
  }

  // SAML 2.0 protocol - traced to the SAML IdP protocol schema (issuer/SSO endpoint/algorithms).
  #buildSamlProtocol(p) {
    return {
      type: 'SAML2',
      endpoints: {
        sso: { url: p.ssoUrl, binding: p.ssoBinding || 'HTTP-POST' },
      },
      algorithms: { request: { signature: { algorithm: p.signatureAlgorithm || 'SHA-256', scope: 'REQUEST' } } },
      credentials: { trust: { issuer: p.issuerUrl } },
    }
  }

  // Account-link / provisioning / subject policy - traced to CreateGenericOidcIdPRequest.policy.
  #buildIdpPolicy(p) {
    return {
      accountLink: { action: p.accountLinkAction || 'AUTO' },
      provisioning: { action: p.provisioningAction || 'AUTO', groups: { action: 'NONE' } },
      subject: {
        matchType: p.subjectMatchType || 'USERNAME',
        userNameTemplate: { template: p.userNameTemplate || 'idpuser.email' },
      },
      maxClockSkew: p.maxClockSkew === undefined || p.maxClockSkew === null ? 120000 : p.maxClockSkew,
    }
  }

  // ==========================================================================
  //  USER OAUTH GRANTS & TOKENS (tags UserGrant / UserOAuth)
  // ==========================================================================
  /**
   * @operationName List User Grants
   * @category User OAuth Grants
   * @description Lists the OAuth 2.0 consent grants a user has approved (the scopes they have allowed apps to access). Use this to audit a user's consents before revoking them.
   * @route POST /list-user-grants
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user whose consent grants to list."}
   * @paramDef {"type":"String","label":"Scope","name":"scope","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Filter to grants for this scope id."}
   * @paramDef {"type":"String","label":"Expand","name":"expand","uiComponent":{"type":"DROPDOWN","options":{"values":["Include Scope Details"]}},"description":"Set to Scope to embed scope details in _embedded."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"oag3ih1zrm1cBFOiq0h6","clientId":"0oabskvc6442nkvQO0h7","status":"ACTIVE","scopeId":"okta.users.read","userId":"00u5t60iloOHN9pBi0h7","created":"2017-10-30T22:06:53.000Z"}],"cursor":null}
   */
  async listUserGrants(userId, scope, expand, limit, after) {
    expand = this.#resolveChoice(expand, GRANT_EXPAND_LABELS)
    const query = {}

    if (scope) {
      query.scopeId = scope
    }

    if (expand) {
      query.expand = expand
    }

    if (limit) {
      query.limit = limit
    }

    if (after) {
      query.after = after
    }

    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/grants`,
      query,
      logTag: 'listUserGrants',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Revoke All User Grants
   * @category User OAuth Grants
   * @description Revokes ALL OAuth 2.0 consent grants for a user - every app loses the access the user previously approved. Destructive - use with care.
   * @route POST /revoke-user-grants
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Revoke ALL of this user's OAuth grants."}
   * @returns {Object}
   * @sampleResult {"revoked":true,"userId":"00u5t60iloOHN9pBi0h7","scope":"all"}
   */
  async revokeUserGrants(userId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserGrant/ (Revoke all user grants - DELETE, 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/grants`,
      method: 'delete',
      logTag: 'revokeUserGrants',
    })

    return { revoked: true, userId, scope: 'all' }
  }

  /**
   * @operationName Get User Grant
   * @category User OAuth Grants
   * @description Retrieves a single OAuth consent grant by id. Use this to inspect a grant before revoking it.
   * @route POST /get-user-grant
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user."}
   * @paramDef {"type":"String","label":"Grant","name":"grantId","required":true,"dictionary":"getUserGrantsDictionary","dependsOn":["userId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The grant to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"oag3ih1zrm1cBFOiq0h6","clientId":"0oabskvc6442nkvQO0h7","status":"ACTIVE","scopeId":"okta.users.read","userId":"00u5t60iloOHN9pBi0h7"}
   */
  async getUserGrant(userId, grantId) {
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/grants/${ encodeURIComponent(grantId) }`,
      logTag: 'getUserGrant',
    })

    return result.body
  }

  /**
   * @operationName Revoke User Grant
   * @category User OAuth Grants
   * @description Revokes a single OAuth consent grant - the app loses access to that one scope. Destructive - use with care.
   * @route POST /revoke-user-grant
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user."}
   * @paramDef {"type":"String","label":"Grant","name":"grantId","required":true,"dictionary":"getUserGrantsDictionary","dependsOn":["userId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The grant to revoke."}
   * @returns {Object}
   * @sampleResult {"revoked":true,"grantId":"oag3ih1zrm1cBFOiq0h6"}
   */
  async revokeUserGrant(userId, grantId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserGrant/ (Revoke a user grant - DELETE, 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/grants/${ encodeURIComponent(grantId) }`,
      method: 'delete',
      logTag: 'revokeUserGrant',
    })

    return { revoked: true, grantId }
  }

  /**
   * @operationName List User Clients
   * @category User OAuth Grants
   * @description Lists the OAuth clients (apps) that currently hold grants or refresh tokens for a user. Use this to find a client id before listing or revoking its grants/tokens.
   * @route POST /list-user-clients
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"List OAuth clients that have grants/tokens for this user."}
   * @returns {Object}
   * @sampleResult {"items":[{"client_id":"0oabskvc6442nkvQO0h7","client_name":"My App","_links":{"grants":{"href":"..."},"tokens":{"href":"..."}}}],"cursor":null}
   */
  async listUserClients(userId) {
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/clients`,
      logTag: 'listUserClients',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName List Grants For Client
   * @category User OAuth Grants
   * @description Lists the OAuth consent grants a user gave to one specific client (app). Use this to scope an audit or revoke to a single app.
   * @route POST /list-grants-for-user-and-client
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user."}
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getUserClientsDictionary","dependsOn":["userId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OAuth client."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"oag3ih1zrm1cBFOiq0h6","clientId":"0oabskvc6442nkvQO0h7","status":"ACTIVE","scopeId":"okta.users.read"}],"cursor":null}
   */
  async listGrantsForUserAndClient(userId, clientId) {
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/clients/${ encodeURIComponent(clientId) }/grants`,
      logTag: 'listGrantsForUserAndClient',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Revoke Grants For Client
   * @category User OAuth Grants
   * @description Revokes all OAuth consent grants a user gave to one specific client (app). Destructive - that app loses all the user's approved scopes.
   * @route POST /revoke-grants-for-user-and-client
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user."}
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getUserClientsDictionary","dependsOn":["userId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Revoke all grants this user gave to this client."}
   * @returns {Object}
   * @sampleResult {"revoked":true,"userId":"00u5t60iloOHN9pBi0h7","clientId":"0oabskvc6442nkvQO0h7"}
   */
  async revokeGrantsForUserAndClient(userId, clientId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserGrant/ (Revoke grants for a user and client - DELETE, 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/clients/${ encodeURIComponent(clientId) }/grants`,
      method: 'delete',
      logTag: 'revokeGrantsForUserAndClient',
    })

    return { revoked: true, userId, clientId }
  }

  /**
   * @operationName List Refresh Tokens For Client
   * @category User OAuth Grants
   * @description Lists the OAuth refresh tokens one client (app) holds for a user. Use this to find a token id before getting or revoking it.
   * @route POST /list-refresh-tokens-for-user-and-client
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user."}
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getUserClientsDictionary","dependsOn":["userId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OAuth client."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"oar579Mcp7OUsNTlo0g3","status":"ACTIVE","clientId":"0oabskvc6442nkvQO0h7","scopes":["openid","offline_access"]}],"cursor":null}
   */
  async listRefreshTokensForUserAndClient(userId, clientId, limit, after) {
    const query = {}

    if (limit) {
      query.limit = limit
    }

    if (after) {
      query.after = after
    }

    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/clients/${ encodeURIComponent(clientId) }/tokens`,
      query,
      logTag: 'listRefreshTokensForUserAndClient',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Revoke All Tokens For Client
   * @category User OAuth Grants
   * @description Revokes all OAuth refresh tokens one client (app) holds for a user - the user must re-authenticate to that app. Destructive - use with care.
   * @route POST /revoke-tokens-for-user-and-client
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user."}
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getUserClientsDictionary","dependsOn":["userId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Revoke all refresh tokens this client holds for the user."}
   * @returns {Object}
   * @sampleResult {"revoked":true,"userId":"00u5t60iloOHN9pBi0h7","clientId":"0oabskvc6442nkvQO0h7","scope":"tokens"}
   */
  async revokeTokensForUserAndClient(userId, clientId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserOAuth/ (Revoke all refresh tokens for a user and client - DELETE, 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/clients/${ encodeURIComponent(clientId) }/tokens`,
      method: 'delete',
      logTag: 'revokeTokensForUserAndClient',
    })

    return { revoked: true, userId, clientId, scope: 'tokens' }
  }

  /**
   * @operationName Get Refresh Token
   * @category User OAuth Grants
   * @description Retrieves a single OAuth refresh token by id. Use this to inspect a token before revoking it.
   * @route POST /get-refresh-token-for-user-and-client
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user."}
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getUserClientsDictionary","dependsOn":["userId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OAuth client."}
   * @paramDef {"type":"String","label":"Token","name":"tokenId","required":true,"dictionary":"getUserTokensDictionary","dependsOn":["userId","clientId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The refresh token (from List Refresh Tokens)."}
   * @returns {Object}
   * @sampleResult {"id":"oar579Mcp7OUsNTlo0g3","status":"ACTIVE","clientId":"0oabskvc6442nkvQO0h7","scopes":["openid","offline_access"]}
   */
  async getRefreshTokenForUserAndClient(userId, clientId, tokenId) {
    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/clients/${ encodeURIComponent(clientId) }/tokens/${ encodeURIComponent(tokenId) }`,
      logTag: 'getRefreshTokenForUserAndClient',
    })

    return result.body
  }

  /**
   * @operationName Revoke Refresh Token
   * @category User OAuth Grants
   * @description Revokes a single OAuth refresh token - the user must re-authenticate to that app for that session. Destructive - use with care.
   * @route POST /revoke-token-for-user-and-client
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user."}
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getUserClientsDictionary","dependsOn":["userId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OAuth client."}
   * @paramDef {"type":"String","label":"Token","name":"tokenId","required":true,"dictionary":"getUserTokensDictionary","dependsOn":["userId","clientId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The refresh token to revoke."}
   * @returns {Object}
   * @sampleResult {"revoked":true,"tokenId":"oar579Mcp7OUsNTlo0g3"}
   */
  async revokeTokenForUserAndClient(userId, clientId, tokenId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserOAuth/ (Revoke a refresh token for a user and client - DELETE, 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/clients/${ encodeURIComponent(clientId) }/tokens/${ encodeURIComponent(tokenId) }`,
      method: 'delete',
      logTag: 'revokeTokenForUserAndClient',
    })

    return { revoked: true, tokenId }
  }

  // ==========================================================================
  //  DICTIONARIES - back every resource-pick (*Id) param with one of these
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Provides a searchable list of users for dropdown selection in other actions.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Isaac Brock (isaac.brock@example.com)","value":"00ub0oNGTSWTBKOLGLNR","note":"Status: ACTIVE"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: 50 }

    if (search) {
      query.q = search
    }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({ path: '/api/v1/users', query, logTag: 'getUsersDictionary' })
    const users = Array.isArray(result?.body) ? result.body : []

    return {
      items: users.map(user => ({
        label: `${ user.profile?.firstName || '' } ${ user.profile?.lastName || '' }`.trim() + ` (${ user.profile?.email || user.profile?.login || user.id })`,
        value: user.id,
        note: `Status: ${ user.status }`,
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Groups Dictionary
   * @description Provides a searchable list of groups for dropdown selection in other actions.
   * @route POST /get-groups-dictionary
   * @paramDef {"type":"getGroupsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"West Coast users","value":"00g1emaKYZTWRYYRRTSK","note":"Type: OKTA_GROUP"}],"cursor":null}
   */
  async getGroupsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: 50 }

    if (search) {
      query.q = search
    }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({ path: '/api/v1/groups', query, logTag: 'getGroupsDictionary' })
    const groups = Array.isArray(result?.body) ? result.body : []

    return {
      items: groups.map(group => ({
        label: group.profile?.name || group.id,
        value: group.id,
        note: `Type: ${ group.type }`,
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Applications Dictionary
   * @description Provides a searchable list of applications for dropdown selection in other actions.
   * @route POST /get-applications-dictionary
   * @paramDef {"type":"getApplicationsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Salesforce","value":"0oafxqCAJWWGELFTYASJ","note":"salesforce · ACTIVE"}],"cursor":null}
   */
  async getApplicationsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: 50 }

    if (search) {
      query.q = search
    }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({ path: '/api/v1/apps', query, logTag: 'getApplicationsDictionary' })
    const apps = Array.isArray(result?.body) ? result.body : []

    return {
      items: apps.map(app => ({
        label: app.label || app.name || app.id,
        value: app.id,
        note: `${ app.name } · ${ app.status }`,
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Group Rules Dictionary
   * @description Provides a searchable list of group rules for dropdown selection in other actions.
   * @route POST /get-group-rules-dictionary
   * @paramDef {"type":"getGroupRulesDictionary__payload","label":"Payload","name":"payload","description":"Search text (filtered locally) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Engineering group rule","value":"0pr3f7zMZZHPgUoWO0g4","note":"Status: ACTIVE"}],"cursor":null}
   */
  async getGroupRulesDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: 50 }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({ path: '/api/v1/groups/rules', query, logTag: 'getGroupRulesDictionary' })
    let rules = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      rules = rules.filter(rule => String(rule.name || '').toLowerCase().includes(needle))
    }

    return {
      items: rules.map(rule => ({
        label: rule.name || rule.id,
        value: rule.id,
        note: `Status: ${ rule.status }`,
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get User Factors Dictionary
   * @description Provides the enrolled MFA factors of a given user for dropdown selection in Activate Factor and Reset Factor.
   * @route POST /get-user-factors-dictionary
   * @paramDef {"type":"getUserFactorsDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the user."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"sms (OKTA)","value":"sms1Ll5Gn79kQ80T0g4","note":"Status: ACTIVE"}],"cursor":null}
   */
  async getUserFactorsDictionary(payload) {
    const { search, criteria } = payload || {}
    const userId = criteria?.userId

    if (!userId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/factors`,
      logTag: 'getUserFactorsDictionary',
    })
    let factors = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      factors = factors.filter(factor => `${ factor.factorType } ${ factor.provider }`.toLowerCase().includes(needle))
    }

    return {
      items: factors.map(factor => ({
        label: `${ factor.factorType } (${ factor.provider })`,
        value: factor.id,
        note: `Status: ${ factor.status }`,
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get User Role Assignments Dictionary
   * @description Provides the admin-role assignments of a given user for dropdown selection in Remove Role from User.
   * @route POST /get-user-role-assignments-dictionary
   * @paramDef {"type":"getUserRoleAssignmentsDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the user."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Application Administrator","value":"ra1b2c3d4e5","note":"Type: APP_ADMIN"}],"cursor":null}
   */
  async getUserRoleAssignmentsDictionary(payload) {
    const { search, criteria } = payload || {}
    const userId = criteria?.userId

    if (!userId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/roles`,
      logTag: 'getUserRoleAssignmentsDictionary',
    })
    let roles = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      roles = roles.filter(role => `${ role.label } ${ role.type }`.toLowerCase().includes(needle))
    }

    return {
      items: roles.map(role => ({
        label: role.label || role.type,
        value: role.id,
        note: `Type: ${ role.type }`,
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Network Zones Dictionary
   * @description Provides a searchable list of network zones for dropdown selection in other actions.
   * @route POST /get-network-zones-dictionary
   * @paramDef {"type":"getNetworkZonesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"MyIpZone (IP, ACTIVE)","value":"nzowc1U5Jh5xuAK0o0g3","note":"POLICY"}],"cursor":null}
   */
  async getNetworkZonesDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: 50 }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({ path: '/api/v1/zones', query, logTag: 'getNetworkZonesDictionary' })
    let zones = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      zones = zones.filter(zone => String(zone.name || '').toLowerCase().includes(needle))
    }

    return {
      items: zones.map(zone => ({
        label: `${ zone.name } (${ zone.type }, ${ zone.status })`,
        value: zone.id,
        note: zone.usage || '',
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Trusted Origins Dictionary
   * @description Provides a searchable list of trusted origins for dropdown selection in other actions.
   * @route POST /get-trusted-origins-dictionary
   * @paramDef {"type":"getTrustedOriginsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"New trusted origin — http://example.com","value":"tos10hu7rkbtrFt1M0g4","note":"ACTIVE"}],"cursor":null}
   */
  async getTrustedOriginsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: 50 }

    if (search) {
      query.q = search
    }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({ path: '/api/v1/trustedOrigins', query, logTag: 'getTrustedOriginsDictionary' })
    const origins = Array.isArray(result?.body) ? result.body : []

    return {
      items: origins.map(origin => ({
        label: `${ origin.name } — ${ origin.origin }`,
        value: origin.id,
        note: origin.status || '',
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Event Hooks Dictionary
   * @description Provides a searchable list of event hooks for dropdown selection in other actions.
   * @route POST /get-event-hooks-dictionary
   * @paramDef {"type":"getEventHooksDictionary__payload","label":"Payload","name":"payload","description":"Search text (filtered locally)."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Event Hook Test","value":"who8vt36qfNpCGz9H1e6","note":"ACTIVE / VERIFIED"}],"cursor":null}
   */
  async getEventHooksDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ path: '/api/v1/eventHooks', logTag: 'getEventHooksDictionary' })
    let hooks = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      hooks = hooks.filter(hook => String(hook.name || '').toLowerCase().includes(needle))
    }

    return {
      items: hooks.map(hook => ({
        label: hook.name || hook.id,
        value: hook.id,
        note: `${ hook.status } / ${ hook.verificationStatus }`,
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Inline Hooks Dictionary
   * @description Provides a searchable list of inline hooks for dropdown selection in other actions.
   * @route POST /get-inline-hooks-dictionary
   * @paramDef {"type":"getInlineHooksDictionary__payload","label":"Payload","name":"payload","description":"Search text (filtered locally)."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Token hook with HTTP authentication","value":"calb7gacafgwgE7hc5e4","note":"com.okta.oauth2.tokens.transform"}],"cursor":null}
   */
  async getInlineHooksDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ path: '/api/v1/inlineHooks', logTag: 'getInlineHooksDictionary' })
    let hooks = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      hooks = hooks.filter(hook => String(hook.name || '').toLowerCase().includes(needle))
    }

    return {
      items: hooks.map(hook => ({
        label: hook.name || hook.id,
        value: hook.id,
        note: hook.type || '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Behavior Rules Dictionary
   * @description Provides a searchable list of behavior detection rules for dropdown selection in other actions.
   * @route POST /get-behavior-rules-dictionary
   * @paramDef {"type":"getBehaviorRulesDictionary__payload","label":"Payload","name":"payload","description":"Search text (filtered locally) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My Behavior Rule (VELOCITY)","value":"abcd1234","note":"ACTIVE"}],"cursor":null}
   */
  async getBehaviorRulesDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = {}

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({ path: '/api/v1/behaviors', query, logTag: 'getBehaviorRulesDictionary' })
    let rules = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      rules = rules.filter(rule => String(rule.name || '').toLowerCase().includes(needle))
    }

    return {
      items: rules.map(rule => ({
        label: `${ rule.name || rule.id } (${ rule.type })`,
        value: rule.id,
        note: rule.status || '',
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get User Types Dictionary
   * @description Provides a searchable list of user types for dropdown selection in other actions.
   * @route POST /get-user-types-dictionary
   * @paramDef {"type":"getUserTypesDictionary__payload","label":"Payload","name":"payload","description":"Search text (filtered locally)."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"New user type (newUserType)","value":"otyfnly5cQjJT9PnR0g4","note":""}],"cursor":null}
   */
  async getUserTypesDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ path: '/api/v1/meta/types/user', logTag: 'getUserTypesDictionary' })
    let types = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      types = types.filter(type => `${ type.name || '' } ${ type.displayName || '' }`.toLowerCase().includes(needle))
    }

    return {
      items: types.map(type => ({
        label: `${ type.displayName || type.name || type.id } (${ type.name })`,
        value: type.id,
        note: type.default ? 'default' : '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Devices Dictionary
   * @description Provides a searchable list of managed devices for dropdown selection in other actions.
   * @route POST /get-devices-dictionary
   * @paramDef {"type":"getDevicesDictionary__payload","label":"Payload","name":"payload","description":"Optional SCIM filter and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"DESKTOP-EHAD3IE (WINDOWS)","value":"guo8jx5vVoxfvJeLb0w4","note":"ACTIVE"}],"cursor":null}
   */
  async getDevicesDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: 50 }

    if (search) {
      query.search = search
    }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({ path: '/api/v1/devices', query, logTag: 'getDevicesDictionary' })
    const devices = Array.isArray(result?.body) ? result.body : []

    return {
      items: devices.map(device => ({
        label: `${ device.profile?.displayName || device.id } (${ device.profile?.platform || '' })`,
        value: device.id,
        note: device.status || '',
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Event Types Dictionary
   * @description Provides a curated, searchable list of common Okta System Log event types for selecting which events an event hook fires on. Sourced from the Okta event-types catalog.
   * @route POST /get-event-types-dictionary
   * @paramDef {"type":"getEventTypesDictionary__payload","label":"Payload","name":"payload","description":"Optional text to filter the event-type catalog."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"User Activated (user.lifecycle.activate)","value":"user.lifecycle.activate","note":""}],"cursor":null}
   */
  async getEventTypesDictionary(payload) {
    // Curated from the Okta System Log event-types catalog (developer.okta.com/docs/reference/api/event-types/).
    // Okta does not expose a public "list all eventTypes" endpoint, so this is a cited static catalog, not invented.
    const { search } = payload || {}
    let catalog = EVENT_TYPE_CATALOG

    if (search) {
      const needle = String(search).toLowerCase()
      catalog = catalog.filter(entry => `${ entry.label } ${ entry.value }`.toLowerCase().includes(needle))
    }

    return {
      items: catalog.map(entry => ({
        label: `${ entry.label } (${ entry.value })`,
        value: entry.value,
        note: '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Linked Objects Dictionary
   * @description Provides a searchable list of linked-object relationship definitions for dropdown selection in other actions. The value is the relationship name (definitions are name-keyed, not id-keyed).
   * @route POST /get-linked-objects-dictionary
   * @paramDef {"type":"getLinkedObjectsDictionary__payload","label":"Payload","name":"payload","description":"Search text (filtered locally)."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"manager / subordinate","value":"manager","note":"subordinate"}],"cursor":null}
   */
  async getLinkedObjectsDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ path: '/api/v1/meta/schemas/user/linkedObjects', logTag: 'getLinkedObjectsDictionary' })
    let definitions = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()

      definitions = definitions.filter(def =>
        `${ def.primary?.name || '' } ${ def.primary?.title || '' } ${ def.associated?.name || '' } ${ def.associated?.title || '' }`
          .toLowerCase()
          .includes(needle))
    }

    return {
      items: definitions.map(def => ({
        label: `${ def.primary?.title || def.primary?.name || '' } / ${ def.associated?.title || def.associated?.name || '' }`.trim(),
        value: def.primary?.name,
        note: def.associated?.name || '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Policies Dictionary
   * @description Provides a searchable list of policies for dropdown selection in other actions. Okta requires a policy type - defaults to Global Session (OKTA_SIGN_ON) when none is supplied.
   * @route POST /get-policies-dictionary
   * @paramDef {"type":"getPoliciesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the criteria carrying the policy type."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Policy name (OKTA_SIGN_ON)","value":"policyId","note":"ACTIVE"}],"cursor":null}
   */
  async getPoliciesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const query = { type: criteria?.type || 'OKTA_SIGN_ON', limit: 50 }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({ path: '/api/v1/policies', query, logTag: 'getPoliciesDictionary' })
    let policies = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      policies = policies.filter(policy => String(policy.name || '').toLowerCase().includes(needle))
    }

    return {
      items: policies.map(policy => ({
        label: `${ policy.name } (${ policy.type })`,
        value: policy.id,
        note: policy.status || '',
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Policy Rules Dictionary
   * @description Provides the rules of a selected policy for dropdown selection in the policy-rule actions.
   * @route POST /get-policy-rules-dictionary
   * @paramDef {"type":"getPolicyRulesDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the parent policy."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Test Sign On","value":"0prh1sd28q5sXGW08697","note":"SIGN_ON · ACTIVE"}],"cursor":null}
   */
  async getPolicyRulesDictionary(payload) {
    const { search, criteria } = payload || {}
    const policyId = criteria?.policyId

    if (!policyId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/policies/${ encodeURIComponent(policyId) }/rules`,
      logTag: 'getPolicyRulesDictionary',
    })
    let rules = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      rules = rules.filter(rule => String(rule.name || '').toLowerCase().includes(needle))
    }

    return {
      items: rules.map(rule => ({
        label: rule.name || rule.id,
        value: rule.id,
        note: `${ rule.type || '' } · ${ rule.status || '' }`.trim(),
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Authorization Servers Dictionary
   * @description Provides a searchable list of custom authorization servers for dropdown selection in other actions.
   * @route POST /get-auth-servers-dictionary
   * @paramDef {"type":"getAuthServersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sample Authorization Server","value":"aus1234","note":"ACTIVE · api://default"}],"cursor":null}
   */
  async getAuthServersDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: 50 }

    if (search) {
      query.q = search
    }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({ path: '/api/v1/authorizationServers', query, logTag: 'getAuthServersDictionary' })
    const servers = Array.isArray(result?.body) ? result.body : []

    return {
      items: servers.map(server => ({
        label: server.name || server.id,
        value: server.id,
        note: `${ server.status || '' } · ${ (server.audiences && server.audiences[0]) || '' }`.trim(),
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Token Scopes Dictionary
   * @description Provides the custom OAuth scopes of a selected authorization server for dropdown selection in the scope actions.
   * @route POST /get-scopes-dictionary
   * @paramDef {"type":"getScopesDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the authorization server."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"car:drive","value":"scp1234","note":"REQUIRED"}],"cursor":null}
   */
  async getScopesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const authServerId = criteria?.authServerId

    if (!authServerId) {
      return { items: [], cursor: null }
    }

    const query = { limit: 50 }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/scopes`,
      query,
      logTag: 'getScopesDictionary',
    })
    let scopes = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      scopes = scopes.filter(scope => String(scope.name || '').toLowerCase().includes(needle))
    }

    return {
      items: scopes.map(scope => ({
        label: scope.name || scope.id,
        value: scope.id,
        note: scope.consent || '',
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Token Claims Dictionary
   * @description Provides the custom token claims of a selected authorization server for dropdown selection in the claim actions.
   * @route POST /get-claims-dictionary
   * @paramDef {"type":"getClaimsDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the authorization server."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Support","value":"clm1234","note":"IDENTITY · GROUPS"}],"cursor":null}
   */
  async getClaimsDictionary(payload) {
    const { search, criteria } = payload || {}
    const authServerId = criteria?.authServerId

    if (!authServerId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/claims`,
      logTag: 'getClaimsDictionary',
    })
    let claims = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      claims = claims.filter(claim => String(claim.name || '').toLowerCase().includes(needle))
    }

    return {
      items: claims.map(claim => ({
        label: claim.name || claim.id,
        value: claim.id,
        note: `${ claim.claimType || '' } · ${ claim.valueType || '' }`.trim(),
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Profile Mappings Dictionary
   * @description Provides a searchable list of profile mappings for dropdown selection in the mapping actions.
   * @route POST /get-profile-mappings-dictionary
   * @paramDef {"type":"getProfileMappingsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"user → okta_org2org","value":"prm1k47ghydIQOTBW0g4","note":"user→appuser"}],"cursor":null}
   */
  async getProfileMappingsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: 50 }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({ path: '/api/v1/mappings', query, logTag: 'getProfileMappingsDictionary' })
    let mappings = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()

      mappings = mappings.filter(mapping =>
        `${ mapping.source?.name || '' } ${ mapping.target?.name || '' }`.toLowerCase().includes(needle))
    }

    return {
      items: mappings.map(mapping => ({
        label: `${ mapping.source?.name || '?' } → ${ mapping.target?.name || '?' }`,
        value: mapping.id,
        note: `${ mapping.source?.type || '' }→${ mapping.target?.type || '' }`,
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Identity Providers Dictionary
   * @description Provides a searchable list of identity providers for dropdown selection in the IdP actions.
   * @route POST /get-idps-dictionary
   * @paramDef {"type":"getIdpsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Example OpenID Connect IdP","value":"0oa1k5d68qR2954hb0g4","note":"OIDC · ACTIVE"}],"cursor":null}
   */
  async getIdpsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: 50 }

    if (search) {
      query.q = search
    }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({ path: '/api/v1/idps', query, logTag: 'getIdpsDictionary' })
    const idps = Array.isArray(result?.body) ? result.body : []

    return {
      items: idps.map(idp => ({
        label: idp.name || idp.id,
        value: idp.id,
        note: `${ idp.type || '' } · ${ idp.status || '' }`.trim(),
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Authenticators Dictionary
   * @description Provides a searchable list of authenticators for dropdown selection in the authenticator actions.
   * @route POST /get-authenticators-dictionary
   * @paramDef {"type":"getAuthenticatorsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Email","value":"aut1nbsPHh7jNjjyP0g4","note":"okta_email · ACTIVE"}],"cursor":null}
   */
  async getAuthenticatorsDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({ path: '/api/v1/authenticators', logTag: 'getAuthenticatorsDictionary' })
    let authenticators = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      authenticators = authenticators.filter(auth => String(auth.name || '').toLowerCase().includes(needle))
    }

    return {
      items: authenticators.map(auth => ({
        label: auth.name || auth.id,
        value: auth.id,
        note: `${ auth.key || '' } · ${ auth.status || '' }`.trim(),
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get User Grants Dictionary
   * @description Provides the OAuth consent grants of a selected user for dropdown selection in the grant actions.
   * @route POST /get-user-grants-dictionary
   * @paramDef {"type":"getUserGrantsDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the user."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"okta.users.read","value":"oag3ih1zrm1cBFOiq0h6","note":"ACTIVE · 0oabskvc6442nkvQO0h7"}],"cursor":null}
   */
  async getUserGrantsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const userId = criteria?.userId

    if (!userId) {
      return { items: [], cursor: null }
    }

    const query = { limit: 50 }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/grants`,
      query,
      logTag: 'getUserGrantsDictionary',
    })
    let grants = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      grants = grants.filter(grant => String(grant.scopeId || '').toLowerCase().includes(needle))
    }

    return {
      items: grants.map(grant => ({
        label: grant.scopeId || grant.id,
        value: grant.id,
        note: `${ grant.status || '' } · ${ grant.clientId || '' }`.trim(),
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get User Clients Dictionary
   * @description Provides the OAuth clients that hold grants/tokens for a selected user, for dropdown selection in the per-client actions.
   * @route POST /get-user-clients-dictionary
   * @paramDef {"type":"getUserClientsDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the user."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My App","value":"0oabskvc6442nkvQO0h7","note":"0oabskvc6442nkvQO0h7"}],"cursor":null}
   */
  async getUserClientsDictionary(payload) {
    const { search, criteria } = payload || {}
    const userId = criteria?.userId

    if (!userId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/clients`,
      logTag: 'getUserClientsDictionary',
    })
    let clients = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      clients = clients.filter(client => String(client.client_name || '').toLowerCase().includes(needle))
    }

    return {
      items: clients.map(client => ({
        label: client.client_name || client.client_id,
        value: client.client_id,
        note: client.client_id || '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get User Tokens Dictionary
   * @description Provides the OAuth refresh tokens a selected client holds for a selected user, for dropdown selection in the token actions.
   * @route POST /get-user-tokens-dictionary
   * @paramDef {"type":"getUserTokensDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the user and OAuth client."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"oar579Mcp7OUsNTlo0g3","value":"oar579Mcp7OUsNTlo0g3","note":"ACTIVE · openid, offline_access"}],"cursor":null}
   */
  async getUserTokensDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const userId = criteria?.userId
    const clientId = criteria?.clientId

    if (!userId || !clientId) {
      return { items: [], cursor: null }
    }

    const query = { limit: 50 }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({
      path: `/api/v1/users/${ encodeURIComponent(userId) }/clients/${ encodeURIComponent(clientId) }/tokens`,
      query,
      logTag: 'getUserTokensDictionary',
    })
    let tokens = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      tokens = tokens.filter(token => String(token.id || '').toLowerCase().includes(needle))
    }

    return {
      items: tokens.map(token => ({
        label: token.id,
        value: token.id,
        note: `${ token.status || '' } · ${ (token.scopes || []).join(', ') }`.trim(),
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Authorization Server Policies Dictionary
   * @description Provides the access policies of a selected authorization server for dropdown selection in the policy/rule actions.
   * @route POST /get-auth-server-policies-dictionary
   * @paramDef {"type":"getAuthServerPoliciesDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the authorization server."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Default Policy","value":"00palyaappA22DPkj0h7","note":"ACTIVE · priority 1"}],"cursor":null}
   */
  async getAuthServerPoliciesDictionary(payload) {
    const { search, criteria } = payload || {}
    const authServerId = criteria?.authServerId

    if (!authServerId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/policies`,
      logTag: 'getAuthServerPoliciesDictionary',
    })
    let policies = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      policies = policies.filter(policy => String(policy.name || '').toLowerCase().includes(needle))
    }

    return {
      items: policies.map(policy => ({
        label: policy.name || policy.id,
        value: policy.id,
        note: `${ policy.status || '' } · priority ${ policy.priority }`.trim(),
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Authorization Server Policy Rules Dictionary
   * @description Provides the rules of a selected authorization-server policy for dropdown selection in the rule actions.
   * @route POST /get-auth-server-policy-rules-dictionary
   * @paramDef {"type":"getAuthServerPolicyRulesDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the authorization server and policy."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Default Policy Rule","value":"0prnss7DkUOTlujAa0g4","note":"ACTIVE"}],"cursor":null}
   */
  async getAuthServerPolicyRulesDictionary(payload) {
    const { search, criteria } = payload || {}
    const authServerId = criteria?.authServerId
    const policyId = criteria?.policyId

    if (!authServerId || !policyId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/policies/${ encodeURIComponent(policyId) }/rules`,
      logTag: 'getAuthServerPolicyRulesDictionary',
    })
    let rules = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      rules = rules.filter(rule => String(rule.name || '').toLowerCase().includes(needle))
    }

    return {
      items: rules.map(rule => ({
        label: rule.name || rule.id,
        value: rule.id,
        note: rule.status || '',
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Application Keys Dictionary
   * @description Provides the SSO signing keys of a selected application for dropdown selection in the key actions.
   * @route POST /get-application-keys-dictionary
   * @paramDef {"type":"getApplicationKeysDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the application."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"akm5hvbbevE341ovl0h7 (expires 2026-12-10T18:56:22.000Z)","value":"akm5hvbbevE341ovl0h7","note":"sig · RSA"}],"cursor":null}
   */
  async getApplicationKeysDictionary(payload) {
    const { search, criteria } = payload || {}
    const appId = criteria?.appId

    if (!appId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/keys`,
      logTag: 'getApplicationKeysDictionary',
    })
    let keys = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      keys = keys.filter(key => String(key.kid || '').toLowerCase().includes(needle))
    }

    return {
      items: keys.map(key => ({
        label: `${ key.kid }${ key.expiresAt ? ` (expires ${ key.expiresAt })` : '' }`,
        value: key.kid,
        note: `${ key.use || '' } · ${ key.kty || '' }`.trim(),
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Application CSRs Dictionary
   * @description Provides the certificate signing requests of a selected application for dropdown selection in the CSR actions.
   * @route POST /get-app-csrs-dictionary
   * @paramDef {"type":"getAppCsrsDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the application."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"CSR h9zkutaS (2017-03-28T01:11:10.000Z)","value":"h9zkutaSe7fZX0SwN1GqDApofgD1OW8g2B5l2azha50","note":"RSA"}],"cursor":null}
   */
  async getAppCsrsDictionary(payload) {
    const { search, criteria } = payload || {}
    const appId = criteria?.appId

    if (!appId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/csrs`,
      logTag: 'getAppCsrsDictionary',
    })
    let csrs = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      csrs = csrs.filter(csr => String(csr.id || '').toLowerCase().includes(needle))
    }

    return {
      items: csrs.map(csr => ({
        label: `CSR ${ String(csr.id || '').slice(0, 8) }${ csr.created ? ` (${ csr.created })` : '' }`,
        value: csr.id,
        note: csr.kty || '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Application Client Keys Dictionary
   * @description Provides the OAuth client JSON Web Keys of a selected application for dropdown selection in the client-key actions.
   * @route POST /get-app-jwks-dictionary
   * @paramDef {"type":"getAppJwksDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the application."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"DRUFXGF9XbLnS9k-Sla3x3POBiIxDreBCdZuFs5B","value":"pks2f4zrZbs8nUa7p0g4","note":"sig · INACTIVE"}],"cursor":null}
   */
  async getAppJwksDictionary(payload) {
    const { search, criteria } = payload || {}
    const appId = criteria?.appId

    if (!appId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/jwks`,
      logTag: 'getAppJwksDictionary',
    })
    let keys = Array.isArray(result?.body?.jwks?.keys) ? result.body.jwks.keys : []

    if (search) {
      const needle = String(search).toLowerCase()
      keys = keys.filter(key => String(key.kid || '').toLowerCase().includes(needle))
    }

    return {
      items: keys.map(key => ({
        label: key.kid || key.id,
        value: key.id,
        note: `${ key.use || '' } · ${ key.status || '' }`.trim(),
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Application Client Secrets Dictionary
   * @description Provides the OAuth client secrets of a selected application for dropdown selection in the client-secret actions.
   * @route POST /get-app-secrets-dictionary
   * @paramDef {"type":"getAppSecretsDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the application."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Secret ocs2f4zr (INACTIVE)","value":"ocs2f4zrZbs8nUa7p0g4","note":"yk4SVx4sUWVJVbHt6M-UPA"}],"cursor":null}
   */
  async getAppSecretsDictionary(payload) {
    const { search, criteria } = payload || {}
    const appId = criteria?.appId

    if (!appId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/secrets`,
      logTag: 'getAppSecretsDictionary',
    })
    let secrets = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      secrets = secrets.filter(secret => String(secret.id || '').toLowerCase().includes(needle))
    }

    return {
      items: secrets.map(secret => ({
        label: `Secret ${ String(secret.id || '').slice(0, 8) } (${ secret.status || '' })`,
        value: secret.id,
        note: secret.secret_hash || '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Resource Server Keys Dictionary
   * @description Provides the resource-server JSON Web Keys of a selected authorization server for dropdown selection in the resource-server-key actions.
   * @route POST /get-resource-server-keys-dictionary
   * @paramDef {"type":"getResourceServerKeysDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the authorization server."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"RQ8DuhdxCczyMvy7GNJb4Ka3lQ99vrSo3oFBUiZjzzc","value":"apk40n33xfjbPaf6D0g5","note":"enc · ACTIVE"}],"cursor":null}
   */
  async getResourceServerKeysDictionary(payload) {
    const { search, criteria } = payload || {}
    const authServerId = criteria?.authServerId

    if (!authServerId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/resourceservercredentials/keys`,
      logTag: 'getResourceServerKeysDictionary',
    })
    let keys = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      keys = keys.filter(key => String(key.kid || '').toLowerCase().includes(needle))
    }

    return {
      items: keys.map(key => ({
        label: key.kid || key.id,
        value: key.id,
        note: `${ key.use || '' } · ${ key.status || '' }`.trim(),
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Org IdP Keys Dictionary
   * @description Provides the org-level Identity Provider key store for dropdown selection in the org IdP key actions.
   * @route POST /get-org-idp-keys-dictionary
   * @paramDef {"type":"getOrgIdpKeysDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"your-key-id","value":"your-key-id","note":"sig · expires 2026-01-03T18:15:47.000Z"}],"cursor":null}
   */
  async getOrgIdpKeysDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: 50 }

    if (cursor) {
      query.after = cursor
    }

    const result = await this.#apiRequest({ path: '/api/v1/idps/credentials/keys', query, logTag: 'getOrgIdpKeysDictionary' })
    let keys = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      keys = keys.filter(key => String(key.kid || '').toLowerCase().includes(needle))
    }

    return {
      items: keys.map(key => ({
        label: key.kid,
        value: key.kid,
        note: `${ key.use || '' }${ key.expiresAt ? ` · expires ${ key.expiresAt }` : '' }`.trim(),
      })),
      cursor: result?.cursor || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get IdP Signing Keys Dictionary
   * @description Provides the signing keys of a selected Identity Provider for dropdown selection in the signing-key actions.
   * @route POST /get-idp-signing-keys-dictionary
   * @paramDef {"type":"getIdpSigningKeysDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the identity provider."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"akm5hvbbevE341ovl0h7 (expires 2017-12-10T18:56:22.000Z)","value":"akm5hvbbevE341ovl0h7","note":"sig · RSA"}],"cursor":null}
   */
  async getIdpSigningKeysDictionary(payload) {
    const { search, criteria } = payload || {}
    const idpId = criteria?.idpId

    if (!idpId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/credentials/keys`,
      logTag: 'getIdpSigningKeysDictionary',
    })
    let keys = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      keys = keys.filter(key => String(key.kid || '').toLowerCase().includes(needle))
    }

    return {
      items: keys.map(key => ({
        label: `${ key.kid }${ key.expiresAt ? ` (expires ${ key.expiresAt })` : '' }`,
        value: key.kid,
        note: `${ key.use || '' } · ${ key.kty || '' }`.trim(),
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get IdP CSRs Dictionary
   * @description Provides the certificate signing requests of a selected Identity Provider for dropdown selection in the IdP CSR actions.
   * @route POST /get-idp-csrs-dictionary
   * @paramDef {"type":"getIdpCsrsDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and the criteria identifying the identity provider."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"CSR h9zkutaS (2017-03-28T01:11:10.000Z)","value":"h9zkutaSe7fZX0SwN1GqDApofgD1OW8g2B5l2azha50","note":""}],"cursor":null}
   */
  async getIdpCsrsDictionary(payload) {
    const { search, criteria } = payload || {}
    const idpId = criteria?.idpId

    if (!idpId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/credentials/csrs`,
      logTag: 'getIdpCsrsDictionary',
    })
    let csrs = Array.isArray(result?.body) ? result.body : []

    if (search) {
      const needle = String(search).toLowerCase()
      csrs = csrs.filter(csr => String(csr.id || '').toLowerCase().includes(needle))
    }

    return {
      items: csrs.map(csr => ({
        label: `CSR ${ String(csr.id || '').slice(0, 8) }${ csr.created ? ` (${ csr.created })` : '' }`,
        value: csr.id,
        note: '',
      })),
      cursor: null,
    }
  }

  // ==========================================================================
  //  TRIGGERS (polling) - New System Log event
  // ==========================================================================
  /**
   * @registerAs POLLING_TRIGGER
   * @operationName On New System Log Event
   * @category Triggers
   * @description Fires for each new Okta System Log event. Filter by event type (e.g. user lifecycle, app membership changes) to react only to what matters. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-new-system-log-event
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","uiComponent":{"type":"DROPDOWN","options":{"values":["All Events","User Created","User Activated","User Deactivated","User Suspended","User Profile Updated","User Added to Group","User Removed from Group","User Assigned to App","User Unassigned from App","MFA Authentication"]}},"description":"Only emit events of this type. Leave on All Events to receive every log event."}
   * @returns {Object}
   * @sampleResult {"uuid":"dc9fd3c0-598c-11ef-8478-2b7584bf8d5a","published":"2024-08-13T15:58:20.353Z","eventType":"user.lifecycle.create","severity":"INFO","displayMessage":"Create okta user","actor":{"id":"00uttidj01jqL21aM1d6","type":"User","displayName":"John Doe"},"outcome":{"result":"SUCCESS"}}
   */
  async onNewSystemLogEvent(invocation) {
    const eventType = this.#resolveChoice(invocation?.triggerData?.eventType, SYSTEM_LOG_EVENT_TYPE_LABELS)
    const state = invocation?.state

    // First poll: establish a baseline and emit nothing.
    if (!state || !state.since) {
      return {
        events: [],
        state: { since: new Date().toISOString(), seenUuids: [] },
      }
    }

    const query = { since: state.since, sortOrder: 'ASCENDING', limit: 1000 }

    if (eventType) {
      query.filter = `eventType eq "${ eventType }"`
    }

    const result = await this.#apiRequest({ path: '/api/v1/logs', query, logTag: 'onNewSystemLogEvent' })
    const logs = Array.isArray(result?.body) ? result.body : []

    const seen = new Set(state.seenUuids || [])
    const fresh = logs.filter(event => event.uuid && !seen.has(event.uuid))

    if (fresh.length === 0) {
      return { events: [], state }
    }

    // Advance the cursor: new lower bound is the latest published time; keep the uuids on
    // that boundary so a boundary-equal event is not re-emitted next poll.
    let maxPublished = state.since

    for (const event of logs) {
      if (event.published && event.published > maxPublished) {
        maxPublished = event.published
      }
    }

    const boundaryUuids = logs
      .filter(event => event.published === maxPublished && event.uuid)
      .map(event => event.uuid)

    return {
      events: fresh,
      state: { since: maxPublished, seenUuids: boundaryUuids },
    }
  }

  // ==========================================================================
  //  AUTH SERVER POLICIES, RULES & KEYS
  //  (tags AuthorizationServerPolicies / Rules / Keys / Clients)
  // ==========================================================================
  // Builds the access-policy create/replace body from the cited CreateAuthorizationServerPolicyRequest.
  // conditions is freeform (clients.include[] is user-chosen); defaults to all-clients when omitted.
  #buildAuthServerPolicyBody(name, description, status, priority, conditions) {
    const body = { type: 'OAUTH_AUTHORIZATION_POLICY', name }

    if (description) {
      body.description = description
    }

    if (status) {
      body.status = status
    }

    if (priority !== undefined && priority !== null) {
      body.priority = priority
    }

    body.conditions = conditions
      ? this.#parseJsonObject(conditions, 'Conditions')
      : { clients: { include: ['ALL_CLIENTS'] } }

    return body
  }

  /**
   * @operationName List Authorization Server Policies
   * @category Authorization Server Policies
   * @description Lists the access policies on a custom authorization server. Use this to find a policy id before editing its rules. Requires the API Access Management add-on.
   * @route POST /list-authorization-server-policies
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @returns {Object}
   * @sampleResult {"items":[{"type":"OAUTH_AUTHORIZATION_POLICY","id":"00palyaappA22DPkj0h7","status":"ACTIVE","name":"Default Policy","priority":1}],"cursor":null}
   */
  async listAuthorizationServerPolicies(authServerId) {
    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/policies`,
      logTag: 'listAuthorizationServerPolicies',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Authorization Server Policy
   * @category Authorization Server Policies
   * @description Creates an OAuth access policy on a custom authorization server. By default it applies to all clients; pass a Conditions object to scope it to specific client ids. Requires the API Access Management add-on.
   * @route POST /create-authorization-server-policy
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Policy Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Name of the access policy."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What the policy is for."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Initial status. Defaults to Active."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Evaluation order (1 = highest)."}
   * @paramDef {"type":"Object","label":"Conditions","name":"conditions","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Client scope of the policy. Defaults to all clients. e.g. {\"clients\":{\"include\":[\"ALL_CLIENTS\"]}} or a list of specific client ids. Open authored config — supplied as raw JSON."}
   * @returns {Object}
   * @sampleResult {"type":"OAUTH_AUTHORIZATION_POLICY","id":"00palyaappA22DPkj0h7","status":"ACTIVE","name":"Default Policy","priority":1,"conditions":{"clients":{"include":["ALL_CLIENTS"]}}}
   */
  async createAuthorizationServerPolicy(authServerId, name, description, status, priority, conditions) {
    status = this.#resolveChoice(status, STATUS_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerPolicies/ (Create a Policy - CreateAuthorizationServerPolicyRequest; body {type:"OAUTH_AUTHORIZATION_POLICY", name, conditions{clients{include[]}}})
    const body = this.#buildAuthServerPolicyBody(name, description, status, priority, conditions)

    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/policies`,
      method: 'post',
      body,
      logTag: 'createAuthorizationServerPolicy',
    })

    return result.body
  }

  /**
   * @operationName Get Authorization Server Policy
   * @category Authorization Server Policies
   * @description Retrieves a single access policy from a custom authorization server. Use this to inspect a policy before editing it.
   * @route POST /get-authorization-server-policy
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getAuthServerPoliciesDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The access policy to retrieve."}
   * @returns {Object}
   * @sampleResult {"type":"OAUTH_AUTHORIZATION_POLICY","id":"00palyaappA22DPkj0h7","status":"ACTIVE","name":"Default Policy"}
   */
  async getAuthorizationServerPolicy(authServerId, policyId) {
    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/policies/${ encodeURIComponent(policyId) }`,
      logTag: 'getAuthorizationServerPolicy',
    })

    return result.body
  }

  /**
   * @operationName Replace Authorization Server Policy
   * @category Authorization Server Policies
   * @description Fully replaces an access policy on a custom authorization server (PUT overwrite). Use this to rename a policy or change its client scope.
   * @route POST /replace-authorization-server-policy
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getAuthServerPoliciesDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy to replace."}
   * @paramDef {"type":"String","label":"Policy Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Policy name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Policy description."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Status."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Evaluation order."}
   * @paramDef {"type":"Object","label":"Conditions","name":"conditions","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Client scope, e.g. {\"clients\":{\"include\":[\"ALL_CLIENTS\"]}}. Open authored config — supplied as raw JSON."}
   * @returns {Object}
   * @sampleResult {"type":"OAUTH_AUTHORIZATION_POLICY","id":"00palyaappA22DPkj0h7","status":"ACTIVE","name":"Default Policy"}
   */
  async replaceAuthorizationServerPolicy(authServerId, policyId, name, description, status, priority, conditions) {
    status = this.#resolveChoice(status, STATUS_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerPolicies/ (Replace a Policy - CreateAuthorizationServerPolicyRequest; body {type:"OAUTH_AUTHORIZATION_POLICY", name, conditions})
    const body = this.#buildAuthServerPolicyBody(name, description, status, priority, conditions)

    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/policies/${ encodeURIComponent(policyId) }`,
      method: 'put',
      body,
      logTag: 'replaceAuthorizationServerPolicy',
    })

    return result.body
  }

  /**
   * @operationName Delete Authorization Server Policy
   * @category Authorization Server Policies
   * @description Deletes an access policy from a custom authorization server permanently. Destructive - use with care.
   * @route POST /delete-authorization-server-policy
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getAuthServerPoliciesDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"policyId":"00palyaappA22DPkj0h7"}
   */
  async deleteAuthorizationServerPolicy(authServerId, policyId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerPolicies/ (Delete a Policy - 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/policies/${ encodeURIComponent(policyId) }`,
      method: 'delete',
      logTag: 'deleteAuthorizationServerPolicy',
    })

    return { deleted: true, policyId }
  }

  /**
   * @operationName Activate Authorization Server Policy
   * @category Authorization Server Policies
   * @description Activates an access policy on a custom authorization server so it starts enforcing. Use this after creating a staged policy.
   * @route POST /activate-authorization-server-policy
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getAuthServerPoliciesDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy to activate."}
   * @returns {Object}
   * @sampleResult {"activated":true,"policyId":"00palyaappA22DPkj0h7"}
   */
  async activateAuthorizationServerPolicy(authServerId, policyId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerPolicies/ (Activate a Policy - empty body, 204)
    await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/policies/${ encodeURIComponent(policyId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateAuthorizationServerPolicy',
    })

    return { activated: true, policyId }
  }

  /**
   * @operationName Deactivate Authorization Server Policy
   * @category Authorization Server Policies
   * @description Deactivates an access policy on a custom authorization server (required before delete). Use this to take a policy out of service.
   * @route POST /deactivate-authorization-server-policy
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getAuthServerPoliciesDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy to deactivate."}
   * @returns {Object}
   * @sampleResult {"deactivated":true,"policyId":"00palyaappA22DPkj0h7"}
   */
  async deactivateAuthorizationServerPolicy(authServerId, policyId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerPolicies/ (Deactivate a Policy - empty body, 204)
    await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/policies/${ encodeURIComponent(policyId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateAuthorizationServerPolicy',
    })

    return { deactivated: true, policyId }
  }

  /**
   * @operationName List Authorization Server Policy Rules
   * @category Authorization Server Policies
   * @description Lists the rules of an access policy on a custom authorization server. Use this to find a rule id before editing it.
   * @route POST /list-authorization-server-policy-rules
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getAuthServerPoliciesDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy whose rules to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"type":"RESOURCE_ACCESS","id":"0prnss7DkUOTlujAa0g4","status":"ACTIVE","name":"Default Policy Rule","priority":1}],"cursor":null}
   */
  async listAuthorizationServerPolicyRules(authServerId, policyId) {
    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/policies/${ encodeURIComponent(policyId) }/rules`,
      logTag: 'listAuthorizationServerPolicyRules',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Authorization Server Policy Rule
   * @category Authorization Server Policies
   * @description Creates a rule within an access policy on a custom authorization server - it decides which people, grant types, and scopes the policy permits, and sets the token lifetimes. Requires the API Access Management add-on.
   * @route POST /create-authorization-server-policy-rule
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getAuthServerPoliciesDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy to add a rule to."}
   * @paramDef {"type":"String","label":"Rule Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Name of the rule."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Evaluation order within the policy."}
   * @paramDef {"type":"Object","label":"Conditions","name":"conditions","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Who/what the rule applies to. e.g. {\"people\":{\"groups\":{\"include\":[\"EVERYONE\"]}},\"grantTypes\":{\"include\":[\"authorization_code\",\"client_credentials\"]},\"scopes\":{\"include\":[\"*\"]}}. Open authored config — supplied as raw JSON."}
   * @paramDef {"type":"Object","label":"Token Actions","name":"actions","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Token lifetimes + optional inline hook. e.g. {\"token\":{\"accessTokenLifetimeMinutes\":60,\"refreshTokenLifetimeMinutes\":0,\"refreshTokenWindowMinutes\":10080}}. Open authored config — supplied as raw JSON."}
   * @returns {Object}
   * @sampleResult {"type":"RESOURCE_ACCESS","id":"0prnss7DkUOTlujAa0g4","status":"ACTIVE","name":"Default Policy Rule","priority":1,"conditions":{"people":{"groups":{"include":["EVERYONE"]}},"grantTypes":{"include":["authorization_code"]},"scopes":{"include":["*"]}},"actions":{"token":{"accessTokenLifetimeMinutes":60}}}
   */
  async createAuthorizationServerPolicyRule(authServerId, policyId, name, priority, conditions, actions) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerRules/ (Create a Rule - CreateAuthorizationServerPolicyRuleRequest; body {type:"RESOURCE_ACCESS", name, conditions, actions})
    const body = this.#buildAuthServerRuleBody(name, priority, conditions, actions)

    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/policies/${ encodeURIComponent(policyId) }/rules`,
      method: 'post',
      body,
      logTag: 'createAuthorizationServerPolicyRule',
    })

    return result.body
  }

  // Builds the rule create/replace body from the cited CreateAuthorizationServerPolicyRuleRequest.
  // conditions/actions are freeform (people.groups / grantTypes / scopes / token block are user-chosen).
  #buildAuthServerRuleBody(name, priority, conditions, actions) {
    const body = {
      type: 'RESOURCE_ACCESS',
      name,
      conditions: this.#parseJsonObject(conditions, 'Conditions'),
      actions: this.#parseJsonObject(actions, 'Token Actions'),
    }

    if (priority !== undefined && priority !== null) {
      body.priority = priority
    }

    return body
  }

  /**
   * @operationName Get Authorization Server Policy Rule
   * @category Authorization Server Policies
   * @description Retrieves a single rule of an access policy on a custom authorization server. Use this to inspect a rule before editing it.
   * @route POST /get-authorization-server-policy-rule
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getAuthServerPoliciesDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy."}
   * @paramDef {"type":"String","label":"Rule","name":"ruleId","required":true,"dictionary":"getAuthServerPolicyRulesDictionary","dependsOn":["authServerId","policyId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The rule to retrieve."}
   * @returns {Object}
   * @sampleResult {"type":"RESOURCE_ACCESS","id":"0prnss7DkUOTlujAa0g4","status":"ACTIVE","name":"Default Policy Rule"}
   */
  async getAuthorizationServerPolicyRule(authServerId, policyId, ruleId) {
    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/policies/${ encodeURIComponent(policyId) }/rules/${ encodeURIComponent(ruleId) }`,
      logTag: 'getAuthorizationServerPolicyRule',
    })

    return result.body
  }

  /**
   * @operationName Replace Authorization Server Policy Rule
   * @category Authorization Server Policies
   * @description Fully replaces a rule of an access policy on a custom authorization server (PUT overwrite). Use this to change which people/grant types/scopes the rule permits or its token lifetimes.
   * @route POST /replace-authorization-server-policy-rule
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getAuthServerPoliciesDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy."}
   * @paramDef {"type":"String","label":"Rule","name":"ruleId","required":true,"dictionary":"getAuthServerPolicyRulesDictionary","dependsOn":["authServerId","policyId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The rule to replace."}
   * @paramDef {"type":"String","label":"Rule Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Rule name."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Evaluation order."}
   * @paramDef {"type":"Object","label":"Conditions","name":"conditions","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Rule conditions (people/grantTypes/scopes). Open authored config — supplied as raw JSON."}
   * @paramDef {"type":"Object","label":"Token Actions","name":"actions","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Token lifetimes + optional inline hook. Open authored config — supplied as raw JSON."}
   * @returns {Object}
   * @sampleResult {"type":"RESOURCE_ACCESS","id":"0prnss7DkUOTlujAa0g4","status":"ACTIVE","name":"Default Policy Rule"}
   */
  async replaceAuthorizationServerPolicyRule(authServerId, policyId, ruleId, name, priority, conditions, actions) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerRules/ (Replace a Rule - CreateAuthorizationServerPolicyRuleRequest; body {type:"RESOURCE_ACCESS", name, conditions, actions})
    const body = this.#buildAuthServerRuleBody(name, priority, conditions, actions)

    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/policies/${ encodeURIComponent(policyId) }/rules/${ encodeURIComponent(ruleId) }`,
      method: 'put',
      body,
      logTag: 'replaceAuthorizationServerPolicyRule',
    })

    return result.body
  }

  /**
   * @operationName Delete Authorization Server Policy Rule
   * @category Authorization Server Policies
   * @description Deletes a rule from an access policy on a custom authorization server permanently. Destructive - use with care.
   * @route POST /delete-authorization-server-policy-rule
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getAuthServerPoliciesDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy."}
   * @paramDef {"type":"String","label":"Rule","name":"ruleId","required":true,"dictionary":"getAuthServerPolicyRulesDictionary","dependsOn":["authServerId","policyId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The rule to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"ruleId":"0prnss7DkUOTlujAa0g4"}
   */
  async deleteAuthorizationServerPolicyRule(authServerId, policyId, ruleId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerRules/ (Delete a Rule - 204 No Content)
    await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/policies/${ encodeURIComponent(policyId) }/rules/${ encodeURIComponent(ruleId) }`,
      method: 'delete',
      logTag: 'deleteAuthorizationServerPolicyRule',
    })

    return { deleted: true, ruleId }
  }

  /**
   * @operationName Activate Authorization Server Policy Rule
   * @category Authorization Server Policies
   * @description Activates a rule within an access policy on a custom authorization server so it starts enforcing.
   * @route POST /activate-authorization-server-policy-rule
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getAuthServerPoliciesDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy."}
   * @paramDef {"type":"String","label":"Rule","name":"ruleId","required":true,"dictionary":"getAuthServerPolicyRulesDictionary","dependsOn":["authServerId","policyId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The rule to activate."}
   * @returns {Object}
   * @sampleResult {"activated":true,"ruleId":"0prnss7DkUOTlujAa0g4"}
   */
  async activateAuthorizationServerPolicyRule(authServerId, policyId, ruleId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerRules/ (Activate a Rule - empty body, 204)
    await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/policies/${ encodeURIComponent(policyId) }/rules/${ encodeURIComponent(ruleId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateAuthorizationServerPolicyRule',
    })

    return { activated: true, ruleId }
  }

  /**
   * @operationName Deactivate Authorization Server Policy Rule
   * @category Authorization Server Policies
   * @description Deactivates a rule within an access policy on a custom authorization server (required before delete).
   * @route POST /deactivate-authorization-server-policy-rule
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Policy","name":"policyId","required":true,"dictionary":"getAuthServerPoliciesDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The policy."}
   * @paramDef {"type":"String","label":"Rule","name":"ruleId","required":true,"dictionary":"getAuthServerPolicyRulesDictionary","dependsOn":["authServerId","policyId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The rule to deactivate."}
   * @returns {Object}
   * @sampleResult {"deactivated":true,"ruleId":"0prnss7DkUOTlujAa0g4"}
   */
  async deactivateAuthorizationServerPolicyRule(authServerId, policyId, ruleId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerRules/ (Deactivate a Rule - empty body, 204)
    await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/policies/${ encodeURIComponent(policyId) }/rules/${ encodeURIComponent(ruleId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateAuthorizationServerPolicyRule',
    })

    return { deactivated: true, ruleId }
  }

  /**
   * @operationName List Authorization Server Keys
   * @category Authorization Server Keys
   * @description Lists the signing keys (JWKs) of a custom authorization server - Okta uses these to sign tokens. Use this to read the current and next keys.
   * @route POST /list-authorization-server-keys
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @returns {Object}
   * @sampleResult {"items":[{"status":"ACTIVE","alg":"RS256","e":"AQAB","kid":"RQ8DuhdxCczyMvy7GNJb4Ka3lQ99vrSo3oFBUiZjzzc","kty":"RSA","use":"sig"}],"cursor":null}
   */
  async listAuthorizationServerKeys(authServerId) {
    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/credentials/keys`,
      logTag: 'listAuthorizationServerKeys',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Get Authorization Server Key
   * @category Authorization Server Keys
   * @description Retrieves a single signing key (JWK) of a custom authorization server by its kid. Use this to inspect a specific key.
   * @route POST /get-authorization-server-key
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Key ID (kid)","name":"kid","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The signing key id (kid) from List Authorization Server Keys. There is no key picker — these keys are server-managed and not separately enumerable as a dictionary; paste the kid from the list."}
   * @returns {Object}
   * @sampleResult {"status":"ACTIVE","alg":"RS256","e":"AQAB","kid":"RQ8DuhdxCczyMvy7GNJb4Ka3lQ99vrSo3oFBUiZjzzc","kty":"RSA","use":"sig"}
   */
  async getAuthorizationServerKey(authServerId, kid) {
    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/credentials/keys/${ encodeURIComponent(kid) }`,
      logTag: 'getAuthorizationServerKey',
    })

    return result.body
  }

  /**
   * @operationName Rotate Authorization Server Keys
   * @category Authorization Server Keys
   * @description Rotates the signing keys of a custom authorization server - the NEXT key becomes ACTIVE and a fresh NEXT key is generated. Use this for scheduled key rotation. Only signing keys are rotatable.
   * @route POST /rotate-authorization-server-keys
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"Key Use","name":"use","uiComponent":{"type":"DROPDOWN","options":{"values":["Signing"]}},"description":"The key use to rotate. Only signing keys are rotatable. Defaults to Signing."}
   * @returns {Object}
   * @sampleResult {"items":[{"status":"ACTIVE","alg":"RS256","kid":"new-kid","kty":"RSA","use":"sig"},{"status":"NEXT","alg":"RS256","kid":"next-kid","kty":"RSA","use":"sig"}],"cursor":null}
   */
  async rotateAuthorizationServerKeys(authServerId, use) {
    use = this.#resolveChoice(use, ROTATE_KEY_USE_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AuthorizationServerKeys/ (Rotate Keys - JwkUse; body {use:"sig"})
    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/credentials/lifecycle/keyRotate`,
      method: 'post',
      body: { use: use || 'sig' },
      logTag: 'rotateAuthorizationServerKeys',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName List Authorization Server Clients
   * @category Authorization Server Keys
   * @description Lists the OAuth 2.0 client applications that use a custom authorization server. Use this to audit which apps request tokens from this server.
   * @route POST /list-oauth2-clients-for-authorization-server
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @returns {Object}
   * @sampleResult {"items":[{"client_id":"0oabskvc6442nkvQO0h7","client_name":"My App"}],"cursor":null}
   */
  async listOAuth2ClientsForAuthorizationServer(authServerId) {
    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/clients`,
      logTag: 'listOAuth2ClientsForAuthorizationServer',
    })

    return this.#listResult(result)
  }

  // ==========================================================================
  //  APPLICATION USER & GROUP ASSIGNMENTS (full)
  //  (tags ApplicationUsers / ApplicationGroups - completes assign/unassign)
  // ==========================================================================
  /**
   * @operationName Get Application User
   * @category Applications
   * @description Retrieves a user's assignment to an application, including their app-specific profile and credentials. Use this to inspect what a user looks like inside an app.
   * @route POST /get-application-user
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The assigned user to retrieve the app-assignment for."}
   * @paramDef {"type":"String","label":"Expand","name":"expand","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional embed, e.g. 'user' to include the full Okta user."}
   * @returns {Object}
   * @sampleResult {"id":"00u1dnq5S0CfjlkpABCD","scope":"USER","status":"PROVISIONED","credentials":{"userName":"saml.test@example.com"},"profile":{"email":"saml.test@example.com","role":"Tester"}}
   */
  async getApplicationUser(appId, userId, expand) {
    const query = {}

    if (expand) {
      query.expand = expand
    }

    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/users/${ encodeURIComponent(userId) }`,
      query,
      logTag: 'getApplicationUser',
    })

    return result.body
  }

  /**
   * @operationName Update Application User
   * @category Applications
   * @description Updates a user's assignment to an application - set their app-specific username/password (for SWA/password-push apps) and/or their app profile attributes. Use this to fix a user's identity inside an app.
   * @route POST /update-application-user
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The assigned user to update."}
   * @paramDef {"type":"String","label":"App Username","name":"appUserName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user's username within this application (credentials.userName)."}
   * @paramDef {"type":"String","label":"App Password","name":"appPassword","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Set the app-specific password (credentials.password.value). Only for SWA/password-push apps."}
   * @paramDef {"type":"Object","label":"App Profile","name":"profile","schemaLoader":"appUserProfileSchema","dependsOn":["appId"],"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Application-specific profile attributes for this user. The form fields are loaded from the app's user schema; if unavailable, supply raw JSON."}
   * @returns {Object}
   * @sampleResult {"id":"00ud4tVDDXYVKPXKVLCO","scope":"USER","status":"ACTIVE","credentials":{"userName":"rae.cloud@example.com"},"profile":{"name":"Rae Mae Cloud","middle_name":"Mae","email":"rae.cloud@example.com"}}
   */
  async updateApplicationUser(appId, userId, appUserName, appPassword, profile) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ApplicationUsers/#tag/ApplicationUsers/operation/updateApplicationUser (AppUserUpdateRequest; examples AppUserUpdateCredEx {"credentials":{"userName":..,"password":{"value":..}}}, AppUserUpdateProfileEx {"profile":{..}})
    const body = {}

    if (appUserName || appPassword) {
      body.credentials = {}

      if (appUserName) {
        body.credentials.userName = appUserName
      }

      if (appPassword) {
        body.credentials.password = { value: appPassword }
      }
    }

    const profileObj = this.#optionalJsonObject(profile, 'App Profile')

    if (profileObj) {
      body.profile = profileObj
    }

    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/users/${ encodeURIComponent(userId) }`,
      method: 'post',
      body,
      logTag: 'updateApplicationUser',
    })

    return result.body
  }

  /**
   * @operationName Get Application Group Assignment
   * @category Applications
   * @description Retrieves a group's assignment to an application, including the assignment profile (e.g. mapped manager/department). Use this to inspect how a group provisions to an app.
   * @route POST /get-application-group-assignment
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The assigned group whose assignment to retrieve."}
   * @paramDef {"type":"String","label":"Expand","name":"expand","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional embed, e.g. 'group' to include the full group object."}
   * @returns {Object}
   * @sampleResult {"id":"00g15acRUy0SYb9GT0g4","priority":0,"profile":{"manager":"Donald Glover","department":"marketing","division":"top"}}
   */
  async getApplicationGroupAssignment(appId, groupId, expand) {
    const query = {}

    if (expand) {
      query.expand = expand
    }

    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/groups/${ encodeURIComponent(groupId) }`,
      query,
      logTag: 'getApplicationGroupAssignment',
    })

    return result.body
  }

  /**
   * @operationName Update Application Group Assignment
   * @category Applications
   * @description Updates a group's assignment-profile on an application via JSON-Patch operations - e.g. change the manager or department mapped to that group. Use this to adjust how a group provisions without re-assigning it.
   * @route POST /update-group-assignment-to-application
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The assigned group to update."}
   * @paramDef {"type":"Array<Object>","label":"Patch Operations","name":"operations","required":true,"schemaLoader":"jsonPatchOpSchema","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON-Patch operations to apply to the group-assignment profile. Each item: {op, path, value}, e.g. {\"op\":\"replace\",\"path\":\"/profile/manager\",\"value\":\"Carlo Ancelotti\"}."}
   * @returns {Object}
   * @sampleResult {"id":"00g15acRUy0SYb9GT0g4","priority":0,"profile":{"manager":"Carlo Ancelotti","department":"Accounting"}}
   */
  async updateGroupAssignmentToApplication(appId, groupId, operations) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ApplicationGroups/#tag/ApplicationGroups/operation/updateGroupAssignmentToApplication (JSON-Patch array; example [{"op":"replace","path":"/profile/manager","value":"Carlo Ancelotti"}])
    const body = this.#parsePatchOperations(operations)

    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/groups/${ encodeURIComponent(groupId) }`,
      method: 'patch',
      body,
      logTag: 'updateGroupAssignmentToApplication',
    })

    return result.body
  }

  // Returns the parsed JSON object, or null when the input is empty/blank (used for optional Object params).
  #optionalJsonObject(value, label) {
    if (value === undefined || value === null || value === '') {
      return null
    }

    if (typeof value === 'string' && !value.trim()) {
      return null
    }

    return this.#parseJsonObject(value, label)
  }

  // Normalizes a JSON-Patch operations param (array of {op,path,value} sub-form rows, or a raw JSON
  // array string) into the cited JSON-Patch array body.
  #parsePatchOperations(operations) {
    let arr = operations

    if (typeof arr === 'string') {
      const trimmed = arr.trim()

      try {
        arr = JSON.parse(trimmed)
      } catch {
        throw new Error('Patch Operations must be a JSON array of {op, path, value} entries (e.g. [{"op":"replace","path":"/profile/manager","value":"Jane"}]).')
      }
    }

    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error('At least one patch operation is required (e.g. {"op":"replace","path":"/profile/manager","value":"Jane"}).')
    }

    return arr.map(item => {
      const op = { op: item.op || 'replace', path: item.path }

      if (item.value !== undefined) {
        op.value = item.value
      }

      return op
    })
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"String","name":"appId","required":true}
   * @returns {Object}
   */
  async appUserProfileSchema({ criteria } = {}) {
    const appId = criteria?.appId

    if (!appId) {
      return null
    }

    let schema

    try {
      const result = await this.#apiRequest({
        path: `/api/v1/meta/schemas/apps/${ encodeURIComponent(appId) }/default`,
        logTag: 'appUserProfileSchema',
      })

      schema = result?.body
    } catch {
      // Fall back to a freeform JSON field when the app's schema can't be read.
      return null
    }

    const properties = {
      ...(schema?.definitions?.base?.properties || {}),
      ...(schema?.definitions?.custom?.properties || {}),
    }

    const fields = Object.entries(properties)
      .filter(([, prop]) => prop && prop.mutability !== 'READ_ONLY')
      .map(([name, prop]) => ({
        type: prop.type === 'boolean' ? 'Boolean' : prop.type === 'integer' || prop.type === 'number' ? 'Number' : 'String',
        name,
        label: prop.title || name,
        required: Boolean(prop.required),
        uiComponent: { type: prop.type === 'boolean' ? 'TOGGLE' : 'SINGLE_LINE_TEXT' },
        description: prop.description || `App profile attribute "${ name }".`,
      }))

    return fields.length ? fields : null
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @returns {Object}
   */
  async jsonPatchOpSchema() {
    return [
      {
        type: 'String',
        name: 'op',
        label: 'Operation',
        required: true,
        uiComponent: { type: 'DROPDOWN', options: { values: ['replace', 'add', 'remove'] } },
        description: 'The JSON-Patch operation to perform.',
      },
      {
        type: 'String',
        name: 'path',
        label: 'Path',
        required: true,
        uiComponent: { type: 'SINGLE_LINE_TEXT' },
        description: 'JSON-Pointer path into the assignment, e.g. /profile/manager.',
      },
      {
        type: 'String',
        name: 'value',
        label: 'Value',
        required: false,
        uiComponent: { type: 'SINGLE_LINE_TEXT' },
        description: 'The new value (omit for a remove operation).',
      },
    ]
  }

  // ==========================================================================
  //  APPLICATION CREDENTIALS & KEYS
  //  (tags ApplicationSSOCredentialKey / ApplicationSSOPublicKeys / ApplicationLogos /
  //   OAuth2ResourceServerCredentialsKeys)
  // ==========================================================================
  /**
   * @operationName List Application Keys
   * @category Application Credentials
   * @description Lists an application's SSO signing-key credentials (the X.509 certificates Okta uses to sign SAML assertions for this app). Use this to find a key id before getting or cloning it.
   * @route POST /list-application-keys
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application whose SSO signing key credentials to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"kid":"akm5hvbbevE341ovl0h7","kty":"RSA","use":"sig","x5c":["MIIDqDCC...truncated cert"],"expiresAt":"2017-12-10T18:56:22.000Z","created":"2015-12-10T18:56:23.000Z"}],"cursor":null}
   */
  async listApplicationKeys(appId) {
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/keys`,
      logTag: 'listApplicationKeys',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Generate Application Key
   * @category Application Credentials
   * @description Generates a new SSO signing-key credential (X.509 certificate) for an application, valid for the chosen number of years. Use this to add a fresh signing cert ahead of rotation.
   * @route POST /generate-application-key
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application to generate a new SSO signing key for."}
   * @paramDef {"type":"Number","label":"Validity (Years)","name":"validityYears","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many years until the generated certificate expires (Okta default 2; max 10)."}
   * @returns {Object}
   * @sampleResult {"kid":"akm5hvbbevE341ovl0h7","kty":"RSA","use":"sig","x5c":["MIIDqDCC...truncated"],"expiresAt":"2026-12-10T18:56:22.000Z","created":"2024-12-10T18:56:23.000Z"}
   */
  async generateApplicationKey(appId, validityYears) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ApplicationSSOCredentialKey/#tag/ApplicationSSOCredentialKey/operation/generateApplicationKey (no request body; validityYears query param controls expiry)
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/keys/generate`,
      method: 'post',
      query: { validityYears },
      logTag: 'generateApplicationKey',
    })

    return result.body
  }

  /**
   * @operationName Get Application Key
   * @category Application Credentials
   * @description Retrieves a single SSO signing-key credential of an application by its kid. Use this to inspect a specific certificate.
   * @route POST /get-application-key
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application."}
   * @paramDef {"type":"String","label":"Key","name":"keyId","required":true,"dictionary":"getApplicationKeysDictionary","dependsOn":["appId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The SSO signing key (kid) to retrieve."}
   * @returns {Object}
   * @sampleResult {"kid":"akm5hvbbevE341ovl0h7","kty":"RSA","use":"sig","x5c":["MIIDqDCC...truncated"],"expiresAt":"2017-12-10T18:56:22.000Z"}
   */
  async getApplicationKey(appId, keyId) {
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/keys/${ encodeURIComponent(keyId) }`,
      logTag: 'getApplicationKey',
    })

    return result.body
  }

  /**
   * @operationName Clone Application Key
   * @category Application Credentials
   * @description Copies an application's SSO signing-key credential into another application. Use this when two apps must share the same signing certificate.
   * @route POST /clone-application-key
   * @paramDef {"type":"String","label":"Source Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application that currently owns the key."}
   * @paramDef {"type":"String","label":"Key","name":"keyId","required":true,"dictionary":"getApplicationKeysDictionary","dependsOn":["appId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The SSO signing key (kid) to clone."}
   * @paramDef {"type":"String","label":"Target Application","name":"targetAid","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application to copy the key into (targetAid query param)."}
   * @returns {Object}
   * @sampleResult {"kid":"akm5hvbbevE341ovl0h7","kty":"RSA","use":"sig","x5c":["MIIDqDCC...truncated"]}
   */
  async cloneApplicationKey(appId, keyId, targetAid) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ApplicationSSOCredentialKey/#tag/ApplicationSSOCredentialKey/operation/cloneApplicationKey (no request body; targetAid query param)
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/keys/${ encodeURIComponent(keyId) }/clone`,
      method: 'post',
      query: { targetAid },
      logTag: 'cloneApplicationKey',
    })

    return result.body
  }

  /**
   * @operationName List Application CSRs
   * @category Application Credentials
   * @description Lists an application's certificate signing requests (CSRs). Use this to find a CSR id before getting, revoking, or publishing a signed cert against it.
   * @route POST /list-csrs-for-application
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application whose certificate signing requests to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"h9zkutaSe7fZX0SwN1GqDApofgD1OW8g2B5l2azha50","created":"2017-03-28T01:11:10.000Z","csr":"MIIC4DCC...truncated","kty":"RSA"}],"cursor":null}
   */
  async listCsrsForApplication(appId) {
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/csrs`,
      logTag: 'listCsrsForApplication',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Generate Application CSR
   * @category Application Credentials
   * @description Generates a certificate signing request (CSR) for an application so you can have it signed by your own CA, then publish the signed cert back. Provide the certificate subject (at least a common name).
   * @route POST /generate-csr-for-application
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application to generate a CSR for."}
   * @paramDef {"type":"String","label":"Common Name","name":"commonName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Subject common name (CN), e.g. the SP issuer."}
   * @paramDef {"type":"String","label":"Organization","name":"organizationName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Subject organization (O)."}
   * @paramDef {"type":"String","label":"Organizational Unit","name":"organizationalUnitName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Subject organizational unit (OU), e.g. department."}
   * @paramDef {"type":"String","label":"Locality","name":"localityName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Subject locality / city (L)."}
   * @paramDef {"type":"String","label":"State / Province","name":"stateOrProvinceName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Subject state or province (ST)."}
   * @paramDef {"type":"String","label":"Country","name":"countryName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Subject country code (C), e.g. US."}
   * @paramDef {"type":"Array<String>","label":"DNS Subject Alt Names","name":"dnsNames","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional Subject Alternative Name DNS entries (one per line)."}
   * @returns {Object}
   * @sampleResult {"id":"h9zkutaSe7fZX0SwN1GqDApofgD1OW8g2B5l2azha50","created":"2017-03-28T01:11:10.000Z","csr":"MIIC4DCC...truncated","kty":"RSA"}
   */
  async generateCsrForApplication(appId, commonName, organizationName, organizationalUnitName, localityName, stateOrProvinceName, countryName, dnsNames) {
    // API: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ApplicationSSOCredentialKey/
    // The docs give no request example for CsrMetadata, so the body is built field-for-field from the
    // CsrMetadata / CsrMetadataSubject / CsrMetadataSubjectAltNames schemas and needs a live test to confirm.
    const body = this.#buildCsrMetadata(commonName, organizationName, organizationalUnitName, localityName, stateOrProvinceName, countryName, dnsNames)

    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/csrs`,
      method: 'post',
      body,
      logTag: 'generateCsrForApplication',
    })

    return result.body
  }

  // Builds a CsrMetadata body { subject{...}, subjectAltNames?{dnsNames[]} } from the cited schema fields.
  #buildCsrMetadata(commonName, organizationName, organizationalUnitName, localityName, stateOrProvinceName, countryName, dnsNames) {
    const subject = { commonName }

    if (countryName) {
      subject.countryName = countryName
    }

    if (localityName) {
      subject.localityName = localityName
    }

    if (stateOrProvinceName) {
      subject.stateOrProvinceName = stateOrProvinceName
    }

    if (organizationName) {
      subject.organizationName = organizationName
    }

    if (organizationalUnitName) {
      subject.organizationalUnitName = organizationalUnitName
    }

    const body = { subject }
    const dns = this.#splitLines(dnsNames)

    if (dns.length) {
      body.subjectAltNames = { dnsNames: dns }
    }

    return body
  }

  // Splits a newline/comma-separated list param (or a real array) into a trimmed string array.
  #splitLines(value) {
    if (Array.isArray(value)) {
      return value.map(v => String(v).trim()).filter(Boolean)
    }

    if (typeof value === 'string' && value.trim()) {
      return value.split(/[\n,]/).map(v => v.trim()).filter(Boolean)
    }

    return []
  }

  /**
   * @operationName Get Application CSR
   * @category Application Credentials
   * @description Retrieves a single certificate signing request (CSR) of an application by its id. Use this to read the CSR text to send to your CA.
   * @route POST /get-csr-for-application
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application."}
   * @paramDef {"type":"String","label":"CSR","name":"csrId","required":true,"dictionary":"getAppCsrsDictionary","dependsOn":["appId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The certificate signing request to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"h9zkutaSe7fZX0SwN1GqDApofgD1OW8g2B5l2azha50","created":"2017-03-28T01:11:10.000Z","csr":"MIIC4DCC...truncated","kty":"RSA"}
   */
  async getCsrForApplication(appId, csrId) {
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/csrs/${ encodeURIComponent(csrId) }`,
      logTag: 'getCsrForApplication',
    })

    return result.body
  }

  /**
   * @operationName Revoke Application CSR
   * @category Application Credentials
   * @description Revokes (deletes) a pending certificate signing request from an application. Use this to discard a CSR you no longer intend to publish. Destructive - use with care.
   * @route POST /revoke-csr-from-application
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application."}
   * @paramDef {"type":"String","label":"CSR","name":"csrId","required":true,"dictionary":"getAppCsrsDictionary","dependsOn":["appId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The certificate signing request to revoke."}
   * @returns {Object}
   * @sampleResult {"revoked":true,"csrId":"h9zkutaSe7fZX0SwN1GqDApofgD1OW8g2B5l2azha50"}
   */
  async revokeCsrFromApplication(appId, csrId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ApplicationSSOCredentialKey/#tag/ApplicationSSOCredentialKey/operation/revokeCsrFromApplication (204 No Content)
    await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/csrs/${ encodeURIComponent(csrId) }`,
      method: 'delete',
      logTag: 'revokeCsrFromApplication',
    })

    return { revoked: true, csrId }
  }

  /**
   * @operationName Publish Application CSR
   * @category Application Credentials
   * @description Publishes a CA-signed certificate against an application's pending CSR, turning it into an active signing-key credential. Paste the signed certificate in PEM format.
   * @route POST /publish-csr-from-application
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application."}
   * @paramDef {"type":"String","label":"CSR","name":"csrId","required":true,"dictionary":"getAppCsrsDictionary","dependsOn":["appId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The certificate signing request to publish a signed cert against."}
   * @paramDef {"type":"String","label":"Signed Certificate (PEM)","name":"certificate","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The CA-signed certificate in PEM format (sent with Content-Type application/x-pem-file)."}
   * @returns {Object}
   * @sampleResult {"kid":"akm5hvbbevE341ovl0h7","kty":"RSA","use":"sig","x5c":["MIIDqDCC...truncated"],"expiresAt":"2026-12-10T18:56:22.000Z"}
   */
  async publishCsrFromApplication(appId, csrId, certificate) {
    // API: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ApplicationSSOCredentialKey/
    // The body is the raw CA-signed certificate (Content-Type application/x-pem-file), not JSON, so there is
    // nothing to diff against the docs; publishing needs a real signed cert and a live test to confirm.
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/csrs/${ encodeURIComponent(csrId) }/lifecycle/publish`,
      method: 'post',
      body: certificate,
      contentType: 'application/x-pem-file',
      logTag: 'publishCsrFromApplication',
    })

    return result.body
  }

  /**
   * @operationName List Application Client Keys
   * @category Application Credentials
   * @description Lists the OAuth/OIDC client JSON Web Keys (JWKs) registered on an application (for private_key_jwt client authentication). Use this to find a JWK id before getting or managing it.
   * @route POST /list-jwk
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OAuth/OIDC client application whose JSON Web Keys to list."}
   * @returns {Object}
   * @sampleResult {"jwks":{"keys":[{"id":"pks2f4zrZbs8nUa7p0g4","kid":"DRUFXGF9...","kty":"RSA","alg":"RS256","use":"sig","e":"AQAB","n":"AJncr...truncated","status":"INACTIVE"}]}}
   */
  async listJwk(appId) {
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/jwks`,
      logTag: 'listJwk',
    })

    return result.body
  }

  /**
   * @operationName Add Application Client Key
   * @category Application Credentials
   * @description Adds an OAuth/OIDC client JSON Web Key (JWK) to an application - the public half of a key the client uses for private_key_jwt authentication. Supply the RSA public key (kid, e, n).
   * @route POST /add-jwk
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OAuth/OIDC client application to add a key to."}
   * @paramDef {"type":"String","label":"Key ID (kid)","name":"kid","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Unique identifier for the JSON Web Key."}
   * @paramDef {"type":"String","label":"Key Use","name":"use","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Signing","Encryption"]}},"description":"Whether the key is used for signing or encryption."}
   * @paramDef {"type":"String","label":"RSA Exponent (e)","name":"e","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"RSA public exponent (base64url), e.g. AQAB."}
   * @paramDef {"type":"String","label":"RSA Modulus (n)","name":"n","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"RSA modulus value (base64url) of the public key."}
   * @paramDef {"type":"String","label":"Algorithm","name":"alg","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Algorithm used in the key, e.g. RS256."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Initial status of the key. Defaults to Active."}
   * @returns {Object}
   * @sampleResult {"id":"pks2f50kZB0cITmYU0g4","kid":"ASHJHGasa782333-Sla3x3POBiIxDreBCdZuFs5B","kty":"RSA","alg":"RS256","use":"sig","e":"AQAB","n":"AJncr...truncated","status":"ACTIVE","created":"2023-04-06T21:32:33.000Z"}
   */
  async addJwk(appId, kid, use, e, n, alg, status) {
    use = this.#resolveChoice(use, JWK_USE_LABELS)
    status = this.#resolveChoice(status, STATUS_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ApplicationSSOPublicKeys/#tag/ApplicationSSOPublicKeys/operation/addJwk (createOAuth2ClientJsonWebKeyRequestBody; body {kid, kty:"RSA", use, e, n, alg?, status?})
    const body = { kid, kty: 'RSA', use, e, n }

    if (alg) {
      body.alg = alg
    }

    if (status) {
      body.status = status
    }

    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/jwks`,
      method: 'post',
      body,
      logTag: 'addJwk',
    })

    return result.body
  }

  /**
   * @operationName Get Application Client Key
   * @category Application Credentials
   * @description Retrieves a single OAuth/OIDC client JSON Web Key of an application by its id. Use this to inspect a registered client key.
   * @route POST /get-jwk
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OAuth/OIDC client application."}
   * @paramDef {"type":"String","label":"JSON Web Key","name":"keyId","required":true,"dictionary":"getAppJwksDictionary","dependsOn":["appId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The client JWK (id) to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"pks2f50kZB0cITmYU0g4","kid":"ASHJHGasa782333-...","kty":"RSA","alg":"RS256","use":"sig","e":"AQAB","n":"AJncr...truncated","status":"ACTIVE"}
   */
  async getJwk(appId, keyId) {
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/jwks/${ encodeURIComponent(keyId) }`,
      logTag: 'getJwk',
    })

    return result.body
  }

  /**
   * @operationName Delete Application Client Key
   * @category Application Credentials
   * @description Deletes an inactive OAuth/OIDC client JSON Web Key from an application. The key must be deactivated first. Destructive - use with care.
   * @route POST /delete-jwk
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OAuth/OIDC client application."}
   * @paramDef {"type":"String","label":"JSON Web Key","name":"keyId","required":true,"dictionary":"getAppJwksDictionary","dependsOn":["appId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The inactive client JWK (id) to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"keyId":"pks2f50kZB0cITmYU0g4"}
   */
  async deleteJwk(appId, keyId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ApplicationSSOPublicKeys/#tag/ApplicationSSOPublicKeys/operation/deletejwk (204 No Content; key must be INACTIVE)
    await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/jwks/${ encodeURIComponent(keyId) }`,
      method: 'delete',
      logTag: 'deleteJwk',
    })

    return { deleted: true, keyId }
  }

  /**
   * @operationName Activate Application Client Key
   * @category Application Credentials
   * @description Activates an OAuth/OIDC client JSON Web Key on an application so the client can authenticate with it.
   * @route POST /activate-app-jwk
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OAuth/OIDC client application."}
   * @paramDef {"type":"String","label":"JSON Web Key","name":"keyId","required":true,"dictionary":"getAppJwksDictionary","dependsOn":["appId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The client JWK (id) to activate."}
   * @returns {Object}
   * @sampleResult {"id":"pks2f50kZB0cITmYU0g4","kid":"ASHJHGasa782333-...","use":"sig","status":"ACTIVE"}
   */
  async activateAppJwk(appId, keyId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ApplicationSSOPublicKeys/#tag/ApplicationSSOPublicKeys/operation/activateOAuth2ClientJsonWebKey (no body)
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/jwks/${ encodeURIComponent(keyId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateAppJwk',
    })

    return result.body
  }

  /**
   * @operationName Deactivate Application Client Key
   * @category Application Credentials
   * @description Deactivates an OAuth/OIDC client JSON Web Key on an application (required before delete).
   * @route POST /deactivate-app-jwk
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OAuth/OIDC client application."}
   * @paramDef {"type":"String","label":"JSON Web Key","name":"keyId","required":true,"dictionary":"getAppJwksDictionary","dependsOn":["appId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The client JWK (id) to deactivate."}
   * @returns {Object}
   * @sampleResult {"id":"pks2f50kZB0cITmYU0g4","kid":"ASHJHGasa782333-...","use":"sig","status":"INACTIVE"}
   */
  async deactivateAppJwk(appId, keyId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ApplicationSSOPublicKeys/#tag/ApplicationSSOPublicKeys/operation/deactivateOAuth2ClientJsonWebKey (no body)
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/jwks/${ encodeURIComponent(keyId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateAppJwk',
    })

    return result.body
  }

  /**
   * @operationName List Application Client Secrets
   * @category Application Credentials
   * @description Lists the OAuth/OIDC client secrets registered on an application. The full secret value is only returned at creation; this shows ids, status, and hashes. Use this to find a secret id.
   * @route POST /list-oauth2-client-secrets
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OAuth/OIDC client application whose client secrets to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"ocs2f4zrZbs8nUa7p0g4","status":"INACTIVE","secret_hash":"yk4SVx4sUWVJVbHt6M-UPA","created":"2023-02-21T20:08:24.000Z"}],"cursor":null}
   */
  async listOAuth2ClientSecrets(appId) {
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/secrets`,
      logTag: 'listOAuth2ClientSecrets',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Create Application Client Secret
   * @category Application Credentials
   * @description Creates a new OAuth/OIDC client secret on an application. Leave the secret blank to let Okta generate one - the full value is returned only this once, so capture it. Use this to rotate a client secret.
   * @route POST /create-oauth2-client-secret
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OAuth/OIDC client application."}
   * @paramDef {"type":"String","label":"Client Secret","name":"clientSecret","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional custom secret string. Leave blank to let Okta generate one."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Initial status of the secret. Defaults to Active."}
   * @returns {Object}
   * @sampleResult {"id":"ocs2f50kZB0cITmYU0g4","status":"ACTIVE","client_secret":"DRUFXGF9...returned once at create","secret_hash":"FpCwXwSjTRQNtEI11I00-g","created":"2023-04-06T21:32:33.000Z"}
   */
  async createOAuth2ClientSecret(appId, clientSecret, status) {
    status = this.#resolveChoice(status, STATUS_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ApplicationSSOPublicKeys/#tag/ApplicationSSOPublicKeys/operation/createOAuth2ClientSecret (empty body {} -> system-generated; or {client_secret, status})
    const body = {}

    if (clientSecret) {
      body.client_secret = clientSecret
    }

    if (status) {
      body.status = status
    }

    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/secrets`,
      method: 'post',
      body,
      logTag: 'createOAuth2ClientSecret',
    })

    return result.body
  }

  /**
   * @operationName Get Application Client Secret
   * @category Application Credentials
   * @description Retrieves a single OAuth/OIDC client secret of an application by its id. The full secret value is only shown at creation; later reads may mask it.
   * @route POST /get-oauth2-client-secret
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OAuth/OIDC client application."}
   * @paramDef {"type":"String","label":"Client Secret","name":"secretId","required":true,"dictionary":"getAppSecretsDictionary","dependsOn":["appId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The client secret (id) to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"ocs2f50kZB0cITmYU0g4","status":"ACTIVE","secret_hash":"FpCwXwSjTRQNtEI11I00-g","created":"2023-04-06T21:32:33.000Z"}
   */
  async getOAuth2ClientSecret(appId, secretId) {
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/secrets/${ encodeURIComponent(secretId) }`,
      logTag: 'getOAuth2ClientSecret',
    })

    return result.body
  }

  /**
   * @operationName Delete Application Client Secret
   * @category Application Credentials
   * @description Deletes an inactive OAuth/OIDC client secret from an application. The secret must be deactivated first. Destructive - use with care.
   * @route POST /delete-oauth2-client-secret
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OAuth/OIDC client application."}
   * @paramDef {"type":"String","label":"Client Secret","name":"secretId","required":true,"dictionary":"getAppSecretsDictionary","dependsOn":["appId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The inactive client secret (id) to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"secretId":"ocs2f50kZB0cITmYU0g4"}
   */
  async deleteOAuth2ClientSecret(appId, secretId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ApplicationSSOPublicKeys/#tag/ApplicationSSOPublicKeys/operation/deleteOAuth2ClientSecret (204 No Content; secret must be INACTIVE)
    await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/secrets/${ encodeURIComponent(secretId) }`,
      method: 'delete',
      logTag: 'deleteOAuth2ClientSecret',
    })

    return { deleted: true, secretId }
  }

  /**
   * @operationName Activate Application Client Secret
   * @category Application Credentials
   * @description Activates an OAuth/OIDC client secret on an application so it can be used to authenticate the client.
   * @route POST /activate-oauth2-client-secret
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OAuth/OIDC client application."}
   * @paramDef {"type":"String","label":"Client Secret","name":"secretId","required":true,"dictionary":"getAppSecretsDictionary","dependsOn":["appId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The client secret (id) to activate."}
   * @returns {Object}
   * @sampleResult {"id":"ocs2f50kZB0cITmYU0g4","status":"ACTIVE","secret_hash":"0WOOvBSzV9clc4Nr7Rbaug"}
   */
  async activateOAuth2ClientSecret(appId, secretId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ApplicationSSOPublicKeys/#tag/ApplicationSSOPublicKeys/operation/activateOAuth2ClientSecret (no body)
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/secrets/${ encodeURIComponent(secretId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateOAuth2ClientSecret',
    })

    return result.body
  }

  /**
   * @operationName Deactivate Application Client Secret
   * @category Application Credentials
   * @description Deactivates an OAuth/OIDC client secret on an application (required before delete).
   * @route POST /deactivate-oauth2-client-secret
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The OAuth/OIDC client application."}
   * @paramDef {"type":"String","label":"Client Secret","name":"secretId","required":true,"dictionary":"getAppSecretsDictionary","dependsOn":["appId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The client secret (id) to deactivate."}
   * @returns {Object}
   * @sampleResult {"id":"ocs2f4zrZbs8nUa7p0g4","status":"INACTIVE","secret_hash":"yk4SVx4sUWVJVbHt6M-UPA"}
   */
  async deactivateOAuth2ClientSecret(appId, secretId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ApplicationSSOPublicKeys/#tag/ApplicationSSOPublicKeys/operation/deactivateOAuth2ClientSecret (no body)
    const result = await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/credentials/secrets/${ encodeURIComponent(secretId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateOAuth2ClientSecret',
    })

    return result.body
  }

  /**
   * @operationName Upload Application Logo
   * @category Application Credentials
   * @description Uploads a logo image for an application (PNG/JPG/SVG/GIF, under 1 MB; 200x200 recommended). Pick a file from Flowrunner storage. The image is streamed to Okta as a multipart upload.
   * @route POST /upload-application-logo
   * @paramDef {"type":"String","label":"Application","name":"appId","required":true,"dictionary":"getApplicationsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application to set the logo on."}
   * @paramDef {"type":"String","label":"Logo File","name":"logoFile","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"PNG/JPG/SVG/GIF image, under 1 MB. 200x200 recommended; SVG must be UTF-8."}
   * @returns {Object}
   * @sampleResult {"uploaded":true,"appId":"0oa1nkheCuDn82XVI0g4"}
   */
  async uploadApplicationLogo(appId, logoFile) {
    // API: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/ApplicationLogos/
    // Multipart binary upload (form field `file`), so there is no JSON body to diff against the docs, and
    // Flowrunner.Files only resolves on a deployed instance - confirm with a live test. The Flowrunner
    // file at logoFile is streamed as the `file` part.
    const form = new FormData()
    const file = await Flowrunner.Files.getFileDownloadUrl(logoFile)

    form.append('file', file)

    await this.#apiRequest({
      path: `/api/v1/apps/${ encodeURIComponent(appId) }/logo`,
      method: 'post',
      body: form,
      contentType: 'multipart/form-data',
      logTag: 'uploadApplicationLogo',
    })

    return { uploaded: true, appId }
  }

  /**
   * @operationName List Resource Server Keys
   * @category Application Credentials
   * @description Lists the resource-server public JSON Web Keys of a custom authorization server (used to validate encrypted/signed requests). Use this to find a key id before managing it.
   * @route POST /list-oauth2-resource-server-json-web-keys
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server (resource server) whose JWKs to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"apk40n33xfjbPaf6D0g5","kid":"RQ8DuhdxCczyMvy7GNJb4Ka3lQ99vrSo3oFBUiZjzzc","kty":"RSA","use":"enc","e":"AQAB","n":"g0Mirhrys...truncated","status":"ACTIVE"}],"cursor":null}
   */
  async listOAuth2ResourceServerJsonWebKeys(authServerId) {
    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/resourceservercredentials/keys`,
      logTag: 'listOAuth2ResourceServerJsonWebKeys',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Add Resource Server Key
   * @category Application Credentials
   * @description Adds a resource-server public JSON Web Key to a custom authorization server. Supply the RSA public key (kid, e, n) and whether it's for signing or encryption.
   * @route POST /add-oauth2-resource-server-json-web-key
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server to add a JWK to."}
   * @paramDef {"type":"String","label":"Key ID (kid)","name":"kid","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Unique identifier for the JSON Web Key."}
   * @paramDef {"type":"String","label":"Key Type","name":"kty","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cryptographic algorithm family, e.g. RSA."}
   * @paramDef {"type":"String","label":"Key Use","name":"use","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Signing","Encryption"]}},"description":"Whether the key is used for signing or encryption."}
   * @paramDef {"type":"String","label":"RSA Exponent (e)","name":"e","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"RSA public exponent (base64url), e.g. AQAB."}
   * @paramDef {"type":"String","label":"RSA Modulus (n)","name":"n","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"RSA modulus value (base64url) of the public key."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Initial status of the key. Defaults to Active."}
   * @returns {Object}
   * @sampleResult {"id":"apk2f4zrZbs8nUa7p0g4","kid":"ASHJHGasa782333-...","kty":"RSA","alg":"RS256","use":"enc","e":"AQAB","n":"AJncr...truncated","status":"INACTIVE","created":"2023-04-06T21:32:33.000Z"}
   */
  async addOAuth2ResourceServerJsonWebKey(authServerId, kid, kty, use, e, n, status) {
    use = this.#resolveChoice(use, JWK_USE_LABELS)
    status = this.#resolveChoice(status, STATUS_LABELS)
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/OAuth2ResourceServerCredentialsKeys/#tag/OAuth2ResourceServerCredentialsKeys/operation/addOAuth2ResourceServerJsonWebKey (addOAuth2ResourceServerJsonWebKeyRequestBody; body {kid, kty, use, e, n, status?})
    const body = { kid, kty, use, e, n }

    if (status) {
      body.status = status
    }

    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/resourceservercredentials/keys`,
      method: 'post',
      body,
      logTag: 'addOAuth2ResourceServerJsonWebKey',
    })

    return result.body
  }

  /**
   * @operationName Get Resource Server Key
   * @category Application Credentials
   * @description Retrieves a single resource-server JSON Web Key of a custom authorization server by its id.
   * @route POST /get-oauth2-resource-server-json-web-key
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"JSON Web Key","name":"keyId","required":true,"dictionary":"getResourceServerKeysDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The resource-server JWK (id) to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"apk2f4zrZbs8nUa7p0g4","kid":"ASHJHGasa782333-...","kty":"RSA","alg":"RS256","use":"enc","e":"AQAB","n":"AJncr...truncated","status":"INACTIVE"}
   */
  async getOAuth2ResourceServerJsonWebKey(authServerId, keyId) {
    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/resourceservercredentials/keys/${ encodeURIComponent(keyId) }`,
      logTag: 'getOAuth2ResourceServerJsonWebKey',
    })

    return result.body
  }

  /**
   * @operationName Delete Resource Server Key
   * @category Application Credentials
   * @description Deletes an inactive resource-server JSON Web Key from a custom authorization server. The key must be deactivated first. Destructive - use with care.
   * @route POST /delete-oauth2-resource-server-json-web-key
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"JSON Web Key","name":"keyId","required":true,"dictionary":"getResourceServerKeysDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The inactive resource-server JWK (id) to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"keyId":"apk2f4zrZbs8nUa7p0g4"}
   */
  async deleteOAuth2ResourceServerJsonWebKey(authServerId, keyId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/OAuth2ResourceServerCredentialsKeys/#tag/OAuth2ResourceServerCredentialsKeys/operation/deleteOAuth2ResourceServerJsonWebKey (204 No Content; key must be INACTIVE)
    await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/resourceservercredentials/keys/${ encodeURIComponent(keyId) }`,
      method: 'delete',
      logTag: 'deleteOAuth2ResourceServerJsonWebKey',
    })

    return { deleted: true, keyId }
  }

  /**
   * @operationName Activate Resource Server Key
   * @category Application Credentials
   * @description Activates a resource-server JSON Web Key on a custom authorization server so it can be used.
   * @route POST /activate-resource-server-key
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"JSON Web Key","name":"keyId","required":true,"dictionary":"getResourceServerKeysDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The resource-server JWK (id) to activate."}
   * @returns {Object}
   * @sampleResult {"id":"apk2f4zrZbs8nUa7p0g4","kid":"ASHJHGasa782333-...","use":"enc","status":"ACTIVE"}
   */
  async activateResourceServerKey(authServerId, keyId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/OAuth2ResourceServerCredentialsKeys/#tag/OAuth2ResourceServerCredentialsKeys/operation/activateOAuth2ResourceServerJsonWebKey (no body)
    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/resourceservercredentials/keys/${ encodeURIComponent(keyId) }/lifecycle/activate`,
      method: 'post',
      logTag: 'activateResourceServerKey',
    })

    return result.body
  }

  /**
   * @operationName Deactivate Resource Server Key
   * @category Application Credentials
   * @description Deactivates a resource-server JSON Web Key on a custom authorization server (required before delete).
   * @route POST /deactivate-resource-server-key
   * @paramDef {"type":"String","label":"Authorization Server","name":"authServerId","required":true,"dictionary":"getAuthServersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The custom authorization server."}
   * @paramDef {"type":"String","label":"JSON Web Key","name":"keyId","required":true,"dictionary":"getResourceServerKeysDictionary","dependsOn":["authServerId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The resource-server JWK (id) to deactivate."}
   * @returns {Object}
   * @sampleResult {"id":"apk2f4zrZbs8nUa7p0g4","kid":"ASHJHGasa782333-...","use":"enc","status":"INACTIVE"}
   */
  async deactivateResourceServerKey(authServerId, keyId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/OAuth2ResourceServerCredentialsKeys/#tag/OAuth2ResourceServerCredentialsKeys/operation/deactivateOAuth2ResourceServerJsonWebKey (no body)
    const result = await this.#apiRequest({
      path: `/api/v1/authorizationServers/${ encodeURIComponent(authServerId) }/resourceservercredentials/keys/${ encodeURIComponent(keyId) }/lifecycle/deactivate`,
      method: 'post',
      logTag: 'deactivateResourceServerKey',
    })

    return result.body
  }

  // ==========================================================================
  //  IDENTITY PROVIDER KEYS & SIGNING
  //  (tags IdentityProviderKeys / IdentityProviderSigningKeys / IdentityProviderUsers residual)
  // ==========================================================================
  /**
   * @operationName List Org IdP Keys
   * @category Identity Provider Keys
   * @description Lists the org-level Identity Provider key store - X.509 certificates you upload once and reference from multiple IdP configs. Paginates through every shared cert. Use this to find a key id.
   * @route POST /list-identity-provider-keys
   * @paramDef {"type":"Number","label":"Max Results","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size for the org IdP key store (the method auto-paginates to return all)."}
   * @returns {Object}
   * @sampleResult {"items":[{"kid":"your-key-id","kty":"RSA","use":"sig","e":"65537","n":"10143840...truncated","x5c":["MIIDnjCC...truncated"],"created":"2016-01-03T18:15:47.000Z"}],"cursor":null}
   */
  async listIdentityProviderKeys(limit) {
    // The org key store paginates via Link rel="next"; follow it to exhaustion rather than capping
    // and dropping pages - there can be many shared certs in the org store.
    const items = []
    const query = {}

    if (limit) {
      query.limit = limit
    }

    let after = null

    do {
      const pageQuery = after ? { ...query, after } : query
      const result = await this.#apiRequest({ path: '/api/v1/idps/credentials/keys', query: pageQuery, logTag: 'listIdentityProviderKeys' })

      if (Array.isArray(result?.body)) {
        items.push(...result.body)
      }

      after = result?.cursor || null
    } while (after)

    return { items, cursor: null }
  }

  /**
   * @operationName Create Org IdP Key
   * @category Identity Provider Keys
   * @description Adds an X.509 certificate to the org-level Identity Provider key store, so IdP configs can reference it. Paste the certificate as base64-DER (a PEM body with no header lines).
   * @route POST /create-identity-provider-key
   * @paramDef {"type":"String","label":"X.509 Certificate","name":"x5c","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Base64-DER (PEM body, no headers) X.509 certificate to add to the org IdP key store."}
   * @returns {Object}
   * @sampleResult {"kid":"your-key-id","kty":"RSA","use":"sig","e":"65537","n":"10143840...truncated","x5c":["MIIDnjCC...truncated"],"created":"2016-01-03T18:15:47.000Z"}
   */
  async createIdentityProviderKey(x5c) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/IdentityProviderKeys/#tag/IdentityProviderKeys/operation/createIdentityProviderKey (IdPCertificateCredential required:[x5c]; body {x5c:[cert]})
    const result = await this.#apiRequest({
      path: '/api/v1/idps/credentials/keys',
      method: 'post',
      body: { x5c: [x5c] },
      logTag: 'createIdentityProviderKey',
    })

    return result.body
  }

  /**
   * @operationName Get Org IdP Key
   * @category Identity Provider Keys
   * @description Retrieves a single org-level Identity Provider key by its kid. Use this to inspect a shared certificate.
   * @route POST /get-identity-provider-key
   * @paramDef {"type":"String","label":"Org IdP Key","name":"kid","required":true,"dictionary":"getOrgIdpKeysDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The org-level IdP key (kid) to retrieve."}
   * @returns {Object}
   * @sampleResult {"kid":"your-key-id","kty":"RSA","use":"sig","e":"65537","n":"truncated","x5c":["MIIDnjCC...truncated"]}
   */
  async getIdentityProviderKey(kid) {
    const result = await this.#apiRequest({
      path: `/api/v1/idps/credentials/keys/${ encodeURIComponent(kid) }`,
      logTag: 'getIdentityProviderKey',
    })

    return result.body
  }

  /**
   * @operationName Replace Org IdP Key
   * @category Identity Provider Keys
   * @description Fully replaces an org-level Identity Provider key (PUT overwrite) with a new X.509 certificate. Use this to rotate a shared certificate.
   * @route POST /replace-identity-provider-key
   * @paramDef {"type":"String","label":"Org IdP Key","name":"kid","required":true,"dictionary":"getOrgIdpKeysDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The org-level IdP key (kid) to replace."}
   * @paramDef {"type":"String","label":"X.509 Certificate","name":"x5c","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The replacement base64-DER X.509 certificate."}
   * @paramDef {"type":"String","label":"RSA Exponent (e)","name":"e","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional RSA public exponent."}
   * @paramDef {"type":"String","label":"RSA Modulus (n)","name":"n","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional RSA modulus value."}
   * @returns {Object}
   * @sampleResult {"kid":"your-key-id","kty":"RSA","use":"sig","e":"65537","n":"truncated","x5c":["MIIDnjCC...truncated"]}
   */
  async replaceIdentityProviderKey(kid, x5c, e, n) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/IdentityProviderKeys/#tag/IdentityProviderKeys/operation/replaceIdentityProviderKey (IdPKeyCredentialRequest; body {e?, n?, x5c:[cert]})
    const body = { x5c: [x5c] }

    if (e) {
      body.e = e
    }

    if (n) {
      body.n = n
    }

    const result = await this.#apiRequest({
      path: `/api/v1/idps/credentials/keys/${ encodeURIComponent(kid) }`,
      method: 'put',
      body,
      logTag: 'replaceIdentityProviderKey',
    })

    return result.body
  }

  /**
   * @operationName Delete Org IdP Key
   * @category Identity Provider Keys
   * @description Deletes an org-level Identity Provider key from the key store. The key must not be in use by any IdP. Destructive - use with care.
   * @route POST /delete-identity-provider-key
   * @paramDef {"type":"String","label":"Org IdP Key","name":"kid","required":true,"dictionary":"getOrgIdpKeysDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The org-level IdP key (kid) to delete (must be unused)."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"kid":"your-key-id"}
   */
  async deleteIdentityProviderKey(kid) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/IdentityProviderKeys/#tag/IdentityProviderKeys/operation/deleteIdentityProviderKey (204 No Content)
    await this.#apiRequest({
      path: `/api/v1/idps/credentials/keys/${ encodeURIComponent(kid) }`,
      method: 'delete',
      logTag: 'deleteIdentityProviderKey',
    })

    return { deleted: true, kid }
  }

  /**
   * @operationName List IdP Signing Keys
   * @category Identity Provider Keys
   * @description Lists the signing keys of a specific Identity Provider - the certificates Okta uses to sign requests to that IdP. Use this to find a key id before getting or cloning it.
   * @route POST /list-identity-provider-signing-keys
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP whose signing keys to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"kid":"akm5hvbbevE341ovl0h7","kty":"RSA","use":"sig","x5c":["MIIDqDCC...truncated"],"expiresAt":"2017-12-10T18:56:22.000Z","created":"2015-12-10T18:56:23.000Z"}],"cursor":null}
   */
  async listIdentityProviderSigningKeys(idpId) {
    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/credentials/keys`,
      logTag: 'listIdentityProviderSigningKeys',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName List Active IdP Signing Key
   * @category Identity Provider Keys
   * @description Retrieves the currently active signing key(s) of a specific Identity Provider. Use this to see which cert Okta is signing requests with right now.
   * @route POST /list-active-identity-provider-signing-key
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP whose active signing key to retrieve."}
   * @returns {Object}
   * @sampleResult {"items":[{"kid":"your-key-id","kty":"RSA","use":"sig","x5c":["MIIDmDCC...truncated"],"expiresAt":"2035-04-14T16:29:59.000Z","created":"2025-04-14T16:29:59.000Z"}],"cursor":null}
   */
  async listActiveIdentityProviderSigningKey(idpId) {
    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/credentials/keys/active`,
      logTag: 'listActiveIdentityProviderSigningKey',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Generate IdP Signing Key
   * @category Identity Provider Keys
   * @description Generates a new signing key (X.509 certificate) for a specific Identity Provider, valid for the chosen number of years. Use this to add a fresh signing cert ahead of rotation.
   * @route POST /generate-identity-provider-signing-key
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP to generate a new signing key for."}
   * @paramDef {"type":"Number","label":"Validity (Years)","name":"validityYears","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many years until the generated signing certificate expires."}
   * @returns {Object}
   * @sampleResult {"kid":"akm5hvbbevE341ovl0h7","kty":"RSA","use":"sig","x5c":["MIIDnjCC...truncated"],"expiresAt":"2026-12-18T22:23:32.000Z","created":"2024-12-18T22:22:32.000Z"}
   */
  async generateIdentityProviderSigningKey(idpId, validityYears) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/IdentityProviderSigningKeys/#tag/IdentityProviderSigningKeys/operation/generateIdentityProviderSigningKey (no request body; validityYears query param)
    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/credentials/keys/generate`,
      method: 'post',
      query: { validityYears },
      logTag: 'generateIdentityProviderSigningKey',
    })

    return result.body
  }

  /**
   * @operationName Get IdP Signing Key
   * @category Identity Provider Keys
   * @description Retrieves a single signing key of a specific Identity Provider by its kid. Use this to inspect a certificate.
   * @route POST /get-identity-provider-signing-key
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP."}
   * @paramDef {"type":"String","label":"Signing Key","name":"kid","required":true,"dictionary":"getIdpSigningKeysDictionary","dependsOn":["idpId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The signing key (kid) to retrieve."}
   * @returns {Object}
   * @sampleResult {"kid":"akm5hvbbevE341ovl0h7","kty":"RSA","use":"sig","x5c":["MIIDnjCC...truncated"],"expiresAt":"2026-12-18T22:23:32.000Z"}
   */
  async getIdentityProviderSigningKey(idpId, kid) {
    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/credentials/keys/${ encodeURIComponent(kid) }`,
      logTag: 'getIdentityProviderSigningKey',
    })

    return result.body
  }

  /**
   * @operationName Clone IdP Signing Key
   * @category Identity Provider Keys
   * @description Copies an Identity Provider's signing key into another IdP. Use this when two IdP configs must share the same signing certificate.
   * @route POST /clone-identity-provider-key
   * @paramDef {"type":"String","label":"Source Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP that owns the key."}
   * @paramDef {"type":"String","label":"Signing Key","name":"kid","required":true,"dictionary":"getIdpSigningKeysDictionary","dependsOn":["idpId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The signing key (kid) to clone."}
   * @paramDef {"type":"String","label":"Target Identity Provider","name":"targetIdpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP to copy the key into (targetIdpId query param)."}
   * @returns {Object}
   * @sampleResult {"kid":"akm5hvbbevE341ovl0h7","kty":"RSA","use":"sig","x5c":["MIIDnjCC...truncated"]}
   */
  async cloneIdentityProviderKey(idpId, kid, targetIdpId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/IdentityProviderSigningKeys/#tag/IdentityProviderSigningKeys/operation/cloneIdentityProviderKey (no request body; targetIdpId query param)
    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/credentials/keys/${ encodeURIComponent(kid) }/clone`,
      method: 'post',
      query: { targetIdpId },
      logTag: 'cloneIdentityProviderKey',
    })

    return result.body
  }

  /**
   * @operationName List IdP CSRs
   * @category Identity Provider Keys
   * @description Lists the certificate signing requests (CSRs) of a specific Identity Provider. Use this to find a CSR id before getting, revoking, or publishing a signed cert against it.
   * @route POST /list-csrs-for-identity-provider
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP whose certificate signing requests to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"h9zkutaSe7fZX0SwN1GqDApofgD1OW8g2B5l2azha50","created":"2017-03-28T01:11:10.000Z","csr":"MIIC4DCC...truncated"}],"cursor":null}
   */
  async listCsrsForIdentityProvider(idpId) {
    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/credentials/csrs`,
      logTag: 'listCsrsForIdentityProvider',
    })

    return this.#listResult(result)
  }

  /**
   * @operationName Generate IdP CSR
   * @category Identity Provider Keys
   * @description Generates a certificate signing request (CSR) for a specific Identity Provider so you can have it signed by your own CA, then publish the signed cert back. Provide the certificate subject (at least a common name).
   * @route POST /generate-csr-for-identity-provider
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP to generate a CSR for."}
   * @paramDef {"type":"String","label":"Common Name","name":"commonName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Subject common name (CN)."}
   * @paramDef {"type":"String","label":"Organization","name":"organizationName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Subject organization (O)."}
   * @paramDef {"type":"String","label":"Organizational Unit","name":"organizationalUnitName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Subject organizational unit (OU)."}
   * @paramDef {"type":"String","label":"Locality","name":"localityName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Subject locality / city (L)."}
   * @paramDef {"type":"String","label":"State / Province","name":"stateOrProvinceName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Subject state or province (ST)."}
   * @paramDef {"type":"String","label":"Country","name":"countryName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Subject country code (C)."}
   * @paramDef {"type":"Array<String>","label":"DNS Subject Alt Names","name":"dnsNames","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional SAN DNS entries (one per line)."}
   * @returns {Object}
   * @sampleResult {"id":"h9zkutaSe7fZX0SwN1GqDApofgD1OW8g2B5l2azha50","created":"2017-03-28T01:11:10.000Z","csr":"MIIC4DCC...truncated"}
   */
  async generateCsrForIdentityProvider(idpId, commonName, organizationName, organizationalUnitName, localityName, stateOrProvinceName, countryName, dnsNames) {
    // API: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/IdentityProviderSigningKeys/
    // The docs give no request example for CsrMetadata (same schema as the app-CSR generate above), so the body
    // is built field-for-field from the CsrMetadata / CsrMetadataSubject / CsrMetadataSubjectAltNames schemas
    // and needs a live test to confirm.
    const body = this.#buildCsrMetadata(commonName, organizationName, organizationalUnitName, localityName, stateOrProvinceName, countryName, dnsNames)

    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/credentials/csrs`,
      method: 'post',
      body,
      logTag: 'generateCsrForIdentityProvider',
    })

    return result.body
  }

  /**
   * @operationName Get IdP CSR
   * @category Identity Provider Keys
   * @description Retrieves a single certificate signing request (CSR) of a specific Identity Provider by its id. Use this to read the CSR text to send to your CA.
   * @route POST /get-csr-for-identity-provider
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP."}
   * @paramDef {"type":"String","label":"CSR","name":"idpCsrId","required":true,"dictionary":"getIdpCsrsDictionary","dependsOn":["idpId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The certificate signing request to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"h9zkutaSe7fZX0SwN1GqDApofgD1OW8g2B5l2azha50","created":"2017-03-28T01:11:10.000Z","csr":"MIIC4DCC...truncated"}
   */
  async getCsrForIdentityProvider(idpId, idpCsrId) {
    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/credentials/csrs/${ encodeURIComponent(idpCsrId) }`,
      logTag: 'getCsrForIdentityProvider',
    })

    return result.body
  }

  /**
   * @operationName Revoke IdP CSR
   * @category Identity Provider Keys
   * @description Revokes (deletes) a pending certificate signing request from a specific Identity Provider. Use this to discard a CSR you no longer intend to publish. Destructive - use with care.
   * @route POST /revoke-csr-for-identity-provider
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP."}
   * @paramDef {"type":"String","label":"CSR","name":"idpCsrId","required":true,"dictionary":"getIdpCsrsDictionary","dependsOn":["idpId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The certificate signing request to revoke."}
   * @returns {Object}
   * @sampleResult {"revoked":true,"idpCsrId":"h9zkutaSe7fZX0SwN1GqDApofgD1OW8g2B5l2azha50"}
   */
  async revokeCsrForIdentityProvider(idpId, idpCsrId) {
    // docs: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/IdentityProviderSigningKeys/#tag/IdentityProviderSigningKeys/operation/revokeCsrForIdentityProvider (204 No Content)
    await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/credentials/csrs/${ encodeURIComponent(idpCsrId) }`,
      method: 'delete',
      logTag: 'revokeCsrForIdentityProvider',
    })

    return { revoked: true, idpCsrId }
  }

  /**
   * @operationName Publish IdP CSR
   * @category Identity Provider Keys
   * @description Publishes a CA-signed certificate against a specific Identity Provider's pending CSR, turning it into an active signing key. Paste the signed certificate in PEM format.
   * @route POST /publish-csr-for-identity-provider
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The IdP."}
   * @paramDef {"type":"String","label":"CSR","name":"idpCsrId","required":true,"dictionary":"getIdpCsrsDictionary","dependsOn":["idpId"],"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The CSR to publish a signed cert against."}
   * @paramDef {"type":"String","label":"Signed Certificate (PEM)","name":"certificate","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The CA-signed certificate in PEM format (sent with Content-Type application/x-pem-file)."}
   * @returns {Object}
   * @sampleResult {"kid":"akm5hvbbevE341ovl0h7","kty":"RSA","use":"sig","x5c":["MIIDnjCC...truncated"]}
   */
  async publishCsrForIdentityProvider(idpId, idpCsrId, certificate) {
    // API: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/IdentityProviderSigningKeys/
    // The body is the raw CA-signed certificate (Content-Type application/x-pem-file), not JSON, so there is
    // nothing to diff against the docs; publishing needs a real signed cert and a live test to confirm.
    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/credentials/csrs/${ encodeURIComponent(idpCsrId) }/lifecycle/publish`,
      method: 'post',
      body: certificate,
      contentType: 'application/x-pem-file',
      logTag: 'publishCsrForIdentityProvider',
    })

    return result.body
  }

  /**
   * @operationName List Social IdP User Tokens
   * @category Identity Provider Keys
   * @description Lists the social/OIDC tokens Okta holds for a user linked through a specific Identity Provider (e.g. the access/ID tokens from the upstream provider). Use this to inspect a linked user's stored tokens.
   * @route POST /list-social-auth-tokens
   * @paramDef {"type":"String","label":"Identity Provider","name":"idpId","required":true,"dictionary":"getIdpsDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The social/OIDC IdP the user is linked to."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The Okta user whose stored social tokens to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"token id","token":"JBTWGV22G4ZGKV3N","tokenType":"urn:ietf:params:oauth:token-type:access_token","tokenAuthScheme":"Bearer","expiresAt":"2014-08-06T16:56:31.000Z","scopes":["openid","foo"]}],"cursor":null}
   */
  async listSocialAuthTokens(idpId, userId) {
    const result = await this.#apiRequest({
      path: `/api/v1/idps/${ encodeURIComponent(idpId) }/users/${ encodeURIComponent(userId) }/credentials/tokens`,
      logTag: 'listSocialAuthTokens',
    })

    return this.#listResult(result)
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }
}

Flowrunner.ServerCode.addService(Okta, [
  {
    name: 'orgUrl',
    displayName: 'Org URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Okta org base URL, e.g. https://dev-123456.okta.com',
  },
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'An Okta API token (SSWS). Create one under Security → API → Tokens.',
  },
])
