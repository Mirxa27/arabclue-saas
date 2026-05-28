"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/dashboard/page-shell";
import { Badge, Card, CardHeader, CardSubtitle, CardTitle, Empty, Field, Input } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { getBrowserSupabase } from "@/lib/db/supabase-browser";
import { useMerchant } from "@/hooks/use-merchant";
import type { SallaProduct, SeoContent } from "@/lib/types/database";
import { Search, Sparkles } from "lucide-react";

export default function SeoPage() {
  const { merchant, loading, error: merchantError } = useMerchant();
  const { toast } = useToast();
  const [products, setProducts] = useState<SallaProduct[]>([]);
  const [content, setContent] = useState<SeoContent[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [blog, setBlog] = useState({ topic: "", primaryKeyword: "" });

  useEffect(() => {
    if (merchantError) toast(merchantError, "error");
  }, [merchantError, toast]);

  useEffect(() => {
    if (!merchant) {
      setDataLoading(false);
      return;
    }
    (async () => {
      setDataLoading(true);
      try {
        const sb = getBrowserSupabase();
        const [{ data: p, error: pErr }, { data: c, error: cErr }] = await Promise.all([
          sb.from("salla_products").select("salla_product_id, name, category, merchant_id, id").eq("merchant_id", merchant.id).limit(50),
          sb.from("seo_content").select("*").eq("merchant_id", merchant.id).order("created_at", { ascending: false }).limit(20)
        ]);
        if (pErr) throw pErr;
        if (cErr) throw cErr;
        setProducts((p ?? []) as SallaProduct[]);
        setContent((c ?? []) as SeoContent[]);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to load SEO data", "error");
      } finally {
        setDataLoading(false);
      }
    })();
  }, [merchant, toast]);

  async function genProduct(productId: string) {
    setBusy(true);
    try {
      await apiFetch("/api/seo/generate", {
        method: "POST",
        body: JSON.stringify({ kind: "product", productId })
      });
      toast("Product copy generated", "success");
      window.location.reload();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Generation failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function genBlog() {
    if (!blog.topic || !blog.primaryKeyword) {
      toast("Topic and primary keyword are required", "error");
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/seo/generate", {
        method: "POST",
        body: JSON.stringify({ kind: "blog", ...blog })
      });
      toast("Blog article generated", "success");
      window.location.reload();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Generation failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title="Arabic SEO" merchant={merchant} loading={loading || dataLoading}>
      <div className="p-8 space-y-6 overflow-y-auto">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Native Arabic blog post</CardTitle>
              <CardSubtitle>Original Arabic content tuned to rank in Google KSA — never machine-translated.</CardSubtitle>
            </div>
            <Search size={18} className="text-ink-mute" />
          </CardHeader>
          <div className="grid md:grid-cols-2 gap-5">
            <Field label="Topic">
              <Input value={blog.topic} onChange={(e) => setBlog({ ...blog, topic: e.target.value })} placeholder="دليل فاتورة زاتكا للمتاجر الصغيرة" />
            </Field>
            <Field label="Primary keyword">
              <Input value={blog.primaryKeyword} onChange={(e) => setBlog({ ...blog, primaryKeyword: e.target.value })} placeholder="فاتورة زاتكا" />
            </Field>
          </div>
          <div className="mt-4">
            <Button onClick={genBlog} disabled={busy}>
              <Sparkles size={14} /> {busy ? "Writing…" : "Generate article"}
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Product copy</CardTitle>
              <CardSubtitle>Generate SEO title, meta, and description for any product.</CardSubtitle>
            </div>
          </CardHeader>
          {products.length === 0 ? (
            <Empty title="No products synced" hint="Connect Salla and sync your catalog from Integrations first." />
          ) : (
            <ul className="divide-y divide-rule">
              {products.map((p) => (
                <li key={p.salla_product_id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.name}</p>
                    <p className="text-xs text-ink-mute font-mono">{p.category}</p>
                  </div>
                  <Button variant="ghost" onClick={() => genProduct(p.salla_product_id)} disabled={busy}>
                    Generate
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Generated content</CardTitle>
              <CardSubtitle>Your SEO library.</CardSubtitle>
            </div>
          </CardHeader>
          {content.length === 0 ? (
            <Empty title="Nothing generated yet" hint="Create a blog post or product copy above." />
          ) : (
            <ul className="divide-y divide-rule">
              {content.map((c) => (
                <li key={c.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{c.payload?.title ?? c.ref_id}</p>
                    <p className="text-xs text-ink-mute">{c.payload?.metaDescription?.slice(0, 90) ?? ""}</p>
                  </div>
                  <Badge tone={c.kind === "blog" ? "success" : "default"}>{c.kind}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
