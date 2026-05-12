import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BindingNamespace,
  FormFieldType,
  FormScope,
} from '@prisma/client';

export class TemplateBindingContractDto {
  @ApiPropertyOptional({ enum: [
    'PATIENT', 'VISIT', 'INTAKE', 'GUARDIAN',
    'MEDICAL_REP', 'LOOKUP', 'SYSTEM', 'COMPUTED',
  ] satisfies BindingNamespace[], nullable: true })
  namespace!: BindingNamespace | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  path!: string | null;
}

export class FormFieldDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: [
    'TEXT','TEXTAREA','NUMBER','DECIMAL','DATE','DATETIME',
    'BOOLEAN','SELECT','MULTISELECT','ENTITY_SEARCH','COMPUTED',
  ] satisfies FormFieldType[] })
  type!: FormFieldType;
  @ApiProperty() order!: number;
  @ApiProperty() required!: boolean;
  @ApiProperty({ type: TemplateBindingContractDto })
  binding!: TemplateBindingContractDto;
  @ApiProperty({ type: 'object', additionalProperties: true })
  config!: Record<string, unknown>;
}

export class FormSectionDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() order!: number;
  @ApiProperty({ type: 'object', additionalProperties: true })
  config!: Record<string, unknown>;
  @ApiProperty({ type: [FormFieldDto] }) fields!: FormFieldDto[];
}

export class FormTemplateDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty({ enum: ['BOOK_VISIT','ENCOUNTER','PATIENT_HISTORY'] satisfies FormScope[] })
  scope!: FormScope;
  @ApiProperty() version!: number;
  @ApiPropertyOptional({ nullable: true }) activated_at!: Date | null;
  @ApiPropertyOptional({ nullable: true }) specialty_id!: string | null;
  @ApiProperty({ type: [FormSectionDto] }) sections!: FormSectionDto[];
}

export class FormTemplateSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['BOOK_VISIT','ENCOUNTER','PATIENT_HISTORY'] satisfies FormScope[] })
  scope!: FormScope;
  @ApiProperty() version!: number;
  @ApiPropertyOptional({ nullable: true }) specialty_id!: string | null;
  @ApiPropertyOptional({ nullable: true }) activated_at!: Date | null;
}
