/**
 * 여정 AI 다듬기 — 후보 나열 폐기, 비포/애프터 한 쌍 (2026-08-08, Harold 접수)
 *
 * 접수 = "3종 의미가 없어, 비포 애프터처럼 보여주는 게 낫겠다".
 *   직접발송 모달은 이미 그 형태였고(D152-6 같은 지적이 기원), 여정만 후보를 세로로 쌓고 있었다.
 *
 * 못 박는 것
 *   1. 하이라이트 로직은 CT 하나가 소유한다 — 두 화면이 같은 것을 쓴다.
 *   2. 글자 단위 LCS다 — 어절 단위로 끊으면 "20분전"↔"20분 전"이 통째로 바뀐 것으로 나온다(D152-6 정정3).
 *   3. 화면이 한 안만 쓰면 서버도 한 안만 만든다 — 3안을 만들어 둘을 버리지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { highlightAdditions, highlightRemovals } from '../../../frontend/src/utils/text-diff';

const front = (rel: string) => readFileSync(resolve(process.cwd(), '../frontend/src', rel), 'utf8');
const joined = (chunks: Array<{ text: string; added: boolean }>) => chunks.map((c) => c.text).join('');
const addedText = (chunks: Array<{ text: string; added: boolean }>) =>
  chunks.filter((c) => c.added).map((c) => c.text).join('');

describe('하이라이트 — 무엇이 바뀌었는가', () => {
  it('원문을 잃지 않는다 (조각을 이으면 결과 그대로)', () => {
    const before = '고객님 안녕하세요.';
    const after = '고객님 안녕하세요. 오늘도 좋은 하루 되세요.';
    expect(joined(highlightAdditions(before, after))).toBe(after);
  });

  it('추가된 부분만 강조한다', () => {
    const chunks = highlightAdditions('첫 구매 감사합니다', '첫 구매 진심으로 감사합니다');
    expect(addedText(chunks)).toContain('진심으로');
    expect(addedText(chunks)).not.toContain('첫 구매');
  });

  it('띄어쓰기만 달라져도 통째로 바뀐 것으로 보지 않는다 (글자 단위 LCS)', () => {
    const chunks = highlightAdditions('20분전에 도착합니다', '20분 전에 도착합니다');
    expect(
      addedText(chunks).length,
      '어절 단위로 끊으면 문장 전체가 added가 된다(D152-6 정정3)',
    ).toBeLessThanOrEqual(1);
  });

  it('바뀐 게 없으면 강조도 없다', () => {
    const same = '고객님 안녕하세요.';
    expect(addedText(highlightAdditions(same, same))).toBe('');
  });

  it('삭제분은 방향을 뒤집어 얻는다', () => {
    const removed = highlightRemovals('첫 구매 진심으로 감사합니다', '첫 구매 감사합니다');
    expect(addedText(removed)).toContain('진심으로');
  });

  it('빈 값에서도 깨지지 않는다', () => {
    expect(joined(highlightAdditions('', '새 문안입니다'))).toBe('새 문안입니다');
    expect(joined(highlightAdditions('옛 문안입니다', ''))).toBe('');
  });
});

describe('두 화면이 같은 CT를 쓴다', () => {
  it('직접발송 모달이 자체 LCS를 다시 정의하지 않는다', () => {
    const src = front('components/AiRefineModal.tsx');
    expect(src).toMatch(/from '\.\.\/utils\/text-diff'/);
    expect(src, '같은 로직 두 벌은 한쪽만 고쳐진다').not.toMatch(/function highlightAdditions/);
  });

  it('여정 화면이 후보 나열 대신 하이라이트를 쓴다', () => {
    const src = front('pages/JourneysPage.tsx');
    expect(src).toMatch(/highlightAdditions\(before, cand\.message\)/);
    expect(src, '후보를 세로로 쌓던 형태가 남아 있으면 안 된다').not.toMatch(/AI 다듬기 — 3 톤 후보/);
    expect(src).toMatch(/이걸로 바꾸기/);
    expect(src, '마음에 안 들 때 다시 부를 길이 있어야 한다').toMatch(/다시 다듬기/);
  });

  it('여정 다듬기는 한 안만 요청한다', () => {
    expect(front('pages/JourneysPage.tsx')).toMatch(/variants: 1/);
  });
});

describe('서버도 한 안만 만든다', () => {
  const generator = () => readFileSync(resolve(process.cwd(), 'src/utils/journey-ai-generator.ts'), 'utf8');

  it('요청한 수만큼만 잘라 돌려준다 (3안 고정이 남아 있으면 실패)', () => {
    const src = generator();
    expect(src).toMatch(/const wantCount = input\.variants === 1 \? 1 : 3/);
    expect(src).toMatch(/\.slice\(0, wantCount\)/);
    expect(src, '3개 고정 절단이 남아 있으면 안 만든 후보를 세는 셈이다').not.toMatch(/raw\.slice\(0, 3\)/);
  });

  it('미지정이면 옛 흐름 3안 그대로다 (날짜축 등 다른 호출부 무영향)', () => {
    const route = readFileSync(resolve(process.cwd(), 'src/routes/ai.ts'), 'utf8');
    expect(route).toMatch(/variants: Number\(variants\) === 1 \? 1 : 3/);
  });
});
