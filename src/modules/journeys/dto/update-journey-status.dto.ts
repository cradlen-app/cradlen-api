import { IsEnum } from 'class-validator';
import { JourneyStatus } from '@prisma/client';

export class UpdateJourneyStatusDto {
  @IsEnum(['COMPLETED', 'CANCELLED']) status: Extract<
    JourneyStatus,
    'COMPLETED' | 'CANCELLED'
  >;
}
