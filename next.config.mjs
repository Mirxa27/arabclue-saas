/**
 * Image optimizer posture.
 *
 * The app renders no `next/image` (the only <img> is an inline data: QR), so the
 * `/_next/image` optimizer is switched off entirely: with `unoptimized: true`
 * Next answers that endpoint with a 404 before validating params, fetching, or
 * loading sharp/libvips. That removes the whole image-optimizer attack surface
 * (GHSA-2464-fhr4-w9xw, GHSA-2xp9-vwfh-vxw4, GHSA-q8wf-6r8g-63ch …).
 *
 * The remaining keys pre-harden any future re-enable: scoped remote patterns (no
 * wildcard hosts), no local optimisation outside build-hashed static media, a
 * single quality, SVG off, and bounded fetch size / disk cache.
 */
const supabaseHost = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
})();

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "2mb" }
  },
  images: {
    unoptimized: true,
    dangerouslyAllowSVG: false,
    contentDispositionType: "attachment",
    formats: ["image/webp"],
    qualities: [75],
    localPatterns: [],
    minimumCacheTTL: 14400,
    maximumResponseBody: 5_000_000,
    maximumDiskCacheSize: 500_000_000,
    remotePatterns: [
      { protocol: "https", hostname: "cdn.salla.sa", port: "", pathname: "/**", search: "" },
      ...(supabaseHost
        ? [{ protocol: "https", hostname: supabaseHost, port: "", pathname: "/storage/v1/object/public/**", search: "" }]
        : [])
    ]
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
        ]
      }
    ];
  }
};
export default nextConfig;
