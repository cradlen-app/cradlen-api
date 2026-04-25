import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalExceptionFilter } from './global-exception.filter';

function buildMockHost(requestId?: string) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return {
    host: {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'x-request-id': requestId },
          method: 'POST',
          url: '/test',
        }),
        getResponse: () => ({ status, json }),
      }),
    } as unknown as ArgumentsHost,
    json,
    status,
  };
}

function buildPrismaKnownError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('msg', {
    code,
    clientVersion: '7.0.0',
    meta,
  });
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
  });

  describe('Prisma errors', () => {
    it('maps P2002 (unique constraint) to 409 CONFLICT', () => {
      const { host, status, json } = buildMockHost('req-1');
      const err = buildPrismaKnownError('P2002', { target: ['email'] });

      filter.catch(err, host);

      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'CONFLICT',
            statusCode: 409,
            requestId: 'req-1',
          }),
        }),
      );
    });

    it('maps P2025 (not found) to 404 NOT_FOUND', () => {
      const { host, status, json } = buildMockHost();
      const err = buildPrismaKnownError('P2025');

      filter.catch(err, host);

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'NOT_FOUND' }),
        }),
      );
    });

    it('maps P2003 (FK violation) to 400 BAD_REQUEST with field detail', () => {
      const { host, status, json } = buildMockHost();
      const err = buildPrismaKnownError('P2003', { field_name: 'user_id' });

      filter.catch(err, host);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'BAD_REQUEST',
            details: expect.objectContaining({ field: 'user_id' }),
          }),
        }),
      );
    });

    it('maps unknown Prisma code to 500 INTERNAL_SERVER_ERROR', () => {
      const { host, status } = buildMockHost();
      const err = buildPrismaKnownError('P9999');

      filter.catch(err, host);

      expect(status).toHaveBeenCalledWith(500);
    });

    it('maps PrismaClientValidationError to 400 VALIDATION_ERROR', () => {
      const { host, status, json } = buildMockHost();
      const err = new Prisma.PrismaClientValidationError('invalid data', {
        clientVersion: '7.0.0',
      });

      filter.catch(err, host);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
        }),
      );
    });
  });

  describe('HTTP exceptions', () => {
    it('maps UnauthorizedException to 401 UNAUTHORIZED', () => {
      const { host, status, json } = buildMockHost();

      filter.catch(new UnauthorizedException('Invalid credentials'), host);

      expect(status).toHaveBeenCalledWith(401);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'UNAUTHORIZED',
            message: 'Invalid credentials',
          }),
        }),
      );
    });

    it('maps ForbiddenException to 403 FORBIDDEN', () => {
      const { host, status } = buildMockHost();

      filter.catch(new ForbiddenException('Email not verified'), host);

      expect(status).toHaveBeenCalledWith(403);
    });

    it('maps ConflictException to 409 CONFLICT', () => {
      const { host, status } = buildMockHost();

      filter.catch(new ConflictException('Already exists'), host);

      expect(status).toHaveBeenCalledWith(409);
    });

    it('maps NotFoundException to 404 NOT_FOUND', () => {
      const { host, status } = buildMockHost();

      filter.catch(new NotFoundException(), host);

      expect(status).toHaveBeenCalledWith(404);
    });

    it('maps BadRequestException with array messages to 400 VALIDATION_ERROR with fields', () => {
      const { host, status, json } = buildMockHost();
      const err = new BadRequestException({
        message: ['email must be an email', 'password is too short'],
        error: 'Bad Request',
        statusCode: 400,
      });

      filter.catch(err, host);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'VALIDATION_ERROR',
            details: expect.objectContaining({
              fields: expect.objectContaining({ email: expect.any(Array) }),
            }),
          }),
        }),
      );
    });

    it('maps BadRequestException with string message to 400 VALIDATION_ERROR', () => {
      const { host, status, json } = buildMockHost();

      filter.catch(new BadRequestException('speciality is required'), host);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
        }),
      );
    });
  });

  describe('Generic errors', () => {
    it('maps unknown Error to 500 INTERNAL_SERVER_ERROR', () => {
      const { host, status, json } = buildMockHost();

      filter.catch(new Error('Unexpected'), host);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'INTERNAL_SERVER_ERROR' }),
        }),
      );
    });
  });

  describe('requestId propagation', () => {
    it('includes requestId in error response when header is present', () => {
      const { host, json } = buildMockHost('my-request-id');

      filter.catch(new UnauthorizedException(), host);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ requestId: 'my-request-id' }),
        }),
      );
    });

    it('requestId is undefined when header is absent', () => {
      const { host, json } = buildMockHost(undefined);

      filter.catch(new UnauthorizedException(), host);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ requestId: undefined }),
        }),
      );
    });
  });
});
