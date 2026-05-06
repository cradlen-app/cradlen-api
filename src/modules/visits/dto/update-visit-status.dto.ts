import { IsEnum } from 'class-validator';
import { VisitStatus } from '@prisma/client';

export class UpdateVisitStatusDto {
  @IsEnum(VisitStatus) status: VisitStatus;
}
