/** Never carry OAuth credentials into a post-login destination. */
export function loginDestination(value: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(value)
  )
    return "/dashboard";
  const url = new URL(value, "https://workspace.invalid");
  if (
    url.pathname.startsWith("/login") ||
    url.pathname.startsWith("/api/auth") ||
    url.searchParams.has("code") ||
    url.searchParams.has("error")
  )
    return "/dashboard";
  return value;
}
/** Recover Site URL fallbacks; the API still requires the signed PKCE cookie. */
export function recoveredOAuthCallback(url: URL): string | null {
  if (url.pathname !== "/" && url.pathname !== "/login") return null;
  let source = url;
  if (!source.searchParams.has("code") && url.pathname === "/login") {
    const from = url.searchParams.get("from");
    if (
      !from ||
      !from.startsWith("/") ||
      from.startsWith("//") ||
      /[\\\u0000-\u0020\u007f]/.test(from)
    )
      return null;
    source = new URL(from, url.origin);
    if (source.pathname !== "/") return null;
  }
  const code = source.searchParams.get("code");
  if (!code) return null;
  const callback = new URL("/api/auth/supabase/callback", url.origin);
  callback.searchParams.set("code", code);
  const state = source.searchParams.get("state");
  if (state) callback.searchParams.set("state", state);
  return callback.pathname + callback.search;
}
