import { StaticMarketingPage } from "@/components/marketing/static-page";

export const metadata = {
  title: "Service Level Agreement — arabclue",
  description: "Service Level Agreement for arabclue platform services."
};

export default function SLAPage() {
  return (
    <StaticMarketingPage
      title="Service Level Agreement"
      subtitle="Last updated: January 2025"
    >
      <p>
        This Service Level Agreement ("SLA") defines the uptime, support, and
        performance commitments for the arabclue SaaS platform. This SLA applies to paying
        subscribers on active plans.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">1. Platform uptime</h2>
      <p>
        arabclue targets <strong>99.5% uptime</strong> on a monthly basis, measured across our
        application and API endpoints, excluding scheduled maintenance.
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>Scheduled maintenance</strong>: Announced at least 48 hours in advance via
        in-app notification and email. Scheduled maintenance does not count against uptime.</li>
        <li><strong>Emergency maintenance</strong>: May occur without advance notice for critical
        security patches or infrastructure incidents. Counts against uptime if exceeding 30 minutes.</li>
      </ul>

      <h2 className="font-display text-2xl text-ink pt-4">2. Service credits</h2>
      <p>
        If monthly uptime falls below the target, eligible subscribers receive service credits:
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-rule text-left">
              <th className="py-2 pr-4 font-medium">Monthly Uptime</th>
              <th className="py-2 pr-4 font-medium">Service Credit</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-rule">
              <td className="py-2 pr-4">99.0% – 99.49%</td>
              <td className="py-2 pr-4">10% of monthly fee</td>
            </tr>
            <tr className="border-b border-rule">
              <td className="py-2 pr-4">95.0% – 98.99%</td>
              <td className="py-2 pr-4">25% of monthly fee</td>
            </tr>
            <tr className="border-b border-rule">
              <td className="py-2 pr-4">Below 95.0%</td>
              <td className="py-2 pr-4">50% of monthly fee</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        To claim a credit, email{" "}
        <a href="mailto:billing@arabclue.com" className="text-accent hover:underline">
          billing@arabclue.com
        </a>{" "}
        within 14 days of the month in question. Credits are applied to the next billing cycle and
        do not exceed 50% of the monthly fee.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">3. Support response times</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-rule text-left">
              <th className="py-2 pr-4 font-medium">Severity</th>
              <th className="py-2 pr-4 font-medium">Description</th>
              <th className="py-2 pr-4 font-medium">First Response</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-rule">
              <td className="py-2 pr-4"><strong>Critical</strong></td>
              <td className="py-2 pr-4">Platform unavailable or core feature completely broken</td>
              <td className="py-2 pr-4">2 business hours</td>
            </tr>
            <tr className="border-b border-rule">
              <td className="py-2 pr-4"><strong>High</strong></td>
              <td className="py-2 pr-4">Major feature degraded, no workaround</td>
              <td className="py-2 pr-4">8 business hours</td>
            </tr>
            <tr className="border-b border-rule">
              <td className="py-2 pr-4"><strong>Normal</strong></td>
              <td className="py-2 pr-4">Minor issue, workaround available</td>
              <td className="py-2 pr-4">2 business days</td>
            </tr>
            <tr className="border-b border-rule">
              <td className="py-2 pr-4"><strong>Low</strong></td>
              <td className="py-2 pr-4">Cosmetic, feature request, or documentation</td>
              <td className="py-2 pr-4">5 business days</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Business hours are Sunday–Thursday, 9:00 AM – 6:00 PM (UTC+3, Riyadh). Support is provided
        in Arabic and English. Critical issues may be reported 24/7 via the in-app support widget
        and will receive first response within the target window from the next business day start.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">4. Monitoring and reporting</h2>
      <p>
        Platform uptime is continuously monitored. Current status and incident history are available
        at{" "}
        <a href="https://status.arabclue.com" className="text-accent hover:underline">
          status.arabclue.com
        </a>. Subscribers may subscribe to incident notifications from the status page.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">5. Exclusions</h2>
      <p>
        This SLA does not cover:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li>Issues caused by third-party services (Salla API, Meta API, Moyasar, Twilio, Supabase).</li>
        <li>Issues caused by the subscriber's internet connection, devices, or local network.</li>
        <li>Downtime during scheduled maintenance that was announced 48+ hours in advance.</li>
        <li>Force majeure events, including natural disasters, government actions, or large-scale
        internet outages beyond our control.</li>
        <li>Beta features or features explicitly labeled as "Preview" or
        "Experimental."</li>
        <li>Accounts that are past due on payment.</li>
      </ul>

      <h2 className="font-display text-2xl text-ink pt-4">6. API rate limits</h2>
      <p>
        To maintain platform stability, API rate limits apply per merchant account:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>Standard plans</strong>: 60 requests per minute for core APIs.</li>
        <li><strong>AI agent APIs</strong>: Subject to per-agent concurrency limits based on plan tier.</li>
        <li><strong>Webhook ingestion</strong>: Up to 100 events per second, burstable.</li>
        <li>Higher limits are available on Enterprise plans. Contact{" "}
        <a href="mailto:support@arabclue.com" className="text-accent hover:underline">
          support@arabclue.com
        </a>{" "}
        for details.</li>
      </ul>

      <p className="pt-6 text-ink-mute">
        Questions about this SLA? Contact{" "}
        <a href="mailto:support@arabclue.com" className="text-accent hover:underline">
          support@arabclue.com
        </a>.
      </p>
    </StaticMarketingPage>
  );
}