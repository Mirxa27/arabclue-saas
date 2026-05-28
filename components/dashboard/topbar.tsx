import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import type { Merchant } from "@/lib/types/database";

export function Topbar({ merchant, title }: { merchant: Merchant | null; title: string }) {
  return (
    <header className="h-14 border-b border-rule px-8 flex items-center justify-between bg-paper">
      <div className="flex items-baseline gap-3">
        <h1 className="font-display text-xl tracking-crisp">{title}</h1>
        {merchant?.plan && <Badge tone={merchant.plan === "pro" ? "info" : "default"}>{merchant.plan}</Badge>}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-ink-mute">{merchant?.store_url ?? "—"}</span>
        <Button size="sm" variant="ghost" type="button">Docs</Button>
      </div>
    </header>
  );
}
