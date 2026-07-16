# Todos App — Orion-core + Orion-Orchestrator end-to-end demo

A minimal todos app used to exercise the whole Orion stack for real: a static
HTML/CSS/JS client, a Node/Express API built on Orion-core (auth + custom
`/todos` routes backed by Postgres), and Orion-Orchestrator running as a live
second process to prove the cluster control plane actually syncs up.

```
server/         API on Orion-core (port 3900 by default)
orchestrator/   Orion-Orchestrator process (port 55321 by default)
client/         Static HTML/CSS/JS, served separately (port 8080 by default)
```

The client and server are **separate deployments** — the client calls the API
by URL (`client/config.js`), not same-origin. This mirrors the intended live
EC2 test: static client on one port, API on another.

## Bugs found and fixed while building this

Building a real app against Orion-core surfaced four bugs that had never been
exercised by the unit suite (all in `Packages/server/Orion-core/lib`):

1. **`Utils/Core/AccountManagment/CreateAccount.js`** — email/password signup
   checked `authMethods.passkey` instead of `authMethods.emailPassword`.
   Combined with the (correct, documented) behavior that passkeys get
   force-disabled with no `mail` credentials configured, this meant **no app
   could register users via email/password without mail credentials**, even
   if it never touched passkeys.
2. **`Utils/Core/AccountManagment/SignIn.js`** (×3) — access/refresh token
   generation read `user.data.credentials.uid`, a path that doesn't exist on
   the user record (`user` is a flat row; the correct field, used elsewhere in
   the same file, is `user.uid`). Every password sign-in 500'd.
3. **`Utils/Core/TokenManagement/RefreshTokens.js`** — the refresh token's
   `iss` claim was built from `server.selfUrl` (a string) instead of
   `server.urls` (an array), passed into a function that unconditionally calls
   `.map()`. Crashed refresh-token issuance on every sign-in.
4. **`Server/Middleware/authentication.js`** — the custom-endpoint allowlist
   check used exact string equality against the request path, so a
   parameterized route like `/todos/:id` never matched an actual request to
   `/todos/1`. Fixed with a segment-aware matcher (`pathMatchesPattern`) so
   `:param` segments match a single path segment, same length required
   otherwise — any app with RESTful `/resource/:id` custom routes needs this.

All four are one-file, narrowly-scoped fixes in Orion-core itself, verified by
rerunning the full signup → sign-in → CRUD flow (curl) and a real headless
Chromium pass (Playwright) after each fix.

## Run locally

Requires a Postgres instance reachable from the app (any local install or
container works — during development this was verified against
`docker run -d -e POSTGRES_PASSWORD=<pw> -e POSTGRES_DB=todos_orion -p 5433:5432 postgres:16-alpine`).

1. **Config**: copy `server/orion.config.example.js` to
   `server/gipsy.orion.config.js` (gitignored — see the repo's `gipsy.*`
   convention) and fill in your Postgres credentials.
2. **API server**:
   ```
   cd server
   node index.js
   ```
   It runs its own `todos` table migration on boot (`server/todos/TodosModel.js`)
   against the same Postgres database Orion-core's auth tables live in.
3. **Orchestrator** (optional but recommended — this is the whole point of the
   live test):
   ```
   cd orchestrator
   node start.js
   ```
   Start this **before** the API server for a clean first handshake; the API
   server retries with backoff either way (`requireOrchestrator: false`), so
   order isn't strictly required after the first run.
4. **Client**:
   ```
   cd client
   python -m http.server 8080
   ```
   Open `http://localhost:8080`. If you change the API server's port or host,
   update `client/config.js`'s `SERVER_URL` and add the client's exact origin
   to `client.urls` in `gipsy.orion.config.js` (CORS + cookies require an exact
   match), then restart the API server.

You should see, in the orchestrator's terminal, `[hello]` when the API server
joins and `[health] FORMING -> HEALTHY` once the cluster settles — that's the
control-plane sync working.

## AWS EC2 — live test runbook

You provision the instance; the commands below are copy-paste guidance.

### 1. Instance

- AMI: **Ubuntu 22.04 LTS**
- Size: **t3.small** recommended (Node + Postgres + orchestrator fit
  comfortably in 2GB). `t3.micro`/`t2.micro` work if you want it cheaper and
  can tolerate slower boots.

### 2. Security group

| Port | Purpose | Source |
|---|---|---|
| 22 | SSH | your IP only |
| 3900 | Todos API | your IP, or `0.0.0.0/0` for a public demo |
| 8080 | Static client | same as above |

Leave **55321/55322 closed** — orchestrator and API server run on the same box
and talk over `127.0.0.1`, so the cluster-sync test is fully observable via
SSH without widening the attack surface.

### 3. Bootstrap on the instance

```bash
# Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PostgreSQL
sudo apt-get install -y postgresql
sudo -u postgres createuser todos_app -P    # set a password when prompted
sudo -u postgres createdb todos_orion -O todos_app

# Copy the repo (from your machine, excluding node_modules)
rsync -avz --exclude node_modules --exclude '.git' \
  /path/to/orion/ ubuntu@<EC2-IP>:~/orion/

# On the instance: install deps (pulls in orion-orch/r-sync via their
# file: deps automatically)
cd ~/orion/Packages/server/Orion-core && npm install
```

### 4. Configure

On the instance, create `~/orion/Packages/apps/Todos-App/server/gipsy.orion.config.js`
(copy `orion.config.example.js` and edit):

- `db.credentials` — the `todos_app` Postgres user/password from step 3
- `client.urls` — `['http://<EC2-public-ip>:8080']`
- `server.urls` / `selfUrl` — `http://<EC2-public-ip>:3900`

Edit `client/config.js` locally (or on the instance) so `SERVER_URL` points at
`http://<EC2-public-ip>:3900`.

### 5. Run (tmux, so you can watch both processes live)

```bash
tmux new -s todos
# pane 1
cd ~/orion/Packages/apps/Todos-App/orchestrator && node start.js
# Ctrl-b % for pane 2
cd ~/orion/Packages/apps/Todos-App/server && node index.js
# Ctrl-b % for pane 3
cd ~/orion/Packages/apps/Todos-App/client && python3 -m http.server 8080
```

### 6. Verify

Open `http://<EC2-IP>:8080` in a browser: sign up, sign in, add/toggle/delete
a few todos, sign out, sign back in and confirm the list persisted. In
parallel, watch the orchestrator pane for `[hello]` (node joined) and
`[health] FORMING -> HEALTHY` (cluster confirmed) — that's the full stack
proven live, not just unit-tested.

### 7. Teardown

Stop or terminate the instance when done — Postgres plus two Node processes
will otherwise keep the box warm (and billed) indefinitely.
