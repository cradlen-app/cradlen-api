import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { StorageService } from '@infrastructure/storage/storage.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientInvestigationsService } from './patient-investigations.service.js';

describe('PatientInvestigationsService', () => {
  let service: PatientInvestigationsService;
  let findMany: jest.Mock;
  let count: jest.Mock;
  let createPresignedDownloadUrl: jest.Mock;

  const guardianCtx: PatientAuthContext = {
    userId: 'u1',
    guardianId: 'g1',
    accessiblePatientIds: ['p1', 'p2'],
  };

  const baseRow = {
    id: 'i1',
    visit_id: 'v1',
    custom_test_name: null,
    test_category: 'LAB',
    notes: 'Fast for 8 hours',
    status: 'REVIEWED',
    result_source: 'CLINIC',
    result_text: 'Hb 12.1',
    result_attachments: [
      {
        id: 'att-1',
        object_key: 'investigations/i1/results/abc.pdf',
        content_type: 'application/pdf',
        created_at: new Date('2026-02-01T10:00:00Z'),
        source: 'CLINIC',
      },
    ],
    reviewed_at: new Date('2026-02-01T10:00:00Z'),
    ordered_at: new Date('2026-01-30T09:00:00Z'),
    lab_test: { name: 'CBC' },
    ordered_by: { user: { first_name: 'Aya', last_name: 'Hassan' } },
    reviewed_by: { user: { first_name: 'Omar', last_name: 'Saleh' } },
    visit: {
      id: 'v1',
      scheduled_at: new Date('2026-01-30T08:00:00Z'),
      branch: { name: 'Main Branch' },
      episode: { journey: { organization: { name: 'Jasmin Clinic' } } },
    },
  };

  beforeEach(() => {
    findMany = jest.fn().mockReturnValue([]);
    count = jest.fn().mockReturnValue(0);
    createPresignedDownloadUrl = jest
      .fn()
      .mockImplementation((key: string) => Promise.resolve(`signed:${key}`));
    const prisma = {
      db: {
        visitInvestigation: { findMany, count },
        $transaction: (ops: unknown[]) => Promise.all(ops),
      },
    } as unknown as PrismaService;
    const storage = {
      createPresignedDownloadUrl,
    } as unknown as StorageService;
    service = new PatientInvestigationsService(prisma, storage);
  });

  it('throws 404 when a guardian targets an un-linked patient', async () => {
    await expect(
      service.listInvestigations(guardianCtx, {
        patient_id: 'p9',
        page: 1,
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns an empty page without querying when no accessible patients', async () => {
    const result = await service.listInvestigations(
      { userId: 'u1', accessiblePatientIds: [] },
      { page: 1, limit: 10 },
    );
    expect(findMany).not.toHaveBeenCalled();
    expect(result.items).toEqual([]);
    expect(result.meta).toMatchObject({ page: 1, limit: 10, total: 0 });
  });

  it('hides cancelled orders by default and scopes to accessible patients, newest first', async () => {
    await service.listInvestigations(guardianCtx, { page: 2, limit: 10 });

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.where).toMatchObject({
      is_deleted: false,
      status: { not: 'CANCELLED' },
      visit: {
        is_deleted: false,
        episode: { journey: { patient_id: { in: ['p1', 'p2'] } } },
      },
    });
    expect(arg.orderBy).toEqual({ ordered_at: 'desc' });
    expect(arg.skip).toBe(10);
    expect(arg.take).toBe(10);
  });

  it('composes status and type filters into the where', async () => {
    await service.listInvestigations(guardianCtx, {
      page: 1,
      limit: 10,
      status: 'CANCELLED',
      type: 'IMAGING',
    });

    const arg = findMany.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.where).toMatchObject({
      status: 'CANCELLED',
      test_category: 'IMAGING',
    });
  });

  it('exposes a presigned result url and the reviewing doctor for a REVIEWED row', async () => {
    findMany.mockReturnValue([baseRow]);
    count.mockReturnValue(1);

    const result = await service.listInvestigations(
      { userId: 'u1', patientId: 'p1', accessiblePatientIds: ['p1'] },
      { page: 1, limit: 10 },
    );

    expect(result.meta).toMatchObject({ page: 1, limit: 10, total: 1 });
    expect(result.items[0]).toMatchObject({
      id: 'i1',
      test_name: 'CBC',
      type: 'LAB',
      status: 'REVIEWED',
      reviewed_by_name: 'Dr. Omar Saleh',
      result_text: 'Hb 12.1',
    });
    expect(result.items[0].result_attachments[0].url).toBe(
      'signed:investigations/i1/results/abc.pdf',
    );
    expect(createPresignedDownloadUrl).toHaveBeenCalledWith(
      'investigations/i1/results/abc.pdf',
    );
  });

  it('withholds a CLINIC result (text + files) until REVIEWED', async () => {
    findMany.mockReturnValue([
      { ...baseRow, status: 'RESULTED', result_source: 'CLINIC' },
    ]);
    count.mockReturnValue(1);

    const result = await service.listInvestigations(
      { userId: 'u1', patientId: 'p1', accessiblePatientIds: ['p1'] },
      { page: 1, limit: 10 },
    );

    expect(result.items[0]).toMatchObject({
      status: 'RESULTED',
      result_text: null,
      reviewed_by_name: null,
    });
    expect(result.items[0].result_attachments).toEqual([]);
    expect(createPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('shows a PATIENT-uploaded result file even before review', async () => {
    findMany.mockReturnValue([
      {
        ...baseRow,
        status: 'RESULTED',
        result_source: 'PATIENT',
        result_attachments: [
          {
            id: 'att-1',
            object_key: 'investigations/i1/results/abc.pdf',
            content_type: 'application/pdf',
            created_at: new Date('2026-02-01T10:00:00Z'),
            source: 'PATIENT',
          },
        ],
      },
    ]);
    count.mockReturnValue(1);

    const result = await service.listInvestigations(
      { userId: 'u1', patientId: 'p1', accessiblePatientIds: ['p1'] },
      { page: 1, limit: 10 },
    );

    expect(result.items[0].result_attachments[0].url).toBe(
      'signed:investigations/i1/results/abc.pdf',
    );
  });

  it('falls back to custom_test_name when there is no catalog lab test', async () => {
    findMany.mockReturnValue([
      { ...baseRow, lab_test: null, custom_test_name: 'External MRI' },
    ]);
    count.mockReturnValue(1);

    const result = await service.listInvestigations(
      { userId: 'u1', patientId: 'p1', accessiblePatientIds: ['p1'] },
      { page: 1, limit: 10 },
    );

    expect(result.items[0].test_name).toBe('External MRI');
  });
});
