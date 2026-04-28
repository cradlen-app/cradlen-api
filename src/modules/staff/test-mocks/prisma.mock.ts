export const createPrismaMock = () => ({
  db: {
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    staff: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    branch: {
      findMany: jest.fn(),
    },
    role: {
      findFirst: jest.fn(),
    },
    staffInvitation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    workingSchedule: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    workingDay: {
      deleteMany: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
});

export type PrismaMock = ReturnType<typeof createPrismaMock>;
