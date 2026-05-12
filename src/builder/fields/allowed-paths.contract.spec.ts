/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable import/no-restricted-paths */
/**
 * Contract test: the static `ALLOWED_PATHS` map must stay in sync with the
 * actual DTO classes it claims to describe. If a DTO field is renamed and the
 * map isn't updated, CI fails here — at the moment the rename happens — not
 * weeks later when someone tries to seed a new template.
 *
 * The `import/no-restricted-paths` rule is disabled for this spec only —
 * the test's whole purpose is cross-checking the builder/ contract against
 * the core/ DTOs it describes. Production code in builder/ must NEVER import
 * from core/ (see eslint.config.mjs).
 *
 * Strategy: enumerate class-validator metadata for each DTO target, build the
 * set of decorated property names, then assert the FIRST segment of every
 * `ALLOWED_PATHS[ns]` entry resolves to a real DTO property (top-level or
 * nested-via-@Type sub-DTO).
 */
import 'reflect-metadata';
import { getMetadataStorage } from 'class-validator';
import { ALLOWED_PATHS } from './allowed-paths';
import { BookVisitDto } from '../../core/clinical/visits/dto/book-visit.dto';
import { BookMedicalRepVisitDto } from '../../core/clinical/medical-rep/dto/book-medical-rep-visit.dto';
import { VisitIntakeFieldsDto } from '../../core/clinical/visits/dto/visit-intake.dto';
import { UpsertVitalsDto } from '../../core/clinical/clinical/dto/vitals.dto';
import { ChiefComplaintMetaDto } from '../../core/clinical/clinical/dto/encounter.dto';

type ClassRef = new (...args: any[]) => unknown;

function decoratedProps(target: ClassRef): Set<string> {
  // class-validator's internal storage: Map<target, ValidationMetadata[]>.
  // Each entry has `.propertyName`. We deduplicate to a set of names.
  // ts-jest can re-load source files through different module identities, so
  // fall back to matching by class name when identity doesn't match.
  const storage = getMetadataStorage() as unknown as {
    validationMetadatas: Map<ClassRef, Array<{ propertyName: string }>>;
  };
  let metas = storage.validationMetadatas.get(target);
  if (!metas) {
    for (const [k, v] of storage.validationMetadatas) {
      if (k.name === target.name) {
        metas = v;
        break;
      }
    }
  }
  return new Set((metas ?? []).map((m) => m.propertyName));
}

/**
 * Merges decorated properties from a class and every class in its prototype
 * chain. BookVisitDto extends VisitIntakeFieldsDto — the contract test needs
 * properties from both.
 */
function decoratedPropsIncludingAncestors(target: ClassRef): Set<string> {
  const out = new Set<string>();
  let current: ClassRef | null = target;
  while (current && (current as unknown) !== Object) {
    for (const p of decoratedProps(current)) out.add(p);
    current =
      (Object.getPrototypeOf(current.prototype)?.constructor as
        | ClassRef
        | undefined) ?? null;
    if (!current || (current as unknown) === Object) break;
  }
  return out;
}

describe('ALLOWED_PATHS ↔ DTO contract', () => {
  // Force the classes to register their decorators by referencing them once.
  // Without these no-op refs, ts-jest's lazy evaluation can leave the
  // class-validator metadata storage empty at the time `describe` builds its
  // sets below.

  void BookVisitDto;
  void BookMedicalRepVisitDto;
  void VisitIntakeFieldsDto;

  void UpsertVitalsDto;
  void ChiefComplaintMetaDto;

  const bookVisitProps = decoratedPropsIncludingAncestors(BookVisitDto);
  const bookRepProps = decoratedPropsIncludingAncestors(BookMedicalRepVisitDto);

  // INTAKE paths drill into nested DTOs — record each nested DTO's properties
  // so we can verify the second segment too (catches renames inside
  // UpsertVitalsDto or ChiefComplaintMetaDto).
  const intakeProps = decoratedPropsIncludingAncestors(VisitIntakeFieldsDto);
  const vitalsProps = decoratedProps(UpsertVitalsDto);
  const complaintMetaProps = decoratedProps(ChiefComplaintMetaDto);

  it('sanity: introspection actually found decorated properties', () => {
    if (process.env.DEBUG_CONTRACT) {
      console.log('vitalsProps:', [...vitalsProps]);
      console.log('complaintMetaProps:', [...complaintMetaProps]);
      console.log('intakeProps:', [...intakeProps]);
      console.log('bookVisitProps:', [...bookVisitProps]);
      console.log('bookRepProps:', [...bookRepProps]);
    }
    expect(vitalsProps.size).toBeGreaterThan(0);
    expect(complaintMetaProps.size).toBeGreaterThan(0);
    expect(bookVisitProps.size).toBeGreaterThan(0);
    expect(bookRepProps.size).toBeGreaterThan(0);
  });

  /**
   * Path may be 'field' or 'field.subfield'. The first segment must be a
   * decorated property on the target. For two-segment paths under
   * `chief_complaint_meta` or `vitals`, the second segment must be decorated
   * on the corresponding nested DTO.
   */
  function assertPathLandsOnDto(
    path: string,
    targetProps: Set<string>,
    targetLabel: string,
  ) {
    const [head, ...rest] = path.split('.');
    expect(targetProps.has(head)).toBe(true);

    if (rest.length === 0) return;

    if (head === 'vitals') {
      expect(vitalsProps.has(rest[0])).toBe(true);
    } else if (head === 'chief_complaint_meta') {
      expect(complaintMetaProps.has(rest[0])).toBe(true);
    } else {
      // No other nested namespace is allowed — surface the unexpected case.
      throw new Error(
        `${targetLabel}: unexpected nested path "${path}". ` +
          `Add a nested-DTO check for "${head}" or update ALLOWED_PATHS.`,
      );
    }
  }

  describe('BookVisitDto namespaces', () => {
    it('PATIENT paths land on BookVisitDto properties', () => {
      for (const path of ALLOWED_PATHS.PATIENT) {
        // PATIENT.id is the synthesized id of a created patient — never sent
        // as `id` on the booking DTO; the frontend submits patient_id instead.
        if (path === 'id') continue;
        assertPathLandsOnDto(path, bookVisitProps, `PATIENT.${path}`);
      }
    });

    it('VISIT paths land on BookVisitDto properties', () => {
      for (const path of ALLOWED_PATHS.VISIT) {
        // Visit.notes is service-side only (status updates) — not on book payload.
        if (path === 'notes') continue;
        assertPathLandsOnDto(path, bookVisitProps, `VISIT.${path}`);
      }
    });

    it('INTAKE paths land on VisitIntakeFieldsDto properties (top + nested)', () => {
      for (const path of ALLOWED_PATHS.INTAKE) {
        assertPathLandsOnDto(path, intakeProps, `INTAKE.${path}`);
      }
    });

    it('GUARDIAN paths land on BookVisitDto.spouse_<field> properties', () => {
      // GUARDIAN maps to spouse_* fields on BookVisitDto — the test asserts
      // the spouse_<path> form is declared.
      for (const path of ALLOWED_PATHS.GUARDIAN) {
        expect(bookVisitProps.has(`spouse_${path}`)).toBe(true);
      }
    });
  });

  describe('BookMedicalRepVisitDto namespace', () => {
    it('MEDICAL_REP paths land on BookMedicalRepVisitDto properties', () => {
      for (const path of ALLOWED_PATHS.MEDICAL_REP) {
        assertPathLandsOnDto(path, bookRepProps, `MEDICAL_REP.${path}`);
      }
    });
  });

  describe('client-only namespaces', () => {
    it('LOOKUP paths are submitted as top-level DTO properties (resolved IDs)', () => {
      expect(bookVisitProps.has('patient_id')).toBe(true);
      expect(bookRepProps.has('medical_rep_id')).toBe(true);
    });

    it('SYSTEM paths are NOT on any DTO (never persisted)', () => {
      for (const path of ALLOWED_PATHS.SYSTEM) {
        expect(bookVisitProps.has(path)).toBe(false);
        expect(bookRepProps.has(path)).toBe(false);
      }
    });

    it('COMPUTED leaf paths are NOT decorated on the wire DTOs (server recomputes them)', () => {
      // The "container" namespace (e.g. UpsertVitalsDto.vitals exists on
      // BookVisitDto via VisitIntakeFieldsDto), but the COMPUTED leaf field
      // itself MUST NOT be a decorated property — otherwise a client could
      // overwrite a server-authoritative value.
      for (const path of ALLOWED_PATHS.COMPUTED) {
        const segments = path.split('.');
        const leaf = segments[segments.length - 1];
        if (segments[0] === 'vitals') {
          expect(vitalsProps.has(leaf)).toBe(false);
        }
      }
    });
  });
});
