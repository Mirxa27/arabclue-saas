import { StaticMarketingPage } from "@/components/marketing/static-page";

export const metadata = {
  title: "Careers — arabclue",
  description: "Join the arabclue team in Riyadh."
};

export default function CareersPage() {
  return (
    <StaticMarketingPage title="Careers" subtitle="Remote-friendly · Riyadh HQ">
      <p>
        We&apos;re a small team building production infrastructure for thousands of Saudi merchants. We hire for
        craft, ownership, and respect for Arabic product detail — not pedigree.
      </p>
      <h2 className="font-display text-2xl text-ink pt-4">Open roles</h2>
      <p>No open listings right now. Send a general application with work samples to:</p>
      <p>
        <a href="mailto:careers@arabclue.com" className="text-accent hover:underline">
          careers@arabclue.com
        </a>
      </p>
    </StaticMarketingPage>
  );
}
