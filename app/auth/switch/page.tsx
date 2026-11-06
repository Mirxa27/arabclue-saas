import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { safeRedirectPath, DEFAULT_AFTER_LOGIN } from "@/lib/auth/redirect";
import { isEmailOtpType } from "@/lib/auth/email-callback";
import { SwitchAccountActions } from "@/components/auth/switch-account-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Switch account — arabclue", robots: { index: false } };

/**
 * Shown when a token-hash sign-in link is opened while another account is signed in.
 * The link has NOT been used yet; the visitor chooses to stay or to sign out and use it.
 */
export default async function SwitchAccountPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const tokenHash = one(sp.token_hash).slice(0, 512);
  const type = one(sp.type);
  const next = safeRedirectPath(one(sp.next)) ?? DEFAULT_AFTER_LOGIN;

  if (!tokenHash || !isEmailOtpType(type)) redirect("/login?error=link_invalid");

  const confirmUrl = `/auth/confirm?${new URLSearchParams({ token_hash: tokenHash, type, next, switch: "1" }).toString()}`;
  const user = await getCurrentUser();
  // Nobody signed in any more (e.g. signed out in another tab): just use the link.
  if (!user) redirect(confirmUrl);

  return (
    <main className="min-h-dvh flex items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-rule bg-paper p-6 text-ink">
        <h1 className="text-lg font-semibold">Switch account? · تبديل الحساب؟</h1>
        <p className="mt-3 text-sm text-ink-mute">
          You are signed in as <strong className="text-ink">{user.email ?? "another account"}</strong>. This sign-in link
          is for an account that may be different. Only continue if you requested this link.
        </p>
        <p dir="rtl" className="ar mt-2 text-sm text-ink-mute">
          أنت مسجّل الدخول حاليًا بحساب <strong className="text-ink" dir="ltr">{user.email ?? "آخر"}</strong>. قد يكون رابط
          الدخول هذا لحساب مختلف. تابع فقط إذا كنت أنت من طلب الرابط.
        </p>
        <SwitchAccountActions continueHref={next} confirmUrl={confirmUrl} />
      </div>
    </main>
  );
}
