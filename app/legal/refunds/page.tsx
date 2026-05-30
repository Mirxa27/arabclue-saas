import { StaticMarketingPage } from "@/components/marketing/static-page";

export const metadata = {
  title: "Refund Policy — arabclue",
  description: "arabclue refund and cancellation policy."
};

export default function RefundsPage() {
  return (
    <StaticMarketingPage
      title="Refund Policy"
      subtitle="Last updated: January 2025"
    >
      <p>
        arabclue ("we", "us") offers subscription-based AI operations
        services. This policy outlines the terms under which refunds may be issued.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">Subscription plans</h2>
      <p>
        All plans are billed monthly or annually in advance via Moyasar. Your subscription
        automatically renews at the end of each billing period unless cancelled. You can cancel
        anytime from Billing → Settings in your dashboard.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">Refund eligibility</h2>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>Monthly plans</strong>: Refunds are available within 7 calendar days of the initial
        charge, provided the platform has not been materially used (fewer than 10 AI agent actions consumed).</li>
        <li><strong>Annual plans</strong>: Refunds are available within 14 calendar days of the initial
        charge. A prorated refund will be issued for the unused months, less a 10% administrative fee.</li>
        <li><strong>Add-on employees</strong>: Employee seat charges are refundable under the same
        terms as the parent plan. Refunds are prorated if the employee was activated during the billing period.</li>
        <li><strong>Non-refundable</strong>: Setup fees, one-time services (ZATCA onboarding
        assistance, custom AI model training), and charges older than 60 days.</li>
      </ul>

      <h2 className="font-display text-2xl text-ink pt-4">How to request a refund</h2>
      <p>
        Email{" "}
        <a href="mailto:billing@arabclue.com" className="text-accent hover:underline">
          billing@arabclue.com
        </a>{" "}
        with your merchant account email and the charge you'd like refunded. We respond
        within 2 business days. Approved refunds are processed through Moyasar and typically
        appear in your account within 5–10 business days, depending on your bank.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">Cancellation</h2>
      <p>
        You may cancel your subscription at any time from Billing → Settings. Upon cancellation:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li>Your plan remains active until the end of the current billing period.</li>
        <li>No further charges are applied.</li>
        <li>Your data is retained for 30 days after the billing period ends, allowing you to export
        your data or reactivate your account.</li>
        <li>After 30 days, your data is permanently deleted, except for records required by Saudi law
        (e.g. ZATCA invoice records).</li>
      </ul>

      <h2 className="font-display text-2xl text-ink pt-4">Chargebacks</h2>
      <p>
        If you initiate a chargeback with your bank instead of contacting us first, we reserve the
        right to suspend your account while the dispute is resolved. Chargebacks may result in the
        loss of access to your data if the dispute period exceeds our standard data retention window.
      </p>

      <p className="pt-6 text-ink-mute">
        Questions? Contact{" "}
        <a href="mailto:billing@arabclue.com" className="text-accent hover:underline">
          billing@arabclue.com
        </a>.
      </p>
    </StaticMarketingPage>
  );
}