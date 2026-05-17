export interface PrivacyOwner {
  userId?: string;
  sessionId?: string;
}

export interface PrivacyServiceContext {
  owner: PrivacyOwner;
  ip?: string;
  userAgent?: string;
}
