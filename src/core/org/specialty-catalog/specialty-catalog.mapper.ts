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
