"use client";
import { RequireRole } from "@/components/shell";
import { PageHeader } from "@/components/ui";
import { UsageReport, type Usage } from "@/components/UsageReport";
import { supabase } from "@/lib/supabase/client";

export default function UtilizarePage() {
  return (
    <RequireRole roles={["admin"]}>
      <PageHeader title="Utilizare aplicație" subtitle="Cine din echipă folosește aplicația, cine nu mai intră și cine nu primește notificări." />
      <UsageReport load={async (days) => {
        const { data, error } = await supabase().rpc("company_app_usage", { p_days: days });
        if (error) throw error;
        return data as Usage;
      }} />
    </RequireRole>
  );
}
