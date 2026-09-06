"use client";

import { signOut } from "next-auth/react";

export function LogoutButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      className={className}
      type="button"
      onClick={() => {
        void signOut({ redirectTo: "/login" });
      }}
    >
      {children}
    </button>
  );
}
