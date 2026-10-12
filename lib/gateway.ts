/**
 * The private entry's rules — the same ones the backend checks
 * (`src/modules/security/gateway-rules.ts`), so the editor never offers a
 * pattern the server would refuse.
 *
 * Points are normalised over the 404 artwork (viewBox 640×440).
 */
export interface GatewayPoint { x: number; y: number }

export const ARTWORK = { width: 640, height: 440 } as const;
export const HIT_RADIUS = 44;
export const MIN_SEPARATION = HIT_RADIUS * 2 + 8;
export const SAFE = { minX: 0.07, maxX: 0.93, minY: 0.1, maxY: 0.9 } as const;

const PATH_SHAPE = /^\/[a-z0-9][a-z0-9-]{2,63}(?:\/[a-z0-9][a-z0-9-]{0,63}){0,2}$/;
const RESERVED = /^\/(?:api|assets|locales|src|public|dev-docs|health|index|login|settings|admin|billing|dashboard|modules)(?:[./-]|$)/;

export const validGatewayPath = (path: string): boolean => PATH_SHAPE.test(path) && !RESERVED.test(path);

export const validGatewayPoint = (p: GatewayPoint): boolean =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= SAFE.minX && p.x <= SAFE.maxX && p.y >= SAFE.minY && p.y <= SAFE.maxY;

export const pointDistance = (a: GatewayPoint, b: GatewayPoint): number =>
  Math.hypot((a.x - b.x) * ARTWORK.width, (a.y - b.y) * ARTWORK.height);

export const validGatewayPoints = (points: GatewayPoint[]): boolean =>
  points.length === 3 && points.every(validGatewayPoint)
  && points.every((p, i) => points.slice(i + 1).every((q) => pointDistance(p, q) >= MIN_SEPARATION));
