import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "arabclue",
    short_name: "arabclue",
    description:
      "Arabic-first AI ops copilot for Saudi & GCC SMBs — ZATCA invoicing, social agents, voice, and Arabic SEO.",
    start_url: "/",
    display: "standalone",
    background_color: "#F5EFE6",
    theme_color: "#0F4D3E",
    lang: "en",
    dir: "ltr",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }
    ]
  };
}
