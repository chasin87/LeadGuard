"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function ReceiptStatusPoller({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      router.refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
