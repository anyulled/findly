import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    if (process.env.NODE_ENV === "production" && request.nextUrl.pathname !== "/login" && !request.nextUrl.pathname.startsWith("/auth/")) {
      return NextResponse.redirect(new URL("/login?error=setup", request.url));
    }
    return NextResponse.next({ request });
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value);
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;
  const loginOrCallback = request.nextUrl.pathname === "/login" || request.nextUrl.pathname.startsWith("/auth/");
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const claimEmail = typeof claims?.email === "string" ? claims.email.toLowerCase() : null;
  const isOwner = Boolean(claims && ownerEmail && claimEmail === ownerEmail);
  if (!loginOrCallback && !isOwner) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    if (claims && !isOwner) loginUrl.searchParams.set("error", "owner");
    return NextResponse.redirect(loginUrl);
  }
  if (request.nextUrl.pathname === "/login" && isOwner) return NextResponse.redirect(new URL("/", request.url));
  return response;
}
