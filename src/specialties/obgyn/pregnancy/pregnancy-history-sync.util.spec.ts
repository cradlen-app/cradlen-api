import { historyRowPatchForClose } from './pregnancy-history-sync.util';
import { PregnancyOutcomeDto } from './dto/pregnancy-activation.dto';

const NOW = new Date('2026-07-16T10:00:00Z');

const NO_DATING = {
  lmp: null,
  us_dating_date: null,
  us_ga_weeks: null,
  us_ga_days: null,
};

function outcome(partial: Partial<PregnancyOutcomeDto>): PregnancyOutcomeDto {
  return { outcome_type: 'LIVE_BIRTH', ...partial } as PregnancyOutcomeDto;
}

describe('historyRowPatchForClose', () => {
  describe('outcome mapping', () => {
    it.each([
      ['LIVE_BIRTH', 'LIVE_BIRTH'],
      ['MISCARRIAGE', 'MISCARRIAGE'],
      ['STILLBIRTH', 'STILLBIRTH'],
      ['ECTOPIC', 'ECTOPIC'],
      ['TERMINATION', 'ABORTION'],
      ['TRANSFERRED', 'OTHER'],
      ['LOST_TO_FOLLOWUP', 'OTHER'],
      ['OTHER', 'OTHER'],
    ] as const)('%s → %s', (outcomeType, expected) => {
      const patch = historyRowPatchForClose(
        outcome({ outcome_type: outcomeType }),
        NO_DATING,
        NOW,
      );
      expect(patch.outcome).toBe(expected);
    });
  });

  describe('delivery mode', () => {
    it.each([
      ['VAGINAL', 'VAGINAL'],
      ['CESAREAN', 'CESAREAN'],
      ['ASSISTED', 'ASSISTED_VAGINAL'],
    ] as const)('LIVE_BIRTH %s → %s', (mode, expected) => {
      const patch = historyRowPatchForClose(
        outcome({ outcome_type: 'LIVE_BIRTH', delivery_mode: mode }),
        NO_DATING,
        NOW,
      );
      expect(patch.mode_of_delivery).toBe(expected);
    });

    it('is omitted for non-live-birth outcomes even when supplied', () => {
      const patch = historyRowPatchForClose(
        outcome({ outcome_type: 'STILLBIRTH', delivery_mode: 'VAGINAL' }),
        NO_DATING,
        NOW,
      );
      expect(patch.mode_of_delivery).toBeUndefined();
    });
  });

  describe('outcome date', () => {
    it('uses outcome.date when supplied', () => {
      const patch = historyRowPatchForClose(
        outcome({ date: '2026-07-01' }),
        NO_DATING,
        NOW,
      );
      expect(patch.birth_date).toBe('2026-07-01');
    });

    it('falls back to now', () => {
      const patch = historyRowPatchForClose(outcome({}), NO_DATING, NOW);
      expect(patch.birth_date).toBe('2026-07-16');
    });
  });

  describe('gestational age at close', () => {
    it('derives from LMP when only LMP is set', () => {
      // LMP 2026-01-01 → 2026-07-16 is 196 days = 28w0d.
      const patch = historyRowPatchForClose(
        outcome({}),
        { ...NO_DATING, lmp: new Date('2026-01-01') },
        NOW,
      );
      expect(patch.gestational_age_weeks).toBe(28);
    });

    it('prefers US dating over LMP', () => {
      // Scan on 2026-06-01 measured 30w0d → at 2026-07-16 (45 days later)
      // GA = 210 + 45 = 255 days = 36w3d. LMP would give 28w.
      const patch = historyRowPatchForClose(
        outcome({}),
        {
          lmp: new Date('2026-01-01'),
          us_dating_date: new Date('2026-06-01'),
          us_ga_weeks: 30,
          us_ga_days: 0,
        },
        NOW,
      );
      expect(patch.gestational_age_weeks).toBe(36);
    });

    it('computes GA as of the outcome date, not now', () => {
      // LMP 2026-01-01 → outcome date 2026-05-21 is 140 days = 20w0d.
      const patch = historyRowPatchForClose(
        outcome({ outcome_type: 'STILLBIRTH', date: '2026-05-21' }),
        { ...NO_DATING, lmp: new Date('2026-01-01') },
        NOW,
      );
      expect(patch.gestational_age_weeks).toBe(20);
    });

    it('is omitted entirely when no dating exists (never a false 0)', () => {
      const patch = historyRowPatchForClose(outcome({}), NO_DATING, NOW);
      expect('gestational_age_weeks' in patch).toBe(false);
    });
  });

  it('carries the outcome notes when present', () => {
    const patch = historyRowPatchForClose(
      outcome({ notes: 'uneventful delivery' }),
      NO_DATING,
      NOW,
    );
    expect(patch.notes).toBe('uneventful delivery');
  });
});
