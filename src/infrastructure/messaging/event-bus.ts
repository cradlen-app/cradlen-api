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

  publish<T>(event: string, payload: T): void {
    this.emitter.emit(event, payload);
  }
}
