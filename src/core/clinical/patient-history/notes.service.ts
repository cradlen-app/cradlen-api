import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NoteVisibility, PatientHistorySection, Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { PatientAccessService } from './patient-access.service';
import {
  CreateNoteDto,
  RedactedNoteCountDto,
  UpdateNoteDto,
} from './dto/note.dto';

@Injectable()
export class NotesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly patientAccess: PatientAccessService,
  ) {}

  /**
   * Returns:
   *   visible        — notes the caller may read (own org, OR shared globally)
   *   redacted_by_org — counts of foreign-org private notes per (org, section), so
   *                     other doctors know context exists without seeing it
   */
  async list(
    patientId: string,
    section: PatientHistorySection | undefined,
    user: AuthContext,
  ) {
    await this.patientAccess.assertPatientInOrg(patientId, user);

    const baseWhere: Prisma.PatientHistoryNoteWhereInput = {
      patient_id: patientId,
      is_deleted: false,
      ...(section ? { section } : {}),
    };

    const visible = await this.prismaService.db.patientHistoryNote.findMany({
      where: {
        ...baseWhere,
        OR: [
          { organization_id: user.organizationId },
          { visibility: NoteVisibility.SHARED_GLOBAL },
        ],
      },
      orderBy: { created_at: 'desc' },
    });

    // Foreign-org private notes — counts only.
    const foreignPrivate =
      await this.prismaService.db.patientHistoryNote.groupBy({
        by: ['organization_id', 'section'],
        where: {
          ...baseWhere,
          NOT: { organization_id: user.organizationId },
          visibility: NoteVisibility.PRIVATE_TO_ORG,
        },
        _count: { _all: true },
      });
    const orgIds = foreignPrivate.map((g) => g.organization_id);
    const orgs = orgIds.length
      ? await this.prismaService.db.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true },
        })
      : [];
    const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));

    const redacted: RedactedNoteCountDto[] = foreignPrivate.map((g) => ({
      organization_id: g.organization_id,
      organization_name: orgNameById.get(g.organization_id) ?? 'Unknown',
      section: g.section,
      count: g._count._all,
    }));

    return { visible, redacted_by_org: redacted };
  }

  async create(patientId: string, dto: CreateNoteDto, user: AuthContext) {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    return this.prismaService.db.patientHistoryNote.create({
      data: {
        patient_id: patientId,
        organization_id: user.organizationId,
        author_id: user.profileId,
        section: dto.section,
        content: dto.content,
        visibility: dto.visibility ?? NoteVisibility.PRIVATE_TO_ORG,
      },
    });
  }

  async update(id: string, dto: UpdateNoteDto, user: AuthContext) {
    const note = await this.loadOrThrow(id, user);
    if (note.author_id !== user.profileId) {
      throw new ForbiddenException('Only the note author can edit it');
    }
    return this.prismaService.db.patientHistoryNote.update({
      where: { id: note.id },
      data: {
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.visibility !== undefined && { visibility: dto.visibility }),
      },
    });
  }

  async remove(id: string, user: AuthContext) {
    const note = await this.loadOrThrow(id, user);
    if (note.author_id !== user.profileId) {
      throw new ForbiddenException('Only the note author can delete it');
    }
    await this.prismaService.db.patientHistoryNote.update({
      where: { id: note.id },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  private async loadOrThrow(id: string, user: AuthContext) {
    const note = await this.prismaService.db.patientHistoryNote.findUnique({
      where: { id, is_deleted: false },
    });
    if (
      !note ||
      (note.organization_id !== user.organizationId &&
        note.visibility !== NoteVisibility.SHARED_GLOBAL)
    ) {
      throw new NotFoundException(`Note ${id} not found`);
    }
    await this.patientAccess.assertPatientInOrg(note.patient_id, user);
    return note;
  }
}
