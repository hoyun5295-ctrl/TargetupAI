/**
 * 인앱 통계 드릴다운 — AI 영향 요인 분석은 누를 때만 (★2026-09-26 한줄로 V2 R1-42)
 *
 * 옛: 드릴다운 창을 열 때마다 /inapp/explain(유료 AI · 1크레딧)을 자동 호출했다 → 통계만 보려 해도 크레딧이 빠졌다.
 * 처방: 창은 통계·열람 목록만 불러오고, AI 분석은 버튼 1클릭(라벨 단가 = 원장 AI_GENERATE_COSTS).
 *   다른 메시지로 옮겨 가면 늦게 온 분석 응답은 버린다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const page = readFileSync(join(FE, 'pages', 'InAppMessagesPage.tsx'), 'utf8');
const credit = readFileSync(join(FE, 'constants', 'credit.ts'), 'utf8');

describe('드릴다운 AI 분석 = 버튼', () => {
  it('창 열기(openDrillDown)는 /inapp/explain을 부르지 않는다', () => {
    const open = page.slice(page.indexOf('const openDrillDown = async'), page.indexOf('const requestDrillExplain = async'));
    expect(open.length).toBeGreaterThan(0);
    expect(open).not.toContain('/api/cdp/inapp/explain');
  });

  it('버튼 함수가 부르고, 늦은 응답은 버린다', () => {
    const req = page.slice(page.indexOf('const requestDrillExplain = async'), page.indexOf('const requestDrillExplain = async') + 1200);
    expect(req).toContain("fetch('/api/cdp/inapp/explain'");
    expect(req).toContain('if (drillIdRef.current !== id) return;');
  });

  it('라벨 단가는 원장에서 읽는다', () => {
    expect(page).toContain("AI_GENERATE_COSTS['inapp-explainer']");
    expect(credit).toMatch(/'inapp-explainer': 1,/);
  });
});

describe('같은 패턴 — 데이터 분석 창(자사몰 설정)', () => {
  const cdp = readFileSync(join(FE, 'pages', 'CdpSettingsPage.tsx'), 'utf8');
  it('창을 열 때 AI 진단(유료)을 자동으로 부르지 않는다(창 안 버튼으로만)', () => {
    expect(cdp).not.toMatch(/activeModal === 'analytics' && isAdmin\) loadExplanation\(\)/);
    expect(cdp).toContain('onStartExplain={loadExplanation}');
  });
});
