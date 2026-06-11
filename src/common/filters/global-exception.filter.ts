import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { ERROR_CODES, type ErrorCode } from '../constant/error-codes.js';

interface ValidationErrorResponse {
  message: string | string[];
  error?: string;
  statusCode?: number;
}

interface ErrorBody {
  code: ErrorCode;
  message: string;
  statusCode: number;
  details: Record<string, unknown>;
}

interface HandledError {
  status: number;
  body: ErrorBody;
}

function isValidationErrorResponse(v: unknown): v is ValidationErrorResponse {
  return typeof v === 'object' && v !== null && 'message' in v;
}

/** Read a string-valued key off an unknown HttpException response body. */
function readString(raw: unknown, key: string): string | null {
  if (raw === null || typeof raw !== 'object') return null;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

/** Read an object-valued key off an unknown HttpException response body. */
function readObject(raw: unknown, key: string): Record<string, unknown> | null {
  if (raw === null || typeof raw !== 'object') return null;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function resolveCode(status: number): ErrorCode {
  const map: Partial<Record<number, ErrorCode>> = {
    [HttpStatus.BAD_REQUEST]: ERROR_CODES.BAD_REQUEST,
    [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHORIZED,
    [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
    [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
    [HttpStatus.CONFLICT]: ERROR_CODES.CONFLICT,
    [HttpStatus.PRECONDITION_FAILED]: ERROR_CODES.STALE_VERSION,
    [HttpStatus.UNPROCESSABLE_ENTITY]: ERROR_CODES.UNPROCESSABLE_ENTITY,
    [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.TOO_MANY_REQUESTS,
  };
  return map[status] ?? ERROR_CODES.INTERNAL_SERVER_ERROR;
}

function buildValidationDetails(raw: unknown): Record<string, unknown> {
  if (!isValidationErrorResponse(raw)) return {};

  const messages = Array.isArray(raw.message) ? raw.message : [raw.message];

  const fields = messages.reduce<Record<string, string[]>>((acc, msg) => {
    // Heuristic, not robust parsing: class-validator prefixes each message with
    // the property name ("email must be..."), so the first token is the field.
    // Messages that don't follow that shape bucket under "unknown".
    const spaceIdx = msg.indexOf(' ');
    const field = spaceIdx !== -1 ? msg.slice(0, spaceIdx) : 'unknown';
    (acc[field] ??= []).push(msg);
    return acc;
  }, {});

  return { fields };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId = request.headers['x-request-id'] as string | undefined;

    const { status, body } = this.handle(exception, request);

    // Single capture policy: server faults (5xx) go to Sentry; client errors
    // (4xx) are expected and stay out of the error stream.
    if (status >= 500) {
      Sentry.captureException(exception);
    }

    response.status(status).json({ error: { ...body, requestId } });
  }

  private handle(exception: unknown, request: Request): HandledError {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.handlePrismaKnown(exception, request);
    }
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid data supplied to the database',
          statusCode: HttpStatus.BAD_REQUEST,
          details: {},
        },
      };
    }
    if (exception instanceof HttpException) {
      return this.handleHttp(exception);
    }
    return this.handleUnknown(exception, request);
  }

  private handlePrismaKnown(
    exception: Prisma.PrismaClientKnownRequestError,
    request: Request,
  ): HandledError {
    const { code, meta } = exception;

    if (code === 'P2002') {
      const fields = Array.isArray(meta?.['target'])
        ? (meta['target'] as string[])
        : [];
      return {
        status: HttpStatus.CONFLICT,
        body: {
          code: ERROR_CODES.CONFLICT,
          message: 'A record with these details already exists',
          statusCode: HttpStatus.CONFLICT,
          details: { fields },
        },
      };
    }

    if (code === 'P2025') {
      return {
        status: HttpStatus.NOT_FOUND,
        body: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Record not found',
          statusCode: HttpStatus.NOT_FOUND,
          details: {},
        },
      };
    }

    if (code === 'P2003') {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          code: ERROR_CODES.BAD_REQUEST,
          message: 'Related record not found',
          statusCode: HttpStatus.BAD_REQUEST,
          details: { field: meta?.['field_name'] ?? 'unknown' },
        },
      };
    }

    this.logger.error(
      `Prisma error ${code} on ${request.method} ${request.url}`,
      exception.stack,
    );
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: ERROR_CODES.INTERNAL_SERVER_ERROR,
        message: 'A database error occurred',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        details: {},
      },
    };
  }

  private handleHttp(exception: HttpException): HandledError {
    const status = exception.getStatus();
    const raw = exception.getResponse();

    if (exception instanceof BadRequestException) {
      // class-validator throws an array of field messages (genericized to
      // "Validation failed" with per-field details); a manual
      // `new BadRequestException('business rule message')` carries a single
      // string we surface verbatim so callers see the real reason.
      const isFieldValidation =
        isValidationErrorResponse(raw) && Array.isArray(raw.message);
      return {
        status,
        body: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: isFieldValidation ? 'Validation failed' : exception.message,
          statusCode: status,
          details: isFieldValidation ? buildValidationDetails(raw) : {},
        },
      };
    }

    const message =
      isValidationErrorResponse(raw) && typeof raw.message === 'string'
        ? raw.message
        : exception.message;

    const rawCode = readString(raw, 'code');
    const errorCode =
      rawCode !== null &&
      (Object.values(ERROR_CODES) as string[]).includes(rawCode)
        ? (rawCode as ErrorCode)
        : resolveCode(status);

    return {
      status,
      body: {
        code: errorCode,
        message,
        statusCode: status,
        details: readObject(raw, 'details') ?? {},
      },
    };
  }

  private handleUnknown(exception: unknown, request: Request): HandledError {
    this.logger.error(
      `Unhandled exception on ${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: ERROR_CODES.INTERNAL_SERVER_ERROR,
        message: 'An unexpected error occurred',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        details: {},
      },
    };
  }
}
