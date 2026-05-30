import { AdminOverviewClient } from "@/components/admin/admin-overview-client";

export default function AdminOverviewPage() {
  return (
    <>
      <header className="border-b border-rule px-8 py-5">
        <h1 className="font-display text-2xl tracking-crisp">Platform overview</h1>
        <p className="text-sm text-ink-soft mt-1">Cross-merchant stats and health checks.</p>
      </header>
      <AdminOverviewClient />
    </>
  );
}
