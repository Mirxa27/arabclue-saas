import { redirect } from "next/navigation";

/** SEO alternate for Arabic marketing — renders same landing with Arabic default. */
export default function ArabicLandingRedirect() {
  redirect("/?lang=ar");
}
