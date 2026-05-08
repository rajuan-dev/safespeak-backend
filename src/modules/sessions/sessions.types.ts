import type { Types } from 'mongoose';

export interface AuthenticatedSession {
  id: string;
  userId?: string;
  isAnonymous: boolean;
  language: string;
  jurisdiction: string;
  lga?: string;
}

export interface SessionIdentity {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  isAnonymous: boolean;
  language: string;
  jurisdiction: string;
  lga?: string;
}
