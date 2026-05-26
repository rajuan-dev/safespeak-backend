import type { Request } from 'express';
import passport from 'passport';
import {
  Strategy as GoogleStrategy,
  type Profile,
  type VerifyCallback
} from 'passport-google-oauth20';

import { env } from '@config/env';
import type { AuthData } from './auth.types';
import { loginWithGoogleProfile } from './auth.service';

export type GooglePassportUser = Express.User & {
  authData: AuthData;
};

let isConfigured = false;

const googleCallbackPath = '/api/auth/google/callback';

export const getGoogleOAuthMissingConfig = (): string[] => {
  const missingConfig: string[] = [];

  if (!env.GOOGLE_CLIENT_ID) {
    missingConfig.push('GOOGLE_CLIENT_ID');
  }

  if (!env.GOOGLE_CLIENT_SECRET) {
    missingConfig.push('GOOGLE_CLIENT_SECRET');
  }

  return missingConfig;
};

export const getGoogleCallbackUrl = (): string =>
  env.GOOGLE_CALLBACK_URL ?? googleCallbackPath;

export const isGoogleOAuthConfigured = (): boolean =>
  getGoogleOAuthMissingConfig().length === 0;

const getPrimaryEmail = (profile: Profile): string | undefined => {
  const verifiedEmail = profile.emails?.find((email) => email.verified)?.value;

  return verifiedEmail ?? profile.emails?.[0]?.value;
};

export const configurePassport = (): void => {
  if (isConfigured || !isGoogleOAuthConfigured()) {
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID ?? '',
        clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
        callbackURL: getGoogleCallbackUrl(),
        proxy: true,
        passReqToCallback: true
      },
      (
        req: Request,
        _accessToken: string,
        _refreshToken: string,
        profile: Profile,
        done: VerifyCallback
      ) => {
        void (async () => {
          try {
            const email = getPrimaryEmail(profile);

            if (!email) {
              done(new Error('Google account did not provide an email address'));
              return;
            }

            const authData = await loginWithGoogleProfile(
              {
                googleId: profile.id,
                email,
                fullName: profile.displayName || email.split('@')[0] || 'SafeSpeak User',
                avatarUrl: profile.photos?.[0]?.value
              },
              req.ip,
              req.get('user-agent')
            );
            const user: GooglePassportUser = {
              id: authData.user.id,
              email: authData.user.email,
              fullName: authData.user.fullName,
              role: authData.user.role,
              status: authData.user.status,
              authData
            };

            done(null, user);
          } catch (error) {
            done(error instanceof Error ? error : new Error('Google OAuth failed'));
          }
        })();
      }
    )
  );

  isConfigured = true;
};
