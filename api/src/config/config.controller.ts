import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/auth';
import { APPLICATION_TYPES, ApplicationType, AuthUser, TYPE_LABELS } from '../common/types';
import { ComplianceService, RulePatchDto } from '../compliance/compliance.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { WorkflowConfigService } from '../workflow/config.service';
import { REVIEW_ORDER, STATE_LABELS } from '../workflow/machine';

const SlaDto = z.object({ state: z.string(), hours: z.number().int().min(1).max(24 * 120) });
const RouteDto = z.object({ stages: z.array(z.string()) });

/** Admin-only settings: workflow routes, SLA hours and compliance thresholds, plus the integration status. */
@Roles('admin')
@Controller('config')
export class ConfigController {
  constructor(
    private readonly cfg: WorkflowConfigService,
    private readonly compliance: ComplianceService,
    private readonly integrations: IntegrationsService,
  ) {}

  @Get()
  async all() {
    const { routes, sla } = await this.cfg.overview();
    return {
      stages: REVIEW_ORDER.map((s) => ({ stage: s, label: STATE_LABELS[s] })),
      types: APPLICATION_TYPES.map((t) => ({ type: t, label: TYPE_LABELS[t], stages: routes[t] })),
      sla: Object.entries(sla).map(([state, hours]) => ({ state, label: STATE_LABELS[state as keyof typeof STATE_LABELS] ?? state, hours })),
      rules: await this.compliance.rules(),
      integrations: this.integrations.list(),
    };
  }

  @Put('routes/:type')
  async setRoute(@CurrentUser() u: AuthUser, @Param('type') type: string, @Body() body: unknown) {
    const t = z.enum(APPLICATION_TYPES as [ApplicationType, ...ApplicationType[]]).parse(type);
    return { type: t, stages: await this.cfg.setRoute(t, RouteDto.parse(body).stages, u.name) };
  }

  @Put('sla')
  async setSla(@Body() body: unknown) {
    const { state, hours } = SlaDto.parse(body);
    await this.cfg.setSla(state, hours);
    return { state, hours };
  }

  @Put('rules/:code')
  updateRule(@Param('code') code: string, @Body() body: unknown) {
    return this.compliance.updateRule(code, RulePatchDto.parse(body));
  }

  @Post('rules/reevaluate')
  async reevaluate() {
    return { evaluated: await this.compliance.evaluateAllActive() };
  }
}
