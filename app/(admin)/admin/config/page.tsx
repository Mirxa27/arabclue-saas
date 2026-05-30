import { AdminConfigClient } from "@/components/admin/admin-config-client";

export default function AdminConfigPage() {
  return (
    <>
      <header className="border-b border-rule px-8 py-5">
        <h1 className="font-display text-2xl tracking-crisp">Platform configuration</h1>
        <p className="text-sm text-ink-soft mt-1">Environment keys, integration status, and connection tests.</p>
      </header>
      <AdminConfigClient />
    </>
  );
}
