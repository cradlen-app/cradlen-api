import { ApiProperty } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const NAME_MAX = 200;
const CODE_MAX = 100;
const DESC_MAX = 1000;

export class CreateFormTemplateDto {
  @IsString() @MaxLength(NAME_MAX) name!: string;
  @IsString() @MaxLength(CODE_MAX) code!: string;
  @IsString() @IsOptional() @MaxLength(DESC_MAX) description?: string;
  @IsUUID() specialty_id!: string;
  /** Optional: clone the initial draft version's schema from a SYSTEM template. */
  @IsUUID() @IsOptional() clone_from_template_id?: string;
}

export class UpdateFormTemplateVersionDto {
  @IsObject() schema!: Record<string, unknown>;
}

export class FormTemplateVersionDto {
  @ApiProperty() id!: string;
  @ApiProperty() template_id!: string;
  @ApiProperty() version_number!: number;
  @ApiProperty() status!: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  @ApiProperty({ type: Object }) schema!: unknown;
  @ApiProperty({ required: false, nullable: true }) published_at!: Date | null;
  @ApiProperty({ required: false, nullable: true }) published_by_id!:
    | string
    | null;
  @ApiProperty() created_at!: Date;
  @ApiProperty() updated_at!: Date;
}

export class FormTemplateDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ required: false, nullable: true }) description!: string | null;
  @ApiProperty() scope!: 'SYSTEM' | 'ORGANIZATION';
  @ApiProperty() surface!: 'CLINICAL_ENCOUNTER';
  @ApiProperty() specialty_id!: string;
  @ApiProperty({ required: false, nullable: true }) organization_id!:
    | string
    | null;
  @ApiProperty({ type: [FormTemplateVersionDto], required: false })
  versions?: FormTemplateVersionDto[];
  @ApiProperty() created_at!: Date;
  @ApiProperty() updated_at!: Date;
}
