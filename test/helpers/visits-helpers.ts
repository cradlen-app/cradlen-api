import type { PrismaClient, VisitStatus } from '@prisma/client';

/**
 * Clinical-visit integration helpers. Seed the journey → episode → visit graph
 * directly via Prisma (bypassing the form-template/specialty booking flow) so a
 * suite can stand up in-progress visits for a given doctor deterministically.
 */

export interface SeedVisitArgs {
  organizationId: string;
  branchId: string;
  /** Profile id used as `assigned_doctor_id` (the "doctor" the visit shows up for). */
  doctorProfileId: string;
  /** Profile id used as `created_by_id` — defaults to the doctor. */
  createdById?: string;
  patientName?: string;
  status?: VisitStatus;
  /** When omitted for IN_PROGRESS / IN_CONSULTATION, defaults to now. */
  startedAt?: Date | null;
  /** When omitted for IN_CONSULTATION, defaults to now. */
  consultationStartedAt?: Date | null;
  scheduledAt?: Date;
}

export interface SeededVisit {
  visitId: string;
  patientId: string;
}

/**
 * Create a patient + ACTIVE journey + ACTIVE episode and a single visit owned by
 * `doctorProfileId`. The `JourneyTemplate` / `EpisodeTemplate` lookups come from
 * the seeded data (global-setup runs `prisma db seed`), and are FK-valid for the
 * `my-current` query, which only reads `episode.journey` + the visit scalars.
 */
export async function seedVisit(
  prisma: PrismaClient,
  args: SeedVisitArgs,
): Promise<SeededVisit> {
  const createdById = args.createdById ?? args.doctorProfileId;
  const status: VisitStatus = args.status ?? 'IN_PROGRESS';

  const patient = await prisma.patient.create({
    data: {
      national_id: `nat-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      full_name: args.patientName ?? 'Visit Patient',
      date_of_birth: new Date('1990-01-01'),
      phone_number: '01000000000',
      address: '10 Nile St',
    },
  });

  const journeyTemplate = await prisma.journeyTemplate.findFirstOrThrow();
  const journey = await prisma.patientJourney.create({
    data: {
      patient_id: patient.id,
      organization_id: args.organizationId,
      journey_template_id: journeyTemplate.id,
      created_by_id: createdById,
      status: 'ACTIVE',
    },
  });

  const episodeTemplate = await prisma.episodeTemplate.findFirstOrThrow();
  const episode = await prisma.patientEpisode.create({
    data: {
      journey_id: journey.id,
      episode_template_id: episodeTemplate.id,
      name: 'General Consultation',
      order: 1,
      status: 'ACTIVE',
      started_at: new Date(),
    },
  });

  // started_at marks queue entry; it's set once a visit reaches IN_PROGRESS and
  // persists through IN_CONSULTATION. The "live" feeds bound on it for both.
  const startedAt =
    status === 'IN_PROGRESS' || status === 'IN_CONSULTATION'
      ? (args.startedAt ?? new Date())
      : (args.startedAt ?? null);

  const consultationStartedAt =
    status === 'IN_CONSULTATION'
      ? (args.consultationStartedAt ?? new Date())
      : (args.consultationStartedAt ?? null);

  const visit = await prisma.visit.create({
    data: {
      episode_id: episode.id,
      assigned_doctor_id: args.doctorProfileId,
      branch_id: args.branchId,
      created_by_id: createdById,
      appointment_type: 'VISIT',
      priority: 'NORMAL',
      status,
      scheduled_at: args.scheduledAt ?? new Date(),
      started_at: startedAt,
      consultation_started_at: consultationStartedAt,
    },
  });

  return { visitId: visit.id, patientId: patient.id };
}
