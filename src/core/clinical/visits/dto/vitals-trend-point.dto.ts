import { ApiProperty } from '@nestjs/swagger';

export class VitalsTrendPointDto {
  @ApiProperty() visit_id!: string;
  @ApiProperty() completed_at!: Date;
  @ApiProperty({ nullable: true, type: Number }) systolic_bp!: number | null;
  @ApiProperty({ nullable: true, type: Number }) diastolic_bp!: number | null;
  @ApiProperty({ nullable: true, type: Number }) weight_kg!: number | null;
  @ApiProperty({ nullable: true, type: Number }) bmi!: number | null;
}
