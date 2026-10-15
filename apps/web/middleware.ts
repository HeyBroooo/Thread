import { loginDestination, recoveredOAuthCallback } from "./lib/auth-redirect";
import { NextRequest, NextResponse } from "next/server";
const apiOrigin = (
  process.env.API_PROXY_TARGET ??
  process.env.API_URL ??
  "http://localhost:8787"
).replace(/\/$/, "");
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const callback = recoveredOAuthCallback(request.nextUrl);
  if (callback) return NextResponse.redirect(new URL(callback, request.url));
  if (path === "/") return NextResponse.next();
  if (path === "/repositories/demo" || path.startsWith("/repositories/demo/"))
    return NextResponse.next();
  let authenticated = false;
  try {
    const response = await fetch(`${apiOrigin}/api/auth/session`, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok)
      authenticated = (await response.json()).authenticated === true;
  } catch {
    /* Access stays closed when the session service is unavailable. */
  }
  if (path === "/login")
    return authenticated
      ? NextResponse.redirect(
          new URL(
            loginDestination(request.nextUrl.searchParams.get("from")),
            request.url,
          ),
        )
      : NextResponse.next();
  if (authenticated) {
    const result = NextResponse.next();
    result.headers.set("Cache-Control", "private, no-store");
    return result;
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("from", path + request.nextUrl.search);
  return NextResponse.redirect(login);
}
export const config = {
  matcher: ["/", "/dashboard/:path*", "/repositories/:path*", "/login"],
};
