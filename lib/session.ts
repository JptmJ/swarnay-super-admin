/**
 * Where the platform token lives.
 *
 * In an httpOnly cookie, never in localStorage. This panel can create tenants
 * and reach every business on the platform, so a stolen token is about as bad
 * as it gets — and httpOnly means an XSS bug in this app cannot read it.
 *
 * The browser therefore never sees the token at all: it calls this app's own
 * `/api/proxy/*` routes, which attach the token server-side.
 */
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'sw_platform_session';
export const REFRESH_COOKIE = 'sw_platform_refresh';

// Missing setting → the backend on this machine, never production by accident.
export const backendUrl = (): string => process.env.BACKEND_URL ?? 'http://localhost:4000';

export interface PlatformSession {
  accessToken: string;
  refreshToken?: string;
}

export async function readSession(): Promise<PlatformSession | null> {
  const store = await cookies();
  const accessToken = store.get(SESSION_COOKIE)?.value;
  if (!accessToken) return null;
  return { accessToken, refreshToken: store.get(REFRESH_COOKIE)?.value };
}

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** Calls the backend as the signed-in operator. Server-side only. */
export async function callBackend<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T | null; error?: { code: string; message: string; details?: unknown } }> {
  const session = await readSession();
  const response = await fetch(`${backendUrl()}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (response.status === 204) return { ok: true, status: 204, data: null };

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data: null,
      error: (payload as { error?: { code: string; message: string } })?.error ?? {
        code: 'unreachable',
        message: `The backend returned ${response.status}.`,
      },
    };
  }
  return { ok: true, status: response.status, data: payload as T };
}
