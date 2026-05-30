import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { EventBus } from './event-bus.js';
import { VisitsGateway } from './realtime/visits.gateway.js';

@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({ wildcard: false, ignoreErrors: true }),
    // JwtService is used by VisitsGateway to authenticate socket handshakes.
    // The verify secret is supplied per-call from AuthConfig, so no global
    // signing options are needed here.
    JwtModule.register({}),
  ],
  providers: [EventBus, VisitsGateway],
  exports: [EventBus, EventEmitterModule],
})
export class MessagingModule {}
