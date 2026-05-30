import { Prisma } from '@prisma/client';

/**
 * Shared `select` for the SPOUSE guardian flattened onto patient responses.
 * Reused by every query that surfaces the `spouse_*` fields so the projected
 * columns stay in sync with {@link flattenSpouse}.
 */
export const SPOUSE_GUARDIAN_SELECT = {
  id: true,
  full_name: true,
  national_id: true,
  phone_number: true,
} satisfies Prisma.GuardianSelect;

type SpouseGuardian = {
  id: string;
  full_name: string;
  national_id: string | null;
  phone_number: string | null;
};

export type SpouseFields =
  | {
      spouse_guardian_id: string;
      spouse_full_name: string;
      spouse_national_id: string | null;
      spouse_phone_number: string | null;
    }
  | Record<string, never>;

/**
 * Flattens the first SPOUSE guardian link (if any) into the `spouse_*` fields.
 * Returns an empty object when the patient has no spouse link, so the result
 * can be spread directly into a patient response.
 */
export function flattenSpouse(
  guardianLinks: Array<{ guardian: SpouseGuardian }>,
): SpouseFields {
  const spouse = guardianLinks[0]?.guardian ?? null;
  if (!spouse) return {};
  return {
    spouse_guardian_id: spouse.id,
    spouse_full_name: spouse.full_name,
    spouse_national_id: spouse.national_id,
    spouse_phone_number: spouse.phone_number,
  };
}

type EpisodeLike = { id: string; name: string; order: number };

/** Projects an episode row down to the `EpisodeSummaryDto` shape. */
export function toEpisodeSummary(episode: EpisodeLike): EpisodeSummary {
  return { id: episode.id, name: episode.name, order: episode.order };
}

export type EpisodeSummary = { id: string; name: string; order: number };
