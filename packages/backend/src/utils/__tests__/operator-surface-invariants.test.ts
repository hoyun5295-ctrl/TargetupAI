/**
 * 오퍼레이터 표면 단계(OUI) 불변식 (2026-08-21 신설, 전원 합의 브레인스토밍 결과)
 *
 * 체계: 허브(AiOperatorPage) = 보라 그라데이션 + 글로우(무접촉) / 메뉴 안 작업면 = `bg-slate-950` 단색 + 바이올렛 액센트.
 *   값은 `frontend/src/utils/operator-ui.ts`(`OUI_*`)가 소유하고 화면은 이름만 부른다.
 *
 * 이 파일이 잠그는 것 (전부 파일 지정 계약 + 값 대조: 오탐 0인 규칙만 둔다)
 *   1. 대상 목록 파일에는 바닥·헤더 바 **리터럴이 0회**이고 `OUI_PAGE`를 import한다(값이 CT에 있으면 페이지에 문자열이 남을 수 없다).
 *   2. 보호 목록(허브·DM 빌더·공개 정지 페이지·콘솔 성격 다크 페이지·슈퍼관리자 페이지)에는 `OUI_` 식별자가 0회다.
 *      두 목록의 교집합은 0이다. 목록 밖 파일은 이 테스트의 대상이 아니다(확장하려면 목록에 더한다).
 *   3. 허브 지면 리터럴은 허브 파일에 정확히 1회(토큰으로 옮기지 않는다: 0821 판정 "허브 무접촉").
 *   4. 값 계약(import로 런타임 값 대조, 색 축만): OUI_PAGE는 slate-950 단색이고 그라데이션(`via-`)이 아니다. OUI_HEADER는 경계선(`border-b`)을 가진다.
 *
 * ⛔ 넣지 않은 규칙: 아우라(`OperatorAura`) 포함 의무. 캔버스 뷰(여정 스튜디오·인앱 편집기)는 조건부로 빼므로 정적 판별이 안 된다.
 *   본문 폭(3xl/7xl)도 단정하지 않는다. 폭 정렬은 별건이다.
 *
 * 어느 CT를 쓰나: 뒤로가기를 따라 올라간 뿌리가 `/ai-operator`면 `OUI_` / 관리·조회면 `CUI_` / DM 편집기 안이면 `DM_`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { OUI_HEADER, OUI_PAGE, OUI_PAGE_CENTER } from '../../../../frontend/src/utils/operator-ui';

const PAGES = resolve(__dirname, '../../../../frontend/src/pages');
const read = (name: string) => readFileSync(resolve(PAGES, name), 'utf8');

/** 작업면 대상(뿌리 = /ai-operator). 새 화면은 여기 등재가 리뷰 항목이다. */
const OPERATOR_PAGES = [
  'ContinuousOperatorPage.tsx',
  'MarketingPlannerPage.tsx',
  'PlannerBriefPage.tsx',
  'MarketingCalendarPage.tsx',
  'AiMemoryPage.tsx',
  'AiUsagePage.tsx',
  'PerformancePage.tsx',
  'PredictiveDashboardPage.tsx',
  'QuickCampaignPage.tsx',
  'JourneysPage.tsx',
  'JourneyDetailPage.tsx',
  'JourneyStatsPage.tsx',
  'EmailCampaignsPage.tsx',
  'CdpSettingsPage.tsx',
  'InAppMessagesPage.tsx',
  'ImageStudioPage.tsx',
];

/** 보호 목록: 이 체계의 대상이 아니다. OUI_ 토큰을 쓰면 안 된다. */
const PROTECTED_PAGES = [
  'AiOperatorPage.tsx',      // 허브: 보라 지면·글로우 무접촉(0821 판정)
  'DmBuilderPage.tsx',       // 인라인 style + dm-tokens 체계(별건)
  'JourneyPausePage.tsx',    // 비로그인 공개 정지 페이지(아이덴티티 톤 유지)
  'DiagnosisPage.tsx',       // 다크이지만 오퍼레이터 뿌리가 아니다
  'CampaignAgencyPage.tsx',
  'Cafe24LaunchPage.tsx',
  'BestCopyPage.tsx',        // 슈퍼관리자(뒤로가기 = /admin)
  'AiTrainingDataPage.tsx',  // 슈퍼관리자(뒤로가기 = /admin)
];

/** 페이지에 남아 있으면 안 되는 바닥·헤더 바 리터럴 */
const FORBIDDEN_LITERALS = [
  'from-violet-900 via-fuchsia-900 to-violet-900',
  'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950',
  'from-slate-950 via-violet-950 to-slate-950',
  'className="min-h-screen bg-slate-950',
  'className="min-h-screen bg-gradient',
  'bg-violet-800/50',
];

const HUB_LITERAL = 'from-violet-900 via-fuchsia-900 to-violet-900';

describe('오퍼레이터 표면 단계(OUI) 불변식', () => {
  it('대상 목록: 바닥·헤더 바 리터럴 0회 + OUI_PAGE import', () => {
    const offenders: string[] = [];
    for (const name of OPERATOR_PAGES) {
      const src = read(name);
      if (!/from '\.\.\/utils\/operator-ui'/.test(src) || !/\bOUI_PAGE\b/.test(src)) offenders.push(`${name} :: OUI_PAGE import 없음`);
      for (const lit of FORBIDDEN_LITERALS) {
        if (src.includes(lit)) offenders.push(`${name} :: 리터럴 잔존 "${lit}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('보호 목록: OUI_ 식별자 0회, 대상 목록과 교집합 0', () => {
    const overlap = OPERATOR_PAGES.filter((n) => PROTECTED_PAGES.includes(n));
    expect(overlap).toEqual([]);
    const offenders: string[] = [];
    for (const name of PROTECTED_PAGES) {
      const src = read(name);
      if (/\bOUI_/.test(src)) offenders.push(`${name} :: OUI_ 사용`);
    }
    expect(offenders).toEqual([]);
  });

  it('허브 지면 리터럴은 허브 파일에 정확히 1회(토큰 이관 없음)', () => {
    const src = read('AiOperatorPage.tsx');
    const count = src.split(HUB_LITERAL).length - 1;
    expect(count).toBe(1);
  });

  it('값 계약(색 축): 작업면 바닥은 slate-950 단색, 헤더 바는 경계선을 가진다', () => {
    expect(OUI_PAGE).toContain('bg-slate-950');
    expect(OUI_PAGE).not.toContain('via-');
    expect(OUI_PAGE).not.toContain('violet-900');
    expect(OUI_PAGE_CENTER).toContain('bg-slate-950');
    expect(OUI_HEADER).toContain('border-b');
    expect(OUI_HEADER).toContain('sticky');
  });
});
