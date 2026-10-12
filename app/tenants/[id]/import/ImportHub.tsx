'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AdminApiError, api } from '@/lib/api';
import {
  ACCEPT, GROUP_LABELS, STATUS_LABELS, dataRows, downloadSample, formatNumber, guessHeaderRow, headingsFrom,
  readImportFile, uploadChunks, type ImportBatch, type ImportKind, type ReadFile,
} from '@/lib/imports';

const PREVIEW_ROWS = 8;
const PREVIEW_COLUMNS = 12;

export function ImportHub({
  tenantId, tenant, kinds, batches, progress,
}: {
  tenantId: string; tenant: Record<string, string | null>; kinds: ImportKind[];
  batches: ImportBatch[]; progress: Record<string, { imported: number; batches: number }>;
}) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  const [kindKey, setKindKey] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ReadFile | null>(null);
  const [sheet, setSheet] = useState(0);
  const [header, setHeader] = useState(0);
  const [skipTotals, setSkipTotals] = useState(true);
  const [sourceSystem, setSourceSystem] = useState('');
  const [title, setTitle] = useState('');
  const [reading, setReading] = useState(false);
  const [upload, setUpload] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const kind = kinds.find((k) => k.key === kindKey);
  const grid = parsed?.sheets[sheet];
  const headings = useMemo(() => (grid ? headingsFrom(grid.cells[header] ?? []) : []), [grid, header]);
  const rows = useMemo(() => (grid ? dataRows(grid.cells, header, skipTotals) : []), [grid, header, skipTotals]);
  const groups = (['masters', 'stock', 'balances', 'running'] as const).map((g) => ({ g, kinds: kinds.filter((k) => k.group === g) }));

  function choose(key: string) {
    setKindKey(key);
    setError(null);
    panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function take(f: File | null | undefined) {
    if (!f) return;
    setFile(f);
    setParsed(null);
    setError(null);
    setReading(true);
    try {
      const read = await readImportFile(f);
      setParsed(read);
      setSheet(0);
      setHeader(guessHeaderRow(read.sheets[0]!.cells));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be read.');
      setFile(null);
    } finally {
      setReading(false);
    }
  }

  async function start() {
    if (!kind || !file || !grid) return;
    if (!rows.length) { setError('There are no rows under the heading row.'); return; }
    setError(null);
    const chunks = uploadChunks(rows);
    setUpload({ done: 0, total: rows.length });
    let batchId: string | null = null;
    try {
      const batch = await api.post<ImportBatch>(`/platform/tenants/${tenantId}/imports`, {
        entity: kind.key, title: title.trim() || undefined, sourceName: file.name, sourceFormat: parsed?.format,
        sourceSystem: sourceSystem.trim() || undefined, sheetName: grid.name, columns: headings,
      });
      batchId = batch.id;
      let done = 0;
      for (const chunk of chunks) {
        await api.post(`/platform/tenants/${tenantId}/imports/${batch.id}/rows`, chunk);
        done += chunk.rows.length;
        setUpload({ done, total: rows.length });
      }
      router.push(`/tenants/${tenantId}/import/${batch.id}`);
    } catch (e) {
      setUpload(null);
      const message = e instanceof AdminApiError ? e.message : 'The upload stopped.';
      setError(batchId ? `${message} The rows sent so far are kept; open the import below to continue or delete it.` : message);
      router.refresh();
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Data import</h1>
          <p>
            Bring {tenant.display_name}’s records over from the software it used before — any Excel, CSV, Tally XML, JSON
            or DBF file. Every file is checked before anything is saved, and an import can be undone.
          </p>
        </div>
        <div className="row-actions">
          <Link className="btn ghost" href={`/tenants/${tenantId}`}>Back to {tenant.code}</Link>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <div className="card-head">
          <h2>What to bring over, in this order</h2>
          <span className="faint">Later files name records from earlier ones — customers before their balances, plans before members.</span>
        </div>
        <div className="imp-groups">
          {groups.map(({ g, kinds: list }) => (
            <div key={g} className="imp-group">
              <h3>{GROUP_LABELS[g]}</h3>
              {list.map((k) => {
                const p = progress[k.key];
                return (
                  <div key={k.key} className={`imp-kind${kindKey === k.key ? ' selected' : ''}`}>
                    <div>
                      <strong>{k.label}</strong>
                      {p?.imported ? <span className="chip"><b>{formatNumber(p.imported, 0)}</b> in</span> : null}
                      {k.posts && <span className="pill off" title="Posts opening entries to the books">Books</span>}
                      <div className="faint">{k.description}</div>
                    </div>
                    <button className="btn ghost sm" onClick={() => choose(k.key)}>Import</button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="card" ref={panel}>
        <div className="card-head">
          <h2>New import</h2>
          {kind && <button className="btn ghost sm" onClick={() => downloadSample(kind)}>Download sample</button>}
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="kind">What the file holds<span className="req">*</span></label>
            <select id="kind" value={kindKey} onChange={(e) => setKindKey(e.target.value)}>
              <option value="">Choose…</option>
              {groups.map(({ g, kinds: list }) => (
                <optgroup key={g} label={GROUP_LABELS[g]}>
                  {list.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="source">Old software<span className="hint">For the record: Tally, Omunim, an in-house system…</span></label>
            <input id="source" value={sourceSystem} onChange={(e) => setSourceSystem(e.target.value)} placeholder="Optional" />
          </div>
          <div className="field">
            <label htmlFor="title">Name for this import<span className="hint">Defaults to the kind and the file name.</span></label>
            <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        {kind && <p className="faint" style={{ margin: '10px 0 0' }}>{kind.description}</p>}

        <label
          className={`imp-drop${dragging ? ' over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); void take(e.dataTransfer.files[0]); }}
        >
          <input type="file" accept={ACCEPT} onChange={(e) => void take(e.target.files?.[0])} />
          {reading ? <><span className="spinner" /> Reading {file?.name}…</>
            : file ? <><strong>{file.name}</strong> · {formatNumber(file.size / 1024, 0)} KB · choose another file to replace it</>
              : <>Drop the file here, or click to choose it<span className="faint">Excel · CSV · Tally XML · JSON · DBF · ODS · HTML</span></>}
        </label>

        {parsed && grid && (
          <>
            <div className="form-grid" style={{ marginTop: 14 }}>
              {parsed.sheets.length > 1 && (
                <div className="field">
                  <label htmlFor="sheet">Sheet</label>
                  <select id="sheet" value={sheet} onChange={(e) => { const i = Number(e.target.value); setSheet(i); setHeader(guessHeaderRow(parsed.sheets[i]!.cells)); }}>
                    {parsed.sheets.map((s, i) => <option key={s.name + i} value={i}>{s.name} ({formatNumber(s.cells.length, 0)} lines)</option>)}
                  </select>
                </div>
              )}
              <div className="field">
                <label htmlFor="header">Headings are on line<span className="hint">Titles above the headings are skipped.</span></label>
                <input id="header" type="number" min={1} max={grid.cells.length} value={header + 1}
                  onChange={(e) => setHeader(Math.max(0, Math.min(grid.cells.length - 1, (Number(e.target.value) || 1) - 1)))} />
              </div>
              <div className="field" style={{ justifyContent: 'flex-end' }}>
                <label className="sub-item">
                  <input type="checkbox" checked={skipTotals} onChange={(e) => setSkipTotals(e.target.checked)} />
                  Leave out “Total” lines
                </label>
              </div>
            </div>

            <p className="muted" style={{ margin: '12px 0 8px' }}>
              <strong>{formatNumber(rows.length, 0)}</strong> rows under <strong>{headings.length}</strong> headings.
              {headings.length > PREVIEW_COLUMNS && <span className="faint"> Showing the first {PREVIEW_COLUMNS} columns.</span>}
            </p>
            <div className="table-wrap imp-preview">
              <table>
                <thead><tr><th>Line</th>{headings.slice(0, PREVIEW_COLUMNS).map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.slice(0, PREVIEW_ROWS).map((r) => (
                    <tr key={r.fileRow}>
                      <td className="faint num">{r.fileRow}</td>
                      {headings.slice(0, PREVIEW_COLUMNS).map((h) => <td key={h}>{r.values[h] ?? ''}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {upload ? (
              <div style={{ marginTop: 14 }}>
                <div className="progress"><span style={{ width: `${Math.max(3, (upload.done / upload.total) * 100)}%` }} /></div>
                <p className="muted" style={{ margin: '8px 0 0' }}><span className="spinner" /> Sending rows: {formatNumber(upload.done, 0)} of {formatNumber(upload.total, 0)}…</p>
              </div>
            ) : (
              <div className="row-actions" style={{ marginTop: 14 }}>
                <button className="btn gold" onClick={start} disabled={!kind || !rows.length}>
                  {kind ? `Upload ${formatNumber(rows.length, 0)} rows as ${kind.label}` : 'Choose what the file holds'}
                </button>
                <span className="faint" style={{ alignSelf: 'center' }}>Nothing is saved to the business until you check and import it on the next screen.</span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h2>Imports</h2><span className="faint">{batches.length} so far</span></div>
        {batches.length === 0 ? <div className="empty">Nothing imported for this business yet.</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Import</th><th>Kind</th><th>Rows</th><th>Status</th><th>In / refused</th><th>When</th><th>By</th></tr></thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td><Link href={`/tenants/${tenantId}/import/${b.id}`}>{b.title}</Link>
                      {b.source_system && <div className="faint">from {b.source_system}</div>}</td>
                    <td className="muted">{kinds.find((k) => k.key === b.entity)?.label ?? b.entity}</td>
                    <td className="num">{formatNumber(b.row_count, 0)}</td>
                    <td><span className={`pill st-${b.status}`}>{b.running ? STATUS_LABELS[b.status] + '…' : b.interrupted ? 'Interrupted' : STATUS_LABELS[b.status]}</span></td>
                    <td className="num">{formatNumber(b.imported_count, 0)}{b.failed_count ? <span className="imp-bad"> / {formatNumber(b.failed_count, 0)}</span> : null}</td>
                    <td className="faint">{new Date(b.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td className="faint">{b.operator_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
