'use strict'

const { cleanupObject, ensureDate } = require('./utils')

const METRIC_PRESETS = {
  overview: ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'subscribersGained', 'subscribersLost', 'likes', 'comments', 'shares'],
  watchTime: ['estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage'],
  engagement: ['likes', 'dislikes', 'comments', 'shares', 'videosAddedToPlaylists', 'subscribersGained'],
  cards: ['cardImpressions', 'cardClicks', 'cardClickRate', 'cardTeaserImpressions', 'cardTeaserClicks', 'cardTeaserClickRate'],
  audience: ['views', 'estimatedMinutesWatched', 'averageViewPercentage'],
  revenue: ['estimatedRevenue', 'estimatedAdRevenue', 'grossRevenue', 'monetizedPlaybacks', 'playbackBasedCpm', 'cpm', 'adImpressions'],
}

const METRICS_CATALOG = [
  // Engagement
  { value: 'views', label: 'Views', category: 'engagement' },
  { value: 'redViews', label: 'YouTube Premium views', category: 'engagement' },
  { value: 'comments', label: 'Comments', category: 'engagement' },
  { value: 'likes', label: 'Likes', category: 'engagement' },
  { value: 'dislikes', label: 'Dislikes (private since 2021)', category: 'engagement' },
  { value: 'shares', label: 'Shares', category: 'engagement' },
  { value: 'videosAddedToPlaylists', label: 'Videos added to playlists', category: 'engagement' },
  { value: 'videosRemovedFromPlaylists', label: 'Videos removed from playlists', category: 'engagement' },

  // Watch time
  { value: 'estimatedMinutesWatched', label: 'Estimated minutes watched', category: 'watchTime' },
  { value: 'estimatedRedMinutesWatched', label: 'Premium minutes watched', category: 'watchTime' },
  { value: 'averageViewDuration', label: 'Average view duration (sec)', category: 'watchTime' },
  { value: 'averageViewPercentage', label: 'Average view percentage', category: 'watchTime' },
  { value: 'audienceWatchRatio', label: 'Audience watch ratio', category: 'watchTime' },
  { value: 'relativeRetentionPerformance', label: 'Relative retention', category: 'watchTime' },

  // Subscribers
  { value: 'subscribersGained', label: 'Subscribers gained', category: 'audience' },
  { value: 'subscribersLost', label: 'Subscribers lost', category: 'audience' },

  // Cards
  { value: 'cardImpressions', label: 'Card impressions', category: 'cards' },
  { value: 'cardClicks', label: 'Card clicks', category: 'cards' },
  { value: 'cardClickRate', label: 'Card click rate', category: 'cards' },
  { value: 'cardTeaserImpressions', label: 'Card teaser impressions', category: 'cards' },
  { value: 'cardTeaserClicks', label: 'Card teaser clicks', category: 'cards' },
  { value: 'cardTeaserClickRate', label: 'Card teaser click rate', category: 'cards' },

  // Annotations (legacy)
  { value: 'annotationImpressions', label: 'Annotation impressions', category: 'cards' },
  { value: 'annotationClicks', label: 'Annotation clicks', category: 'cards' },
  { value: 'annotationCloses', label: 'Annotation closes', category: 'cards' },
  { value: 'annotationClickThroughRate', label: 'Annotation CTR', category: 'cards' },
  { value: 'annotationCloseRate', label: 'Annotation close rate', category: 'cards' },

  // Revenue (sensitive)
  { value: 'estimatedRevenue', label: 'Estimated revenue (USD)', category: 'revenue' },
  { value: 'estimatedAdRevenue', label: 'Estimated ad revenue (USD)', category: 'revenue' },
  { value: 'grossRevenue', label: 'Gross revenue (USD)', category: 'revenue' },
  { value: 'estimatedRedPartnerRevenue', label: 'Premium partner revenue', category: 'revenue' },
  { value: 'monetizedPlaybacks', label: 'Monetized playbacks', category: 'revenue' },
  { value: 'playbackBasedCpm', label: 'Playback-based CPM', category: 'revenue' },
  { value: 'adImpressions', label: 'Ad impressions', category: 'revenue' },
  { value: 'cpm', label: 'CPM', category: 'revenue' },
]

const DIMENSIONS_CATALOG = [
  { value: 'day', label: 'Day', category: 'time' },
  { value: 'month', label: 'Month', category: 'time' },
  { value: 'video', label: 'Video', category: 'resource' },
  { value: 'channel', label: 'Channel', category: 'resource' },
  { value: 'playlist', label: 'Playlist', category: 'resource' },
  { value: 'group', label: 'Group', category: 'resource' },
  { value: 'country', label: 'Country', category: 'geography' },
  { value: 'province', label: 'Province (US/CA only)', category: 'geography' },
  { value: 'ageGroup', label: 'Age group', category: 'demographics' },
  { value: 'gender', label: 'Gender', category: 'demographics' },
  { value: 'sharingService', label: 'Sharing service', category: 'engagement' },
  { value: 'subscribedStatus', label: 'Subscribed status', category: 'audience' },
  { value: 'youtubeProduct', label: 'YouTube product', category: 'audience' },
  { value: 'liveOrOnDemand', label: 'Live vs on-demand', category: 'audience' },
  { value: 'deviceType', label: 'Device type', category: 'devices' },
  { value: 'operatingSystem', label: 'Operating system', category: 'devices' },
  { value: 'insightTrafficSourceType', label: 'Traffic source type', category: 'traffic' },
  { value: 'insightTrafficSourceDetail', label: 'Traffic source detail', category: 'traffic' },
  { value: 'playbackLocationType', label: 'Playback location type', category: 'traffic' },
  { value: 'playbackLocationDetail', label: 'Playback location detail', category: 'traffic' },
  { value: 'elapsedVideoTimeRatio', label: 'Elapsed video time ratio', category: 'retention' },
  { value: 'audienceType', label: 'Audience type (organic/paid)', category: 'audience' },
]

/**
 * Build query params for YouTube Analytics reports.query.
 */
function buildAnalyticsQuery({ ids, startDate, endDate, metrics, dimensions, filters, sort, maxResults, currency, includeHistoricalChannelData }) {
  let metricsList = metrics

  if (typeof metrics === 'string') {
    metricsList = metrics.split(',').map(s => s.trim()).filter(Boolean)
  } else if (!Array.isArray(metrics) || !metrics.length) {
    metricsList = METRIC_PRESETS.overview
  }

  let dimensionsList = dimensions

  if (typeof dimensions === 'string') {
    dimensionsList = dimensions.split(',').map(s => s.trim()).filter(Boolean)
  }

  return cleanupObject({
    ids: ids || 'channel==MINE',
    startDate: startDate ? ensureDate(startDate) : undefined,
    endDate: endDate ? ensureDate(endDate) : undefined,
    metrics: metricsList.join(','),
    dimensions: Array.isArray(dimensionsList) && dimensionsList.length ? dimensionsList.join(',') : undefined,
    filters: filters || undefined,
    sort: sort || undefined,
    maxResults: maxResults || undefined,
    currency: currency || undefined,
    includeHistoricalChannelData: includeHistoricalChannelData ? 'true' : undefined,
  })
}

function buildVideoFilter(videoIds) {
  if (!videoIds) return undefined

  const ids = Array.isArray(videoIds)
    ? videoIds
    : videoIds.split(',').map(s => s.trim()).filter(Boolean)

  return ids.length ? `video==${ ids.join(',') }` : undefined
}

function buildPlaylistFilter(playlistIds) {
  if (!playlistIds) return undefined

  const ids = Array.isArray(playlistIds)
    ? playlistIds
    : playlistIds.split(',').map(s => s.trim()).filter(Boolean)

  return ids.length ? `playlist==${ ids.join(',') }` : undefined
}

function combineFilters(...parts) {
  return parts.filter(Boolean).join(';') || undefined
}

/**
 * Convert YouTube Analytics columnar response {columnHeaders, rows} into
 * an array of objects keyed by column name. AI-friendly shape.
 */
function flattenReport(response) {
  if (!response?.columnHeaders || !Array.isArray(response.rows)) return response

  const headers = response.columnHeaders.map(h => h.name)

  return response.rows.map(row => {
    const obj = {}

    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = row[i]
    }

    return obj
  })
}

module.exports = {
  METRIC_PRESETS,
  METRICS_CATALOG,
  DIMENSIONS_CATALOG,
  buildAnalyticsQuery,
  buildVideoFilter,
  buildPlaylistFilter,
  combineFilters,
  flattenReport,
}
