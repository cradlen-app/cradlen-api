import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ErrorResponseDto, PaginationMetaDto } from './swagger-response.dto.js';

function commonErrorResponses() {
  return [
    ApiResponse({
      status: 400,
      description: 'Bad Request / Validation Error',
      schema: { $ref: getSchemaPath(ErrorResponseDto) },
    }),
    ApiResponse({
      status: 401,
      description: 'Unauthorized',
      schema: { $ref: getSchemaPath(ErrorResponseDto) },
    }),
    ApiResponse({
      status: 403,
      description: 'Forbidden',
      schema: { $ref: getSchemaPath(ErrorResponseDto) },
    }),
    ApiResponse({
      status: 404,
      description: 'Not Found',
      schema: { $ref: getSchemaPath(ErrorResponseDto) },
    }),
    ApiResponse({
      status: 500,
      description: 'Internal Server Error',
      schema: { $ref: getSchemaPath(ErrorResponseDto) },
    }),
  ];
}

export function ApiStandardResponse<T>(dataDto: Type<T>) {
  return applyDecorators(
    ApiExtraModels(ErrorResponseDto, dataDto),
    ApiResponse({
      status: 200,
      schema: {
        properties: {
          data: { $ref: getSchemaPath(dataDto) },
          meta: { type: 'object', example: {} },
        },
      },
    }),
    ...commonErrorResponses(),
  );
}

export function ApiPaginatedResponse<T>(dataDto: Type<T>) {
  return applyDecorators(
    ApiExtraModels(ErrorResponseDto, PaginationMetaDto, dataDto),
    ApiResponse({
      status: 200,
      schema: {
        properties: {
          data: {
            type: 'array',
            items: { $ref: getSchemaPath(dataDto) },
          },
          meta: { $ref: getSchemaPath(PaginationMetaDto) },
        },
      },
    }),
    ...commonErrorResponses(),
  );
}

export function ApiVoidResponse() {
  return applyDecorators(
    ApiExtraModels(ErrorResponseDto),
    ApiResponse({ status: 204, description: 'No Content' }),
    ...commonErrorResponses(),
  );
}
