import { HomeLanding } from "@/components/marketing/home-landing";

type PageProps = {
  searchParams?: {
    lang?: string;
  };
};

export default function Page({ searchParams }: PageProps) {
  return <HomeLanding initialLang={searchParams?.lang === "ar" ? "ar" : "en"} />;
}
