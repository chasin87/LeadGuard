import type { Locator, Page } from "playwright-core";

const paymentSelectors = [
  'input[autocomplete="cc-number"]',
  'input[autocomplete="cc-csc"]',
  'input[autocomplete="cc-exp"]',
  'input[autocomplete="cc-exp-month"]',
  'input[autocomplete="cc-exp-year"]',
  'input[name*="cardnumber" i]',
  'input[name*="card-number" i]',
  'input[name*="cvc" i]',
  'input[id*="card-element" i]',
  'iframe[src*="stripe.com"]',
  'iframe[src*="paypal.com"]',
  'iframe[name*="__privateStripe"]',
];

export async function formContainsPassword(
  scope: Locator | Page,
): Promise<boolean> {
  return (await scope.locator('input[type="password"]').count()) > 0;
}

export async function formContainsPaymentFields(
  scope: Locator | Page,
): Promise<boolean> {
  for (const selector of paymentSelectors) {
    if ((await scope.locator(selector).count()) > 0) return true;
  }
  return false;
}

export async function formContainsRequiredFileInput(
  scope: Locator | Page,
): Promise<boolean> {
  const files = scope.locator('input[type="file"]');
  const count = await files.count();
  for (let index = 0; index < count; index += 1) {
    const input = files.nth(index);
    const required = await input.evaluate((el) => {
      const node = el as HTMLInputElement;
      return (
        node.required ||
        node.getAttribute("aria-required") === "true" ||
        node.getAttribute("aria-required") === "required"
      );
    });
    if (required) return true;
  }
  return false;
}
