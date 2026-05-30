/**
 * Single source of truth for the per-ANC `VisitPregnancyRecord` writable
 * columns, grouped by the UI section that owns them.
 *
 * Consumed by:
 *  - `PregnancyService.toVisitData` — flattened whitelist for the bulk PATCH.
 *  - `AmendmentsService` — per-section column allow-list when amending a
 *    closed visit's pregnancy record.
 *
 * Keep the grouping here; do not re-declare the column names elsewhere.
 */
export const PREGNANCY_VISIT_SECTIONS = [
  'cervix',
  'warning-symptoms',
  'fundal',
  'amniotic-placenta',
  'fetal-lie',
  'biometrics',
] as const;

export type PregnancyVisitSection = (typeof PREGNANCY_VISIT_SECTIONS)[number];

export const PREGNANCY_VISIT_SECTION_SET: ReadonlySet<string> = new Set(
  PREGNANCY_VISIT_SECTIONS,
);

export const PREGNANCY_VISIT_COLUMNS: Record<
  PregnancyVisitSection,
  readonly string[]
> = {
  cervix: [
    'cervix_length_mm',
    'cervix_dilatation_cm',
    'cervix_effacement_pct',
    'cervix_position',
    'membranes',
  ],
  'warning-symptoms': ['warning_symptoms'],
  fundal: ['fundal_height_cm', 'fundal_corresponds_ga'],
  'amniotic-placenta': [
    'amniotic_fluid',
    'placenta_location',
    'placenta_grade',
  ],
  'fetal-lie': ['fetal_lie', 'presentation', 'engagement'],
  biometrics: [
    'fetal_heart_rate_bpm',
    'fetal_rhythm',
    'fetal_movements',
    'bpd_mm',
    'hc_mm',
    'ac_mm',
    'fl_mm',
    'efw_g',
    'growth_percentile',
    'growth_impression',
  ],
};

/** Flattened allow-list of every writable VisitPregnancyRecord column. */
export const PREGNANCY_VISIT_WRITABLE_COLUMNS: readonly string[] =
  Object.values(PREGNANCY_VISIT_COLUMNS).flat();

/** Columns persisted as JSON (everything else is a scalar column). */
export const PREGNANCY_VISIT_JSON_COLUMNS: ReadonlySet<string> = new Set([
  'warning_symptoms',
]);
