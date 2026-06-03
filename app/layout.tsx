import type { Metadata, Viewport } from "next";
import { ToastProvider } from "@/components/ui/toast";
import { ClientErrorReporter } from "@/components/observability/client-error-reporter";
import "./globals.css";

export const metadata: Metadata = {
  title: "arabclue — your dalīl for trading in Arabia",
  description:
    "Arabic-first AI ops copilot for Saudi & GCC SMBs. ZATCA-compliant invoicing, agentic social media, voice agents, and Arabic SEO — built for Vision 2030.",
  metadataBase: new URL("https://arabclue.com"),
  openGraph: {
    title: "arabclue — دليلك في التجارة العربية",
    description:
      "ZATCA invoicing • Arabic voice agents • Agentic social media • Built for Saudi SMBs.",
    url: "https://arabclue.com",
    siteName: "arabclue",
    locale: "en_US",
    alternateLocale: ["ar_SA"],
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "arabclue — your dalīl for trading in Arabia",
    description: "Arabic-first AI ops copilot for Saudi & GCC SMBs."
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon", type: "image/png" }]
  },
  manifest: "/manifest.webmanifest",
  alternates: {
    languages: { "en-US": "/", "ar-SA": "/ar" }
  }
};

// Activates env(safe-area-inset-*) on notched devices (the CSS already consumes
// the --safe-* vars) and matches the browser chrome + native controls to the
// app's light/dark palette. Zoom is intentionally NOT disabled (accessibility).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5EFE6" },
    { media: "(prefers-color-scheme: dark)", color: "#1A1816" }
  ]
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ToastProvider>
          <ClientErrorReporter />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
