import {
  PortalHistoryEntryDto,
  PortalHistoryGroupDto,
  PortalHistoryRowDto,
  PortalHistorySectionDto,
} from './dto/portal-history.dto';

/**
 * Pure composer: turns the active `obgyn_patient_history` form template +
 * the patient's history envelope into display-ready groups/sections/rows.
 *
 * Labels, ordering, and enum→display mappings all come from the template (the
 * single source of truth), so the portal output truly mirrors the clinician
 * surface without a hand-maintained parallel label dictionary. No I/O here —
 * the service loads the template + envelope and calls this.
 */

/** Top-level binding segments that are repeatable child collections. */
const CHILD_COLLECTION_KEYS = new Set([
  'pregnancies',
  'contraceptives',
  'non_gyn_surgeries',
  'family_members',
  'medications',
  'allergies',
]);

/** Internal helper fields never surfaced to the patient (resolved id targets). */
const SKIP_FIELD_PATHS = new Set(['medications.medication_id']);

export interface TemplateFieldInput {
  label: string;
  binding_path: string | null;
  config: unknown;
}

export interface TemplateSectionInput {
  code: string;
  name: string;
  is_repeatable: boolean;
  fields: TemplateFieldInput[];
}

type HistoryEnvelope = Record<string, unknown> & { version?: number };

export function composeObgynHistoryGroup(
  sections: TemplateSectionInput[],
  envelope: HistoryEnvelope,
): PortalHistoryGroupDto {
  const composed = sections
    .map((section) => composeSection(section, envelope))
    .filter((s): s is PortalHistorySectionDto => s !== null);

  const versionRaw = envelope.version;

  return {
    code: 'OBGYN',
    label: 'OB/GYN History',
    version: typeof versionRaw === 'number' ? versionRaw : null,
    sections: composed,
  };
}

function composeSection(
  section: TemplateSectionInput,
  envelope: HistoryEnvelope,
): PortalHistorySectionDto | null {
  const fields = section.fields.filter(
    (f) => f.binding_path && !SKIP_FIELD_PATHS.has(f.binding_path),
  );
  if (fields.length === 0) return null;

  if (section.is_repeatable) {
    return composeRepeatableSection(section, fields, envelope);
  }
  return composeSingletonSection(section, fields, envelope);
}

function composeSingletonSection(
  section: TemplateSectionInput,
  fields: TemplateFieldInput[],
  envelope: HistoryEnvelope,
): PortalHistorySectionDto | null {
  const rows: PortalHistoryRowDto[] = [];
  for (const field of fields) {
    const value = getByPath(envelope, field.binding_path!);
    const formatted = formatValue(value, readOptions(field.config));
    if (formatted !== null) rows.push({ label: field.label, value: formatted });
  }
  if (rows.length === 0) return null;
  return {
    code: section.code,
    label: section.name,
    entries: [{ title: null, rows }],
  };
}

function composeRepeatableSection(
  section: TemplateSectionInput,
  fields: TemplateFieldInput[],
  envelope: HistoryEnvelope,
): PortalHistorySectionDto | null {
  const collectionKey = fields[0].binding_path!.split('.')[0];
  if (!CHILD_COLLECTION_KEYS.has(collectionKey)) return null;

  const collection = envelope[collectionKey];
  if (!Array.isArray(collection) || collection.length === 0) return null;

  const entries: PortalHistoryEntryDto[] = [];
  for (const record of collection) {
    const rows: PortalHistoryRowDto[] = [];
    for (const field of fields) {
      const tail = field.binding_path!.split('.').slice(1).join('.');
      const value = getByPath(record, tail);
      const formatted = formatValue(value, readOptions(field.config));
      if (formatted !== null) {
        rows.push({ label: field.label, value: formatted });
      }
    }
    if (rows.length > 0) entries.push({ title: deriveTitle(rows), rows });
  }

  if (entries.length === 0) return null;
  return { code: section.code, label: section.name, entries };
}

/** Title for a repeatable record: the first one or two non-empty row values. */
function deriveTitle(rows: PortalHistoryRowDto[]): string | null {
  const parts = rows
    .slice(0, 2)
    .map((r) => r.value)
    .filter((v) => v.length > 0);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function getByPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

/** `null` means "empty — omit this row". */
function formatValue(
  value: unknown,
  options: Map<string, string> | null,
): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => formatScalar(v, options))
      .filter((s): s is string => s !== null && s.length > 0);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  const scalar = formatScalar(value, options);
  return scalar === '' ? null : scalar;
}

function formatScalar(
  value: unknown,
  options: Map<string, string> | null,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return '';
    const mapped = options?.get(trimmed);
    if (mapped) return mapped;
    // ISO datetime → calendar date.
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
    return trimmed;
  }
  return null;
}

/** Build a code→label map from a field's SELECT/MULTISELECT options, if any. */
function readOptions(config: unknown): Map<string, string> | null {
  if (typeof config !== 'object' || config === null) return null;
  const validation = (config as Record<string, unknown>).validation;
  if (typeof validation !== 'object' || validation === null) return null;
  const options = (validation as Record<string, unknown>).options;
  if (!Array.isArray(options)) return null;

  const map = new Map<string, string>();
  for (const opt of options) {
    if (opt && typeof opt === 'object') {
      const code = (opt as Record<string, unknown>).code;
      const label = (opt as Record<string, unknown>).label;
      if (typeof code === 'string' && typeof label === 'string') {
        map.set(code, label);
      }
    }
  }
  return map.size > 0 ? map : null;
}
