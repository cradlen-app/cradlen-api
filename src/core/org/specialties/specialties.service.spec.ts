import { Test, TestingModule } from '@nestjs/testing';
import { SpecialtiesService } from './specialties.service';
import { PrismaService } from '@infrastructure/database/prisma.service';

const mockSpecialty = {
  id: 'spec-uuid',
  name: 'Gynecology',
  code: 'OBGYN',
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

const mockLookup = { code: 'OBGYN', name: 'Gynecology' };

describe('SpecialtiesService', () => {
  let service: SpecialtiesService;
  let db: { specialty: { findMany: jest.Mock } };

  beforeEach(async () => {
    db = { specialty: { findMany: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpecialtiesService,
        { provide: PrismaService, useValue: { db } },
      ],
    }).compile();
    service = module.get<SpecialtiesService>(SpecialtiesService);
  });

  describe('findLookup', () => {
    it('selects code+name and orders by name', async () => {
      db.specialty.findMany.mockResolvedValue([mockLookup]);
      const result = await service.findLookup();
      expect(result).toEqual([mockLookup]);
      expect(db.specialty.findMany).toHaveBeenCalledWith({
        where: { is_deleted: false },
        select: { code: true, name: true },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('findAll', () => {
    it('scopes by organization, selects DTO shape, filters soft-deleted', async () => {
      db.specialty.findMany.mockResolvedValue([mockSpecialty]);
      const result = await service.findAll('org-uuid');
      expect(result).toEqual([mockSpecialty]);
      expect(db.specialty.findMany).toHaveBeenCalledWith({
        where: {
          is_deleted: false,
          org_links: { some: { organization_id: 'org-uuid' } },
        },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          code: true,
          description: true,
          templates: {
            where: { is_deleted: false },
            select: {
              id: true,
              name: true,
              type: true,
              description: true,
              episodes: {
                where: { is_deleted: false },
                orderBy: { order: 'asc' },
                select: { id: true, name: true, order: true },
              },
            },
          },
        },
      });
    });
  });
});
