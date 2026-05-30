import * as React from "react";
import { cn } from "@/lib/utils";

// ─── Card ──────────────────────────────────────────────
type CardVariant = "glass" | "elevated" | "flat" | "interactive";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const cardVariantStyles: Record<CardVariant, string> = {
  glass:
    "bg-paper/62 backdrop-blur-xl border border-rule/55 shadow-glass-sm",
  elevated:
    "bg-paper/86 backdrop-blur-sm border border-rule/50 shadow-elevated",
  flat:
    "bg-paper/78 border border-rule/35",
  interactive:
    "bg-paper/62 backdrop-blur-xl border border-rule/55 shadow-glass-sm cursor-pointer hover:shadow-glass-lg hover:-translate-y-0.5 hover:border-accent/25 active:scale-[0.985] transition-[border-color,box-shadow,transform,background-color] duration-300",
};

export function Card({ variant = "glass", className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "p-5 md:p-6 rounded-2xl",
        cardVariantStyles[variant],
        className
      )}
      {...props}
    />
  );
}

// ─── CardHeader ────────────────────────────────────────
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-baseline justify-between mb-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-display text-xl md:text-2xl tracking-crisp text-ink", className)} {...props} />;
}

export function CardSubtitle({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-xs md:text-sm text-ink-mute font-sans", className)} {...props} />
  );
}

// ─── GlassPanel (modals, dropdowns, sheets) ────────────
interface GlassPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  heavy?: boolean;
}

export function GlassPanel({ heavy = false, className, ...props }: GlassPanelProps) {
  return (
    <div
      className={cn(
        heavy
          ? "bg-paper/88 backdrop-blur-2xl border border-rule/55 shadow-glass-lg"
          : "bg-paper/68 backdrop-blur-xl border border-rule/50 shadow-glass-md",
        "rounded-2xl",
        className
      )}
      {...props}
    />
  );
}

// ─── Input ─────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  onClear?: () => void;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, icon, onClear, value, defaultValue, onChange, ...props }, ref) => {
    const currentValue = value ?? defaultValue ?? "";
    const hasValue = String(currentValue).length > 0;

    const handleClear = () => {
      onClear?.();
    };

    return (
      <div className="relative w-full">
        {icon && (
          <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-ink-mute">
            {icon}
          </div>
        )}
        <input
          ref={ref}
          className={cn(
            "w-full bg-paper/45 backdrop-blur-sm border border-rule/70 px-4 py-3 text-sm rounded-xl",
            "focus:outline-none focus:bg-paper/75 focus:border-accent/40 focus:ring-2 focus:ring-accent/15 transition-[background-color,border-color,box-shadow] duration-300",
            "placeholder:text-ink-mute disabled:opacity-50 disabled:cursor-not-allowed selection:bg-accent selection:text-paper",
            icon && "pl-10",
            onClear && hasValue && "pr-10",
            className
          )}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
          {...props}
        />
        {onClear && hasValue && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-ink-mute hover:text-ink transition-colors touch-target"
            aria-label="Clear input"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
          </button>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

// ─── Textarea ──────────────────────────────────────────
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full bg-paper/45 backdrop-blur-sm border border-rule/70 px-4 py-3 text-sm rounded-xl",
        "focus:outline-none focus:bg-paper/75 focus:border-accent/40 focus:ring-2 focus:ring-accent/15 transition-[background-color,border-color,box-shadow] duration-300 resize-y",
        "placeholder:text-ink-mute disabled:opacity-50 disabled:cursor-not-allowed selection:bg-accent selection:text-paper",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

// ─── Label ─────────────────────────────────────────────
export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "block text-xs font-mono tracking-widest uppercase text-ink-soft mb-2",
        className
      )}
      {...props}
    />
  );
}

// ─── Field wrapper ─────────────────────────────────────
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-ink-mute mt-1 leading-relaxed">{hint}</p>}
    </div>
  );
}

// ─── Badge ─────────────────────────────────────────────
type BadgeTone = "default" | "success" | "warn" | "danger" | "info" | "accent";

const badgeTones: Record<BadgeTone, string> = {
  default: "bg-paper-deep text-ink-soft",
  success: "bg-accent/10 text-accent-deep",
  warn: "bg-accent-warm/15 text-accent-warm-deep",
  danger: "bg-accent-warm text-paper",
  info: "bg-ink text-paper",
  accent: "bg-accent text-paper",
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
  animate?: boolean;
}

export function Badge({ tone = "default", dot, animate, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] font-mono tracking-widest uppercase rounded-md",
        badgeTones[tone],
        animate && "animate-pulse-soft",
        className
      )}
      {...props}
    >
      {dot && <span className={cn("w-1.5 h-1.5 rounded-full", tone === "success" ? "bg-accent" : tone === "danger" ? "bg-paper" : "bg-current")} />}
      {children}
    </span>
  );
}

// ─── Empty State ───────────────────────────────────────
interface EmptyProps {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

export function Empty({ title, hint, action, icon }: EmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {icon && <div className="mb-4 text-ink-mute">{icon}</div>}
      <p className="font-display text-xl md:text-2xl tracking-crisp text-ink">{title}</p>
      {hint && <p className="mt-2 text-sm text-ink-mute max-w-sm leading-relaxed">{hint}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

// ─── StatCard ──────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: string | number;
  suffix?: string;
  progress?: number; // 0–100
  progressColor?: string;
  icon?: React.ReactNode;
  trend?: { direction: "up" | "down"; label: string };
}

export function StatCard({ label, value, suffix, progress, progressColor, icon, trend }: StatCardProps) {
  return (
    <Card variant="interactive" className="flex flex-col justify-between p-5">
      <div className="flex items-start justify-between mb-3">
        <CardSubtitle className="font-mono text-[10px] uppercase tracking-wider">{label}</CardSubtitle>
        {icon && <div className="text-ink-mute">{icon}</div>}
      </div>
      <div>
        <CardTitle className="text-xl md:text-2xl font-semibold nums text-accent">
          {typeof value === "number" ? (value as number).toLocaleString("en-US") : value}
          {suffix && <span className="text-xs font-mono font-normal text-ink-mute ml-1">{suffix}</span>}
        </CardTitle>
        {progress !== undefined && (
          <div className="mt-3 h-1.5 w-full bg-rule/40 rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all duration-700 ease-out", progressColor ?? "bg-accent")}
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
        )}
        {trend && (
          <div className="flex items-center gap-1 mt-2">
            <svg
              width="12" height="12" viewBox="0 0 12 12"
              className={cn(trend.direction === "up" ? "text-accent" : "text-accent-warm")}
            >
              <path
                d={trend.direction === "up" ? "M6 2l4 4H8v4H4V6H2l4-4z" : "M6 10l4-4H8V2H4v4H2l4 4z"}
                fill="currentColor"
              />
            </svg>
            <span className="text-[10px] font-mono text-ink-mute">{trend.label}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Tabs ──────────────────────────────────────────────
interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="flex gap-1 p-1 bg-paper-deep/40 backdrop-blur-sm rounded-2xl border border-rule/30">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 touch-target",
            activeTab === tab.id
              ? "bg-paper shadow-glass-sm text-ink"
              : "text-ink-mute hover:text-ink-soft hover:bg-paper/30"
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={cn(
              "text-[10px] font-mono px-1.5 py-0.5 rounded-full",
              activeTab === tab.id ? "bg-accent/10 text-accent" : "bg-rule/50 text-ink-mute"
            )}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Dropdown Menu ─────────────────────────────────────
interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
}

export function Dropdown({ trigger, children, align = "left" }: DropdownProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen(!open)} className="cursor-pointer touch-target flex items-center">
        {trigger}
      </div>
      {open && (
        <div
          className={cn(
            "absolute top-full mt-2 min-w-[180px] bg-paper/85 backdrop-blur-xl border border-rule/50 rounded-2xl shadow-glass-lg p-1.5 z-50 animate-scale-in origin-top",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  className,
  danger,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "w-full text-left px-3 py-2.5 text-sm rounded-xl transition-all duration-200 font-medium",
        danger
          ? "text-accent-warm hover:bg-accent-warm/10"
          : "text-ink-soft hover:bg-paper-deep/50 hover:text-ink",
        className
      )}
      {...props}
    />
  );
}

// ─── Sheet / Drawer ────────────────────────────────────
interface SheetProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  title?: string;
  children: React.ReactNode;
}

export function Sheet({ open, onClose, side = "right", title, children }: SheetProps) {
  React.useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/20 backdrop-blur-xs"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        className={cn(
          "absolute top-0 bottom-0 w-full max-w-md bg-paper/90 backdrop-blur-xl border-rule/50 shadow-glass-xl overflow-y-auto",
          side === "right" ? "right-0 border-l animate-slide-in-right rounded-l-3xl" : "left-0 border-r animate-slide-in-left rounded-r-3xl",
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between p-5 bg-paper/80 backdrop-blur-md border-b border-rule/30">
          <h2 className="font-display text-xl tracking-crisp">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-paper-deep/50 transition-colors touch-target"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4.5 4.5l9 9M13.5 4.5l-9 9"/>
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Skeleton ──────────────────────────────────────────
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-rule/40 rounded-lg animate-shimmer relative overflow-hidden",
        className
      )}
      {...props}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent bg-[length:200%_100%] animate-shimmer" />
    </div>
  );
}

// ─── Tooltip ───────────────────────────────────────────
export function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  const [show, setShow] = React.useState(false);
  
  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-ink text-paper text-xs rounded-lg whitespace-nowrap z-50 animate-scale-in">
          {content}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-2 h-2 rotate-45 bg-ink" />
        </div>
      )}
    </div>
  );
}

// ─── Toast Container ───────────────────────────────────
type ToastType = "success" | "error" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

const toastContext = React.createContext<{
  addToast: (type: ToastType, message: string) => void;
}>({ addToast: () => {} });

export function useToast() {
  return React.useContext(toastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const addToast = React.useCallback((type: ToastType, message: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const toastColors: Record<ToastType, string> = {
    success: "border-accent/30 bg-accent/5",
    error: "border-accent-warm/30 bg-accent-warm/5",
    info: "border-rule bg-paper/65",
  };

  const toastIcons: Record<ToastType, string> = {
    success: "✓",
    error: "✕",
    info: "i",
  };

  return (
    <toastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "px-4 py-3 rounded-2xl border backdrop-blur-lg shadow-glass-lg animate-scale-in text-sm font-medium flex items-center gap-3",
              toastColors[toast.type]
            )}
          >
            <span className={cn(
              "flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold",
              toast.type === "success" ? "bg-accent text-paper" : toast.type === "error" ? "bg-accent-warm text-paper" : "bg-ink text-paper"
            )}>
              {toastIcons[toast.type]}
            </span>
            {toast.message}
          </div>
        ))}
      </div>
    </toastContext.Provider>
  );
}