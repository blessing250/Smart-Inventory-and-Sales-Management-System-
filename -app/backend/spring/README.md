# Spring backend foundation

Run this service against a disposable database whose name starts with `bizflow_foundation_`. Flyway applies V1 through V11. The existing Next.js app remains authoritative. [OpenAPI contract](openapi.yaml) · [Milestone 9 staging and deployment](../../docs/SPRING_MILESTONE_9.md) · [Reporting](../../docs/SPRING_REPORTING.md)

For a local run with JDK 25 and Maven, set these environment variables privately. Use a role allowed to create the foundation schema in the disposable database.

- `BIZFLOW_FOUNDATION_DATABASE` is the exact disposable database name.
- `BIZFLOW_FOUNDATION_JDBC_URL` is its JDBC URL.
- `BIZFLOW_FOUNDATION_DB_USER` and `BIZFLOW_FOUNDATION_DB_PASSWORD` are its PostgreSQL credentials.
- `BIZFLOW_AUTH_SIGNING_KEY` is a separate secret of at least 32 cryptographically random bytes in base64. Do not reuse `NEXTAUTH_SECRET`.
- `BIZFLOW_AUTH_APP_URL` is the trusted browser origin. See [the environment example](.env.example) for issuer, audience and SMTP settings.

From this directory run `mvn verify` for unit tests and the JAR. Set `BIZFLOW_FOUNDATION_TEST=1` to include the HTTP and PostgreSQL integration test. Run `mvn spring-boot:run` to use the loopback health endpoints on port 8081.

For containerized development set the private database password and signing key, then run `docker compose up --build` from this directory. Compose keeps PostgreSQL on its own network and publishes Spring on loopback.

## Authentication and recovery

The login response contains a 10-minute HS256 bearer token. Use the `Authorization: Bearer` header. Spring verifies signature, issuer, audience, timestamps, owner role and the corresponding active PostgreSQL session. Logout revokes the current session. A password reset revokes every outstanding owner session. The opt-in staging browser endpoints use an HttpOnly, SameSite Strict rotating refresh cookie over the same-origin relay. Business APIs still require a bearer in the Authorization header. The staging session lasts at most eight hours. [Browser setup](../../docs/SPRING_MILESTONE_8.md)

Enable SMTP with `BIZFLOW_AUTH_SMTP_ENABLED=true`, the SMTP settings in the environment example, and a trusted HTTPS application URL. The SMTP sender uses implicit TLS or required STARTTLS with hostname verification. SMTP is disabled by default. The PostgreSQL integration suite uses a private in-memory outbox. Production staging still needs a real delivery test to an approved mailbox.

## Restricted owner commands

From a private console on a trusted host, set the disposable database and signing-key configuration above. Turn SMTP off and run `mvn verify` to build the JAR. Provision the only owner or reset an existing owner with a masked password prompt.

```powershell
java -jar target/bizflow-backend-0.1.0-SNAPSHOT.jar --spring.main.web-application-type=none --bizflow.auth.admin=provision
java -jar target/bizflow-backend-0.1.0-SNAPSHOT.jar --spring.main.web-application-type=none --bizflow.auth.admin=recover
```

Use the provision command only for an empty disposable database. Add `--bizflow.auth.verify-mailbox=true` only after verifying the mailbox through the operator's approved process. The recovery command leaves the owner email unchanged and audits the password change. No public account provisioning route is registered.

Provisioning assigns one UUID as the owner ID. Email changes or password resets must preserve that ID. At eventual migration, carry the existing stable ID forward through an explicit import.
