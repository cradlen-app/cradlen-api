/** A single metric with its current value and the value at the start of this month. */
export class StaffStatMetricDto {
  current!: number;
  previous!: number;
}

/**
 * Active-staff count for one role, keyed by the role **code** (`OWNER`,
 * `BRANCH_MANAGER`, `STAFF`). The breakdown is discovered from the
 * data — a role with no staff at this branch simply doesn't appear, so new role
 * codes surface here without code changes. `role_name` is the DB display name;
 * the client prefers its own localized role label and falls back to this.
 */
export class RoleStatDto {
  role_code!: string;
  role_name!: string;
  current!: number;
  previous!: number;
}

export class StaffStatsDto {
  total!: StaffStatMetricDto;
  /** Dynamic, data-driven list (not a fixed-length enum list). */
  by_role!: RoleStatDto[];
  /** Staff holding at least one clinical job function. */
  clinical!: StaffStatMetricDto;
}
