/**
 * ★ 2026-10-09 시연 회사 판정 CT(설계서 docs/2026-10-09-demo-company-design.md §0·§1)
 *
 * 시연 회사 = `companies.is_demo = true`. 판정은 이 파일 한 곳 — 계정 이름·ENV 로 판정하지 않는다.
 * 시연 회사는 발송 0 · 돈 0 · 회사 간 학습·전역 집계 0. 켜는 곳은 시드 스크립트뿐(scripts/setup-demo-company.ts).
 *
 * 조회 실패 규칙(fail-closed):
 *   - 컬럼 부재(42703) = 시연 아님 — 시연 회사는 ALTER 뒤 시드로만 생기므로 컬럼이 없으면 시연 회사도 없다.
 *   - 그 밖의 오류 = throw — "모르면 보낸다"가 되지 않게(호출부의 기존 재시도·실패 경로로 간다).
 * 캐시 = 짧은 TTL(true/false 둘 다) · 시드는 is_demo 를 INSERT 와 같은 문장에서 넣으므로 "생성 직후 false 캐시" 틈이 없다.
 */
import { query } from '../config/database';

const TTL_MS = 30_000;
const cache = new Map<string, { v: boolean; at: number }>();
let listCache: { ids: string[]; at: number } | null = null;

function isMissingColumn(err: any): boolean {
  const msg = String(err?.message || '');
  return err?.code === '42703' || (msg.includes('is_demo') && msg.includes('does not exist'));
}

/** 시연 회사인가 — companyId 가 비면 false(시스템 경로) */
export async function isDemoCompany(companyId: string | null | undefined): Promise<boolean> {
  const id = String(companyId || '').trim();
  if (!id) return false;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  let v = false;
  try {
    const r = await query(`SELECT is_demo FROM companies WHERE id = $1::uuid`, [id]);
    v = r.rows[0]?.is_demo === true;
  } catch (err: any) {
    if (!isMissingColumn(err)) throw err;
    v = false;
  }
  cache.set(id, { v, at: Date.now() });
  return v;
}

/** 시연 회사 id 목록 — 전역 집계 제외용(SQL 에 컬럼을 쓰지 않아 ALTER 전에도 안전) */
export async function listDemoCompanyIds(): Promise<string[]> {
  if (listCache && Date.now() - listCache.at < TTL_MS) return listCache.ids;
  let ids: string[] = [];
  try {
    const r = await query(`SELECT id FROM companies WHERE is_demo = true`);
    ids = r.rows.map((x: any) => String(x.id));
  } catch (err: any) {
    if (!isMissingColumn(err)) throw err;
  }
  listCache = { ids, at: Date.now() };
  return ids;
}

/** 사람이 누른 발송·돈 입구 거절 — 라우트는 code/status 를 그대로 응답한다 */
export class DemoBlockedError extends Error {
  readonly code = 'DEMO_BLOCKED';
  readonly status = 409;
  constructor() { super('시연 회사는 실제로 보내거나 결제하지 않습니다.'); }
}
export async function assertNotDemoCompany(companyId: string | null | undefined): Promise<void> {
  if (await isDemoCompany(companyId)) throw new DemoBlockedError();
}

/** 라우트 공용 응답 — 시연 거절이면 409 를 보내고 true(호출부는 return) */
export async function rejectIfDemo(res: { status: (n: number) => { json: (b: unknown) => unknown } }, companyId: string | null | undefined): Promise<boolean> {
  if (!(await isDemoCompany(companyId))) return false;
  const e = new DemoBlockedError();
  res.status(e.status).json({ error: e.message, code: e.code });
  return true;
}

/**
 * 라우트 미들웨어 — 사람이 누르는 발송·돈 입구(직접 발송 · 테스트 · 브랜드 · 스팸 테스트 · 충전 · 결제 · 발신번호 · 080 · 요금제 요청).
 * authenticate 뒤에 둔다(req.user.companyId). 판정 조회 실패 = 503(보내지 않는 쪽).
 */
export async function demoBlock(req: any, res: any, next: (err?: unknown) => void): Promise<void> {
  try {
    if (await isDemoCompany(req.user?.companyId)) {
      const e = new DemoBlockedError();
      res.status(e.status).json({ error: e.message, code: e.code });
      return;
    }
  } catch (err: any) {
    console.error('[demo-company] 시연 판정 실패 · 요청 거절:', err?.message);
    res.status(503).json({ error: '잠시 후 다시 시도해주세요.', code: 'DEMO_CHECK_FAILED' });
    return;
  }
  next();
}

/** 최후 방어 층(발송 큐·차감) — 여기 도달 = 경로 층이 빠뜨린 사고 · 경보 로그 + throw */
export class DemoLeakError extends Error {
  readonly code = 'DEMO_LEAK';
  constructor(where: string, companyId: string) { super(`시연 회사 발송·차감 차단(${where} · ${companyId})`); }
}
export async function guardDemoLeak(where: string, companyId: string | null | undefined): Promise<void> {
  if (!(await isDemoCompany(companyId))) return;
  console.error(`[DEMO-LEAK] ${where} 에 시연 회사가 도달했다 · 경로 층 누락 · 차단 company=${companyId}`);
  throw new DemoLeakError(where, String(companyId));
}

/** 테스트 전용 — 캐시 비우기 */
export function __resetDemoCompanyCache(): void { cache.clear(); listCache = null; }
