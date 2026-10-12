import { redirect } from 'next/navigation';
import Link from 'next/link';
import { callBackend, readSession } from '@/lib/session';
import { readOperator, shellOperator } from '@/lib/operator';
import { Shell } from '@/components/Shell';
import type { ImportBatch, ImportKind } from '@/lib/imports';
import { ImportHub } from './ImportHub';

export const dynamic = 'force-dynamic';

export default async function TenantImportPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await readSession())) redirect('/login');
  const { id } = await params;
  const [operator, detail, kinds, batches] = await Promise.all([
    readOperator(),
    callBackend<{ tenant: Record<string, string | null> }>(`/api/platform/tenants/${id}`),
    callBackend<{ kinds: ImportKind[] }>('/api/platform/import-kinds'),
    callBackend<{ rows: ImportBatch[]; progress: Record<string, { imported: number; batches: number }> }>(`/api/platform/tenants/${id}/imports`),
  ]);
  if (detail.status === 401) redirect('/login');
  if (!detail.data || !kinds.data) {
    return (
      <Shell operator={shellOperator(operator)}>
        <div className="page-head"><h1>Data import</h1></div>
        <div className="alert error">{detail.error?.message ?? kinds.error?.message ?? 'Could not load this business.'}</div>
        <Link className="btn ghost" href="/tenants">Back to tenants</Link>
      </Shell>
    );
  }
  return (
    <Shell operator={shellOperator(operator)}>
      <ImportHub
        tenantId={id}
        tenant={detail.data.tenant}
        kinds={kinds.data.kinds}
        batches={batches.data?.rows ?? []}
        progress={batches.data?.progress ?? {}}
      />
    </Shell>
  );
}
