import { LogoFull } from "@/components/ui/logo";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-rule px-6 lg:px-10 h-16 flex items-center">
        <Link href="/"><LogoFull /></Link>
      </header>
      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </main>
  );
}
