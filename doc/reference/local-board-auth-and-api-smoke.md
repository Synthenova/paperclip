## Local Board Auth And API Smoke

This is the concrete path for testing board-authenticated API routes on a local or server-hosted Paperclip instance that uses embedded Postgres.

It avoids guessing about browser cookies and uses:

- a real Better Auth user
- a real `board_api_keys` record
- direct API calls with `Authorization: Bearer ...`

### 1. Confirm the local DB URL

For the default embedded instance, the DB URL is usually:

```sh
postgres://paperclip:paperclip@127.0.0.1:54329/paperclip
```

You can confirm the port from:

- `~/.paperclip/instances/default/config.json`

### 2. Create a test user

Sign up through the running API:

```sh
curl -sS -X POST http://127.0.0.1:3101/api/auth/sign-up/email \
  -H 'Content-Type: application/json' \
  --data '{"email":"smoke@example.com","password":"Paperclip123!","name":"Smoke User"}'
```

This creates the auth user. The JSON response token is not enough by itself for board-route testing.

### 3. Mint a board API key with local SQL

This repo already has the `postgres` npm package installed. Use the exact package path already documented in `doc/reference/local-db-inspection.md`.

Example:

```sh
node -e 'const postgres=require("/home/lamrin/paperclip/node_modules/.pnpm/postgres@3.4.8/node_modules/postgres"); const crypto=require("node:crypto"); const sql=postgres("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip"); const email="smoke@example.com"; const token=`pcp_board_${crypto.randomBytes(24).toString("hex")}`; const keyHash=crypto.createHash("sha256").update(token).digest("hex"); (async()=>{ const users=await sql`select id from \"user\" where email=${email} limit 1`; if(!users[0]) throw new Error("NO_USER"); const id=crypto.randomUUID(); const expiresAt=new Date(Date.now()+30*24*60*60*1000); await sql`insert into board_api_keys (id, user_id, name, key_hash, expires_at, created_at) values (${id}, ${users[0].id}, ${"smoke key"}, ${keyHash}, ${expiresAt.toISOString()}, now())`; console.log(JSON.stringify({userId: users[0].id, token}, null, 2)); await sql.end({timeout:1}); })().catch(async err=>{ console.error(err); try{ await sql.end({timeout:1}); }catch{} process.exit(1); });'
```

Important:

- prefer parameterized tagged-template SQL
- do not string-build SQL unless you absolutely must
- `board_api_keys` uses `key_hash`, not the raw token

### 4. Smoke-test board routes

Use the emitted board token as a bearer credential:

```sh
TOKEN='pcp_board_...'

curl -i -sS http://127.0.0.1:3101/api/cli-auth/me \
  -H "Authorization: Bearer $TOKEN"
```

Useful follow-up checks:

```sh
curl -i -sS http://127.0.0.1:3101/api/companies \
  -H "Authorization: Bearer $TOKEN"

curl -i -sS http://127.0.0.1:3101/api/companies/<companyId>/user-directory \
  -H "Authorization: Bearer $TOKEN"

curl -i -sS "http://127.0.0.1:3101/api/projects/<projectId>/workspaces/<workspaceId>/workspace/tree?path=&companyId=<companyId>" \
  -H "Authorization: Bearer $TOKEN"
```

### 5. What this proves

If these succeed, you have confirmed:

- auth user creation works
- board key lookup works
- board actor resolution works
- company-scoped board routes work
- merged project workspace explorer routes work

### 6. Session vs board key

Board routes accept:

- a real Better Auth board session, or
- a board API key bearer token

The JSON `token` returned by `sign-up/email` or `sign-in/email` is not the same thing as a board API key and should not be assumed to authorize board routes directly.
