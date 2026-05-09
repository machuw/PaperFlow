create table papers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  paper_key     text not null,
  title         text, authors text[], venue text, pages int,
  role          text, topic text, judgment text,
  added_at      timestamptz not null default now(),
  last_read     timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, paper_key)
);
create index on papers (user_id, last_read desc);

create table highlights (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  paper_id      uuid not null references papers on delete cascade,
  paragraph_id  text not null,
  text          text not null,
  color         text not null default 'yellow',
  created_at    timestamptz not null default now()
);
create index on highlights (user_id, paper_id);

create table margin_notes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  paper_id      uuid not null references papers on delete cascade,
  paragraph_id  text not null,
  kind          text not null check (kind in ('explain','summarize','translate','ask')),
  source        text not null,
  body          text not null,
  created_at    timestamptz not null default now()
);
create index on margin_notes (user_id, paper_id);

create table memory (
  paper_id         uuid primary key references papers on delete cascade,
  user_id          uuid not null references auth.users on delete cascade,
  why_it_matters   text default '',
  role             text default '',
  judgment         text default '',
  linked           jsonb default '[]',
  next_actions     jsonb default '[]',
  updated_at       timestamptz not null default now()
);
create index on memory (user_id);

create table chat (
  paper_id    uuid primary key references papers on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  turns       jsonb not null default '[]',
  -- turns item shape: { id: string, role: 'user'|'assistant', content: string, ts: number }
  -- See spec §14.7.7.2
  updated_at  timestamptz not null default now()
);

create table canvas (
  paper_id    uuid primary key references papers on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  nodes       jsonb not null default '[]',
  updated_at  timestamptz not null default now()
);

create table subscriptions (
  user_id                 uuid primary key references auth.users on delete cascade,
  tier                    text not null default 'free'
                            check (tier in ('free','sync','pro')),
  stripe_customer_id      text,
  stripe_subscription_id  text,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,
  canceled_at             timestamptz,
  updated_at              timestamptz not null default now()
);

create table byok_prefs (
  user_id     uuid primary key references auth.users on delete cascade,
  base_url    text,
  model       text,
  updated_at  timestamptz not null default now()
);

create table ai_usage (
  user_id     uuid not null references auth.users on delete cascade,
  period      text not null,
  used        int not null default 0,
  primary key (user_id, period)
);

create table ai_usage_log (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  kind            text not null,
  tier_at_call    text not null,
  prompt_tokens   int,
  output_tokens   int,
  model           text,
  created_at      timestamptz not null default now()
);
create index on ai_usage_log (user_id, created_at desc);

create table rate_limits (
  user_id       uuid references auth.users on delete cascade,
  window_start  timestamptz not null,
  count         int not null default 0,
  primary key (user_id, window_start)
);
