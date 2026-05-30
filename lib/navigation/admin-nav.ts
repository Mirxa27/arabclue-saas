import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Settings2,
  Bot,
  Users,
  Activity,
} from "lucide-react";

export type AdminNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/config", label: "Platform config", icon: Settings2 },
  { href: "/admin/agents", label: "Agents", icon: Bot },
  { href: "/admin/merchants", label: "Merchants", icon: Users },
  { href: "/admin/events", label: "Events", icon: Activity },
];

export function isAdminNavActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}
