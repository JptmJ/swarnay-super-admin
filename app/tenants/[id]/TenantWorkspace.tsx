'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AdminApiError, api,
  type BranchRow, type ModuleRow, type PermissionTreeModule, type SupportSessionRow,
  type TenantRoleRow, type TenantSecurity, type UserRow,
} from '@/lib/api';
import { RolesTab } from './RolesTab';
import { SecurityTab } from './SecurityTab';

interface Detail {
  tenant: Record<string, string | null>;
  branches: BranchRow[];
  users: UserRow[];
  modules: ModuleRow[];
  /** The admin covering every branch, if the business has one. */
  globalAdmin: UserRow | null;
}

type Tab = 'users' | 'roles' | 'branches' | 'modules' | 'security' | 'support' | 'settings';

export function TenantWorkspace({
  tenantId, detail, sessions, tenantRoles, permissionTree, security,
}: {
  tenantId: string; detail: Detail;
  sessions: SupportSessionRow[];
  /** Null when it could not be loaded; the tab says so. */
  security: TenantSecurity | null;
  tenantRoles: TenantRoleRow[];
  permissionTree: PermissionTreeModule[];
}) {
  const router = useRouter();
  const [banner, setBanner] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // One operator, holding everything — nothing here is permission-gated.
  const tabs: Tab[] = ['users', 'roles', 'branches', 'modules', 'security', 'support', 'settings'];
  const [tab, setTab] = useState<Tab>('users');

  const tenant = detail.tenant;
  /* The detail row is typed as strings; is_demo arrives as a real boolean. */
  const isDemo = (tenant as Record<string, unknown>).is_demo === true;

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setBanner(null);
    try {
      await action();
      setBanner({ kind: 'ok', text: success });
      router.refresh();
    } catch (e) {
      setBanner({ kind: 'error', text: e instanceof AdminApiError ? e.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{tenant.display_name}</h1>
          <p>
            <code>{tenant.code}</code> · {tenant.kind} ·{' '}
            <span className={`pill ${tenant.status}`}>{tenant.status}</span>
            {isDemo && <> <span className="pill demo">Demo</span></>}
            {tenant.gstin && <> · <span className="mono faint">{tenant.gstin}</span></>}
          </p>
        </div>
        <Link className="btn ghost" href="/tenants">Back</Link>
      </div>

      {banner && <div className={`alert ${banner.kind}`}>{banner.text}</div>}

      <div className="tabs">
        {tabs.map((t) => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'users' && `Staff (${detail.users.length})`}
            {t === 'roles' && `Roles (${tenantRoles.length})`}
            {t === 'branches' && `Branches (${detail.branches.length})`}
            {t === 'modules' && `Modules (${detail.modules.length})`}
            {t === 'security' && `Security${security?.vault.enabled ? ' · vault on' : ''}`}
            {t === 'support' && `Support (${sessions.filter((s) => s.is_open).length})`}
            {t === 'settings' && 'Settings'}
          </button>
        ))}
      </div>

      {tab === 'users' && <UsersTab tenantId={tenantId} users={detail.users} branches={detail.branches} roles={tenantRoles} globalAdmin={detail.globalAdmin} run={run} busy={busy} />}
      {tab === 'roles' && <RolesTab tenantId={tenantId} roles={tenantRoles} tree={permissionTree} run={run} busy={busy} />}
      {tab === 'branches' && <BranchesTab tenantId={tenantId} branches={detail.branches} tenant={tenant} run={run} busy={busy} />}
      {tab === 'modules' && <ModulesTab tenantId={tenantId} modules={detail.modules} run={run} busy={busy} />}
      {tab === 'security' && <SecurityTab tenantId={tenantId} security={security} run={run} busy={busy} />}
      {tab === 'support' && <SupportTab tenantId={tenantId} tenantName={tenant.display_name ?? ''} sessions={sessions} run={run} busy={busy} />}
      {tab === 'settings' && <SettingsTab tenantId={tenantId} tenant={tenant} run={run} busy={busy} />}
    </>
  );
}

type Runner = (action: () => Promise<unknown>, success: string) => Promise<void>;

/* ------------------------------------------------------------- staff */

function UsersTab({
  tenantId, users, branches, roles, globalAdmin, run, busy,
}: {
  tenantId: string; users: UserRow[]; branches: BranchRow[]; roles: TenantRoleRow[];
  globalAdmin: UserRow | null; run: Runner; busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState('sales');
  const [editing, setEditing] = useState<string | null>(null);
  /** A temporary password is shown once, so it is held here until dismissed. */
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null);

  const adminRole = roles.find((r) => r.role_type === 'admin');
  const creatingAdmin = adminRole ? role === adminRole.code : false;

  /* Which branches still have no admin — the only ones a new admin can take. */
  const branchesWithoutAdmin = branches.filter((b) => !b.admin_name);
  const allBranchesTaken = globalAdmin !== null;

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Staff</h2>
          <button className="btn gold sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Close' : '+ Add staff'}
          </button>
        </div>

        <div className="alert info" style={{ marginBottom: 16 }}>
          Only you can add or change staff. Nobody inside the business can — not even a branch admin.
          The endpoints a shop used to have for this no longer exist, so this is the only way in.
        </div>

        {issued && (
          <div className="alert ok" style={{ marginBottom: 16 }}>
            <strong>{issued.name}</strong>’s temporary password is{' '}
            <code style={{ fontSize: 14 }}>{issued.password}</code> — shown once, so pass it on now.
            They must change it at next sign-in, and they have been signed out everywhere.
            <div style={{ marginTop: 8 }}>
              <button className="btn ghost sm" onClick={() => setIssued(null)}>Dismiss</button>
            </div>
          </div>
        )}

        {open && (
          <form
            style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid var(--border-subtle)' }}
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const v = (n: string) => String(form.get(n) ?? '').trim();
              await run(
                () => api.post(`/platform/tenants/${tenantId}/users`, {
                  email: v('email'), fullName: v('fullName'), password: v('password'),
                  role: v('role'), phone: v('phone') || undefined,
                  branchId: v('branchId') || undefined,
                }),
                `${v('fullName')} added.`,
              );
              setOpen(false);
            }}
          >
            <div className="form-grid">
              <div className="field">
                <label htmlFor="fullName">Full name<span className="req">*</span></label>
                <input id="fullName" name="fullName" required />
              </div>
              <div className="field">
                <label htmlFor="email">Email<span className="req">*</span></label>
                <input id="email" name="email" type="email" required />
              </div>
              <div className="field">
                <label htmlFor="password">Password<span className="req">*</span>
                  <span className="hint">At least 8 characters. Share it with them securely.</span>
                </label>
                <input id="password" name="password" type="text" required minLength={8} />
              </div>
              <div className="field">
                <label htmlFor="role">Role<span className="req">*</span></label>
                <select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)} required>
                  {roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="phone">Phone</label>
                <input id="phone" name="phone" />
              </div>
              <div className="field">
                <label htmlFor="branchId">Branch
                  <span className="hint">
                    {creatingAdmin
                      ? 'A branch has one admin, so only branches without one are listed.'
                      : 'Leave blank for access to every branch.'}
                  </span>
                </label>
                <select id="branchId" name="branchId" defaultValue="">
                  <option value="" disabled={creatingAdmin && allBranchesTaken}>
                    {creatingAdmin && allBranchesTaken
                      ? `All branches — taken by ${globalAdmin?.full_name}`
                      : 'All branches'}
                  </option>
                  {(creatingAdmin ? branchesWithoutAdmin : branches).map((b) => (
                    <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {creatingAdmin && branchesWithoutAdmin.length === 0 && allBranchesTaken && (
              <div className="alert error" style={{ marginTop: 14 }}>
                Every branch already has an admin. Move or deactivate one before adding another.
              </div>
            )}

            <button className="btn primary" type="submit" disabled={busy} style={{ marginTop: 14 }}>
              {busy ? <><span className="spinner" /> Adding…</> : 'Add staff member'}
            </button>
          </form>
        )}

        {users.length === 0 ? (
          <div className="empty">No staff yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Branch</th><th>Last sign-in</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <Fragment key={u.id}>
                    <tr>
                      <td><strong>{u.full_name}</strong>{u.phone && <div className="faint">{u.phone}</div>}</td>
                      <td className="muted">{u.email}</td>
                      <td>
                        <span className={`pill ${u.role_code === 'admin' ? 'role' : 'off'}`}>
                          {u.role_name ?? u.role_code}
                        </span>
                      </td>
                      <td className="muted">
                        {u.branch_code ? <code>{u.branch_code}</code> : <span className="faint">All branches</span>}
                      </td>
                      <td className="faint">{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('en-IN') : 'Never'}</td>
                      <td><span className={`pill ${u.is_active ? 'active' : 'off'}`}>{u.is_active ? 'active' : 'disabled'}</span></td>
                      <td className="row-actions">
                        <>
                          <select
                            defaultValue={u.role_code}
                            disabled={busy}
                            onChange={(e) => run(
                              () => api.patch(`/platform/tenants/${tenantId}/users/${u.id}`, { role: e.target.value }),
                              `${u.full_name} is now ${roles.find((r) => r.code === e.target.value)?.name ?? e.target.value}.`,
                            )}
                            style={{ width: 'auto', padding: '4px 8px', fontSize: 12.4 }}
                          >
                            {roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                          </select>
                          <button
                            className="btn ghost sm"
                            disabled={busy}
                            onClick={() => setEditing(editing === u.id ? null : u.id)}
                          >
                            {editing === u.id ? 'Close' : 'Edit'}
                          </button>
                        </>
                        <button
                          className="btn ghost sm"
                          disabled={busy}
                          onClick={() => run(
                            async () => {
                              const { temporaryPassword } = await api.post<{ temporaryPassword: string }>(
                                `/platform/tenants/${tenantId}/users/${u.id}/reset-password`,
                              );
                              setIssued({ name: u.full_name, password: temporaryPassword });
                            },
                            `New password issued for ${u.full_name}.`,
                          )}
                        >
                          Reset password
                        </button>
                        <button
                          className={`btn sm ${u.is_active ? 'danger' : 'ghost'}`}
                          disabled={busy}
                          onClick={() => run(
                            () => api.patch(`/platform/tenants/${tenantId}/users/${u.id}`, { isActive: !u.is_active }),
                            `${u.full_name} ${u.is_active ? 'deactivated' : 'reactivated'}.`,
                          )}
                        >
                          {u.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </td>
                    </tr>

                    {editing === u.id && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--surface-sunken, rgba(0,0,0,.03))' }}>
                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const form = new FormData(e.currentTarget);
                              const v = (n: string) => String(form.get(n) ?? '').trim();
                              const branch = v('branchId');
                              await run(
                                () => api.patch(`/platform/tenants/${tenantId}/users/${u.id}`, {
                                  fullName: v('fullName'),
                                  email: v('email') || null,
                                  phone: v('phone') || null,
                                  // '' is the every-branch choice, which the API takes as null.
                                  branchId: branch === '' ? null : branch,
                                }),
                                `${v('fullName')} saved.`,
                              );
                              setEditing(null);
                            }}
                          >
                            <div className="form-grid">
                              <div className="field">
                                <label htmlFor={`fn-${u.id}`}>Full name</label>
                                <input id={`fn-${u.id}`} name="fullName" defaultValue={u.full_name} required />
                              </div>
                              <div className="field">
                                <label htmlFor={`em-${u.id}`}>Email</label>
                                <input id={`em-${u.id}`} name="email" type="email" defaultValue={u.email ?? ''} />
                              </div>
                              <div className="field">
                                <label htmlFor={`ph-${u.id}`}>Phone</label>
                                <input id={`ph-${u.id}`} name="phone" defaultValue={u.phone ?? ''} />
                              </div>
                              <div className="field">
                                <label htmlFor={`br-${u.id}`}>Branch
                                  <span className="hint">A branch admin cannot move to a branch that already has one.</span>
                                </label>
                                <select id={`br-${u.id}`} name="branchId" defaultValue={u.default_branch_id ?? ''}>
                                  <option value="">All branches</option>
                                  {branches.map((b) => (
                                    <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <button className="btn primary sm" type="submit" disabled={busy} style={{ marginTop: 12 }}>
                              {busy ? <><span className="spinner" /> Saving…</> : 'Save'}
                            </button>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Who runs which branch</h3>
        <p className="faint" style={{ margin: '0 0 12px' }}>
          A branch has exactly one admin. One admin can instead cover every branch —
          that is the usual shape for a single-shop business.
        </p>

        {globalAdmin && (
          <div className="alert ok" style={{ marginBottom: 12 }}>
            <strong>{globalAdmin.full_name}</strong> administers all branches.
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead><tr><th>Branch</th><th>Admin</th></tr></thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id}>
                  <td><code>{b.code}</code> {b.name}</td>
                  <td>
                    {b.admin_name
                      ? <>{b.admin_name} <span className="faint">{b.admin_email}</span></>
                      : globalAdmin
                        ? <span className="faint">{globalAdmin.full_name} (all branches)</span>
                        : <span className="pill suspended">no admin</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 8 }}>The roles you can assign</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Role</th><th>What they can do</th><th>Limit</th></tr></thead>
            <tbody>
              {roles.map((r) => {
                const onePerBranch = r.role_type === 'owner' || r.role_type === 'admin';
                return (
                  <tr key={r.id}>
                    <td><span className={`pill ${onePerBranch ? 'role' : 'off'}`}>{r.name}</span></td>
                    <td className="muted">{r.description ?? '—'}</td>
                    <td className="faint">{onePerBranch ? 'One per branch' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------- branches */

function BranchesTab({
  tenantId, branches, tenant, run, busy,
}: {
  tenantId: string; branches: BranchRow[];
  tenant: Record<string, string | null>;
  run: Runner; busy: boolean;
}) {
  const [open, setOpen] = useState(false);

  const limit = tenant.max_branches === null || tenant.max_branches === undefined
    ? null
    : Number(tenant.max_branches);
  const atLimit = limit !== null && branches.length >= limit;

  return (
    <div className="card">
      <div className="card-head">
        <h2>Branches</h2>
        <button
          className="btn gold sm"
          disabled={atLimit}
          title={atLimit ? 'This business is at its branch limit. Raise it under Settings.' : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Close' : '+ Add branch'}
        </button>
      </div>

      <p className="faint" style={{ margin: '0 0 14px' }}>
        {limit === null
          ? `${branches.length} branch${branches.length === 1 ? '' : 'es'}, no limit set. The shop's own admin can add more.`
          : `${branches.length} of ${limit} branches used. The shop's own admin can add more up to that number.`}
        {atLimit && ' Raise the limit under Settings to add another.'}
      </p>

      {open && (
        <form
          style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid var(--border-subtle)' }}
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const v = (n: string) => String(form.get(n) ?? '').trim();
            await run(
              () => api.post(`/platform/tenants/${tenantId}/branches`, {
                code: v('code'), name: v('name'), kind: v('kind'),
                city: v('city') || undefined, state: v('state') || undefined,
                stateCode: v('stateCode') || undefined, gstin: v('gstin') || undefined,
              }),
              `${v('name')} added, with its locations and numbering.`,
            );
            setOpen(false);
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label htmlFor="bcode">Code<span className="req">*</span></label>
              <input id="bcode" name="code" required maxLength={20} placeholder="AHM" />
            </div>
            <div className="field">
              <label htmlFor="bname">Name<span className="req">*</span></label>
              <input id="bname" name="name" required placeholder="Ahmedabad Boutique" />
            </div>
            <div className="field">
              <label htmlFor="bkind">Type</label>
              <select id="bkind" name="kind" defaultValue="showroom">
                <option value="showroom">Showroom</option>
                <option value="factory">Factory</option>
                <option value="warehouse">Warehouse</option>
                <option value="office">Office</option>
              </select>
            </div>
            <div className="field"><label htmlFor="bcity">City</label><input id="bcity" name="city" /></div>
            <div className="field"><label htmlFor="bstate">State</label><input id="bstate" name="state" /></div>
            <div className="field">
              <label htmlFor="bstateCode">GST state code</label>
              <input id="bstateCode" name="stateCode" maxLength={2} placeholder="24" />
            </div>
            <div className="field">
              <label htmlFor="bgstin">Branch GSTIN
                <span className="hint">Each branch can have its own registration.</span>
              </label>
              <input id="bgstin" name="gstin" />
            </div>
          </div>
          <button className="btn primary" type="submit" disabled={busy} style={{ marginTop: 14 }}>
            {busy ? <><span className="spinner" /> Adding…</> : 'Add branch'}
          </button>
        </form>
      )}

      {branches.length === 0 ? (
        <div className="empty">No branches yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>City</th><th>Admin</th><th className="num">Locations</th><th>Status</th></tr></thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id}>
                  <td><code>{b.code}</code></td>
                  <td><strong>{b.name}</strong></td>
                  <td className="muted">{b.kind}</td>
                  <td className="muted">{b.city ?? '—'}</td>
                  <td className="faint">{b.admin_name ?? <span className="pill suspended">none</span>}</td>
                  <td className="num">{b.location_count}</td>
                  <td><span className={`pill ${b.is_active ? 'active' : 'off'}`}>{b.is_active ? 'active' : 'closed'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- modules */

function ModulesTab({
  tenantId, modules, run, busy,
}: { tenantId: string; modules: ModuleRow[]; run: Runner; busy: boolean }) {
  /** Which module's sub-modules are open for editing. */
  const [expanded, setExpanded] = useState<string | null>(null);
  const onCount = modules.filter((m) => m.enabled).length;

  const put = (m: ModuleRow, body: Record<string, unknown>) =>
    api.put(`/platform/tenants/${tenantId}/modules/${m.module_key}`, body);

  function toggle(m: ModuleRow) {
    if (m.enabled && !window.confirm(
      `Switch ${m.name} off for this business?\n\nIt leaves their menu and its screens stop working at once, ` +
      'for all their staff. Nothing is deleted — switching it back on restores everything.',
    )) return;
    void run(() => put(m, { enabled: !m.enabled }), `${m.name} switched ${m.enabled ? 'off' : 'on'}.`);
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Modules</h2>
        <span className="faint">{onCount} of {modules.length} on</span>
      </div>
      <div className="alert info">
        Switching a module off takes it out of the shop’s menu, and the API refuses every one of its
        endpoints. Their data stays as it is, so switching
        it back on restores everything. Master Data, Settings and SaaS Admin are always on: everything else
        depends on them.
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Module</th><th>Licence</th><th>Expires</th><th>Status</th><th /></tr></thead>
          <tbody>
            {modules.map((m) => {
              const deadline = m.licence === 'trial' ? m.trial_ends_at : m.expires_at;
              const offSubs = m.disabled_submodules.length;
              const open = expanded === m.module_key;
              return (
                <Fragment key={m.module_key}>
                  <tr className={m.enabled ? undefined : 'row-off'}>
                    <td>
                      <strong>{m.name}</strong>
                      <div className="faint">
                        <code>{m.module_key}</code> · {m.group}
                        {!m.applies && ' · not used by this kind of business'}
                      </div>
                    </td>
                    <td>
                      <select
                        value={m.licence}
                        disabled={busy}
                        onChange={(e) => run(
                          () => put(m, {
                            licence: e.target.value,
                            trialEndsAt: e.target.value === 'trial'
                              ? new Date(Date.now() + 30 * 86400000).toISOString()
                              : null,
                          }),
                          `${m.name} set to ${e.target.value}.`,
                        )}
                        style={{ width: 'auto', padding: '4px 8px', fontSize: 12.4 }}
                        aria-label={`${m.name} licence`}
                      >
                        <option value="included">Included</option>
                        <option value="purchased">Purchased</option>
                        <option value="trial">Trial</option>
                        <option value="expired">Expired</option>
                      </select>
                    </td>
                    <td className="faint">{deadline ? new Date(deadline).toLocaleDateString('en-IN') : '—'}</td>
                    <td>
                      {!m.enabled
                        ? <span className="pill off">off</span>
                        : m.locked
                          ? <span className="pill expired">locked</span>
                          : <span className="pill active">on</span>}
                      {m.enabled && offSubs > 0 && (
                        <div className="faint" style={{ fontSize: 11.6, marginTop: 3 }}>{offSubs} sub-module{offSubs === 1 ? '' : 's'} off</div>
                      )}
                    </td>
                    <td className="row-actions" style={{ justifyContent: 'flex-end' }}>
                      {m.sub_modules.length > 0 && !m.required && (
                        <button
                          className="btn ghost sm"
                          disabled={!m.enabled}
                          onClick={() => setExpanded(open ? null : m.module_key)}
                          aria-expanded={open}
                        >
                          {open ? 'Close' : 'Sub-modules'}
                        </button>
                      )}
                      {m.required
                        ? <span className="pill role" title="Every other module depends on this one.">always on</span>
                        : (
                          <button className={`btn sm ${m.enabled ? 'danger' : 'primary'}`} disabled={busy} onClick={() => toggle(m)}>
                            {m.enabled ? 'Switch off' : 'Switch on'}
                          </button>
                        )}
                    </td>
                  </tr>
                  {open && m.enabled && (
                    <tr className="row-detail">
                      <td colSpan={5}>
                        <SubModuleEditor
                          module={m}
                          busy={busy}
                          onSave={(disabled) => run(
                            () => put(m, { disabledSubmodules: disabled }),
                            `${m.name}: sub-modules saved.`,
                          )}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Ticks for one module's sub-modules, saved together. Only a sub-module with
 * permissions of its own can be switched off apart from its module — that is
 * what both the API and the shop's screens check. The rest are shown, greyed,
 * so the operator does not believe something is off that nothing enforces.
 */
function SubModuleEditor({
  module, busy, onSave,
}: { module: ModuleRow; busy: boolean; onSave: (disabled: string[]) => void }) {
  const [off, setOff] = useState<Set<string>>(() => new Set(module.disabled_submodules));
  const dirty = off.size !== module.disabled_submodules.length
    || module.disabled_submodules.some((k) => !off.has(k));

  const flip = (key: string) => setOff((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="sub-editor">
      <div className="sub-grid">
        {module.sub_modules.map((s) => {
          // A stray "off" saved earlier can still be turned back on.
          const fixed = !s.enforced && !off.has(s.key);
          return (
            <label key={s.key} className={`sub-item${fixed ? ' fixed' : ''}`}>
              <input type="checkbox" checked={!off.has(s.key)} onChange={() => flip(s.key)} disabled={busy || fixed} />
              <span>
                {s.name}
                <span className="hint">
                  <code>{s.key}</code>
                  {s.status === 'planned' && ' · not built yet'}
                  {!s.enforced && ' · follows the module — no separate switch yet'}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn gold sm" disabled={busy || !dirty} onClick={() => onSave([...off])}>Save sub-modules</button>
        <button className="btn ghost sm" disabled={busy || !dirty} onClick={() => setOff(new Set(module.disabled_submodules))}>Reset</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- settings */

function SettingsTab({
  tenantId, tenant, isDemo, run, busy,
}: { tenantId: string; tenant: Record<string, string | null>; isDemo: boolean; run: Runner; busy: boolean }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function deleteDemo() {
    const typed = window.prompt(
      `This deletes ${tenant.display_name} and everything in it — users, stock, bills, books. It cannot be undone.\n\nType the tenant code (${tenant.code}) to confirm.`);
    if (typed === null) return;
    if (typed.trim() !== tenant.code) {
      setDeleteError('The code did not match, so nothing was deleted.');
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.del(`/platform/tenants/${tenantId}`);
      router.push('/tenants?demo=true');
      router.refresh();
    } catch (e) {
      setDeleteError(e instanceof AdminApiError ? e.message : 'Something went wrong.');
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="card">
        <h2 style={{ marginBottom: 14 }}>Business details</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const v = (n: string) => String(form.get(n) ?? '').trim();
            await run(
              () => api.patch(`/platform/tenants/${tenantId}`, {
                displayName: v('displayName'), legalName: v('legalName'),
                kind: v('kind'),
                gstin: v('gstin') || undefined,
                pan: v('pan') || undefined,
                // Blank means no limit, which the API takes as null.
                maxBranches: v('maxBranches') ? Number(v('maxBranches')) : null,
              }),
              'Saved.',
            );
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label htmlFor="sDisplay">Display name</label>
              <input id="sDisplay" name="displayName" defaultValue={tenant.display_name ?? ''} />
            </div>
            <div className="field">
              <label htmlFor="sLegal">Legal name</label>
              <input id="sLegal" name="legalName" defaultValue={tenant.legal_name ?? ''} />
            </div>
            <div className="field">
              <label htmlFor="sKind">Business type</label>
              <select id="sKind" name="kind" defaultValue={tenant.kind ?? 'retailer'}>
                <option value="retailer">Retailer</option>
                <option value="manufacturer">Manufacturer</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="sGstin">GSTIN</label>
              <input id="sGstin" name="gstin" defaultValue={tenant.gstin ?? ''} />
            </div>
            <div className="field">
              <label htmlFor="sPan">PAN</label>
              <input id="sPan" name="pan" defaultValue={tenant.pan ?? ''} />
            </div>
            <div className="field">
              <label htmlFor="sMaxBranches">Branch limit
                <span className="hint">
                  How many branches they may have, as sold. Leave blank for no limit. Checked both
                  here and when the shop’s own admin adds one.
                </span>
              </label>
              <input
                id="sMaxBranches" name="maxBranches" type="number" min={1} max={500}
                defaultValue={tenant.max_branches ?? ''}
                placeholder="No limit"
              />
            </div>
          </div>
          <button className="btn primary" type="submit" disabled={busy} style={{ marginTop: 14 }}>
            Save changes
          </button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 4 }}>Account status</h2>
        <p className="faint" style={{ margin: '0 0 14px' }}>
          Suspending blocks every user of this business from signing in. Their data is untouched.
        </p>
        <div className="row-actions">
          {(['active', 'trial', 'suspended', 'closed'] as const).map((status) => (
            <button
              key={status}
              className={`btn sm ${status === tenant.status ? 'primary' : status === 'suspended' || status === 'closed' ? 'danger' : 'ghost'}`}
              disabled={busy || status === tenant.status}
              onClick={() => run(
                () => api.patch(`/platform/tenants/${tenantId}`, { status }),
                `Account set to ${status}.`,
              )}
            >
              {status === tenant.status ? `Currently ${status}` : `Set ${status}`}
            </button>
          ))}
        </div>
      </div>

      {isDemo && (
        <div className="card">
          <h2 style={{ marginBottom: 4 }}>Delete demo account</h2>
          <p className="faint" style={{ margin: '0 0 14px' }}>
            This is a demo made by the Demo accounts button, so it can be deleted outright: every user, branch,
            piece, bill and ledger entry in it goes. Real businesses cannot be deleted — only suspended or closed.
            Takes up to a minute.
          </p>
          {deleteError && <div className="alert error">{deleteError}</div>}
          <button className="btn danger sm" onClick={deleteDemo} disabled={busy || deleting}>
            {deleting ? <><span className="spinner" /> Deleting…</> : 'Delete this demo account'}
          </button>
        </div>
      )}
    </>
  );
}
