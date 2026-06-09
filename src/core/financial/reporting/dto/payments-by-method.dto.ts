import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';

export class PaymentsByMethodRowDto {
  @ApiProperty({ enum: PaymentMethod }) payment_method!: PaymentMethod;
  @ApiProperty({ description: 'Collected via this method (string).' })
  total!: string;
  @ApiProperty() count!: number;
}

export class PaymentsByMethodReportDto {
  @ApiProperty({ type: [PaymentsByMethodRowDto] })
  by_method!: PaymentsByMethodRowDto[];
  @ApiProperty() total!: string;
}
