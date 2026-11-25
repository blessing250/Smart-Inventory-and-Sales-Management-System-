# Deployment guide

## Spring staging acceptance

Use a dedicated staging hostname and synthetic data. From `backend/spring`, supply `BIZFLOW_STAGING_HOST`, `BIZFLOW_FOUNDATION_DB_PASSWORD` and a separate base64 `BIZFLOW_AUTH_SIGNING_KEY` through private environment configuration.

```powershell
docker version
docker compose -f compose.yaml -f compose.staging.yaml config --quiet
docker compose -f compose.yaml -f compose.staging.yaml up -d --build
docker compose -f compose.yaml -f compose.staging.yaml ps
docker compose -f compose.yaml -f compose.staging.yaml logs --tail=100 spring frontend proxy database
docker compose -f compose.yaml -f compose.staging.yaml restart spring frontend
```

Open `https://<staging-host>/staging` only after confirming the proxy certificate and service health. Exercise owner login, renew, logout, rejected cross-origin writes, and recovery with an approved test mailbox. Compare account balances and stock before and after restarts and verify the PostgreSQL port has no host publication. Keep the data volume for staging restarts. Verify encrypted off-host backup and restore using a fresh database before release. [Milestone 10 gates](SPRING_MILESTONE_10.md)

BizFlow needs one long-running Next.js Node process and a persistent, locally attached filesystem that supports SQLite locking and durable writes. Choose the host and confirm its storage before scheduling a cutover. Static hosting, ephemeral instances and independently scaled replicas cannot support the current state model. The repository has no selected provider.

## Prepare the service

1. Install Node.js 24 and pnpm 10. Use separate directories for each application release, the private writable data volume, and backups. Grant the service account exclusive application access to the SQLite directory. On Linux use directory mode `0700` and a service umask of `0077`. On Windows restrict the directory ACL to the service account and authorized operators.
2. Run `pnpm install --frozen-lockfile` and `pnpm build` from the application directory. Build without attaching the live database. Run under an unprivileged service account and keep the deployment directory out of the database write path.
3. Set `BIZFLOW_DB_PATH` to an absolute file path inside a precreated persistent directory outside the app. Set `NEXTAUTH_URL` to the canonical HTTPS origin and `NEXTAUTH_SECRET` to an independently generated secret. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` in a private shell. Store secrets in the service manager or its protected environment file.
4. Provide `BIZFLOW_OWNER_EMAIL`, `BIZFLOW_OWNER_NAME` and a unique randomly generated `BIZFLOW_OWNER_PASSWORD` for the initial owner login. The password must be at least 12 characters and at most 72 UTF-8 bytes. Restrict access to the instance during initial provisioning. Remove the initial password and restart the service after the owner signs in.
5. Run `pnpm start -H 127.0.0.1 -p 3000` under a service manager configured to restart on failure and launch after reboot. Give the process time to exit after sending its normal termination signal. On a separate proxy host use a private interface with firewall rules restricting access to the proxy.
6. Terminate HTTPS at the reverse proxy. Forward the canonical host and protocol, overwrite client forwarding headers, set a 3 MiB request body cap with a tighter cap for auth, and configure per-client limits for credentials, imports and report exports. Keep private pages and API responses out of shared caches. Enable HSTS after verifying the final HTTPS setup.

An HTTP loopback `NEXTAUTH_URL` is supported for isolated production builds used in staging tests. Use unrelated secrets, credentials and database files for development, staging and production.

## Monitor and accept the release

- `/api/health/live` confirms HTTP service availability. `/api/health/ready` reads the database schema version and checks that an owner exists. Fresh installs become ready after owner provisioning. Treat repeated 503 responses as an operator alert. The readiness probe checks readable state. Confirm write permissions with a staged transaction and validate persistence across process restart and host reboot.
- Collect process stderr and backup job output with restricted access. Alert on repeat unexpected API failures, process restarts, failed backup jobs and stale backup timestamps. Audit entries in SQLite record business actions independently of service logs.
- In staging, verify HTTPS cookie flags, lost-session and logout behavior, owner authorization, expense posting without a receipt, purchase and shipment workflows, sales and payments, reversals, and matching PDF/Excel totals. Run a restoration from off-server storage and rehearse the release rollback.
- For upgrades, use the [backup and restore runbook](BACKUP_AND_RESTORE.md) and keep the prior release and database path available. If writes have resumed on the new version, stop writes and reconcile those transactions before switching back to an older database.
