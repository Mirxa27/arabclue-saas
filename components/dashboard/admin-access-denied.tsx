"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/toast";

export function AdminAccessDenied() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (searchParams.get("admin") !== "denied") return;
    toast("You do not have platform admin access.", "error");
    router.replace("/dashboard", { scroll: false });
  }, [searchParams, router, toast]);

  return null;
}
