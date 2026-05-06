import { IsEnum } from 'class-validator';
import { EpisodeStatus } from '@prisma/client';

export class UpdateEpisodeStatusDto {
  @IsEnum(['ACTIVE', 'COMPLETED']) status: Extract<
    EpisodeStatus,
    'ACTIVE' | 'COMPLETED'
  >;
}
