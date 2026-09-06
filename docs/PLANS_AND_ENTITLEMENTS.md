# Plans and entitlements

Product limits are **configuration**, not a commercial contract. Display prices come from `BILLING_DISPLAY_PRICE_*` or Stripe. Do not hardcode euro amounts in business logic.

## Plan keys

Public: `STARTER`, `GROWTH`, `PRO`, `AGENCY`  
Internal: `LEGACY` (grandfathered Fase 1–17 orgs; not sold)

Mapping: `PlanKey` → env Stripe Price ID (`STRIPE_PRICE_*_MONTHLY`). Yearly prices are out of v1.

## Entitlements

`calculateEntitlements` in `src/server/billing/entitlements.ts` is the source of truth. Business code checks features such as `entitlements.features.googleAdsConversionFeedback`, never `plan === "PRO"`. SUPER_ADMIN can add an `OrganizationEntitlementOverride` for a single limit or feature; expired overrides are ignored. Never set `planKey` to fake a higher plan.

`EntitlementService` (`loadEntitlements`, `requireFeature`, `requireCapacity`, `canUseFeature`):

| Resource / feature             | Starter | Growth | Pro | Agency | Legacy |
| ------------------------------ | ------- | ------ | --- | ------ | ------ |
| maxWebsites                    | 1       | 5      | 15  | 50     | 50     |
| maxMonitors                    | 5       | 25     | 100 | 400    | 400    |
| maxFormMonitors                | 1       | 5      | 20  | 80     | 80     |
| maxOrganizationMembers         | 2       | 5      | 15  | 40     | 40     |
| maxGoogleAdsCustomers          | 1       | 3      | 10  | 40     | 40     |
| maxOutcomeIntegrations         | 1       | 3      | 10  | 40     | 40     |
| revenueAnalytics               | yes     | yes    | yes | yes    | yes    |
| googleAdsDestinationMonitoring | yes     | yes    | yes | yes    | yes    |
| googleAdsConversionFeedback    | yes     | yes    | yes | yes    | yes    |
| csvImports                     | yes     | yes    | yes | yes    | yes    |
| apiOutcomeIngestion            | yes     | yes    | yes | yes    | yes    |
| browserMonitoring              | yes     | yes    | yes | yes    | yes    |
| formMonitoring                 | yes     | yes    | yes | yes    | yes    |

Differentiation in v1 is **volume**, not hiding core monitoring/attribution. Values live in `src/server/billing/catalog.ts` so they can change without rewriting architecture.

## Usage

`PlanUsageService` (`getOrganizationUsage`) counts indexed rows:

- Websites: `status = ACTIVE`
- Monitors: `deletedAt IS NULL` (paused still counts)
- Form monitors: FORM + not deleted
- Members: membership rows
- Google Ads customers: `selected` and not manager
- Outcome integrations: `ENABLED`

Leads, outcomes, won/lost and attribution events are **never** dropped for plan limits.

## Enforcement

Create/enable paths call `requireCapacity` / `requireFeature` server-side, inside a transaction with `pg_advisory_xact_lock(hashtext(organizationId))` where a new billable row is inserted.

Blocked when over limit or without access: website create, monitor create, form/browser features, Google Ads customer select, outcome integration create, CSV import, analytics enable, conversion feedback activate.

UI shows an upgrade message, not a silent failure. Discovery copy may say a feature is available on a paid plan rather than hiding the entry point.

## Over-limit / downgrade

Downgrade never deletes or auto-pauses resources. Status is `OVER_LIMIT`: existing monitoring continues, new billable creates are blocked. Copy:

```text
Your organization uses 10 websites.
Your current plan supports 3.
Remove 7 websites or upgrade.
```

## Access by billing status

| Effective status      | Monitoring | New billable resources |
| --------------------- | ---------- | ---------------------- |
| TRIALING / ACTIVE     | yes        | yes (if under limit)   |
| GRACE_PERIOD          | yes        | yes (if under limit)   |
| PAST_DUE (no grace)   | yes        | no                     |
| OVER_LIMIT            | yes        | no                     |
| SUSPENDED             | no         | no                     |
| TRIAL_EXPIRED         | no         | no                     |
| CANCELED (period end) | until end  | until end              |

## Permissions

- `billing:read` — OWNER, ADMIN, MEMBER
- `billing:manage` — OWNER only (Checkout, Portal, refresh)

## Overrides

No self-serve entitlement override. Tests/dev without a subscription row get an INTERNAL `LEGACY` row only when `NODE_ENV=test`. Production missing rows are not auto-upgraded to a paid plan.
