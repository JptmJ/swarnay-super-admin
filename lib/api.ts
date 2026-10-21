'use client';

/**
 * Browser-side API helper.
 *
 * Talks only to this app's own `/api/proxy/*`, which attaches the operator's
 * token server-side. No token ever touches client JavaScript.
 */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export class AdminApiError extends Error {
  constructor(readonly status: number, readonly error: ApiError) {
    super(error.message);
    this.name = 'AdminApiError';
  }

  /** Field-level messages from a 400, ready to attach to inputs. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.error.details)) return {};
    const out: Record<string, string> = {};
    for (const item of this.error.details as Array<{ field?: string; message?: string }>) {
      if (item.field && item.message) out[item.field] = item.message;
    }
    return out;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/proxy/${path.replace(/^\/+/, '')}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AdminApiError(
      response.status,
      (payload as { error?: ApiError })?.error ?? { code: 'unknown', message: 'Something went wrong.' },
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/* ---------------- shapes the panel uses ---------------- */

export interface TenantRow {
  id: string; code: string; display_name: string; legal_name: string;
  kind: string; status: string; gstin: string | null; created_at: string;
  branch_count: string; user_count: string; module_count: string; admin_email: string | null;
  max_branches: number | null;
  /** Made by the Demo accounts button. Only a demo can be deleted. */
  is_demo: boolean;
}

/** One sign-in inside a demo business. */
export interface DemoLogin {
  fullName: string; email: string;
  role: 'owner' | 'admin' | 'staff';
  roleName: string; branch: string;
}

/** A finished demo business, with everything needed to hand it over. */
export interface DemoAccount {
  tenantId: string; code: string; displayName: string; legalName: string; kind: string; city: string;
  /** Shared by every login in the demo. Shown only by the job, never stored readable. */
  password: string;
  branches: Array<{ code: string; name: string }>;
  roles: Array<{ name: string; permissions: string[] }>;
  logins: DemoLogin[];
  /** How many customers, pieces, invoices… were made. */
  data: Record<string, number>;
  /** Sample data that could not be made; the demo works without it. */
  warnings: string[];
  seconds: number;
}

export interface DemoJob {
  id: string; count: number;
  status: 'queued' | 'running' | 'done';
  startedAt: string; finishedAt: string | null;
  /** Which demo (1-based) is being made and what it is doing. Null once finished. */
  current: { index: number; step: string } | null;
  accounts: DemoAccount[];
  failures: Array<{ index: number; message: string }>;
  /** Asked to stop: the demo in hand was finished, the rest were not started. */
  stopped: boolean;
}

/** A seeded role template: owner or admin. */
export interface TenantRole {
  code: string; name: string; type: string; description: string;
  /** True for the roles limited to a single holder per branch. */
  isBranchAdmin: boolean;
  permissions: string[];
}

/** A role as one business actually holds it, including its own staff roles. */
export interface TenantRoleRow {
  id: string; code: string; name: string; role_type: 'owner' | 'admin' | 'staff';
  description: string | null; is_system: boolean; is_active: boolean;
  permissions: string[]; user_count: number;
}

/** What the role builder ticks: module → group → action, straight from the API. */
export interface PermissionTreeModule {
  key: string; name: string; wildcard: string;
  groups: Array<{
    key: string; name: string;
    /** Null when the group holds the module's own actions rather than a sub-area. */
    wildcard: string | null;
    permissions: Array<{ code: string; action: string; description: string }>;
  }>;
}

export interface BranchRow {
  id: string; code: string; name: string; kind: string; city: string | null;
  state: string | null; gstin: string | null; is_active: boolean; location_count: string;
  /** The one admin for this branch, if it has one yet. */
  admin_name: string | null; admin_email: string | null;
}

export interface UserRow {
  id: string; email: string; full_name: string; phone: string | null;
  is_active: boolean; last_login_at: string | null; created_at: string;
  role_code: string; role_name: string | null;
  default_branch_id: string | null; branch_name: string | null; branch_code: string | null;
}

export interface SubModuleRow {
  key: string; name: string; status: 'live' | 'planned';
  /** True when switching it off is enforced (API and shop app); false when nothing checks it yet. */
  enforced: boolean;
}

export interface ModuleRow {
  module_key: string; name: string; group: string; description: string | null; enabled: boolean;
  licence: string; trial_ends_at: string | null; expires_at: string | null;
  /** Trial or term has lapsed: shown in the shop's dock, but locked. */
  locked: boolean;
  disabled_submodules: string[];
  /** Master Data, Settings and SaaS Admin — never switched off. */
  required: boolean;
  /** False for a module this kind of business does not use. */
  applies: boolean;
  sub_modules: SubModuleRow[];
}

export interface PlatformStats {
  tenants: { total: number; active: number; trial: number; suspended: number };
  users: number; branches: number; operators: number;
}

/** The signed-in operator, with what their role actually lets them do. */
export interface Operator {
  id: string; email: string; full_name: string;
  role: string; roleName: string; roleDescription: string;
  permissions: string[];
  phone: string | null; is_active: boolean;
  last_login_at: string | null; created_at: string;
}

/** The one platform role. It holds `*`. */
export interface PlatformRole {
  code: string; name: string; description: string; permissions: readonly string[];
}

/** Who may unlock the vault, by the kind of role they hold. */
export type VaultRoleType = 'owner' | 'admin' | 'staff';

/** A business's security vault and private entry, as the super admin sees them. The passcode is never sent. */
export interface TenantSecurity {
  vault: {
    enabled: boolean; hasPasscode: boolean; passcodeChangedAt: string | null; unlockMinutes: number;
    allowedRoleTypes: VaultRoleType[]; revision: number; updatedAt: string | null;
  };
  gateway: { enabled: boolean; path: string; points: Array<{ x: number; y: number }>; revision: number; updatedAt: string | null };
  /** Vault unlocks open right now. */
  activeUnlocks: number;
  lockouts: Array<{ kind: 'vault' | 'gateway'; userId: string; userName: string; lockedUntil: string }>;
}

/*
 * `holds()` lives in `lib/permissions.ts`, not here. This module is
 * `'use client'`, and a Server Component that imports a *value* from it fails at
 * request time — the pages need that check while rendering on the server.
 */

export const ADMIN_ROLE = 'admin';
