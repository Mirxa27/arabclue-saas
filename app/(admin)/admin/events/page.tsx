import { Suspense } from "react";
import { AdminEventsClient } from "@/components/admin/admin-events-client";

export default function AdminEventsPage() {
  return (
    <>
      <header className="border-b border-rule px-8 py-5">
        <h1 className="font-display text-2xl tracking-crisp">Events</h1>
        <p className="text-sm text-ink-soft mt-1">Platform audit log with filters.</p>
      </header>
      <Suspense fallback={<p className="p-8 text-sm text-ink-mute">Loading…</p>}>
        <AdminEventsClient />
      </Suspense>
    </>
  );
}
