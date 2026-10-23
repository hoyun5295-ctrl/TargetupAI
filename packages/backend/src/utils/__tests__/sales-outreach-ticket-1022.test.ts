/**
 * ★2026-10-22 AI영업 접수(서수란) — 혜택 면허 완화(Harold 결정) · 포스터 꼬리표 대비 · 뒤로가기 왕복.
 *   1-1 · 1-2 제시뉴욕 「아울렛 시즌오프 30%+40%」 · 빽다방 「말차 전 메뉴 2,026원」 — 본문 인용 후보는 종료일이 없으면 면허가 없어 수치가 모든 채널에서 빠졌다.
 *        빽다방 「20주년 아메리카노 1천원(8/19~8/21)」은 10/21 에 끝난 행사인데 「진행 중 소식」으로 실렸다.
 *   1-3 토니모리 포스터 업종 꼬리표 — 원본 브랜드색(흰색) 바탕에 흰 글자.
 *   A   작업대 ← = 앞 칸 · 상세 「작업대」 = 새 칸이라 ← 마다 작업대와 상세를 왕복했다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { benefitLicenseOf, isEndedEvent, filterQuoteCandidates, eventCandidatesFromCards } from '../sales-outreach-jobs';
import { confirmedEventLines, buildPosterTypography, eventCtaLabel } from '../sales-outreach-produce';
import { accessiblePrimaryOf, OUTREACH_NEUTRAL_PRIMARY } from '../sales-outreach-look';

const NOW = new Date('2026-10-21T15:00:00+09:00');

describe('혜택 면허 판정 하나 — benefitLicenseOf · isEndedEvent', () => {
  it('종료일이 미래면 면허 · 지났으면 면허 없음(오늘 걸려 있어도)', () => {
    expect(benefitLicenseOf('2026-10-31', false, NOW)).toBe(true);
    expect(benefitLicenseOf('2026-08-21', true, NOW)).toBe(false);
  });
  it('종료일이 없으면 오늘 걸려 있을 때만 면허', () => {
    expect(benefitLicenseOf(null, true, NOW)).toBe(true);
    expect(benefitLicenseOf(null, false, NOW)).toBe(false);
  });
  it('끝난 행사 = 종료일을 아는데 지났을 때만', () => {
    expect(isEndedEvent('2026-08-21', NOW)).toBe(true);
    expect(isEndedEvent('2026-10-21', NOW)).toBe(false);
    expect(isEndedEvent(null, NOW)).toBe(false);
  });
});

describe('본문 인용 후보 — 실측 두 업체 재현', () => {
  it('제시뉴욕: 종료일 없는 「아울렛 시즌오프 30%+40%」 = 면허', () => {
    const home = '아울렛 시즌오프 30%+40% 가을 특가 SALE 진행 중';
    const r = filterQuoteCandidates([{ quote: '아울렛 시즌오프 30%+40%', end_date: null }], { home }, { home: 'https://jessinewyork.com' }, NOW);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].benefitLicensed).toBe(true);
  });
  it('빽다방: 8/21 에 끝난 행사는 후보에서 빠지고 종료일 없는 말차 프로모션은 면허', () => {
    const home = '2026년 말의해 맞이 말차 전 메뉴 2,026원 프로모션 (1/2~) · 빽다방 20주년 기념 아메리카노(ICED) 1천원에 만나보세요! (8/19~8/21)';
    const r = filterQuoteCandidates(
      [{ quote: '빽다방 20주년 기념 아메리카노(ICED) 1천원에 만나보세요!', end_date: '2026-08-21' }, { quote: '2026년 말의해 맞이 말차 전 메뉴 2,026원 프로모션', end_date: null }],
      { home }, { home: 'https://paikdabang.com' }, NOW,
    );
    expect(r.meta.endedDropped).toBe(1);
    expect(r.candidates.map((c) => c.quote)).toEqual(['2026년 말의해 맞이 말차 전 메뉴 2,026원 프로모션']);
    expect(r.candidates[0].benefitLicensed).toBe(true);
  });
  it('주변에서 빌린 지난 날짜(앞 행사의 기간일 수 있다)로는 빼지 않고 면허만 없다', () => {
    const home = '지난 이벤트 크림대전 2026.01.01 ~ 2026.01.31 겨울 담요 특가 진행 중';
    const r = filterQuoteCandidates([{ quote: '겨울 담요 특가 진행 중', end_date: null }], { home }, { home: 'https://a.com' }, NOW);
    expect(r.meta.endedDropped).toBe(0);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ endDate: '2026-01-31', benefitLicensed: false });
  });
  it('카드 후보는 종전 규칙 그대로(홈 게시 = 면허 · 홈에 없고 종료일 없음 = 면허 없음 · 끝난 카드 = 후보 아님)', () => {
    const cards = [
      { title: '홈 걸린 기획전', startDate: null, endDate: null, periodRaw: null, imageUrl: null, linkUrl: null, homeLinked: true },
      { title: '목록에만 있는 기획전', startDate: null, endDate: null, periodRaw: null, imageUrl: null, linkUrl: null },
      { title: '지난 체험단', startDate: null, endDate: '2026-08-31', periodRaw: null, imageUrl: null, linkUrl: null },
    ] as any[];
    const c = eventCandidatesFromCards(cards, 'https://a.com/event', NOW);
    expect(c.map((x) => [x.title, x.benefitLicensed])).toEqual([['홈 걸린 기획전', true], ['목록에만 있는 기획전', false]]);
  });
});

describe('제안 메일 「이번 시안에 담은 소식」 줄 — 면허를 따른다', () => {
  it('면허 있음 = 제목 + 혜택 + 기간', () => {
    expect(confirmedEventLines([{ title: '아울렛 시즌오프', benefit: '30%+40%', licensed: true }])).toEqual(['아울렛 시즌오프 30%+40%']);
    expect(confirmedEventLines([{ title: '2026년 말의해 맞이 ‘말차’', benefit: '전 메뉴 2,026원 프로모션', periodRaw: '(1/2~)', licensed: true }]))
      .toEqual(['2026년 말의해 맞이 ‘말차’ 전 메뉴 2,026원 프로모션 · 기간 (1/2~)']);
  });
  it('★Codex 1R — 소수 금액 · 퍼센트는 날짜로 걷지 않는다(129.5만원 → 1 만원 금지)', () => {
    expect(confirmedEventLines([{ title: '가전 가을특가 129.5만원', licensed: true }])).toEqual(['가전 가을특가 129.5만원']);
    expect(confirmedEventLines([{ title: '시즌오프 추가 12.5% 할인', licensed: true }])).toEqual(['시즌오프 추가 12.5% 할인']);
    expect(confirmedEventLines([{ title: '1,299.9원 균일가 기획전', licensed: true }])).toEqual(['1,299.9원 균일가 기획전']);
  });
  it('★Codex 2R — 범위 할인율은 통째로 보존한다(9.3~9.9% → 9.9% 금지)', () => {
    expect(confirmedEventLines([{ title: '9.3~9.9% 신규 가입 할인', licensed: true }])).toEqual(['9.3~9.9% 신규 가입 할인']);
    expect(confirmedEventLines([{ title: '가을 세일 10~30% 할인', licensed: true }])).toEqual(['가을 세일 10~30% 할인']);
  });
  it('면허 없는 제목은 범위 금액을 통째로 걷는다(앞 끝 숫자만 남지 않는다)', () => {
    expect(confirmedEventLines([{ title: '9.3~9.9% 신규 가입 할인', licensed: false }])).toEqual(['신규 가입 할인']);
    expect(confirmedEventLines([{ title: '가을 세일 10~30% 할인', licensed: false }])).toEqual(['가을 세일 할인']);
  });
  it('★Codex 2R — 문장 쉼표 뒤 진짜 날짜는 걷는다', () => {
    expect(confirmedEventLines([{ title: '추석 기획전,9.1~9.6', licensed: true }])).toEqual(['추석 기획전']);
    expect(confirmedEventLines([{ title: '추석 기획전, 9.1(화) ~ 9.6(일)', licensed: true }])).toEqual(['추석 기획전']);
  });
  it('★Codex 3R — 「원피스 · 원데이」의 원은 금액 단위가 아니다(날짜는 걷고 행사명은 남긴다)', () => {
    for (const licensed of [true, false]) {
      expect(confirmedEventLines([{ title: '9.1~9.6 원피스 기획전', licensed }])).toEqual(['원피스 기획전']);
      expect(confirmedEventLines([{ title: '10/1~10/5 원데이 클래스', licensed }])).toEqual(['원데이 클래스']);
    }
    expect(eventCtaLabel({ title: '9.1~9.6 원피스 기획전' })).toBe('원피스 기획전 보기');
  });
  it('숫자에 붙은 원 · 띄어 쓴 원(뒤에 글자 없음)은 금액이다', () => {
    expect(confirmedEventLines([{ title: '아메리카노 1천원에 만나보세요', licensed: true }])).toEqual(['아메리카노 1천원에 만나보세요']);
    expect(confirmedEventLines([{ title: '아메리카노 1천원에 만나보세요', licensed: false }])).toEqual(['아메리카노 에 만나보세요']);
    expect(confirmedEventLines([{ title: '전 메뉴 균일 3,000 원 행사', licensed: true }])).toEqual(['전 메뉴 균일 3,000 원 행사']);
  });
  it('★Codex 4R — 띄어 쓴 만원 · 천원 뒤에 조사가 와도 소수 가격 · 범위를 통째로 보존한다', () => {
    expect(confirmedEventLines([{ title: '신상 특가 1.5 만원에', licensed: true }])).toEqual(['신상 특가 1.5 만원에']);
    expect(confirmedEventLines([{ title: '커피 3.5 천원에 드려요', licensed: true }])).toEqual(['커피 3.5 천원에 드려요']);
    expect(confirmedEventLines([{ title: '패딩 1.5~2.5 만원에 만나요', licensed: true }])).toEqual(['패딩 1.5~2.5 만원에 만나요']);
  });
  it('진짜 날짜 조각은 종전대로 걷는다', () => {
    expect(confirmedEventLines([{ title: '9.1(화) ~ 9.6(일) 추석 기획전', licensed: true }])).toEqual(['추석 기획전']);
    expect(confirmedEventLines([{ title: '8/19~8/21 20주년 기념 행사', licensed: true }])).toEqual(['20주년 기념 행사']);
    expect(confirmedEventLines([{ title: '10월 22일 오픈 기념 이벤트', licensed: true }])).toEqual(['오픈 기념 이벤트']);
  });
  it('혜택이 제목에 이미 있으면 겹치지 않는다', () => {
    expect(confirmedEventLines([{ title: '아울렛 시즌오프 30%+40%', benefit: '30%+40%', licensed: true }])).toEqual(['아울렛 시즌오프 30%+40%']);
  });
  it('면허 없음 = 종전(수치 걷은 제목 · 혜택 안 실음)', () => {
    expect(confirmedEventLines([{ title: '추석 특별 기획전 최대 50%', benefit: '최대 50%', licensed: false }])).toEqual(['추석 특별 기획전']);
    expect(confirmedEventLines([{ title: '추석 특별 기획전 최대 50%' }])).toEqual(['추석 특별 기획전']);
  });
});

describe('포스터 꼬리표 — 흰 글자 대비 보정 색', () => {
  const badge = (brandColor: string | null) => (buildPosterTypography({ label: '뷰티/화장품', title: '토니모리', subtitle: null, dropped: [] }, { brandColor, zone: 'top', fontPath: null }) as any[])
    .find((t) => t.role === 'badge').badgeColor;
  it('흰 브랜드색 = 짙은 무채색(흰 바탕에 흰 글자 0)', () => {
    expect(badge('#ffffff')).toBe(OUTREACH_NEUTRAL_PRIMARY);
  });
  it('밝은 브랜드색 = 대비 맞춘 색 · 색이 없으면 무채색', () => {
    expect(badge('#7fbf3f')).toBe(accessiblePrimaryOf('#7fbf3f'));
    expect(badge(null)).toBe(OUTREACH_NEUTRAL_PRIMARY);
  });
});

describe('AI영업 뒤로가기 — 위로 가는 이동 = 부모로 올라가기', () => {
  const fe = (p: string) => readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', p), 'utf8');
  it('상세 ← · 「작업대」 = 작업대로 올라가기 · 작업대 ← = 관리자 화면으로 올라가기', () => {
    const page = fe(join('pages', 'SalesOutreachPage.tsx'));
    expect(page).toContain("const toWorkbench = () => goUpTo(navigate, '/admin/outreach');");
    expect(page).toContain("const toAdmin = () => goUpTo(navigate, '/admin');");
    expect(page).toContain('onClose={toAdmin}');
    expect(page).toContain('onBack={toWorkbench}');
    expect(page).not.toMatch(/navigate\('\/admin(\/outreach)?'\)/);
  });
  it('작업대 머리 ← 가 onClose(관리자 화면으로 올라가기)를 쓴다', () => {
    const wb = fe(join('components', 'admin', 'SalesOutreachWorkbench.tsx'));
    expect(wb).toMatch(/backLabel="관리자 화면으로"\s*\r?\n\s*onBack=\{onClose\}/);
  });
});
