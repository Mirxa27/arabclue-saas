import { Suspense } from "react";
import { EmployeeWorkspaceClient } from "@/components/employees/employee-workspace-client";

export const dynamic = "force-dynamic";

export default function EmployeeDetailPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink-mute">Loading workspace…</div>}>
      <EmployeeWorkspaceClient employeeId={params.id} />
    </Suspense>
  );
}
