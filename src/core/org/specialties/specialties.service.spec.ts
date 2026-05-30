import { BadRequestException } from '@nestjs/common';
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

  describe('resolveByCodeOrName', () => {
    it('returns [] without querying when input is empty', async () => {
      const result = await service.resolveByCodeOrName([]);
      expect(result).toEqual([]);
      expect(db.specialty.findMany).not.toHaveBeenCalled();
    });

    it('matches by code OR case-insensitive name in a single query', async () => {
      db.specialty.findMany.mockResolvedValue([]);
      await service.resolveByCodeOrName(['OBGYN', 'general medicine']);
      expect(db.specialty.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { code: { in: ['OBGYN', 'general medicine'] } },
            {
              name: { in: ['OBGYN', 'general medicine'], mode: 'insensitive' },
            },
          ],
          is_deleted: false,
        },
      });
    });

    it('silently skips unmatched entries by default', async () => {
      db.specialty.findMany.mockResolvedValue([
        { id: 'spec-uuid', code: 'OBGYN', name: 'Gynecology' },
      ]);
      const result = await service.resolveByCodeOrName(['OBGYN', 'BOGUS']);
      expect(result).toHaveLength(1);
    });

    it('throws BadRequestException listing unknown entries when validate=true', async () => {
      db.specialty.findMany.mockResolvedValue([
        { id: 'spec-uuid', code: 'OBGYN', name: 'Gynecology' },
      ]);
      await expect(
        service.resolveByCodeOrName(['OBGYN', 'BOGUS'], { validate: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.resolveByCodeOrName(['OBGYN', 'BOGUS'], { validate: true }),
      ).rejects.toThrow('BOGUS');
    });

    it('accepts a case-insensitive name as a match when validating', async () => {
      db.specialty.findMany.mockResolvedValue([
        { id: 'spec-uuid', code: 'OBGYN', name: 'Gynecology' },
      ]);
      await expect(
        service.resolveByCodeOrName(['gynecology'], { validate: true }),
      ).resolves.toHaveLength(1);
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
