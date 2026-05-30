import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F5EFE6",
          borderRadius: 36,
          border: "2px solid rgba(20,17,15,0.12)"
        }}
      >
        <svg width="120" height="120" viewBox="0 0 32 32">
          <path d="M8 21.5L16 7.5L24 21.5" fill="none" stroke="#14110F" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="16" cy="23.6" r="2" fill="#0F4D3E" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
