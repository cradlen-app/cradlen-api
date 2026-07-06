import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import { AdminAuditService } from '@core/platform-admin/audit/admin-audit.service.js';
import { ErasureService } from './erasure.service.js';

interface TxMock {
  patient: { findFirst: jest.Mock; update: jest.Mock };
  patientJourney: { updateMany: jest.Mock; count: jest.Mock };
  patientOrgEnrollment: { updateMany: jest.Mock; count: jest.Mock };
  patientConsent: { updateMany: jest.Mock };
  patientAccount: { updateMany: jest.Mock };
}

function makeTx(over: {
  patient?: Record<string, unknown> | null;
  journeyCount?: number;
  enrollmentCount?: number;
}): TxMock {
  return {
    patient: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          over.patient === undefined
            ? { id: 'pat-1', is_deleted: false, profile_image_object_key: null }
            : over.patient,
        ),
      update: jest.fn().mockResolvedValue({}),
    },
    patientJourney: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(over.journeyCount ?? 0),
    },
    patientOrgEnrollment: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(over.enrollmentCount ?? 0),
    },
    patientConsent: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    patientAccount: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
}

function makeService(tx: TxMock) {
  const record = jest.fn().mockResolvedValue(undefined);
  const deleteObject = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    db: { $transaction: (cb: (t: TxMock) => unknown) => cb(tx) },
  } as unknown as PrismaService;
  const audit = { record } as unknown as AdminAuditService;
  const storage = { deleteObject } as unknown as StorageService;
  return {
    service: new ErasureService(prisma, audit, storage),
    record,
    deleteObject,
  };
}

const DTO = { organization_id: 'org-1', reason: 'patient requested erasure' };

describe('ErasureService.anonymizePatient', () => {
  it('removes only the requesting org data when other orgs still hold the patient', async () => {
    const tx = makeTx({ journeyCount: 1 }); // another org still has a journey
    const { service, record } = makeService(tx);

    const res = await service.anonymizePatient('admin-1', 'pat-1', DTO);

    expect(tx.patientJourney.updateMany).toHaveBeenCalledWith({
      where: {
        patient_id: 'pat-1',
        organization_id: 'org-1',
        is_deleted: false,
      },
      data: expect.objectContaining({ is_deleted: true }),
    });
    // master identity NOT scrubbed
    expect(tx.patient.update).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      master_anonymized: false,
      other_orgs_remain: true,
    });
    const auditArg = record.mock.calls[0][0] as {
      after: Record<string, unknown>;
    };
    expect(auditArg.after).toMatchObject({ master_anonymized: false });
    // no raw identifiers in the audit
    expect(JSON.stringify(record.mock.calls[0][0])).not.toContain(
      'national_id',
    );
  });

  it('scrubs the master identity + account + avatar when it is the last org', async () => {
    const tx = makeTx({
      patient: {
        id: 'pat-1',
        is_deleted: false,
        profile_image_object_key: 'avatars/pat-1.jpg',
      },
      journeyCount: 0,
      enrollmentCount: 0,
    });
    const { service, deleteObject } = makeService(tx);

    const res = await service.anonymizePatient('admin-1', 'pat-1', DTO);

    expect(tx.patient.update).toHaveBeenCalledWith({
      where: { id: 'pat-1' },
      data: expect.objectContaining({
        national_id: 'ANON-pat-1',
        full_name: 'Redacted Patient',
        is_deleted: true,
        profile_image_object_key: null,
      }),
    });
    expect(tx.patientAccount.updateMany).toHaveBeenCalledWith({
      where: { patient_id: 'pat-1', is_deleted: false },
      data: expect.objectContaining({ is_active: false, is_deleted: true }),
    });
    expect(deleteObject).toHaveBeenCalledWith('avatars/pat-1.jpg');
    expect(res).toMatchObject({
      master_anonymized: true,
      other_orgs_remain: false,
    });
  });

  it('404s when the patient does not exist', async () => {
    const tx = makeTx({ patient: null });
    const { service } = makeService(tx);
    await expect(
      service.anonymizePatient('admin-1', 'missing', DTO),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
