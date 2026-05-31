import { Controller, Get, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { DiagnosisCodesService } from './diagnosis-codes.service';
import { ApiStandardResponse } from '@common/swagger';
import { DiagnosisCodeDto } from './dto/diagnosis-code.dto';
import { ListDiagnosisCodesQueryDto } from './dto/list-diagnosis-codes.query';
import { Public } from '@common/decorators/public.decorator';

@ApiTags('Diagnosis Codes')
@Controller('diagnosis-codes')
export class DiagnosisCodesController {
  constructor(private readonly service: DiagnosisCodesService) {}

  @Public()
  @Get()
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'specialty_code', required: false })
  @ApiStandardResponse(DiagnosisCodeDto)
  search(@Query() query: ListDiagnosisCodesQueryDto) {
    return this.service.search({
      search: query.search,
      specialtyCode: query.specialty_code,
    });
  }
}
