import { Test } from '@nestjs/testing';
import { ReceiptNumberService } from './receipt-number.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

const mockQueryRaw = jest.fn();
const mockTransaction = jest.fn();

const mockPrisma = {
  db: {
    $transaction: mockTransaction,
  },
};

describe('ReceiptNumberService', () => {
  let service: ReceiptNumberService;
  const currentYear = new Date().getFullYear();

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ReceiptNumberService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(ReceiptNumberService);
    jest.clearAllMocks();

    mockTransaction.mockImplementation(
      (fn: (tx: { $queryRaw: jest.Mock }) => unknown) =>
        fn({ $queryRaw: mockQueryRaw }),
    );
  });

  it('formats receipt number as RCP-YYYY-NNNNN', async () => {
    mockQueryRaw.mockResolvedValue([{ last_seq: 1, year: currentYear }]);

    const result = await service.generate('org-1');

    expect(result).toBe(`RCP-${currentYear}-00001`);
  });

  it('pads sequence to 5 digits', async () => {
    mockQueryRaw.mockResolvedValue([{ last_seq: 42, year: currentYear }]);

    const result = await service.generate('org-1');

    expect(result).toBe(`RCP-${currentYear}-00042`);
  });

  it('throws when the sequence row is missing', async () => {
    mockQueryRaw.mockResolvedValue([]);

    await expect(service.generate('org-1')).rejects.toThrow();
  });
});
