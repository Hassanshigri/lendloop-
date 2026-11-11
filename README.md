# LendLoop

**Borrow what you need. Lend what you don't.**

A neighborhood tool-lending board. Neighbors list tools, request to borrow them for a date range, and approve, decline or close loans. Two n8n workflows send notifications and daily overdue reminders, with signed requests in both directions.

Stack: Next.js (App Router) · Clerk · Convex · n8n · TypeScript

---

## Architecture

```
 Browser (Next.js + Clerk)
   │  Clerk JWT on every Convex call
   ▼
 Convex ── queries / mutations ── every rule checked here (requireUser / requireAdmin / ownership)
   │  │
   │  └─ mutation commits ─► webhookDeliveries row + scheduled action
   │                              │  POST, HMAC-signed, retried with backoff
   │                              ▼
   │                         n8n: "Request notification"
   │                              verify signature ─► dedupe by eventId ─► notify ─► signed write-back
   │                                                                                     │
   ├─ HTTP GET  /n8n/overdue-loans      ◄── n8n: "Daily overdue reminders" (09:00 UTC)   │
   └─ HTTP POST /n8n/automation-events  ◄──────────── signed, idempotent ────────────────┘

 Any failed n8n run ─► "Error handler" workflow (logs workflow, node, error, execution link)
```

| Path | What it is |
| --- | --- |
| `convex/schema.ts` | Tables: users, tools, loans, webhookDeliveries, automationEvents |
| `convex/lib/auth.ts` | `requireUser` / `requireAdmin`, used at the top of every protected function |
| `convex/tools.ts`, `convex/loans.ts`, `convex/users.ts` | All reads and writes, with role and ownership checks |
| `convex/lib/signing.ts` | HMAC-SHA256 signing and verification, constant-time compare, 5 minute window |
| `convex/n8n.ts` | Outgoing webhook delivery with retries, overdue query, idempotent write-back |
| `convex/http.ts` | The two signed HTTP endpoints n8n calls |
| `app/page.tsx` | Public page: available tools, name and category only |
| `app/dashboard/page.tsx` | Signed-in app: all tools, my listings, incoming requests, my requests, admin |
| `n8n/workflows/*.json` | Exported workflows (no secrets inside) |
| `scripts/test-*.mjs` | Integration and permission tests |

## Roles and rules

| Action | user | admin |
| --- | --- | --- |
| See available tools (public page) | yes, signed out too | yes |
| List a tool; edit or delete **own** listings | yes | yes |
| Request to borrow someone else's tool | yes | yes |
| Approve, decline, mark returned on **own** tools | yes | yes |
| Cancel **own** pending request | yes | yes |
| Remove **any** listing | no | yes |
| View all loans, mark a lender "Trusted Lender" | no | yes |

Rules are enforced in Convex functions, not only hidden in the UI. Admin role comes from the server-side `ADMIN_EMAILS` variable when a user signs in, so a client can never grant itself admin. The `/dashboard` redirect in `proxy.ts` is a convenience, not the security boundary.

Business rules: no borrowing your own tool, no past start dates, end on or after start, loans up to 30 days, no overlapping approved loans, one pending request per borrower per tool. Approving a request auto-declines overlapping pending requests. Deleting a tool on loan is blocked; deleting with pending requests cancels them and notifies the borrowers.

---

## Local setup

Requirements: Node 20+, Docker Desktop, a free [Clerk](https://clerk.com) account and a free [Convex](https://convex.dev) account.

### 1. App and Convex

```bash
npm install
npx convex dev            # creates a Convex project and writes NEXT_PUBLIC_CONVEX_URL to .env.local
```

### 2. Clerk

1. Create a Clerk application and copy its keys into `.env.local`:
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.
2. In the Clerk dashboard, enable the **Convex** integration (or create a JWT template named `convex`), and copy the Frontend API URL.
3. Tell Convex about it:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
npx convex env set ADMIN_EMAILS you@example.com
```

### 3. Shared secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npx convex env set N8N_SHARED_SECRET <that value>
npx convex env set N8N_BASE_URL http://localhost:5678
```

### 4. n8n

```bash
cp .env.example .env      # set LENDLOOP_SHARED_SECRET (same value), CONVEX_SITE_URL, N8N_ENCRYPTION_KEY
docker compose up
```

Open http://localhost:5678, create the owner account, then open each LendLoop workflow and switch it to **Active**. The import service has already loaded them, and both main workflows point to the error handler.

`CONVEX_SITE_URL` is the Convex HTTP actions URL: `https://<deployment>.convex.site` for a cloud deployment, or `http://host.docker.internal:3211` for a local one.

### 5. Run

```bash
npm run dev               # http://localhost:3000
```

Optional demo data, including one overdue loan: `npx convex run seed:demo`

## Environment variables

| Name | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | `.env.local` | Convex client URL (written by `npx convex dev`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | `.env.local` | Clerk keys |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex env | Validates Clerk tokens |
| `ADMIN_EMAILS` | Convex env | Comma-separated emails that get the admin role |
| `N8N_SHARED_SECRET` | Convex env | HMAC key, 32+ characters |
| `N8N_BASE_URL` | Convex env | Where Convex sends notification webhooks |
| `LENDLOOP_SHARED_SECRET` | n8n `.env` | Same HMAC key, read by Code nodes via `$env` |
| `CONVEX_SITE_URL` | n8n `.env` | Convex HTTP actions URL |
| `N8N_ENCRYPTION_KEY` | n8n `.env` | Encrypts n8n's stored credentials |

`.env*` files are git-ignored except `.env.example`, which holds no values.

---

## Security decisions

**Signed requests in both directions.** Every Convex-to-n8n webhook and every n8n-to-Convex call carries `X-LendLoop-Timestamp` and an HMAC-SHA256 `X-LendLoop-Signature` over `timestamp.METHOD.path.body`. The receiver recomputes it and compares in constant time. Including the method and path means a signature for one endpoint cannot be replayed against another, and the 5 minute window stops later replays. Invalid calls get a bare `401` and a server-side log line.

**Secrets stay out of code and exports.** The HMAC key lives in Convex environment variables and in n8n's environment (`.env`, git-ignored). Workflow JSON references `$env.LENDLOOP_SHARED_SECRET`, so exported workflows contain no secrets. `N8N_ENCRYPTION_KEY` protects any credentials added to n8n later, such as SMTP for real email.

**Authorization on the server.** Each Convex function resolves the caller from the verified Clerk token and checks role and ownership before reading or writing. Input is validated (lengths, allowed categories, date formats) with Convex validators and explicit checks. Internal functions used by the HTTP endpoints are not callable from browsers.

**Reliability.**
- *Outgoing:* the status change and its `webhookDeliveries` row commit in the same transaction, so no event is lost. Delivery retries up to 5 times with exponential backoff (30s to 4 min). Final failures are stored with the error and logged.
- *Incoming:* n8n HTTP nodes retry 3 times. The write-back is idempotent: `idempotencyKey` is unique (`notify:<eventId>` or `overdue:<loanId>:<date>`), so a retried call returns `duplicate` instead of creating a second record. A later `sent` can upgrade an earlier `failed`, never the reverse.
- *Duplicates:* n8n also drops repeated `eventId`s, and the overdue endpoint skips loans already reminded that day, so a re-run never double-sends.
- *Failures are visible:* both workflows use the error-handler workflow, which logs the workflow, failed node, error and execution link. Failed executions are saved.

## Data minimization

- The public page returns only tool **name and category**, with no owner, description or status details.
- Members see a lender's **first name** only. Email addresses are never sent to other users.
- Each notification payload holds just what one message needs: event, tool name, dates, the recipient's first name and email, and the other person's first name. No Clerk IDs, descriptions or full names.
- The overdue endpoint returns only loan ID, idempotency key, tool name, due date, days overdue, and the borrower's first name and email.
- Mock notification logs mask email addresses (`b***@example.com`).
- Loan activity shown in the app ("Reminder sent 2 days ago") stores kind, status and time only...

---

## Tests

With a local backend (`npx convex dev`), the shared secret set, and `npx convex run seed:demo`:

```bash
# 16 checks: webhook signature, minimal payload, rejected unsigned / wrong / stale / cross-endpoint
# signatures, tampered body, idempotent write-back, no double reminders.
LENDLOOP_SHARED_SECRET=... CONVEX_SITE_URL=http://127.0.0.1:3211 node scripts/test-integration.mjs

# 20 checks: ownership and admin rules, run as different users through the Convex CLI.
node scripts/test-permissions.mjs
```

The integration test stands in for n8n with a small server that verifies signatures exactly as the n8n Code node does, so the contract is tested without Docker.

`npx convex run seed:reset` clears local data. It refuses to run unless `ALLOW_RESET=true` is set on that deployment.

---

## What I would change for production

- **Real delivery channel:** replace the mock notification nodes with SMTP or a transactional email provider stored as an n8n credential, with unsubscribe and notification preferences per user.
- **Hosting and secrets:** a pinned n8n version on a managed host behind HTTPS, with secrets in a secret manager and rotated. Support two active HMAC keys during rotation.
- **Stronger replay protection:** store recently seen signatures or nonces as well as checking the timestamp window.
- **Alerting:** route the error workflow and Convex delivery failures to Slack or PagerDuty, and add a dashboard of failed deliveries with a manual "retry" action.
- **Scale:** paginate tool and loan lists, denormalize "on loan" onto the tool document instead of scanning loans, and add rate limits to request creation.
- **Audit and retention:** an append-only audit log for admin actions, and retention rules that purge old automation events and webhook payloads.
- **Testing and CI:** convex-test unit tests and Playwright end-to-end tests in CI, plus a staging environment with its own Clerk, Convex and n8n.
- **Time zones:** store each user's time zone and send reminders in local morning hours instead of 09:00 UTC.
