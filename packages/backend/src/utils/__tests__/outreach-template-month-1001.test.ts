/**
 * ★ 2026-10-01 AI 영업 포스터 템플릿 자동 선택 = 이번 달(한국 시간)에 어울리는 것만 (서수란 접수 · 금강제화 9월 말 눈·보름달 송편)
 *
 * 닫힘 사슬
 *   ① 계약 — 달 표의 id 는 실제 템플릿 · 달력 묶음(시즌·명절 행사 · 데이·기념일 · 시즌) 템플릿은 표 또는 연중 목록에 있다
 *      (새 계절 템플릿이 표 없이 들어오면 여기서 빨간불 · 표와 연중 목록은 겹치지 않는다 · 달 값 1~12)
 *   ② 동작 — 모든 업종 × 제품/행사 × 12달에서 고른 템플릿이 그 달에 맞는다 · 9월 말 패션 행사형에서 겨울·크리스마스·설 0
 */
import { describe, it, expect } from 'vitest';
import { STUDIO_TEMPLATES } from '../image-studio-templates';
import { INDUSTRY_CODES } from '../industry-codes';
import { pickTemplate, templateFitsMonth, OUTREACH_TEMPLATE_MONTHS, OUTREACH_TEMPLATE_ANY_MONTH } from '../sales-outreach-produce';

const DATED_CATEGORIES = ['시즌·명절 행사', '데이·기념일', '시즌'];
const ids = new Set(STUDIO_TEMPLATES.map((t) => t.id));
/** 한국 시간 그 달 15일 정오 */
const kst = (y: number, m: number, d = 15) => new Date(Date.UTC(y, m - 1, d, 3, 0, 0));

describe('① 달 표 계약', () => {
  it('표의 id 는 전부 실제 템플릿 · 달 값은 1~12', () => {
    for (const [id, months] of Object.entries(OUTREACH_TEMPLATE_MONTHS)) {
      expect(ids.has(id), id).toBe(true);
      expect(months.length, id).toBeGreaterThan(0);
      for (const m of months) expect(m >= 1 && m <= 12, `${id}:${m}`).toBe(true);
    }
    for (const id of OUTREACH_TEMPLATE_ANY_MONTH) expect(ids.has(id), id).toBe(true);
  });
  it('달력 묶음 템플릿은 모두 표 또는 연중 목록에 있다 · 둘은 겹치지 않는다', () => {
    const anyMonth = new Set(OUTREACH_TEMPLATE_ANY_MONTH);
    for (const t of STUDIO_TEMPLATES.filter((x) => DATED_CATEGORIES.includes(x.category))) {
      expect(t.id in OUTREACH_TEMPLATE_MONTHS || anyMonth.has(t.id), `${t.category} · ${t.name}(${t.id}) 이 달 표에 없다`).toBe(true);
    }
    for (const id of OUTREACH_TEMPLATE_ANY_MONTH) expect(id in OUTREACH_TEMPLATE_MONTHS, id).toBe(false);
  });
});

describe('② 자동 선택은 이번 달에 맞는 템플릿만', () => {
  it('모든 업종 × 제품/행사 × 12달 — 고른 템플릿이 그 달에 맞는다', () => {
    for (const code of INDUSTRY_CODES) {
      for (const needProduct of [true, false]) {
        for (let m = 1; m <= 12; m += 1) {
          for (let seq = 0; seq < 12; seq += 1) {
            const t = pickTemplate(code, `job-${code}:${seq}`, needProduct, kst(2026, m));
            expect(templateFitsMonth(t.id, m), `${code} ${needProduct ? '제품' : '행사'} ${m}월 → ${t.name}`).toBe(true);
          }
        }
      }
    }
  });

  it('9월 말(금강제화 접수 시점) 패션 행사형 = 겨울·크리스마스·설·벚꽃 0', () => {
    const banned = new Set(['event-season-winter', 'event-season-xmaseve', 'event-season-seollal', 'event-season-cherryfest', 'event-season-yearend', 'event-season-sunrise']);
    const seen = new Set<string>();
    for (let seq = 0; seq < 200; seq += 1) seen.add(pickTemplate('fashion', `job-fashion:${seq}`, false, new Date('2026-09-30T05:00:00Z')).id);
    for (const id of seen) expect(banned.has(id), id).toBe(false);
    expect(seen.size).toBeGreaterThan(1); // 한 가지로 굳지 않는다
  });

  it('12월에는 겨울 템플릿이 다시 나올 수 있다(막는 것이 아니라 달에 맞춘다)', () => {
    const seen = new Set<string>();
    for (let seq = 0; seq < 200; seq += 1) seen.add(pickTemplate('fashion', `job-fashion:${seq}`, false, kst(2026, 12)).id);
    expect(seen.has('event-season-winter') || seen.has('event-season-xmaseve')).toBe(true);
  });

  it('같은 (잡, 순번, 달) = 같은 결과(결정적)', () => {
    const at = kst(2026, 10);
    expect(pickTemplate('fashion', 'job:3', false, at).id).toBe(pickTemplate('fashion', 'job:3', false, at).id);
  });
});
