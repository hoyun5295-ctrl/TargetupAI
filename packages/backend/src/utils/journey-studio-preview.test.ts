/**
 * 여정 스텝 스튜디오 — 보이는 모습·바이트는 실제 나가는 형태여야 한다 (2026-08-08, Harold 접수)
 *
 * 기원
 *   0802에 스튜디오를 신설하면서 옛 검토 화면이 갖고 있던 합성 3종(변수 치환·(광고)·무료수신거부)을
 *   가져오지 않았다. 화면은 `%고객명%` 원문을 "보이는 모습"이라 부르고, 바이트는 순수 본문만 셌다.
 *
 * 못 박는 것
 *   1. 광고 합성분은 바이트에 든다 — SMS 90 경계에서 "통과"가 실제로는 초과다(돈·도달 축).
 *   2. 스튜디오가 그 축을 쓴다(소스 불변식 — 옛 형태로 되돌리면 실패).
 *   3. 저장 본문은 순수 상태 그대로다 — 합성은 표시·계산에서만(이중 부착 차단).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAdMessageFront, calculateSmsBytes } from '../../../frontend/src/utils/formatDate';

const STUDIO = resolve(process.cwd(), '../frontend/src/components/journey/JourneyStepStudio.tsx');
const studioSrc = () => readFileSync(STUDIO, 'utf8');
const OPT_080 = '0801234567';

describe('광고 합성분은 바이트에 든다', () => {
  it('SMS 경계 — 순수 본문이 90 안이어도 발송 형태는 넘을 수 있다', () => {
    // 한글 35자 = 70바이트. 순수 기준으로는 "70 / 90" 통과다.
    const raw = '가'.repeat(35);
    expect(calculateSmsBytes(raw)).toBeLessThanOrEqual(90);

    const composed = buildAdMessageFront(raw, 'SMS', true, OPT_080);
    expect(composed).toContain('(광고)');
    expect(composed).toContain('무료거부');
    expect(
      calculateSmsBytes(composed),
      '이 차이를 안 세면 "90 안"이라고 안심시킨 문안이 실제로는 초과로 나간다',
    ).toBeGreaterThan(90);
  });

  it('광고가 아니면 합성이 없어 바이트가 그대로다', () => {
    const raw = '가'.repeat(35);
    expect(calculateSmsBytes(buildAdMessageFront(raw, 'SMS', false, OPT_080))).toBe(calculateSmsBytes(raw));
  });
});

describe('스튜디오가 그 축을 쓴다', () => {
  it('바이트는 광고 합성 결과로 잰다 (순수 본문 계산으로 되돌리면 실패)', () => {
    const src = studioSrc();
    expect(src).toMatch(/calculateSmsBytes\(adComposed\)/);
    expect(
      src,
      '순수 본문만 세던 옛 형태가 남아 있으면 안 된다',
    ).not.toMatch(/calculateSmsBytes\(step\?\.messageTemplate/);
  });

  it('보이는 모습은 치환 + 광고 합성을 거친다', () => {
    const src = studioSrc();
    expect(src).toMatch(/buildAdMessageFront\(/);
    expect(src).toMatch(/mergeVarsPlain\(/);
    expect(src).toMatch(/buildAdSubjectFront\(/);
    expect(
      src,
      '원문을 그대로 "보이는 모습"이라 부르던 형태로 되돌아가면 안 된다',
    ).not.toMatch(/highlightVars\(step\.messageTemplate \|\| ''\)/);
  });

  it('샘플 고객이 없으면 지어내지 않고 그 사실을 알린다', () => {
    expect(studioSrc()).toMatch(/타겟 고객이 없어 원본으로 표시됩니다/);
  });
});

/**
 * ★ 2026-08-08 (Harold 접수) — AI 꾸미기에 컬럼 선택권이 없었다.
 *   선택권이 없는 정도가 아니라 **보유 컬럼 전체**를 넘겨 AI가 아무거나 골라 넣고 있었다.
 *   날짜축 빌더·AI Operator는 이미 "고른 것만 · 0개면 잠금" 규약을 쓴다.
 */
describe('AI 꾸미기 — 고른 컬럼만 넘긴다', () => {
  it('전체 컬럼을 통째로 넘기던 형태가 남아 있지 않다', () => {
    const page = readFileSync(resolve(process.cwd(), '../frontend/src/pages/JourneysPage.tsx'), 'utf8');
    expect(
      page,
      '전체를 넘기면 사용자가 고르지 않은 컬럼이 문안에 들어간다',
    ).not.toMatch(/handleAnchorDecorate\(body, dataProfileVars\.map/);
    expect(page).toMatch(/handleAnchorDecorate\(body, selectedTokens\)/);
  });

  it('선택 0개면 꾸미기가 잠긴다 (다른 두 화면과 같은 규약)', () => {
    expect(studioSrc()).toMatch(/disabled=\{aiBusy \|\| selectedVars\.size === 0\}/);
  });

  it('칩은 토큰을 들고 라벨을 보여 준다 (꾸미기 API가 받는 값이 토큰이다)', () => {
    const src = studioSrc();
    expect(src).toMatch(/selectedVars\.has\(v\.token\)/);
    expect(src).toMatch(/onDecorate\(index, Array\.from\(selectedVars\)\)/);
  });
});

describe('저장 본문은 순수 상태 그대로', () => {
  it('합성 결과를 messageTemplate에 되쓰지 않는다 (이중 부착 차단)', () => {
    const src = studioSrc();
    expect(src).not.toMatch(/onPatch\([^)]*messageTemplate:\s*(adComposed|previewBody)/);
    expect(src).not.toMatch(/messageTemplate:\s*buildAdMessageFront/);
  });

  it('본문 편집 textarea는 순수 본문을 그대로 보여 준다', () => {
    expect(studioSrc()).toMatch(/value=\{step\.messageTemplate \|\| ''\}/);
  });
});
