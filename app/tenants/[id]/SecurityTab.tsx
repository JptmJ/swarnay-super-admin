'use client';

import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { api, type TenantSecurity, type VaultRoleType } from '@/lib/api';
import { NotFoundArtwork } from '@/components/NotFoundArtwork';
import {
  ARTWORK, HIT_RADIUS, MIN_SEPARATION, SAFE, pointDistance, validGatewayPath, validGatewayPoint, validGatewayPoints,
  type GatewayPoint,
} from '@/lib/gateway';

type Runner = (action: () => Promise<unknown>, success: string) => Promise<void>;

const ROLE_CHOICES: Array<{ value: VaultRoleType; label: string; hint: string }> = [
  { value: 'owner', label: 'Owner', hint: 'The proprietor.' },
  { value: 'admin', label: 'Branch admins', hint: 'Whoever runs a branch.' },
  { value: 'staff', label: 'Staff', hint: 'Only staff roles given “Unlock private figures”.' },
];

const date = (at: string | null) => (at ? new Date(at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

/**
 * The security vault and the private entry for one business. Only the super
 * admin sets these; inside the business, staff can only use them.
 */
export function SecurityTab({
  tenantId, security, run, busy,
}: { tenantId: string; security: TenantSecurity | null; run: Runner; busy: boolean }) {
  if (!security) {
    return <div className="card"><div className="alert error">The security settings could not be loaded. Reload the page.</div></div>;
  }
  return (
    <>
      {/* Remounted on every save, so the form starts from what the server now holds. */}
      <VaultCard key={`vault-${security.vault.revision}`} tenantId={tenantId} security={security} run={run} busy={busy} />
      <GatewayCard key={`gateway-${security.gateway.revision}`} tenantId={tenantId} gateway={security.gateway} run={run} busy={busy} />
      {security.lockouts.length > 0 && <LockoutsCard tenantId={tenantId} lockouts={security.lockouts} run={run} busy={busy} />}
    </>
  );
}

/* --------------------------------------------------------------- vault */

function VaultCard({ tenantId, security, run, busy }: { tenantId: string; security: TenantSecurity; run: Runner; busy: boolean }) {
  const { vault, activeUnlocks } = security;
  const [enabled, setEnabled] = useState(vault.enabled);
  const [passcode, setPasscode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [minutes, setMinutes] = useState(String(vault.unlockMinutes));
  const [roles, setRoles] = useState<VaultRoleType[]>(vault.allowedRoleTypes);
  const [problem, setProblem] = useState<string | null>(null);

  const flip = (role: VaultRoleType) => setRoles((current) => (current.includes(role) ? current.filter((r) => r !== role) : [...current, role]));

  const save = () => {
    const unlockMinutes = Number(minutes);
    if (passcode && passcode.length < 6) return setProblem('Use a passcode of at least 6 characters.');
    if (passcode !== confirm) return setProblem('The two passcodes do not match.');
    if (enabled && !passcode && !vault.hasPasscode) return setProblem('Set a passcode before switching the vault on.');
    if (!Number.isInteger(unlockMinutes) || unlockMinutes < 1 || unlockMinutes > 240) return setProblem('An unlock can last 1 to 240 minutes.');
    if (!roles.length) return setProblem('Choose at least one role that may unlock the vault.');
    setProblem(null);
    void run(
      () => api.put(`/platform/tenants/${tenantId}/security/vault`, {
        enabled, unlockMinutes, allowedRoleTypes: roles, revision: vault.revision,
        ...(passcode ? { passcode } : {}),
      }),
      `Security vault saved${enabled ? ' and on' : ' and off'}. Anyone who had it unlocked must unlock it again.`,
    );
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Security vault</h2>
          <p className="faint" style={{ margin: '2px 0 0' }}>
            Hides private margins and VIP customer details in the shop’s Reports and Accounts until someone unlocks it
            with the passcode. Off means nobody can unlock it, so private figures stay hidden.
          </p>
        </div>
        <span className={`pill ${vault.enabled ? 'active' : 'off'}`}>{vault.enabled ? 'on' : 'off'}</span>
      </div>

      <div className="alert info">
        {vault.hasPasscode ? <>Passcode set · last changed {date(vault.passcodeChangedAt)}.</> : <>No passcode set yet.</>}
        {' '}{activeUnlocks > 0 ? `${activeUnlocks} unlock${activeUnlocks === 1 ? ' is' : 's are'} open right now.` : 'Nobody has it unlocked right now.'}
        {' '}Every save locks it for everyone.
      </div>

      {problem && <div className="alert error" role="alert">{problem}</div>}

      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="toggle-row">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={busy} />
          <span><strong>Vault on</strong><span className="hint">Staff allowed below can unlock private figures with the passcode.</span></span>
        </label>

        <div className="form-grid" style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor="vaultPasscode">{vault.hasPasscode ? 'New passcode' : 'Passcode'}
              <span className="hint">{vault.hasPasscode ? 'Leave blank to keep the current one.' : 'At least 6 characters. Share it only with the people who need it.'}</span>
            </label>
            <input id="vaultPasscode" type={show ? 'text' : 'password'} autoComplete="new-password" value={passcode}
              onChange={(e) => setPasscode(e.target.value)} maxLength={128} disabled={busy} />
          </div>
          <div className="field">
            <label htmlFor="vaultConfirm">Type it again
              <span className="hint">
                <button type="button" className="link-btn" onClick={() => setShow((v) => !v)}>{show ? 'Hide' : 'Show'} passcode</button>
              </span>
            </label>
            <input id="vaultConfirm" type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)} maxLength={128} disabled={busy || !passcode} />
          </div>
          <div className="field">
            <label htmlFor="vaultMinutes">Each unlock lasts (minutes)
              <span className="hint">Then it locks again by itself. 1 to 240.</span>
            </label>
            <input id="vaultMinutes" type="number" min={1} max={240} value={minutes} onChange={(e) => setMinutes(e.target.value)} disabled={busy} />
          </div>
        </div>

        <fieldset className="role-set">
          <legend>Who may unlock it</legend>
          {ROLE_CHOICES.map((r) => (
            <label key={r.value} className="sub-item">
              <input type="checkbox" checked={roles.includes(r.value)} onChange={() => flip(r.value)} disabled={busy} />
              <span>{r.label}<span className="hint">{r.hint}</span></span>
            </label>
          ))}
        </fieldset>

        <button className="btn primary" type="submit" disabled={busy} style={{ marginTop: 16 }}>
          {busy ? <><span className="spinner" /> Saving…</> : 'Save vault'}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------- private entry */

function GatewayCard({ tenantId, gateway, run, busy }: { tenantId: string; gateway: TenantSecurity['gateway']; run: Runner; busy: boolean }) {
  const [enabled, setEnabled] = useState(gateway.enabled);
  const [path, setPath] = useState(gateway.path);
  const [points, setPoints] = useState<GatewayPoint[]>(gateway.points);
  const [problem, setProblem] = useState<string | null>(null);

  const save = () => {
    const blank = !path && points.length === 0;
    if (enabled || !blank) {
      if (!validGatewayPath(path)) return setProblem('Use a private path like /quiet-door: lowercase letters, digits and hyphens, at least 3 characters, and not a path the app already uses.');
      if (!validGatewayPoints(points)) return setProblem('Click exactly three points on the picture.');
    }
    setProblem(null);
    void run(
      () => api.put(`/platform/tenants/${tenantId}/security/gateway`, { enabled, path, points, revision: gateway.revision }),
      `Private entry saved${enabled ? ' and on' : ' and off'}.`,
    );
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Private entry</h2>
          <p className="faint" style={{ margin: '2px 0 0' }}>
            A hidden way in for the owner and branch admins: open the private path, then click the three points on
            the “page not found” picture, in order, within ten seconds. Anyone else just sees the ordinary page.
          </p>
        </div>
        <span className={`pill ${gateway.enabled ? 'active' : 'off'}`}>{gateway.enabled ? 'on' : 'off'}</span>
      </div>

      {problem && <div className="alert error" role="alert">{problem}</div>}

      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="toggle-row">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={busy} />
          <span><strong>Private entry on</strong><span className="hint">Needs a path and three points.</span></span>
        </label>

        <div className="form-grid" style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor="gatewayPath">Private path
              <span className="hint">Starts with /. Lowercase letters, digits and hyphens, e.g. /quiet-door.</span>
            </label>
            <input id="gatewayPath" value={path} onChange={(e) => setPath(e.target.value.trim())} maxLength={195}
              autoComplete="off" spellCheck={false} aria-invalid={path !== '' && !validGatewayPath(path)} disabled={busy} />
            {path !== '' && !validGatewayPath(path) && <span className="field-error">Not usable as a private path.</span>}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <h3>Points: {points.length} of 3</h3>
            <button type="button" className="btn ghost sm" onClick={() => setPoints([])} disabled={busy || points.length === 0}>Reset points</button>
          </div>
          <PatternEditor points={points} onChange={setPoints} disabled={busy} />
          <p className="faint" style={{ margin: '8px 0 0' }}>
            Click inside the dashed area. Points follow the picture, so they work on any screen size. Arrow keys and Enter work too.
          </p>
        </div>

        <button className="btn primary" type="submit" disabled={busy} style={{ marginTop: 16 }}>
          {busy ? <><span className="spinner" /> Saving…</> : 'Save private entry'}
        </button>
      </form>
    </div>
  );
}

function PatternEditor({ points, onChange, disabled }: { points: GatewayPoint[]; onChange: (p: GatewayPoint[]) => void; disabled: boolean }) {
  const [cursor, setCursor] = useState<GatewayPoint>({ x: 0.5, y: 0.5 });
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const select = (point: GatewayPoint) => {
    if (disabled || points.length >= 3) return;
    if (!validGatewayPoint(point)) { setError('Choose a point inside the dashed area.'); return; }
    if (points.some((p) => pointDistance(p, point) < MIN_SEPARATION)) { setError('Too close to another point. Leave space between the circles.'); return; }
    setError(null);
    onChange([...points, point]);
  };

  const click = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    select({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
  };

  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(cursor); return; }
    const step = { ArrowLeft: [-0.025, 0], ArrowRight: [0.025, 0], ArrowUp: [0, -0.036], ArrowDown: [0, 0.036] }[event.key];
    if (!step) return;
    event.preventDefault();
    setCursor((c) => ({
      x: Math.min(SAFE.maxX, Math.max(SAFE.minX, c.x + step[0]!)),
      y: Math.min(SAFE.maxY, Math.max(SAFE.minY, c.y + step[1]!)),
    }));
  };

  const W = ARTWORK.width;
  const H = ARTWORK.height;
  return (
    <div>
      <div
        className={`pattern-art${disabled || points.length >= 3 ? ' is-full' : ''}`}
        tabIndex={disabled ? -1 : 0}
        role="group"
        aria-label="Click three points in order"
        onClick={click}
        onKeyDown={keyboard}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <NotFoundArtwork />
        <svg className="pattern-points" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <rect x={SAFE.minX * W} y={SAFE.minY * H} width={(SAFE.maxX - SAFE.minX) * W} height={(SAFE.maxY - SAFE.minY) * H}
            rx="4" fill="none" stroke="#789480" strokeWidth="1.5" strokeDasharray="4 6" />
          {points.map((p, i) => (
            <g key={i}>
              <circle cx={p.x * W} cy={p.y * H} r={HIT_RADIUS} fill="#0d3b2f" fillOpacity=".14" stroke="#0d3b2f" strokeWidth="2" />
              <circle cx={p.x * W} cy={p.y * H} r="18" fill="#0d3b2f" />
              <text x={p.x * W} y={p.y * H + 6} textAnchor="middle" fill="#fff" fontSize="18">{i + 1}</text>
            </g>
          ))}
          {focused && points.length < 3 && <circle cx={cursor.x * W} cy={cursor.y * H} r="12" fill="none" stroke="#725019" strokeWidth="3" />}
        </svg>
      </div>
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}

/* ------------------------------------------------------------ lockouts */

function LockoutsCard({ tenantId, lockouts, run, busy }: { tenantId: string; lockouts: TenantSecurity['lockouts']; run: Runner; busy: boolean }) {
  const clear = (userId?: string, name?: string) => run(
    () => api.post(`/platform/tenants/${tenantId}/security/lockouts/clear`, userId ? { userId } : {}),
    name ? `${name} can try again now.` : 'Everyone can try again now.',
  );
  return (
    <div className="card">
      <div className="card-head">
        <h2>Locked out</h2>
        <button className="btn ghost sm" onClick={() => clear()} disabled={busy}>Let everyone try again</button>
      </div>
      <p className="faint" style={{ margin: '0 0 12px' }}>Five wrong tries in a row lock a person out for a while. They are let back in automatically when it runs out.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Person</th><th>Where</th><th>Locked until</th><th /></tr></thead>
          <tbody>
            {lockouts.map((l) => (
              <tr key={`${l.kind}-${l.userId}`}>
                <td><strong>{l.userName}</strong></td>
                <td className="muted">{l.kind === 'vault' ? 'Security vault' : 'Private entry'}</td>
                <td className="faint">{new Date(l.lockedUntil).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
                <td className="row-actions"><button className="btn ghost sm" onClick={() => clear(l.userId, l.userName)} disabled={busy}>Let in now</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
