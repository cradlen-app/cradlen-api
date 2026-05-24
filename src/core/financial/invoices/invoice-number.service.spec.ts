import { Test } from '@nestjs/testing';
import { InvoiceNumberService } from './invoice-number.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

const mockExecuteRaw = jest.fn().mockResolvedValue(1);
const mockFindUnique = jest.fn();
const mockTransaction = jest.fn();

const mockPrisma = {
  db: {
    $transaction: mockTransaction,
    invoiceSequence: { findUnique: mockFindUnique },
  },
};

describe('InvoiceNumberService', () => {
  let service: InvoiceNumberService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        InvoiceNumberService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(InvoiceNumberService);
    jest.clearAllMocks();

    mockTransaction.mockImplementation(async (fn) => fn({
      $executeRaw: mockExecuteRaw,
      invoiceSequence: { findUnique: mockFindUnique },
    }));
  });

  it('formats invoice number as INV-YYYY-NNNNN', async () => {
    mockFindUnique.mockResolvedValue({ last_seq: 1 });

    const result = await service.generate('org-1');

    const year = new Date().getFullYear();
    expect(result).toBe(`INV-${year}-00001`);
  });

  it('pads sequence to 5 digits', async () => {
    mockFindUnique.mockResolvedValue({ last_seq: 42 });

    const result = await service.generate('org-1');

    const year = new Date().getFullYear();
    expect(result).toBe(`INV-${year}-00042`);
  });
});
