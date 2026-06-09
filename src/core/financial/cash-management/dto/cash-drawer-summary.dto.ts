import { ApiProperty } from '@nestjs/swagger';

/** Live drawer state for an OPEN session — what the cashier should be holding. */
export class CashDrawerSummaryDto {
  @ApiProperty({
    description: 'Linked COMPLETED cash payments so far (string).',
  })
  collected!: string;
  @ApiProperty() payment_count!: number;
  @ApiProperty({ description: 'opening_float + collected (string).' })
  expected_so_far!: string;
}
