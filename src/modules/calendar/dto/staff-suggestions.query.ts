import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class StaffSuggestionsQueryDto {
  @ApiProperty({
    description:
      'JobFunction code to filter candidates by (e.g. "ANESTHESIOLOGIST", "PEDIATRICIAN").',
  })
  @IsString()
  @IsNotEmpty()
  job_function!: string;

  @ApiProperty({ description: 'Branch ID where the event will take place.' })
  @IsUUID('4')
  branch_id!: string;

  @ApiProperty({ description: 'Window start (ISO datetime).' })
  @IsDateString()
  starts_at!: string;

  @ApiProperty({ description: 'Window end (ISO datetime).' })
  @IsDateString()
  ends_at!: string;
}
