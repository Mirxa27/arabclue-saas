import { AdminMerchantsClient } from "@/components/admin/admin-merchants-client";

export default function AdminMerchantsPage() {
  return (
    <>
      <header className="border-b border-rule px-8 py-5">
        <h1 className="font-display text-2xl tracking-crisp">Merchants</h1>
        <p className="text-sm text-ink-soft mt-1">All stores, plans, and integration status.</p>
      </header>
      <AdminMerchantsClient />
    </>
  );
}
