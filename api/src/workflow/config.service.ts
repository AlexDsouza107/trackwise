import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { APPLICATION_TYPES, ApplicationType } from '../common/types';
import { DbService } from '../db/db.service';
import { AppState, DEFAULT_ROUTES, normaliseRoute, ReviewStage, SLA_HOURS } from './machine';

/** Admin-editable workflow settings: which stages each application type passes through, and how long each stage may take. */
@Injectable()
export class WorkflowConfigService implements OnModuleInit {
  constructor(private readonly db: DbService) {}

  async onModuleInit(): Promise<void> {
    for (const type of APPLICATION_TYPES) {
      await this.db.query(
        'insert into workflow_routes (application_type, stages) values ($1,$2) on conflict (application_type) do nothing',
        [type, JSON.stringify(DEFAULT_ROUTES[type])]);
    }
    for (const [state, hours] of Object.entries(SLA_HOURS)) {
      await this.db.query('insert into sla_config (state, hours) values ($1,$2) on conflict (state) do nothing', [state, hours]);
    }
  }

  async slaHours(): Promise<Partial<Record<AppState, number>>> {
    const rows = await this.db.query<{ state: AppState; hours: number }>('select state, hours from sla_config');
    return { ...SLA_HOURS, ...Object.fromEntries(rows.map((r) => [r.state, r.hours])) };
  }

  async routes(): Promise<Record<ApplicationType, ReviewStage[]>> {
    const rows = await this.db.query<{ application_type: ApplicationType; stages: ReviewStage[] }>('select * from workflow_routes');
    const out = { ...DEFAULT_ROUTES };
    for (const r of rows) out[r.application_type] = r.stages;
    return out;
  }

  async routeFor(type: ApplicationType): Promise<ReviewStage[]> {
    const row = await this.db.one<{ stages: ReviewStage[] }>('select stages from workflow_routes where application_type=$1', [type]);
    return row?.stages ?? DEFAULT_ROUTES[type];
  }

  async setRoute(type: ApplicationType, stages: unknown, by: string): Promise<ReviewStage[]> {
    let route: ReviewStage[];
    try { route = normaliseRoute(stages); } catch (e) { throw new BadRequestException((e as Error).message); }
    await this.db.query(
      `insert into workflow_routes (application_type, stages, updated_by, updated_at) values ($1,$2,$3,now())
       on conflict (application_type) do update set stages=$2, updated_by=$3, updated_at=now()`,
      [type, JSON.stringify(route), by]);
    return route;
  }

  async setSla(state: string, hours: number): Promise<void> {
    if (!(state in SLA_HOURS)) throw new BadRequestException(`No SLA is defined for "${state}"`);
    await this.db.query('update sla_config set hours=$2 where state=$1', [state, hours]);
  }

  async overview() {
    const [routes, sla] = await Promise.all([this.routes(), this.slaHours()]);
    return { routes, sla };
  }
}
