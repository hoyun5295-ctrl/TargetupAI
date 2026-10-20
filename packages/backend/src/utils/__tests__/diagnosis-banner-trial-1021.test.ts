/**
 * ★ 2026-10-21 진단 띠 혜택 노출 — Harold 「떠 있어도 아무도 안 한다 · 혜택이 안 보여서」 · 목업 B안(쿠폰) 선택
 *   목업 = docs/mockups/2026-10-21-diagnosis-banner-trial-mockup.html
 *
 * 처방 계약(DiagnosisHeroCard 유도 변형):
 *   ① 지급 가능 회사(showTrialReward = grantable 'available')에만 혜택 — 제목 · 부제 · 쿠폰(§6-2 거짓 약속 차단 그대로)
 *   ② 요금제 이름 · 월 금액 = plans 원장(공개 요금제 표 CT) · 금액 숫자를 코드에 쓰지 않는다 · 못 읽으면 금액 줄만 뺀다
 *   ③ 지급 불가 회사는 옛 띠 그대로(제목 · 진단서 부제 · 진단 시작)
 *   ④ 카드 전체가 버튼 — 쿠폰 안에 버튼을 다시 두지 않는다(버튼 안 버튼 금지)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const FE = join(__dirname, '../../../../frontend/src');
const CARD = readFileSync(join(FE, 'components/marketing-diagnosis/DiagnosisHeroCard.tsx'), 'utf-8');
const CT = readFileSync(join(FE, 'utils/plans-public.ts'), 'utf-8');

describe('진단 띠 쿠폰(B안)', () => {
  it('① 혜택은 지급 가능 회사에만 · 문구 = Harold 원문', () => {
    expect(CARD).toMatch(/const reward = showTrialReward;/);
    expect(CARD).toMatch(/\{reward \? \(/);
    expect(CARD).toContain('설문을 완료하시면 자동으로 7일 무료체험이 부여됩니다');
  });

  it('② 요금제 이름 · 월 금액 = 공개 요금제 표 CT · 금액 숫자 하드코딩 0 · 못 읽으면 금액 줄 없음', () => {
    expect(CARD).toMatch(/import \{ fetchPublicPlan, type PublicPlan \} from '\.\.\/\.\.\/utils\/plans-public';/);
    expect(CARD).toMatch(/fetchPublicPlan\('BASIC'\)/);
    expect(CARD).not.toMatch(/350,?000|35만/);
    expect(CARD).toMatch(/\{basic && basic\.monthlyPrice > 0 && \(/);
    expect(CT).toMatch(/fetch\('\/api\/plans'\)/);
    expect(CT).toMatch(/monthlyPrice: Number\(row\.monthly_price\) \|\| 0/);
  });

  it('③ 지급 불가 회사 = 옛 띠 그대로', () => {
    expect(CARD).toContain('지금 진단받아 보세요');
    expect(CARD).toContain('약 3분이면 AI가 잘하는 것과 아쉬운 것을 짚은 진단서를 드려요');
  });

  it('④ 쿠폰은 버튼 안의 span(버튼 안 버튼 0)', () => {
    const invite = CARD.slice(CARD.lastIndexOf('return ('));
    expect((invite.match(/<button/g) || []).length).toBe(1);
  });
});
