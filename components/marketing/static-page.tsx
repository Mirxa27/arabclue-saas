import type { ReactNode } from "react";
import Link from "next/link";
import { LogoFull } from "@/components/ui/logo";

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export function StaticMarketingPage({ title, subtitle, children }: Props) {
  return (
    <main className="min-h-screen bg-paper">
      <header className="border-b border-rule px-6 lg:px-10 h-16 flex items-center justify-between">
        <Link href="/">
          <LogoFull />
        </Link>
        <Link href="/login" className="text-sm hover:text-accent">
          Sign in
        </Link>
      </header>
      <article className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="font-display text-4xl tracking-crisp mb-2">{title}</h1>
        {subtitle && <p className="text-sm text-ink-mute mb-10">{subtitle}</p>}
        <section className="space-y-6 text-sm leading-relaxed text-ink-soft">{children}</section>
      </article>
    </main>
  );
}
