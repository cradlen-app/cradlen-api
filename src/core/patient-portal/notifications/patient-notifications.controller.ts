import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { CurrentPatient } from '@common/decorators/current-patient.decorator.js';
import { PatientJwtAuthGuard } from '@common/guards/patient-jwt-auth.guard.js';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '@common/swagger/index.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import {
  ListPatientNotificationsQueryDto,
  PatientNotificationDto,
} from './dto/patient-notification.dto.js';
import { PatientNotificationsService } from './patient-notifications.service.js';

@ApiTags('Patient Portal')
@Controller({ path: 'patient-portal/notifications', version: '1' })
export class PatientNotificationsController {
  constructor(private readonly notifications: PatientNotificationsService) {}

  @Get()
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the patient's notifications (paginated)" })
  @ApiPaginatedResponse(PatientNotificationDto)
  list(
    @CurrentPatient() patient: PatientAuthContext,
    @Query() query: ListPatientNotificationsQueryDto,
  ) {
    return this.notifications.list(
      patient,
      query.page,
      query.limit,
      query.category,
    );
  }

  @Patch('read-all')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark all of the patient notifications as read' })
  @ApiVoidResponse()
  markAllRead(@CurrentPatient() patient: PatientAuthContext) {
    return this.notifications.markAllRead(patient);
  }

  @Patch(':id/read')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark a single notification as read' })
  @ApiStandardResponse(PatientNotificationDto)
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPatient() patient: PatientAuthContext,
  ) {
    return this.notifications.markRead(id, patient);
  }
}
