import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MedicalRepService } from './medical-rep.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';

const ORG = 'org-uuid';

/** A clinical doctor (non-manager): scoped to reps they have a visit with. */
const doctor: AuthContext = {
  userId: 'u1',
  profileId: 'doc-1',
  organizationId: ORG,
  role: 'OBGYN',
  jobFunction: 'OBGYN',
  branchIds: ['br-1'],
};

const owner: AuthContext = { ...doctor, profileId: 'own-1', role: 'OWNER' };

const repRow = {
  id: 'rep-1',
  full_name: 'Rep One',
  company_name: 'Pharma',
  national_id: 'nid',
  phone_number: '123',
  specialty_focus: 'OBGYN',
  medications: [],
};

describe('MedicalRepService', () => {
  let service: MedicalRepService;
  let db: {
    medicalRep: {
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
    };
    medicalRepVisit: { groupBy: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    db = {
      medicalRep: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
      },
      medicalRepVisit: { groupBy: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockResolvedValue([[repRow], 1]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicalRepService,
        { provide: PrismaService, useValue: { db } },
      ],
    }).compile();
    service = module.get<MedicalRepService>(MedicalRepService);
  });

  describe('searchReps — scope', () => {
    it('limits a doctor to reps they have a visit assigned to them with', async () => {
      await service.searchReps(doctor, {});

      const where = db.medicalRep.findMany.mock.calls[0][0].where;
      expect(where.visits).toEqual({
        some: { assigned_doctor_id: doctor.profileId },
      });
      // The per-rep visit stats are scoped to the doctor's own visits too.
      const statsWhere = db.medicalRepVisit.groupBy.mock.calls[0][0].where;
      expect(statsWhere.assigned_doctor_id).toBe(doctor.profileId);
    });

    it('leaves the rep list org-wide for an owner', async () => {
      await service.searchReps(owner, {});

      const where = db.medicalRep.findMany.mock.calls[0][0].where;
      expect(where.visits).toBeUndefined();
      const statsWhere = db.medicalRepVisit.groupBy.mock.calls[0][0].where;
      expect(statsWhere.assigned_doctor_id).toBeUndefined();
    });
  });

  describe('findOne — scope', () => {
    it('scopes a doctor to a rep they have a visit with', async () => {
      db.medicalRep.findFirst.mockResolvedValue(repRow);

      await service.findOne('rep-1', doctor);

      const where = db.medicalRep.findFirst.mock.calls[0][0].where;
      expect(where.visits).toEqual({
        some: { assigned_doctor_id: doctor.profileId },
      });
    });

    it('returns NotFound when the rep is outside the doctor scope', async () => {
      db.medicalRep.findFirst.mockResolvedValue(null);

      await expect(service.findOne('rep-x', doctor)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does not scope an owner by visits', async () => {
      db.medicalRep.findFirst.mockResolvedValue(repRow);

      await service.findOne('rep-1', owner);

      const where = db.medicalRep.findFirst.mock.calls[0][0].where;
      expect(where.visits).toBeUndefined();
    });
  });
});
