import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { DEFAULT_PASSWORD } from './auth-helpers';

/**
 * Shared financial-RCM integration helpers: seed a patient, seed a branch
 * receptionist (STAFF role + RECEPTIONIST job function, so the billing gate
 * `assertIsReceptionistOrOwner` passes), capture+issue an invoice, and open a
 * cash drawer. Lifted from the inline boilerplate in financial-lifecycle.spec
 * so the focused gate/security suites stay readable.
 */

export interface SeededOrg {
  org: { id: string; name: string };
  branch: { id: string };
  ownerProfileId: string;
  ownerEmail: string;
}

/**
 * Seed an org + main branch + subscription + OWNER profile directly via Prisma
 * (no signup HTTP flow), so suites can stand up several tenants without
 * tripping the signup rate limiter. The owner logs in with DEFAULT_PASSWORD.
 */
export async function seedOrg(
  prisma: PrismaClient,
  name: string,
  ownerEmail: string,
): Promise<SeededOrg> {
  const org = await prisma.organization.create({ data: { name } });
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
  const user = await prisma.user.create({
    data: {
      first_name: 'Owner',
      last_name: name,
      email: ownerEmail,
      password_hashed: await bcrypt.hash(DEFAULT_PASSWORD, 12),
      is_active: true,
      verified_at: new Date(),
      registration_status: 'ACTIVE',
      onboarding_completed: true,
    },
  });
  const ownerRole = await prisma.role.findFirstOrThrow({
    where: { code: 'OWNER' },
  });
  const profile = await prisma.profile.create({
    data: {
      user_id: user.id,
      organization_id: org.id,
      engagement_type: 'FULL_TIME',
      roles: { create: [{ role_id: ownerRole.id }] },
    },
  });
  return { org, branch, ownerProfileId: profile.id, ownerEmail };
}

/** login → profiles/select for a seeded account; returns the access token. */
export async function loginAs(
  app: INestApplication,
  email: string,
): Promise<string> {
  const http = app.getHttpServer();
  const login = await request(http)
    .post('/v1/auth/login')
    .send({ email, password: DEFAULT_PASSWORD })
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
  return tokens.body.data.access_token as string;
}

/** Create a patient with an open journey so charges can attach. */
export async function createPatient(
  prisma: PrismaClient,
  organizationId: string,
  createdById: string,
): Promise<string> {
  const patient = await prisma.patient.create({
    data: {
      national_id: `nat-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      full_name: 'Jane Doe',
      date_of_birth: new Date('1990-01-01'),
      phone_number: '01000000000',
      address: '10 Nile St',
    },
  });
  const template = await prisma.journeyTemplate.findFirstOrThrow();
  await prisma.patientJourney.create({
    data: {
      patient_id: patient.id,
      organization_id: organizationId,
      journey_template_id: template.id,
      created_by_id: createdById,
    },
  });
  return patient.id;
}

/**
 * Seed a branch receptionist who can `loginAndSelect` with DEFAULT_PASSWORD and
 * pass the front-desk billing gate. Returns the new profile id.
 */
export async function seedReceptionist(
  prisma: PrismaClient,
  organizationId: string,
  branchId: string,
  email: string,
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      first_name: 'Recep',
      last_name: 'Tion',
      email,
      password_hashed: await bcrypt.hash(DEFAULT_PASSWORD, 12),
      is_active: true,
      verified_at: new Date(),
      registration_status: 'ACTIVE',
      onboarding_completed: true,
    },
  });
  const staffRole = await prisma.role.findFirstOrThrow({
    where: { code: 'STAFF' },
  });
  const receptionist = await prisma.jobFunction.findFirstOrThrow({
    where: { code: 'RECEPTIONIST' },
  });
  const profile = await prisma.profile.create({
    data: {
      user_id: user.id,
      organization_id: organizationId,
      engagement_type: 'FULL_TIME',
      roles: { create: [{ role_id: staffRole.id }] },
      job_functions: { create: [{ job_function_id: receptionist.id }] },
      branches: {
        create: [{ branch_id: branchId, organization_id: organizationId }],
      },
    },
  });
  return profile.id;
}

/** Capture a charge and assemble + issue an invoice for it. Returns ids. */
export async function chargeAndIssue(
  app: INestApplication,
  base: string,
  auth: (r: request.Test) => request.Test,
  branchId: string,
  patientId: string,
  profileId: string,
  opts: { unit_price: number; discount?: number } = { unit_price: 200 },
): Promise<{ invoiceId: string; serviceId: string; invoice: unknown }> {
  const http = app.getHttpServer();
  const svc = await auth(
    request(http).post(`${base}/financial/catalog/services`),
  )
    .send({
      code: `CONSULT-${Math.floor(Math.random() * 1e6)}`,
      name: 'Consultation',
      service_type: 'CONSULTATION',
    })
    .expect(201);
  await auth(request(http).post(`${base}/financial/charges`))
    .send({
      branch_id: branchId,
      patient_id: patientId,
      profile_id: profileId,
      service_id: svc.body.data.id,
      description: 'Consultation',
      quantity: 1,
      unit_price: opts.unit_price,
    })
    .expect(201);
  const inv = await auth(request(http).post(`${base}/invoices/from-charges`))
    .send({
      branch_id: branchId,
      patient_id: patientId,
      ...(opts.discount !== undefined && {
        discount_type: 'PERCENTAGE',
        discount_value: opts.discount,
      }),
    })
    .expect(201);
  const invoiceId = inv.body.data.id as string;
  await auth(
    request(http).post(`${base}/invoices/${invoiceId}/issue`),
  ).expect(201);
  return { invoiceId, serviceId: svc.body.data.id, invoice: inv.body.data };
}

/** Open the caller's cash drawer at a branch so payments can be recorded. */
export async function openDrawer(
  app: INestApplication,
  base: string,
  auth: (r: request.Test) => request.Test,
  branchId: string,
  openingFloat = 0,
): Promise<string> {
  const open = await auth(
    request(app.getHttpServer()).post(`${base}/financial/cash-sessions`),
  )
    .send({ branch_id: branchId, opening_float: openingFloat })
    .expect(201);
  return open.body.data.id as string;
}
