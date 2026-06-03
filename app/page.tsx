import { HomeLanding } from "@/components/marketing/home-landing";

type PageProps = {
  searchParams?: Promise<{
    lang?: string;
  }>;
};

export default async function Page(props: PageProps) {
  const searchParams = await props.searchParams;
  return <HomeLanding initialLang={searchParams?.lang === "ar" ? "ar" : "en"} />;
}
