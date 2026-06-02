import { Suspense } from "react";
import { EmployeeWorkspaceClient } from "@/components/employees/employee-workspace-client";

export const dynamic = "force-dynamic";

export default async function EmployeeDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink-mute">Loading workspace…</div>}>
      <EmployeeWorkspaceClient employeeId={params.id} />
    </Suspense>
  );
}
