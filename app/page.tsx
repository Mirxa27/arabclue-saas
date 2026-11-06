import { HomeLanding } from "@/components/marketing/home-landing";
import { ImplicitSessionRescue } from "@/components/auth/implicit-session-rescue";

type PageProps = {
  searchParams?: Promise<{
    lang?: string;
  }>;
};

export default async function Page(props: PageProps) {
  const searchParams = await props.searchParams;
  return (
    <>
      {/* Old implicit-flow magic links fall back to the Site URL (/#access_token=…). */}
      <ImplicitSessionRescue />
      <HomeLanding initialLang={searchParams?.lang === "ar" ? "ar" : "en"} />
    </>
  );
}
