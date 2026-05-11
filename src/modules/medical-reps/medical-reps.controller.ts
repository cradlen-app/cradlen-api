import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MedicalRepsService } from './medical-reps.service';
import { CreateMedicalRepDto } from './dto/create-medical-rep.dto';
import { UpdateMedicalRepDto } from './dto/update-medical-rep.dto';
import { ListMedicalRepsQueryDto } from './dto/list-medical-reps-query.dto';
import { MedicalRepDto } from './dto/medical-rep.dto';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '../../common/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

@ApiTags('Medical Reps')
@ApiBearerAuth()
@Controller('medical-reps')
export class MedicalRepsController {
  constructor(private readonly service: MedicalRepsService) {}

  @Post()
  @ApiStandardResponse(MedicalRepDto)
  create(@Body() dto: CreateMedicalRepDto, @CurrentUser() user: AuthContext) {
    return this.service.create(dto, user);
  }

  @Get()
  @ApiPaginatedResponse(MedicalRepDto)
  findAll(
    @Query() query: ListMedicalRepsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @ApiStandardResponse(MedicalRepDto)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  @ApiStandardResponse(MedicalRepDto)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMedicalRepDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiVoidResponse()
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.remove(id, user);
  }
}
