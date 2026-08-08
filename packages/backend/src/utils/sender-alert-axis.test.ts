/**
 * 슈퍼관리자 발신번호 알림 축 (★ 2026-08-08 · 임은지 접수 "슈퍼관리자 - 알림 & 발신번호 탭" + 남지현 댓글).
 *
 * 접수 3건이 뿌리 둘이었다.
 *  ① **축이 합쳐진 채 한 탭에 붙었다** — 서버 `getPendingCount()`는 `{ managers, registrations, total }`을
 *     주는데 화면이 합계(`count`) 하나만 받아 **등록 신청 관리** 탭 뱃지로 썼다. 그래서 위임장(담당자) 대기가
 *     발신번호 신청 탭에 떴고, 알림을 보고 간 담당자는 빈 목록을 봤다
 *     (실측: `sender_registrations` pending 0 · approved 2인데 뱃지 1).
 *  ② **알림의 수명이 화면에 묶였다** — 카운트를 부르는 곳이 `activeTab === 'callbacks'` 한 줄뿐이라,
 *     상단 메뉴 뱃지인데 **그 화면에 들어가야 값이 생겼다.** 새로고침해도 안 뜨고 탭을 눌러야 떴다.
 *
 * 프론트에는 러너가 없어(vitest devDep 없음) 화면 계약을 여기서 소스로 고정한다
 * (선례 = brand-axis-invariants.test.ts — backend 러너가 frontend 소스를 읽는다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const admin = readFileSync(join(__dirname, '../../../frontend/src/pages/AdminDashboard.tsx'), 'utf8');
const norm = (s: string) => s.replace(/\s+/g, ' ');

/** 주석은 검사 대상이 아니다 — 주석에 남은 옛 서술만으로 통과·실패하면 검출기가 거짓말을 한다. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = stripComments(admin);

describe('발신번호 알림 — 축은 나뉘어 있고, 수명은 화면과 분리돼 있다', () => {
  it('카운트를 축마다 따로 담는다 — 합계를 신청 축에 담으면 위임장 대기가 남의 탭에 뜬다', () => {
    expect(code, '발신번호 신청 카운트를 registrations에서 받지 않는다').toContain(
      'setSenderRegPendingCount(Number(data.registrations ?? 0))',
    );
    expect(code, '위임장 카운트를 managers에서 받지 않는다').toContain(
      'setPendingManagerCount(Number(data.managers ?? 0))',
    );
    // 이 접수의 결함 그 자체 — 합계를 신청 축에 넣는 형태가 되살아나면 실패한다.
    expect(code, '합계(count)를 발신번호 신청 뱃지로 쓰고 있다').not.toMatch(
      /setSenderRegPendingCount\(\s*(Number\(\s*)?data\.count/,
    );
  });

  it('위임장 뱃지는 등록현황 관리 탭에 붙는다 — 옆 탭에 붙으면 빈 목록으로 안내한다', () => {
    const at = code.indexOf('등록현황 관리');
    expect(at, '등록현황 관리 탭을 찾지 못했다').toBeGreaterThan(-1);
    // 경계는 그 버튼의 닫힘까지 — 고정 길이로 자르면 남의 코드를 검사한다(0801 교훈).
    const tab = code.slice(at, code.indexOf('</button>', at));
    expect(tab, '등록현황 관리 탭에 위임장 대기 뱃지가 없다').toContain('pendingManagerCount');
  });

  it('상단 메뉴 뱃지는 두 축의 합 — 한 축만 세면 다른 축의 대기가 메뉴에서 사라진다', () => {
    expect(norm(code)).toContain("label: '발신번호 관리', badge: senderRegPendingCount + pendingManagerCount");
  });

  it('카운트 로드가 화면 진입에 갇혀 있지 않다 — 뱃지를 보려고 그 화면에 들어가야 하면 뱃지가 무의미하다', () => {
    expect(norm(code), '옛 형태(callbacks 탭 진입 시에만 로드)가 되살아났다').not.toContain(
      "activeTab === 'callbacks') { loadSenderRegPendingCount",
    );
    expect(code, '주기 로드가 없다').toContain('setInterval(tick, 60000)');
    expect(code, '언마운트에서 타이머를 걷지 않으면 화면을 떠난 뒤에도 돈다').toContain('clearInterval(timer)');
    expect(code, '백그라운드에서 건너뛴 값을 돌아왔을 때 맞추지 않는다').toContain(
      "document.addEventListener('visibilitychange', tick)",
    );
    expect(code, 'visibilitychange 리스너를 걷지 않는다').toContain(
      "document.removeEventListener('visibilitychange', tick)",
    );
  });

  it('승인·반려 직후 재조회는 그대로 남아 있다 — 주기 로드가 생겼다고 즉시 반영을 없애지 않는다', () => {
    // 위임장 승인/반려 핸들러 둘 다 카운트를 다시 부른다(60초를 기다리게 하지 않는다).
    const calls = code.split('loadSenderRegPendingCount()').length - 1;
    expect(calls, `승인·반려·재시도 경로의 재조회가 줄었다(현재 ${calls}곳)`).toBeGreaterThanOrEqual(4);
  });
});
