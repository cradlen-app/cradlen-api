import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { JourneyTemplatesService } from './journey-templates.service';
import { PrismaService } from '../../database/prisma.service';

const mockTemplate = {
  id: 'tmpl-uuid',
  specialty_id: 'spec-uuid',
  name: 'Pregnancy Journey',
  type: 'PREGNANCY',
  description: null,
  episodes: [{ id: 'ep-uuid', name: 'First Trimester', order: 1 }],
};

describe('JourneyTemplatesService', () => {
  let service: JourneyTemplatesService;
  let db: {
    journeyTemplate: { findMany: jest.Mock; findUnique: jest.Mock };
  };

  beforeEach(async () => {
    db = {
      journeyTemplate: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JourneyTemplatesService,
        { provide: PrismaService, useValue: { db } },
      ],
    }).compile();
    service = module.get<JourneyTemplatesService>(JourneyTemplatesService);
  });

  describe('findAll', () => {
    it('returns all templates when no filter given', async () => {
      db.journeyTemplate.findMany.mockResolvedValue([mockTemplate]);
      const result = await service.findAll(undefined);
      expect(result).toEqual([mockTemplate]);
      expect(db.journeyTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { is_deleted: false } }),
      );
    });

    it('filters by specialtyId when provided', async () => {
      db.journeyTemplate.findMany.mockResolvedValue([mockTemplate]);
      await service.findAll('spec-uuid');
      expect(db.journeyTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { specialty_id: 'spec-uuid', is_deleted: false },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns template when found', async () => {
      db.journeyTemplate.findUnique.mockResolvedValue(mockTemplate);
      const result = await service.findOne('tmpl-uuid');
      expect(result).toEqual(mockTemplate);
    });

    it('throws NotFoundException when not found', async () => {
      db.journeyTemplate.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
