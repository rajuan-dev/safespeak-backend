export interface AnalyticsActor {
  userId: string;
}

export interface AnalyticsServiceContext {
  actor: AnalyticsActor;
  ip?: string;
  userAgent?: string;
}
