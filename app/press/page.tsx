import { StaticMarketingPage } from "@/components/marketing/static-page";

export const metadata = {
  title: "Press — arabclue",
  description: "Press kit and media contact for arabclue."
};

export default function PressPage() {
  return (
    <StaticMarketingPage title="Press" subtitle="Media inquiries">
      <p>
        For press, partnerships, and speaking requests, contact{" "}
        <a href="mailto:press@arabclue.com" className="text-accent hover:underline">
          press@arabclue.com
        </a>
        .
      </p>
      <h2 className="font-display text-2xl text-ink pt-4">Boilerplate</h2>
      <p>
        arabclue is an Arabic-first merchant operations platform integrating ZATCA e-invoicing, AI social publishing,
        voice booking, and SEO for Salla stores in Saudi Arabia and the GCC.
      </p>
      <h2 className="font-display text-2xl text-ink pt-4">Brand</h2>
      <p>
        Logo and brand assets available on request. Please do not modify the arabclue wordmark or use our name to
        imply Salla or ZATCA endorsement.
      </p>
    </StaticMarketingPage>
  );
}
