import { Test, TestingModule } from '@nestjs/testing';
import { ProceduresService } from './procedures.service';
import { PrismaService } from '@infrastructure/database/prisma.service';

const mockProcedure = {
  id: 'proc-uuid',
  code: 'CESAREAN_SECTION',
  name: 'Cesarean Section',
  specialty: { id: 'spec-uuid', code: 'OBGYN', name: 'Gynecology' },
};

const selectShape = {
  id: true,
  code: true,
  name: true,
  specialty: { select: { id: true, code: true, name: true } },
};

describe('ProceduresService', () => {
  let service: ProceduresService;
  let db: { procedure: { findMany: jest.Mock } };

  beforeEach(async () => {
    db = { procedure: { findMany: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProceduresService,
        { provide: PrismaService, useValue: { db } },
      ],
    }).compile();
    service = module.get<ProceduresService>(ProceduresService);
  });

  describe('findLookup', () => {
    it('with no params: filters soft-deleted only, selects DTO shape, caps at 100', async () => {
      db.procedure.findMany.mockResolvedValue([mockProcedure]);

      const result = await service.findLookup({});

      expect(result).toEqual([mockProcedure]);
      expect(db.procedure.findMany).toHaveBeenCalledWith({
        where: { is_deleted: false },
        select: selectShape,
        orderBy: { name: 'asc' },
        take: 100,
      });
    });

    it('filters by specialty when specialtyId is provided', async () => {
      db.procedure.findMany.mockResolvedValue([]);

      await service.findLookup({ specialtyId: 'spec-uuid' });

      expect(db.procedure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { is_deleted: false, specialty_id: 'spec-uuid' },
        }),
      );
    });

    it('searches name and code case-insensitively, trimming the term', async () => {
      db.procedure.findMany.mockResolvedValue([]);

      await service.findLookup({ search: '  cesar  ' });

      expect(db.procedure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            is_deleted: false,
            OR: [
              { name: { contains: 'cesar', mode: 'insensitive' } },
              { code: { contains: 'cesar', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('combines specialty filter and search', async () => {
      db.procedure.findMany.mockResolvedValue([]);

      await service.findLookup({ specialtyId: 'spec-uuid', search: 'cs' });

      expect(db.procedure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            is_deleted: false,
            specialty_id: 'spec-uuid',
            OR: [
              { name: { contains: 'cs', mode: 'insensitive' } },
              { code: { contains: 'cs', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('ignores a whitespace-only search term (no OR clause)', async () => {
      db.procedure.findMany.mockResolvedValue([]);

      await service.findLookup({ search: '   ' });

      expect(db.procedure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { is_deleted: false } }),
      );
    });
  });
});
