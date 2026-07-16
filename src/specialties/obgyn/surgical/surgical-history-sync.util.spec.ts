import {
  historyRowPatchForSurgicalActivation,
  historyRowPatchForSurgicalClose,
} from './surgical-history-sync.util';
import { SurgicalOutcomeDto } from './dto/surgical-activation.dto';

const NOW = new Date('2026-07-16T10:00:00.000Z');

function record(
  overrides: Partial<{
    procedure_code: string | null;
    procedure_name: string | null;
    surgery_date: Date | null;
    planned_date: Date | null;
  }> = {},
) {
  return {
    procedure_code: null,
    procedure_name: null,
    surgery_date: null,
    planned_date: null,
    ...overrides,
  };
}

describe('historyRowPatchForSurgicalActivation', () => {
  it('files PLANNED with the drawer fields', () => {
    expect(
      historyRowPatchForSurgicalActivation({
        procedure_code: 'CESAREAN_SECTION',
        procedure_name: 'Cesarean section',
        surgery_date: '2026-08-01',
      }),
    ).toEqual({
      outcome: 'PLANNED',
      procedure_code: 'CESAREAN_SECTION',
      procedure_name: 'Cesarean section',
      surgery_date: '2026-08-01',
    });
  });

  it('falls back to the planned date when no surgery date is set', () => {
    expect(
      historyRowPatchForSurgicalActivation({
        procedure_name: 'Myomectomy',
        planned_date: '2026-09-15',
      }),
    ).toEqual({
      outcome: 'PLANNED',
      procedure_name: 'Myomectomy',
      surgery_date: '2026-09-15',
    });
  });

  it('prefers the surgery date over the planned date', () => {
    expect(
      historyRowPatchForSurgicalActivation({
        surgery_date: '2026-08-01',
        planned_date: '2026-09-15',
      }).surgery_date,
    ).toBe('2026-08-01');
  });

  it('omits every empty field — a bare activation is just PLANNED', () => {
    expect(historyRowPatchForSurgicalActivation({})).toEqual({
      outcome: 'PLANNED',
    });
  });

  it('accepts a SurgicalJourneyRecord-shaped source (Date columns, null fields)', () => {
    expect(
      historyRowPatchForSurgicalActivation({
        procedure_code: 'CESAREAN_SECTION',
        procedure_name: 'Cesarean section',
        surgery_date: new Date('2026-07-20T00:00:00.000Z'),
        planned_date: null,
      }),
    ).toEqual({
      outcome: 'PLANNED',
      procedure_code: 'CESAREAN_SECTION',
      procedure_name: 'Cesarean section',
      surgery_date: '2026-07-20',
    });
  });
});

describe('historyRowPatchForSurgicalClose', () => {
  const outcome = (
    over: Partial<SurgicalOutcomeDto> = {},
  ): SurgicalOutcomeDto =>
    ({ outcome_type: 'COMPLETED', ...over }) as SurgicalOutcomeDto;

  it.each([
    'COMPLETED',
    'ABORTED',
    'CONVERTED',
    'TRANSFERRED',
    'DECEASED',
    'OTHER',
  ] as const)('stores outcome_type %s 1:1 as the row outcome', (type) => {
    const patch = historyRowPatchForSurgicalClose(
      outcome({ outcome_type: type }),
      record(),
      NOW,
    );
    expect(patch.outcome).toBe(type);
  });

  it("prefers the record's surgery date over the outcome date", () => {
    const patch = historyRowPatchForSurgicalClose(
      outcome({ date: '2026-07-10' }),
      record({ surgery_date: new Date('2026-07-01T00:00:00.000Z') }),
      NOW,
    );
    expect(patch.surgery_date).toBe('2026-07-01');
  });

  it('uses the outcome date when the record has no surgery date', () => {
    const patch = historyRowPatchForSurgicalClose(
      outcome({ date: '2026-07-10' }),
      record(),
      NOW,
    );
    expect(patch.surgery_date).toBe('2026-07-10');
  });

  it('falls back to now when neither date exists', () => {
    const patch = historyRowPatchForSurgicalClose(outcome(), record(), NOW);
    expect(patch.surgery_date).toBe('2026-07-16');
  });

  it('carries the procedure fields for the append-at-close fallback', () => {
    const patch = historyRowPatchForSurgicalClose(
      outcome(),
      record({
        procedure_code: 'CESAREAN_SECTION',
        procedure_name: 'Cesarean section',
      }),
      NOW,
    );
    expect(patch.procedure_code).toBe('CESAREAN_SECTION');
    expect(patch.procedure_name).toBe('Cesarean section');
  });

  it('joins complications and carries notes; omits them when absent', () => {
    const withExtras = historyRowPatchForSurgicalClose(
      outcome({ complications: ['Bleeding', 'Infection'], notes: 'ICU 1d' }),
      record(),
      NOW,
    );
    expect(withExtras.complications).toBe('Bleeding, Infection');
    expect(withExtras.notes).toBe('ICU 1d');

    const bare = historyRowPatchForSurgicalClose(
      outcome({ complications: [] }),
      record(),
      NOW,
    );
    expect(bare).not.toHaveProperty('complications');
    expect(bare).not.toHaveProperty('notes');
    expect(bare).not.toHaveProperty('procedure_code');
    expect(bare).not.toHaveProperty('procedure_name');
  });
});
