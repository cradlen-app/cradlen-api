import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { CLINICAL_EVENTS } from '@core/clinical/events/clinical-events';
import { AmendmentsService } from './amendments.service';
import { CreateAmendmentDto } from './dto/amendment.dto';

const VISIT = 'visit-1';
const ENCOUNTER_ID = 'enc-1';
const PATIENT = 'patient-1';
const ORG = 'org-A';
const DOCTOR = 'doctor-A';

/** Assigned doctor of the visit (STAFF role). */
const assignedDoctor: AuthContext = {
  userId: 'u-doc',
  profileId: DOCTOR,
  organizationId: ORG,
  role: 'STAFF',
  jobFunction: 'OBGYN',
  branchIds: ['b1'],
};

/** Org OWNER who is NOT the assigned doctor. */
const owner: AuthContext = {
  userId: 'u-owner',
  profileId: 'owner-X',
  organizationId: ORG,
  role: 'OWNER',
  jobFunction: 'OBGYN',
  branchIds: ['b1'],
};

/** STAFF who is neither the assigned doctor nor an owner. */
const stranger: AuthContext = {
  userId: 'u-str',
  profileId: 'stranger-Y',
  organizationId: ORG,
  role: 'STAFF',
  jobFunction: 'OBGYN',
  branchIds: ['b1'],
};

/** A user from a different organization. */
const crossOrg: AuthContext = {
  userId: 'u-other',
  profileId: 'other-Z',
  organizationId: 'org-B',
  role: 'OWNER',
  jobFunction: 'OBGYN',
  branchIds: ['b9'],
};

function visitRow(over: Record<string, unknown> = {}) {
  return {
    id: VISIT,
    status: 'COMPLETED',
    assigned_doctor_id: DOCTOR,
    episode: {
      journey: { organization_id: ORG, patient_id: PATIENT },
    },
    ...over,
  };
}

function encounterRow(over: Record<string, unknown> = {}) {
  return {
    id: ENCOUNTER_ID,
    visit_id: VISIT,
    version: 4,
    pelvic_findings: { note: 'original' },
    ...over,
  };
}

function dto(over: Partial<CreateAmendmentDto> = {}): CreateAmendmentDto {
  return {
    target: 'obgyn_encounter',
    section: 'pelvic_findings',
    changes: { note: 'corrected after review' },
    reason: 'correcting a transcription error',
    ...over,
  } as CreateAmendmentDto;
}

describe('AmendmentsService', () => {
  let service: AmendmentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let eventBus: { publish: jest.Mock };
  // tx handles asserted for atomicity
  let txRevisionCreate: jest.Mock;
  let txEncounterUpdate: jest.Mock;

  beforeEach(async () => {
    txRevisionCreate = jest.fn().mockResolvedValue({});
    txEncounterUpdate = jest.fn().mockResolvedValue({ version: 5 });
    const tx = {
      visitObgynEncounterRevision: { create: txRevisionCreate },
      visitObgynEncounter: { update: txEncounterUpdate },
    };

    db = {
      visit: { findFirst: jest.fn().mockResolvedValue(visitRow()) },
      visitObgynEncounter: {
        findUnique: jest.fn().mockResolvedValue(encounterRow()),
        // non-tx update — must NEVER be used (writes go through $transaction)
        update: jest.fn(),
      },
      $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    };
    eventBus = { publish: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AmendmentsService,
        { provide: PrismaService, useValue: { db } },
        { provide: EventBus, useValue: eventBus },
      ],
    }).compile();

    service = module.get(AmendmentsService);
  });

  describe('happy path', () => {
    it('amends a section for the assigned doctor: snapshots the prior version, bumps version, returns the audit DTO', async () => {
      const result = await service.createForVisit(
        VISIT,
        dto(),
        assignedDoctor,
        4,
      );

      // Revision shadow captures the PRE-change version + reason, in-tx.
      expect(txRevisionCreate).toHaveBeenCalledTimes(1);
      expect(txRevisionCreate).toHaveBeenCalledWith({
        data: {
          entity_id: ENCOUNTER_ID,
          version: 4, // snapshot version = live version BEFORE the change
          snapshot: encounterRow(),
          changed_fields: ['pelvic_findings'],
          revised_by_id: DOCTOR,
          revision_reason: 'correcting a transcription error',
        },
      });

      // Live row update: the section changes, version increments, author stamped.
      expect(txEncounterUpdate).toHaveBeenCalledWith({
        where: { id: ENCOUNTER_ID },
        data: {
          pelvic_findings: { note: 'corrected after review' },
          version: { increment: 1 },
          updated_by_id: DOCTOR,
        },
      });

      // Audit result echoes the version delta and metadata.
      expect(result).toMatchObject({
        target: 'obgyn_encounter',
        section: 'pelvic_findings',
        visit_id: VISIT,
        journey_id: null,
        episode_id: null,
        patient_id: PATIENT,
        version_from: 4,
        version_to: 5,
        amended_by_id: DOCTOR,
        reason: 'correcting a transcription error',
      });
      expect(result.amended_at).toBeInstanceOf(Date);
    });

    it('emits encounter.amended with the version delta', async () => {
      await service.createForVisit(VISIT, dto(), assignedDoctor, 4);

      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      expect(eventBus.publish).toHaveBeenCalledWith(
        CLINICAL_EVENTS.encounter.amended,
        expect.objectContaining({
          visit_id: VISIT,
          patient_id: PATIENT,
          target: 'obgyn_encounter',
          section: 'pelvic_findings',
          amended_by_id: DOCTOR,
          reason: 'correcting a transcription error',
          version_from: 4,
          version_to: 5,
        }),
      );
    });

    it('writes the revision and the update through the SAME transaction (never the non-tx client)', async () => {
      await service.createForVisit(VISIT, dto(), assignedDoctor, 4);

      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(txRevisionCreate).toHaveBeenCalledTimes(1);
      expect(txEncounterUpdate).toHaveBeenCalledTimes(1);
      // The non-transactional update path must not be touched.
      expect(db.visitObgynEncounter.update).not.toHaveBeenCalled();
    });
  });

  describe('authority', () => {
    it('allows an org OWNER who is not the assigned doctor', async () => {
      const result = await service.createForVisit(VISIT, dto(), owner, 4);

      expect(result.amended_by_id).toBe('owner-X');
      expect(txEncounterUpdate).toHaveBeenCalled();
    });

    it('rejects a non-assigned, non-owner with 403 and writes nothing', async () => {
      await expect(
        service.createForVisit(VISIT, dto(), stranger, 4),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(db.$transaction).not.toHaveBeenCalled();
      expect(txRevisionCreate).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });
  });

  describe('org scoping & existence', () => {
    it('treats a visit in another org as not-found (no cross-tenant amend)', async () => {
      // Even an OWNER of a different org cannot see/amend this visit.
      await expect(
        service.createForVisit(VISIT, dto(), crossOrg, 4),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('404s when the visit does not exist', async () => {
      db.visit.findFirst.mockResolvedValue(null);
      await expect(
        service.createForVisit(VISIT, dto(), assignedDoctor, 4),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('closed-visit precondition', () => {
    it.each(['SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS'])(
      'rejects amending a non-closed visit in status %s with 409',
      async (status) => {
        db.visit.findFirst.mockResolvedValue(visitRow({ status }));
        await expect(
          service.createForVisit(VISIT, dto(), assignedDoctor, 4),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(db.$transaction).not.toHaveBeenCalled();
      },
    );

    it('allows amending a CANCELLED visit (closed)', async () => {
      db.visit.findFirst.mockResolvedValue(visitRow({ status: 'CANCELLED' }));
      const result = await service.createForVisit(
        VISIT,
        dto(),
        assignedDoctor,
        4,
      );
      expect(result.version_to).toBe(5);
    });
  });

  describe('target & section validation', () => {
    it('rejects a non-visit-scoped target with 400', async () => {
      await expect(
        service.createForVisit(
          VISIT,
          dto({ target: 'patient_obgyn_history' }),
          assignedDoctor,
          4,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an unknown encounter section with 400', async () => {
      await expect(
        service.createForVisit(
          VISIT,
          dto({ section: 'not_a_real_section' }),
          assignedDoctor,
          4,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a missing section with 400', async () => {
      await expect(
        service.createForVisit(
          VISIT,
          dto({ section: undefined }),
          assignedDoctor,
          4,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('encounter existence & If-Match concurrency', () => {
    it('404s when there is no recorded encounter to amend', async () => {
      db.visitObgynEncounter.findUnique.mockResolvedValue(null);
      await expect(
        service.createForVisit(VISIT, dto(), assignedDoctor, 4),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a stale If-Match version with 412 and writes nothing', async () => {
      // Current version is 4; client supplies 3 (read an older copy).
      await expect(
        service.createForVisit(VISIT, dto(), assignedDoctor, 3),
      ).rejects.toBeInstanceOf(PreconditionFailedException);

      expect(db.$transaction).not.toHaveBeenCalled();
      expect(txRevisionCreate).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });
  });
});
