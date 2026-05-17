export const ANALYTICS_ACTIONS = {
  overview: 'analytics.overview',
  heatmap: 'analytics.heatmap',
  trends: 'analytics.trends',
  categories: 'analytics.categories',
  languages: 'analytics.languages',
  export: 'analytics.export',
  publicLocalIntelligence: 'analytics.public.local_intelligence'
} as const;

export const ANALYTICS_EXPORT_FORMATS = ['json', 'csv'] as const;

export const LOCAL_INTELLIGENCE_TIMEFRAMES = ['30d', '90d', '12m', 'all'] as const;
