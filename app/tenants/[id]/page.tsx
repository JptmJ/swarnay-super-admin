import { redirect } from 'next/navigation';
import Link from 'next/link';
import { callBackend, readSession } from '@/lib/session';
import { readOperator, shellOperator } from '@/lib/operator';
import { Shell } from '@/components/Shell';
import { TenantWorkspace } from './TenantWorkspace';
import type {
  BranchRow, ModuleRow, PermissionTreeModule, TenantRoleRow, TenantSecurity, UserRow,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Detail {
  tenant: Record<string, string | null>;
  branches: BranchRow[];
  users: UserRow[];
  modules: ModuleRow[];
  globalAdmin: UserRow | null;
}

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await readSession())) redirect('/login');
  const { id } = await params;

  const [operator, detailResult, tenantRolesResult, treeResult, securityResult] = await Promise.all([
    readOperator(),
    callBackend<Detail>(`/api/platform/tenants/${id}`),
    // This business's own roles, and the tree the staff role builder ticks.
    callBackend<{ rows: TenantRoleRow[] }>(`/api/platform/tenants/${id}/roles`),
    callBackend<{ modules: PermissionTreeModule[] }>('/api/platform/permission-tree'),
    // The vault and private entry — set only from here, never inside the shop.
    callBackend<TenantSecurity>(`/api/platform/tenants/${id}/security`),
  ]);

  if (detailResult.status === 401) redirect('/login');

  if (!detailResult.data) {
    return (
      <Shell operator={shellOperator(operator)}>
        <div className="page-head"><h1>Tenant</h1></div>
        <div className="alert error">{detailResult.error?.message ?? 'Could not load this tenant.'}</div>
        <Link className="btn ghost" href="/tenants">Back to tenants</Link>
      </Shell>
    );
  }

  return (
    <Shell operator={shellOperator(operator)}>
      <TenantWorkspace
        tenantId={id}
        detail={detailResult.data}
        tenantRoles={tenantRolesResult.data?.rows ?? []}
        permissionTree={treeResult.data?.modules ?? []}
        security={securityResult.data}
      />
    </Shell>
  );
}
