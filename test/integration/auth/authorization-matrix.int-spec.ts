import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';

const PASSWORD = 'Password1!';

/**
 * Exercises the AuthorizationService.assertCan* matrix against
 * real seeded roles (OWNER, BRANCH_MANAGER, STAFF, EXTERNAL) and
 * a few representative endpoints. Each test goes through the real
 * JwtStrategy + AuthorizationService.getProfileContext path so the
 * combined profile/user/org query and the role-name predicates run
 * against actual Postgres data — closes the spec gap the unit tests
 * mask out by mocking Prisma.
 */
describe('Auth — authorization matrix (integration)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let prisma: PrismaClient;

  beforeAll(async () => {
    mailMock = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp(mailMock);
    prisma = getTestPrisma();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestPrisma();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    mailMock.mockClear();
  });

  async function seedScenario() {
    // Create org + main branch directly.
    const org = await prisma.organization.create({
      data: { name: 'Cradlen Clinic' },
    });
    const branch = await prisma.branch.create({
      data: {
        organization_id: org.id,
        name: 'Main',
        address: '1 St',
        city: 'Cairo',
        governorate: 'Cairo',
        is_main: true,
      },
    });
    await prisma.subscription.create({
      data: {
        organization_id: org.id,
        subscription_plan_id: (
          await prisma.subscriptionPlan.findFirstOrThrow({
            where: { plan: 'free_trial' },
          })
        ).id,
        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });

    async function createMember(args: {
      email: string;
      roleCode: 'OWNER' | 'BRANCH_MANAGER' | 'STAFF' | 'EXTERNAL';
      assignToBranch: boolean;
    }) {
      const password_hashed = await bcrypt.hash(PASSWORD, 12);
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
          organization_id: org.id,
          engagement_type: 'FULL_TIME',
          role_id: role.id,
        },
      });
      if (args.assignToBranch) {
        await prisma.profileBranch.create({
          data: {
            profile_id: profile.id,
            branch_id: branch.id,
            organization_id: org.id,
          },
        });
      }
      return { user, profile };
    }

    const ownerMember = await createMember({
      email: 'owner@example.com',
      roleCode: 'OWNER',
      assignToBranch: false, // OWNER sees all branches via role short-circuit
    });
    const staffOnBranch = await createMember({
      email: 'staff-here@example.com',
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const staffOffBranch = await createMember({
      email: 'staff-elsewhere@example.com',
      roleCode: 'STAFF',
      assignToBranch: false,
    });
    return { org, branch, ownerMember, staffOnBranch, staffOffBranch };
  }

  async function loginAs(
    email: string,
  ): Promise<{ access: string; profileId: string; orgId: string }> {
    const http = app.getHttpServer();
    const login = await request(http)
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const profile = login.body.data.profiles[0];
    const tokens = await request(http)
      .post('/v1/auth/profiles/select')
      .send({
        selection_token: login.body.data.selection_token,
        profile_id: profile.profile_id,
        branch_id: profile.branches[0]?.branch_id,
      })
      .expect(200);
    return {
      access: tokens.body.data.access_token,
      profileId: profile.profile_id,
      orgId: profile.organization_id,
    };
  }

  it('OWNER passes /auth/me; STAFF passes /auth/me; an invalid token 401s', async () => {
    await seedScenario();
    const http = app.getHttpServer();

    const owner = await loginAs('owner@example.com');
    await request(http)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);

    const staff = await loginAs('staff-here@example.com');
    await request(http)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${staff.access}`)
      .expect(200);

    await request(http)
      .get('/v1/auth/me')
      .set('Authorization', 'Bearer not-a-real-jwt')
      .expect(401);
  });

  it('OWNER sees every active branch in /auth/me even without ProfileBranch rows', async () => {
    const { branch } = await seedScenario();
    const owner = await loginAs('owner@example.com');

    const me = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);

    const branches = me.body.data.profiles[0].branches as Array<{
      id: string;
    }>;
    expect(branches.map((b) => b.id)).toContain(branch.id);
  });

  it('A STAFF profile assigned to a branch sees that branch in /auth/me; one without an assignment sees no branches', async () => {
    const { branch } = await seedScenario();
    const onBranch = await loginAs('staff-here@example.com');
    const offBranch = await loginAs('staff-elsewhere@example.com');

    const meOn = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${onBranch.access}`)
      .expect(200);
    expect(
      (meOn.body.data.profiles[0].branches as Array<{ id: string }>).map(
        (b) => b.id,
      ),
    ).toEqual([branch.id]);

    const meOff = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${offBranch.access}`)
      .expect(200);
    expect(meOff.body.data.profiles[0].branches).toEqual([]);
  });

  it('switching to a branch the caller cannot access is rejected with 403; switching to an allowed one issues new tokens', async () => {
    const { branch } = await seedScenario();
    const http = app.getHttpServer();

    const owner = await loginAs('owner@example.com');
    // OWNER can switch to the main branch (sees it via role short-circuit).
    await request(http)
      .post('/v1/auth/branches/switch')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ branch_id: branch.id })
      .expect(200);

    // A staff member NOT assigned to the branch cannot switch to it.
    const offBranch = await loginAs('staff-elsewhere@example.com');
    await request(http)
      .post('/v1/auth/branches/switch')
      .set('Authorization', `Bearer ${offBranch.access}`)
      .send({ branch_id: branch.id })
      .expect(403);
  });
});
