import type { Locator, Page } from "playwright-core";
import type { FormFieldMapping } from "@/server/monitoring/form/types";

export async function scopedForm(
  page: Page,
  formSelector: string,
): Promise<Locator> {
  return page.locator(formSelector).first();
}

export async function locatorState(locator: Locator): Promise<{
  count: number;
  visible: boolean;
  enabled: boolean;
}> {
  const count = await locator.count();
  if (count === 0) {
    return { count: 0, visible: false, enabled: false };
  }
  const first = locator.first();
  const visible = await first.isVisible().catch(() => false);
  const enabled = visible ? await first.isEnabled().catch(() => false) : false;
  return { count, visible, enabled };
}

export async function discoverPageCounts(page: Page): Promise<{
  forms: number;
  inputs: number;
  buttons: number;
}> {
  return {
    forms: await page.locator("form").count(),
    inputs: await page.locator("input, select, textarea").count(),
    buttons: await page
      .locator('button, input[type="submit"], input[type="button"]')
      .count(),
  };
}

export async function findUnmappedRequiredFields(
  form: Locator,
  mappings: FormFieldMapping[],
): Promise<string[]> {
  const candidates = form.locator("input, select, textarea");
  const count = await candidates.count();
  const unmapped: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const field = candidates.nth(index);
    const meta = await field
      .evaluate((el) => {
        const node = el as HTMLInputElement;
        const type = (node.type || node.tagName).toLowerCase();
        const style = window.getComputedStyle(node);
        const hidden =
          type === "hidden" ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          node.getClientRects().length === 0;
        const required =
          node.required ||
          node.getAttribute("aria-required") === "true" ||
          node.getAttribute("aria-required") === "required";
        const identifier =
          node.getAttribute("name") ||
          node.id ||
          node.getAttribute("data-testid") ||
          type;
        return { type, hidden, required, identifier };
      })
      .catch(() => null);
    if (!meta || meta.hidden || !meta.required) continue;
    if (["submit", "button", "reset", "image", "file"].includes(meta.type)) {
      continue;
    }
    let mapped = false;
    for (const mapping of mappings) {
      const mappedLocator = form.locator(mapping.selector).first();
      const same = await field
        .evaluate(
          (el, other) => el === other,
          await mappedLocator.elementHandle(),
        )
        .catch(() => false);
      if (same) {
        mapped = true;
        break;
      }
    }
    if (!mapped) unmapped.push(meta.identifier.slice(0, 80));
  }
  return unmapped;
}

export async function readVisibleText(page: Page): Promise<string> {
  try {
    return await page.evaluate(() =>
      (document.body?.innerText ?? "").replace(/\s+/g, " ").trim(),
    );
  } catch {
    return "";
  }
}

export async function collectValidationMessages(
  form: Locator,
): Promise<Array<{ selector: string; message: string }>> {
  const invalid = form.locator(":invalid, [aria-invalid='true']");
  const count = await invalid.count();
  const errors: Array<{ selector: string; message: string }> = [];
  for (let index = 0; index < Math.min(count, 8); index += 1) {
    const field = invalid.nth(index);
    const item = await field
      .evaluate((el) => {
        const node = el as HTMLInputElement;
        const identifier =
          node.getAttribute("name") ||
          node.id ||
          node.getAttribute("data-testid") ||
          node.tagName.toLowerCase();
        const message =
          node.validationMessage ||
          node.getAttribute("aria-errormessage") ||
          "";
        return { identifier, message };
      })
      .catch(() => null);
    if (!item) continue;
    errors.push({
      selector: item.identifier.slice(0, 80),
      message: (item.message || "Invalid field").slice(0, 160),
    });
  }
  return errors;
}
