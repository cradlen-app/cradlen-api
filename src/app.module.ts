import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import authConfig from './config/auth.config';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { MessagingModule } from '@infrastructure/messaging/messaging.module';
import { HealthModule } from '@core/health/health.module';
import { AuthModule } from '@core/auth/auth.module';
import { RolesModule } from '@core/org/roles/roles.module';
import { OrganizationsModule } from '@core/org/organizations/organizations.module.js';
import { BranchesModule } from '@core/org/branches/branches.module.js';
import { ProfilesModule } from '@core/org/profiles/profiles.module.js';
import { InvitationsModule } from '@core/org/invitations/invitations.module.js';
import { StaffModule } from '@core/org/staff/staff.module.js';
import { SubscriptionsModule } from '@core/org/subscriptions/subscriptions.module.js';
import { NotificationsModule } from '@core/notifications/notifications.module.js';
import { SpecialtiesModule } from '@core/org/specialties/specialties.module';
import { JobFunctionsModule } from '@core/org/job-functions/job-functions.module';
import { JourneyTemplatesModule } from '@core/clinical/journey-templates/journey-templates.module';
import { PatientsModule } from '@core/patient/patients/patients.module';
import { JourneysModule } from '@core/clinical/journeys/journeys.module';
import { VisitsModule } from '@core/clinical/visits/visits.module';
import { MedicalRepModule } from '@core/clinical/medical-rep/medical-rep.module';
import { MedicationsModule } from '@core/clinical/medications/medications.module';
import { LabTestsModule } from '@core/clinical/lab-tests/lab-tests.module';
import { ClinicalModule } from '@core/clinical/clinical/clinical.module';
import { PatientHistoryModule } from '@core/clinical/patient-history/patient-history.module';
import { CarePathsModule } from '@core/clinical/care-paths/care-paths.module';
import { ObgynModule } from '@specialties/obgyn/obgyn.module';
import { TemplatesModule } from '@builder/templates/templates.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import type { AppConfig } from './config/app.config';

@Module({
  imports: [
    SentryModule.forRoot(),
    MessagingModule,
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
    JobFunctionsModule,
    JourneyTemplatesModule,
    PatientsModule,
    JourneysModule,
    VisitsModule,
    MedicalRepModule,
    MedicationsModule,
    LabTestsModule,
    ClinicalModule,
    PatientHistoryModule,
    CarePathsModule,
    ObgynModule,
    TemplatesModule,
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
