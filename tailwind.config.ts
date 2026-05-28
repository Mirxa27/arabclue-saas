import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        paper: "#F5EFE6",
        "paper-deep": "#EBE3D5",
        ink: "#14110F",
        "ink-soft": "#4A413A",
        "ink-mute": "#7A6F65",
        rule: "#D9CFC0",
        accent: "#0F4D3E",
        "accent-deep": "#093028",
        "accent-warm": "#B85C38",
        "accent-warm-deep": "#8A4327"
      },
      fontFamily: {
        display: ['"Instrument Serif"', "ui-serif", "Georgia", "serif"],
        sans: ['"Instrument Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        arabic: ['"IBM Plex Sans Arabic"', '"Noto Sans Arabic"', "Tahoma", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"]
      },
      letterSpacing: {
        tightest: "-0.04em",
        crisp: "-0.015em"
      },
      maxWidth: {
        readable: "68ch"
      }
    }
  },
  plugins: []
};
export default config;
