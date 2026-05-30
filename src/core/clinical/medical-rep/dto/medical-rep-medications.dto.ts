import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class ReplaceMedicalRepMedicationsDto {
  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayUnique()
  @ArrayMaxSize(200)
  medication_ids!: string[];
}

export class MedicalRepMedicationLinkDto {
  @ApiProperty() medication_id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}
