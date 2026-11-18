import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL, isConfigured } from "@/lib/supabase/env";

const PUBLIC_PATHS = ["/login", "/configurare", "/firma-noua-5lo4x0", "/api/push", "/api/presence", "/api/owner-email", "/api/geocode", "/app/", "/api/manifest", "/api/icon"];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!isConfigured) {
    if (path === "/configurare") return NextResponse.next();
    return NextResponse.redirect(new URL("/configurare", request.url));
  }

  let response = NextResponse.next({ request });
  const sb = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Verifică sesiunea pe server (token validat de Supabase Auth).
  const { data } = await sb.auth.getUser();
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));
  if (!data.user && !isPublic) {
    const url = new URL("/login", request.url);
    if (path !== "/") url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  if (data.user && path === "/login") return NextResponse.redirect(new URL("/", request.url));
  // Pagina principală pentru vizitatori = autentificarea
  if (!data.user && path === "/") return NextResponse.redirect(new URL("/login", request.url));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|sw.js|manifest.webmanifest|.*\\.(?:png|jpg|svg|ico|js|json)$).*)"],
};
