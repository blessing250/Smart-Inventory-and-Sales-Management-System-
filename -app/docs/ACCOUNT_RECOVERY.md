# Owner account recovery

For Spring staging, configure `BIZFLOW_AUTH_APP_URL` to the exact staging browser origin and `BIZFLOW_AUTH_RESET_PATH=/staging/reset-password`. The browser submits the fragment token to the existing Spring reset endpoint and removes the fragment from the address bar. Use separate signing keys for NextAuth and Spring. Carry the owner ID, email and verified-compatible bcrypt hash through the historical import. Establish recovery-email verification from approved evidence before enabling SMTP. Provision a fresh Spring session on first login. [Milestone 9 security results](SPRING_MILESTONE_9.md)

The recovery email must match the owner account already registered in SQLite. `BIZFLOW_OWNER_EMAIL` in `.env` is an initial provisioning setting. An authorized operator verifies that the owner controls the registered mailbox before setting `BIZFLOW_VERIFIED_RECOVERY_EMAIL`. Reverify it after any account-email change.

## Configure and validate SMTP

1. Use the [database upgrade runbook](BACKUP_AND_RESTORE.md) to take a verified backup and explicitly upgrade a copy to schema 24. Owners must sign in again after the upgrade because prior sessions lack the account stamp.
2. Set `NEXTAUTH_URL` to the canonical HTTPS origin, configure the existing `NEXTAUTH_SECRET`, and store recovery settings as server-side secrets. Set `BIZFLOW_RECOVERY_TRANSPORT=smtp` and provide `BIZFLOW_SMTP_HOST`, `BIZFLOW_SMTP_PORT`, `BIZFLOW_SMTP_USER`, `BIZFLOW_SMTP_PASSWORD`, `BIZFLOW_SMTP_FROM`, and `BIZFLOW_VERIFIED_RECOVERY_EMAIL`. Use SMTP with STARTTLS on port 587 or implicit TLS on 465. Use a verified sender and disable provider click tracking and message-body logging for recovery mail. [Nodemailer SMTP configuration](https://nodemailer.com/smtp)
3. Keep request bodies out of reverse-proxy and application logs. Add per-client rate limits to `POST /api/recovery`. The app also enforces fixed one-minute per-process limits and a one-minute issuing cooldown per owner. Monitor sanitized `recovery.request_failed` events. Delivery runs after the generic response. If delivery fails, the unusable token is removed. The owner can request a new link.
4. In approved staging, verify delivery to a controlled mailbox, access via the HTTPS link, expiration and single use, old-session rejection, and sign-in with the replacement password. Review proxy and provider logs for accidental disclosure. Recovery remains pending for production until these checks pass.

With SMTP disabled or incompletely configured, the recovery form reports email recovery as unavailable. Valid requests on a configured instance show the same generic confirmation for all addresses, including when SMTP later fails. Reset links expire after 30 minutes and are single use. The browser removes the link fragment after loading it.

## Local recovery testing

Use a disposable database, synthetic owner, and private directory outside the app for `BIZFLOW_RECOVERY_OUTBOX`. Set `BIZFLOW_RECOVERY_TRANSPORT=file` and the synthetic `BIZFLOW_VERIFIED_RECOVERY_EMAIL`. Use an OS directory restricted to the operator and dev server account. On Windows restrict the ACL. On Unix use mode `0700`. Start `pnpm dev` on loopback. Open the generated message privately in the outbox and delete it after the test. The file transport is disabled in production builds.

## Recover without the registered mailbox

An operator with authenticated administrative access to the host must verify the owner's identity through the business's established offline process. Confirm the database path, stop the application and any other writers, and take a verified backup. If required, explicitly upgrade a copy to schema 24 before running recovery.

From the app directory in a private PowerShell session, set `$db` to the approved absolute database path and run:

```powershell
$secret = Read-Host 'New owner password' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
$previousEncoding = $OutputEncoding
try {
  $OutputEncoding = [Text.UTF8Encoding]::new($false)
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) |
    node scripts/recover-owner.mjs $db --service-stopped-and-backup-verified
  if ($LASTEXITCODE -ne 0) { throw 'Owner recovery failed.' }
} finally {
  $OutputEncoding = $previousEncoding
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  $secret.Dispose()
}
```

The command updates the existing owner, preserves the registered email, removes outstanding reset links, revokes old sessions, and records an audit event. Restart the service and sign in using the original registered email and replacement password. If the owner also needs a new recovery email, update it in Settings after signing in, verify the new mailbox, and update the operator-managed recovery configuration.

If a restored backup predates a recovery or rolls back a password change, repeat the offline password recovery before reopening access. That invalidates sessions and reset links tied to the restored account state.

## Spring migration environment

The Spring API provides separate forgot, verify and reset endpoints with the same 30-minute, single-use rule. Its verified mailbox and sessions live in disposable PostgreSQL. TLS SMTP and restricted provisioning/recovery instructions are in the [Spring guide](../backend/spring/README.md). The current Next.js owner credentials and recovery procedure apply to the running business app until cutover.
