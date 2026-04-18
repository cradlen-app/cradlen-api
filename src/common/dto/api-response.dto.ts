export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  data: T;
  meta: Record<string, unknown> | PaginationMeta;
}

export interface PaginatedPayload<T> {
  items: T[];
  meta: PaginationMeta;
}

export function isPaginatedPayload<T>(
  value: unknown,
): value is PaginatedPayload<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    'meta' in value &&
    Array.isArray((value as PaginatedPayload<T>).items)
  );
}
