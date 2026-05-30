import { AdminMerchantDetailClient } from "@/components/admin/admin-merchant-detail-client";

type Props = { params: Promise<{ id: string }> };

export default async function AdminMerchantDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <>
      <header className="border-b border-rule px-8 py-5">
        <h1 className="font-display text-2xl tracking-crisp">Merchant detail</h1>
        <p className="text-sm text-ink-soft mt-1 font-mono">{id}</p>
      </header>
      <AdminMerchantDetailClient merchantId={id} />
    </>
  );
}
