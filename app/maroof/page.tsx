import { StaticMarketingPage } from "@/components/marketing/static-page";

export const metadata = {
  title: "Maroof — arabclue",
  description: "arabclue commercial registration and Maroof trust information."
};

export default function MaroofPage() {
  return (
    <StaticMarketingPage title="Maroof / Commercial registration" subtitle="Trust & transparency">
      <p>
        Saudi merchants and customers can verify business legitimacy through Maroof (معروف) and commercial registration
        records. arabclue publishes this page for transparency with our merchant community.
      </p>
      <h2 className="font-display text-2xl text-ink pt-4">Verification</h2>
      <p>
        Official Maroof and CR details will be published here prior to public launch. For verification requests
        before go-live, email{" "}
        <a href="mailto:trust@arabclue.com" className="text-accent hover:underline">
          trust@arabclue.com
        </a>
        .
      </p>
      <p className="text-ink-mute text-xs">
        This page satisfies footer links for معروف / Maroof. Update with your CR number and Maroof URL when available.
      </p>
    </StaticMarketingPage>
  );
}
