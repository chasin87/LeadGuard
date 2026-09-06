# Onboarding

Goal: get a new Organization to a first successful monitor check and an alert destination, without blocking on Google Ads, tracking or CRM.

## Steps

1. Add website
2. Create first monitor
3. Configure notifications
4. Run first check (real monitoring queue, no fake healthcheck)
5. Done

Google Ads, revenue attribution and outcome integrations are optional next steps after activation.

## Activation

An Organization is activated when:

```text
ACTIVE website exists
AND at least one Monitor exists
AND at least one notification channel exists
AND at least one MonitorCheck has status SUCCESS
```

State is derived from those records and upserted into `OrganizationOnboarding` so the checklist can be resumed after the user leaves. There is no session-only wizard state and no sample production analytics/leads.

## First login

The dashboard shows **Get LeadGuard protecting your leads** until activation (unless dismissed). The existing empty states (no websites / monitors / integrations / leads / analytics) keep concrete CTAs.

## Trial

New organizations created through the product receive the no-card Growth trial described in [Billing](BILLING.md).
