'use client';

/**
 * Data import, browser side: reading the shop's old files, and the shapes the
 * import API returns.
 *
 * Files are read here, in the operator's browser, never uploaded whole: Excel
 * (xlsx, xls, xlsb, xlsm), OpenDocument, CSV and other delimited text, DBF
 * (FoxPro / dBase, which much older jewellery software keeps its data in),
 * HTML tables, JSON and XML — Tally's XML exports included. Whatever the
 * format, it becomes a grid of text cells; the operator picks the sheet and
 * the heading row, and the rows go to the API in chunks.
 */

/* ------------------------------------------------------------------ shapes */

export interface ImportField {
  key: string; label: string; type: string; required: boolean; soft: boolean;
  description: string | null; example: string | null; lookup: string | null;
  options: Array<{ value: string; label: string }> | null;
}

export interface ImportOption {
  key: string; label: string; description: string;
  input: 'boolean' | 'choice' | 'date' | 'branch' | 'location' | 'text';
  choices?: string[];
}

export interface ImportKind {
  key: string; label: string; group: 'masters' | 'stock' | 'balances' | 'running'; order: number;
  description: string; posts: boolean;
  fields: ImportField[];
  requireOneOf: Array<{ fields: string[]; message: string }>;
  options: ImportOption[];
  defaults: Record<string, unknown>;
}

export interface MappingEntry { column?: string | null; constant?: string | null; unit?: string; format?: string; negate?: boolean }

export interface UnknownValue { field: string; label: string; lookup: string | null; value: string; count: number; rows: number[] }

export interface ImportBatch {
  id: string; entity: string; title: string;
  status: 'draft' | 'validating' | 'validated' | 'importing' | 'imported' | 'partial' | 'undoing' | 'undone';
  source_name: string | null; source_format: string | null; source_system: string | null; sheet_name: string | null;
  columns: string[]; mapping: Record<string, MappingEntry>; value_map: Record<string, Record<string, string>>;
  options: Record<string, unknown>;
  row_count: number; valid_count: number; invalid_count: number; warning_count: number; skipped_count: number;
  imported_count: number; failed_count: number; undone_count: number; progress: number;
  validation: { unknown: UnknownValue[]; willCreate: Record<string, number>; totals: Record<string, string> } | null;
  result: {
    notes?: string[]; stopped?: boolean; vouchers?: number; seconds?: number;
    willCreate?: Record<string, number>; totals?: Record<string, string>;
    undo?: { reason: string; keptCount: number; kept: Array<{ rowNumber: number; message: string }> };
  } | null;
  error: string | null;
  validated_at: string | null; started_at: string | null; finished_at: string | null; undone_at: string | null;
  operator_name: string | null; created_at: string; updated_at: string;
  running: boolean; stopping: boolean; interrupted: boolean;
  statusCounts?: Record<string, number>;
  sample?: Array<{ row_number: number; data: Record<string, unknown> }>;
}

export interface ImportRow {
  id: string; row_number: number; data: Record<string, unknown>;
  status: 'pending' | 'valid' | 'invalid' | 'skipped' | 'imported' | 'failed' | 'undone';
  action: 'insert' | 'update' | 'skip' | null;
  messages: Array<{ level: 'error' | 'warning'; field?: string; message: string }>;
  label: string | null; skip_requested: boolean; imported_at: string | null;
}

export const GROUP_LABELS: Record<ImportKind['group'], string> = {
  masters: 'Masters', stock: 'Opening stock', balances: 'Opening balances', running: 'Running accounts',
};

export const STATUS_LABELS: Record<ImportBatch['status'], string> = {
  draft: 'Needs checking', validating: 'Checking', validated: 'Ready to import', importing: 'Importing',
  imported: 'Imported', partial: 'Partly imported', undoing: 'Undoing', undone: 'Undone',
};

/* ------------------------------------------------------------- reading files */

export interface Grid { name: string; cells: string[][] }
export interface ReadFile { format: string; sheets: Grid[] }

export const ACCEPT = '.xlsx,.xlsm,.xlsb,.xls,.ods,.fods,.csv,.tsv,.txt,.prn,.dbf,.json,.xml,.html,.htm';

const extension = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();

/** Reads any supported file into grids of text. Throws a message the operator can act on. */
export async function readImportFile(file: File): Promise<ReadFile> {
  const ext = extension(file.name);
  if (file.size > 60 * 1024 * 1024) throw new Error('The file is over 60 MB. Split it, or export fewer columns.');
  if (ext === 'json') return { format: 'json', sheets: [jsonGrid(await file.text())] };
  if (ext === 'xml') return { format: 'xml', sheets: xmlGrids(await file.text()) };
  return spreadsheet(file, ext || 'xlsx');
}

/** Excel, OpenDocument, CSV, DBF, HTML tables — anything SheetJS reads — one grid per sheet. */
async function spreadsheet(file: File, ext: string): Promise<ReadFile> {
  const XLSX = await import('xlsx');
  // Old Windows exports and DBF files are often not UTF-8; the code pages decode them.
  const cptable = await import('xlsx/dist/cpexcel.full.mjs');
  XLSX.set_cptable(cptable);
  const data = await file.arrayBuffer();
  const book = XLSX.read(data, { type: 'array', cellDates: true, dense: true, raw: false });
  const sheets = book.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name]!, {
      header: 1, raw: false, defval: '', blankrows: true, dateNF: 'yyyy-mm-dd',
    });
    return { name, cells: rows.map((r) => (r as unknown[]).map((c) => (c === null || c === undefined ? '' : String(c).trim()))) };
  }).filter((s) => s.cells.some((r) => r.some(Boolean)));
  if (!sheets.length) throw new Error('No data was found in the file.');
  return { format: ext, sheets };
}

/** JSON: a list of records, or an object holding one (the largest list wins). Nested objects become "parent.child" columns. */
function jsonGrid(text: string): Grid {
  let data: unknown;
  try { data = JSON.parse(text.replace(/^﻿/, '')); } catch { throw new Error('The JSON file could not be read — it is not valid JSON.'); }
  const findList = (v: unknown, depth = 0): unknown[] | null => {
    if (Array.isArray(v)) return v;
    if (!v || typeof v !== 'object' || depth > 4) return null;
    const lists = Object.values(v).map((x) => findList(x, depth + 1)).filter((x): x is unknown[] => Array.isArray(x));
    return lists.sort((a, b) => b.length - a.length)[0] ?? null;
  };
  const list = findList(data);
  if (!list?.length) throw new Error('No list of records was found in the JSON file.');
  const flat = list.map((item) => flatten(item));
  return toGrid('JSON', flat);
}

function flatten(v: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (v === null || v === undefined) return out;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || x === null)) out[prefix || 'value'] = v.join(', ');
    else v.forEach((x, i) => flatten(x, `${prefix}${prefix ? '.' : ''}${i + 1}`, out));
    return out;
  }
  if (typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  out[prefix || 'value'] = String(v);
  return out;
}

function toGrid(name: string, records: Array<Record<string, string>>): Grid {
  const headings: string[] = [];
  for (const r of records) for (const k of Object.keys(r)) if (!headings.includes(k)) headings.push(k);
  return { name, cells: [headings, ...records.map((r) => headings.map((h) => r[h] ?? ''))] };
}

/**
 * XML: the element that repeats most and carries fields of its own is the
 * record (a Tally LEDGER, a STOCKITEM, a <row>). Its attributes and its plain
 * child elements become columns. One grid per kind of record found, largest first.
 */
function xmlGrids(text: string): Grid[] {
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('The XML file could not be read — it is not well-formed XML.');
  const counts = new Map<string, Element[]>();
  const walk = (el: Element) => {
    const fields = el.attributes.length + [...el.children].filter((c) => c.children.length === 0).length;
    if (fields >= 2) counts.set(el.tagName, [...(counts.get(el.tagName) ?? []), el]);
    for (const c of el.children) walk(c);
  };
  walk(doc.documentElement);
  const candidates = [...counts].filter(([, els]) => els.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 6);
  if (!candidates.length) throw new Error('No repeating records were found in the XML file.');
  return candidates.map(([tag, els]) => toGrid(tag, els.map((el) => {
    const r: Record<string, string> = {};
    for (const a of el.attributes) r[a.name] = a.value;
    for (const c of el.children) {
      if (c.children.length === 0) r[c.tagName] = (r[c.tagName] ? `${r[c.tagName]}, ` : '') + (c.textContent ?? '').trim();
      else if (c.children.length === 1 && c.children[0]!.children.length === 0) r[c.tagName] = (c.children[0]!.textContent ?? '').trim();
    }
    return r;
  })));
}

/** The row most likely to hold the headings: the first well-filled, mostly-text row near the top. */
export function guessHeaderRow(cells: string[][]): number {
  const top = cells.slice(0, 25);
  const widest = Math.max(1, ...top.map((r) => r.filter(Boolean).length));
  const index = top.findIndex((r) => {
    const filled = r.filter(Boolean);
    const texty = filled.filter((c) => !/^[-+]?[\d,.\s₹]+$/.test(c));
    return filled.length >= Math.max(2, Math.ceil(widest * 0.6)) && texty.length >= filled.length * 0.7;
  });
  return Math.max(0, index);
}

/** Headings made usable: blanks named by their column, repeats numbered. */
export function headingsFrom(row: string[]): string[] {
  const seen = new Map<string, number>();
  return row.map((h, i) => {
    let name = h.replace(/\s+/g, ' ').trim() || `Column ${columnLetter(i)}`;
    const n = (seen.get(name.toLowerCase()) ?? 0) + 1;
    seen.set(name.toLowerCase(), n);
    if (n > 1) name = `${name} (${n})`;
    return name;
  });
}

export function columnLetter(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const TOTAL_ROW = /^(grand\s+)?(total|sub\s*total|totals)\b/i;

/**
 * The data under the headings, each with its row number in the file so every
 * message names a row the shop can find. Blank lines go; so do Total lines when asked.
 */
export function dataRows(cells: string[][], headerIndex: number, skipTotals: boolean): Array<{ fileRow: number; values: Record<string, string> }> {
  const headings = headingsFrom(cells[headerIndex] ?? []);
  const out: Array<{ fileRow: number; values: Record<string, string> }> = [];
  for (let i = headerIndex + 1; i < cells.length; i++) {
    const row = cells[i]!;
    if (!row.some(Boolean)) continue;
    if (skipTotals && TOTAL_ROW.test(row.find(Boolean) ?? '')) continue;
    const values: Record<string, string> = {};
    headings.forEach((h, c) => { if (row[c]) values[h] = row[c]!; });
    out.push({ fileRow: i + 1, values });
  }
  return out;
}

/**
 * Splits rows for upload: at most 1,000 a call and about 1.5 MB, and a new call
 * wherever a blank line was dropped, so each call's row numbers run on unbroken.
 */
export function uploadChunks(rows: Array<{ fileRow: number; values: Record<string, string> }>) {
  const chunks: Array<{ firstRow: number; rows: Array<Record<string, string>> }> = [];
  let current: { firstRow: number; rows: Array<Record<string, string>> } | null = null;
  let bytes = 0;
  let last = -1;
  for (const r of rows) {
    const size = JSON.stringify(r.values).length;
    if (!current || r.fileRow !== last + 1 || current.rows.length >= 1000 || bytes + size > 1_500_000) {
      current = { firstRow: r.fileRow, rows: [] };
      chunks.push(current);
      bytes = 0;
    }
    current.rows.push(r.values);
    bytes += size;
    last = r.fileRow;
  }
  return chunks;
}

/* -------------------------------------------------------------- files out */

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function downloadCsv(name: string, rows: unknown[][]) {
  // The BOM makes Excel open it as UTF-8, so ₹ and names in Indian scripts survive.
  const blob = new Blob([`﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** The sample file for a kind: required columns first, then the rest, with an example line. */
export function downloadSample(kind: ImportKind) {
  const fields = [...kind.fields.filter((f) => f.required), ...kind.fields.filter((f) => !f.required)];
  downloadCsv(`sample-${kind.key}.csv`, [
    fields.map((f) => f.label),
    fields.map((f) => f.example ?? (f.options ? f.options[0]!.label : '')),
  ]);
}

export const formatNumber = (v: string | number, digits = 3) =>
  Number(v).toLocaleString('en-IN', { maximumFractionDigits: digits });
