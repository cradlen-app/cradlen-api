import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventBus } from './event-bus.js';
import { VisitsGateway } from './realtime/visits.gateway.js';

@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({ wildcard: false, ignoreErrors: true }),
  ],
  providers: [EventBus, VisitsGateway],
  exports: [EventBus, EventEmitterModule],
})
export class MessagingModule {}
