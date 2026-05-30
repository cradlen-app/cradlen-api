import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ListCarePathsQueryDto {
  @IsOptional() @IsUUID() specialtyId?: string;
  @IsOptional() @IsString() specialtyCode?: string;
}
