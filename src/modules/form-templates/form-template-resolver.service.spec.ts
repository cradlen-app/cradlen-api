import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FormTemplateResolverService } from './form-template-resolver.service';
import { PrismaService } from '../../database/prisma.service';

type Scope = 'SYSTEM' | 'ORGANIZATION';

type TemplateRow = {
  scope: Scope;
  specialty_id: string;
  organization_id: string | null;
  versions: Array<{ id: string; version_number: number; status: string }>;
};

describe('FormTemplateResolverService', () => {
  const ORG = 'org-1';
  const PROFILE = 'profile-1';
  const PARENT_SPECIALTY = 'parent-spec';
  const CHILD_SPECIALTY = 'child-spec';

  const buildResolver = (
    templates: TemplateRow[],
    specialty: { id: string; parent_specialty_id: string | null } | null,
  ) => {
    const db = {
      specialty: {
        findUnique: jest.fn().mockResolvedValue(specialty),
      },
      profileSpecialty: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ specialty_id: specialty?.id ?? null }),
      },
      formTemplate: {
        findFirst: jest.fn(({ where }: { where: TemplateRow }) => {
          const match = templates.find(
            (t) =>
              t.scope === where.scope &&
              t.specialty_id === where.specialty_id &&
              t.organization_id === where.organization_id,
          );
          if (!match) return null;
          return {
            id: 't',
            versions: match.versions
              .filter((v) => v.status === 'PUBLISHED')
              .sort((a, b) => b.version_number - a.version_number)
              .slice(0, 1),
          };
        }),
      },
    };
    return Test.createTestingModule({
      providers: [
        FormTemplateResolverService,
        { provide: PrismaService, useValue: { db } },
      ],
    })
      .compile()
      .then((m: TestingModule) => m.get(FormTemplateResolverService));
  };

  it('prefers ORG template for child specialty when available', async () => {
    const resolver = await buildResolver(
      [
        {
          scope: 'ORGANIZATION',
          specialty_id: CHILD_SPECIALTY,
          organization_id: ORG,
          versions: [
            { id: 'org-child-v1', version_number: 1, status: 'PUBLISHED' },
          ],
        },
        {
          scope: 'SYSTEM',
          specialty_id: CHILD_SPECIALTY,
          organization_id: null,
          versions: [
            { id: 'sys-child-v1', version_number: 1, status: 'PUBLISHED' },
          ],
        },
      ],
      { id: CHILD_SPECIALTY, parent_specialty_id: PARENT_SPECIALTY },
    );
    const v = await resolver.resolveForEncounter({
      profileId: PROFILE,
      organizationId: ORG,
      specialtyId: CHILD_SPECIALTY,
    });
    expect(v.id).toBe('org-child-v1');
  });

  it('falls back to ORG parent template when child has none', async () => {
    const resolver = await buildResolver(
      [
        {
          scope: 'ORGANIZATION',
          specialty_id: PARENT_SPECIALTY,
          organization_id: ORG,
          versions: [
            { id: 'org-parent-v1', version_number: 1, status: 'PUBLISHED' },
          ],
        },
        {
          scope: 'SYSTEM',
          specialty_id: CHILD_SPECIALTY,
          organization_id: null,
          versions: [
            { id: 'sys-child-v1', version_number: 1, status: 'PUBLISHED' },
          ],
        },
      ],
      { id: CHILD_SPECIALTY, parent_specialty_id: PARENT_SPECIALTY },
    );
    const v = await resolver.resolveForEncounter({
      profileId: PROFILE,
      organizationId: ORG,
      specialtyId: CHILD_SPECIALTY,
    });
    expect(v.id).toBe('org-parent-v1');
  });

  it('falls back to SYSTEM child template when no ORG template exists', async () => {
    const resolver = await buildResolver(
      [
        {
          scope: 'SYSTEM',
          specialty_id: CHILD_SPECIALTY,
          organization_id: null,
          versions: [
            { id: 'sys-child-v1', version_number: 1, status: 'PUBLISHED' },
          ],
        },
        {
          scope: 'SYSTEM',
          specialty_id: PARENT_SPECIALTY,
          organization_id: null,
          versions: [
            { id: 'sys-parent-v1', version_number: 1, status: 'PUBLISHED' },
          ],
        },
      ],
      { id: CHILD_SPECIALTY, parent_specialty_id: PARENT_SPECIALTY },
    );
    const v = await resolver.resolveForEncounter({
      profileId: PROFILE,
      organizationId: ORG,
      specialtyId: CHILD_SPECIALTY,
    });
    expect(v.id).toBe('sys-child-v1');
  });

  it('falls back all the way to SYSTEM parent template', async () => {
    const resolver = await buildResolver(
      [
        {
          scope: 'SYSTEM',
          specialty_id: PARENT_SPECIALTY,
          organization_id: null,
          versions: [
            { id: 'sys-parent-v1', version_number: 1, status: 'PUBLISHED' },
          ],
        },
      ],
      { id: CHILD_SPECIALTY, parent_specialty_id: PARENT_SPECIALTY },
    );
    const v = await resolver.resolveForEncounter({
      profileId: PROFILE,
      organizationId: ORG,
      specialtyId: CHILD_SPECIALTY,
    });
    expect(v.id).toBe('sys-parent-v1');
  });

  it('throws NotFoundException when nothing matches', async () => {
    const resolver = await buildResolver([], {
      id: CHILD_SPECIALTY,
      parent_specialty_id: null,
    });
    await expect(
      resolver.resolveForEncounter({
        profileId: PROFILE,
        organizationId: ORG,
        specialtyId: CHILD_SPECIALTY,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
