export default function Configurare() {
  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="text-2xl font-bold">DYASPlanning nu este configurat</h1>
      <p className="mt-3 text-slate-700">
        Lipsesc variabilele de mediu <code className="rounded bg-slate-200 px-1">NEXT_PUBLIC_SUPABASE_URL</code> și{" "}
        <code className="rounded bg-slate-200 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
      </p>
      <p className="mt-3 text-slate-700">
        Adaugă-le în Vercel → Project → Settings → Environment Variables (valorile sunt în Supabase → Project Settings → API), apoi
        redeploy. Pașii compleți sunt în fișierul README.md.
      </p>
    </main>
  );
}
