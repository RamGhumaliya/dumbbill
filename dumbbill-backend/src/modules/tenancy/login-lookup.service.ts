import { Injectable } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** The few facts the sign-in process needs about an account, found by email alone. */
export interface LoginRecord {
  userId: string;
  tenantId: string;
  email: string;
  /** Stored password hash; null for an invited person who has not chosen a password yet. */
  passwordHash: string | null;
  fullName: string;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  /** True when this account uses an authenticator app. */
  totpEnabled: boolean;
}

/** Shape of one row returned by the database function. */
interface LoginRow {
  user_id: string;
  tenant_id: string;
  email: string;
  password_hash: string | null;
  full_name: string;
  status: UserStatus;
  email_verified_at: Date | null;
  totp_enabled: boolean;
}

/**
 * Finds an account by email BEFORE we know which business it belongs to.
 *
 * Signing in has a chicken-and-egg problem: the database hides every row until it is told the business, but
 * the email is the only thing a person types, and the business is exactly what we must discover. The answer
 * is ONE narrow database function (`find_login_by_email`, see migration auth_foundation and ADR 002 section 3):
 * it takes one exact email and returns only the handful of columns login needs. It cannot list accounts, and
 * it never returns tokens or authenticator secrets. The app role is not given any general cross-business read.
 *
 * It lives in the tenancy module because that is one of the few places allowed to use the raw database client.
 */
@Injectable()
export class LoginLookup {
  constructor(private readonly prisma: PrismaService) {}

  /** The account with this email, or null. Emails are compared in lower case. */
  async findByEmail(email: string): Promise<LoginRecord | null> {
    const rows = await this.prisma.$queryRaw<
      LoginRow[]
    >`SELECT * FROM find_login_by_email(${email})`;
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      tenantId: row.tenant_id,
      email: row.email,
      passwordHash: row.password_hash,
      fullName: row.full_name,
      status: row.status,
      emailVerifiedAt: row.email_verified_at,
      totpEnabled: row.totp_enabled,
    };
  }
}
