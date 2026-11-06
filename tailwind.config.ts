import type { Config } from "tailwindcss";

/**
 * Theme colours are CSS variables (globals.css swaps them for dark mode), so Tailwind cannot
 * parse them to add an alpha channel. A plain `var(--paper)` made Tailwind 3 silently drop
 * every opacity-modified utility (`bg-paper/78`, `border-rule/50`, `bg-ink/[0.06]` …): the
 * mobile nav, More sheet, panels and backdrops rendered with no background at all.
 *
 * The `<alpha-value>` placeholder turns each token into a colour function: `bg-paper` compiles
 * to `calc(var(--tw-bg-opacity, 1) * 100%)`, `bg-paper/78` to `calc(0.78 * 100%)` and
 * `bg-ink/[0.06]` to `calc(0.06 * 100%)` of the variable, mixed with transparent (globals.css
 * already relies on color-mix() throughout). __tests__/mobile/tailwind-alpha.test.ts compiles
 * every `<colour>/<alpha>` class used in the repo against this config.
 */
const themeColor = (cssVar: `--${string}`) =>
  `color-mix(in srgb, var(${cssVar}) calc(<alpha-value> * 100%), transparent)`;

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  future: {
    // `hover:` (and `group-hover:` / `peer-hover:`) only apply on devices that can really
    // hover, so styles no longer stick after a tap on phones and tablets (HOVER-01).
    hoverOnlyWhenSupported: true
  },
  theme: {
    extend: {
      colors: {
        paper: themeColor("--paper"),
        "paper-deep": themeColor("--paper-deep"),
        "paper-elevated": themeColor("--paper-elevated"),
        ink: themeColor("--ink"),
        "ink-soft": themeColor("--ink-soft"),
        "ink-mute": themeColor("--ink-mute"),
        rule: themeColor("--rule"),
        "rule-light": themeColor("--rule-light"),
        accent: themeColor("--accent"),
        "accent-deep": themeColor("--accent-deep"),
        "accent-light": themeColor("--accent-light"),
        "accent-warm": themeColor("--accent-warm"),
        "accent-warm-deep": themeColor("--accent-warm-deep"),
        "accent-warm-light": themeColor("--accent-warm-light"),
        success: themeColor("--success"),
        danger: themeColor("--danger"),
        // Glass surface tokens
        surface: {
          DEFAULT: themeColor("--surface-glass"),
          hover: "rgba(245, 239, 230, 0.80)",
          active: "rgba(245, 239, 230, 0.92)",
          inverse: themeColor("--surface-inverse"),
        },
      },
      // Steps used by the codebase on top of Tailwind's default 0/5/10…/95/100 scale. A modifier
      // outside the scale (`bg-paper/73`) compiles to nothing, so the alpha test fails on it.
      opacity: {
        6: "0.06",
        8: "0.08",
        12: "0.12",
        42: "0.42",
        62: "0.62",
        68: "0.68",
        78: "0.78",
        86: "0.86",
        88: "0.88",
        98: "0.98"
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