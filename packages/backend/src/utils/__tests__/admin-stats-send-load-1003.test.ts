/**
 * 슈퍼관리자 발송 통계 진입 = 요청 1번 계약 (★2026-10-03 Harold 「발송 통계 들어갈 때 5초」)
 *
 * 왜 있나
 *   운영 실측(1003 23:24 · 23:25) — 메뉴로 들어갈 때마다 GET /api/admin/stats/send 가 같은 초에 두 번(200 + 304) 나갔다.
 *   메뉴 클릭이 조회를 부르고, 탭이 바뀌는 효과도 조회를 불렀다. 캐시가 빈 순간이면 3.6~3.9초짜리 집계
 *   (결과 확정 전 캠페인을 게이트웨이 테이블에서 셈 · [SLOW-STAGE] 실측)가 둘 동시에 돌았다.
 *
 * 못 박는 것
 *   1. 탭 진입 조회는 activeTab 효과 하나만 한다.
 *   2. 메뉴 항목은 이미 그 탭일 때(다시 누름)만 새로 조회한다.
 */
import { describe, it, expect } from 'vitest';
import { readAdminScreenSource } from './source-scan';

const page = readAdminScreenSource(); // ★ 2026-10-09 파일 분리 E 뒤 = 본체 + 옮겨 간 화면 합본

describe('발송 통계 진입 = 요청 1번', () => {
  it('탭 진입 조회는 activeTab 효과가 한다', () => {
    expect(page).toContain("useEffect(() => { if (activeTab === 'stats') loadSendStats(1); }, [activeTab]);");
  });

  it('메뉴 항목은 이미 발송 통계일 때만 다시 조회한다(진입 때 같이 부르지 않는다)', () => {
    expect(page).toContain("{ key: 'stats', label: '발송 통계', onClick: () => { if (activeTab === 'stats') loadSendStats(); } },");
    expect(page).not.toContain("{ key: 'stats', label: '발송 통계', onClick: () => loadSendStats() },");
  });

  it('메뉴 클릭 처리 순서 — 탭을 바꾼 뒤 항목 onClick 을 부른다(그 순간 activeTab 은 아직 옛 탭이라 진입이면 조회하지 않는다)', () => {
    const at = page.indexOf('setActiveTab(item.key);');
    expect(at).toBeGreaterThan(-1);
    expect(page.indexOf('item.onClick?.();', at)).toBeGreaterThan(at);
  });
});
