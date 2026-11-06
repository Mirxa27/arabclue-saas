import { StaticMarketingPage } from "@/components/marketing/static-page";
import { DPA_LAST_UPDATED } from "@/lib/legal/dpa";

export const metadata = {
  title: "Data Processing Agreement — arabclue",
  description: "Data Processing Agreement between arabclue and its merchants under PDPL."
};

export default function DPAPage() {
  return (
    <StaticMarketingPage
      title="Data Processing Agreement"
      subtitle={`Last updated: ${DPA_LAST_UPDATED} · PDPL-aligned`}
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
        <li><strong>Merchant Data</strong>: Business profile data, operational data (invoices, social posts, voice bookings, SEO content), integration credentials, and the data of the Controller's own customers that the platform processes on the Controller's behalf.</li>
        <li><strong>Customer Data</strong>: Personal data of the Controller's customers — for example names, phone numbers, handles and message content — received through channels the Controller connects (WhatsApp, Telegram, Slack, SMS, email, Facebook Messenger, Instagram, voice calls) or through the Controller's store (e.g. Salla orders).</li>
      </ul>

      <h2 className="font-display text-2xl text-ink pt-4">2. Nature and purpose of processing</h2>
      <p>
        Processor processes Merchant Data solely to provide the arabclue platform services on the
        Controller's instructions: AI-powered social media management, the voice agent, SEO content
        generation, ZATCA e-invoicing, and <strong>AI employees</strong> that read and reply to the
        Controller's customers on the channels the Controller connects, and take the actions the
        Controller configures (for example creating tasks, invoices or bookings). Message content is
        sent to the AI model providers listed below to generate replies. Processing is limited to what
        is necessary for service delivery.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">3. Duration, export and deletion</h2>
      <p>
        Processor processes Merchant Data for the duration of the Controller's use of the platform.
        The Controller can export all Merchant Data at any time (Settings → Export all data) and can
        delete the account at any time; deletion removes Merchant Data, including Customer Data and
        invoices, immediately and permanently. The Controller, as the taxpayer, remains responsible for
        retaining its tax invoices and records for the period Saudi law requires and must export them
        before deleting the account.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">4. Controller obligations</h2>
      <p>
        Controller warrants that it has a lawful basis for collecting and processing personal data
        through the platform, including informing its customers that automated (AI) replies may be used
        and obtaining necessary consents from data subjects where required under PDPL. Controller is
        responsible for the accuracy and lawfulness of data it uploads or generates through the platform.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">5. Processor obligations</h2>
      <ul className="list-disc pl-5 space-y-2">
        <li>Process Merchant Data only on documented instructions from Controller.</li>
        <li>Implement appropriate technical and organizational measures (section 8).</li>
        <li>Notify Controller without undue delay of any personal data breach.</li>
        <li>Assist Controller in responding to data subject requests under PDPL (export and deletion are available in the dashboard).</li>
        <li>Delete Merchant Data on Controller's instruction, as described in section 3.</li>
        <li>Make available information necessary to demonstrate compliance with this DPA.</li>
      </ul>

      <h2 className="font-display text-2xl text-ink pt-4">6. Sub-processors</h2>
      <p>
        Processor uses the following sub-processors to deliver the platform. Providers marked
        "when connected/configured" receive data only if the Controller (or Processor's configuration)
        enables that feature. Controller authorizes these sub-processors by continuing to use the platform:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>Supabase</strong> (USA/Singapore): Database hosting and authentication.</li>
        <li><strong>Hostinger</strong>: Production application hosting.</li>
        <li><strong>Vercel</strong> (USA): Preview and optional application hosting.</li>
        <li><strong>Moyasar</strong> (Saudi Arabia): Payment processing (card data never touches Processor servers).</li>
        <li><strong>OpenAI</strong> (USA): AI model inference for social, SEO, onboarding and AI-employee features. Merchant Data is not used to train models.</li>
        <li><strong>Anthropic</strong> (USA), when configured: AI model inference.</li>
        <li><strong>HUMAIN</strong> (Saudi Arabia), when configured: in-Kingdom AI model inference for PDPL data-residency.</li>
        <li><strong>Twilio</strong> (USA), when connected: voice and SMS.</li>
        <li><strong>Resend</strong> (USA), when configured: transactional email (support acknowledgements, AI-employee email channel).</li>
        <li><strong>Meta Platforms</strong>, when connected: WhatsApp Business, Facebook Messenger and Instagram messaging and publishing.</li>
        <li><strong>Telegram, Slack, Google, LinkedIn, X, TikTok</strong>, when connected by the Controller: the respective channel or account integration.</li>
        <li><strong>Salla</strong> (Saudi Arabia), when connected: store, order and product data.</li>
        <li><strong>Wathq</strong> (Saudi Arabia), when configured: commercial-registration verification.</li>
        <li><strong>Sentry</strong> (USA) and <strong>Upstash</strong>, when configured: error monitoring (with secrets and personal data redacted before sending) and rate limiting.</li>
      </ul>
      <p>
        Invoices are submitted to the Zakat, Tax and Customs Authority (ZATCA) as required by Saudi law;
        ZATCA is a recipient by legal obligation, not a sub-processor. Processor will notify Controller of
        any intended changes to sub-processors (by updating this page and asking for re-acceptance in the
        dashboard) and provide Controller an opportunity to object.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">7. Cross-border transfers</h2>
      <p>
        Some sub-processors operate outside Saudi Arabia. Where such transfers occur, Processor
        implements safeguards including encryption, contractual commitments, and data minimization.
        Where the Controller requires in-Kingdom AI processing, AI inference can be routed to an
        in-Kingdom provider. Controller accepts these transfers by using the platform.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">8. Security measures</h2>
      <p>
        Processor maintains: AES-256-GCM encryption at rest for integration credentials and OAuth tokens,
        TLS for data in transit, Supabase Row-Level Security and column-level privileges for merchant
        data isolation, signature verification on inbound webhooks, role-based access controls,
        redaction of secrets and personal data from error logs, and regular security reviews. Detailed
        security documentation is available upon request.
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
