import {
  Body,
  Controller,
  Delete,
  Get,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { CurrentPatient } from '@common/decorators/current-patient.decorator.js';
import { AuditsPhiAccess } from '@common/decorators/audits-phi-access.decorator.js';
import { PatientJwtAuthGuard } from '@common/guards/patient-jwt-auth.guard.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientProfileService } from './patient-profile.service.js';
import {
  PatientProfileDto,
  UpdateNationalIdDto,
  UpdatePatientProfileDto,
} from './dto/patient-profile.dto.js';
import {
  ConfirmProfileImageDto,
  ProfileImageUploadDto,
  ProfileImageUploadUrlDto,
} from './dto/profile-image.dto.js';

@ApiTags('Patient Portal')
@Controller({ path: 'patient-portal/profile', version: '1' })
export class PatientProfileController {
  constructor(private readonly profileService: PatientProfileService) {}

  @Get()
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get the patient's profile (demographics + avatar)",
  })
  @ApiStandardResponse(PatientProfileDto)
  @AuditsPhiAccess({
    resource: 'portal.profile',
    purpose: 'patient_self',
    subject: 'self',
  })
  getProfile(
    @CurrentPatient() patient: PatientAuthContext,
    @Query('patient_id', new ParseUUIDPipe({ optional: true }))
    patientId?: string,
  ) {
    return this.profileService.getProfile(patient, patientId);
  }

  @Patch()
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update the patient's demographics" })
  @ApiStandardResponse(PatientProfileDto)
  updateProfile(
    @CurrentPatient() patient: PatientAuthContext,
    @Body() dto: UpdatePatientProfileDto,
    @Query('patient_id', new ParseUUIDPipe({ optional: true }))
    patientId?: string,
  ) {
    return this.profileService.updateProfile(patient, patientId, dto);
  }

  @Patch('national-id')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Change the patient's national ID (requires current password)",
  })
  @ApiStandardResponse(PatientProfileDto)
  updateNationalId(
    @CurrentPatient() patient: PatientAuthContext,
    @Body() dto: UpdateNationalIdDto,
    @Query('patient_id', new ParseUUIDPipe({ optional: true }))
    patientId?: string,
  ) {
    return this.profileService.updateNationalId(patient, patientId, dto);
  }

  @Post('image-upload-url')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a presigned URL to upload a profile image',
  })
  @ApiStandardResponse(ProfileImageUploadUrlDto)
  profileImageUploadUrl(
    @CurrentPatient() patient: PatientAuthContext,
    @Body() dto: ProfileImageUploadDto,
    @Query('patient_id', new ParseUUIDPipe({ optional: true }))
    patientId?: string,
  ) {
    return this.profileService.createImageUploadUrl(patient, patientId, dto);
  }

  @Post('image')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Confirm an uploaded profile image and set it on the patient',
  })
  @ApiStandardResponse(PatientProfileDto)
  confirmProfileImage(
    @CurrentPatient() patient: PatientAuthContext,
    @Body() dto: ConfirmProfileImageDto,
    @Query('patient_id', new ParseUUIDPipe({ optional: true }))
    patientId?: string,
  ) {
    return this.profileService.confirmImage(patient, patientId, dto);
  }

  @Delete('image')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Remove the patient's profile image" })
  @ApiStandardResponse(PatientProfileDto)
  removeProfileImage(
    @CurrentPatient() patient: PatientAuthContext,
    @Query('patient_id', new ParseUUIDPipe({ optional: true }))
    patientId?: string,
  ) {
    return this.profileService.removeImage(patient, patientId);
  }
}
