import { IsUUID } from 'class-validator';

export class ListReceiptsQueryDto {
  @IsUUID('4')
  invoice_id!: string;
}
