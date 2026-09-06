# Platform Admin

Fase 18.1 voegt een interne LeadGuard-beheeromgeving toe op `/platform-admin`. Dit is **niet** hetzelfde als `OrganizationMember.role = ADMIN`.

## Role model

| Layer                 | Model                     | Roles                |
| --------------------- | ------------------------- | -------------------- |
| Organization (tenant) | `OrganizationMember.role` | OWNER, ADMIN, MEMBER |
| Platform              | `PlatformAccess.role`     | SUPER_ADMIN, SUPPORT |

Platform access:

- is a separate `PlatformAccess` row (`userId` unique, `status` ACTIVE/DISABLED)
- is never granted via `/register`
- is never inferred from email
- is checked from the database on every request (no long-lived permission cache)

### SUPER_ADMIN

All platform permissions, including:

- grant/revoke platform roles
- disable/reactivate users
- manual organization suspend/reactivate
- entitlement overrides
- billing reconciliation
- exact known-revenue amounts
- monitor Run now and safe job retries

### SUPPORT

Read access plus constrained operations:

- inspect organizations, users, billing status, monitors, incidents, integrations, queues
- monitor Run now
- retry only mapped idempotent jobs

SUPPORT cannot:

- grant platform roles (including self-promotion)
- suspend organizations
- disable users
- create entitlement overrides
- see exact revenue amounts
- see secrets, OAuth refresh tokens, raw GCLID/GBRAID/WBRAID, password hashes, or queue payloads

There is no customer impersonation in this phase.

## Bootstrap

No default admin user is seeded.

1. Create a normal user (register, or an existing OWNER account).
2. Grant platform access from a trusted shell:

```bash
npm run platform-admin:grant -- --email you@example.com --role SUPER_ADMIN --reason "production bootstrap" --confirm
```

Without `--confirm` the command refuses to write. Unknown emails fail. Duplicate grants for the same role are idempotent. Later grants require an existing SUPER_ADMIN in the UI (`/platform-admin/users`).

The last active SUPER_ADMIN cannot be revoked or disabled.

## Routes

All routes are session-authenticated and require `PlatformAccess.status = ACTIVE`.

```text
/platform-admin
/platform-admin/organizations
/platform-admin/organizations/[organizationId]
/platform-admin/users
/platform-admin/users/[userId]
/platform-admin/billing
/platform-admin/monitoring
/platform-admin/incidents
/platform-admin/incidents/[incidentId]
/platform-admin/integrations
/platform-admin/revenue
/platform-admin/operations
/platform-admin/audit
```

Organization OWNER/ADMIN/MEMBER hitting these URLs get 403. There is no public admin API and no secrets endpoint.

## Permissions

Defined in `src/server/platform-admin/permissions.ts`. Enforcement is `requirePlatformRole()` / `requirePlatformPermission()` plus domain `assertPlatformActor()`. UI hiding is not authorization.

## Audit

`PlatformAuditEvent` is append-only. Metadata is sanitized (no secrets, tokens, click IDs). Sensitive mutations write an event.

## Operations

See [Operations console](OPERATIONS_CONSOLE.md).

## Production protection

App-level authorization is always required. Additionally protect `/platform-admin` at the edge:

- Cloudflare Access, or
- VPN, or
- reverse-proxy IP allowlist

Nginx/Cloudflare alone is not enough. Recommended for production, not required for local development.

## MFA

The current Auth.js credentials stack does not provide MFA. Do not treat password-only SUPER_ADMIN as sufficient for a large production staff. Enable edge Access + hardware keys (or a later MFA phase) before broadening the admin team.

## Manual suspension

`Organization.manualSuspendedAt` is independent of Stripe/billing status. Data and billing projection stay intact. Monitoring and billable creates pause until SUPER_ADMIN reactivates.

## Entitlement overrides

`OrganizationEntitlementOverride` adjusts a single feature or limit. It never rewrites `planKey`. Expired `expiresAt` rows are ignored by the calculator.
