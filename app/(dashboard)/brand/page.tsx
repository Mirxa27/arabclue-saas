"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/dashboard/page-shell";
import { Card, CardHeader, CardSubtitle, CardTitle, Field, Input, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { getBrowserSupabase } from "@/lib/db/supabase-browser";
import { useMerchant } from "@/hooks/use-merchant";
import type { BrandKit } from "@/lib/types/database";
import {
  Palette,
  MessageSquareText,
  BookOpen,
  Tag,
  Ban,
  Save,
  Sparkles,
} from "lucide-react";

const empty: BrandKit = {
  brand_name: "",
  essence: "",
  attributes: [],
  favor_words: [],
  avoid_words: [],
  dialect: "khaliji",
};

export default function BrandPage() {
  const { merchant, error: merchantError } = useMerchant();
  const { toast } = useToast();
  const [kit, setKit] = useState<BrandKit>(empty);
  const [kitLoading, setKitLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (merchantError) toast(merchantError, "error");
  }, [merchantError, toast]);

  useEffect(() => {
    if (!merchant) {
      setKitLoading(false);
      return;
    }
    (async () => {
      setKitLoading(true);
      try {
        const sb = getBrowserSupabase();
        const { data, error } = await sb
          .from("brand_kits")
          .select("*")
          .eq("merchant_id", merchant.id)
          .maybeSingle();
        if (error) throw error;
        if (data) setKit({ ...empty, ...data });
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to load brand kit", "error");
      } finally {
        setKitLoading(false);
      }
    })();
  }, [merchant, toast]);

  async function save() {
    setSaving(true);
    try {
      await apiFetch("/api/brand-kit", {
        method: "POST",
        body: JSON.stringify(kit),
      });
      toast("Brand kit saved", "success");
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function generateVoice() {
    setGenerating(true);
    try {
      const json = await apiFetch<{ kit?: BrandKit }>("/api/brand-kit/generate", {
        method: "POST",
        body: JSON.stringify({ brand_name: kit.brand_name }),
      });
      if (json?.kit) {
        setKit({ ...kit, ...json.kit });
        toast("Voice profile generated from brand name", "success");
      }
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Generation failed", "error");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <PageShell title="Brand Kit" merchant={merchant}>
      {kitLoading ? (
        <div className="p-8 text-sm text-ink-mute text-center">Loading brand kit…</div>
      ) : (
        <div className="space-y-6 max-w-3xl">
          {/* Header card */}
          <Card>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
                  <Palette size={22} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-ink">Brand Voice Profile</h2>
                  <p className="text-xs text-ink-mute mt-0.5">
                    Define how the AI agent writes copy, replies to DMs, and chooses post subjects.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={generateVoice}
                  disabled={generating || !kit.brand_name.trim()}
                >
                  <Sparkles size={14} />
                  {generating ? "Generating…" : "Auto-Generate"}
                </Button>
                <Button onClick={save} disabled={saving}>
                  <Save size={14} />
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </Card>

          {/* Form cards */}
          <div className="grid gap-6">
            {/* Brand Identity */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
                    <MessageSquareText size={16} />
                  </div>
                  <div>
                    <CardTitle>Identity</CardTitle>
                    <CardSubtitle>Core brand information that shapes your voice.</CardSubtitle>
                  </div>
                </div>
              </CardHeader>

              <div className="space-y-5">
                <Field label="Brand name">
                  <Input
                    value={kit.brand_name}
                    onChange={(e) => setKit({ ...kit, brand_name: e.target.value })}
                    placeholder="e.g., Bayt Al-Oud"
                  />
                </Field>

                <Field label="Essence" hint="One line describing what you sell and to whom.">
                  <Textarea
                    rows={2}
                    value={kit.essence ?? ""}
                    onChange={(e) => setKit({ ...kit, essence: e.target.value })}
                    placeholder="Premium oud and bakhoor for Saudi households who appreciate tradition."
                  />
                </Field>

                <Field label="Dialect">
                  <select
                    className="w-full h-10 px-4 rounded-xl bg-paper-deep/20 border border-rule/40 text-sm text-ink focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/10 transition-all"
                    value={kit.dialect}
                    onChange={(e) => setKit({ ...kit, dialect: e.target.value as BrandKit["dialect"] })}
                  >
                    <option value="khaliji">Khaliji (Saudi Arabic)</option>
                    <option value="msa">MSA (Fusha)</option>
                    <option value="english">English</option>
                  </select>
                </Field>
              </div>
            </Card>

            {/* Voice Attributes */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-accent-warm/10 border border-accent-warm/20 flex items-center justify-center text-accent-warm">
                    <Tag size={16} />
                  </div>
                  <div>
                    <CardTitle>Voice Attributes</CardTitle>
                    <CardSubtitle>Traits that define how your brand sounds.</CardSubtitle>
                  </div>
                </div>
              </CardHeader>

              <div className="space-y-5">
                <Field label="Voice attributes" hint="3–7 traits, comma-separated (e.g., confident, warm, rooted-in-tradition)">
                  <Input
                    value={kit.attributes.join(", ")}
                    onChange={(e) =>
                      setKit({
                        ...kit,
                        attributes: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="confident, warm, rooted-in-tradition"
                  />
                </Field>
                {kit.attributes.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {kit.attributes.map((attr, i) => (
                      <span
                        key={i}
                        className="px-3 py-1.5 rounded-full text-xs font-medium bg-accent-warm/15 text-accent-warm-deep border border-accent-warm/25"
                      >
                        {attr}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            {/* Lexicon */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
                    <BookOpen size={16} />
                  </div>
                  <div>
                    <CardTitle>Lexicon</CardTitle>
                    <CardSubtitle>Words to favor and avoid in copywriting.</CardSubtitle>
                  </div>
                </div>
              </CardHeader>

              <div className="space-y-5">
                <Field label="Favor words" hint="Words your brand uses (comma-separated)">
                  <Input
                    value={kit.favor_words.join(", ")}
                    onChange={(e) =>
                      setKit({
                        ...kit,
                        favor_words: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="أصالة, تراث, فخامة, عود, جودة"
                  />
                </Field>
                {kit.favor_words.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {kit.favor_words.map((w, i) => (
                      <span
                        key={i}
                        className="px-3 py-1.5 rounded-full text-xs font-medium bg-accent/10 text-accent-deep border border-accent/20"
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                )}

                <Field label="Avoid words" hint="Words off-brand or off-limits (comma-separated)">
                  <Input
                    value={kit.avoid_words.join(", ")}
                    onChange={(e) =>
                      setKit({
                        ...kit,
                        avoid_words: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="رخيص, تقليد, سيء"
                  />
                </Field>
                {kit.avoid_words.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {kit.avoid_words.map((w, i) => (
                      <span
                        key={i}
                        className="px-3 py-1.5 rounded-full text-xs font-medium bg-danger/10 text-danger border border-danger/20"
                      >
                        <Ban size={11} className="inline mr-1" />
                        {w}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Save bar (sticky on mobile) */}
          <div className="fixed bottom-0 left-0 right-0 lg:left-64 p-4 bg-paper/90 backdrop-blur-xl border-t border-rule/40 lg:static lg:bg-transparent lg:backdrop-blur-none lg:border-0 lg:p-0 z-30">
            <div className="flex items-center justify-end gap-3">
              <Button variant="outline" size="sm" onClick={generateVoice} disabled={generating || !kit.brand_name.trim()}>
                <Sparkles size={14} />
                {generating ? "Generating…" : "Auto-Generate"}
              </Button>
              <Button onClick={save} disabled={saving}>
                <Save size={14} />
                {saving ? "Saving…" : "Save Brand Kit"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}