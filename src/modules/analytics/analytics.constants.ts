export const ANALYTICS_ACTIONS = {
  overview: 'analytics.overview',
  heatmap: 'analytics.heatmap',
  trends: 'analytics.trends',
  categories: 'analytics.categories',
  languages: 'analytics.languages',
  export: 'analytics.export'
} as const;

export const ANALYTICS_EXPORT_FORMATS = ['json', 'csv'] as const;
