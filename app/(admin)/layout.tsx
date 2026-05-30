import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { requirePlatformAdmin } from "@/lib/auth/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();
  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-paper">
      <AdminSidebar />
      <main className="flex-1 flex flex-col min-w-0 pb-16 lg:pb-0">{children}</main>
    </div>
  );
}
