"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/dashboard/page-shell";
import { Card, CardHeader, CardSubtitle, CardTitle, Field, Input } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useMerchant } from "@/hooks/use-merchant";
import type { SellerAddress } from "@/lib/types/database";

type TaxSettings = {
  seller_name: string;
  vat_number: string;
  cr_number: string;
  seller_address: SellerAddress;
};

const emptyTax: TaxSettings = {
  seller_name: "",
  vat_number: "",
  cr_number: "",
  seller_address: { street: "", building: "", city: "", postalCode: "" }
};

export default function SettingsPage() {
  const { merchant, loading, error: merchantError } = useMerchant();
  const { toast } = useToast();
  const [tax, setTax] = useState<TaxSettings>(emptyTax);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (merchantError) toast(merchantError, "error");
  }, [merchantError, toast]);

  useEffect(() => {
    if (!merchant) return;
    setTax({
      seller_name: merchant.seller_name ?? "",
      vat_number: merchant.vat_number ?? "",
      cr_number: merchant.cr_number ?? "",
      seller_address: merchant.seller_address ?? emptyTax.seller_address
    });
  }, [merchant]);

  async function save() {
    setSaving(true);
    try {
      await apiFetch("/api/merchant/tax", {
        method: "POST",
        body: JSON.stringify(tax)
      });
      toast("Tax settings saved", "success");
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function exportData() {
    setExporting(true);
    try {
      const res = await fetch("/api/merchant/export");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `arabclue-export-${merchant?.id?.slice(0, 8) ?? "data"}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Export downloaded", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Export failed", "error");
    } finally {
      setExporting(false);
    }
  }

  async function disconnectSalla() {
    if (!confirm("Disconnect Salla? OAuth tokens will be removed from arabclue.")) return;
    setDisconnecting(true);
    try {
      await apiFetch("/api/merchant/disconnect-salla", { method: "POST" });
      toast("Salla disconnected", "success");
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Disconnect failed", "error");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <PageShell title="Settings" merchant={merchant} loading={loading}>
      <div className="p-8 max-w-3xl space-y-6 overflow-y-auto">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>ZATCA tax details</CardTitle>
              <CardSubtitle>Required for issuing compliant invoices. We never display these publicly.</CardSubtitle>
            </div>
          </CardHeader>
          <div className="space-y-5">
            <Field label="Seller legal name">
              <Input value={tax.seller_name} onChange={(e) => setTax({ ...tax, seller_name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="VAT number (15 digits)">
                <Input value={tax.vat_number} maxLength={15} onChange={(e) => setTax({ ...tax, vat_number: e.target.value })} />
              </Field>
              <Field label="CR number (10 digits)">
                <Input value={tax.cr_number} maxLength={10} onChange={(e) => setTax({ ...tax, cr_number: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Street">
                <Input value={tax.seller_address.street} onChange={(e) => setTax({ ...tax, seller_address: { ...tax.seller_address, street: e.target.value } })} />
              </Field>
              <Field label="Building no.">
                <Input value={tax.seller_address.building} onChange={(e) => setTax({ ...tax, seller_address: { ...tax.seller_address, building: e.target.value } })} />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="City">
                <Input value={tax.seller_address.city} onChange={(e) => setTax({ ...tax, seller_address: { ...tax.seller_address, city: e.target.value } })} />
              </Field>
              <Field label="District">
                <Input value={tax.seller_address.district ?? ""} onChange={(e) => setTax({ ...tax, seller_address: { ...tax.seller_address, district: e.target.value } })} />
              </Field>
              <Field label="Postal code">
                <Input value={tax.seller_address.postalCode} maxLength={5} onChange={(e) => setTax({ ...tax, seller_address: { ...tax.seller_address, postalCode: e.target.value } })} />
              </Field>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Subscription & billing</CardTitle>
              <CardSubtitle>Manage your arabclue plan via Moyasar (SAR).</CardSubtitle>
            </div>
          </CardHeader>
          <div className="flex items-center gap-3">
            <span className="text-sm capitalize">Current plan: {merchant?.plan ?? "—"}</span>
            <Button variant="ghost" type="button" onClick={() => window.location.assign("/billing")}>
              Manage billing
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Danger zone</CardTitle>
              <CardSubtitle>Disconnect Salla, export your data, or delete your account.</CardSubtitle>
            </div>
          </CardHeader>
          <div className="flex flex-wrap gap-3">
            <Button variant="ghost" type="button" onClick={exportData} disabled={exporting}>
              {exporting ? "Exporting…" : "Export all data"}
            </Button>
            <Button variant="danger" type="button" onClick={disconnectSalla} disabled={disconnecting}>
              {disconnecting ? "Disconnecting…" : "Disconnect Salla"}
            </Button>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
