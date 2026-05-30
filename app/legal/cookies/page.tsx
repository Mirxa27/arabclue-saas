import { StaticMarketingPage } from "@/components/marketing/static-page";

export const metadata = {
  title: "Cookie Policy — arabclue",
  description: "How arabclue uses cookies and similar technologies."
};

export default function CookiesPage() {
  return (
    <StaticMarketingPage
      title="Cookie Policy"
      subtitle="Last updated: January 2025"
    >
      <p>
        arabclue ("we", "us") uses cookies and similar technologies to operate
        our platform, authenticate users, and understand usage patterns. This policy explains what
        cookies we set, why we set them, and how you can control them.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">Essential cookies</h2>
      <p>
        These cookies are required for our platform to function. They include session tokens managed
        by Supabase Auth for keeping you signed in, and CSRF protection tokens. You cannot opt out
        of these cookies — the platform will not work without them.
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li><code className="text-xs bg-paper-deep px-1">sb-*-auth-token</code>: Supabase authentication session.</li>
        <li><code className="text-xs bg-paper-deep px-1">sb-*-auth-token-code-verifier</code>: PKCE code verifier for OAuth flows.</li>
        <li><code className="text-xs bg-paper-deep px-1">__Host-next-auth.csrf-token</code>: Cross-site request forgery protection.</li>
      </ul>

      <h2 className="font-display text-2xl text-ink pt-4">Functional cookies</h2>
      <p>
        We set a small number of functional cookies to remember your preferences:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li><code className="text-xs bg-paper-deep px-1">ac-locale</code>: Your preferred language (Arabic or English).</li>
        <li><code className="text-xs bg-paper-deep px-1">ac-theme</code>: Light or dark mode preference.</li>
      </ul>

      <h2 className="font-display text-2xl text-ink pt-4">Analytics cookies</h2>
      <p>
        We use minimal, privacy-respecting analytics to understand how merchants use our platform and
        where we can improve. No third-party advertising cookies are set.
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li><code className="text-xs bg-paper-deep px-1">ac_anon_id</code>: Anonymous usage identifier for product analytics.</li>
      </ul>

      <h2 className="font-display text-2xl text-ink pt-4">Third-party cookies</h2>
      <p>
        When you connect integrations (Salla, Meta, LinkedIn, TikTok, X/Twitter), those platforms may
        set their own cookies during OAuth flows. We do not control those cookies. Review each
        platform's cookie policy for details.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">Managing cookies</h2>
      <p>
        You can block or delete cookies through your browser settings. Disabling essential cookies
        will prevent you from signing in to arabclue. For questions about our cookie practices,
        contact{" "}
        <a href="mailto:privacy@arabclue.com" className="text-accent hover:underline">
          privacy@arabclue.com
        </a>.
      </p>
    </StaticMarketingPage>
  );
}