"use client";
import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ProjectExtras } from "@/components/ProjectExtras";
import { ErrorBox, Loading, PageHeader } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useQuery, must } from "@/lib/useQuery";
import { supabase } from "@/lib/supabase/client";

/** Lucrări extra la o lucrare — deschisă de oricine lucrează acolo (angajat, șef, administrator). */
export default function ExtraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { isAdmin } = useSession();
  const q = useQuery(async () => must(await supabase().from("projects").select("id, name, city").eq("id", id).maybeSingle()) as { id: string; name: string; city: string | null } | null, [id]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={isAdmin ? `/lucrari/${id}` : "/astazi"} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600"><ArrowLeft className="h-4 w-4" />Înapoi</Link>
      {q.loading && !q.data && <Loading />}
      {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
      {q.data === null && !q.loading && <ErrorBox message="Lucrarea nu există sau nu ai acces la ea." />}
      {q.data && <>
        <PageHeader title="Lucrări extra" subtitle={`${q.data.name}${q.data.city ? ` · ${q.data.city}` : ""}`} />
        <ProjectExtras projectId={id} />
      </>}
    </div>
  );
}
