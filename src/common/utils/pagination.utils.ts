import type {
  PaginatedPayload,
  PaginationMeta,
} from '../dto/api-response.dto.js';

export interface PaginateOptions {
  page: number;
  limit: number;
  total: number;
}

export function buildPaginationMeta({
  page,
  limit,
  total,
}: PaginateOptions): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

export function paginated<T>(
  items: T[],
  options: PaginateOptions,
): PaginatedPayload<T> {
  return {
    items,
    meta: buildPaginationMeta(options),
  };
}
