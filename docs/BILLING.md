# Billing

LeadGuard billing is Organization-scoped. Stripe is the external source of truth for Customer, Subscription and invoices. LeadGuard stores a local projection and never stores card data.

```text
Stripe Checkout / Portal / invoices
        ↓
verified webhook (signature required)
        ↓
BillingCustomer + BillingSubscription
        ↓
EntitlementService
        ↓
LeadGuard access
```

Stripe is not called on every page view. Application authorization reads the local projection.

## Stripe API

SDK: `stripe` (see `package.json`). API version is centralized in `src/server/billing/config.ts` as `2026-08-26.dahlia`.

Hosted Checkout (`mode: subscription`) and the Customer Portal are used. LeadGuard does not render a card form.

## Tenant model

One Organization → one Stripe Customer → at most one primary subscription.

The client may send only `planKey`. The server maps that to an allowlisted Stripe Price ID. Arbitrary `price_…` values are rejected.

## Trial

V1 uses a **LeadGuard-local trial** so signup does not require a card:

```text
signup → organization → INTERNAL GROWTH trial → use the product → Checkout before trial end
```

`User.trialConsumedAt` prevents a trivial second trial after cancel + new org by the same owner. Stripe Checkout later replaces the INTERNAL subscription. Stripe subscription trial is not used for the initial no-card period.

Trial length comes from `BILLING_TRIAL_DAYS` (default 14). UI copy uses that value.

After expiry without a paid subscription the status becomes `TRIAL_EXPIRED`. Historical data remains. Upgrade is required for new billable resources and monitoring.

## Checkout

OWNER (`billing:manage`) starts Checkout. ADMIN/MEMBER have `billing:read` only.

Idempotency: Stripe/fake idempotency key `checkout:{organizationId}:{planKey}` plus a local `BillingCheckoutSession` row. Double-clicks reuse the open session.

Success URL is not authorization. The confirm page waits until the local projection is `ACTIVE`/`TRIALING` from a verified webhook.

## Customer Portal

OWNER **Manage billing** creates a short-lived Portal session for that Organization's customer only. The URL is not persisted. Payment methods, invoices, cancellation and plan changes (when enabled in the Stripe Dashboard) stay in Stripe.

V1 plan-change policy (configure in Stripe Portal / Billing):

- upgrade: immediate, Stripe proration
- downgrade: at period end when Portal is configured that way

LeadGuard does not calculate invoices.

## Webhooks

`POST /api/billing/stripe/webhook`

- raw body, max `BILLING_WEBHOOK_MAX_BYTES`
- `Stripe-Signature` verified before any processing
- `STRIPE_WEBHOOK_SECRET_PREVIOUS` is optional rotation grace
- `BillingProviderEvent.providerEventId` is unique (idempotent)
- out-of-order events are skipped when `eventCreatedAt < lastStripeEventAt`
- unknown Stripe Customer: log, do not create an Organization
- unknown Price ID: `NEEDS_REVIEW`, never grant Pro

Events used:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Non-2xx is returned if persistence failed so Stripe retries.

## Reconciliation

Scheduler job `reconcileBillingSubscriptions` (no extra worker):

- INTERNAL trials past `trialEnd` → `TRIAL_EXPIRED`
- `PAST_DUE` past `graceDeadlineAt` → `SUSPENDED`
- STRIPE/FAKE rows: retrieve authoritative subscription and repair the projection

OWNER may **Refresh billing status** (rate-limited).

## Payment failure

```text
ACTIVE → invoice failed → PAST_DUE → GRACE_PERIOD (BILLING_GRACE_DAYS)
       → SUSPENDED
```

LeadGuard does not reimplement Stripe Smart Retries. During grace, existing monitoring continues. After suspension monitoring is paused with:

```text
Monitoring suspended because subscription payment is overdue.
```

Users can still log in, open Billing and the Customer Portal. Data is never deleted for `PAST_DUE`, `CANCELED` or `SUSPENDED`. Recovery to `ACTIVE` restores resources without recreation.

`cancel_at_period_end` keeps access until `currentPeriodEnd`.

## Existing organizations

Migration `20260905120000_billing_plans_production_launch` inserts `INTERNAL` / `LEGACY` / `ACTIVE` subscriptions so Fase 1–17 organizations are not suspended. There is no automatic Stripe subscription create. Move them to paid plans later via Checkout.

## Organization deletion

There is no self-serve Organization delete in v1. If it is added later, an active Stripe subscription must be cancelled or transferred first.

## Tax / VAT / company details

Stripe Tax and merchant settings live in the Stripe Dashboard. LeadGuard does not implement a tax engine or duplicate billing addresses on Organization.

## Test vs live

- Production: `sk_live`, live prices, live webhook. `BILLING_PROVIDER=fake` fails fast.
- Development/E2E: fake provider, `price_fake_*`. No live Stripe in CI.

## Env

See `.env.example` (`STRIPE_*`, `BILLING_*`). Secrets stay server-side. A publishable key is not required for hosted Checkout.

## Logs

Structured events such as `billing.checkout.created`, `billing.webhook.received`, `billing.subscription.updated`. No card data, no API keys, no Stripe object dumps.
