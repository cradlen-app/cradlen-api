export const createPrismaMock = () => ({
  db: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findFirstOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    profile: {
      create: jest.fn(),
    },
    emailVerification: {
      create: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    passwordReset: {
      create: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    role: {
      findFirst: jest.fn(),
    },
    subscriptionPlan: {
      findFirst: jest.fn(),
    },
    organization: {
      create: jest.fn(),
    },
    branch: {
      create: jest.fn(),
    },
    staff: {
      create: jest.fn(),
    },
    subscription: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  },
});

export type PrismaMock = ReturnType<typeof createPrismaMock>;
