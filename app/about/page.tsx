import { StaticMarketingPage } from "@/components/marketing/static-page";

export const metadata = {
  title: "About — arabclue",
  description: "Arabic-first operations platform for Saudi and GCC merchants."
};

export default function AboutPage() {
  return (
    <StaticMarketingPage title="About arabclue" subtitle="Built in Riyadh for Vision 2030 merchants">
      <p>
        arabclue is an Arabic-first operations layer for Salla stores: ZATCA e-invoicing, AI social publishing,
        voice booking, and SEO — in one dashboard tuned for Saudi compliance and Gulf dialect.
      </p>
      <p>
        We started from a simple observation: Saudi merchants run world-class brands on Salla, but compliance,
        content, and customer channels still live in five different tools. arabclue unifies them without
        forcing English-first workflows.
      </p>
      <p>
        Questions?{" "}
        <a href="mailto:hello@arabclue.com" className="text-accent hover:underline">
          hello@arabclue.com
        </a>
      </p>
    </StaticMarketingPage>
  );
}
