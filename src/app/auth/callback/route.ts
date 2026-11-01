import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { resolveOAuthCallbackLocation } from "@/lib/auth-callback";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");

  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocalEnv = process.env.NODE_ENV === "development";
  const origin = isLocalEnv ? url.origin : forwardedHost ? `https://${forwardedHost}` : url.origin;

  if (code) {
    const cookieStore = await cookies();
    const response = NextResponse.redirect(new URL("/", origin));

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    const target = await resolveOAuthCallbackLocation(
      code,
      next,
      origin,
      async (authCode) => {
        if (!supabaseUrl || !supabaseKey) return false;

        const supabase = createServerClient(supabaseUrl, supabaseKey, {
          cookies: {
            getAll: () => cookieStore.getAll(),
            setAll(cookiesToSet) {
              for (const { name, value, options } of cookiesToSet) {
                cookieStore.set(name, value, options);
                response.cookies.set(name, value, options);
              }
            },
          },
        });

        const { error } = await supabase.auth.exchangeCodeForSession(authCode);
        return !error;
      },
    );

    if (!target.authenticated) {
      return NextResponse.redirect(target.location);
    }

    response.headers.set("location", target.location.toString());
    return response;
  }

  return NextResponse.redirect(new URL("/login?error=auth", origin));
}
