import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SentryModule } from '@sentry/nestjs/setup';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import authConfig from './config/auth.config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { RolesModule } from './modules/roles/roles.module';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { BranchesModule } from './modules/branches/branches.module.js';
import { ProfilesModule } from './modules/profiles/profiles.module.js';
import { InvitationsModule } from './modules/invitations/invitations.module.js';
import { StaffModule } from './modules/staff/staff.module.js';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { SpecialtiesModule } from './modules/specialties/specialties.module';
import { JourneyTemplatesModule } from './modules/journey-templates/journey-templates.module';
import { PatientsModule } from './modules/patients/patients.module';
import { JourneysModule } from './modules/journeys/journeys.module';
import { VisitsModule } from './modules/visits/visits.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import type { AppConfig } from './config/app.config';

@Module({
  imports: [
    SentryModule.forRoot(),
    EventEmitterModule.forRoot({ wildcard: false, ignoreErrors: true }),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
      load: [appConfig, databaseConfig, authConfig],
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const appConfig = config.get<AppConfig>('app');
        if (!appConfig) throw new Error('App configuration not loaded');
        const { ttl, limit } = appConfig.throttle;
        return [{ ttl, limit }];
      },
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    RolesModule,
    OrganizationsModule,
    ProfilesModule,
    BranchesModule,
    InvitationsModule,
    StaffModule,
    SubscriptionsModule,
    NotificationsModule,
    SpecialtiesModule,
    JourneyTemplatesModule,
    PatientsModule,
    JourneysModule,
    VisitsModule,
    CalendarModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
