import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpsertVitalsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(40)
  @Max(300)
  systolic_bp?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(20)
  @Max(200)
  diastolic_bp?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(20) @Max(250) pulse?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(25)
  @Max(45)
  temperature_c?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(80)
  respiratory_rate?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(50) @Max(100) spo2?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(400)
  weight_kg?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(20)
  @Max(260)
  height_cm?: number;
}

export class VitalsDto {
  id!: string;
  visit_id!: string;
  systolic_bp!: number | null;
  diastolic_bp!: number | null;
  pulse!: number | null;
  temperature_c!: number | null;
  respiratory_rate!: number | null;
  spo2!: number | null;
  weight_kg!: number | null;
  height_cm!: number | null;
  bmi!: number | null;
  recorded_by_id!: string;
  recorded_at!: Date;
  created_at!: Date;
  updated_at!: Date;
}
