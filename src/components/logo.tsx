import Link from "next/link";

export function Logo() {
  return (
    <Link className="inline-flex items-center gap-2 text-lg font-bold tracking-tight" href="/">
      <span className="grid size-8 place-items-center rounded-lg bg-[#235347] text-sm text-white" aria-hidden="true">L</span>
      LeadGuard
    </Link>
  );
}
