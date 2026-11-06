import { HomeLanding } from "@/components/marketing/home-landing";
import { LegacyLinkNotice } from "@/components/auth/legacy-link-notice";

type PageProps = {
  searchParams?: Promise<{
    lang?: string;
  }>;
};

export default async function Page(props: PageProps) {
  const searchParams = await props.searchParams;
  return (
    <>
      {/* GoTrue falls back to the Site URL (/#access_token=… from pre-PKCE links, /#error=…):
          the fragment is stripped and never used; the visitor is asked for a new link. */}
      <LegacyLinkNotice />
      <HomeLanding initialLang={searchParams?.lang === "ar" ? "ar" : "en"} />
    </>
  );
}
