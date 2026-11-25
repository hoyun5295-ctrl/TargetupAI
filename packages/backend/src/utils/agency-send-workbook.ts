/**
 * ★ 2026-11-25 한 파일 여러 건 판정 CT(설계서 docs/2026-11-25-agency-intake-slip-multisheet-design.md §6-1).
 *
 * 요청서 시트 + 고객리스트 시트 짝이 여럿인 파일(시세이도 생일 문안 = 5짝 10시트)을 짝마다 한 건으로 가른다.
 * ⛔ 파일을 다시 쓰지 않는다 — 짝 = 시트 이름 둘이고 해석기 둘이 그 이름을 받는다(서식 · 숫자 셀 · 빈 머리칸 손실 0 · Codex 설계 1R).
 * ⛔ 짝의 기준점 = **이름으로 갈리는 고객리스트 시트**(Codex 설계 3R ~ 5R 탭 판정 부류 세 번째 = 구조로 닫음):
 *   각 명단의 요청서 = 그 명단 **바로 앞 시트**. 라벨만 닮은 메모 · 설명 탭이 스스로 다건을 일으키거나 짝을 가로채지 못한다.
 *   - 명단 0 · 또는 명단 1 이고 오늘 표준 판정 참 = single(오늘 경로 그대로 · 동작 변화 0). 단 「내용2」 처럼 이름이 요청서인 시트가 짝 없이 남으면 반려(조용한 누락 0).
 *   - 명단 1 · 표준 아님 = 바로 앞 시트가 요청서 꼴이면 한 짝(시세이도 한 장 꼴) · 아니면 single(별도 명단 파일 꼴 · 오늘 분기가 판정).
 *   - 명단 2 이상 = 다건: 명단 번호가 1부터 차례대로 · 각 명단 바로 앞 시트가 요청서 꼴 · 요청서 꼴 시트가 전부 짝에 들어가야 한다.
 */
import * as XLSX from 'xlsx';
import { looksLikeRequestForm, hasRecipientSheet, agencyRowsLookLikeRequest, AGENCY_LIST_SHEET_RE, agencySheetKey } from './agency-send-form';

export interface AgencySheetPair { formSheet: string; listSheet: string }
export type AgencyWorkbookPlan =
  | { kind: 'single' }
  | { kind: 'pairs'; pairs: AgencySheetPair[] }
  | { kind: 'invalid'; reasons: string[] };

/** 요청서 판정에 읽는 앞쪽 행 수(요청서 라벨은 30행 안 · 큰 명단 시트를 통째로 읽지 않는다) */
const PLAN_ROWS = 80;
/** 안내 · 예시 탭 이름(요청서로 보지 않는다) */
const GUIDE_SHEET_RE = /(안내|예시|설명|가이드|참고|guide|sample|example)/i;
/** 이름이 요청서인 시트(요청서 · 내용 · 내용2 …) */
const NAMED_FORM_RE = /^(요청서|내용)(\d*)$/;

export function planAgencyWorkbook(buffer: Buffer): AgencyWorkbookPlan {
  let names: string[];
  try {
    names = XLSX.read(buffer, { type: 'buffer', bookSheets: true }).SheetNames || [];
  } catch {
    return { kind: 'single' }; // 못 읽는 파일 = 오늘 경로가 판정(오늘 문장으로 반려)
  }
  const keys = names.map(agencySheetKey);
  const isList = (i: number) => AGENCY_LIST_SHEET_RE.test(keys[i]);
  const isGuide = (i: number) => GUIDE_SHEET_RE.test(keys[i]);
  const named = (i: number) => NAMED_FORM_RE.test(keys[i]);
  const listIdx = keys.map((_, i) => (isList(i) ? i : -1)).filter((i) => i >= 0);
  if (listIdx.length === 0) return { kind: 'single' };

  // 요청서 꼴 = 이름(요청서 · 내용N) 또는 앞 80행 라벨(문안 값 + 보낼 시각) · 안내 탭 · 명단 시트는 아님
  let rowsWb: XLSX.WorkBook | null | undefined;
  const looksForm = (i: number): boolean => {
    if (i < 0 || isList(i) || isGuide(i)) return false;
    if (named(i)) return true;
    if (rowsWb === undefined) {
      const others = names.filter((_, j) => !isList(j) && !isGuide(j) && !named(j));
      try {
        rowsWb = others.length > 0 ? XLSX.read(buffer, { type: 'buffer', sheets: others, sheetRows: PLAN_ROWS, cellFormula: false, cellHTML: false }) : null;
      } catch {
        rowsWb = null;
      }
    }
    const sheet = rowsWb?.Sheets[names[i]];
    return !!sheet && agencyRowsLookLikeRequest(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][]);
  };

  if (listIdx.length === 1) {
    const li = listIdx[0];
    if (looksLikeRequestForm(buffer) && hasRecipientSheet(buffer)) {
      // 오늘 경로 그대로 · 단 이름이 요청서인 시트(요청서 · 내용 · 내용N)가 둘 이상이면 반려 — 오늘 고르기 규칙(요청서 → 내용)이
      //   명단 바로 앞 시트와 다른 시트를 골라 다른 문안이 그 명단에 붙거나 한 건이 조용히 빠진다(Codex 설계 5R · 구현 1R)
      const namedForms = names.filter((_, i) => named(i));
      return namedForms.length > 1
        ? { kind: 'invalid', reasons: [`요청서 시트가 ${namedForms.map((n) => `「${n}」`).join(', ')} 여러 장입니다. 요청서가 여러 건이면 요청서 시트마다 바로 뒤에 「고객리스트1」 「고객리스트2」처럼 번호를 붙인 명단 시트를 두고, 한 건이면 요청서 시트를 하나만 남겨 주세요.`] }
        : { kind: 'single' };
    }
    if (!looksForm(li - 1)) return { kind: 'single' };
    // 한 짝도 번호 · 남는 요청서를 본다(「내용1 → 고객리스트2」 · 요청서 둘에 명단 하나 = 반려 · Codex 설계 6R)
    const reasons: string[] = [];
    const lm = AGENCY_LIST_SHEET_RE.exec(keys[li]);
    const lno = lm && lm[2] ? Number(lm[2]) : null;
    const fm = /(\d+)$/.exec(keys[li - 1]);
    if ((lno !== null && lno !== 1) || (fm && lno !== null && Number(fm[1]) !== lno) || (fm && lno === null && Number(fm[1]) !== 1)) {
      reasons.push(`요청서 시트 「${names[li - 1]}」와 고객리스트 시트 「${names[li]}」의 번호가 맞지 않습니다. 번호를 맞춰 주세요.`);
    }
    names.forEach((n, i) => {
      if (i !== li - 1 && looksForm(i)) reasons.push(`요청서 시트 「${n}」에 짝이 되는 고객리스트 시트가 없습니다. 요청서 시트 바로 뒤에 그 건의 고객리스트 시트를 두어 주세요.`);
    });
    if (reasons.length > 0) return { kind: 'invalid', reasons };
    return { kind: 'pairs', pairs: [{ formSheet: names[li - 1], listSheet: names[li] }] };
  }

  // 다건: 명단 번호 1..N 차례 · 바로 앞 시트 = 요청서 꼴 · 요청서 꼴 시트는 전부 짝에
  const reasons: string[] = [];
  const pairs: AgencySheetPair[] = [];
  const paired = new Set<number>();
  listIdx.forEach((li, k) => {
    const ord = k + 1;
    const m = AGENCY_LIST_SHEET_RE.exec(keys[li]);
    const no = m && m[2] ? Number(m[2]) : null;
    if (no !== ord) {
      reasons.push(no === null
        ? `요청서가 여러 건이면 고객리스트 시트 이름 끝에 짝 번호를 붙여 주세요. 「${names[li]}」은 ${ord}번째 명단이라 「고객리스트${ord}」로 바꿔 주세요.`
        : `「${names[li]}」은 ${ord}번째 명단입니다. 고객리스트 시트 번호를 1부터 차례대로 맞춰 주세요.`);
      return;
    }
    const fi = li - 1;
    if (!looksForm(fi)) {
      reasons.push(`고객리스트 시트 「${names[li]}」 바로 앞에 그 건의 요청서 시트가 없습니다. 요청서 시트 바로 뒤에 그 건의 고객리스트 시트를 두어 주세요.`);
      return;
    }
    const fm = /(\d+)$/.exec(keys[fi]);
    if (fm && Number(fm[1]) !== ord) {
      reasons.push(`요청서 시트 「${names[fi]}」의 번호가 바로 뒤 「${names[li]}」와 다릅니다. 번호를 맞춰 주세요.`);
      return;
    }
    paired.add(fi);
    pairs.push({ formSheet: names[fi], listSheet: names[li] });
  });
  names.forEach((n, i) => {
    if (!paired.has(i) && looksForm(i)) reasons.push(`요청서 시트 「${n}」에 짝이 되는 고객리스트 시트가 없습니다. 요청서 시트 바로 뒤에 그 건의 고객리스트 시트를 두어 주세요.`);
  });
  if (reasons.length > 0) return { kind: 'invalid', reasons };
  return { kind: 'pairs', pairs };
}

/** ★ 2026-11-25 이미지 이름 대조 키 = 요청서 칸 · 첨부 이름 양쪽 같은 함수(번호표 · 이미지 확장자 · 공백 뺌 · 소문자 · Codex 설계 1R) */
export function agencyImageNameKey(name: string): string {
  return String(name || '').trim().replace(/^[①②③④⑤]\s*/, '').replace(/\.(jpe?g|png|gif|bmp)$/i, '').replace(/\s+/g, '').toLowerCase();
}

/**
 * ★ 2026-11-25 한 메일 여러 건의 이미지 맞추기(설계서 §7) — 자리(건 · 순번) 하나 = 첨부 정확히 하나 · 첨부 하나 = 자리 정확히 하나.
 *   반환 = 건마다 첨부 순번 목록(요청서 칸 ①②③ 차례). 어긋나면 사유(시트 · 파일 이름)를 모두 모은다.
 */
export function matchAgencyUnitImages(
  units: Array<{ label: string; names: string[] }>, attachmentNames: string[], perUnitMax: number,
): { ok: true; assign: number[][] } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const keys = attachmentNames.map(agencyImageNameKey);
  keys.forEach((k, i) => {
    const j = keys.indexOf(k);
    if (j !== i && j >= 0) reasons.push(`첨부 「${attachmentNames[j]}」와 「${attachmentNames[i]}」의 이름이 같아 어느 요청서 이미지인지 정할 수 없습니다. 이미지 파일 이름을 서로 다르게 바꿔 주세요.`);
  });
  const usedBy = new Map<number, string>();
  const assign = units.map((u) => {
    if (u.names.length > perUnitMax) reasons.push(`${u.label}: 이미지는 한 건에 ${perUnitMax}장까지입니다. 지금 ${u.names.length}장이 적혀 있습니다.`);
    const out: number[] = [];
    for (const name of u.names) {
      const hits = keys.map((k, i) => (k === agencyImageNameKey(name) ? i : -1)).filter((i) => i >= 0);
      if (hits.length === 0) { reasons.push(`${u.label}: 이미지 파일명 「${name}」과 같은 이름의 첨부가 없습니다.`); continue; }
      const at = hits[0];
      const prev = usedBy.get(at);
      if (prev !== undefined) { reasons.push(`첨부 「${attachmentNames[at]}」가 ${prev}와 ${u.label} 두 곳에 적혀 있습니다. 한 곳에만 쓰도록 이미지를 나눠 주세요.`); continue; }
      usedBy.set(at, u.label);
      out.push(at);
    }
    return out;
  });
  attachmentNames.forEach((n, i) => {
    if (!usedBy.has(i)) reasons.push(`첨부 「${n}」는 어느 요청서의 이미지 파일명과도 맞지 않습니다. 요청서의 이미지 파일명 칸에 이 파일 이름을 적어 주세요.`);
  });
  return reasons.length > 0 ? { ok: false, reasons: [...new Set(reasons)] } : { ok: true, assign };
}

/**
 * ★ 2026-11-25 한 파일 여러 건의 건 이름 = 「파일 이름 / 요청서 시트 이름」 · 접수 file_name(varchar 200)에 맞춘다.
 *   시트 이름(건을 가르는 부분)은 보존하고 파일 이름 쪽을 줄인다(넘치면 INSERT 가 실패해 메일 전체가 되돌아간다 · Codex 구현 3R).
 */
export function agencyUnitLabel(fileName: string, sheet: string, max = 200): string {
  const tail = ` / ${sheet}`;
  if (tail.length >= max) return tail.trim().slice(0, max);
  const room = max - tail.length;
  const head = fileName.length > room ? `${fileName.slice(0, Math.max(0, room - 1))}…` : fileName;
  return head + tail;
}
