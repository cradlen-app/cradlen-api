import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Shared auth/authz integration helpers. Extracted from the bootstrap
 * boilerplate that the original auth specs re-implemented inline so the
 * security-focused suites (token-security, cross-tenant-authz,
 * privilege-escalation, otp-security, invitation-accept) stay readable.
 *
 * All flows go through the real HTTP layer (signup → verify → complete →
 * profiles/select) against a live Postgres, exactly like the existing specs.
 */

export const DEFAULT_PASSWORD = 'Password1!';

export type RoleCode = 'OWNER' | 'BRANCH_MANAGER' | 'STAFF' | 'EXTERNAL';

/** Curried Authorization-header injector — `auth(request(http).get(url))`. */
export function bearer(token: string): (req: request.Test) => request.Test {
  return (req: request.Test) => req.set('Authorization', `Bearer ${token}`);
}

/** The cleartext code/url passed to the mocked EmailService (2nd arg). */
export function otpFromMail(mail: jest.Mock, callIndex = 0): string {
  return mail.mock.calls[callIndex][1] as string;
}

export interface SignupOwnerOptions {
  email?: string;
  organizationName?: string;
  password?: string;
}

export interface SignupOwnerResult {
  accessToken: string;
  refreshToken: string;
  profileId: string;
  orgId: string;
  branchId: string;
  email: string;
  password: string;
}

/**
 * Full staff-owner bootstrap: signup/start → verify (OTP read from the mail
 * mock) → complete (org + main branch + OWNER profile) → profiles/select.
 * Returns the issued token pair plus the tenant ids. Uses a unique email per
 * call by default so the per-identifier signup throttle never collides.
 */
export async function signupOwner(
  app: INestApplication,
  mail: jest.Mock,
  opts: SignupOwnerOptions = {},
): Promise<SignupOwnerResult> {
  const http = app.getHttpServer();
  const password = opts.password ?? DEFAULT_PASSWORD;
  const email = opts.email ?? `owner-${randomUUID()}@example.com`;
  const organizationName = opts.organizationName ?? 'Cradlen Clinic';

  const callsBefore = mail.mock.calls.length;
  const start = await request(http)
    .post('/v1/auth/signup/start')
    .send({
      first_name: 'Sara',
      last_name: 'Ali',
      email,
      password,
      confirm_password: password,
    })
    .expect(201);
  const otp = mail.mock.calls[callsBefore][1] as string;

  const verified = await request(http)
    .post('/v1/auth/signup/verify')
    .send({ signup_token: start.body.data.signup_token, code: otp })
    .expect(200);

  const complete = await request(http)
    .post('/v1/auth/signup/complete')
    .send({
      signup_token: verified.body.data.signup_token,
      organization_name: organizationName,
      specialties: ['OBGYN'],
      branch_name: 'Main',
      branch_address: '1 St',
      branch_city: 'Cairo',
      branch_governorate: 'Cairo',
    })
    .expect(201);

  const profile = complete.body.data.profiles[0];
  const tokens = await request(http)
    .post('/v1/auth/profiles/select')
    .send({
      selection_token: complete.body.data.selection_token,
      profile_id: profile.profile_id,
      branch_id: profile.branches[0].branch_id,
    })
    .expect(200);

  return {
    accessToken: tokens.body.data.access_token as string,
    refreshToken: tokens.body.data.refresh_token as string,
    profileId: profile.profile_id as string,
    orgId: profile.organization_id as string,
    branchId: profile.branches[0].branch_id as string,
    email,
    password,
  };
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  profileId: string;
  orgId: string;
}

/**
 * login → profiles/select for an already-provisioned account, picking the
 * first profile and its first branch. For members with multiple branches,
 * pass `branchId` to pin the active branch.
 */
export async function loginAndSelect(
  app: INestApplication,
  email: string,
  password: string = DEFAULT_PASSWORD,
  branchId?: string,
): Promise<LoginResult> {
  const http = app.getHttpServer();
  const login = await request(http)
    .post('/v1/auth/login')
    .send({ email, password })
    .expect(200);

  const profile = login.body.data.profiles[0];
  const tokens = await request(http)
    .post('/v1/auth/profiles/select')
    .send({
      selection_token: login.body.data.selection_token,
      profile_id: profile.profile_id,
      branch_id: branchId ?? profile.branches[0]?.branch_id,
    })
    .expect(200);

  return {
    accessToken: tokens.body.data.access_token as string,
    refreshToken: tokens.body.data.refresh_token as string,
    profileId: profile.profile_id as string,
    orgId: profile.organization_id as string,
  };
}

export interface SeedMemberArgs {
  orgId: string;
  branchId: string;
  email: string;
  roleCode: RoleCode;
  assignToBranch: boolean;
  password?: string;
}

/**
 * Directly seed an additional org member (user + profile + role, optional
 * branch assignment) without the signup flow — for building multi-role and
 * multi-tenant authorization scenarios. The account can immediately
 * `loginAndSelect` with its password. Lifted from the original
 * authorization-matrix spec's `createMember`.
 */
export async function seedMember(
  prisma: PrismaClient,
  args: SeedMemberArgs,
): Promise<{ userId: string; profileId: string }> {
  const password_hashed = await bcrypt.hash(
    args.password ?? DEFAULT_PASSWORD,
    12,
  );
  const user = await prisma.user.create({
    data: {
      first_name: 'X',
      last_name: 'Y',
      email: args.email,
      password_hashed,
      is_active: true,
      verified_at: new Date(),
      registration_status: 'ACTIVE',
      onboarding_completed: true,
    },
  });
  const role = await prisma.role.findFirstOrThrow({
    where: { code: args.roleCode },
  });
  const profile = await prisma.profile.create({
    data: {
      user_id: user.id,
      organization_id: args.orgId,
      engagement_type: 'FULL_TIME',
      role_id: role.id,
    },
  });
  if (args.assignToBranch) {
    await prisma.profileBranch.create({
      data: {
        profile_id: profile.id,
        branch_id: args.branchId,
        organization_id: args.orgId,
      },
    });
  }
  return { userId: user.id, profileId: profile.id };
}

/** Resolve a seeded Role's UUID by its code (for invitation role_ids). */
export async function roleIdByCode(
  prisma: PrismaClient,
  code: RoleCode,
): Promise<string> {
  const role = await prisma.role.findFirstOrThrow({ where: { code } });
  return role.id;
}
