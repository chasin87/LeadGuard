"use client";

import { useFormStatus } from "react-dom";

export function FormSubmit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <button className="w-full rounded-xl bg-[#235347] px-5 py-3 font-semibold text-white hover:bg-[#193f36] disabled:cursor-wait disabled:opacity-60" disabled={pending} type="submit">{pending ? "Even geduld…" : children}</button>;
}
