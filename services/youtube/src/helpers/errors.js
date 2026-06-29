'use strict'

const FRIENDLY_ERROR_MESSAGES = {
  // Auth / quota
  authError: 'YouTube authentication failed. Reconnect the integration.',
  invalidCredentials: 'YouTube credentials are invalid. Reconnect the integration.',
  quotaExceeded: 'Daily YouTube API quota reached. Resets at midnight Pacific Time. Request a quota extension if this happens often.',
  dailyLimitExceeded: 'Daily YouTube API quota reached. Try again after midnight Pacific Time.',
  rateLimitExceeded: 'YouTube is rate-limiting these requests. Slow down and retry in a few seconds.',
  userRateLimitExceeded: 'Too many requests to YouTube too fast. Slow down and retry.',
  uploadRateLimitExceeded: 'Upload rate limit hit. Wait a moment before uploading again.',

  // Subscriptions
  subscriptionDuplicate: 'Already subscribed to this channel.',
  subscriptionForbidden: 'Cannot subscribe to this channel — possibly age-restricted or otherwise blocked.',

  // Resource not found
  videoNotFound: 'Video not found. Check the video ID, URL, or that the video is public.',
  channelNotFound: 'Channel not found. Try a full channel URL, the @handle, or the UC... ID.',
  playlistNotFound: 'Playlist not found. Check the playlist ID or URL.',
  commentNotFound: 'Comment not found. The comment may have been deleted.',
  captionNotFound: 'Caption track not found. Check the caption ID.',
  liveBroadcastNotFound: 'Live broadcast not found. Check the broadcast ID.',
  liveStreamNotFound: 'Live stream not found.',

  // Permission / state
  forbidden: 'YouTube refused this operation. Common causes: video privacy, channel verification status, or scope mismatch.',
  insufficientPermissions: 'The connected YouTube account lacks permissions for this operation.',
  commentsDisabled: 'Comments are disabled on this video.',
  liveBroadcastNotAuthorized: 'This account is not authorized to live-stream. Enable live streaming on the channel first.',
  liveStreamingNotEnabled: 'YouTube live streaming is not enabled on this channel. Visit https://www.youtube.com/features to verify the channel and wait 24 hours.',
  livePermissionBlocked: 'YouTube live streaming is blocked for this account. Channel must be verified and have no active strikes.',
  liveChatNotFound: 'Live chat not found. The broadcast may not be active or chat may be disabled.',
  liveChatEnded: 'This live chat has ended.',
  liveChatDisabled: 'Live chat is disabled on this broadcast.',
  redundantTransition: 'Broadcast is already at the requested status.',
  invalidTransition: 'Cannot transition to that status from the current state.',
  errorStreamingBroadcast: 'Bound ingestion stream is not active. Start streaming before transitioning to live.',
  accountClosed: 'The connected YouTube account is closed.',
  accountSuspended: 'The connected YouTube account is suspended.',
  channelClosed: 'This channel is closed.',
  channelSuspended: 'This channel is suspended.',

  // Validation
  invalidValue: 'A parameter has an invalid value. Check the input.',
  badRequest: 'Request was rejected. Check parameter values.',
  invalidCategoryId: 'Invalid category ID. Use the Get Video Categories dictionary.',
  missingRequiredParameter: 'A required parameter is missing.',
  invalidPageToken: 'Page token is invalid or expired. Restart pagination.',

  // Conflict
  videoAlreadyInPlaylist: 'This video is already in the playlist.',
}

/**
 * Look up a friendly message for a YouTube error reason. Falls back to the original message.
 */
function friendlyMessage(reason, fallback) {
  return FRIENDLY_ERROR_MESSAGES[reason] || fallback
}

/**
 * Pulls reason + message from a Flowrunner.Request error body.
 */
function extractApiError(error) {
  const apiError = error?.body?.error || error?.response?.error

  if (!apiError) return null

  const reason = apiError.errors?.[0]?.reason
  const original = apiError.message || ''
  const friendly = friendlyMessage(reason, null)

  if (friendly) {
    return reason ? `${ friendly } (${ reason })` : friendly
  }

  if (original) {
    return reason ? `YouTube API: ${ original } (${ reason })` : `YouTube API: ${ original }`
  }

  return null
}

module.exports = { FRIENDLY_ERROR_MESSAGES, friendlyMessage, extractApiError }
