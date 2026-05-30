"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LogoFull } from "@/components/ui/logo";
import { LogOut, ArrowLeft, Menu, X } from "lucide-react";
import { ADMIN_NAV, isAdminNavActive } from "@/lib/navigation/admin-nav";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { fadeTransition, slideTransition } from "@/lib/motion/transitions";

export function AdminSidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const reducedMotion = useReducedMotion();

  const sidebarContent = (
    <aside className="w-60 h-full bg-paper/75 backdrop-blur-md border-r border-rule/60 flex flex-col z-30">
      <div className="px-6 py-5 border-b border-rule/50">
        <Link href="/admin" className="transition-opacity hover:opacity-90">
          <LogoFull />
        </Link>
        <p className="text-[9px] font-mono uppercase tracking-widest text-accent-warm font-bold mt-2">Platform admin</p>
      </div>
      <nav className="flex-1 px-3 py-5 space-y-1">
        {ADMIN_NAV.map((item) => {
          const Icon = item.icon;
          const active = isAdminNavActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setIsOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 relative select-none",
                active
                  ? "bg-accent-warm/15 text-accent-warm border border-accent-warm/20 shadow-[0_2px_12px_rgba(184,92,56,0.06)]"
                  : "text-ink-soft hover:bg-paper-deep/50 hover:text-ink border border-transparent"
              )}
            >
              <Icon size={16} className={cn(active ? "stroke-[2.5px] text-accent-warm" : "text-ink-mute stroke-[2px]")} />
              <span>{item.label}</span>
              {active && (
                <div className="absolute left-0 top-1/4 bottom-1/4 w-[3px] bg-accent-warm rounded-r-full" />
              )}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-rule/50 space-y-1.5 bg-paper-deep/15">
        <Link
          href="/dashboard"
          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl text-ink-soft hover:text-accent hover:bg-accent/5 border border-transparent hover:border-accent/10 transition-all duration-300 select-none"
        >
          <ArrowLeft size={16} className="text-ink-mute" />
          <span>Merchant console</span>
        </Link>
        <form action="/api/auth/logout" method="post">
          <button className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl text-ink-soft hover:text-accent-warm hover:bg-accent-warm/5 border border-transparent hover:border-accent-warm/10 transition-all duration-300 select-none">
            <LogOut size={16} className="text-ink-mute" />
            <span>Log out</span>
          </button>
        </form>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop Sidebar (Persistent) */}
      <div className="hidden lg:flex h-screen sticky top-0 shrink-0">
        {sidebarContent}
      </div>

      {/* Mobile Header and Drawer Navigation */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-paper/85 backdrop-blur-lg border-b border-rule/50 flex items-center justify-between px-6 z-40 shadow-sm">
        <div className="flex items-center gap-2">
          <Link href="/admin"><LogoFull /></Link>
          <Badge tone="warn" className="text-[8px] tracking-wider py-0 px-1.5">Admin</Badge>
        </div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          type="button"
          aria-label={isOpen ? "Close admin menu" : "Open admin menu"}
          className="p-2 rounded-xl border border-rule/65 hover:bg-paper-deep active:scale-95 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {isOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile Drawer Slide-over */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={reducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reducedMotion ? undefined : { opacity: 0 }}
              transition={fadeTransition(reducedMotion)}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-ink/35 backdrop-blur-sm z-40 lg:hidden"
            />

            {/* Sidebar Slide-over */}
            <motion.div
              initial={reducedMotion ? false : { x: "-100%" }}
              animate={{ x: 0 }}
              exit={reducedMotion ? undefined : { x: "-100%" }}
              transition={slideTransition(reducedMotion)}
              className="fixed top-0 bottom-0 left-0 w-64 z-50 lg:hidden h-full shadow-[8px_0_30px_rgba(20,17,15,0.15)]"
            >
              {sidebarContent}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Spacer to prevent overlap by fixed mobile header */}
      <div className="h-16 lg:hidden" />
    </>
  );
}

// Minimal Badge helper to keep import self-contained or use custom styles
function Badge({ children, tone, className }: { children: React.ReactNode; tone?: string; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center px-1.5 py-0.5 text-[9px] font-mono font-bold tracking-widest uppercase rounded",
      tone === "warn" ? "bg-accent-warm/15 text-accent-warm-deep" : "bg-paper-deep text-ink-soft",
      className
    )}>
      {children}
    </span>
  );
}
