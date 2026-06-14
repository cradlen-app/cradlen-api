import { NotFoundException } from '@nestjs/common';
import { PrescriptionsService } from './prescriptions.service.js';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

function createEnv() {
  const prescriptionFindFirst = jest.fn();
  const templateFindMany = jest.fn();
  const prisma = {
    db: {
      prescription: { findFirst: prescriptionFindFirst },
      prescriptionTemplate: { findMany: templateFindMany },
    },
  } as unknown as PrismaService;
  const assertCanAccessBranch = jest.fn().mockResolvedValue(undefined);
  const authorization = {
    assertCanAccessBranch,
  } as unknown as AuthorizationService;
  const service = new PrescriptionsService(prisma, authorization);
  return {
    service,
    prescriptionFindFirst,
    templateFindMany,
    assertCanAccessBranch,
  };
}

const user: AuthContext = {
  userId: 'u1',
  profileId: 'profile-1',
  organizationId: 'org-1',
  roles: ['OWNER'],
  jobFunctions: [],
  branchIds: ['branch-1'],
};

function makePrescription() {
  return {
    id: 'rx-1',
    prescribed_by_id: 'doctor-1',
    prescribed_at: new Date('2026-06-14T08:00:00.000Z'),
    notes: 'Take with food',
    items: [
      {
        order: 1,
        custom_drug_name: null,
        dose: '1 tab',
        route: 'oral',
        frequency: 'every 24h',
        duration: '1 month',
        instructions: 'after meals',
        medication: {
          name: 'Folic acid',
          generic_name: 'folic acid',
          strength: '5 mg',
          form: 'tablet',
        },
      },
      {
        order: 2,
        custom_drug_name: 'Some Syrup',
        dose: '5 ml',
        route: 'oral',
        frequency: 'twice daily',
        duration: null,
        instructions: null,
        medication: null,
      },
    ],
    prescribed_by: {
      id: 'doctor-1',
      user: { first_name: 'Sara', last_name: 'Hassan' },
      specialty_links: [{ specialty: { name: 'Obstetrics & Gynecology' } }],
    },
    visit: {
      branch_id: 'branch-1',
      specialty_code: 'OBGYN',
      encounter: {
        chief_complaint: 'Headache',
        provisional_diagnosis: 'Tension headache',
      },
      episode: {
        journey: {
          patient: {
            id: 'patient-1',
            full_name: 'Mona Ali',
            phone_number: '0100',
            date_of_birth: new Date('1995-02-01T00:00:00.000Z'),
          },
        },
      },
      branch: {
        id: 'branch-1',
        name: 'Cradlen Maadi',
        address: '1 Street',
        city: 'Cairo',
        governorate: 'Cairo',
        country: 'Egypt',
        organization: {
          id: 'org-1',
          name: 'Jasmin Clinic',
          logo_object_key: 'k',
        },
      },
    },
  };
}

describe('PrescriptionsService', () => {
  it('throws 404 when the visit has no prescription', async () => {
    const { service, prescriptionFindFirst, assertCanAccessBranch } =
      createEnv();
    prescriptionFindFirst.mockResolvedValue(null);

    await expect(service.print('visit-1', user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(assertCanAccessBranch).not.toHaveBeenCalled();
  });

  it('authorizes the branch and maps the document aggregate', async () => {
    const {
      service,
      prescriptionFindFirst,
      templateFindMany,
      assertCanAccessBranch,
    } = createEnv();
    prescriptionFindFirst.mockResolvedValue(makePrescription());
    templateFindMany.mockResolvedValue([
      {
        id: 'sys',
        name: 'System Default',
        layout: { blocks: [] },
        is_system: true,
      },
    ]);

    const { document } = await service.print('visit-1', user);

    expect(assertCanAccessBranch).toHaveBeenCalledWith(
      'profile-1',
      'org-1',
      'branch-1',
    );
    expect(document.doctor).toMatchObject({
      name: 'Dr. Sara Hassan',
      specialty: 'Obstetrics & Gynecology',
    });
    expect(document.organization.name).toBe('Jasmin Clinic');
    expect(document.patient.full_name).toBe('Mona Ali');
    expect(document.items).toHaveLength(2);
    expect(document.items[0]).toMatchObject({
      name: 'Folic acid',
      dose: '1 tab',
    });
    // Falls back to custom_drug_name when not a catalog drug.
    expect(document.items[1].name).toBe('Some Syrup');
  });

  it('resolves the most-specific template (profile beats system default)', async () => {
    const { service, prescriptionFindFirst, templateFindMany } = createEnv();
    prescriptionFindFirst.mockResolvedValue(makePrescription());
    templateFindMany.mockResolvedValue([
      {
        id: 'sys',
        name: 'System Default',
        organization_id: null,
        branch_id: null,
        profile_id: null,
        layout: { blocks: [] },
        is_system: true,
      },
      {
        id: 'doc',
        name: 'My Paper',
        organization_id: 'org-1',
        branch_id: 'branch-1',
        profile_id: 'doctor-1',
        layout: { blocks: [{ type: 'header' }] },
        is_system: false,
      },
    ]);

    const { template } = await service.print('visit-1', user);
    expect(template.id).toBe('doc');
    expect(template.name).toBe('My Paper');
  });

  it('falls back to the built-in default layout when no template row exists', async () => {
    const { service, prescriptionFindFirst, templateFindMany } = createEnv();
    prescriptionFindFirst.mockResolvedValue(makePrescription());
    templateFindMany.mockResolvedValue([]);

    const { template } = await service.print('visit-1', user);
    expect(template.id).toBe('system-default');
    expect(template.layout.blocks.length).toBeGreaterThan(0);
  });
});
