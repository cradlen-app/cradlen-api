import { BadRequestException } from '@nestjs/common';

/**
 * Generic guard for a status state-machine. Throws `BadRequestException` (with
 * the caller-supplied message) when `next` is not an allowed transition from
 * `current` per `table`. Each caller keeps its own enum-typed table; only the
 * validation logic is shared.
 */
export function assertStatusTransition<S extends string>(
  table: Record<S, S[]>,
  current: S,
  next: S,
  message: (current: S, next: S) => string,
): void {
  if (!table[current].includes(next)) {
    throw new BadRequestException(message(current, next));
  }
}
