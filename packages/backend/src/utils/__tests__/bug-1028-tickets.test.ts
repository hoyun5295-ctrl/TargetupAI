/**
 * 오류접수 1028 두 건 (★ 2026-10-28 · status/BUGS.md B-1028-1 · B-1028-2)
 *
 * B-1028-1 여정 안내(2시간 전 · 결과)의 받는 사람 = 주인(만든 계정 → 회사 관리자) 한 함수 · 알림톡 검수 수신자 명단은 알림톡 검수에만 ·
 *          담당자 링크(토큰 # 뒤) = 단축 주소 클릭이 고객 클릭으로 기록되지 않는다 · 정지 링크 = 단축(실패 = 원래 주소).
 * B-1028-2 구성 상품 수 = 실리는 상품(사진 있는 것) · 요청 본문 · 서버 조립과 같은 목록.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';

const db = vi.hoisted(() => ({ rows: [] as any[], calls: [] as Array<{ sql: string; params: any[] }> }));
vi.mock('../../config/database', () => {
  const q = vi.fn(async (sql: string, params: any[] = []) => { db.calls.push({ sql, params }); return { rows: db.rows }; });
  return { default: { query: q, connect: vi.fn() }, query: q, pool: { query: q, connect: vi.fn() } };
});
const short = vi.hoisted(() => ({ fail: false }));
vi.mock('../short-url', async (orig) => ({
  ...(await orig() as any),
  createShortUrl: vi.fn(async () => { if (short.fail) throw new Error('db down'); return { hash: 'aB3xY9zQ', shortUrl: 'https://app.hanjul.ai/c/aB3xY9zQ' }; }),
}));

import { pickOwnerContact } from '../owner-contact';
import { buildJourneyPauseShortUrl } from '../journey-pause-handler';
import { isManagerLinkUrl, MANAGER_LINK_PATHS } from '../short-url';
import { lineCompositionReady, lineCompositionGoods, lineTemplateCount } from '../../../../frontend/src/utils/one-line';

const SRC_ROOT = resolve(__dirname, '..', '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== '__tests__' && n !== 'node_modules') walk(p, out); }
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}
const SOURCES = walk(SRC_ROOT).map((p) => ({ rel: relative(SRC_ROOT, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }));

beforeEach(() => { db.rows = []; db.calls = []; short.fail = false; });

describe('B-1028-1 받는 사람 = 주인 한 함수', () => {
  it('만든 계정 번호가 맞으면 그 계정 · 아니면 회사 관리자 · 번호 꼴이 아니면 건너뜀', async () => {
    db.rows = [{ id: 'creator', phone: '' }, { id: 'admin1', phone: '010-1234-5678' }];
    expect(await pickOwnerContact('c1', 'creator')).toEqual({ userId: 'admin1', phone: '01012345678' });
    db.rows = [{ id: 'creator', phone: '010 9999 0000' }, { id: 'admin1', phone: '01012345678' }];
    expect(await pickOwnerContact('c1', 'creator')).toEqual({ userId: 'creator', phone: '01099990000' });
    db.rows = [];
    expect(await pickOwnerContact('c1', null)).toBeNull();
    // 정렬 = 만든 계정 먼저(SQL 안 · 화면 순서와 무관)
    expect(db.calls[0].sql).toContain('ORDER BY (id = $1::uuid) DESC');
    expect(db.calls[0].sql).toContain("user_type = 'admin'");
  });
  it('여정 안내 두 종 · 자동마케팅 · 플래너 = 같은 함수를 부른다', () => {
    const src = (f: string) => SOURCES.find((s) => s.rel === f)!.text;
    expect(src('utils/journey-pretest-notifier.ts')).toContain('await pickOwnerContact(b.companyId, b.createdBy || null)');
    // ★ 1031 결과 안내 = 칸 · 날짜 CT(journey-result-notice)로 옮김 · 같은 함수
    expect(src('utils/journey-result-notice.ts')).toContain('await pickOwnerContact(row.company_id, row.created_by || null)');
    expect(src('utils/campaign-sync-worker.ts')).not.toMatch(/kakao_alarm_users|resolveManagerPhone/);
    expect(src('utils/continuous-operator.ts')).toContain('await pickOwnerContact(operator.companyId, operator.createdBy || null)');
    expect(src('utils/planner-recheck.ts').match(/pickOwnerContact\(p\.ev\.companyId, p\.ev\.createdBy\)/g)).toHaveLength(2);
    // 같은 판정의 사본 0(옛 이름 · 옛 조회)
    expect(SOURCES.filter((s) => /pickOperatorFallbackContact\s*\(/.test(s.text)).map((s) => s.rel)).toEqual([]);
  });
  it('알림톡 검수 수신자 명단을 읽는 곳 = 알림톡 검수 두 파일뿐(원천에서 뽑음)', () => {
    const readers = SOURCES.filter((s) => /FROM\s+kakao_alarm_users/.test(s.text)).map((s) => s.rel).sort();
    expect(readers).toEqual(['routes/alimtalk.ts', 'utils/alimtalk-jobs.ts']);
  });
});

describe('B-1028-1 담당자 링크 = 고객 클릭 아님 · 정지 링크 단축', () => {
  it('토큰을 # 뒤에 싣는 링크 경로 전부가 담당자 링크 목록에 있다(원천에서 뽑음)', () => {
    const paths = new Set<string>();
    for (const s of SOURCES) for (const m of s.text.matchAll(/\/([a-z][a-z-]+)#t=\$\{/g)) paths.add(m[1]);
    expect(paths.size).toBeGreaterThanOrEqual(6);
    for (const p of paths) {
      expect(MANAGER_LINK_PATHS as readonly string[]).toContain(p);
      expect(isManagerLinkUrl(`https://hanjul.ai/${p}#t=abc`)).toBe(true);
    }
    expect(isManagerLinkUrl('https://brand.naver.com/3ce/products/1')).toBe(false);
    expect(isManagerLinkUrl('https://shop.example.com/journey-pause-sale')).toBe(false);
    // 이동 처리가 이 판정 한 곳을 쓴다
    expect(SOURCES.find((s) => s.rel === 'routes/short-url.ts')!.text).toContain('if (isManagerLinkUrl(resolved.fullUrl)) {');
  });
  it('정지 링크 = 단축 주소 · 단축 실패 = 원래 주소(안내는 그대로 간다)', async () => {
    expect(await buildJourneyPauseShortUrl('c1', 'tok.sig')).toBe('https://app.hanjul.ai/c/aB3xY9zQ');
    short.fail = true;
    expect(await buildJourneyPauseShortUrl('c1', 'tok.sig')).toBe('https://hanjul.ai/journey-pause#t=tok.sig');
    expect(SOURCES.find((s) => s.rel === 'utils/journey-pretest-notifier.ts')!.text).toContain('pauseUrl = await buildJourneyPauseShortUrl(b.companyId, pauseToken);');
  });
});

describe('B-1028-2 구성 상품 수 = 실리는 상품', () => {
  const manual = (name: string, image: string | null) => ({ name, price: '21,000', image, url: 'https://brand.naver.com/x' });
  it('사진 없는 직접 상품은 세지 않는다 · 사진을 넣으면 센다 · 칸 상한은 담은 수 전부', () => {
    const a: any = { picks: [], manualList: [manual('겨울철 건조한 입술 위한 립밤', null)] };
    expect(lineTemplateCount(a)).toBe(1);
    expect(lineCompositionReady(a, 5)).toEqual({ count: 0, names: [], missingPhoto: 1, overCap: 0 });
    const b: any = { picks: [], manualList: [manual('립밤', '/api/uploads/x.jpg')] };
    expect(lineCompositionReady(b, 5).count).toBe(1);
    // 요청 본문 목록(lineCompositionGoods)과 같은 수
    const c: any = { picks: [{ name: 'p', imageUrl: 'https://img/1.jpg' }, { name: 'q', imageUrl: null }], manualList: [manual('m1', '/a.jpg'), manual('m2', null)] };
    const g = lineCompositionGoods(c, 5);
    expect(lineCompositionReady(c, 5).count).toBe(g.picks.length + g.manual.length);
    expect(lineCompositionReady(c, 5)).toEqual({ count: 2, names: ['p', 'm1'], missingPhoto: 2, overCap: 0 });
    // 상한 넘음은 사진 없음과 따로 센다(Codex 1R · 사진 있는 6개를 상한 5 구성으로 바꾼 경우)
    const six: any = { picks: [1, 2, 3, 4, 5, 6].map((i) => ({ name: `s${i}`, imageUrl: `https://img/${i}.jpg` })), manualList: [] };
    expect(lineCompositionReady(six, 5)).toMatchObject({ count: 5, missingPhoto: 0, overCap: 1 });
  });
  it('서버 조립도 사진 없는 직접 상품을 뺀다(화면 · 서버 같은 규칙)', () => {
    const idx = SOURCES.find((s) => s.rel === 'utils/one-line-ct/index.ts')!.text;
    expect(idx.slice(idx.indexOf('export function lineCookManual'), idx.indexOf('export function lineCookMaterials'))).toContain('if (!r.image) return;');
  });
});
