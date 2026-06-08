import { Module } from '@nestjs/common';
import { PatientNotificationsController } from './patient-notifications.controller.js';
import { PatientNotificationsService } from './patient-notifications.service.js';
import { PatientNotificationsListener } from './patient-notifications.listener.js';

/**
 * Patient-facing in-app notifications: a patient-scoped read API (via the
 * `patient-jwt` strategy) plus a listener that creates notifications on visit
 * completion (new prescription / new tests). Distinct from the staff
 * `NotificationsModule` (Profile-scoped).
 */
@Module({
  controllers: [PatientNotificationsController],
  providers: [PatientNotificationsService, PatientNotificationsListener],
})
export class PatientNotificationsModule {}
