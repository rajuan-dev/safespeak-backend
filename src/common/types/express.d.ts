import type { Logger } from 'pino';

import type { AuthData } from '@modules/auth/auth.types';
import type { UserRole, UserStatus } from '@modules/rbac/rbac.types';
import type { AuthenticatedSession } from '@modules/sessions/sessions.types';

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      fullName: string;
      role: UserRole;
      status: UserStatus;
      authData?: AuthData;
    }

    interface Request {
      requestId: string;
      log: Logger;
      user?: User;
      session?: AuthenticatedSession;
    }
  }
}

export {};
