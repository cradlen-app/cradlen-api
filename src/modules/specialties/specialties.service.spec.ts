import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SpecialtiesService } from './specialties.service';
import { PrismaService } from '../../database/prisma.service';

const mockSpecialty = {
  id: 'spec-uuid',
  name: 'Gynecology',
  code: 'GYN',
  description: null,
  templates: [
    {
      id: 'tmpl-uuid',
      name: 'Pregnancy Journey',
      type: 'PREGNANCY',
      description: null,
      episodes: [{ id: 'ep-uuid', name: 'First Trimester', order: 1 }],
    },
  ],
};

describe('SpecialtiesService', () => {
  let service: SpecialtiesService;
  let db: {
    specialty: { findMany: jest.Mock; findFirst: jest.Mock };
    journeyTemplate: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    db = {
      specialty: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      journeyTemplate: { findMany: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpecialtiesService,
        { provide: PrismaService, useValue: { db } },
      ],
    }).compile();
    service = module.get<SpecialtiesService>(SpecialtiesService);
  });

  describe('findAll', () => {
    it('returns all specialties with templates and episodes', async () => {
      db.specialty.findMany.mockResolvedValue([mockSpecialty]);
      const result = await service.findAll();
      expect(result).toEqual([mockSpecialty]);
      expect(db.specialty.findMany).toHaveBeenCalledWith({
        where: { is_deleted: false },
        include: {
          templates: {
            where: { is_deleted: false },
            include: {
              episodes: {
                where: { is_deleted: false },
                orderBy: { order: 'asc' },
              },
            },
          },
        },
      });
    });
  });

  describe('findJourneyTemplates', () => {
    it('returns journey templates for a specialty', async () => {
      db.specialty.findFirst.mockResolvedValue(mockSpecialty);
      db.journeyTemplate.findMany.mockResolvedValue(mockSpecialty.templates);
      const result = await service.findJourneyTemplates('spec-uuid');
      expect(result).toEqual(mockSpecialty.templates);
    });

    it('throws NotFoundException when specialty not found', async () => {
      db.specialty.findFirst.mockResolvedValue(null);
      await expect(service.findJourneyTemplates('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
