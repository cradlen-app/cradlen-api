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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NonGynSurgeriesService } from './non-gyn-surgeries.service';
import {
  CreateNonGynSurgeryDto,
  NonGynSurgeryDto,
  UpdateNonGynSurgeryDto,
} from './dto/non-gyn-surgery.dto';
import { ApiStandardResponse, ApiVoidResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

@ApiTags('Patient History')
@Controller()
export class NonGynSurgeriesController {
  constructor(
    private readonly nonGynSurgeriesService: NonGynSurgeriesService,
  ) {}

  @Get('patients/:id/non-gyn-surgeries')
  @ApiStandardResponse(NonGynSurgeryDto)
  findAll(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.nonGynSurgeriesService.findAll(id, user);
  }

  @Post('patients/:id/non-gyn-surgeries')
  @ApiStandardResponse(NonGynSurgeryDto)
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateNonGynSurgeryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.nonGynSurgeriesService.create(id, dto, user);
  }

  @Patch('non-gyn-surgeries/:id')
  @ApiStandardResponse(NonGynSurgeryDto)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNonGynSurgeryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.nonGynSurgeriesService.update(id, dto, user);
  }

  @Delete('non-gyn-surgeries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.nonGynSurgeriesService.remove(id, user);
  }
}
