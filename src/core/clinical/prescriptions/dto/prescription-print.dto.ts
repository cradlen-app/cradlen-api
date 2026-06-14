import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PrescriptionTemplateLayout } from '../prescription-template.constants.js';

/**
 * Printable prescription aggregate — everything needed to render/print an Rx,
 * resolved in one query. The frontend renders this (no server-side PDF). The
 * model is intentionally rich/additive: the default layout shows only a subset
 * (medications), but custom templates can bind to any field already present, so
 * extending a template needs no API change. The org logo is exposed as its R2
 * object key; the client fetches a presigned URL via the existing logo flow.
 */
class PrescriptionPrintOrgDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) logo_object_key!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Presigned GET URL for the logo; render directly.',
  })
  logo_image_url!: string | null;
}

class PrescriptionPrintBranchDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() address!: string;
  @ApiProperty() city!: string;
  @ApiProperty() governorate!: string;
  @ApiPropertyOptional({ nullable: true }) country!: string | null;
}

class PrescriptionPrintDoctorDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'e.g. "Dr. Sara Hassan".' }) name!: string;
  @ApiPropertyOptional({ nullable: true }) specialty!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Reserved slot; not yet captured in the data model.',
  })
  license_number!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Reserved slot (R2 object key); not yet captured.',
  })
  signature_object_key!: string | null;
}

class PrescriptionPrintPatientDto {
  @ApiProperty() id!: string;
  @ApiProperty() full_name!: string;
  @ApiPropertyOptional({ nullable: true }) phone_number!: string | null;
  @ApiPropertyOptional({ nullable: true, type: Date })
  date_of_birth!: Date | null;
}

class PrescriptionPrintDiagnosisDto {
  @ApiPropertyOptional({ nullable: true }) chief_complaint!: string | null;
  @ApiPropertyOptional({ nullable: true }) provisional_diagnosis!:
    | string
    | null;
}

class PrescriptionPrintItemDto {
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) generic_name!: string | null;
  @ApiPropertyOptional({ nullable: true }) strength!: string | null;
  @ApiPropertyOptional({ nullable: true }) form!: string | null;
  @ApiProperty() dose!: string;
  @ApiPropertyOptional({ nullable: true }) route!: string | null;
  @ApiProperty() frequency!: string;
  @ApiPropertyOptional({ nullable: true }) duration!: string | null;
  @ApiPropertyOptional({ nullable: true }) instructions!: string | null;
}

export class PrescriptionDocumentDto {
  @ApiProperty({ type: Date }) prescribed_at!: Date;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;

  @ApiProperty({ type: PrescriptionPrintOrgDto })
  organization!: PrescriptionPrintOrgDto;
  @ApiProperty({ type: PrescriptionPrintBranchDto })
  branch!: PrescriptionPrintBranchDto;
  @ApiProperty({ type: PrescriptionPrintDoctorDto })
  doctor!: PrescriptionPrintDoctorDto;
  @ApiProperty({ type: PrescriptionPrintPatientDto })
  patient!: PrescriptionPrintPatientDto;
  @ApiProperty({ type: PrescriptionPrintDiagnosisDto })
  diagnosis!: PrescriptionPrintDiagnosisDto;
  @ApiProperty({ type: [PrescriptionPrintItemDto] })
  items!: PrescriptionPrintItemDto[];
}

export class PrescriptionTemplateDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({
    description: 'Ordered layout blocks the frontend renders via a registry.',
  })
  layout!: PrescriptionTemplateLayout;
}

export class PrescriptionPrintDto {
  @ApiProperty({ type: PrescriptionTemplateDto })
  template!: PrescriptionTemplateDto;
  @ApiProperty({ type: PrescriptionDocumentDto })
  document!: PrescriptionDocumentDto;
}
