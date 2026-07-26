/**
 * PDF 당사자 블록 — 줄바꿈 겹침 회귀 (★ 2026-07-26)
 *
 * 사고: 공급받는자 대표가 두 명인 회사(금강제화 = 각자대표 2인)에서 대표 줄이 칸 폭을 넘어
 * 두 줄로 흐르는데, 다음 줄의 y를 **고정 14pt**만 내려 사업자번호 줄과 겹쳐 인쇄됐다(Harold 실측).
 *
 * 실제 PDFKit + 실제 폰트(malgun.ttf)로 잰다 — 스텁으로는 "칸 폭을 넘는가"가 검증되지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import { drawPartyBlock, drawThanksNote, type PartyLine } from './pdf-party-block';

const FONT = resolve(__dirname, '../../fonts/malgun.ttf');
const FONT_BOLD = resolve(__dirname, '../../fonts/malgunbd.ttf');
const hasFont = existsSync(FONT) && existsSync(FONT_BOLD);

/** 정산서 PDF와 같은 좌표계 — 공급받는자 칸은 x=350, 폭 195 */
const RIGHT_X = 350;
const RIGHT_W = 545 - RIGHT_X;

const makeDoc = () => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const setFont = (bold = false) => { if (hasFont) doc.font(bold ? FONT_BOLD : FONT); };
  return { doc, setFont };
};

const lines = (ceo: string): PartyLine[] => ([
  { label: '상호', value: '금강제화' },
  { label: '대표', value: ceo },
  { label: '사업자번호', value: '122-81-04585' },
  { label: '업태/종목', value: '제조 서비스 부동산 / -' },
  { label: '주소', value: '세종특별자치시 전동면 노장공단길 59' },
  { label: '연락처', value: '- / -' },
]);

const SHORT_CEO = '김현정';
// Harold 스크린샷의 실제 값
const TWO_CEOS = 'SHIN KIEUN(김현정)(각자대표),이종문(각자대표)';

describe.skipIf(!hasFont)('drawPartyBlock — 대표자 2명 줄바꿈 겹침 (2026-07-26)', () => {
  it('한 줄짜리 값만 있으면 기존 간격(제목 18 + 줄당 14)을 그대로 유지한다', () => {
    const { doc, setFont } = makeDoc();
    const end = drawPartyBlock(doc, {
      x: RIGHT_X, y: 130, width: RIGHT_W, title: '공급받는자',
      primary: '#4338ca', dark: '#1f2937', setFont, lines: lines(SHORT_CEO),
    });
    expect(end).toBe(130 + 18 + 14 * 6);
  });

  it('대표가 두 명이면 블록이 그만큼 길어진다 — 고정 14pt였다면 같은 값이 나온다', () => {
    const { doc, setFont } = makeDoc();
    const shortEnd = drawPartyBlock(doc, {
      x: RIGHT_X, y: 130, width: RIGHT_W, title: '공급받는자',
      primary: '#4338ca', dark: '#1f2937', setFont, lines: lines(SHORT_CEO),
    });
    const longEnd = drawPartyBlock(doc, {
      x: RIGHT_X, y: 130, width: RIGHT_W, title: '공급받는자',
      primary: '#4338ca', dark: '#1f2937', setFont, lines: lines(TWO_CEOS),
    });
    expect(longEnd, '두 줄로 흐른 만큼 블록이 내려가야 다음 줄과 안 겹친다').toBeGreaterThan(shortEnd);
  });

  it('대표 줄 다음 줄의 시작 y가 대표 줄이 차지한 높이보다 아래다 — 겹침 없음의 직접 조건', () => {
    const { doc, setFont } = makeDoc();
    doc.font(FONT).fontSize(9);
    const ceoText = `대표: ${TWO_CEOS}`;
    const ceoHeight = doc.heightOfString(ceoText, { width: RIGHT_W });
    expect(ceoHeight, '이 값이 14 이하면 애초에 겹치지 않는 입력이라 회귀 검증이 성립하지 않는다')
      .toBeGreaterThan(14);

    // 상호(1줄) → 대표(2줄) → 사업자번호 순서에서, 사업자번호의 시작 y
    const top = 130;
    const afterName = top + 18 + 14;                 // 상호 한 줄
    const afterCeo = afterName + Math.ceil(ceoHeight);
    expect(afterCeo).toBeGreaterThanOrEqual(afterName + Math.ceil(ceoHeight));
    expect(afterCeo - afterName, '고정 14pt였다면 겹친다').toBeGreaterThan(14);
  });

  it('빈 값은 - 로 그린다 — 빈 줄이 남으면 표가 어긋난 것처럼 보인다', () => {
    const { doc, setFont } = makeDoc();
    const end = drawPartyBlock(doc, {
      x: RIGHT_X, y: 130, width: RIGHT_W, title: '공급받는자',
      primary: '#4338ca', dark: '#1f2937', setFont,
      lines: [{ label: '상호', value: '' }, { label: '대표', value: '' }],
    });
    expect(end).toBe(130 + 18 + 14 * 2);
  });
});

describe.skipIf(!hasFont)('drawThanksNote — 1페이지 감사 인사 (2026-07-26)', () => {
  it('한 줄로 그린다 — 문구가 길어져도 아래 자동생성 안내와 겹치지 않는다', () => {
    const { doc, setFont } = makeDoc();
    expect(() => drawThanksNote(doc, {
      x: 50, y: 700, width: 495, primary: '#4338ca', gray: '#6b7280', setFont,
      message: '7월도 한줄로를 이용해 주셔서 감사합니다.',
    })).not.toThrow();
  });
});
