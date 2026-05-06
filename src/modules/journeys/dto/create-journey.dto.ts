import { IsUUID } from 'class-validator';

export class CreateJourneyDto {
  @IsUUID() journey_template_id: string;
}
