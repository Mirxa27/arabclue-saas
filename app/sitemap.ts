import type { MetadataRoute } from "next";
import { EMPLOYEE_CATALOG } from "@/lib/employees/catalog";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://arabclue.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const marketplaceRoutes: MetadataRoute.Sitemap = EMPLOYEE_CATALOG.map((role) => ({
    url: `${siteUrl}/marketplace/${role.slug}`,
    lastModified,
    changeFrequency: "weekly" as const,
    priority: 0.6
  }));
  return [
    { url: siteUrl, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/ar`, lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: `${siteUrl}/marketplace`, lastModified, changeFrequency: "weekly", priority: 0.8 },
    { url: `${siteUrl}/login`, lastModified, changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/signup`, lastModified, changeFrequency: "monthly", priority: 0.7 },
    { url: `${siteUrl}/legal/privacy`, lastModified, changeFrequency: "yearly", priority: 0.4 },
    { url: `${siteUrl}/legal/terms`, lastModified, changeFrequency: "yearly", priority: 0.4 },
    { url: `${siteUrl}/legal/refunds`, lastModified, changeFrequency: "yearly", priority: 0.4 },
    { url: `${siteUrl}/legal/aup`, lastModified, changeFrequency: "yearly", priority: 0.4 },
    { url: `${siteUrl}/legal/sla`, lastModified, changeFrequency: "yearly", priority: 0.4 },
    { url: `${siteUrl}/legal/dpa`, lastModified, changeFrequency: "yearly", priority: 0.4 },
    { url: `${siteUrl}/legal/cookie-policy`, lastModified, changeFrequency: "yearly", priority: 0.4 },
    ...marketplaceRoutes
  ];
}
