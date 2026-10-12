import { redirect } from 'next/navigation';
import Link from 'next/link';
import { callBackend, readSession } from '@/lib/session';
import { readOperator, shellOperator } from '@/lib/operator';
import { Shell } from '@/components/Shell';
import type { BranchRow } from '@/lib/api';
import type { ImportBatch, ImportKind } from '@/lib/imports';
import { ImportBatchView } from './ImportBatchView';

export const dynamic = 'force-dynamic';

export default async function ImportBatchPage({ params }: { params: Promise<{ id: string; batchId: string }> }) {
  if (!(await readSession())) redirect('/login');
  const { id, batchId } = await params;
  const [operator, detail, kinds, batch] = await Promise.all([
    readOperator(),
    callBackend<{ tenant: Record<string, string | null>; branches: BranchRow[] }>(`/api/platform/tenants/${id}`),
    callBackend<{ kinds: ImportKind[] }>('/api/platform/import-kinds'),
    callBackend<ImportBatch>(`/api/platform/tenants/${id}/imports/${batchId}`),
  ]);
  if (detail.status === 401) redirect('/login');
  const kind = kinds.data?.kinds.find((k) => k.key === batch.data?.entity);
  if (!detail.data || !batch.data || !kind) {
    return (
      <Shell operator={shellOperator(operator)}>
        <div className="page-head"><h1>Import</h1></div>
        <div className="alert error">{batch.error?.message ?? detail.error?.message ?? 'Could not load this import.'}</div>
        <Link className="btn ghost" href={`/tenants/${id}/import`}>Back to imports</Link>
      </Shell>
    );
  }
  return (
    <Shell operator={shellOperator(operator)}>
      <ImportBatchView tenantId={id} tenant={detail.data.tenant} branches={detail.data.branches} kind={kind} initial={batch.data} />
    </Shell>
  );
}
