import { Controller, Get, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { ApiStandardResponse } from '@common/swagger';
import { LabTestsService } from './lab-tests.service';
import { LabTestDto } from './dto/lab-test.dto';
import { ListLabTestsQueryDto } from './dto/list-lab-tests.query';

@ApiTags('Lab Tests')
@Controller('lab-tests')
export class LabTestsController {
  constructor(private readonly service: LabTestsService) {}

  @Get()
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiStandardResponse(LabTestDto)
  search(
    @Query() query: ListLabTestsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.search(
      { search: query.search, category: query.category },
      user.organizationId,
    );
  }
}
