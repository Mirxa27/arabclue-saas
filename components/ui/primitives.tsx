import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-paper border border-rule p-6 shadow-[0_1px_0_rgba(20,17,15,0.04)]",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-baseline justify-between mb-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-display text-2xl tracking-crisp", className)} {...props} />;
}

export function CardSubtitle({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-ink-soft", className)} {...props} />;
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full bg-paper border border-ink/15 px-3 py-2.5 text-sm",
        "focus:outline-none focus:border-ink/50 transition",
        "placeholder:text-ink-mute disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full bg-paper border border-ink/15 px-3 py-2.5 text-sm",
        "focus:outline-none focus:border-ink/50 transition resize-y",
        "placeholder:text-ink-mute disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("block text-xs font-mono tracking-widest uppercase text-ink-soft mb-2", className)} {...props} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-ink-mute mt-1">{hint}</p>}
    </div>
  );
}

type BadgeTone = "default" | "success" | "warn" | "danger" | "info";
const badgeTones: Record<BadgeTone, string> = {
  default: "bg-paper-deep text-ink-soft",
  success: "bg-accent/10 text-accent-deep",
  warn: "bg-accent-warm/15 text-accent-warm-deep",
  danger: "bg-accent-warm text-paper",
  info: "bg-ink text-paper"
};

export function Badge({ tone = "default", className, ...props }: { tone?: BadgeTone } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 text-[10px] font-mono tracking-widest uppercase",
        badgeTones[tone],
        className
      )}
      {...props}
    />
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="border border-dashed border-rule p-12 text-center">
      <p className="font-display text-2xl tracking-crisp">{title}</p>
      {hint && <p className="mt-2 text-sm text-ink-soft max-w-sm mx-auto">{hint}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
