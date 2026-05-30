import { StaticMarketingPage } from "@/components/marketing/static-page";

export const metadata = {
  title: "Manifesto — arabclue",
  description: "Why arabclue exists — commerce clarity for Arabic merchants."
};

export default function ManifestoPage() {
  return (
    <StaticMarketingPage title="Manifesto" subtitle="دليلك في التجارة العربية">
      <p>
        Every merchant deserves software that speaks their language — not just UI translation, but voice, tax law,
        and customer expectations rooted in the Gulf.
      </p>
      <p>
        We believe compliance (ZATCA, PDPL) should be automatic, not a quarterly panic. We believe social content
        should sound like the merchant, not a generic AI. We believe voice and WhatsApp-era customers expect instant,
        dignified responses in Arabic.
      </p>
      <p>
        arabclue is opinionated: Salla-first, Saudi-first, Arabic-first. We integrate deeply rather than
        spreading thin across every platform on earth.
      </p>
    </StaticMarketingPage>
  );
}
