/**
 * ★ 2026-09-19 서수란 접수 `cmu6llzi206otjnluyg2vxl29` — 한줄로 선불 무통장입금 승인이 "입금자명 확인이 필요한 요청입니다.
 *   소명을 확인한 뒤 승인해주세요"로 실패했다(베이컨 20,000원 · 입금자 최규삼 = 명의 확인 보류 건).
 *
 * 원인: 관리 화면 "한줄로 충전" 탭은 대기 목록을 `/api/admin/charge-management`의 pendingRequests로 받는데, 그 조회에
 *   보류 컬럼 3개(held_reason·held_at·explanation_note)가 없었다. 화면은 보류인 줄 몰라 배지·사유·소명을 못 그리고
 *   승인 요청에 resolveHold를 싣지 않았다 → 승인 CT(deposit-approve.ts)가 거절. 같은 목록을 주는 `/deposit-requests`는 싣고 있었다.
 *
 * 계약: 대기 목록을 내려주는 두 조회가 **같은 보류 컬럼**을 싣는다 · 화면은 그 값으로 resolveHold를 정한다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function read(rel: string): string {
  const cands = [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), 'packages/backend', rel), path.resolve(process.cwd(), 'packages', rel.replace(/^\.\.\//, ''))];
  const p = cands.find((x) => fs.existsSync(x));
  if (!p) throw new Error('파일 없음: ' + rel);
  return fs.readFileSync(p, 'utf8');
}

/** `router.get('<route>'` 부터 다음 `router.` 까지 = 그 핸들러 본문 */
function handlerOf(src: string, route: string): string {
  const start = src.indexOf(`router.get('${route}'`);
  expect(start, `${route} 핸들러 없음`).toBeGreaterThan(-1);
  const next = src.indexOf('\nrouter.', start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

const HOLD_COLUMNS = ['dr.held_reason', 'dr.held_at', 'dr.explanation_note'];

describe('무통장입금 대기 목록 — 보류 컬럼', () => {
  const admin = read('src/routes/admin.ts');

  it('/charge-management 대기 목록(pendingRequests) 조회가 보류 컬럼 3개를 싣는다', () => {
    const h = handlerOf(admin, '/charge-management');
    const pendingSql = h.slice(h.indexOf('const pendingResult'), h.indexOf('ORDER BY dr.created_at DESC'));
    for (const col of HOLD_COLUMNS) expect(pendingSql, col).toContain(col);
  });

  it('/deposit-requests 목록도 같은 3개(두 입구가 같은 값을 준다)', () => {
    const h = handlerOf(admin, '/deposit-requests');
    for (const col of HOLD_COLUMNS) expect(h, col).toContain(col);
  });

  it('화면: 대기 목록 = charge-management pendingRequests · 승인 요청의 resolveHold = 그 행의 held_reason', () => {
    const dash = read('../frontend/src/pages/AdminDashboard.tsx');
    expect(dash).toContain('const pending = data.pendingRequests || [];');
    expect(dash).toContain('resolveHold: Boolean(depositTarget.held_reason)');
  });
});
