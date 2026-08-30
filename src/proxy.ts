import NextAuth from "next-auth";
import { authConfig } from "@/server/auth/config";

const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  matcher: ["/app/:path*", "/onboarding", "/login", "/register"],
};
