/**
 * Canonical specialty projection shared across features. The `{ id, code, name }`
 * shape was previously copy-pasted in organizations, profiles, and invitations
 * mappers; this is the single source of truth.
 */
export interface SpecialtySummary {
  id: string;
  code: string;
  name: string;
}

export function toSpecialtySummary(specialty: {
  id: string;
  code: string;
  name: string;
}): SpecialtySummary {
  return {
    id: specialty.id,
    code: specialty.code,
    name: specialty.name,
  };
}

/**
 * Subspecialty projection. Carries the parent `specialty_code` so a client can
 * group subspecialties under their specialty without a second lookup. The
 * parent code is supplied by the caller — it is the holder's single specialty
 * (the parent-consistency invariant guarantees every subspecialty belongs to it).
 */
export interface SubspecialtySummary {
  id: string;
  code: string;
  name: string;
  specialty_code: string;
}

export function toSubspecialtySummary(
  subspecialty: { id: string; code: string; name: string },
  parentSpecialtyCode: string,
): SubspecialtySummary {
  return {
    id: subspecialty.id,
    code: subspecialty.code,
    name: subspecialty.name,
    specialty_code: parentSpecialtyCode,
  };
}
