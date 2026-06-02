import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MedicalRepVisitOutcome, MedicalRepVisitPurpose } from '@prisma/client';

/** A product discussed in a past rep visit (id + readable name). */
export class MedicalRepVisitHistoryProductDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

/** One past visit in the rep's Overview "Visits History" timeline. */
export class MedicalRepVisitHistoryItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() scheduled_at!: string;
  @ApiPropertyOptional({ nullable: true }) completed_at!: string | null;
  @ApiProperty() status!: string;
  @ApiPropertyOptional({ nullable: true, enum: MedicalRepVisitPurpose })
  purpose!: MedicalRepVisitPurpose | null;
  @ApiPropertyOptional({ nullable: true, enum: MedicalRepVisitOutcome })
  outcome!: MedicalRepVisitOutcome | null;
  @ApiProperty() samples_received!: boolean;
  @ApiPropertyOptional({ nullable: true }) follow_up_date!: string | null;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;
  @ApiProperty({ type: [MedicalRepVisitHistoryProductDto] })
  products!: MedicalRepVisitHistoryProductDto[];
}
