import { AdminAgentsClient } from "@/components/admin/admin-agents-client";

export default function AdminAgentsPage() {
  return (
    <>
      <header className="border-b border-rule px-8 py-5">
        <h1 className="font-display text-2xl tracking-crisp">Agents</h1>
        <p className="text-sm text-ink-soft mt-1">Social, voice, and SEO agent toggles and defaults.</p>
      </header>
      <AdminAgentsClient />
    </>
  );
}
