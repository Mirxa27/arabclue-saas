"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/dashboard/page-shell";
import { Card, CardHeader, CardSubtitle, CardTitle, Field, Input } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useMerchant } from "@/hooks/use-merchant";
import type { SellerAddress } from "@/lib/types/database";
import {
  Receipt,
  ShieldCheck,
  Building2,
  Hash,
  MapPin,
  CreditCard,
  ArrowUpRight,
  TriangleAlert,
  Download,
  Unplug,
  Trash2,
  X,
  Save,
} from "lucide-react";

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
  seller_address: { street: "", building: "", city: "", postalCode: "" },
};

export default function SettingsPage() {
  const { merchant, loading, error: merchantError } = useMerchant();
  const { toast } = useToast();
  const [tax, setTax] = useState<TaxSettings>(emptyTax);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (merchantError) toast(merchantError, "error");
  }, [merchantError, toast]);

  useEffect(() => {
    if (!merchant) return;
    setTax({
      seller_name: merchant.seller_name ?? "",
      vat_number: merchant.vat_number ?? "",
      cr_number: merchant.cr_number ?? "",
      seller_address: merchant.seller_address ?? emptyTax.seller_address,
    });
  }, [merchant]);

  async function save() {
    setSaving(true);
    try {
      await apiFetch("/api/merchant/tax", {
        method: "POST",
        body: JSON.stringify(tax),
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

  const deleteTargetName =
    merchant?.seller_name?.trim() ||
    merchant?.store_url?.replace(/^https?:\/\//, "").split("/")[0] ||
    "";

  async function deleteAccount() {
    if (!confirmName.trim() || confirmName.trim() !== deleteTargetName) {
      toast("Confirmation name does not match your store name", "error");
      return;
    }
    setDeleting(true);
    try {
      await apiFetch("/api/merchant/delete-account", {
        method: "POST",
        body: JSON.stringify({ confirmName: confirmName.trim() }),
      });
      toast("Account deleted", "success");
      window.location.assign("/");
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Delete failed", "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <PageShell title="Settings" merchant={merchant} loading={loading}>
      <div className="space-y-6 max-w-3xl">
        {/* Page header card */}
        <Card>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink">Account Settings</h2>
              <p className="text-xs text-ink-mute mt-0.5">
                Manage your tax profile, billing, and account data.
              </p>
            </div>
          </div>
        </Card>

        {/* ZATCA Tax Details */}
        <Card>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
              <Receipt size={16} />
            </div>
            <div>
              <CardTitle>ZATCA tax details</CardTitle>
              <CardSubtitle>Required for issuing compliant invoices. Never displayed publicly.</CardSubtitle>
            </div>
          </div>

          <div className="space-y-5">
            <Field label="Seller legal name">
              <Input value={tax.seller_name} onChange={(e) => setTax({ ...tax, seller_name: e.target.value })} />
            </Field>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="VAT number" hint="15 digits">
                <Input value={tax.vat_number} maxLength={15} onChange={(e) => setTax({ ...tax, vat_number: e.target.value })} />
              </Field>
              <Field label="CR number" hint="10 digits">
                <Input value={tax.cr_number} maxLength={10} onChange={(e) => setTax({ ...tax, cr_number: e.target.value })} />
              </Field>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Street">
                <Input
                  value={tax.seller_address.street}
                  onChange={(e) =>
                    setTax({ ...tax, seller_address: { ...tax.seller_address, street: e.target.value } })
                  }
                />
              </Field>
              <Field label="Building no.">
                <Input
                  value={tax.seller_address.building}
                  onChange={(e) =>
                    setTax({ ...tax, seller_address: { ...tax.seller_address, building: e.target.value } })
                  }
                />
              </Field>
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              <Field label="City">
                <Input
                  value={tax.seller_address.city}
                  onChange={(e) =>
                    setTax({ ...tax, seller_address: { ...tax.seller_address, city: e.target.value } })
                  }
                />
              </Field>
              <Field label="District">
                <Input
                  value={tax.seller_address.district ?? ""}
                  onChange={(e) =>
                    setTax({ ...tax, seller_address: { ...tax.seller_address, district: e.target.value } })
                  }
                />
              </Field>
              <Field label="Postal code" hint="5 digits">
                <Input
                  value={tax.seller_address.postalCode}
                  maxLength={5}
                  onChange={(e) =>
                    setTax({ ...tax, seller_address: { ...tax.seller_address, postalCode: e.target.value } })
                  }
                />
              </Field>
            </div>
          </div>
        </Card>

        {/* Billing */}
        <Card>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-xl bg-accent-warm/10 border border-accent-warm/20 flex items-center justify-center text-accent-warm">
              <CreditCard size={16} />
            </div>
            <div>
              <CardTitle>Subscription & billing</CardTitle>
              <CardSubtitle>Manage your arabclue plan via Moyasar (SAR).</CardSubtitle>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink-mute capitalize">Current plan:</span>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-accent/10 text-accent border border-accent/20 capitalize">
              {merchant?.plan ?? "—"}
            </span>
            <Button variant="outline" size="sm" type="button" onClick={() => window.location.assign("/billing")}>
              <ArrowUpRight size={13} />
              Manage billing
            </Button>
          </div>
        </Card>

        {/* Danger Zone */}
        <Card className="border-danger/20">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-xl bg-danger/10 border border-danger/20 flex items-center justify-center text-danger">
              <TriangleAlert size={16} />
            </div>
            <div>
              <CardTitle>Danger zone</CardTitle>
              <CardSubtitle>Disconnect Salla, export your data, or delete your account.</CardSubtitle>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" size="sm" type="button" onClick={exportData} disabled={exporting}>
              <Download size={13} />
              {exporting ? "Exporting…" : "Export all data"}
            </Button>
            <Button variant="danger" size="sm" type="button" onClick={disconnectSalla} disabled={disconnecting}>
              <Unplug size={13} />
              {disconnecting ? "Disconnecting…" : "Disconnect Salla"}
            </Button>
            <Button variant="danger" size="sm" type="button" onClick={() => setDeleteOpen(true)}>
              <Trash2 size={13} />
              Delete account
            </Button>
          </div>
        </Card>

        {/* Save bar (sticky on mobile) */}
        <div className="fixed bottom-0 left-0 right-0 lg:left-64 p-4 bg-paper/90 backdrop-blur-xl border-t border-rule/40 lg:static lg:bg-transparent lg:backdrop-blur-none lg:border-0 lg:p-0 z-30">
          <div className="flex items-center justify-end">
            <Button onClick={save} disabled={saving}>
              <Save size={14} />
              {saving ? "Saving…" : "Save tax settings"}
            </Button>
          </div>
        </div>

        {/* Delete account modal */}
        {deleteOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm" onClick={() => setDeleteOpen(false)} />
            {/* Modal */}
            <div className="relative w-full max-w-md bg-paper/95 backdrop-blur-2xl border border-danger/20 rounded-2xl p-6 shadow-2xl shadow-ink/10">
              <button
                className="absolute top-4 right-4 p-1.5 rounded-xl hover:bg-ink/5 text-ink-mute transition-colors"
                onClick={() => {
                  setDeleteOpen(false);
                  setConfirmName("");
                }}
              >
                <X size={18} />
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-danger/10 border border-danger/20 flex items-center justify-center text-danger">
                  <Trash2 size={20} />
                </div>
                <h3 className="text-lg font-semibold text-ink">Delete your account</h3>
              </div>

              <p className="text-sm text-ink-mute leading-relaxed">
                This permanently deletes your merchant profile, invoices, social posts, and auth account. Type{" "}
                <strong className="text-ink font-semibold">{deleteTargetName || "your store name"}</strong> to confirm.
              </p>

              <div className="mt-5">
                <Field label="Store name">
                  <Input
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    placeholder={deleteTargetName}
                  />
                </Field>
              </div>

              <div className="mt-6 flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setDeleteOpen(false);
                    setConfirmName("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={deleteAccount}
                  disabled={deleting || !confirmName.trim()}
                >
                  {deleting ? "Deleting…" : "Delete forever"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}