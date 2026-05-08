import type { Logger } from 'pino';

import type { UserRole, UserStatus } from '@modules/rbac/rbac.types';
import type { AuthenticatedSession } from '@modules/sessions/sessions.types';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: Logger;
      user?: {
        id: string;
        email: string;
        fullName: string;
        role: UserRole;
        status: UserStatus;
      };
      session?: AuthenticatedSession;
    }
  }
}

export {};
