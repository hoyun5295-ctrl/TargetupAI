// utils/pdf-party-block.ts
// ★ 컨트롤타워 — 정산서·거래내역서 PDF의 "공급자 / 공급받는자" 블록 렌더. (2026-07-26 Harold 실측)
//
// 사고: 공급받는자 대표자가 두 명인 회사(금강제화 = `SHIN KIEUN(김현정)(각자대표),이종문(각자대표)`)에서
// 대표 줄이 칸 폭을 넘어 두 줄로 흐르는데, 다음 줄의 y를 **고정 14pt**로 올려서 사업자번호 줄과
// 겹쳐 인쇄됐다. 아래 구분선(y=245 고정)과 항목표 시작(y=260 고정)도 같은 이유로 침범당한다.
//
// 처방: 줄마다 실제 높이(`heightOfString`)를 재서 그만큼 내리고, 블록이 끝난 y를 돌려준다.
// 호출부는 그 값으로 구분선과 다음 블록 위치를 잡는다 — 고정 좌표를 남기면 같은 사고가 재발한다.
//
// 두 PDF(정산서 `GET /:id/pdf` · 거래내역서 `GET /invoices/:id/pdf`)가 같은 블록을 그리므로
// 라우트에 인라인으로 두지 않는다(no_inline_duplication).

export interface PartyLine {
  label: string;
  value: string;
}

export interface PartyBlockOptions {
  /** 블록 왼쪽 x */
  x: number;
  /** 블록 위쪽 y (제목이 그려지는 위치) */
  y: number;
  /** 블록 폭 — 이 폭 안에서 줄바꿈된다 */
  width: number;
  /** 제목 (`공급자` / `공급받는자`) */
  title: string;
  lines: PartyLine[];
  /** 제목과 첫 줄 사이 간격 */
  titleGap?: number;
  /** 한 줄의 최소 높이 — 한 줄짜리 항목의 간격을 기존과 같게 유지한다 */
  minLineHeight?: number;
  primary: string;
  dark: string;
  /** 볼드/일반 전환 — 라우트가 폰트 경로를 쥐고 있어 콜백으로 받는다 */
  setFont: (bold?: boolean) => void;
}

/**
 * 당사자 블록을 그리고 **블록이 끝난 y**를 돌려준다.
 *
 * 값이 비면 `-`로 그린다(빈 줄을 남기면 표가 어긋난 것처럼 보인다).
 */
export function drawPartyBlock(doc: any, opts: PartyBlockOptions): number {
  const titleGap = opts.titleGap ?? 18;
  const minLineHeight = opts.minLineHeight ?? 14;

  opts.setFont(true);
  doc.fontSize(10).fillColor(opts.primary).text(opts.title, opts.x, opts.y, { width: opts.width });

  opts.setFont(false);
  doc.fontSize(9).fillColor(opts.dark);

  let y = opts.y + titleGap;
  for (const line of opts.lines) {
    const text = `${line.label}: ${line.value || '-'}`;
    doc.text(text, opts.x, y, { width: opts.width });
    // 실제 차지한 높이만큼 내린다. 한 줄이면 minLineHeight와 같아 기존 여백이 유지된다.
    const h = doc.heightOfString(text, { width: opts.width });
    y += Math.max(minLineHeight, Math.ceil(h));
  }
  return y;
}

/** 감사 인사 블록 높이 — 호출부가 자리 여부를 판정할 때 쓴다(페이지 하단 안내는 y=770). */
export const THANKS_NOTE_HEIGHT = 34;

export interface ThanksNoteOptions {
  x: number;
  y: number;
  width: number;
  message: string;
  primary: string;
  gray: string;
  setFont: (bold?: boolean) => void;
}

/**
 * 청구 문서 1페이지 하단 감사 인사. (★ 2026-07-26 Harold 지시)
 *
 * 정산서·거래내역서 두 문서가 같은 문구·같은 위치를 쓴다. 한쪽에만 넣으면
 * 같은 고객이 두 문서를 받았을 때 톤이 갈린다.
 */
export function drawThanksNote(doc: any, opts: ThanksNoteOptions): void {
  doc.rect(opts.x, opts.y, opts.width, THANKS_NOTE_HEIGHT).fill('#f5f3ff');
  opts.setFont(false);
  doc.fontSize(9).fillColor(opts.primary).text(opts.message, opts.x + 12, opts.y + 12, {
    width: opts.width - 24,
    lineBreak: false,
  });
}
