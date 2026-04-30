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

function isValidationErrorResponse(v: unknown): v is ValidationErrorResponse {
  return typeof v === 'object' && v !== null && 'message' in v;
}

function resolveCode(status: number): ErrorCode {
  const map: Partial<Record<number, ErrorCode>> = {
    [HttpStatus.BAD_REQUEST]: ERROR_CODES.BAD_REQUEST,
    [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHORIZED,
    [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
    [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
    [HttpStatus.CONFLICT]: ERROR_CODES.CONFLICT,
    [HttpStatus.UNPROCESSABLE_ENTITY]: ERROR_CODES.UNPROCESSABLE_ENTITY,
    [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.TOO_MANY_REQUESTS,
  };
  return map[status] ?? ERROR_CODES.INTERNAL_SERVER_ERROR;
}

function buildValidationDetails(raw: unknown): Record<string, unknown> {
  if (!isValidationErrorResponse(raw)) return {};

  const messages = Array.isArray(raw.message) ? raw.message : [raw.message];

  const fields = messages.reduce<Record<string, string[]>>((acc, msg) => {
    // class-validator messages are prefixed with the property name: "email must be..."
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

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorBody;

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const { code, meta } = exception;
      if (code === 'P2002') {
        const fields = Array.isArray(meta?.['target'])
          ? (meta['target'] as string[])
          : [];
        status = HttpStatus.CONFLICT;
        body = {
          code: ERROR_CODES.CONFLICT,
          message: 'A record with these details already exists',
          statusCode: status,
          details: { fields },
        };
      } else if (code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        body = {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Record not found',
          statusCode: status,
          details: {},
        };
      } else if (code === 'P2003') {
        status = HttpStatus.BAD_REQUEST;
        body = {
          code: ERROR_CODES.BAD_REQUEST,
          message: 'Related record not found',
          statusCode: status,
          details: { field: meta?.['field_name'] ?? 'unknown' },
        };
      } else {
        this.logger.error(
          `Prisma error ${code} on ${request.method} ${request.url}`,
          exception.stack,
        );
        body = {
          code: ERROR_CODES.INTERNAL_SERVER_ERROR,
          message: 'A database error occurred',
          statusCode: status,
          details: {},
        };
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      body = {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid data supplied to the database',
        statusCode: status,
        details: {},
      };
    } else if (exception instanceof BadRequestException) {
      const raw = exception.getResponse();
      status = exception.getStatus();
      body = {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Validation failed',
        statusCode: status,
        details: buildValidationDetails(raw),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const raw = exception.getResponse();
      const message =
        isValidationErrorResponse(raw) && typeof raw.message === 'string'
          ? raw.message
          : exception.message;
      const rawCode =
        raw !== null &&
        typeof raw === 'object' &&
        'code' in raw &&
        typeof (raw as Record<string, unknown>)['code'] === 'string'
          ? ((raw as Record<string, unknown>)['code'] as string)
          : null;
      const errorCode =
        rawCode !== null &&
        (Object.values(ERROR_CODES) as string[]).includes(rawCode)
          ? (rawCode as ErrorCode)
          : resolveCode(status);
      const rawDetails =
        raw !== null &&
        typeof raw === 'object' &&
        'details' in raw &&
        typeof (raw as Record<string, unknown>)['details'] === 'object' &&
        (raw as Record<string, unknown>)['details'] !== null
          ? ((raw as Record<string, unknown>)['details'] as Record<
              string,
              unknown
            >)
          : {};
      body = {
        code: errorCode,
        message,
        statusCode: status,
        details: rawDetails,
      };
    } else {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      body = {
        code: ERROR_CODES.INTERNAL_SERVER_ERROR,
        message: 'An unexpected error occurred',
        statusCode: status,
        details: {},
      };
    }

    response.status(status).json({ error: { ...body, requestId } });
  }
}
