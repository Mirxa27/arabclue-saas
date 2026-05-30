"use client";

/**
 * Shown when the root layout fails. Uses inline styles so a broken CSS bundle
 * still renders readable UI (avoids Next FOUC `body{display:none}` black screen).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          fontFamily: "system-ui, sans-serif",
          background: "#F5EFE6",
          color: "#14110F",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>Something went wrong</h1>
          <p style={{ fontSize: "0.9rem", opacity: 0.75, marginBottom: "1.5rem" }}>
            {error.message || "The app hit an unexpected error. Try refreshing."}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "0.65rem 1.25rem",
              borderRadius: "0.75rem",
              border: "1px solid #D9CFC0",
              background: "#0F4D3E",
              color: "#F5EFE6",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
