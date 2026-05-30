import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "ghost" | "subtle" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper hover:bg-accent-deep shadow-[0_2px_10px_rgba(20,17,15,0.08)] active:bg-ink",
  ghost: "border border-ink/15 text-ink hover:border-ink/40 bg-paper/20 backdrop-blur-sm hover:bg-paper/40",
  subtle: "bg-paper-deep/60 text-ink hover:bg-paper-deep/90 border border-rule/35",
  danger: "bg-accent-warm text-paper hover:bg-accent-warm-deep shadow-[0_2px_10px_rgba(184,92,56,0.1)]",
  outline: "border border-rule/50 text-ink-mute hover:text-ink hover:border-rule/80 bg-transparent"
};

const sizes: Record<ButtonSize, string> = {
  sm: "px-4 py-2 text-xs rounded-lg gap-1.5 font-mono uppercase tracking-wider font-semibold",
  md: "px-5 py-3 text-sm rounded-xl gap-2 font-medium",
  lg: "px-7 py-4 text-base rounded-2xl gap-2.5 font-semibold"
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center tracking-crisp transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-300 disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
