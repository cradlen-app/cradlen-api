import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BindingNamespace, FormFieldType, FormScope } from '@prisma/client';

// Derived from the Prisma enums so the Swagger contract can never drift from
// the schema. (A hand-listed array only fails compilation on an *invalid*
// member, not a *missing* one, so omissions used to slip through silently.)
const BINDING_NAMESPACE_VALUES = Object.values(BindingNamespace);
const FORM_FIELD_TYPE_VALUES = Object.values(FormFieldType);
const FORM_SCOPE_VALUES = Object.values(FormScope);

export class TemplateBindingContractDto {
  @ApiPropertyOptional({
    enum: BINDING_NAMESPACE_VALUES,
    nullable: true,
  })
  namespace!: BindingNamespace | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  path!: string | null;
}

export class FormFieldDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: FORM_FIELD_TYPE_VALUES })
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
  @ApiProperty({ enum: FORM_SCOPE_VALUES })
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
  @ApiProperty({ enum: FORM_SCOPE_VALUES })
  scope!: FormScope;
  @ApiProperty() version!: number;
  @ApiPropertyOptional({ nullable: true }) specialty_id!: string | null;
  @ApiPropertyOptional({ nullable: true }) activated_at!: Date | null;
}
