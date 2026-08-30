const maxSelectorLength = 300;
const maxElementNameLength = 80;

export function validateCssSelector(
  selector: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const value = selector.trim();
  if (!value) {
    return { ok: true, value: "" };
  }
  if (value.length > maxSelectorLength) {
    return {
      ok: false,
      message: `Selector may be at most ${maxSelectorLength} characters.`,
    };
  }
  if (/[<>]|javascript\s*:/i.test(value)) {
    return { ok: false, message: "Enter a valid CSS selector." };
  }
  if (/^(text|xpath|role|pierce|internal)\s*=/i.test(value)) {
    return {
      ok: false,
      message:
        "Use a CSS selector. Playwright locator engines are not allowed.",
    };
  }
  if (/\?{2,}/.test(value) || value === "?") {
    return { ok: false, message: "Enter a valid CSS selector." };
  }
  if (!isBalanced(value, "[", "]") || !isBalanced(value, "(", ")")) {
    return { ok: false, message: "Enter a valid CSS selector." };
  }
  if (/[\[(=:]\s*$/.test(value) || value.endsWith("\\")) {
    return { ok: false, message: "Enter a valid CSS selector." };
  }
  if (/^[a-zA-Z][\w-]*\s*=/.test(value) && !value.includes("[")) {
    return {
      ok: false,
      message:
        'Attribute selectors need brackets, for example [data-slot="button"].',
    };
  }
  return { ok: true, value };
}

export function validateRequiredElementName(
  name: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  const value = name.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > maxElementNameLength) {
    return {
      ok: false,
      message: `Element name may be at most ${maxElementNameLength} characters.`,
    };
  }
  return { ok: true, value };
}

function isBalanced(value: string, open: string, close: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}
