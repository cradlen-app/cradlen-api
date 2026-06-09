import { IsNumber, IsString, IsUUID, Min, MinLength } from 'class-validator';

export class CreateRefundDto {
  @IsUUID()
  payment_id!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsString()
  @MinLength(4)
  reason!: string;
}
