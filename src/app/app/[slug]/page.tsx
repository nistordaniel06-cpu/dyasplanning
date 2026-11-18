"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { setBrand, type Brand } from "@/lib/brand";
import { Loading } from "@/components/ui";

/** Linkul aplicației unei firme: salvează numele și culorile, apoi deschide autentificarea. */
export default function AppLinkPage() {
  const { slug } = useParams<{ slug: string }>();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase().rpc("app_brand", { p_slug: slug });
      const b = data as Brand | null;
      if (!b) { setMissing(true); return; }
      setBrand(b);
      const { data: s } = await supabase().auth.getSession();
      window.location.replace(s.session ? "/" : "/login");
    })();
  }, [slug]);
  if (missing) return (
    <main className="flex min-h-dvh items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-xl font-bold">Linkul aplicației nu există</h1>
        <p className="mt-2 text-slate-600">Verifică linkul primit sau cere unul nou administratorului.</p>
        <a href="/login" className="mt-4 inline-block font-semibold text-orange-700 underline">Mergi la autentificare</a>
      </div>
    </main>
  );
  return <Loading />;
}
