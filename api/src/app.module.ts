import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AiClient } from './ai/ai.client';
import { AlertsModule } from './alerts/alerts.module';
import { AnalyticsController } from './analytics/analytics.controller';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth';
import { ZodFilter } from './common/zod.filter';
import { config } from './config';
import { ComplianceController } from './compliance/compliance.controller';
import { ComplianceService } from './compliance/compliance.service';
import { HealthController } from './health.controller';
import { DbModule } from './db/db.service';
import { SeedService } from './seed/seed.service';
import { StorageService } from './storage/storage.service';
import { ConfigController } from './config/config.controller';
import { IntegrationsController } from './integrations/integrations.controller';
import { IntegrationsService } from './integrations/integrations.service';
import { LettersController } from './letters/letters.controller';
import { LettersService } from './letters/letters.service';
import { ValidityController } from './validity/validity.controller';
import { ValidityService } from './validity/validity.service';
import { ApplicationsController } from './workflow/applications.controller';
import { ApplicationsService } from './workflow/applications.service';
import { WorkflowConfigService } from './workflow/config.service';
import { EvcController } from './workflow/evc.controller';
import { EvcService } from './workflow/evc.service';

@Module({
  imports: [
    DbModule,
    AlertsModule,
    JwtModule.register({ global: true, secret: config.jwtSecret, signOptions: { expiresIn: '12h' } }),
  ],
  controllers: [HealthController, AuthController, ApplicationsController, EvcController, ValidityController, LettersController, IntegrationsController, ConfigController, ComplianceController, AnalyticsController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ZodFilter },
    StorageService,
    AiClient,
    ComplianceService,
    WorkflowConfigService,
    EvcService,
    ValidityService,
    IntegrationsService,
    LettersService,
    ApplicationsService,
    SeedService,
  ],
})
export class AppModule {}
