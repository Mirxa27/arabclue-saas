/** Resolve marketing CTA href for Salla install — public env or signup fallback. */
export function getSallaInstallHref(): string {
  const direct = process.env.NEXT_PUBLIC_SALLA_INSTALL_URL?.trim();
  if (direct) return direct;
  return "/signup";
}
