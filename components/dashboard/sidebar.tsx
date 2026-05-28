"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LogoFull } from "@/components/ui/logo";
import {
  LayoutDashboard,
  FileText,
  Calendar,
  Sparkles,
  Plug,
  Settings,
  Phone,
  Search,
  LogOut,
  CreditCard
} from "lucide-react";

const nav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/invoices", label: "ZATCA Invoices", icon: FileText },
  { href: "/social", label: "Social Calendar", icon: Calendar },
  { href: "/voice", label: "Voice Agent", icon: Phone },
  { href: "/seo", label: "Arabic SEO", icon: Search },
  { href: "/brand", label: "Brand Kit", icon: Sparkles },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 border-r border-rule bg-paper-deep/30 flex flex-col">
      <div className="px-6 py-5 border-b border-rule">
        <Link href="/dashboard"><LogoFull /></Link>
      </div>
      <nav className="flex-1 px-3 py-5 space-y-0.5">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 text-sm transition",
                active ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep hover:text-ink"
              )}
            >
              <Icon size={15} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <form action="/api/auth/logout" method="post" className="p-3 border-t border-rule">
        <button className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-ink-soft hover:text-ink transition">
          <LogOut size={15} />
          <span>Log out</span>
        </button>
      </form>
    </aside>
  );
}
