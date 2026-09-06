"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function BillingConfirmPoller({ confirmed }: { confirmed: boolean }) {
  const router = useRouter();
  const attempts = useRef(0);
  useEffect(() => {
    if (confirmed) return;
    const timer = setInterval(() => {
      attempts.current += 1;
      if (attempts.current > 20) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, 1500);
    return () => clearInterval(timer);
  }, [confirmed, router]);
  return null;
}
