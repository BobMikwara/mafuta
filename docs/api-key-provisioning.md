# API key provisioning, verification and troubleshooting

The console shows `API key rejected. Check the key and try again. Valid API key
credentials are required.` whenever `/v1/*` answers 401. That message is about
the credential the caller presented, but the server answers it in two very
different situations:

1. the presented key really is unknown to the credential store, or
2. the credential store holds no usable key at all, so no key could ever be
   accepted.

Case 2 is the one that wastes an afternoon, because the operator holds a key
that was copied straight out of the environment and every request still 401s.
The steps below separate the two, and the controls in this document exist to
keep case 2 from happening silently.

## How a credential reaches the store

| Path         | Environment                                                        | Store                                                                                            | Notes                                                                                      |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Demo seed    | `FUELTRACK_SEED_DEMO=true` and `FUELTRACK_DEV_API_KEY=<16+ chars>` | Prisma when `USE_PRISMA=true` or `DATABASE_URL` points at Postgres, otherwise per-process memory | Installs the operator supplied key for `FUELTRACK_DEMO_TENANT_ID` and creates sample tanks |
| Operator CLI | `npm run key:provision -- --tenant <id> --name <label>`            | Same selection as the API                                                                        | Generates a key, prints it once, stores only its hash                                      |

`FUELTRACK_DEV_API_KEY` is inert unless `FUELTRACK_SEED_DEMO=true`: the seed is
what installs it. A key that was never installed cannot be accepted, which is
the first thing to check when a rejection looks impossible.

`key:provision` refuses to write to the in-memory store, because a key written
to a process that exits immediately is a key no server can accept, which then
looks exactly like a rejected key. Point it at a durable store, or pass
`--allow-ephemeral` when the credential is meant for one in-process run.

## Verify a key against a deployment

```bash
npm run build
cat key.txt | npm run key:verify -- --tenant demo-tenant
npm run key:list -- --tenant demo-tenant
```

`key:verify` reads the key from stdin on purpose: command line arguments are
visible in the process table and land in shell history. It prints the tenant,
the key id and the scopes, or `REJECTED` with a reason, and it never echoes the
key. `key:list` shows ids, names, statuses and last use, never key material or
hashes.

## Diagnose a rejection in this order

1. `GET /healthz` on the API the console is actually talking to (the field is
   printed as `API URL` in the console panel).

   | `credentials`    | Meaning                                            | Action                                                                                     |
   | ---------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
   | `ready`          | The store holds at least one usable key            | The problem is the key itself: verify it with `key:verify`                                 |
   | `empty`          | No usable key exists anywhere                      | Provision one, or enable the seed                                                          |
   | `unavailable`    | The store could not be read                        | Check `database` and `DATABASE_URL`; this is usually an unmigrated or unreachable database |
   | `not_configured` | The process was built without the credential check | Only embedded servers; the deployed API always reports a state                             |

   `/healthz` answers 503 `{"status":"degraded"}` when `credentials` is not
   `ready`, so a deployment that cannot authenticate anybody no longer reports
   itself healthy.

2. `GET /v1/tanks` with the key. The status code now says which fault it is:

   | Status | Body                                                                          | Meaning                                                                                      |
   | ------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
   | 401    | `{"error":"unauthorized","message":"Valid API key credentials are required"}` | The store has other usable keys, so this credential is genuinely unknown, revoked or expired |
   | 503    | `{"error":"credentials_not_provisioned"}`                                     | The store is reachable and holds no usable key, so no key would be accepted                  |
   | 500    | `{"error":"internal_error","requestId":"req-..."}`                            | The credential lookup itself threw; read the logs by `requestId`                             |

3. Read the server logs for the same `requestId`. Authentication failures are
   logged as `auth.rejected` with a non-secret `reason`:

   - `missing_credentials`: no `Authorization` header, or an empty bearer value.
   - `malformed_credentials`: the presented value is empty after normalization or
     longer than 256 characters. Nothing is logged about its content.
   - `credential_not_found`: the value was well formed and unknown to the store.
     `usableCredentials` shows how many keys the store does hold, so `0` proves
     the deployment is unprovisioned and any other number proves the key is
     simply not the one that was provisioned.

   Cold start problems that stopped the key from being installed appear as
   `seed.step_failed` with the failing step (`api-key` is the credential step),
   and as `credentials.missing` with a `hint` that names the variable to set.
   `credentials.ephemeral_store` warns when the deployment is running with the
   in-memory store, where a key is not visible to other instances and does not
   survive a restart.

4. Compare the console's `API URL` with the deployment you provisioned. A key is
   rejected by every deployment that does not hold it, so a stale `VITE_API_URL`
   or a key issued for a different Vercel environment (Production against
   Preview) looks exactly like a wrong key. The console error message now names
   the API origin it reached so this can be ruled out from the screen.

## Environment variables

| Variable                        | Default       | Purpose                                                                                          |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| `FUELTRACK_REQUIRE_CREDENTIALS` | `true`        | Refuses to start when no usable key is stored. `false` allows a credential-less start            |
| `FUELTRACK_SEED_DEMO`           | `false`       | Installs demo data and the operator supplied key at startup                                      |
| `FUELTRACK_DEV_API_KEY`         | empty         | The key the demo seed installs. Minimum 16 characters. Only used when `FUELTRACK_SEED_DEMO=true` |
| `FUELTRACK_DEMO_TENANT_ID`      | `demo-tenant` | Tenant the seeded key belongs to                                                                 |
| `USE_PRISMA`                    | `false`       | Use Postgres (and a durable credential store) instead of in-memory                               |
| `DATABASE_URL`                  | empty         | Connection string. Required for a durable store, including when `USE_PRISMA=true`                |
| `FUELTRACK_DASHBOARD_DIR`       | empty         | Optional dashboard asset directory override                                                      |

The console has no key variable: it never receives one from configuration. The
operator pastes the key into the connection panel, it is kept in
`sessionStorage` for the tab, and it is sent only in the `Authorization`
header.

## Security properties

- Only SHA-256 hashes are stored. `api_keys.keyHash` is the single unique index
  used for lookup; a database dump does not yield usable credentials.
- The secret is returned exactly once, at provisioning time. Nothing in the API
  can read it back: list operations project to `id`, `name`, `scopes`, `status`,
  `createdAt`, `expiresAt` and `lastUsedAt`.
- No code path logs key material. The `auth.rejected` record carries a reason
  code, a request id, the remote address, the caller's user agent and a count of
  usable credentials; the presented value never reaches a log line. The
  redaction is asserted by tests that grep the captured log records for the
  presented secret.
- Diagnostics never return internals to a caller. A 503 provisioning fault has a
  fixed body, and the remediation text lives in the logs.
- A rejection is not a credential oracle: for a store that holds keys, the 401
  body is identical whether the credential is unknown, revoked or expired. The
  503 is decided only by how many usable credentials exist and not by the
  presented value.
- Timing is kept flat: hash comparison uses `timingSafeEqual`, and the
  credential store reader is cached for a few seconds so an unauthenticated
  caller cannot turn rejections into extra database reads.
- The endpoint that serves the dashboard is allow-listed to two asset files, and
  API responses carry `Cache-Control: no-store` so a rejected request is never
  cached by an intermediary.
- In the browser, the key lives in `sessionStorage` (not `localStorage`), is
  never placed in a URL, and is never sent anywhere except the API origin.

## Remaining operator steps

1. Set `USE_PRISMA=true` and `DATABASE_URL` (pooled connection string) so the
   credential store is durable and shared.
2. Apply migrations (`npm run db:deploy`) so the `api_keys` table exists. A
   missing table makes the seeding step fail, which leaves the store empty and
   produces the 401s this document is about.
3. Provision the key: `npm run key:provision -- --tenant <id> --name <label>`,
   then store the printed secret in the platform's secret manager.
4. Confirm: `curl -H "Authorization: Bearer <key>" https://<api>/v1/tanks`
   returns 200, and `GET /healthz` reports `"credentials":"ready"`.
5. Keep `FUELTRACK_REQUIRE_CREDENTIALS=true` so a future empty store fails the
   deploy instead of failing the users.
