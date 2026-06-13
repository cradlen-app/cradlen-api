import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { SentryModule } from '@sentry/nestjs/setup';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import authConfig from './config/auth.config';
import storageConfig from './config/storage.config';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { StorageModule } from '@infrastructure/storage/storage.module.js';
import { MessagingModule } from '@infrastructure/messaging/messaging.module';
import { HealthModule } from '@core/health/health.module';
import { AuthModule } from '@core/auth/auth.module';
import { PatientAuthModule } from '@core/patient-portal/auth/patient-auth.module.js';
import { RolesModule } from '@core/org/roles/roles.module';
import { OrganizationsModule } from '@core/org/organizations/organizations.module.js';
import { BranchesModule } from '@core/org/branches/branches.module.js';
import { ProfilesModule } from '@core/org/profiles/profiles.module.js';
import { InvitationsModule } from '@core/org/invitations/invitations.module.js';
import { StaffModule } from '@core/org/staff/staff.module.js';
import { SubscriptionsModule } from '@core/org/subscriptions/subscriptions.module.js';
import { NotificationsModule } from '@core/notifications/notifications.module.js';
import { SpecialtyCatalogModule } from '@core/org/specialty-catalog/specialty-catalog.module';
import { JobFunctionsModule } from '@core/org/job-functions/job-functions.module';
import { PatientsModule } from '@core/patient/patients/patients.module';
import { PatientPortalModule } from '@core/patient-portal/portal/patient-portal.module.js';
import { PatientNotificationsModule } from '@core/patient-portal/notifications/patient-notifications.module.js';
import { GuardiansModule } from '@core/patient/guardians/guardians.module';
import { VisitsModule } from '@core/clinical/visits/visits.module';
import { MedicalRepModule } from '@core/clinical/medical-rep/medical-rep.module';
import { MedicationsModule } from '@core/clinical/medications/medications.module';
import { PrescriptionsModule } from '@core/clinical/prescriptions/prescriptions.module';
import { CarePathsModule } from '@core/clinical/care-paths/care-paths.module';
import { JourneysModule } from '@core/clinical/journeys/journeys.module';
import { DiagnosisCodesModule } from '@core/clinical/diagnosis-codes/diagnosis-codes.module';
import { InvestigationsModule } from '@core/clinical/investigations/investigations.module.js';
import { LabTestsModule } from '@core/clinical/lab-tests/lab-tests.module';
import { CalendarModule } from '@core/calendar/calendar.module';
import { ProceduresModule } from '@core/org/procedures/procedures.module';
import { ObgynModule } from '@specialties/obgyn/obgyn.module';
import { TemplatesModule } from '@builder/templates/templates.module.js';
import { FinancialModule } from '@core/financial/financial.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

@Module({
  imports: [
    SentryModule.forRoot(),
    ScheduleModule.forRoot(),
    MessagingModule,
    StorageModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
      load: [appConfig, databaseConfig, authConfig, storageConfig],
    }),
    ThrottlerModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (config: ConfigType<typeof appConfig>) => {
        const { ttl, limit } = config.throttle;
        return [{ ttl, limit }];
      },
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    PatientAuthModule,
    RolesModule,
    OrganizationsModule,
    ProfilesModule,
    BranchesModule,
    InvitationsModule,
    StaffModule,
    SubscriptionsModule,
    NotificationsModule,
    FinancialModule,
    SpecialtyCatalogModule,
    JobFunctionsModule,
    PatientsModule,
    PatientPortalModule,
    PatientNotificationsModule,
    GuardiansModule,
    VisitsModule,
    MedicalRepModule,
    MedicationsModule,
    PrescriptionsModule,
    CarePathsModule,
    JourneysModule,
    DiagnosisCodesModule,
    InvestigationsModule,
    LabTestsModule,
    CalendarModule,
    ProceduresModule,
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
