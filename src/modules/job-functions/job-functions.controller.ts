import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { ApiStandardResponse } from '../../common/swagger/index.js';
import { JobFunctionLookupDto } from './dto/job-function.dto.js';
import { JobFunctionsService } from './job-functions.service.js';

@ApiTags('Job Functions')
@Controller('job-functions')
export class JobFunctionsController {
  constructor(private readonly jobFunctionsService: JobFunctionsService) {}

  @Public()
  @Get('lookup')
  @ApiOperation({ summary: 'List job functions for dropdowns (public)' })
  @ApiStandardResponse(JobFunctionLookupDto)
  findLookup() {
    return this.jobFunctionsService.findLookup();
  }
}
