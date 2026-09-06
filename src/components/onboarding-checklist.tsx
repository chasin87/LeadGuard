import Link from "next/link";
import type { OrganizationOnboardingState } from "@/server/billing/onboarding";

const steps = [
  {
    key: "website" as const,
    title: "Add website",
    description: "Tell LeadGuard which site should be protected.",
    href: (slug: string) => `/app/${slug}/websites/new`,
    cta: "Add website",
  },
  {
    key: "monitor" as const,
    title: "Create first monitor",
    description: "Watch a landing page so broken forms and outages are caught.",
    href: (slug: string) => `/app/${slug}/websites`,
    cta: "Open websites",
  },
  {
    key: "notification" as const,
    title: "Configure notifications",
    description: "Send alerts when a monitor fails.",
    href: (slug: string) => `/app/${slug}/settings/notifications`,
    cta: "Add alert destination",
  },
  {
    key: "firstCheck" as const,
    title: "Run first check",
    description: "Queue a real monitor check. LeadGuard does not fake health.",
    href: (slug: string) => `/app/${slug}/websites`,
    cta: "Open monitors",
  },
];

export function OnboardingChecklist({
  organizationSlug,
  state,
}: {
  organizationSlug: string;
  state: OrganizationOnboardingState;
}) {
  if (state.dismissedAt || state.activated) return null;
  return (
    <section
      className="mt-8 rounded-2xl border border-[var(--border)] bg-white p-8"
      data-testid="onboarding-checklist"
    >
      <h2 className="text-xl font-bold">Get LeadGuard protecting your leads</h2>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        Finish the core setup. Google Ads, tracking and CRM outcomes can wait.
      </p>
      <ol className="mt-6 space-y-4">
        {steps.map((step, index) => {
          const done =
            (step.key === "website" && state.websiteCompletedAt) ||
            (step.key === "monitor" && state.monitorCompletedAt) ||
            (step.key === "notification" && state.notificationCompletedAt) ||
            (step.key === "firstCheck" && state.firstCheckCompletedAt);
          const current = state.nextStep === step.key;
          return (
            <li
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-4"
              key={step.key}
            >
              <div>
                <p className="font-semibold">
                  {index + 1}. {step.title}
                  {done ? " — done" : current ? " — next" : ""}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {step.description}
                </p>
              </div>
              {!done && current ? (
                <Link
                  className="rounded-xl bg-[#19d0a2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#193f36]"
                  href={step.href(organizationSlug)}
                >
                  {step.cta}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
