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
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrescriptionsService } from './prescriptions.service';
import {
  CreatePrescriptionItemDto,
  PrescriptionDto,
  PrescriptionItemDto,
  UpdatePrescriptionItemDto,
  UpsertPrescriptionDto,
} from './dto/prescription.dto';
import { ApiStandardResponse, ApiVoidResponse } from '../../common/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

@ApiTags('Clinical')
@Controller()
export class PrescriptionsController {
  constructor(private readonly prescriptionsService: PrescriptionsService) {}

  @Get('visits/:id/prescription')
  @ApiStandardResponse(PrescriptionDto)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.prescriptionsService.findOne(id, user);
  }

  @Put('visits/:id/prescription')
  @ApiStandardResponse(PrescriptionDto)
  upsert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertPrescriptionDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.prescriptionsService.upsert(id, dto, user);
  }

  @Post('visits/:id/prescription/items')
  @ApiStandardResponse(PrescriptionItemDto)
  addItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePrescriptionItemDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.prescriptionsService.addItem(id, dto, user);
  }

  @Patch('prescription-items/:id')
  @ApiStandardResponse(PrescriptionItemDto)
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePrescriptionItemDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.prescriptionsService.updateItem(id, dto, user);
  }

  @Delete('prescription-items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  removeItem(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.prescriptionsService.removeItem(id, user);
  }
}
