import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LabTestsService } from './lab-tests.service';
import { CreateLabTestDto } from './dto/create-lab-test.dto';
import { UpdateLabTestDto } from './dto/update-lab-test.dto';
import { ListLabTestsQueryDto } from './dto/list-lab-tests-query.dto';
import { LabTestDto } from './dto/lab-test.dto';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

@ApiTags('Lab tests')
@Controller('lab-tests')
export class LabTestsController {
  constructor(private readonly labTestsService: LabTestsService) {}

  @Get()
  @ApiPaginatedResponse(LabTestDto)
  findAll(
    @Query() query: ListLabTestsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.labTestsService.findAll(query, user);
  }

  @Post()
  @ApiStandardResponse(LabTestDto)
  create(@Body() dto: CreateLabTestDto, @CurrentUser() user: AuthContext) {
    return this.labTestsService.create(dto, user);
  }

  @Patch(':id')
  @ApiStandardResponse(LabTestDto)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLabTestDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.labTestsService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.labTestsService.remove(id, user);
  }
}
