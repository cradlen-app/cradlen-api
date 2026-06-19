import {
  EngagementType,
  ExecutiveTitle,
  InvitationStatus,
} from '@prisma/client';
import type { InvitationFull, InvitationPreview } from './invitations.includes';
import {
  toInvitationPreviewResponse,
  toInvitationResponse,
} from './invitations.mapper';

const baseInvitation: InvitationFull = {
  id: 'inv-1',
  organization_id: 'org-1',
  invited_by_id: 'user-1',
  email: 'invitee@cradlen.com',
  first_name: 'Sara',
  last_name: 'Ahmed',
  phone_number: '+201111111111',
  executive_title: ExecutiveTitle.CMO,
  professional_title: 'استشاري النساء والتوليد',
  engagement_type: EngagementType.FULL_TIME,
  status: InvitationStatus.PENDING,
  token_hash: 'hash',
  expires_at: new Date('2099-01-01T00:00:00Z'),
  accepted_at: null,
  is_deleted: false,
  deleted_at: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
  invited_by: {
    id: 'user-1',
    first_name: 'Inviter',
    last_name: 'One',
    email: 'inviter@cradlen.com',
  },
  role_id: 'role-1',
  role: { id: 'role-1', name: 'STAFF', code: 'STAFF' },
  branches: [
    {
      invitation_id: 'inv-1',
      branch_id: 'branch-1',
      organization_id: 'org-1',
      branch: {
        id: 'branch-1',
        organization_id: 'org-1',
        name: 'Main',
        city: 'Cairo',
        governorate: 'Cairo',
        address: null,
        phone_number: null,
        is_main: true,
        is_deleted: false,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    },
  ],
  job_function_id: 'jf-1',
  job_function: { id: 'jf-1', code: 'NURSE', name: 'Nurse', is_clinical: true },
  specialty_id: 'spec-1',
  specialty: {
    id: 'spec-1',
    code: 'OBGYN',
    name: 'OB/GYN',
    is_deleted: false,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  },
  subspecialty_links: [
    {
      invitation_id: 'inv-1',
      subspecialty_id: 'sub-1',
      subspecialty: {
        id: 'sub-1',
        code: 'REI',
        name: 'Infertility',
        specialty_id: 'spec-1',
      },
    },
  ],
  // Cast assists structural typing for fields Prisma may add later that
  // aren't relevant to this mapper.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('toInvitationResponse', () => {
  it('maps the full invitation shape and omits working_schedule when not provided', () => {
    const out = toInvitationResponse(baseInvitation);
    expect(out.id).toBe('inv-1');
    expect(out.professional_title).toBe('استشاري النساء والتوليد');
    expect(out.invited_by).toEqual({
      id: 'user-1',
      first_name: 'Inviter',
      last_name: 'One',
      email: 'inviter@cradlen.com',
    });
    expect(out.role).toEqual({ id: 'role-1', name: 'STAFF' });
    expect(out.branches).toEqual([
      { id: 'branch-1', name: 'Main', city: 'Cairo', governorate: 'Cairo' },
    ]);
    expect(out.job_function).toEqual({
      id: 'jf-1',
      code: 'NURSE',
      name: 'Nurse',
    });
    expect(out.specialty).toEqual({
      id: 'spec-1',
      code: 'OBGYN',
      name: 'OB/GYN',
    });
    expect(out.subspecialties).toEqual([
      {
        id: 'sub-1',
        code: 'REI',
        name: 'Infertility',
        specialty_code: 'OBGYN',
      },
    ]);
    expect('working_schedule' in out).toBe(false);
  });

  it('includes working_schedule when an array is passed, converting minutes to HH:mm', () => {
    const workingScheduleRow = {
      branch: { id: 'branch-1', name: 'Main' },
      days: [
        {
          day_of_week: 'MONDAY',
          shifts: [{ start_minute: 540, end_minute: 1020 }],
        },
      ],
    } as unknown as Parameters<typeof toInvitationResponse>[1] extends
      | infer Arr
      | null
      | undefined
      ? Arr extends Array<infer Row>
        ? Row
        : never
      : never;
    const out = toInvitationResponse(baseInvitation, [workingScheduleRow]);
    expect(out.working_schedule).toEqual([
      {
        branch: { id: 'branch-1', name: 'Main' },
        days: [
          {
            day_of_week: 'MONDAY',
            shifts: [{ start_time: '09:00', end_time: '17:00' }],
          },
        ],
      },
    ]);
  });

  it('emits working_schedule: null when explicitly given null', () => {
    const out = toInvitationResponse(baseInvitation, null);
    expect(out.working_schedule).toBeNull();
  });
});

describe('toInvitationPreviewResponse', () => {
  it('maps the preview shape with the slim invited_by + organization shape', () => {
    const preview: InvitationPreview = {
      ...baseInvitation,
      invited_by: { first_name: 'Inviter', last_name: 'One' },
      organization: { id: 'org-1', name: 'Cradlen' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const out = toInvitationPreviewResponse(preview);
    expect(out.organization).toEqual({ id: 'org-1', name: 'Cradlen' });
    expect(out.invited_by).toEqual({ first_name: 'Inviter', last_name: 'One' });
    expect(out.role).toEqual({ id: 'role-1', name: 'STAFF' });
    expect(out.job_function).toEqual({
      id: 'jf-1',
      code: 'NURSE',
      name: 'Nurse',
    });
  });
});
