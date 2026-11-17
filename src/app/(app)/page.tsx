"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { homeFor } from "@/components/shell";
import { Loading } from "@/components/ui";

export default function Home() {
  const s = useSession();
  const router = useRouter();
  useEffect(() => {
    if (s.ownerOnly) router.replace("/proprietar");
    else if (s.membership) router.replace(homeFor(s.role));
  }, [s.membership, s.role, s.ownerOnly, router]);
  return <Loading />;
}
