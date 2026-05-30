import Link from "next/link";
import { LogoFull } from "@/components/ui/logo";

export const metadata = {
  title: "Terms of Service — arabclue",
  description: "Terms governing use of the arabclue platform for Saudi merchants."
};

export default function TermsPage() {
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
      <article className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="font-display text-4xl tracking-crisp mb-2">Terms of Service</h1>
        <p className="text-sm text-ink-mute mb-10">Last updated: January 2025</p>

        <section className="space-y-6 text-sm leading-relaxed text-ink-soft">
          <p>
            By creating an arabclue account or installing our Salla app, you agree to these terms. arabclue is a B2B software
            service for merchants in Saudi Arabia and the GCC.
          </p>

          <h2 className="font-display text-2xl text-ink pt-4">Service</h2>
          <p>
            We provide ZATCA invoicing tools, social media automation, voice agent configuration, Arabic SEO generation, and related
            integrations. Features depend on your subscription plan and connected third-party accounts.
          </p>

          <h2 className="font-display text-2xl text-ink pt-4">Merchant responsibilities</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>You are responsible for accurate VAT/CR details and ZATCA compliance of issued invoices.</li>
            <li>You must have rights to content published via connected social accounts.</li>
            <li>You must comply with Salla, Meta, Moyasar, and other platform terms.</li>
          </ul>

          <h2 className="font-display text-2xl text-ink pt-4">Billing</h2>
          <p>
            Subscriptions are billed monthly in SAR through Moyasar. Fees are non-refundable except where required by law.
            We may suspend access for unpaid invoices after a grace period.
          </p>

          <h2 className="font-display text-2xl text-ink pt-4">Limitation of liability</h2>
          <p>
            arabclue is provided &quot;as is&quot;. We are not liable for indirect damages, lost profits, or penalties arising from
            tax authority decisions. Our aggregate liability is limited to fees paid in the twelve months preceding a claim.
          </p>

          <h2 className="font-display text-2xl text-ink pt-4">Governing law</h2>
          <p>These terms are governed by the laws of the Kingdom of Saudi Arabia. Disputes are subject to the courts of Riyadh.</p>

          <p className="pt-4">
            Questions:{" "}
            <a href="mailto:legal@arabclue.com" className="text-accent hover:underline">legal@arabclue.com</a>
          </p>
        </section>
      </article>
    </main>
  );
}
