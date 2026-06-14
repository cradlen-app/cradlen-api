import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PatientSignupService } from './patient-signup.service.js';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { TokensService } from '@core/auth/services/tokens.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';

type Fn = jest.Mock;

interface Mocks {
  patientFindFirst: Fn;
  guardianFindFirst: Fn;
  accountCreate: Fn;
  accountFindFirst: Fn;
  accountUpdate: Fn;
  refreshTokenFindUnique: Fn;
  refreshTokenUpdateMany: Fn;
  transaction: Fn;
  issuePatientSignupToken: Fn;
  issuePatientTokenPair: Fn;
  issuePatientResetToken: Fn;
  decodePatientSignupToken: Fn;
  decodePatientResetToken: Fn;
  decodePatientRefreshToken: Fn;
  revokeRefreshToken: Fn;
}

function createEnv(): { service: PatientSignupService; mocks: Mocks } {
  const mocks: Mocks = {
    patientFindFirst: jest.fn(),
    guardianFindFirst: jest.fn(),
    accountCreate: jest.fn(),
    accountFindFirst: jest.fn(),
    accountUpdate: jest.fn(),
    refreshTokenFindUnique: jest.fn(),
    refreshTokenUpdateMany: jest.fn(),
    // The array form of $transaction: callers await the already-issued promises.
    transaction: jest.fn().mockResolvedValue([]),
    issuePatientSignupToken: jest.fn(),
    issuePatientTokenPair: jest.fn(),
    issuePatientResetToken: jest.fn(),
    decodePatientSignupToken: jest.fn(),
    decodePatientResetToken: jest.fn(),
    decodePatientRefreshToken: jest.fn(),
    revokeRefreshToken: jest.fn(),
  };

  const prisma = {
    db: {
      patient: { findFirst: mocks.patientFindFirst },
      guardian: { findFirst: mocks.guardianFindFirst },
      patientAccount: {
        create: mocks.accountCreate,
        findFirst: mocks.accountFindFirst,
        update: mocks.accountUpdate,
      },
      refreshToken: {
        findUnique: mocks.refreshTokenFindUnique,
        updateMany: mocks.refreshTokenUpdateMany,
      },
      $transaction: mocks.transaction,
    },
  } as unknown as PrismaService;

  const tokens = {
    issuePatientSignupToken: mocks.issuePatientSignupToken,
    issuePatientTokenPair: mocks.issuePatientTokenPair,
    issuePatientResetToken: mocks.issuePatientResetToken,
    decodePatientSignupToken: mocks.decodePatientSignupToken,
    decodePatientResetToken: mocks.decodePatientResetToken,
    decodePatientRefreshToken: mocks.decodePatientRefreshToken,
    revokeRefreshToken: mocks.revokeRefreshToken,
  } as unknown as TokensService;

  return { service: new PatientSignupService(prisma, tokens), mocks };
}

const PATIENT = {
  id: 'patient-1',
  full_name: 'Sara Ali',
  date_of_birth: new Date('1990-05-20T00:00:00.000Z'),
  phone_number: '+201012345678',
  account: null,
};

const START_DTO = {
  national_id: '29005200101234',
  date_of_birth: '1990-05-20',
  phone_number: '+201012345678',
};

describe('PatientSignupService', () => {
  describe('start', () => {
    it('issues a PATIENT signup token when all three fields match', async () => {
      const { service, mocks } = createEnv();
      mocks.patientFindFirst.mockResolvedValue({ ...PATIENT });
      mocks.issuePatientSignupToken.mockReturnValue({
        patient_signup_token: 'tok',
        expires_in: 1800,
      });

      const res = await service.start(START_DTO);

      expect(mocks.issuePatientSignupToken).toHaveBeenCalledWith(
        'PATIENT',
        'patient-1',
      );
      expect(res.patient_signup_token).toBe('tok');
    });

    it('rejects with a generic 404 when DOB does not match (no field leak)', async () => {
      const { service, mocks } = createEnv();
      mocks.patientFindFirst.mockResolvedValue({ ...PATIENT });

      await expect(
        service.start({ ...START_DTO, date_of_birth: '1991-01-01' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mocks.issuePatientSignupToken).not.toHaveBeenCalled();
    });

    it('rejects when phone does not match', async () => {
      const { service, mocks } = createEnv();
      mocks.patientFindFirst.mockResolvedValue({ ...PATIENT });

      await expect(
        service.start({ ...START_DTO, phone_number: '+209999999999' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects with 409 when the patient already has an account', async () => {
      const { service, mocks } = createEnv();
      mocks.patientFindFirst.mockResolvedValue({
        ...PATIENT,
        account: { id: 'account-1' },
      });

      await expect(service.start(START_DTO)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('falls through to a GUARDIAN match when no patient exists', async () => {
      const { service, mocks } = createEnv();
      mocks.patientFindFirst.mockResolvedValue(null);
      mocks.guardianFindFirst.mockResolvedValue({
        id: 'guardian-1',
        full_name: 'Omar Ali',
        date_of_birth: new Date('1990-05-20T00:00:00.000Z'),
        phone_number: '+201012345678',
        account: null,
      });
      mocks.issuePatientSignupToken.mockReturnValue({
        patient_signup_token: 'g-tok',
        expires_in: 1800,
      });

      const res = await service.start(START_DTO);

      expect(mocks.issuePatientSignupToken).toHaveBeenCalledWith(
        'GUARDIAN',
        'guardian-1',
      );
      expect(res.patient_signup_token).toBe('g-tok');
    });

    it('rejects a guardian whose stored DOB is null', async () => {
      const { service, mocks } = createEnv();
      mocks.patientFindFirst.mockResolvedValue(null);
      mocks.guardianFindFirst.mockResolvedValue({
        id: 'guardian-1',
        full_name: 'Omar Ali',
        date_of_birth: null,
        phone_number: '+201012345678',
        account: null,
      });

      await expect(service.start(START_DTO)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects when neither a patient nor a guardian matches', async () => {
      const { service, mocks } = createEnv();
      mocks.patientFindFirst.mockResolvedValue(null);
      mocks.guardianFindFirst.mockResolvedValue(null);

      await expect(service.start(START_DTO)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('complete', () => {
    const COMPLETE_DTO = {
      patient_signup_token: 'tok',
      password: 'Password1!',
      confirm_password: 'Password1!',
      security_question: 'BIRTH_CITY',
      security_answer: 'Cairo',
    };

    it('creates a PatientAccount (no staff user row) and auto-logs-in', async () => {
      const { service, mocks } = createEnv();
      mocks.decodePatientSignupToken.mockReturnValue({
        subjectType: 'PATIENT',
        subjectId: 'patient-1',
      });
      mocks.patientFindFirst.mockResolvedValue({ ...PATIENT });
      mocks.accountCreate.mockResolvedValue({ id: 'account-1' });
      mocks.issuePatientTokenPair.mockResolvedValue({ type: 'tokens' });

      await service.complete({ ...COMPLETE_DTO });

      expect(mocks.accountCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patient_id: 'patient-1',
            guardian_id: null,
            security_question: 'BIRTH_CITY',
          }),
        }),
      );
      expect(mocks.issuePatientTokenPair).toHaveBeenCalledWith({
        accountId: 'account-1',
        patientId: 'patient-1',
      });
    });

    it('stores the chosen question and a hash of the normalized answer', async () => {
      const { service, mocks } = createEnv();
      mocks.decodePatientSignupToken.mockReturnValue({
        subjectType: 'PATIENT',
        subjectId: 'patient-1',
      });
      mocks.patientFindFirst.mockResolvedValue({ ...PATIENT });
      mocks.accountCreate.mockResolvedValue({ id: 'account-1' });
      mocks.issuePatientTokenPair.mockResolvedValue({ type: 'tokens' });

      await service.complete({ ...COMPLETE_DTO, security_answer: '  CaIRo ' });

      const data = mocks.accountCreate.mock.calls[0][0].data as {
        security_question: string;
        security_answer_hashed: string;
      };
      expect(data.security_question).toBe('BIRTH_CITY');
      expect(data.security_answer_hashed).not.toBe('cairo');
      // Normalized (trim + lowercase) before hashing, so 'cairo' verifies.
      expect(bcrypt.compareSync('cairo', data.security_answer_hashed)).toBe(
        true,
      );
    });

    it('maps a P2002 unique violation to a 409 (concurrent signup)', async () => {
      const { service, mocks } = createEnv();
      mocks.decodePatientSignupToken.mockReturnValue({
        subjectType: 'PATIENT',
        subjectId: 'patient-1',
      });
      mocks.patientFindFirst.mockResolvedValue({ ...PATIENT });
      mocks.accountCreate.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.complete({ ...COMPLETE_DTO }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    it('issues a token pair on a valid national_id + password', async () => {
      const { service, mocks } = createEnv();
      const password_hashed = await bcrypt.hash('Password1!', 4);
      mocks.patientFindFirst.mockResolvedValue({
        id: 'patient-1',
        account: {
          id: 'account-1',
          is_active: true,
          is_deleted: false,
          password_hashed,
        },
      });
      mocks.issuePatientTokenPair.mockResolvedValue({ type: 'tokens' });

      await service.login({
        national_id: START_DTO.national_id,
        password: 'Password1!',
      });

      expect(mocks.issuePatientTokenPair).toHaveBeenCalledWith({
        accountId: 'account-1',
        patientId: 'patient-1',
        guardianId: undefined,
      });
    });

    it('rejects with a generic 401 on a wrong password', async () => {
      const { service, mocks } = createEnv();
      const password_hashed = await bcrypt.hash('Password1!', 4);
      mocks.patientFindFirst.mockResolvedValue({
        id: 'patient-1',
        account: {
          id: 'account-1',
          is_active: true,
          is_deleted: false,
          password_hashed,
        },
      });

      await expect(
        service.login({
          national_id: START_DTO.national_id,
          password: 'wrong',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects with a generic 401 when no account exists', async () => {
      const { service, mocks } = createEnv();
      mocks.patientFindFirst.mockResolvedValue(null);
      mocks.guardianFindFirst.mockResolvedValue(null);

      await expect(
        service.login({ national_id: 'unknown', password: 'whatever' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    async function storedRow(overrides: Record<string, unknown> = {}) {
      return {
        jti: 'jti-1',
        token_hash: await bcrypt.hash('refresh-tok', 4),
        is_revoked: false,
        expires_at: new Date(Date.now() + 60_000),
        user_id: null,
        patient_account_id: 'account-1',
        profile_id: null,
        organization_id: null,
        patientAccount: {
          id: 'account-1',
          is_active: true,
          is_deleted: false,
          patient_id: 'patient-1',
          guardian_id: null,
        },
        ...overrides,
      };
    }

    it('rotates the jti and re-issues a token pair from the stored account', async () => {
      const { service, mocks } = createEnv();
      mocks.decodePatientRefreshToken.mockReturnValue({ jti: 'jti-1' });
      mocks.refreshTokenFindUnique.mockResolvedValue(await storedRow());
      mocks.issuePatientTokenPair.mockResolvedValue({ type: 'tokens' });

      await service.refresh({ refresh_token: 'refresh-tok' });

      expect(mocks.issuePatientTokenPair).toHaveBeenCalledWith({
        accountId: 'account-1',
        patientId: 'patient-1',
        guardianId: undefined,
        revokeJti: 'jti-1',
      });
    });

    it('rejects a revoked or expired refresh token (401)', async () => {
      const { service, mocks } = createEnv();
      mocks.decodePatientRefreshToken.mockReturnValue({ jti: 'jti-1' });
      mocks.refreshTokenFindUnique.mockResolvedValue(
        await storedRow({ is_revoked: true }),
      );

      await expect(
        service.refresh({ refresh_token: 'refresh-tok' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a staff refresh row (owned by a user, not an account) (401)', async () => {
      const { service, mocks } = createEnv();
      mocks.decodePatientRefreshToken.mockReturnValue({ jti: 'jti-1' });
      mocks.refreshTokenFindUnique.mockResolvedValue(
        await storedRow({
          user_id: 'staff-user-1',
          patient_account_id: null,
          patientAccount: null,
        }),
      );

      await expect(
        service.refresh({ refresh_token: 'refresh-tok' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when the refresh token hash does not match (401)', async () => {
      const { service, mocks } = createEnv();
      mocks.decodePatientRefreshToken.mockReturnValue({ jti: 'jti-1' });
      mocks.refreshTokenFindUnique.mockResolvedValue(await storedRow());

      await expect(
        service.refresh({ refresh_token: 'wrong-token' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('delegates to revokeRefreshToken', async () => {
      const { service, mocks } = createEnv();
      mocks.revokeRefreshToken.mockResolvedValue(undefined);

      await service.logout('refresh-tok');

      expect(mocks.revokeRefreshToken).toHaveBeenCalledWith('refresh-tok');
    });
  });

  describe('changePassword', () => {
    const ctx: PatientAuthContext = {
      accountId: 'account-1',
      patientId: 'patient-1',
      accessiblePatientIds: ['patient-1'],
    };
    const currentHash = bcrypt.hashSync('OldPass123', 4);

    function env() {
      const accountFindFirst = jest
        .fn()
        .mockResolvedValue({ id: 'account-1', password_hashed: currentHash });
      const accountUpdate = jest.fn().mockResolvedValue({});
      const prisma = {
        db: {
          patientAccount: {
            findFirst: accountFindFirst,
            update: accountUpdate,
          },
        },
      } as unknown as PrismaService;
      const service = new PatientSignupService(
        prisma,
        {} as unknown as TokensService,
      );
      return { service, accountFindFirst, accountUpdate };
    }

    it('rejects (401) when the account is not found', async () => {
      const { service, accountFindFirst, accountUpdate } = env();
      accountFindFirst.mockResolvedValue(null);
      await expect(
        service.changePassword(ctx, {
          current_password: 'OldPass123',
          new_password: 'NewPass456',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(accountUpdate).not.toHaveBeenCalled();
    });

    it('rejects (401) when the current password is wrong', async () => {
      const { service, accountUpdate } = env();
      await expect(
        service.changePassword(ctx, {
          current_password: 'WrongPass',
          new_password: 'NewPass456',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(accountUpdate).not.toHaveBeenCalled();
    });

    it('rejects (400) when the new password equals the current', async () => {
      const { service, accountUpdate } = env();
      await expect(
        service.changePassword(ctx, {
          current_password: 'OldPass123',
          new_password: 'OldPass123',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(accountUpdate).not.toHaveBeenCalled();
    });

    it('hashes and stores a new, different password', async () => {
      const { service, accountUpdate } = env();
      await service.changePassword(ctx, {
        current_password: 'OldPass123',
        new_password: 'NewPass456',
      });
      const data = accountUpdate.mock.calls[0][0].data as {
        password_hashed: string;
      };
      expect(data.password_hashed).not.toBe(currentHash);
      expect(bcrypt.compareSync('NewPass456', data.password_hashed)).toBe(true);
    });
  });

  describe('setSecurityQuestion', () => {
    const ctx: PatientAuthContext = {
      accountId: 'account-1',
      patientId: 'patient-1',
      accessiblePatientIds: ['patient-1'],
    };
    const currentHash = bcrypt.hashSync('OldPass123', 4);

    const DTO = {
      security_question: 'BIRTH_CITY',
      security_answer: 'Cairo',
      current_password: 'OldPass123',
    };

    it('rejects (401) when the account is not found', async () => {
      const { service, mocks } = createEnv();
      mocks.accountFindFirst.mockResolvedValue(null);

      await expect(
        service.setSecurityQuestion(ctx, { ...DTO }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mocks.accountUpdate).not.toHaveBeenCalled();
    });

    it('rejects (401) when the current password is wrong', async () => {
      const { service, mocks } = createEnv();
      mocks.accountFindFirst.mockResolvedValue({
        id: 'account-1',
        password_hashed: currentHash,
      });

      await expect(
        service.setSecurityQuestion(ctx, {
          ...DTO,
          current_password: 'WrongPass',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mocks.accountUpdate).not.toHaveBeenCalled();
    });

    it('stores the question + a hash of the normalized answer', async () => {
      const { service, mocks } = createEnv();
      mocks.accountFindFirst.mockResolvedValue({
        id: 'account-1',
        password_hashed: currentHash,
      });
      mocks.accountUpdate.mockResolvedValue({});

      await service.setSecurityQuestion(ctx, {
        ...DTO,
        security_answer: '  CaIRo ',
      });

      const data = mocks.accountUpdate.mock.calls[0][0].data as {
        security_question: string;
        security_answer_hashed: string;
      };
      expect(data.security_question).toBe('BIRTH_CITY');
      expect(data.security_answer_hashed).not.toBe('cairo');
      expect(bcrypt.compareSync('cairo', data.security_answer_hashed)).toBe(
        true,
      );
    });
  });

  describe('me', () => {
    const ctx: PatientAuthContext = {
      accountId: 'account-1',
      patientId: 'patient-1',
      accessiblePatientIds: [],
    };

    it('returns the stored security-question key (answer never exposed)', async () => {
      const { service, mocks } = createEnv();
      mocks.accountFindFirst.mockResolvedValue({
        security_question: 'BIRTH_CITY',
      });
      mocks.patientFindFirst.mockResolvedValue({ full_name: 'Sara Ali' });

      const res = await service.me(ctx);

      expect(res.security_question).toBe('BIRTH_CITY');
      expect(res).not.toHaveProperty('security_answer_hashed');
    });

    it('returns null when no security question is set', async () => {
      const { service, mocks } = createEnv();
      mocks.accountFindFirst.mockResolvedValue({ security_question: null });
      mocks.patientFindFirst.mockResolvedValue({ full_name: 'Sara Ali' });

      const res = await service.me(ctx);

      expect(res.security_question).toBeNull();
    });
  });

  describe('forgotPasswordStart', () => {
    const answerHash = bcrypt.hashSync('cairo', 4);

    function matchedPatient(accountOverrides: Record<string, unknown> | null) {
      return {
        ...PATIENT,
        account:
          accountOverrides === null
            ? null
            : {
                id: 'account-1',
                is_deleted: false,
                is_active: true,
                password_hashed: 'hash',
                security_question: 'BIRTH_CITY',
                security_answer_hashed: answerHash,
                ...accountOverrides,
              },
      };
    }

    it('returns the stored question + a reset token on identity match', async () => {
      const { service, mocks } = createEnv();
      mocks.patientFindFirst.mockResolvedValue(matchedPatient({}));
      mocks.issuePatientResetToken.mockReturnValue({
        reset_token: 'reset-tok',
        expires_in: 1800,
      });

      const res = await service.forgotPasswordStart(START_DTO);

      expect(mocks.issuePatientResetToken).toHaveBeenCalledWith('account-1');
      expect(res).toEqual({
        security_question: 'BIRTH_CITY',
        reset_token: 'reset-tok',
        expires_in: 1800,
      });
    });

    it('rejects (generic 404) when no account exists yet', async () => {
      const { service, mocks } = createEnv();
      mocks.patientFindFirst.mockResolvedValue(matchedPatient(null));

      await expect(
        service.forgotPasswordStart(START_DTO),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mocks.issuePatientResetToken).not.toHaveBeenCalled();
    });

    it('rejects when the account has no security question on file', async () => {
      const { service, mocks } = createEnv();
      mocks.patientFindFirst.mockResolvedValue(
        matchedPatient({
          security_question: null,
          security_answer_hashed: null,
        }),
      );

      await expect(
        service.forgotPasswordStart(START_DTO),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects with a generic 404 when the identity does not match', async () => {
      const { service, mocks } = createEnv();
      mocks.patientFindFirst.mockResolvedValue(matchedPatient({}));

      await expect(
        service.forgotPasswordStart({
          ...START_DTO,
          phone_number: '+209999999999',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('forgotPasswordComplete', () => {
    const answerHash = bcrypt.hashSync('cairo', 4);
    const oldPasswordHash = bcrypt.hashSync('OldPass123!', 4);

    function setup(
      accountOverrides: Record<string, unknown> | null,
    ): ReturnType<typeof createEnv> {
      const env = createEnv();
      env.mocks.decodePatientResetToken.mockReturnValue({
        accountId: 'account-1',
      });
      env.mocks.accountFindFirst.mockResolvedValue(
        accountOverrides === null
          ? null
          : {
              id: 'account-1',
              password_hashed: oldPasswordHash,
              security_answer_hashed: answerHash,
              ...accountOverrides,
            },
      );
      return env;
    }

    const DTO = {
      reset_token: 'reset-tok',
      security_answer: 'Cairo',
      password: 'NewPass456!',
      confirm_password: 'NewPass456!',
    };

    it('sets a new password and revokes all refresh tokens on a correct answer', async () => {
      const { service, mocks } = setup({});

      await service.forgotPasswordComplete(DTO);

      const updateData = mocks.accountUpdate.mock.calls[0][0].data as {
        password_hashed: string;
      };
      expect(
        bcrypt.compareSync('NewPass456!', updateData.password_hashed),
      ).toBe(true);
      expect(mocks.refreshTokenUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { patient_account_id: 'account-1', is_revoked: false },
        }),
      );
      expect(mocks.transaction).toHaveBeenCalled();
    });

    it('rejects (generic 401) on a wrong security answer', async () => {
      const { service, mocks } = setup({});

      await expect(
        service.forgotPasswordComplete({ ...DTO, security_answer: 'Alex' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mocks.accountUpdate).not.toHaveBeenCalled();
    });

    it('rejects (401) when the account is gone or lacks a stored answer', async () => {
      const { service, mocks } = setup(null);

      await expect(service.forgotPasswordComplete(DTO)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(mocks.accountUpdate).not.toHaveBeenCalled();
    });

    it('rejects (400) when the new password equals the current one', async () => {
      const { service, mocks } = setup({
        password_hashed: bcrypt.hashSync('NewPass456!', 4),
      });

      await expect(service.forgotPasswordComplete(DTO)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.accountUpdate).not.toHaveBeenCalled();
    });
  });
});
