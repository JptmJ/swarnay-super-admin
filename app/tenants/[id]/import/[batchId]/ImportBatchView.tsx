'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AdminApiError, api, type BranchRow } from '@/lib/api';
import {
  STATUS_LABELS, downloadCsv, downloadSample, formatNumber,
  type ImportBatch, type ImportField, type ImportKind, type ImportRow, type MappingEntry, type UnknownValue,
} from '@/lib/imports';

type Mapping = Record<string, MappingEntry>;
const CONSTANT = '__constant';
const LOCKED = new Set(['importing', 'imported', 'partial', 'undoing', 'undone']);
const UNITS = [['g', 'grams'], ['kg', 'kilograms'], ['mg', 'milligrams'], ['tola', 'tola'], ['ct', 'carats']] as const;
const DATE_ORDERS = [['DMY', 'Day first (31/03/2026)'], ['MDY', 'Month first (03/31/2026)'], ['YMD', 'Year first (2026-03-31)']] as const;

/** The same squeeze the server applies, so a matched value is found again. */
const normKey = (v: unknown) => String(v ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const TOTAL_LABELS: Record<string, [string, 'g' | '₹' | '']> = {
  pieces: ['Pieces', ''], gross_weight: ['Gross weight', 'g'], net_weight: ['Net weight', 'g'], fine_weight: ['Fine weight', 'g'],
  cost_value: ['Cost', '₹'], debit: ['Debit total', '₹'], credit: ['Credit total', '₹'], they_owe_fine: ['Owed to the shop (fine)', 'g'],
  shop_owes_fine: ['Owed by the shop (fine)', 'g'], metal_with_karigars_fine: ['With karigars (fine)', 'g'], wages_owed: ['Wages owed', '₹'],
  members: ['Members', ''], amount_paid: ['Paid in so far', '₹'], grams_saved: ['Grams saved', 'g'], loans: ['Loans', ''],
  principal: ['Principal out', '₹'], interest_due: ['Interest due', '₹'],
};
const CREATE_LABELS: Record<string, string> = {
  item: 'items', category: 'categories', customer: 'customers', supplier: 'suppliers', karigar: 'karigars', ledger: 'ledgers',
};

const showTotal = (key: string, value: string) => {
  const [label, unit] = TOTAL_LABELS[key] ?? [key.replace(/_/g, ' '), ''];
  const n = Number(value);
  return { label, text: unit === '₹' ? `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : unit === 'g' ? `${formatNumber(n, 3)} g` : formatNumber(n, 0) };
};

export function ImportBatchView({
  tenantId, tenant, branches, kind, initial,
}: {
  tenantId: string; tenant: Record<string, string | null>; branches: BranchRow[]; kind: ImportKind; initial: ImportBatch;
}) {
  const router = useRouter();
  const [batch, setBatch] = useState<ImportBatch>(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowsVersion, setRowsVersion] = useState(0);
  const base = `/platform/tenants/${tenantId}/imports/${batch.id}`;
  const locked = batch.imported_count > 0 || LOCKED.has(batch.status);

  const reload = useCallback(async () => {
    const next = await api.get<ImportBatch>(base);
    setBatch(next);
    setRowsVersion((v) => v + 1);
    return next;
  }, [base]);

  /* Poll while a job runs; one request at a time. */
  useEffect(() => {
    if (!batch.running) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.get<ImportBatch>(base);
        if (!alive) return;
        setBatch(next);
        if (!next.running) { setRowsVersion((v) => v + 1); router.refresh(); return; }
      } catch (e) {
        if (alive) setError(e instanceof AdminApiError ? e.message : 'Cannot reach the server. Still trying…');
      }
      if (alive) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 1200);
    return () => { alive = false; clearTimeout(timer); };
  }, [batch.running, base, router]);

  async function act(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
      if (done) setNotice(done);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const check = () => act(() => api.post(`${base}/validate`));

  const progressTotal = batch.status === 'importing' ? batch.valid_count + batch.imported_count + batch.failed_count
    : batch.status === 'undoing' ? batch.imported_count || batch.row_count : batch.row_count;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{batch.title}</h1>
          <p>
            {kind.label} · {tenant.display_name} · <span className={`pill st-${batch.status}`}>{batch.interrupted ? 'Interrupted' : STATUS_LABELS[batch.status]}</span>
            {batch.source_name && <> · <span className="mono faint">{batch.source_name}</span></>}
            {batch.source_system && <> · from {batch.source_system}</>}
          </p>
        </div>
        <div className="row-actions">
          <button className="btn ghost sm" onClick={() => downloadSample(kind)}>Download sample</button>
          <Link className="btn ghost sm" href={`/tenants/${tenantId}/import`}>All imports</Link>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}
      {batch.error && !batch.running && <div className="alert error">The last run stopped: {batch.error}</div>}

      {(batch.running || batch.interrupted) && (
        <div className="card">
          <div className="card-head">
            <h2>{batch.status === 'validating' ? 'Checking rows' : batch.status === 'importing' ? 'Importing' : 'Undoing'}</h2>
            {batch.running && batch.status === 'importing' && (
              <button className="btn ghost sm" disabled={batch.stopping} onClick={() => act(() => api.post(`${base}/stop`))}>
                {batch.stopping ? 'Stopping after this chunk…' : 'Stop after this chunk'}
              </button>
            )}
          </div>
          <div className="progress"><span style={{ width: `${Math.max(3, Math.min(100, (batch.progress / Math.max(1, progressTotal)) * 100))}%` }} /></div>
          {batch.running ? (
            <p className="muted" style={{ margin: '8px 0 0' }}><span className="spinner" /> {formatNumber(batch.progress, 0)} of {formatNumber(progressTotal, 0)} rows. You can leave this page; the work carries on.</p>
          ) : (
            <div className="alert info" style={{ margin: '12px 0 0' }}>
              The server restarted while this was running. Everything marked done is safely in; start it again to carry on from where it got to.
              <div className="row-actions" style={{ marginTop: 8 }}>
                {batch.status === 'validating' && <button className="btn primary sm" disabled={busy} onClick={check}>Check again</button>}
                {batch.status === 'importing' && <button className="btn primary sm" disabled={busy} onClick={() => act(() => api.post(`${base}/import`, { leaveOutInvalid: true }))}>Carry on importing</button>}
                {batch.status === 'undoing' && <button className="btn danger sm" disabled={busy} onClick={() => act(() => api.post(`${base}/undo`, { reason: batch.result?.undo?.reason ?? 'Carrying on an interrupted undo' }))}>Carry on undoing</button>}
              </div>
            </div>
          )}
        </div>
      )}

      <MappingCard batch={batch} kind={kind} branches={branches} tenantId={tenantId} locked={locked || batch.running} busy={busy}
        onSave={(body) => act(async () => { await api.patch(base, body); await api.post(`${base}/validate`); })} />

      {batch.validated_at && !batch.running && batch.status !== 'draft' && (
        <ReviewCard batch={batch} kind={kind} tenantId={tenantId} locked={locked} busy={busy}
          onMatch={(valueMap) => act(async () => { await api.patch(base, { valueMap }); await api.post(`${base}/validate`); })} />
      )}
      {batch.status === 'draft' && batch.validated_at && !batch.running && (
        <div className="alert info">The matching, an option or a row changed since the last check. <button className="btn primary sm" disabled={busy} onClick={check}>Check again</button></div>
      )}

      <RowsCard base={base} batch={batch} version={rowsVersion} onChanged={reload} />

      {!batch.running && ['validated', 'partial'].includes(batch.status) && batch.valid_count > 0 && (
        <ImportCard batch={batch} kind={kind} busy={busy} onImport={(leaveOutInvalid) => act(() => api.post(`${base}/import`, { leaveOutInvalid }))} />
      )}

      {batch.result && batch.finished_at && <ResultCard batch={batch} />}

      {!batch.running && batch.imported_count > 0 && ['imported', 'partial'].includes(batch.status) && (
        <UndoCard kind={kind} busy={busy} onUndo={(reason) => act(() => api.post(`${base}/undo`, { reason }), 'Undoing — the page follows its progress.')} />
      )}

      {!batch.running && batch.imported_count === 0 && ['draft', 'validated'].includes(batch.status) && (
        <div className="card">
          <h2 style={{ marginBottom: 4 }}>Delete this import</h2>
          <p className="faint" style={{ margin: '0 0 12px' }}>Nothing from it has gone in. Deleting throws away the uploaded rows.</p>
          <button className="btn danger sm" disabled={busy} onClick={async () => {
            if (!window.confirm(`Delete “${batch.title}” and its ${batch.row_count} uploaded rows?`)) return;
            try { await api.del(base); router.push(`/tenants/${tenantId}/import`); router.refresh(); }
            catch (e) { setError(e instanceof AdminApiError ? e.message : 'Something went wrong.'); }
          }}>Delete import</button>
        </div>
      )}
    </>
  );
}

/* ================================================================ matching */

function MappingCard({
  batch, kind, branches, tenantId, locked, busy, onSave,
}: {
  batch: ImportBatch; kind: ImportKind; branches: BranchRow[]; tenantId: string; locked: boolean; busy: boolean;
  onSave: (body: { mapping: Mapping; options: Record<string, unknown> }) => void;
}) {
  const [mapping, setMapping] = useState<Mapping>(batch.mapping);
  const [options, setOptions] = useState<Record<string, unknown>>(batch.options);
  const [locations, setLocations] = useState<Array<{ id: string; label: string }> | null>(null);
  const [open, setOpen] = useState(!batch.validated_at);
  useEffect(() => { setMapping(batch.mapping); setOptions(batch.options); }, [batch.mapping, batch.options]);
  useEffect(() => {
    if (!kind.options.some((o) => o.input === 'location') || locations) return;
    api.get<{ rows: Array<{ id: string; label: string }> }>(`/platform/tenants/${tenantId}/import-choices?kind=location`)
      .then((r) => setLocations(r.rows)).catch(() => setLocations([]));
  }, [kind.options, locations, tenantId]);

  const used = new Set(Object.values(mapping).map((m) => m.column).filter(Boolean));
  const unused = batch.columns.filter((c) => !used.has(c));
  const missing = kind.fields.filter((f) => f.required && !mapping[f.key]?.column && !mapping[f.key]?.constant);
  const oneOf = kind.requireOneOf.filter((r) => !r.fields.some((f) => mapping[f]?.column || mapping[f]?.constant));
  const samples = (column?: string | null) =>
    column ? (batch.sample ?? []).map((s) => String(s.data[column] ?? '')).filter(Boolean).slice(0, 3) : [];
  const set = (key: string, entry: MappingEntry | null) => setMapping((m) => {
    const next = { ...m };
    if (entry) next[key] = entry; else delete next[key];
    return next;
  });

  return (
    <div className="card">
      <div className="card-head">
        <h2>1 · Match the columns</h2>
        <div className="row-actions" style={{ alignItems: 'center' }}>
          <span className="faint">{Object.keys(mapping).length} of {kind.fields.length} fields matched · {unused.length} columns unused</span>
          <button className="btn ghost sm" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'}</button>
        </div>
      </div>
      {locked && (
        <div className="alert info">
          {batch.status === 'undone'
            ? 'This import was undone, so it is closed. To bring the file in again, start a new import from it.'
            : 'Rows from this file have gone in, so the matching and options are fixed. Single rows can still be fixed below.'}
        </div>
      )}
      {open && (
        <>
          <div className="table-wrap">
            <table className="imp-map">
              <thead><tr><th>Field</th><th>From the file</th><th>Sample</th></tr></thead>
              <tbody>
                {kind.fields.map((f) => {
                  const m = mapping[f.key];
                  const source = m?.column ?? (m?.constant !== undefined && m?.constant !== null ? CONSTANT : '');
                  return (
                    <tr key={f.key}>
                      <td>
                        <strong>{f.label}</strong>{f.required && <span className="req"> *</span>}
                        {f.description && <div className="faint">{f.description}</div>}
                      </td>
                      <td>
                        <select disabled={locked} value={source} aria-label={`Column for ${f.label}`}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) set(f.key, null);
                            else if (v === CONSTANT) set(f.key, { ...m, column: null, constant: m?.constant ?? '' });
                            else set(f.key, { ...m, column: v, constant: null });
                          }}>
                          <option value="">— not in the file —</option>
                          {batch.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                          <option value={CONSTANT}>Same value for every row…</option>
                        </select>
                        {source === CONSTANT && <FieldConstant field={f} value={m?.constant ?? ''} disabled={locked} onChange={(constant) => set(f.key, { ...m, column: null, constant })} />}
                        {f.type === 'weight' && source && (
                          <select disabled={locked} value={m?.unit ?? 'g'} onChange={(e) => set(f.key, { ...m!, unit: e.target.value })} aria-label="Unit">
                            {UNITS.map(([v, l]) => <option key={v} value={v}>in {l}</option>)}
                          </select>
                        )}
                        {f.type === 'date' && source && (
                          <select disabled={locked} value={m?.format ?? 'DMY'} onChange={(e) => set(f.key, { ...m!, format: e.target.value })} aria-label="Date order">
                            {DATE_ORDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        )}
                        {f.type === 'balance' && source && (
                          <label className="sub-item" style={{ marginTop: 6 }}>
                            <input type="checkbox" disabled={locked} checked={m?.negate ?? false} onChange={(e) => set(f.key, { ...m!, negate: e.target.checked })} />
                            Minus means Dr (Tally XML)
                          </label>
                        )}
                      </td>
                      <td className="faint imp-sample">{source === CONSTANT ? m?.constant : samples(m?.column).join(' · ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {unused.length > 0 && (
            <p className="faint" style={{ margin: '10px 0 0' }}>Not used: {unused.map((c) => <code key={c} style={{ marginRight: 6 }}>{c}</code>)}</p>
          )}

          <h3 style={{ margin: '18px 0 8px' }}>Options</h3>
          <div className="form-grid">
            {kind.options.map((o) => (
              <div className="field" key={o.key}>
                {o.input === 'boolean' ? (
                  <label className="sub-item">
                    <input type="checkbox" disabled={locked} checked={Boolean(options[o.key])} onChange={(e) => setOptions((x) => ({ ...x, [o.key]: e.target.checked }))} />
                    <span>{o.label}<span className="hint">{o.description}</span></span>
                  </label>
                ) : (
                  <>
                    <label htmlFor={`opt-${o.key}`}>{o.label}<span className="hint">{o.description}</span></label>
                    {o.input === 'choice' && (
                      <select id={`opt-${o.key}`} disabled={locked} value={String(options[o.key] ?? '')} onChange={(e) => setOptions((x) => ({ ...x, [o.key]: e.target.value || undefined }))}>
                        {o.key === 'rateBasis' && <option value="">As in Girvi settings</option>}
                        {(o.choices ?? []).map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                      </select>
                    )}
                    {o.input === 'date' && (
                      <input id={`opt-${o.key}`} type="date" disabled={locked} value={String(options[o.key] ?? '')} onChange={(e) => setOptions((x) => ({ ...x, [o.key]: e.target.value || undefined }))} />
                    )}
                    {o.input === 'branch' && (
                      <select id={`opt-${o.key}`} disabled={locked} value={String(options[o.key] ?? '')} onChange={(e) => setOptions((x) => ({ ...x, [o.key]: e.target.value || undefined }))}>
                        <option value="">Head office</option>
                        {branches.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                      </select>
                    )}
                    {o.input === 'location' && (
                      <select id={`opt-${o.key}`} disabled={locked} value={String(options[o.key] ?? '')} onChange={(e) => setOptions((x) => ({ ...x, [o.key]: e.target.value || undefined }))}>
                        <option value="">The branch’s usual place</option>
                        {(locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                      </select>
                    )}
                    {o.input === 'text' && <input id={`opt-${o.key}`} disabled={locked} value={String(options[o.key] ?? '')} onChange={(e) => setOptions((x) => ({ ...x, [o.key]: e.target.value }))} />}
                  </>
                )}
              </div>
            ))}
          </div>

          {!locked && (
            <div style={{ marginTop: 16 }}>
              {(missing.length > 0 || oneOf.length > 0) && (
                <div className="alert error">
                  {missing.length > 0 && <>Still to match: {missing.map((f) => f.label).join(', ')}. </>}
                  {oneOf.map((r) => r.message).join(' ')}
                </div>
              )}
              <button className="btn primary" disabled={busy || missing.length > 0 || oneOf.length > 0}
                onClick={() => onSave({ mapping, options: Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined && v !== '')) })}>
                {busy ? <><span className="spinner" /> Saving…</> : `Save and check ${formatNumber(batch.row_count, 0)} rows`}
              </button>
              <span className="faint" style={{ marginLeft: 10 }}>Checking saves nothing to the business.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FieldConstant({ field, value, disabled, onChange }: { field: ImportField; value: string; disabled: boolean; onChange: (v: string) => void }) {
  if (field.options) {
    return (
      <select disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} aria-label={`Value for ${field.label}`}>
        <option value="">Choose…</option>
        {field.options.map((o) => <option key={o.value} value={o.label}>{o.label}</option>)}
      </select>
    );
  }
  return <input disabled={disabled} value={value} placeholder={field.example ?? 'Value for every row'} onChange={(e) => onChange(e.target.value)} aria-label={`Value for ${field.label}`} />;
}

/* ================================================================== review */

function ReviewCard({
  batch, kind, tenantId, locked, busy, onMatch,
}: {
  batch: ImportBatch; kind: ImportKind; tenantId: string; locked: boolean; busy: boolean;
  onMatch: (valueMap: Record<string, Record<string, string>>) => void;
}) {
  const v = batch.validation;
  const tiles: Array<[string, number, string]> = [
    ['Ready', batch.valid_count, 'ok'], ['With errors', batch.invalid_count, batch.invalid_count ? 'bad' : ''],
    ['Left out', batch.skipped_count, ''], ['With warnings', batch.warning_count, batch.warning_count ? 'warn' : ''],
    ...(batch.imported_count ? [['Imported', batch.imported_count, 'ok'] as [string, number, string]] : []),
    ...(batch.failed_count ? [['Refused on import', batch.failed_count, 'bad'] as [string, number, string]] : []),
  ];
  return (
    <div className="card">
      <div className="card-head">
        <h2>2 · What the check found</h2>
        <span className="faint">Checked {batch.validated_at ? new Date(batch.validated_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}</span>
      </div>
      <div className="stats">
        {tiles.map(([label, n, tone]) => <div key={label} className={`stat imp-${tone}`}><b>{formatNumber(n, 0)}</b><span>{label}</span></div>)}
      </div>
      {v && Object.keys(v.totals).length > 0 && (
        <>
          <h3 style={{ margin: '4px 0 8px' }}>Totals of the good rows</h3>
          <p className="faint" style={{ margin: '0 0 8px' }}>Compare these with the same report in the old software before importing.</p>
          <div className="demo-keys">
            {Object.entries(v.totals).map(([k, val]) => { const t = showTotal(k, val); return <div key={k}><span>{t.label}</span><code>{t.text}</code></div>; })}
          </div>
        </>
      )}
      {v && Object.keys(v.willCreate).length > 0 && (
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Will be made on the way: {Object.entries(v.willCreate).map(([k, n]) => `${formatNumber(n, 0)} ${CREATE_LABELS[k] ?? k}`).join(', ')}.
        </p>
      )}
      {v && v.unknown.length > 0 && !locked && <UnknownValues batch={batch} kind={kind} tenantId={tenantId} busy={busy} onMatch={onMatch} />}
    </div>
  );
}

function UnknownValues({
  batch, kind, tenantId, busy, onMatch,
}: {
  batch: ImportBatch; kind: ImportKind; tenantId: string; busy: boolean;
  onMatch: (valueMap: Record<string, Record<string, string>>) => void;
}) {
  const unknown = batch.validation!.unknown;
  const [choices, setChoices] = useState<Record<string, Array<{ id: string; label: string; hint: string | null }>>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const key = (u: UnknownValue) => `${u.field}|${u.value}`;

  // Short lists are fetched once per kind; long ones (customers, items) are searched for each value.
  useEffect(() => {
    let alive = true;
    const searched = new Set(['party', 'item', 'karigar', 'category', 'account']);
    const wanted = new Map<string, string>();
    for (const u of unknown) {
      if (!u.lookup || u.lookup === 'enum') continue;
      if (searched.has(u.lookup)) wanted.set(key(u), `kind=${u.lookup}&search=${encodeURIComponent(u.value.slice(0, 40))}`);
      else wanted.set(`all:${u.lookup}`, `kind=${u.lookup}`);
    }
    void Promise.all([...wanted].map(async ([k, q]) => {
      const r = await api.get<{ rows: Array<{ id: string; label: string; hint: string | null }> }>(`/platform/tenants/${tenantId}/import-choices?${q}`).catch(() => ({ rows: [] }));
      return [k, r.rows] as const;
    })).then((list) => { if (alive) setChoices(Object.fromEntries(list)); });
    return () => { alive = false; };
  }, [unknown, tenantId]);

  const optionsFor = (u: UnknownValue) => {
    if (u.lookup === 'enum') return (kind.fields.find((f) => f.key === u.field)?.options ?? []).map((o) => ({ id: o.value, label: o.label, hint: null }));
    return choices[key(u)] ?? choices[`all:${u.lookup}`] ?? [];
  };
  const save = () => {
    const valueMap: Record<string, Record<string, string>> = JSON.parse(JSON.stringify(batch.value_map ?? {}));
    for (const u of unknown) {
      const id = picked[key(u)];
      if (!id) continue;
      valueMap[u.field] = { ...(valueMap[u.field] ?? {}), [normKey(u.value)]: id };
    }
    onMatch(valueMap);
  };

  return (
    <>
      <h3 style={{ margin: '18px 0 6px' }}>Values the check could not place</h3>
      <p className="faint" style={{ margin: '0 0 8px' }}>
        Say what each means here and check again. Every row with that value follows. Values left alone stay as errors — or, where the options allow, are made new.
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Field</th><th>In the file</th><th>Rows</th><th>Means</th></tr></thead>
          <tbody>
            {unknown.map((u) => (
              <tr key={key(u)}>
                <td className="muted">{u.label}</td>
                <td><code>{u.value}</code></td>
                <td className="faint">{u.count}{u.rows.length ? ` (row ${u.rows.join(', ')}${u.count > u.rows.length ? '…' : ''})` : ''}</td>
                <td>
                  {u.lookup ? (
                    <select value={picked[key(u)] ?? ''} onChange={(e) => setPicked((p) => ({ ...p, [key(u)]: e.target.value }))} aria-label={`What ${u.value} means`}>
                      <option value="">Leave it</option>
                      {optionsFor(u).map((c) => <option key={c.id} value={c.id}>{c.label}{c.hint ? ` · ${c.hint}` : ''}</option>)}
                    </select>
                  ) : <span className="faint">Fix in the rows below</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn primary sm" style={{ marginTop: 10 }} disabled={busy || !Object.values(picked).some(Boolean)} onClick={save}>
        Save these and check again
      </button>
    </>
  );
}

/* ==================================================================== rows */

const TABS: Array<{ key: string; label: string; query: string }> = [
  { key: 'errors', label: 'Errors', query: 'status=invalid,failed' },
  { key: 'warnings', label: 'Warnings', query: 'level=warning' },
  { key: 'ready', label: 'Ready', query: 'status=valid' },
  { key: 'imported', label: 'Imported', query: 'status=imported' },
  { key: 'skipped', label: 'Left out', query: 'status=skipped' },
  { key: 'all', label: 'All', query: '' },
];
const PAGE = 50;

function RowsCard({ base, batch, version, onChanged }: { base: string; batch: ImportBatch; version: number; onChanged: () => Promise<unknown> }) {
  const [tab, setTab] = useState(batch.invalid_count + batch.failed_count > 0 ? 'errors' : 'all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ rows: ImportRow[]; total: number } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const filter = TABS.find((t) => t.key === tab)!.query;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const q = [filter, query ? `search=${encodeURIComponent(query)}` : '', `limit=${PAGE}`, `offset=${offset}`].filter(Boolean).join('&');
    api.get<{ rows: ImportRow[]; total: number }>(`${base}/rows?${q}`)
      .then((r) => { if (alive) { setData(r); setError(null); } })
      .catch((e) => { if (alive) setError(e instanceof AdminApiError ? e.message : 'Could not load the rows.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [base, filter, query, offset, version]);

  async function exportErrors() {
    const all: ImportRow[] = [];
    for (let at = 0; ; at += 500) {
      const page = await api.get<{ rows: ImportRow[]; total: number }>(`${base}/rows?status=invalid,failed&limit=500&offset=${at}`);
      all.push(...page.rows);
      if (all.length >= page.total || !page.rows.length) break;
    }
    downloadCsv(`errors-${batch.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`, [
      ['File row', 'What is wrong', ...batch.columns],
      ...all.map((r) => [r.row_number, r.messages.filter((m) => m.level === 'error').map((m) => m.message).join(' | '), ...batch.columns.map((c) => r.data[c] ?? '')]),
    ]);
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Rows {loading && data && <span className="faint" style={{ fontSize: 12, fontWeight: 500 }}><span className="spinner" /> Updating…</span>}</h2>
        <div className="row-actions" style={{ alignItems: 'center' }}>
          <form onSubmit={(e) => { e.preventDefault(); setOffset(0); setQuery(search.trim()); }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rows…" aria-label="Search rows" style={{ width: 200, padding: '5px 10px' }} />
          </form>
          {batch.invalid_count + batch.failed_count > 0 && <button className="btn ghost sm" onClick={() => void exportErrors()}>Download rows with errors</button>}
        </div>
      </div>
      <div className="tabs" style={{ marginBottom: 10 }}>
        {TABS.map((t) => (
          <button key={t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => { setTab(t.key); setOffset(0); setEditing(null); }}>{t.label}</button>
        ))}
      </div>
      {error && <div className="alert error">{error}</div>}
      {!data ? <div className="empty"><span className="spinner" /></div> : data.rows.length === 0 ? <div className="empty">No rows here.</div> : (
        <>
          <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
            <table>
              <thead><tr><th>Row</th><th>Status</th><th>Record</th><th>Notes</th><th /></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <RowLine key={r.id} row={r} batch={batch} base={base} open={editing === r.row_number}
                    onToggle={() => setEditing((e) => (e === r.row_number ? null : r.row_number))}
                    onSaved={async () => { setEditing(null); await onChanged(); }} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="row-actions" style={{ marginTop: 10, alignItems: 'center' }}>
            <span className="faint">{offset + 1}–{offset + data.rows.length} of {formatNumber(data.total, 0)}</span>
            <button className="btn ghost sm" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))}>Previous</button>
            <button className="btn ghost sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset((o) => o + PAGE)}>Next</button>
          </div>
        </>
      )}
    </div>
  );
}

const ROW_STATUS: Record<ImportRow['status'], string> = {
  pending: 'Not checked', valid: 'Ready', invalid: 'Error', skipped: 'Left out', imported: 'Imported', failed: 'Refused', undone: 'Undone',
};

function RowLine({
  row, batch, base, open, onToggle, onSaved,
}: { row: ImportRow; batch: ImportBatch; base: string; open: boolean; onToggle: () => void; onSaved: () => Promise<void> }) {
  const [cells, setCells] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = !['imported', 'undone'].includes(row.status) && !batch.running && !['undoing', 'undone'].includes(batch.status);
  const columns = useMemo(() => batch.columns, [batch.columns]);
  useEffect(() => {
    if (open) setCells(Object.fromEntries(columns.map((c) => [c, row.data[c] === undefined || row.data[c] === null ? '' : String(row.data[c])])));
  }, [open, columns, row.data]);

  async function save(body: { data?: Record<string, string>; skip?: boolean }) {
    setSaving(true);
    setError(null);
    try { await api.patch(`${base}/rows/${row.row_number}`, body); await onSaved(); }
    catch (e) { setError(e instanceof AdminApiError ? e.message : 'Could not save the row.'); }
    finally { setSaving(false); }
  }

  const changed = Object.fromEntries(Object.entries(cells).filter(([c, v]) => v !== (row.data[c] === undefined || row.data[c] === null ? '' : String(row.data[c]))));
  return (
    <>
      <tr>
        <td className="num faint">{row.row_number}</td>
        <td><span className={`pill rs-${row.status}`}>{ROW_STATUS[row.status]}</span>{row.action === 'update' && row.status !== 'invalid' && <span className="faint"> · updates</span>}</td>
        <td>{row.label ?? <span className="faint">{Object.values(row.data).slice(0, 3).join(' · ')}</span>}</td>
        <td>
          {row.messages.length === 0 ? <span className="faint">—</span> : (
            <ul className="imp-msgs">
              {row.messages.map((m, i) => <li key={i} className={m.level === 'error' ? 'imp-bad' : 'imp-warn'}>{m.message}</li>)}
            </ul>
          )}
        </td>
        <td>{editable && <button className="btn ghost sm" onClick={onToggle}>{open ? 'Close' : 'Fix'}</button>}</td>
      </tr>
      {open && (
        <tr className="row-detail">
          <td colSpan={5}>
            {error && <div className="alert error">{error}</div>}
            <div className="form-grid imp-cells">
              {columns.map((c) => (
                <div className="field" key={c}>
                  <label htmlFor={`cell-${row.row_number}-${c}`}>{c}</label>
                  <input id={`cell-${row.row_number}-${c}`} value={cells[c] ?? ''} onChange={(e) => setCells((x) => ({ ...x, [c]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div className="row-actions" style={{ marginTop: 10 }}>
              <button className="btn primary sm" disabled={saving || !Object.keys(changed).length} onClick={() => void save({ data: changed })}>Save row</button>
              {row.skip_requested
                ? <button className="btn ghost sm" disabled={saving} onClick={() => void save({ skip: false })}>Include it again</button>
                : <button className="btn ghost sm" disabled={saving} onClick={() => void save({ skip: true })}>Leave this row out</button>}
              <span className="faint" style={{ alignSelf: 'center' }}>The file is checked again before it is imported.</span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ================================================================== import */

function ImportCard({ batch, kind, busy, onImport }: { batch: ImportBatch; kind: ImportKind; busy: boolean; onImport: (leaveOutInvalid: boolean) => void }) {
  const [leaveOut, setLeaveOut] = useState(false);
  const asOf = String(batch.options.asOf ?? '') || 'today';
  const invalid = batch.invalid_count + batch.failed_count;
  return (
    <div className="card imp-go">
      <h2 style={{ marginBottom: 6 }}>3 · Import</h2>
      <p className="muted" style={{ margin: '0 0 10px' }}>
        <strong>{formatNumber(batch.valid_count, 0)}</strong> row{batch.valid_count === 1 ? '' : 's'} ready.
        {kind.posts && <> Opening entries are posted to the books dated <strong>{asOf}</strong>, against Opening Balance Difference.</>}
        {' '}Each row is checked once more as it goes in.
      </p>
      {invalid > 0 && (
        <label className="sub-item" style={{ marginBottom: 10 }}>
          <input type="checkbox" checked={leaveOut} onChange={(e) => setLeaveOut(e.target.checked)} />
          Leave out the {formatNumber(invalid, 0)} row{invalid === 1 ? '' : 's'} with errors — they can be fixed and imported afterwards
        </label>
      )}
      <button className="btn gold" disabled={busy || (invalid > 0 && !leaveOut)} onClick={() => onImport(leaveOut)}>
        {busy ? <><span className="spinner" /> Starting…</> : `Import ${formatNumber(batch.valid_count, 0)} rows`}
      </button>
    </div>
  );
}

function ResultCard({ batch }: { batch: ImportBatch }) {
  const r = batch.result!;
  return (
    <div className="card">
      <h2 style={{ marginBottom: 8 }}>{batch.status === 'undone' ? 'Undone' : r.stopped ? 'Stopped part-way' : 'Imported'}</h2>
      <div className="chips">
        <span className="chip"><b>{formatNumber(batch.imported_count, 0)}</b> in</span>
        {batch.failed_count > 0 && <span className="chip"><b>{formatNumber(batch.failed_count, 0)}</b> refused</span>}
        {batch.undone_count > 0 && <span className="chip"><b>{formatNumber(batch.undone_count, 0)}</b> taken back out</span>}
        {r.vouchers ? <span className="chip"><b>{r.vouchers}</b> opening voucher{r.vouchers === 1 ? '' : 's'}</span> : null}
        {r.seconds !== undefined && <span className="chip">in <b>{r.seconds}</b>s</span>}
      </div>
      {(r.notes ?? []).length > 0 && <ul className="demo-list" style={{ marginTop: 10 }}>{r.notes!.map((n) => <li key={n}>{n}</li>)}</ul>}
      {batch.failed_count > 0 && batch.status !== 'undone' && (
        <p className="faint" style={{ margin: '10px 0 0' }}>Refused rows are under Errors with the reason. Fix them, check again and import — only they go in.</p>
      )}
      {r.undo && (
        <div className="alert info" style={{ margin: '12px 0 0' }}>
          Undone: “{r.undo.reason}”.
          {r.undo.keptCount > 0 && <> {r.undo.keptCount} record{r.undo.keptCount === 1 ? ' was' : 's were'} kept because they have been used since:
            <ul>{r.undo.kept.slice(0, 20).map((k) => <li key={k.rowNumber}>Row {k.rowNumber}: {k.message}</li>)}</ul></>}
        </div>
      )}
    </div>
  );
}

function UndoCard({ kind, busy, onUndo }: { kind: ImportKind; busy: boolean; onUndo: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  return (
    <div className="card">
      <h2 style={{ marginBottom: 4 }}>Undo this import</h2>
      <p className="faint" style={{ margin: '0 0 12px' }}>
        {kind.posts
          ? 'Every opening entry it posted is reversed on its own date, and what it made is cancelled with its numbers freed. All or nothing: refused if anything from it has been used since (a piece sold, a collection taken, a loan repaid).'
          : 'Records it added are removed unless something has used them since; records it changed get their old values back, except fields changed again since.'}
      </p>
      {!open ? <button className="btn danger sm" onClick={() => setOpen(true)}>Undo…</button> : (
        <div className="form-grid">
          <div className="field">
            <label htmlFor="undo-reason">Why<span className="req">*</span></label>
            <input id="undo-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong file, wrong cut-over date…" />
          </div>
          <div className="field">
            <label htmlFor="undo-typed">Type UNDO to confirm</label>
            <input id="undo-typed" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <button className="btn danger" disabled={busy || reason.trim().length < 3 || typed.trim() !== 'UNDO'} onClick={() => onUndo(reason.trim())}>Undo the import</button>
          </div>
        </div>
      )}
    </div>
  );
}
