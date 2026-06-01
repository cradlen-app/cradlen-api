import { Injectable } from '@nestjs/common';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public';
import {
  GtpalDto,
  HistorySummaryFlagDto,
  HistorySummarySectionDto,
  ObgynHistorySummaryDto,
  SummarySignalSeverity,
} from './dto/obgyn-history-summary.dto';

// ---- JSON section shapes (cast through `unknown` from Prisma.JsonValue) -----
interface ObstetricSummary {
  gravida?: number;
  para?: number;
  abortion?: number;
  ectopic?: number;
  stillbirths?: number;
}
interface CodeItems {
  items?: string[];
}
interface ScreeningHistory {
  pap_smear?: string | null;
  pap_smear_date?: string | null;
  mammography?: string | null;
  mammography_date?: string | null;
  last_colonoscopy?: string | null;
  last_bone_density?: string | null;
}
interface SocialHistory {
  smoking?: string;
  smoking_status?: string;
  alcohol?: string;
  recreational_drugs?: string;
}
interface GynBaseline {
  dysmenorrhea?: boolean;
  lmp?: string | null;
}
interface FieldOption {
  code: string;
  label: string;
}
interface FieldConfig {
  validation?: { options?: FieldOption[] };
}

type LabelMap = Map<string, Map<string, string>>;

const GYN_CANCER_CONDITIONS = [
  'BREAST_CANCER',
  'OVARIAN_CANCER',
  'UTERINE_CANCER',
  'CERVICAL_CANCER',
];

// Prioritized clinical-signal taxonomy (ported from the former FE clinical-digest).
const SIGNAL_PRIORITIES: Record<
  string,
  { priority: number; severity: SummarySignalSeverity }
> = {
  ectopic: { priority: 95, severity: 'high' },
  recurrent_abortion: { priority: 90, severity: 'high' },
  stillbirth: { priority: 85, severity: 'high' },
  allergy_severe: { priority: 90, severity: 'high' },
  allergy_moderate: { priority: 75, severity: 'medium' },
  allergy_mild: { priority: 60, severity: 'low' },
  dm: { priority: 88, severity: 'high' },
  htn: { priority: 88, severity: 'high' },
  epilepsy: { priority: 80, severity: 'high' },
  thyroid: { priority: 72, severity: 'medium' },
  chronic_default: { priority: 65, severity: 'medium' },
  family_gyn_cancer: { priority: 82, severity: 'high' },
  dysmenorrhea: { priority: 55, severity: 'medium' },
  smoking_current: { priority: 68, severity: 'medium' },
  smoking_former: { priority: 40, severity: 'low' },
  screening_not_done: { priority: 50, severity: 'medium' },
  no_allergies: { priority: 20, severity: 'positive' },
};

function normalizeChronic(item: string): string {
  const s = item.toLowerCase();
  if (s.includes('diabet')) return 'dm';
  if (s.includes('hypertens') || s === 'htn') return 'htn';
  if (s.includes('thyroid')) return 'thyroid';
  if (s.includes('epilep') || s.includes('seizure')) return 'epilepsy';
  return 'chronic_default';
}

function ageFromDob(dob: Date | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(
    (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.2425),
  );
}

interface Signal {
  key: string;
  label: string;
  priority: number;
  severity: SummarySignalSeverity;
}

@Injectable()
export class HistorySummaryService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: PatientAccessService,
  ) {}

  async getObgynHistorySummary(
    patientId: string,
    user: AuthContext,
  ): Promise<ObgynHistorySummaryDto> {
    await this.access.assertPatientInOrg(patientId, user);
    const db = this.prismaService.db;
    const where = { patient_id: patientId, is_deleted: false };

    const [
      history,
      pregnancies,
      surgeries,
      family,
      allergies,
      meds,
      patient,
      lmpEncounters,
      labels,
    ] = await Promise.all([
      db.patientObgynHistory.findUnique({
        where: { patient_id: patientId, is_deleted: false },
        select: {
          obstetric_summary: true,
          gynecological_baseline: true,
          gynecologic_conditions: true,
          gynecologic_procedures: true,
          medical_chronic_illnesses: true,
          screening_history: true,
          social_history: true,
          blood_group_rh: true,
        },
      }),
      db.patientPregnancyHistory.findMany({
        where,
        select: {
          outcome: true,
          gestational_age_weeks: true,
          neonatal_outcome: true,
        },
      }),
      db.patientNonGynSurgery.findMany({
        where,
        select: { surgery_name: true },
      }),
      db.patientFamilyHistory.findMany({
        where,
        select: { condition: true, relative: true },
      }),
      db.patientAllergy.findMany({
        where,
        select: { allergy_to: true, severity: true },
      }),
      db.patientMedication.findMany({
        where: { ...where, is_ongoing: true },
        select: { drug_name: true, dose: true },
      }),
      db.patient.findUnique({
        where: { id: patientId },
        select: { date_of_birth: true },
      }),
      // Latest recorded LMP — lives on the visit examination
      // (VisitObgynEncounter.menstrual_findings.lmp), not in patient history.
      db.visitObgynEncounter.findMany({
        where: {
          is_deleted: false,
          visit: {
            is_deleted: false,
            episode: { journey: { patient_id: patientId } },
          },
        },
        orderBy: { created_at: 'desc' },
        take: 10,
        select: { menstrual_findings: true },
      }),
      this.loadLabelMap(),
    ]);

    const age = ageFromDob(patient?.date_of_birth ?? null);
    const bloodGroupRh = history?.blood_group_rh
      ? this.resolveOne(history.blood_group_rh, 'blood_group_rh', labels)
      : null;
    const lmpFromVisit =
      lmpEncounters
        .map(
          (e) =>
            (e.menstrual_findings as unknown as { lmp?: string } | null)?.lmp,
        )
        .find((v): v is string => !!v) ?? null;

    if (!history) {
      return {
        history_exists: false,
        identifier: {
          age,
          gtpal: null,
          gtpal_label: null,
          lmp: lmpFromVisit,
          blood_group_rh: bloodGroupRh,
        },
        sections: [],
        flags: [],
        narrative: '',
      };
    }

    const obs = history.obstetric_summary as unknown as ObstetricSummary | null;
    const gtpal = this.computeGtpal(obs, pregnancies);
    const gtpalLabel = gtpal
      ? `G${gtpal.g} T${gtpal.t} P${gtpal.p} A${gtpal.a} L${gtpal.l}`
      : null;
    const lmp =
      (history.gynecological_baseline as unknown as GynBaseline | null)?.lmp ??
      lmpFromVisit;

    const sections = this.buildSections(
      history,
      surgeries.map((s) => s.surgery_name).filter(Boolean),
      family,
      allergies,
      meds,
      labels,
    );
    const flags = this.buildFlags(
      history,
      obs,
      family,
      allergies,
      gtpal,
      labels,
    );
    const narrative = this.buildNarrative(age, gtpalLabel, sections);

    return {
      history_exists: true,
      identifier: {
        age,
        gtpal,
        gtpal_label: gtpalLabel,
        lmp,
        blood_group_rh: bloodGroupRh,
      },
      sections,
      flags,
      narrative,
    };
  }

  // ---------------------------------------------------------------------------
  // GTPAL
  // ---------------------------------------------------------------------------

  private computeGtpal(
    obs: ObstetricSummary | null,
    pregnancies: Array<{
      outcome: string | null;
      gestational_age_weeks: number | null;
      neonatal_outcome: string | null;
    }>,
  ): GtpalDto | null {
    if (pregnancies.length > 0) {
      let t = 0;
      let p = 0;
      let a = 0;
      let l = 0;
      for (const pr of pregnancies) {
        const outcome = (pr.outcome ?? '').toUpperCase();
        const neo = (pr.neonatal_outcome ?? '').toUpperCase();
        const ga = pr.gestational_age_weeks ?? null;
        if (['MISCARRIAGE', 'ABORTION', 'ECTOPIC'].includes(outcome)) {
          a += 1;
          continue;
        }
        if (outcome === 'ONGOING' || outcome === '') continue;
        // A delivery (live birth or stillbirth)
        if (ga !== null && ga < 20) {
          a += 1;
          continue;
        }
        if (ga !== null && ga < 37) p += 1;
        else t += 1;
        if (outcome === 'LIVE_BIRTH' || neo === 'LIVE_BIRTH') l += 1;
      }
      const g = obs?.gravida ?? pregnancies.length;
      return { g, t, p, a, l };
    }
    if (obs && (obs.gravida != null || obs.para != null)) {
      const para = obs.para ?? 0;
      const sb = obs.stillbirths ?? 0;
      return {
        g: obs.gravida ?? 0,
        t: para,
        p: 0,
        a: (obs.abortion ?? 0) + (obs.ectopic ?? 0),
        l: Math.max(0, para - sb),
      };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------

  private buildSections(
    history: {
      gynecologic_conditions: unknown;
      gynecologic_procedures: unknown;
      medical_chronic_illnesses: unknown;
      screening_history: unknown;
      social_history: unknown;
    },
    surgeryNames: string[],
    family: Array<{ condition: string; relative: string | null }>,
    allergies: Array<{ allergy_to: string; severity: string | null }>,
    meds: Array<{ drug_name: string; dose: string | null }>,
    labels: LabelMap,
  ): HistorySummarySectionDto[] {
    const sections: HistorySummarySectionDto[] = [];

    const gynConditions = this.resolveLabels(
      (history.gynecologic_conditions as CodeItems | null)?.items,
      'gynecologic_conditions.items',
      labels,
    );
    sections.push(
      this.section(
        'active_problems',
        'Active gyn problems',
        gynConditions,
        'No active gyn problems',
      ),
    );

    const pmhx = this.resolveLabels(
      (history.medical_chronic_illnesses as CodeItems | null)?.items,
      'medical_chronic_illnesses.items',
      labels,
    );
    sections.push(
      this.section(
        'pmhx',
        'Past medical history',
        pmhx,
        'No chronic illnesses',
      ),
    );

    const pshx = [
      ...this.resolveLabels(
        (history.gynecologic_procedures as CodeItems | null)?.items,
        'gynecologic_procedures.items',
        labels,
      ),
      ...surgeryNames,
    ];
    sections.push(
      this.section('pshx', 'Past surgical history', pshx, 'No prior surgeries'),
    );

    const medList = meds.map((m) => m.drug_name + (m.dose ? ` ${m.dose}` : ''));
    sections.push(
      this.section(
        'medications',
        'Medications',
        medList,
        'No regular medications',
      ),
    );

    const allergyList = allergies.map(
      (a) =>
        a.allergy_to + (a.severity ? ` (${a.severity.toLowerCase()})` : ''),
    );
    sections.push(
      this.section('allergies', 'Allergies', allergyList, 'No known allergies'),
    );

    const fhx = family.map((f) => {
      const cond = this.resolveOne(
        f.condition,
        'family_members.condition',
        labels,
      );
      return f.relative ? `${cond} (${f.relative})` : cond;
    });
    sections.push(
      this.section(
        'family_history',
        'Family history',
        fhx,
        'No significant family history',
      ),
    );

    sections.push(this.buildSocial(history.social_history));
    sections.push(this.buildScreening(history.screening_history, labels));

    return sections;
  }

  private buildSocial(socialRaw: unknown): HistorySummarySectionDto {
    const social = socialRaw as SocialHistory | null;
    const items: string[] = [];
    if (social) {
      const sm = (social.smoking ?? social.smoking_status ?? '').toUpperCase();
      if (sm && !['NEVER', 'NON_SMOKER', 'NO'].includes(sm)) {
        items.push(
          sm.includes('CURRENT') || sm === 'YES'
            ? 'Current smoker'
            : 'Former smoker',
        );
      }
      const al = (social.alcohol ?? '').toUpperCase();
      if (al === 'REGULAR') items.push('Regular alcohol use');
      const drugs = (social.recreational_drugs ?? '').trim();
      if (drugs && !/^(no|none)$/i.test(drugs)) items.push(`Drugs: ${drugs}`);
    }
    return this.section(
      'social',
      'Social',
      items,
      'No tobacco / alcohol / drugs',
    );
  }

  private buildScreening(
    screenRaw: unknown,
    labels: LabelMap,
  ): HistorySummarySectionDto {
    const screen = screenRaw as ScreeningHistory | null;
    const items: string[] = [];
    if (screen) {
      if (screen.pap_smear) {
        const v = this.resolveOne(
          screen.pap_smear,
          'screening_history.pap_smear',
          labels,
        ).toLowerCase();
        items.push(
          `Pap ${v}${screen.pap_smear_date ? ` (${screen.pap_smear_date})` : ''}`,
        );
      }
      if (screen.mammography) {
        const v = this.resolveOne(
          screen.mammography,
          'screening_history.mammography',
          labels,
        ).toLowerCase();
        items.push(
          `Mammogram ${v}${screen.mammography_date ? ` (${screen.mammography_date})` : ''}`,
        );
      }
      if (screen.last_colonoscopy)
        items.push(`Colonoscopy ${screen.last_colonoscopy}`);
      if (screen.last_bone_density)
        items.push(`Bone density ${screen.last_bone_density}`);
    }
    return this.section(
      'screening',
      'Screening',
      items,
      'Screening not recorded',
    );
  }

  private section(
    code: string,
    label: string,
    items: string[],
    negative: string,
  ): HistorySummarySectionDto {
    return items.length > 0
      ? { code, label, items, status: 'positive' }
      : { code, label, items: [negative], status: 'negative' };
  }

  // ---------------------------------------------------------------------------
  // Flags
  // ---------------------------------------------------------------------------

  private buildFlags(
    history: {
      gynecological_baseline: unknown;
      medical_chronic_illnesses: unknown;
      social_history: unknown;
      screening_history: unknown;
    },
    obs: ObstetricSummary | null,
    family: Array<{ condition: string }>,
    allergies: Array<{ allergy_to: string; severity: string | null }>,
    gtpal: GtpalDto | null,
    labels: LabelMap,
  ): HistorySummaryFlagDto[] {
    const signals: Signal[] = [];
    const push = (key: string, label: string) => {
      const meta = SIGNAL_PRIORITIES[key] ?? SIGNAL_PRIORITIES.chronic_default;
      signals.push({ key, label, ...meta });
    };

    if (obs) {
      if ((obs.ectopic ?? 0) > 0)
        push('ectopic', `Ectopic Hx (×${obs.ectopic})`);
      if ((obs.stillbirths ?? 0) > 0)
        push('stillbirth', `Stillbirth (×${obs.stillbirths})`);
    }
    if ((gtpal?.a ?? obs?.abortion ?? 0) >= 2)
      push(
        'recurrent_abortion',
        `Recurrent abortion (×${gtpal?.a ?? obs?.abortion})`,
      );

    for (const a of allergies) {
      const sev = a.severity?.toUpperCase();
      const key =
        sev === 'SEVERE'
          ? 'allergy_severe'
          : sev === 'MODERATE'
            ? 'allergy_moderate'
            : 'allergy_mild';
      push(
        key,
        a.allergy_to + (a.severity ? ` (${a.severity.toLowerCase()})` : ''),
      );
    }
    if (allergies.length === 0) push('no_allergies', 'No known allergies');

    const chronic = this.resolveLabels(
      (history.medical_chronic_illnesses as CodeItems | null)?.items,
      'medical_chronic_illnesses.items',
      labels,
    );
    for (const item of chronic) push(normalizeChronic(item), item);

    if (family.some((f) => GYN_CANCER_CONDITIONS.includes(f.condition)))
      push('family_gyn_cancer', 'GYN cancer FH');

    if ((history.gynecological_baseline as GynBaseline | null)?.dysmenorrhea)
      push('dysmenorrhea', 'Dysmenorrhea');

    const social = history.social_history as SocialHistory | null;
    if (social) {
      const sm = (social.smoking ?? social.smoking_status ?? '').toUpperCase();
      if (sm && !['NEVER', 'NON_SMOKER', 'NO'].includes(sm)) {
        push(
          sm.includes('CURRENT') || sm === 'YES'
            ? 'smoking_current'
            : 'smoking_former',
          sm.includes('CURRENT') || sm === 'YES'
            ? 'Current smoker'
            : 'Former smoker',
        );
      }
    }

    const screen = history.screening_history as ScreeningHistory | null;
    if (screen && !screen.pap_smear) push('screening_not_done', 'Pap not done');

    const seen = new Set<string>();
    return signals
      .sort((x, y) => y.priority - x.priority)
      .filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true)))
      .slice(0, 6)
      .map((s) => ({ label: s.label, severity: s.severity }));
  }

  // ---------------------------------------------------------------------------
  // Narrative
  // ---------------------------------------------------------------------------

  private buildNarrative(
    age: number | null,
    gtpalLabel: string | null,
    sections: HistorySummarySectionDto[],
  ): string {
    const parts: string[] = [];
    const ident = [age !== null ? `${age}yo` : null, gtpalLabel]
      .filter(Boolean)
      .join(' ');
    if (ident) parts.push(`${ident}.`);
    for (const s of sections) {
      if (s.status === 'positive')
        parts.push(`${s.label}: ${s.items.join(', ')}.`);
    }
    const negatives = sections
      .filter((s) => s.status === 'negative')
      .map((s) => s.items[0]);
    if (negatives.length > 0) parts.push(`${negatives.join('. ')}.`);
    return parts.join(' ');
  }

  // ---------------------------------------------------------------------------
  // Label resolution (from the active obgyn_patient_history template options)
  // ---------------------------------------------------------------------------

  private async loadLabelMap(): Promise<LabelMap> {
    const template = await this.prismaService.db.formTemplate.findFirst({
      where: {
        code: 'obgyn_patient_history',
        is_active: true,
        is_deleted: false,
      },
      select: {
        sections: {
          select: {
            fields: { select: { binding_path: true, config: true } },
          },
        },
      },
    });
    const map: LabelMap = new Map();
    if (!template) return map;
    for (const section of template.sections) {
      for (const field of section.fields) {
        if (!field.binding_path) continue;
        const opts = (field.config as unknown as FieldConfig)?.validation
          ?.options;
        if (!opts || opts.length === 0) continue;
        const inner = new Map<string, string>();
        for (const o of opts) inner.set(o.code, o.label);
        map.set(field.binding_path, inner);
      }
    }
    return map;
  }

  private resolveLabels(
    codes: string[] | undefined,
    path: string,
    labels: LabelMap,
  ): string[] {
    if (!Array.isArray(codes)) return [];
    const inner = labels.get(path);
    return codes
      .filter((c) => c && c !== 'NONE')
      .map((c) => inner?.get(c) ?? this.humanize(c));
  }

  private resolveOne(code: string, path: string, labels: LabelMap): string {
    return labels.get(path)?.get(code) ?? this.humanize(code);
  }

  private humanize(code: string): string {
    const s = code.replace(/_/g, ' ').toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
