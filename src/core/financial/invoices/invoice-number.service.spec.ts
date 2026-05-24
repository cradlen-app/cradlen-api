import { Test } from '@nestjs/testing';
import { InvoiceNumberService } from './invoice-number.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

const mockQueryRaw = jest.fn();
const mockTransaction = jest.fn();

const mockPrisma = {
  db: {
    $transaction: mockTransaction,
  },
};

describe('InvoiceNumberService', () => {
  let service: InvoiceNumberService;
  const currentYear = new Date().getFullYear();

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        InvoiceNumberService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(InvoiceNumberService);
    jest.clearAllMocks();

    mockTransaction.mockImplementation(async (fn) =>
      fn({
        $queryRaw: mockQueryRaw,
      }),
    );
  });

  it('formats invoice number as INV-YYYY-NNNNN', async () => {
    mockQueryRaw.mockResolvedValue([{ last_seq: 1, year: currentYear }]);

    const result = await service.generate('org-1');

    expect(result).toBe(`INV-${currentYear}-00001`);
  });

  it('pads sequence to 5 digits', async () => {
    mockQueryRaw.mockResolvedValue([{ last_seq: 42, year: currentYear }]);

    const result = await service.generate('org-1');

    expect(result).toBe(`INV-${currentYear}-00042`);
  });
});
