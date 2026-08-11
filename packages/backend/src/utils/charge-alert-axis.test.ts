/**
 * 슈퍼관리자 요금/정산 대기 뱃지 축 (★ 2026-08-11 · 서수란 접수 "(슈퍼관리자) 충전관리").
 *
 * 접수: "요금/정산 > 충전관리도 새로고침을 하지 않으면 요청에 대한 내용이 확인되지 않는다.
 *        새로고침이 없어도 고객이 신청을 하면 탭에 알림표시가 바로되면 좋겠다."
 *
 * 뿌리는 0808 발신번호 건과 같다 — **알림의 수명이 화면·새로고침에 묶여 있었다.** 그때는 발신번호 축만
 * 60초 주기로 풀었고 요금/정산 뱃지 3종(플랜 신청·충전 관리·크레딧 관리)은 초기 1회 로드가 전부였다.
 *
 * 함께 닫은 것 둘:
 *  ① **뱃지를 목록 길이로 셌다** — 크레딧 목록은 pageSize 20이라 대기 25건이 20으로 보이고,
 *     목록은 그 화면에 들어가야 채워진다. 뱃지의 진실을 카운트 state 하나로 옮긴다.
 *  ② **에이전트 충전 요청이 뱃지에 없었다** — `AgentChargePanel` 안에서만 로드돼서, 고객사가 올린
 *     신청이 새로고침을 해도 상단 뱃지에 뜨지 않았다(접수 문구의 "고객이 신청을 하면"에 이 축도 포함된다).
 *
 * 프론트에는 러너가 없어(vitest devDep 없음) 화면 계약을 여기서 소스로 고정한다
 * (선례 = sender-alert-axis.test.ts · brand-axis-invariants.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const admin = readFileSync(join(__dirname, '../../../frontend/src/pages/AdminDashboard.tsx'), 'utf8');
const panel = readFileSync(join(__dirname, '../../../frontend/src/components/AgentChargePanel.tsx'), 'utf8');

/** 주석은 검사 대상이 아니다 — 주석에 남은 옛 서술만으로 통과·실패하면 검출기가 거짓말을 한다. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = stripComments(admin);
const panelCode = stripComments(panel);
const norm = (s: string) => s.replace(/\s+/g, ' ');

describe('요금/정산 뱃지 — 목록이 아니라 카운트를 보고, 화면을 안 열어도 갱신된다', () => {
  it('뱃지 3종이 카운트 state를 쓴다 — 목록 길이를 쓰면 화면에 들어가야 값이 생긴다', () => {
    const n = norm(code);
    expect(n, '플랜 신청 뱃지가 카운트 state가 아니다').toContain(
      "label: '플랜 신청', badge: planReqPendingCount",
    );
    expect(n, '충전 관리 뱃지가 카운트 state가 아니다').toContain(
      "label: '충전 관리', badge: depositPendingCount + agentOrderPendingCount",
    );
    expect(n, '크레딧 관리 뱃지가 카운트 state가 아니다').toContain(
      "label: '크레딧 관리', badge: creditPendingCount",
    );
  });

  it('옛 형태(목록 길이 뱃지)가 되살아나지 않는다 — 이 접수의 결함 그 자체', () => {
    const n = norm(code);
    expect(n, '충전 관리 뱃지가 다시 목록 길이다').not.toContain("label: '충전 관리', badge: pendingDeposits.length");
    expect(n, '크레딧 뱃지가 다시 목록 길이다').not.toContain("label: '크레딧 관리', badge: creditRequests.length");
    expect(n, '플랜 신청 뱃지가 다시 목록 필터 길이다').not.toMatch(
      /label: '플랜 신청', badge: planRequests\.filter/,
    );
  });

  it('충전 관리 뱃지는 두 신청 축의 합 — 한 축만 세면 다른 축의 대기가 사라진다', () => {
    // 웹 무통장입금(deposit_requests) + 에이전트 충전 요청(agent_charge_orders) 둘 다 "고객이 올린 신청"이다.
    expect(norm(code)).toContain('badge: depositPendingCount + agentOrderPendingCount');
    expect(panelCode, '접수함 건수를 상위로 올리지 않는다 — 패널을 연 사람만 보게 된다').toContain(
      'onPendingOrdersChange?.(rows.length)',
    );
    expect(norm(code), '패널에 카운트 콜백을 넘기지 않는다').toContain(
      '<AgentChargePanel onPendingOrdersChange={setAgentOrderPendingCount} />',
    );
  });

  it('카운트 조회가 주기로 돈다 — 0808 tick에 태우고 새 타이머를 만들지 않는다', () => {
    expect(norm(code), '주기 조회에 요금/정산 카운트가 없다').toContain(
      'await Promise.allSettled([loadSenderRegPendingCount(), loadPendingBadges()])',
    );
    // 0808이 만든 가드 — 이번 축이 얹혀도 그대로여야 한다(백그라운드 건너뜀·언마운트 정리).
    expect(code, '주기 로드가 없다').toContain('setInterval(tick, 60000)');
    expect(code, '언마운트에서 타이머를 걷지 않는다').toContain('clearInterval(timer)');
    expect(code, '돌아왔을 때 값을 맞추지 않는다').toContain("document.addEventListener('visibilitychange', tick)");
  });

  it('못 센 축(null)을 0으로 덮지 않는다 — 0은 "볼 일 없음"이라 대기가 뱃지에서 사라진다', () => {
    const n = norm(code);
    expect(n, 'planRequests null 가드가 없다').toContain('if (d.planRequests != null)');
    expect(n, 'deposits null 가드가 없다').toContain('if (d.deposits != null)');
    expect(n, 'agentChargeOrders null 가드가 없다').toContain('if (d.agentChargeOrders != null)');
    expect(n, 'credits null 가드가 없다').toContain('if (d.credits != null)');
  });

  it('승인·반려 직후 즉시 반영이 남아 있다 — 주기 조회가 생겼다고 60초를 기다리게 하지 않는다', () => {
    // 크레딧은 목록이 페이지 단위라 길이로 셀 수 없다 → 승인·반려 경로가 카운트를 따로 다시 부른다.
    const calls = code.split('loadPendingBadges()').length - 1;
    expect(calls, `카운트 재조회 지점이 줄었다(현재 ${calls}곳 — 주기 1 + 승인/거절 2 이상)`).toBeGreaterThanOrEqual(3);
  });
});
