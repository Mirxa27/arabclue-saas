import { StaticMarketingPage } from "@/components/marketing/static-page";

export const metadata = {
  title: "Acceptable Use Policy — arabclue",
  description: "Acceptable use policy for arabclue platform services."
};

export default function AUPPage() {
  return (
    <StaticMarketingPage
      title="Acceptable Use Policy"
      subtitle="Last updated: January 2025"
    >
      <p>
        This Acceptable Use Policy ("AUP") governs your use of the arabclue platform.
        By using arabclue, you agree to comply with this policy. Violations may result in
        suspension or termination of your account.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">Prohibited content</h2>
      <p>
        You may not use arabclue to create, distribute, or facilitate:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li>Content that violates Saudi law, GCC regulations, or applicable international law.</li>
        <li>Content that infringes intellectual property rights of others.</li>
        <li>Harassment, hate speech, defamation, or threats against individuals or groups.</li>
        <li>Fraudulent, deceptive, or misleading content, including impersonation.</li>
        <li>Malware, phishing, spam, or any content designed to harm systems or users.</li>
        <li>Content that promotes illegal goods, services, or activities.</li>
        <li>Content violating platform-specific policies (Salla, Meta, LinkedIn, TikTok, X, Twilio).</li>
      </ul>

      <h2 className="font-display text-2xl text-ink pt-4">Prohibited conduct</h2>
      <ul className="list-disc pl-5 space-y-2">
        <li>Attempting to circumvent usage limits, billing, or security controls.</li>
        <li>Reverse engineering, decompiling, or extracting the platform source code.</li>
        <li>Using the platform to build a competing service.</li>
        <li>Excessive API calls or automated requests that degrade platform performance for other
        merchants (rate limits apply).</li>
        <li>Reselling, sublicensing, or redistributing the platform to third parties without written
        authorization.</li>
        <li>Using AI agents to generate content that misrepresents the merchant's identity
        or deceives end consumers.</li>
      </ul>

      <h2 className="font-display text-2xl text-ink pt-4">Platform integrity</h2>
      <p>
        You agree not to:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li>Interfere with the proper functioning of the platform, its security features, or
        monitoring systems.</li>
        <li>Test, scan, or probe platform vulnerabilities without prior written authorization.</li>
        <li>Access data or accounts you are not authorized to access.</li>
        <li>Upload malicious code or exploit platform vulnerabilities.</li>
      </ul>

      <h2 className="font-display text-2xl text-ink pt-4">AI agent usage</h2>
      <p>
        arabclue AI agents (social, voice, SEO) are designed to assist with legitimate business
        operations. You are responsible for:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li>Reviewing AI-generated content before publication.</li>
        <li>Ensuring AI agents comply with platform-specific policies when posting or interacting on
        third-party platforms.</li>
        <li>Not using AI agents for automated spam, coordinated inauthentic behavior, or any activity
        that violates the terms of service of connected platforms.</li>
        <li>Complying with Saudi e-commerce and advertising regulations for all AI-generated content.</li>
      </ul>

      <h2 className="font-display text-2xl text-ink pt-4">Enforcement</h2>
      <p>
        We reserve the right to review content and activity for compliance with this AUP. Violations
        may result in:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li>Warning and request for corrective action.</li>
        <li>Temporary suspension of specific features or integrations.</li>
        <li>Account suspension pending investigation.</li>
        <li>Permanent account termination for severe or repeated violations.</li>
      </ul>
      <p>
        We may report illegal activity to appropriate authorities as required by Saudi law.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">Reporting violations</h2>
      <p>
        Report suspected violations of this AUP to{" "}
        <a href="mailto:abuse@arabclue.com" className="text-accent hover:underline">
          abuse@arabclue.com
        </a>. We review all reports promptly and treat them confidentially.
      </p>

      <p className="pt-6 text-ink-mute">
        Questions? Contact{" "}
        <a href="mailto:support@arabclue.com" className="text-accent hover:underline">
          support@arabclue.com
        </a>.
      </p>
    </StaticMarketingPage>
  );
}