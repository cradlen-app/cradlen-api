import type { Notification } from '@prisma/client';
import type { NotificationDto } from './dto/notification.dto.js';

/**
 * Projects a raw `Notification` row onto the public response shape, dropping
 * internal columns (`profile_id`, `code`, `is_deleted`, `deleted_at`,
 * `updated_at`). Single source of truth for the notification response shape.
 */
export function toNotificationResponse(
  notification: Notification,
): NotificationDto {
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
