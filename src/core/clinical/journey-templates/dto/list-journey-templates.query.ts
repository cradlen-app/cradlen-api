import { IsOptional, IsUUID } from 'class-validator';

export class ListJourneyTemplatesQueryDto {
  @IsOptional() @IsUUID() specialtyId?: string;
}
