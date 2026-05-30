"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import type { TestableService } from "@/lib/admin/types";

const SERVICE_LABELS: Record<TestableService, string> = {
  supabase: "Supabase",
  openai: "OpenAI",
  anthropic: "Anthropic",
  salla: "Salla",
  meta: "Meta",
  linkedin: "LinkedIn",
  x: "X",
  tiktok: "TikTok",
  moyasar: "Moyasar",
  wathq: "Wathq",
  zatca: "ZATCA",
  cron: "Social cron",
  oauth: "OAuth state",
  social_engager: "Engager AI"
};

type Props = {
  service: TestableService;
  variant?: "ghost" | "primary";
};

export function ConnectionTestButton({ service, variant = "ghost" }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [lastOk, setLastOk] = useState<boolean | null>(null);

  async function runTest() {
    setLoading(true);
    try {
      const res = await apiFetch<{ ok: boolean; message: string; latencyMs?: number }>("/api/admin/test", {
        method: "POST",
        body: JSON.stringify({ service })
      });
      setLastOk(res.ok);
      const suffix = res.latencyMs != null ? ` (${res.latencyMs}ms)` : "";
      toast(`${SERVICE_LABELS[service]}: ${res.message}${suffix}`, res.ok ? "success" : "error");
      window.dispatchEvent(new CustomEvent("arabclue:connection-test"));
    } catch (err) {
      setLastOk(false);
      toast(err instanceof ApiClientError ? err.message : "Test failed", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {lastOk != null && (
        <Badge tone={lastOk ? "success" : "danger"}>{lastOk ? "OK" : "Fail"}</Badge>
      )}
      <Button type="button" variant={variant} onClick={runTest} disabled={loading}>
        {loading ? "Testing…" : "Test"}
      </Button>
    </div>
  );
}

export function TestAllConnectionsButton() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  async function runAll() {
    setLoading(true);
    try {
      const res = await apiFetch<{ ok: boolean; passed: number; total: number }>("/api/admin/test", {
        method: "POST",
        body: JSON.stringify({ all: true })
      });
      toast(`Connection tests: ${res.passed}/${res.total} passed`, res.ok ? "success" : "error");
      window.dispatchEvent(new CustomEvent("arabclue:connection-test"));
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Tests failed", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button type="button" onClick={runAll} disabled={loading}>
      {loading ? "Running all tests…" : "Test all connections"}
    </Button>
  );
}
