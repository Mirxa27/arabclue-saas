import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "arabclue — your dalīl for trading in Arabia";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #F5EFE6 0%, #EDE4D6 100%)",
          color: "#14110F",
          fontFamily: "Georgia, serif"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width="48" height="48" viewBox="0 0 32 32">
            <rect x="0.5" y="0.5" width="31" height="31" rx="3.5" fill="#F5EFE6" stroke="#14110F" strokeOpacity="0.18" />
            <path d="M8 21.5L16 7.5L24 21.5" fill="none" stroke="#14110F" strokeWidth="1.8" />
            <circle cx="16" cy="23.6" r="1.5" fill="#0F4D3E" />
          </svg>
          <span style={{ fontSize: 36, letterSpacing: "-0.02em" }}>arabclue</span>
        </div>
        <div>
          <div
            style={{
              fontSize: 72,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              maxWidth: 900
            }}
          >
            Your <span style={{ color: "#0F4D3E", fontStyle: "italic" }}>dalīl</span> for trading in Arabia.
          </div>
          <p style={{ marginTop: 28, fontSize: 28, color: "#4A4540", maxWidth: 820, lineHeight: 1.4 }}>
            ZATCA invoicing · Agentic social media · Gulf-dialect voice · Arabic SEO
          </p>
        </div>
        <div style={{ fontSize: 22, color: "#0F4D3E", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Built for Saudi &amp; GCC SMBs
        </div>
      </div>
    ),
    { ...size }
  );
}
