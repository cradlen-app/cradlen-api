import type { PatientNotification } from '@prisma/client';
import type { PatientNotificationDto } from './dto/patient-notification.dto.js';

/**
 * Projects a raw `PatientNotification` row onto the public response shape,
 * dropping internal columns (`patient_id`, `organization_id`, `code`,
 * `is_deleted`, `deleted_at`, `updated_at`).
 */
export function toPatientNotificationResponse(
  notification: PatientNotification,
): PatientNotificationDto {
  return {
    id: notification.id,
    category: notification.category,
    title: notification.title,
    description: notification.description,
    navigate_to: notification.navigate_to,
    is_read: notification.is_read,
    read_at: notification.read_at,
    metadata: notification.metadata,
    created_at: notification.created_at,
  };
}
