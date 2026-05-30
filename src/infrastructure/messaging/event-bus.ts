import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Thin wrapper over the in-process event emitter. Encapsulates the
 * implementation choice so a future swap (e.g. RabbitMQ, NATS, Kafka)
 * is non-breaking for callers.
 */
@Injectable()
export class EventBus {
  constructor(private readonly emitter: EventEmitter2) {}

  /**
   * Fire-and-forget. Delivery is best-effort and synchronous within this
   * process: subscriber exceptions are swallowed (MessagingModule registers
   * EventEmitter2 with `ignoreErrors: true`) and there is no return value to
   * await. Do NOT use this for side effects you must guarantee — persist those
   * inline, then publish for downstream fan-out (notifications, realtime).
   */
  publish<T>(event: string, payload: T): void {
    this.emitter.emit(event, payload);
  }
}
