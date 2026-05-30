import Link from "next/link";
import { LogoFull } from "@/components/ui/logo";

export const metadata = {
  title: "Privacy Policy — arabclue",
  description: "How arabclue collects, uses, and protects merchant data under PDPL."
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-paper">
      <header className="border-b border-rule px-6 lg:px-10 h-16 flex items-center justify-between">
        <Link href="/">
          <LogoFull />
        </Link>
        <Link href="/login" className="text-sm hover:text-accent">
          Sign in
        </Link>
      </header>
      <article className="max-w-3xl mx-auto px-6 py-16 prose prose-neutral">
        <h1 className="font-display text-4xl tracking-crisp mb-2">Privacy Policy</h1>
        <p className="text-sm text-ink-mute mb-10">Last updated: January 2025 · PDPL-aligned</p>

        <section className="space-y-6 text-sm leading-relaxed text-ink-soft">
          <p>
            arabclue (&quot;we&quot;, &quot;us&quot;) provides an Arabic-first operations platform for Saudi and GCC merchants.
            This policy describes how we process personal and business data when you use arabclue.com and connected integrations
            (Salla, social platforms, Moyasar, ZATCA).
          </p>

          <h2 className="font-display text-2xl text-ink pt-4">Data we collect</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>Account data: email, name, authentication identifiers (Supabase Auth).</li>
            <li>Merchant profile: business name, VAT/CR numbers, store URLs, billing status.</li>
            <li>Operational data: invoices, social posts, voice bookings, SEO content, integration tokens (encrypted at rest).</li>
            <li>Technical logs: API requests, webhook events, error diagnostics (no payment card data — Moyasar handles cards).</li>
          </ul>

          <h2 className="font-display text-2xl text-ink pt-4">Cross-border transfers</h2>
          <p>
            Until in-Kingdom hosting is available, some processing may occur outside Saudi Arabia (e.g. Supabase, AI providers).
            You accept this transfer during onboarding via our Data Processing Agreement. We minimize data sent to AI services
            and do not use merchant data to train public models.
          </p>

          <h2 className="font-display text-2xl text-ink pt-4">Your rights (PDPL)</h2>
          <p>
            You may export your data from Settings, request correction, or ask us to delete your account by contacting
            {" "}
            <a href="mailto:privacy@arabclue.com" className="text-accent hover:underline">privacy@arabclue.com</a>.
            We respond within 30 days.
          </p>

          <h2 className="font-display text-2xl text-ink pt-4">Security</h2>
          <p>
            OAuth tokens are encrypted with AES-256-GCM when <code className="text-xs bg-paper-deep px-1">TOKEN_ENCRYPTION_KEY</code> is configured.
            Row-level security isolates each merchant in PostgreSQL. Admin access is restricted to platform operators.
          </p>

          <h2 className="font-display text-2xl text-ink pt-4">Contact</h2>
          <p>
            Data controller: arabclue · Riyadh, Kingdom of Saudi Arabia ·{" "}
            <a href="mailto:privacy@arabclue.com" className="text-accent hover:underline">privacy@arabclue.com</a>
          </p>
        </section>
      </article>
    </main>
  );
}
