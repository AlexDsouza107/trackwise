import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AiClient } from './ai/ai.client';
import { AlertsModule } from './alerts/alerts.module';
import { AnalyticsController } from './analytics/analytics.controller';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth';
import { config } from './config';
import { ComplianceController } from './compliance/compliance.controller';
import { ComplianceService } from './compliance/compliance.service';
import { HealthController } from './health.controller';
import { DbModule } from './db/db.service';
import { SeedService } from './seed/seed.service';
import { StorageService } from './storage/storage.service';
import { ApplicationsController } from './workflow/applications.controller';
import { ApplicationsService } from './workflow/applications.service';

@Module({
  imports: [
    DbModule,
    AlertsModule,
    JwtModule.register({ global: true, secret: config.jwtSecret, signOptions: { expiresIn: '12h' } }),
  ],
  controllers: [HealthController, AuthController, ApplicationsController, ComplianceController, AnalyticsController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    StorageService,
    AiClient,
    ComplianceService,
    ApplicationsService,
    SeedService,
  ],
})
export class AppModule {}
