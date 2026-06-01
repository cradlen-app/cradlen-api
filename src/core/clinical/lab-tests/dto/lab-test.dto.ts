import { ApiProperty } from '@nestjs/swagger';
import { LabTestCategory } from '@prisma/client';

export class LabTestDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'PELVIC_US' })
  code!: string;

  @ApiProperty({ example: 'Pelvic ultrasound' })
  name!: string;

  @ApiProperty({ enum: LabTestCategory, example: LabTestCategory.IMAGING })
  category!: LabTestCategory;

  @ApiProperty({ format: 'uuid', nullable: true })
  specialty_id!: string | null;
}
