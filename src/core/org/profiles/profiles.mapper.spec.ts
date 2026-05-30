import { EngagementType, ExecutiveTitle } from '@prisma/client';
import type { ProfileDetail, ProfileSummary } from './profiles.includes';
import { toProfileDetail, toProfileSummary } from './profiles.mapper';

const summary: ProfileSummary = {
  id: 'profile-1',
  organization: {
    id: 'org-1',
    name: 'Cradlen Clinic',
    status: 'ACTIVE',
    specialty_links: [
      {
        specialty: { id: 'spec-1', code: 'OBGYN', name: 'OB/GYN' },
      },
    ],
  },
  roles: [{ role: { code: 'OWNER' } }],
  branches: [
    {
      branch: {
        id: 'branch-1',
        name: 'Main',
        city: 'Cairo',
        governorate: 'Cairo',
        is_main: true,
      },
    },
  ],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const detail: ProfileDetail = {
  id: 'profile-1',
  executive_title: ExecutiveTitle.CMO,
  engagement_type: EngagementType.FULL_TIME,
  user: {
    first_name: 'Sara',
    last_name: 'Ahmed',
    email: 'sara@cradlen.com',
    phone_number: '+201111111111',
  },
  organization: { id: 'org-1', name: 'Cradlen Clinic' },
  roles: [{ role: { code: 'OWNER' } }, { role: { code: 'STAFF' } }],
  branches: [
    {
      branch: {
        id: 'branch-1',
        name: 'Main',
        city: 'Cairo',
        governorate: 'Cairo',
        is_main: true,
      },
    },
  ],
  job_functions: [
    {
      job_function: {
        id: 'jf-1',
        code: 'OBGYN',
        name: 'OB/GYN',
        is_clinical: true,
      },
    },
  ],
  specialty_links: [
    { specialty: { id: 'spec-1', code: 'OBGYN', name: 'OB/GYN' } },
  ],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('toProfileSummary', () => {
  it('flattens the cross-org list shape', () => {
    expect(toProfileSummary(summary)).toEqual({
      id: 'profile-1',
      organization: {
        id: 'org-1',
        name: 'Cradlen Clinic',
        status: 'ACTIVE',
        specialties: [{ id: 'spec-1', code: 'OBGYN', name: 'OB/GYN' }],
      },
      roles: ['OWNER'],
      branches: [
        {
          id: 'branch-1',
          name: 'Main',
          city: 'Cairo',
          governorate: 'Cairo',
          is_main: true,
        },
      ],
    });
  });

  it('emits empty arrays when join tables are empty', () => {
    const empty = {
      ...summary,
      roles: [],
      branches: [],
      organization: { ...summary.organization, specialty_links: [] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const out = toProfileSummary(empty);
    expect(out.roles).toEqual([]);
    expect(out.branches).toEqual([]);
    expect(out.organization.specialties).toEqual([]);
  });
});

describe('toProfileDetail', () => {
  it('maps User scalars, profile scalars, and all join tables', () => {
    const out = toProfileDetail(detail);
    expect(out).toEqual({
      id: 'profile-1',
      first_name: 'Sara',
      last_name: 'Ahmed',
      email: 'sara@cradlen.com',
      phone_number: '+201111111111',
      executive_title: ExecutiveTitle.CMO,
      engagement_type: EngagementType.FULL_TIME,
      roles: ['OWNER', 'STAFF'],
      organization: { id: 'org-1', name: 'Cradlen Clinic' },
      branches: [
        {
          id: 'branch-1',
          name: 'Main',
          city: 'Cairo',
          governorate: 'Cairo',
          is_main: true,
        },
      ],
      job_functions: [
        { id: 'jf-1', code: 'OBGYN', name: 'OB/GYN', is_clinical: true },
      ],
      specialties: [{ id: 'spec-1', code: 'OBGYN', name: 'OB/GYN' }],
    });
  });

  it('passes through nullable User fields', () => {
    const withNulls = {
      ...detail,
      user: { ...detail.user, email: null, phone_number: null },
      executive_title: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const out = toProfileDetail(withNulls);
    expect(out.email).toBeNull();
    expect(out.phone_number).toBeNull();
    expect(out.executive_title).toBeNull();
  });
});
