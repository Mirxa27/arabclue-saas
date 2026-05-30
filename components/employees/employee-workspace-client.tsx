"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageShell } from "@/components/dashboard/page-shell";
import { Card, Badge, Field, Input } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useMerchant } from "@/hooks/use-merchant";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { getRole, formatPriceSAR } from "@/lib/employees/catalog";
import type {
  AIActionRow,
  AIConversationRow,
  AIEmployeeIntegrationRow,
  AIEmployeeRow,
  AITaskRow,
  EmployeeHeartbeat,
  IntegrationKind
} from "@/lib/employees/types";
import { useToast } from "@/components/ui/toast";
import { EmployeeBillingCheckout } from "@/components/billing/employee-billing-checkout";
import { OAuthConnectGrid } from "@/components/employees/oauth-connect-grid";
import {
  ArrowLeft,
  MessageSquare,
  ListTodo,
  Plug,
  Activity,
  Send,
  Loader2,
  CreditCard
} from "lucide-react";

type Tab = "chat" | "tasks" | "integrations" | "activity";

type EmployeeDetail = {
  employee: AIEmployeeRow;
  integrations: AIEmployeeIntegrationRow[];
  tasks: AITaskRow[];
  conversations: AIConversationRow[];
  heartbeat: EmployeeHeartbeat | null;
  actions: AIActionRow[];
};

type ChatMessage = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

const CHANNEL_CONNECT: Array<{ kind: IntegrationKind; label: string; fields: string[] }> = [
  { kind: "whatsapp", label: "WhatsApp", fields: ["phone_number_id", "access_token", "verify_token"] },
  { kind: "telegram", label: "Telegram", fields: ["bot_token"] },
  { kind: "slack", label: "Slack", fields: ["bot_token", "signing_secret", "default_channel"] },
  { kind: "email", label: "Email (SMTP)", fields: ["smtp_host", "smtp_user", "smtp_pass", "from_email"] }
];

export function EmployeeWorkspaceClient({ employeeId }: { employeeId: string }) {
  const { merchant } = useMerchant();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("chat");
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showBilling, setShowBilling] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<EmployeeDetail>(`/api/employees/${employeeId}`);
      setDetail(data);
      const dashConvo = data.conversations.find((c) => c.channel === "dashboard");
      if (dashConvo) {
        setConversationId(dashConvo.id);
        const msgRes = await apiFetch<{ messages: ChatMessage[] }>(
          `/api/employees/${employeeId}/chat?conversation_id=${dashConvo.id}`
        );
        setMessages(msgRes.messages);
      }
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Failed to load employee", "error");
    } finally {
      setLoading(false);
    }
  }, [employeeId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get("billing") === "complete") {
      setShowBilling(true);
      setTab("integrations");
    }
  }, [searchParams]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    if (!draft.trim() || sending) return;
    setSending(true);
    const text = draft.trim();
    setDraft("");
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "user", content: text, created_at: new Date().toISOString() }
    ]);
    try {
      const res = await apiFetch<{
        conversation_id: string;
        reply: string;
        message_id: string;
      }>(`/api/employees/${employeeId}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: text, conversation_id: conversationId ?? undefined })
      });
      setConversationId(res.conversation_id);
      setMessages((prev) => [
        ...prev,
        {
          id: res.message_id,
          role: "assistant",
          content: res.reply,
          created_at: new Date().toISOString()
        }
      ]);
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Message failed", "error");
    } finally {
      setSending(false);
    }
  }

  async function connectChannel(kind: IntegrationKind, creds: Record<string, string>) {
    try {
      await apiFetch(`/api/employees/${employeeId}/integrations`, {
        method: "POST",
        body: JSON.stringify({ kind, credentials: creds })
      });
      toast(`${kind} connected`, "success");
      load();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Connection failed", "error");
    }
  }

  const emp = detail?.employee;
  const role = emp ? getRole(emp.role_id) : undefined;
  const trialEnded =
    emp?.billing_status === "trial" && emp.trial_ends_at && new Date(emp.trial_ends_at) <= new Date();

  if (loading || !emp) {
    return (
      <PageShell title="Employee" merchant={merchant} loading={loading}>
        <p className="text-sm text-ink-mute">Loading workspace…</p>
      </PageShell>
    );
  }

  return (
    <PageShell title={emp.display_name} merchant={merchant}>
      <div className="space-y-6">
        <Link
          href="/employees"
          className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-ink-mute hover:text-ink"
        >
          <ArrowLeft size={12} /> My team
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="text-4xl">{emp.avatar ?? role?.emoji}</span>
            <div>
              <h1 className="font-display text-2xl md:text-3xl text-ink">{emp.display_name}</h1>
              <p className="text-sm text-ink-mute">{role?.name}</p>
              {emp.config?.persona_age != null && (
                <p className="mt-1 text-xs text-ink-mute">
                  {String(emp.config.persona_age)}y ·{" "}
                  {String(emp.config.persona_nationality ?? "")}
                  {emp.config.persona_city ? ` · ${String(emp.config.persona_city)}` : ""} ·{" "}
                  {String(emp.config.persona_dialect ?? "")}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone={emp.status === "active" ? "success" : "warn"}>{emp.status}</Badge>
                <Badge tone="default">{emp.billing_status}</Badge>
                <span className="text-xs font-mono text-ink-mute">
                  {formatPriceSAR(emp.monthly_charge_halalas)} SAR/mo
                </span>
              </div>
            </div>
          </div>
          {(trialEnded || showBilling) && emp.billing_status !== "active" && (
            <Button variant="primary" size="sm" onClick={() => setShowBilling(true)}>
              <CreditCard size={14} className="mr-1.5" />
              Activate billing
            </Button>
          )}
        </div>

        {showBilling && emp.billing_status !== "active" && (
          <Card>
            <h2 className="font-display text-lg text-ink mb-2">Subscribe to keep {emp.display_name} active</h2>
            <EmployeeBillingCheckout employeeId={employeeId} onPaid={() => load()} />
          </Card>
        )}

        <div className="flex flex-wrap gap-2 border-b border-rule/40 pb-2">
          {(
            [
              ["chat", MessageSquare, "Chat"],
              ["tasks", ListTodo, "Tasks"],
              ["integrations", Plug, "Integrations"],
              ["activity", Activity, "Activity"]
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                tab === id
                  ? "bg-accent/10 text-accent border border-accent/20"
                  : "text-ink-soft hover:bg-paper-deep/40"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {tab === "chat" && (
          <Card className="flex flex-col min-h-[420px]">
            <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 max-h-[360px] pr-2">
              {messages.length === 0 ? (
                <p className="text-sm text-ink-mute text-center py-8">
                  Say hello — {emp.display_name} is ready to work.
                </p>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                        m.role === "user"
                          ? "bg-accent text-paper"
                          : "bg-paper-deep/50 text-ink border border-rule/30"
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="mt-4 flex gap-2 border-t border-rule/30 pt-4">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder="Message your employee…"
                className="flex-1 rounded-xl border border-rule/40 bg-paper/60 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                disabled={sending || emp.status !== "active"}
              />
              <Button onClick={sendMessage} disabled={sending || !draft.trim()} variant="primary">
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </Button>
            </div>
          </Card>
        )}

        {tab === "tasks" && (
          <Card>
            <h2 className="font-display text-lg text-ink mb-4">Task queue</h2>
            {detail.tasks.length === 0 ? (
              <p className="text-sm text-ink-mute">No tasks yet.</p>
            ) : (
              <ul className="divide-y divide-rule/30">
                {detail.tasks.map((t) => (
                  <li key={t.id} className="py-3 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-ink">{t.title}</p>
                      {t.description && (
                        <p className="text-xs text-ink-mute mt-1">{t.description}</p>
                      )}
                    </div>
                    <Badge tone={t.status === "done" ? "success" : t.status === "blocked" ? "warn" : "default"}>
                      {t.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {tab === "integrations" && (
          <div className="space-y-5">
            <OAuthConnectGrid
              employeeId={employeeId}
              integrations={detail.integrations}
              onChange={() => load()}
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {CHANNEL_CONNECT.map((ch) => {
              const connected = detail.integrations.find((i) => i.kind === ch.kind);
              return (
                <IntegrationConnectCard
                  key={ch.kind}
                  label={ch.label}
                  kind={ch.kind}
                  connected={!!connected}
                  fields={ch.fields}
                  webhookUrl={
                    ch.kind === "whatsapp"
                      ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/employees/webhooks/whatsapp/${employeeId}`
                      : ch.kind === "telegram"
                        ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/employees/webhooks/telegram/${employeeId}`
                        : ch.kind === "slack"
                          ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/employees/webhooks/slack/${employeeId}`
                          : undefined
                  }
                  onConnect={(creds) => connectChannel(ch.kind, creds)}
                />
              );
            })}
            </div>
          </div>
        )}

        {tab === "activity" && (
          <Card>
            <h2 className="font-display text-lg text-ink mb-4">Recent actions</h2>
            {detail.heartbeat && (
              <p className="text-xs font-mono text-ink-mute mb-4">
                Last tick: {new Date(detail.heartbeat.last_tick_at).toLocaleString()} ·{" "}
                {detail.heartbeat.tasks_completed_24h} tasks / 24h
              </p>
            )}
            {detail.actions.length === 0 ? (
              <p className="text-sm text-ink-mute">No activity logged yet.</p>
            ) : (
              <ul className="space-y-2">
                {detail.actions.map((a) => (
                  <li
                    key={a.id}
                    className="text-xs font-mono text-ink-soft py-2 border-b border-rule/20 last:border-0"
                  >
                    <span className="text-ink-mute">{new Date(a.created_at).toLocaleString()}</span>
                    {" · "}
                    <span className="text-ink">{a.action}</span>
                    {a.channel && ` · ${a.channel}`}
                    <Badge tone={a.status === "success" ? "success" : "warn"} className="ml-2">
                      {a.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </PageShell>
  );
}

function IntegrationConnectCard({
  label,
  kind,
  connected,
  fields,
  webhookUrl,
  onConnect
}: {
  label: string;
  kind: IntegrationKind;
  connected: boolean;
  fields: string[];
  webhookUrl?: string;
  onConnect: (creds: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base text-ink">{label}</h3>
        <Badge tone={connected ? "success" : "default"}>{connected ? "Connected" : "Not connected"}</Badge>
      </div>
      {webhookUrl && (
        <p className="mt-2 text-[10px] font-mono text-ink-mute break-all">
          Webhook: {webhookUrl}
        </p>
      )}
      {!connected && (
        <>
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => setOpen(!open)}>
            {open ? "Cancel" : "Connect"}
          </Button>
          {open && (
            <div className="mt-3 space-y-3">
              {fields.map((f) => (
                <Field key={f} label={f.replace(/_/g, " ")}>
                  <Input
                    type={f.includes("pass") || f.includes("token") ? "password" : "text"}
                    value={values[f] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
                  />
                </Field>
              ))}
              <Button
                size="sm"
                variant="primary"
                onClick={() => onConnect(values)}
                disabled={fields.some((f) => !values[f]?.trim())}
              >
                Save & connect
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
