export const SCHEMA_SQL = `
create table if not exists app_meta (key text primary key, value text not null);
create table if not exists institutions (
  id serial primary key,
  name text not null,
  code text unique not null,
  state text not null,
  city text not null,
  status text not null default 'active',
  region text,
  approval_valid_until date,
  is_demo boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists users (
  id serial primary key,
  email text unique not null,
  name text not null,
  password_hash text not null,
  role text not null,
  region text,
  institution_id int references institutions(id),
  created_at timestamptz not null default now()
);
create table if not exists applications (
  id serial primary key,
  reference text unique not null,
  institution_id int not null references institutions(id),
  type text not null,
  title text not null,
  details jsonb not null default '{}',
  state text not null default 'draft',
  context jsonb not null default '{}',
  stage_entered_at timestamptz not null default now(),
  sla_due_at timestamptz,
  risk_score numeric,
  risk_level text,
  risk_factors jsonb,
  doc_check jsonb,
  compliance jsonb,
  submitted_at timestamptz,
  decided_at timestamptz,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists applications_state_idx on applications(state);
create table if not exists documents (
  id serial primary key,
  application_id int not null references applications(id) on delete cascade,
  doc_type text not null,
  filename text not null,
  content_type text not null,
  size_bytes int not null,
  sha256 text not null,
  storage_key text not null,
  source text not null default 'upload',
  uploaded_by int references users(id),
  uploaded_at timestamptz not null default now()
);
create table if not exists audit_log (
  id bigserial primary key,
  application_id int not null references applications(id) on delete cascade,
  event text not null,
  from_state text,
  to_state text,
  actor_id int,
  actor_name text not null,
  actor_role text not null,
  note text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_app_idx on audit_log(application_id, id);
create table if not exists compliance_rules (
  code text primary key,
  name text not null,
  description text not null,
  severity text not null check (severity in ('critical','major','minor')),
  weight numeric not null,
  params jsonb not null
);
create table if not exists institution_metrics (
  id serial primary key,
  institution_id int not null references institutions(id),
  period date not null,
  faculty_count int not null,
  student_count int not null,
  built_up_sqm int not null,
  lab_count int not null,
  accreditation_valid_until date,
  annual_fee int not null,
  unique (institution_id, period)
);
create table if not exists compliance_results (
  id serial primary key,
  institution_id int not null references institutions(id),
  period date not null,
  rule_code text not null references compliance_rules(code),
  passed boolean not null,
  score numeric not null,
  value numeric,
  threshold numeric,
  detail text not null,
  evaluated_at timestamptz not null default now(),
  unique (institution_id, period, rule_code)
);
create table if not exists compliance_scores (
  institution_id int not null references institutions(id),
  period date not null,
  score numeric not null,
  primary key (institution_id, period)
);
create table if not exists notifications (
  id bigserial primary key,
  user_id int not null references users(id),
  kind text not null,
  severity text not null default 'info',
  title text not null,
  body text not null,
  link text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create table if not exists alerts (
  id bigserial primary key,
  kind text not null,
  level int not null default 1,
  severity text not null,
  entity_type text not null,
  entity_id int not null,
  message text not null,
  dedupe_key text unique not null,
  created_at timestamptz not null default now()
);
create table if not exists escalation_rules (
  id serial primary key,
  kind text not null,
  level int not null,
  after_hours numeric not null,
  notify_role text not null,
  email boolean not null default false,
  enabled boolean not null default true,
  unique (kind, level)
);
create table if not exists email_outbox (
  id bigserial primary key,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'queued',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create table if not exists workflow_routes (
  application_type text primary key,
  stages jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
create table if not exists sla_config (
  state text primary key,
  hours int not null check (hours > 0)
);
create table if not exists evc_visits (
  id serial primary key,
  application_id int not null unique references applications(id) on delete cascade,
  round int not null default 1,
  status text not null default 'awaiting_schedule' check (status in ('awaiting_schedule','scheduled','completed')),
  scheduled_for timestamptz,
  venue text,
  member_ids int[] not null default '{}',
  scheduled_by_name text,
  scheduled_at timestamptz,
  report jsonb,
  created_at timestamptz not null default now()
);
create table if not exists institution_documents (
  id serial primary key,
  institution_id int not null references institutions(id),
  kind text not null,
  reference text,
  valid_until date not null,
  filename text not null,
  content_type text not null,
  size_bytes int not null,
  sha256 text not null,
  storage_key text not null,
  uploaded_by int references users(id),
  uploaded_at timestamptz not null default now(),
  renewal jsonb,
  verified_at timestamptz,
  verified_by_name text,
  history jsonb not null default '[]',
  unique (institution_id, kind)
);
-- Idempotent migrations for databases created by earlier versions.
alter table institutions add column if not exists region text;
alter table users add column if not exists region text;
alter table documents add column if not exists source text not null default 'upload';
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('institution','officer','committee','regional','admin'));
`;
