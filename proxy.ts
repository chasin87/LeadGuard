import { auth } from "@/auth";

export default auth((request) => {
  if (!request.auth) {
    const loginUrl = new URL("/login", request.nextUrl.origin);
    return Response.redirect(loginUrl);
  }
});

export const config = { matcher: ["/app/:path*", "/onboarding"] };
