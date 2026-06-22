import { Test, TestingModule } from '@nestjs/testing';
import { JourneySummaryService } from './journey-summary.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.service';
import { ObgynHistoryService } from '../patient-history/obgyn-history.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';

const user = {
  organizationId: 'org-A',
  profileId: 'p1',
} as unknown as AuthContext;
const PATIENT = 'patient-1';

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

describe('JourneySummaryService', () => {
  let service: JourneySummaryService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let history: { readEnvelope: jest.Mock };

  beforeEach(async () => {
    db = {
      patientJourney: { findFirst: jest.fn() },
      visit: { findFirst: jest.fn().mockResolvedValue(null) },
      pregnancyEpisodeRecord: { findMany: jest.fn().mockResolvedValue([]) },
    };
    history = {
      readEnvelope: jest.fn().mockResolvedValue({ blood_group_rh: 'O+' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JourneySummaryService,
        { provide: PrismaService, useValue: { db } },
        {
          provide: PatientAccessService,
          useValue: {
            assertPatientAccessible: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: ObgynHistoryService, useValue: history },
      ],
    }).compile();
    service = module.get(JourneySummaryService);
  });

  it('returns journey_exists=false when the patient has no journey', async () => {
    db.patientJourney.findFirst.mockResolvedValue(null);
    const res = await service.getActiveJourneySummary(PATIENT, user);
    expect(res.journey_exists).toBe(false);
    expect(res.identifier).toBeNull();
  });

  it('summarizes an ACTIVE pregnancy with identifier + risk flag', async () => {
    db.patientJourney.findFirst.mockResolvedValue({
      id: 'j-preg',
      status: 'ACTIVE',
      started_at: daysAgo(140),
      ended_at: null,
      care_path: { code: 'OBGYN_PREGNANCY', name: 'Pregnancy' },
      episodes: [
        { id: 'e2', name: 'Second Trimester', order: 2, status: 'ACTIVE' },
      ],
      pregnancy_record: {
        status: 'ACTIVE',
        risk_level: 'HIGH',
        lmp: daysAgo(140), // ~20w → Second Trimester
        us_dating_date: null,
        us_ga_weeks: null,
        us_ga_days: null,
        pregnancy_type: 'SINGLETON',
        number_of_fetuses: 1,
        delivery_plan: null,
      },
    });

    const res = await service.getActiveJourneySummary(PATIENT, user);

    expect(res.journey_exists).toBe(true);
    expect(res.is_active).toBe(true);
    expect(res.care_path_code).toBe('OBGYN_PREGNANCY');
    expect(res.current_episode?.name).toBe('Second Trimester');
    expect(res.identifier?.ga).toBeTruthy();
    expect(res.identifier?.ga_source).toBe('LMP');
    expect(res.identifier?.edd).toBeTruthy();
    expect(res.identifier?.blood_group_rh).toBe('O+');
    expect(res.flags).toContainEqual({ label: 'High risk', severity: 'high' });
    expect(res.outcome).toBeNull();
  });

  it('summarizes an ACTIVE General GYN journey via the encounter block (no identifier)', async () => {
    db.patientJourney.findFirst.mockResolvedValue({
      id: 'j-gyn',
      status: 'ACTIVE',
      started_at: daysAgo(2),
      ended_at: null,
      care_path: { code: 'OBGYN_GENERAL', name: 'General GYN' },
      episodes: [
        { id: 'e1', name: 'General Consultation', order: 1, status: 'ACTIVE' },
      ],
      pregnancy_record: null,
    });
    db.visit.findFirst.mockResolvedValue({
      encounter: {
        chief_complaint: 'Pelvic pain',
        provisional_diagnosis: 'Ovarian cyst',
      },
    });

    const res = await service.getActiveJourneySummary(PATIENT, user);

    expect(res.identifier).toBeNull();
    expect(res.encounter).toEqual({
      chief_complaint: 'Pelvic pain',
      provisional_diagnosis: 'Ovarian cyst',
    });
    expect(res.narrative).toContain('Pelvic pain');
    expect(history.readEnvelope).not.toHaveBeenCalled();
  });

  it('falls back to the most-recent COMPLETED pregnancy and surfaces the outcome', async () => {
    db.patientJourney.findFirst
      .mockResolvedValueOnce(null) // no ACTIVE
      .mockResolvedValueOnce({
        id: 'j-done',
        status: 'COMPLETED',
        started_at: daysAgo(300),
        ended_at: daysAgo(5),
        care_path: { code: 'OBGYN_PREGNANCY', name: 'Pregnancy' },
        episodes: [
          { id: 'e4', name: 'Delivery', order: 4, status: 'COMPLETED' },
        ],
        pregnancy_record: {
          status: 'CLOSED',
          risk_level: 'NORMAL',
          lmp: daysAgo(300),
          us_dating_date: null,
          us_ga_weeks: null,
          us_ga_days: null,
          pregnancy_type: 'SINGLETON',
          number_of_fetuses: 1,
          delivery_plan: {
            outcome_type: 'LIVE_BIRTH',
            delivery_mode: 'VAGINAL',
          },
        },
      });

    const res = await service.getActiveJourneySummary(PATIENT, user);

    expect(res.is_active).toBe(false);
    expect(res.status).toBe('COMPLETED');
    expect(res.outcome).toEqual({
      outcome_type: 'LIVE_BIRTH',
      delivery_mode: 'VAGINAL',
    });
    expect(res.flags).toContainEqual({
      label: 'Live birth',
      severity: 'positive',
    });
  });
});
