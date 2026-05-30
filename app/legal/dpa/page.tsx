import { StaticMarketingPage } from "@/components/marketing/static-page";

export const metadata = {
  title: "Data Processing Agreement — arabclue",
  description: "Data Processing Agreement between arabclue and its merchants under PDPL."
};

export default function DPAPage() {
  return (
    <StaticMarketingPage
      title="Data Processing Agreement"
      subtitle="Last updated: January 2025 · PDPL-aligned"
    >
      <p>
        This Data Processing Agreement ("DPA") forms part of the Terms of Service between
        arabclue ("Processor") and the merchant ("Controller"). It governs the
        processing of personal data in connection with the arabclue SaaS platform, in accordance with
        the Saudi Personal Data Protection Law (PDPL) and applicable GCC regulations.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">1. Definitions</h2>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>Personal Data</strong>: Any data relating to an identified or identifiable natural person, as defined under PDPL.</li>
        <li><strong>Processing</strong>: Any operation performed on personal data, including collection, storage, use, disclosure, and deletion.</li>
        <li><strong>Merchant Data</strong>: Business profile data, operational data (invoices, social posts, voice bookings, SEO content), and integration tokens stored on the Controller's behalf.</li>
      </ul>

      <h2 className="font-display text-2xl text-ink pt-4">2. Nature and purpose of processing</h2>
      <p>
        Processor processes Merchant Data solely to provide the arabclue platform services: AI-powered
        social media management, voice agent operations, SEO content generation, ZATCA e-invoicing,
        and related operational tooling. Processing is limited to what is necessary for service delivery
        and improvement.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">3. Duration</h2>
      <p>
        Processor processes Merchant Data for the duration of the Controller's active subscription.
        Upon termination, data is retained for 30 days to allow export, then permanently deleted,
        unless retention is required by Saudi law (e.g. ZATCA invoice records).
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">4. Controller obligations</h2>
      <p>
        Controller warrants that it has a lawful basis for collecting and processing personal data
        through the platform, including obtaining necessary consents from data subjects (customers,
        employees) where required under PDPL. Controller is responsible for the accuracy and
        lawfulness of data it uploads or generates through the platform.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">5. Processor obligations</h2>
      <ul className="list-disc pl-5 space-y-2">
        <li>Process Merchant Data only on documented instructions from Controller.</li>
        <li>Implement appropriate technical and organizational measures (encryption at rest and in transit, RLS, access controls).</li>
        <li>Notify Controller without undue delay of any personal data breach.</li>
        <li>Assist Controller in responding to data subject requests under PDPL.</li>
        <li>Delete or return all Merchant Data at Controller's election upon termination.</li>
        <li>Make available information necessary to demonstrate compliance with this DPA.</li>
      </ul>

      <h2 className="font-display text-2xl text-ink pt-4">6. Sub-processors</h2>
      <p>
        Processor uses the following sub-processors to deliver the platform. Controller authorizes
        these sub-processors by continuing to use the platform:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>Supabase</strong> (USA/Singapore): Database hosting, authentication, edge functions.</li>
        <li><strong>Vercel</strong> (USA): Application hosting and serverless functions.</li>
        <li><strong>Moyasar</strong> (Saudi Arabia): Payment processing (card data never touches Processor servers).</li>
        <li><strong>AI model providers</strong>: Inference for social, voice, and SEO agents. Merchant data is not used to train public models.</li>
        <li><strong>Twilio</strong> (USA): Voice/SMS infrastructure for the voice agent.</li>
      </ul>
      <p>
        Processor will notify Controller of any intended changes to sub-processors and provide
        Controller an opportunity to object.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">7. Cross-border transfers</h2>
      <p>
        Some sub-processors operate outside Saudi Arabia. Where such transfers occur, Processor
        implements safeguards including encryption, contractual commitments, and data minimization.
        Controller accepts these transfers by using the platform. Processor will migrate to in-Kingdom
        infrastructure as it becomes available.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">8. Security measures</h2>
      <p>
        Processor maintains: AES-256-GCM encryption for OAuth tokens, TLS 1.3 for data in transit,
        Supabase Row-Level Security (RLS) for merchant data isolation, role-based access controls,
        and regular security reviews. Detailed security documentation is available upon request.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">9. Audit rights</h2>
      <p>
        Controller may request evidence of Processor's compliance with this DPA no more than once
        per calendar year. Processor will provide summary audit reports or security certifications.
        On-site audits require 30 days' written notice and are at Controller's expense.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">10. Governing law</h2>
      <p>
        This DPA is governed by the laws of the Kingdom of Saudi Arabia. Any disputes shall be
        resolved by the competent courts in Riyadh.
      </p>

      <p className="pt-6 text-ink-mute">
        Questions about this DPA? Contact{" "}
        <a href="mailto:privacy@arabclue.com" className="text-accent hover:underline">
          privacy@arabclue.com
        </a>.
      </p>
    </StaticMarketingPage>
  );
}