import { IsEnum, IsUUID } from 'class-validator';
import { CalendarParticipantRole } from '@prisma/client';

export class ParticipantDto {
  @IsUUID() profile_id!: string;
  @IsEnum(CalendarParticipantRole) role!: CalendarParticipantRole;
}
