import { env } from '@config/env';
import { logger } from '@common/utils/logger';
import { createAuditLog } from '@modules/audit/audit.service';
import { UserModel } from '@modules/auth/auth.model';
import { hashPassword, verifyPassword } from '@modules/auth/auth.utils';

export const seedDefaultSuperAdmin = async (): Promise<void> => {
  if (!env.ENABLE_ADMIN_SEED) {
    logger.info('Default super admin seed skipped');
    return;
  }

  const email = env.DEFAULT_SUPER_ADMIN_EMAIL?.toLowerCase();
  const password = env.DEFAULT_SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    logger.warn('Default super admin seed is enabled but credentials are not configured');
    return;
  }

  const existingAdmin = await UserModel.findOne({ email }).select('+passwordHash');

  if (existingAdmin) {
    const passwordMatches = await verifyPassword(password, existingAdmin.passwordHash);

    if (!passwordMatches) {
      existingAdmin.passwordHash = await hashPassword(password);
      existingAdmin.role = 'super_admin';
      existingAdmin.status = 'active';
      existingAdmin.isEmailVerified = true;
      existingAdmin.refreshTokenHash = undefined;
      await existingAdmin.save();

      logger.info({ email }, 'Default super admin password updated');
      return;
    }

    logger.info({ email }, 'Default super admin already exists');
    return;
  }

  const passwordHash = await hashPassword(password);
  const admin = await UserModel.create({
    email,
    fullName: env.DEFAULT_SUPER_ADMIN_FULL_NAME,
    passwordHash,
    role: 'super_admin',
    status: 'active',
    isEmailVerified: true
  });

  await createAuditLog({
    actorType: 'system',
    action: 'admin.seed_super_admin',
    resourceType: 'auth',
    resourceId: admin._id.toString(),
    metadata: {
      email,
      role: 'super_admin'
    }
  });

  logger.info({ email }, 'Default super admin created');
};
