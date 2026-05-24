import { Test } from '@nestjs/testing';
import { InvoiceStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { InvoicesService } from './invoices.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { PricingResolverService } from '../pricing/pricing-resolver.service.js';
import { InvoiceNumberService } from './invoice-number.service.js';

const mockPrisma = { db: {} };
const mockAuth = {};
const mockPricingResolver = {};
const mockInvoiceNumber = {};

describe('InvoicesService — deriveStatus', () => {
  let service: InvoicesService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthorizationService, useValue: mockAuth },
        { provide: PricingResolverService, useValue: mockPricingResolver },
        { provide: InvoiceNumberService, useValue: mockInvoiceNumber },
      ],
    }).compile();

    service = module.get(InvoicesService);
  });

  const d = (n: number) => new Prisma.Decimal(n);

  it('returns PAID when paid_amount >= total_amount', () => {
    expect(service['deriveStatus'](d(200), d(200))).toBe(InvoiceStatus.PAID);
    expect(service['deriveStatus'](d(200), d(250))).toBe(InvoiceStatus.PAID); // overpayment
  });

  it('returns PARTIALLY_PAID when partial payment recorded', () => {
    expect(service['deriveStatus'](d(200), d(100))).toBe(
      InvoiceStatus.PARTIALLY_PAID,
    );
  });

  it('returns ISSUED when no payment recorded', () => {
    expect(service['deriveStatus'](d(200), d(0))).toBe(InvoiceStatus.ISSUED);
  });

  it('returns PAID for zero-total invoice', () => {
    expect(service['deriveStatus'](d(0), d(0))).toBe(InvoiceStatus.PAID);
  });
});
