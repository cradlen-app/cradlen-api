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
  readonly __paginatedPayload: true;
}

export function isPaginatedPayload<T>(
  value: unknown,
): value is PaginatedPayload<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __paginatedPayload?: unknown }).__paginatedPayload === true
  );
}
