import {
  LayoutDashboard,
  Receipt,
  Share2,
  Phone,
  Search,
  Palette,
  Settings,
  Users,
  CreditCard,
  Plug,
  Store,
  Bot,
  Briefcase,
} from "lucide-react";

export interface DashboardNavItem {
  href: string;
  label: string;
  shortLabel?: string;
  icon: React.ElementType;
  badge?: string;
  shortcut?: string;
  section?: string;
}

export const DASHBOARD_NAV: DashboardNavItem[] = [
  { href: "/dashboard", label: "Overview", shortLabel: "Overview", icon: LayoutDashboard, shortcut: "1" },
  { href: "/invoices", label: "Invoices", shortLabel: "Invoices", icon: Receipt, shortcut: "2" },
  { href: "/social", label: "Social", shortLabel: "Social", icon: Share2, shortcut: "3" },
  { href: "/voice", label: "Voice", shortLabel: "Voice", icon: Phone, shortcut: "4" },
  { href: "/seo", label: "SEO", shortLabel: "SEO", icon: Search, shortcut: "5" },
  { href: "/brand", label: "Brand Kit", shortLabel: "Brand Kit", icon: Palette },
  { href: "/employees", label: "Employees", shortLabel: "Employees", icon: Briefcase },
  { href: "/marketplace", label: "Marketplace", shortLabel: "Marketplace", icon: Store, badge: "New" },
  { href: "/integrations", label: "Integrations", shortLabel: "Integrations", icon: Plug },
  { href: "/billing", label: "Billing", shortLabel: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", shortLabel: "Settings", icon: Settings },
];

export const DASHBOARD_CORE_NAV: DashboardNavItem[] = [
  { href: "/dashboard", label: "Overview", shortLabel: "Overview", icon: LayoutDashboard, shortcut: "1" },
  { href: "/social", label: "Social", shortLabel: "Social", icon: Share2, shortcut: "3" },
  { href: "/voice", label: "Voice", shortLabel: "Voice", icon: Phone, shortcut: "4" },
  { href: "/seo", label: "SEO", shortLabel: "SEO", icon: Search, shortcut: "5" },
  { href: "/invoices", label: "Invoices", shortLabel: "Invoices", icon: Receipt, shortcut: "2" },
];

export const DASHBOARD_MOBILE_TABS: DashboardNavItem[] = [
  { href: "/dashboard", label: "Overview", shortLabel: "Overview", icon: LayoutDashboard },
  { href: "/social", label: "Social", shortLabel: "Social", icon: Share2 },
  { href: "/voice", label: "Voice", shortLabel: "Voice", icon: Phone },
  { href: "/seo", label: "SEO", shortLabel: "SEO", icon: Search },
];

export const DASHBOARD_MORE_NAV: DashboardNavItem[] = [
  { href: "/invoices", label: "Invoices", shortLabel: "Invoices", icon: Receipt },
  { href: "/brand", label: "Brand Kit", shortLabel: "Brand", icon: Palette },
  { href: "/employees", label: "Employees", shortLabel: "Employees", icon: Briefcase },
  { href: "/marketplace", label: "Marketplace", shortLabel: "Marketplace", icon: Store, badge: "New" },
  { href: "/integrations", label: "Integrations", shortLabel: "Integrations", icon: Plug },
  { href: "/billing", label: "Billing", shortLabel: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", shortLabel: "Settings", icon: Settings },
];

export const DASHBOARD_TOOLS_NAV: DashboardNavItem[] = [
  { href: "/brand", label: "Brand Kit", shortLabel: "Brand Kit", icon: Palette },
  { href: "/employees", label: "Employees", shortLabel: "Employees", icon: Briefcase },
  { href: "/marketplace", label: "Marketplace", shortLabel: "Marketplace", icon: Store, badge: "New" },
  { href: "/integrations", label: "Integrations", shortLabel: "Integrations", icon: Plug },
];

export const DASHBOARD_ACCOUNT_NAV: DashboardNavItem[] = [
  { href: "/billing", label: "Billing", shortLabel: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", shortLabel: "Settings", icon: Settings },
];

export const MERCHANT_PROTECTED_PREFIXES = [
  "/welcome",
  "/dashboard",
  "/invoices",
  "/social",
  "/voice",
  "/seo",
  "/brand",
  "/employees",
  "/marketplace",
  "/integrations",
  "/billing",
  "/settings",
];

/** Determines if the current pathname matches a nav item (exact or prefix). */
export function isDashboardNavActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname.startsWith(href);
}

const MERCHANT_ROUTES = new Set(MERCHANT_PROTECTED_PREFIXES);

const ADMIN_ROUTES = new Set([
  "/admin",
]);

/**
 * Returns true if `pathname` is under a merchant-protected route (requires auth).
 * Used by middleware to redirect unauthenticated users to /login.
 */
export function isMerchantProtectedPath(pathname: string): boolean {
  for (const route of MERCHANT_ROUTES) {
    if (pathname === route || pathname.startsWith(route + "/")) return true;
  }
  return false;
}

/**
 * Returns true if `pathname` is under an admin-protected route.
 * Used by middleware to reject non-admin users.
 */
export function isAdminProtectedPath(pathname: string): boolean {
  for (const route of ADMIN_ROUTES) {
    if (pathname === route || pathname.startsWith(route + "/")) return true;
  }
  return false;
}