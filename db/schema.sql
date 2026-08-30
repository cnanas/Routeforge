-- Shared routes. Anyone with a link can read; only the creator's edit token
-- can overwrite, so a link can be handed out without handing over control.

create table if not exists routes (
  id           text primary key,
  edit_token   text        not null,
  name         text        not null,
  dungeon_idx  integer     not null,
  -- The canonical MDT route string. Storing the same serialisation the game
  -- uses means shared routes go through the codec the tests already cover.
  payload      text        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  views        integer     not null default 0
);

create index if not exists routes_updated_at_idx on routes (updated_at desc);

-- Coarse abuse control for anonymous writes. Serverless has no shared memory,
-- so the counter lives in the database.
create table if not exists write_limits (
  bucket     text        primary key,
  hits       integer     not null default 0,
  expires_at timestamptz not null
);

create index if not exists write_limits_expires_idx on write_limits (expires_at);
