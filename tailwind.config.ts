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
        paper: "var(--paper)",
        "paper-deep": "var(--paper-deep)",
        "paper-elevated": "var(--paper-elevated)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        "ink-mute": "var(--ink-mute)",
        rule: "var(--rule)",
        "rule-light": "var(--rule-light)",
        accent: "var(--accent)",
        "accent-deep": "var(--accent-deep)",
        "accent-light": "var(--accent-light)",
        "accent-warm": "var(--accent-warm)",
        "accent-warm-deep": "var(--accent-warm-deep)",
        "accent-warm-light": "var(--accent-warm-light)",
        success: "var(--success)",
        danger: "var(--danger)",
        // Glass surface tokens
        surface: {
          DEFAULT: "var(--surface-glass)",
          hover: "rgba(245, 239, 230, 0.80)",
          active: "rgba(245, 239, 230, 0.92)",
          inverse: "var(--surface-inverse)",
        },
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
      },
      backdropBlur: {
        xs: "4px",
        glass: "12px",
        heavy: "24px",
      },
      boxShadow: {
        "glass-sm": "0 1px 3px rgba(20, 17, 15, 0.04), 0 1px 2px rgba(20, 17, 15, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.2)",
        "glass-md": "0 4px 16px rgba(20, 17, 15, 0.05), 0 2px 4px rgba(20, 17, 15, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
        "glass-lg": "0 8px 32px rgba(20, 17, 15, 0.06), 0 4px 8px rgba(20, 17, 15, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.3)",
        "glass-xl": "0 16px 48px rgba(20, 17, 15, 0.08), 0 8px 16px rgba(20, 17, 15, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.35)",
        "elevated": "0 2px 12px rgba(20, 17, 15, 0.06), 0 1px 3px rgba(20, 17, 15, 0.04)",
        "inner-glow": "inset 0 1px 0 rgba(255, 255, 255, 0.4)",
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease-out",
        "fade-slide-up": "fadeSlideUp 0.5s cubic-bezier(0.2, 0.7, 0.2, 1)",
        "scale-in": "scaleIn 0.3s cubic-bezier(0.2, 0.7, 0.2, 1)",
        "slide-in-right": "slideInRight 0.4s cubic-bezier(0.2, 0.7, 0.2, 1)",
        "slide-in-left": "slideInLeft 0.4s cubic-bezier(0.2, 0.7, 0.2, 1)",
        "slide-up": "slideUp 0.4s cubic-bezier(0.2, 0.7, 0.2, 1)",
        "shimmer": "shimmer 2s infinite",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
        "float": "float 3s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        fadeSlideUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        scaleIn: {
          "0%": { opacity: "0", transform: "scale(0.92)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        slideInRight: {
          "0%": { opacity: "0", transform: "translateX(100%)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        slideInLeft: {
          "0%": { opacity: "0", transform: "translateX(-100%)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(100%)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
      transitionTimingFunction: {
        "spring": "cubic-bezier(0.2, 0.7, 0.2, 1)",
      },
    }
  },
  plugins: []
};
export default config;