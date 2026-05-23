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
import {
  ApiExtraModels,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { FieldFlagsService } from './field-flags.service';
import {
  FieldFlagDto,
  UpdateFieldFlagNoteDto,
  UpsertFieldFlagDto,
} from './dto/field-flag.dto';
import { ApiStandardResponse, ApiVoidResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

@ApiTags('Patient History')
@Controller()
@ApiExtraModels(FieldFlagDto)
export class FieldFlagsController {
  constructor(private readonly fieldFlagsService: FieldFlagsService) {}

  @Get('patients/:id/field-flags')
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(FieldFlagDto) } },
        meta: { type: 'object', example: {} },
      },
    },
  })
  list(
    @Param('id', ParseUUIDPipe) patientId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.fieldFlagsService.list(patientId, user);
  }

  @Post('patients/:id/field-flags')
  @ApiStandardResponse(FieldFlagDto)
  upsert(
    @Param('id', ParseUUIDPipe) patientId: string,
    @Body() dto: UpsertFieldFlagDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.fieldFlagsService.upsert(patientId, dto, user);
  }

  @Patch('patient-field-flags/:flagId')
  @ApiStandardResponse(FieldFlagDto)
  updateNote(
    @Param('flagId', ParseUUIDPipe) flagId: string,
    @Body() dto: UpdateFieldFlagNoteDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.fieldFlagsService.updateNote(flagId, dto, user);
  }

  @Delete('patient-field-flags/:flagId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  remove(
    @Param('flagId', ParseUUIDPipe) flagId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.fieldFlagsService.remove(flagId, user);
  }
}
