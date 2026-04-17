# Local DB Inspection

This is a quick reference for inspecting a local running Paperclip instance through its embedded Postgres database.

## When To Use This

Use this when you need to inspect agent config, company records, or recent heartbeat runs directly without going through the API.

This only works if the local Paperclip instance is already running.

## What I Used

- Instance config path:
  - `/home/lamrin/.paperclip/instances/default/config.json`
- Embedded Postgres host:
  - `127.0.0.1`
- Embedded Postgres port for this instance when checked:
  - `54329`
- Connection string:
  - `postgres://paperclip:paperclip@127.0.0.1:54329/paperclip`

The port may be different on another machine or another running instance.

## Package Used For Queries

This repo already has the `postgres` npm package installed, so you can use Node directly:

```bash
require("/home/lamrin/paperclip/node_modules/.pnpm/postgres@3.4.8/node_modules/postgres")
```

## Minimal Query Pattern

```bash
node -e 'const postgres=require("/home/lamrin/paperclip/node_modules/.pnpm/postgres@3.4.8/node_modules/postgres"); const sql=postgres("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip"); (async()=>{ const rows=await sql`select id,name,status from companies order by created_at desc`; console.log(JSON.stringify(rows,null,2)); await sql.end({timeout:1}); })().catch(err=>{console.error(err); process.exit(1);});'
```

## Find Companies

```bash
node -e 'const postgres=require("/home/lamrin/paperclip/node_modules/.pnpm/postgres@3.4.8/node_modules/postgres"); const sql=postgres("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip"); (async()=>{ const rows=await sql`select id,name,status from companies order by created_at desc`; console.log(JSON.stringify(rows,null,2)); await sql.end({timeout:1}); })().catch(err=>{console.error(err); process.exit(1);});'
```

## Find One Agent By Company And Name

```bash
node -e 'const postgres=require("/home/lamrin/paperclip/node_modules/.pnpm/postgres@3.4.8/node_modules/postgres"); const sql=postgres("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip"); (async()=>{ const rows=await sql`select a.id,a.name,a.adapter_type,a.adapter_config::text as adapter_config,a.runtime_config::text as runtime_config from agents a join companies c on c.id=a.company_id where lower(c.name)=lower(${"Conthunt"}) and lower(a.name)=lower(${"Strategist"})`; console.log(JSON.stringify(rows,null,2)); await sql.end({timeout:1}); })().catch(err=>{console.error(err); process.exit(1);});'
```

## Find Recent Heartbeat Runs For An Agent

```bash
node -e 'const postgres=require("/home/lamrin/paperclip/node_modules/.pnpm/postgres@3.4.8/node_modules/postgres"); const sql=postgres("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip"); (async()=>{ const rows=await sql`select id,status,error,started_at,finished_at,created_at from heartbeat_runs where agent_id in (select a.id from agents a join companies c on c.id=a.company_id where lower(c.name)=lower(${"Conthunt"}) and lower(a.name)=lower(${"Strategist"})) order by created_at desc limit 10`; console.log(JSON.stringify(rows,null,2)); await sql.end({timeout:1}); })().catch(err=>{console.error(err); process.exit(1);});'
```

## Notes

- Prefer parameterized tagged-template queries like ``sql`... ${value}``` instead of string-building SQL.
- `adapter_config` and `runtime_config` are JSON columns, so `::text` is useful for quick inspection.
- Useful tables for this kind of debugging:
  - `companies`
  - `agents`
  - `heartbeat_runs`
