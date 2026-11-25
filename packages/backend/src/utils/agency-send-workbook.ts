/**
 * ★ 2026-11-25 한 파일 여러 건 판정 CT(설계서 docs/2026-11-25-agency-intake-slip-multisheet-design.md §6-1).
 *
 * 요청서 시트 + 명단 시트 짝이 여럿인 파일(시세이도 생일 문안 = 5짝 10시트)을 짝마다 한 건으로 가른다.
 * ⛔ 파일을 다시 쓰지 않는다 — 짝 = 시트 이름 둘이고 해석기 둘이 그 이름을 받는다(서식 · 숫자 셀 · 빈 머리칸 손실 0 · Codex 설계 1R).
 *
 * ★ 2026-11-25(2) 짝의 기준 = **요청서 시트 바로 뒤 시트가 그 건의 명단**(Harold 「제한없어 이어붙어있으면」).
 *   첫 판은 명단을 이름표(「고객리스트N」)로만 찾았다 → 실 접수 「정기문자(생일_PT)」 + 「정기문자(생일_PT)리스트」 다섯 짝을
 *   명단 0장으로 보고 오늘 문장으로 반려했다(1125 15:57 · 15:59 접수 384 · 385). 이름표는 고객마다 다르다.
 *   - 요청서 = 이름(요청서 · 내용N) 또는 앞 80행 라벨(문안 값 + 보낼 시각).
 *   - 명단 = 이름에 「리스트」 · 「명단」 또는 내용(한 열의 과반이 휴대폰 번호 · 두 줄 이상). 안내 · 예시 탭은 어느 쪽도 아니다.
 *   - 숨김 탭이 있는 파일 = 오늘 경로(표준 한 건 · 오늘 고르는 두 시트가 다 보일 때)로만 받는다 · 그 밖은 숨긴 시트 이름을 적어 반려
 *     (숨김 탭이 낀 채로는 짝을 만들지 않는다).
 *   - 요청서 0 · 명단 0 = single(오늘 경로가 판정 · 별도 명단 파일 꼴 포함).
 *   - 오늘 표준 판정이 참이고 표준 이름 명단(고객리스트 · 고객명단 · 뒤 숫자)이 하나 = single(오늘 경로 그대로 · 메모 탭 · 남는 시트는 오늘처럼 안 본다).
 *     단 이름이 요청서인 시트가 둘 이상이면 반려(조용한 누락 0).
 *   - 그 밖 = 요청서마다 바로 뒤 시트가 명단이어야 한다 · 요청서 꼴 시트는 전부 짝에 · 짝 없는 명단도 반려(조용한 누락 0).
 *   - 이름 · 번호는 **어긋남을 잡는 데만** 쓴다: 요청서 번호 ≠ 명단 번호 · 명단 번호가 차례대로 아님 · 명단 이름이 다른 요청서의 것(「GOLD리스트」가 PT 뒤).
 */
import * as XLSX from 'xlsx';
import {
  namesLookLikeRequestForm, namesHaveRecipientSheet, agencyRowsLookLikeRequest, agencyRowsLookLikeList, AGENCY_LIST_SHEET_RE, agencySheetKey,
  AGENCY_GUIDE_SHEET_RE as GUIDE_SHEET_RE, AGENCY_TEST_SHEET_RE as TEST_SHEET_RE, pickAgencyFormSheet, pickAgencyListSheet,
} from './agency-send-form';

export interface AgencySheetPair { formSheet: string; listSheet: string }
export type AgencyWorkbookPlan =
  | { kind: 'single' }
  | { kind: 'pairs'; pairs: AgencySheetPair[] }
  /** requestSheets = 이 파일의 요청서 꼴 시트 수(메일 두 파일 분기가 「보조 탭 때문의 반려」와 「요청서가 여럿인 파일」을 가른다 · 판정 실패 = 없음) */
  | { kind: 'invalid'; reasons: string[]; requestSheets?: number };

/** 요청서 · 명단 판정에 읽는 앞쪽 행 수(요청서 라벨은 30행 안 · 큰 명단 시트를 통째로 읽지 않는다) */
const PLAN_ROWS = 80;
/** 이름이 요청서인 시트(요청서 · 내용 · 내용2 …) */
const NAMED_FORM_RE = /^(요청서|내용)(\d*)$/;
/** 이름이 명단인 시트(「고객리스트1」 · 「정기문자(생일_PT)리스트」 · 「수신자명단」) */
const LIST_NAME_RE = /(리스트|명단)/;
/** 번호가 짝 번호인 명단 이름(「고객리스트2」 · 「명단3」 — 다른 글자 뒤 숫자는 짝 번호로 읽지 않는다) */
const LIST_NUMBER_RE = /^(?:고객)?(?:리스트|명단)(\d+)$/;
/** 요청서 이름 뒤에 붙어 「그 요청서의 명단」을 뜻하는 꼬리(「정기문자(생일_PT)」 + 「리스트」) */
const LINKED_TAIL_RE = /^[_\-.]*(?:의)?(?:고객)?(?:리스트|명단)\d*$/;

export function planAgencyWorkbook(buffer: Buffer): AgencyWorkbookPlan {
  let names: string[];
  try {
    names = XLSX.read(buffer, { type: 'buffer', bookSheets: true }).SheetNames || [];
  } catch {
    return { kind: 'single' }; // 못 읽는 파일 = 오늘 경로가 판정(오늘 문장으로 반려)
  }
  const keys = names.map(agencySheetKey);
  const isGuide = (i: number) => GUIDE_SHEET_RE.test(keys[i]);
  const named = (i: number) => !isGuide(i) && NAMED_FORM_RE.test(keys[i]);
  const isTest = (i: number) => TEST_SHEET_RE.test(keys[i]);
  const listNamed = (i: number) => !isGuide(i) && !named(i) && !isTest(i) && LIST_NAME_RE.test(keys[i]);
  const other = (i: number) => !isGuide(i) && !named(i) && !listNamed(i);

  // 표준 양식 그대로(이름이 요청서인 시트 하나 + 표준 이름 명단 하나 + 안내 탭) = 더 읽지 않고 오늘 경로(오늘 읽기 비용 그대로 ·
  //   아래 판정 차례 ②와 같은 결과 = 짝이 하나뿐이라 표준 한 건).
  const nonGuide = names.map((_, i) => i).filter((i) => !isGuide(i));
  if (nonGuide.length === 2 && nonGuide.filter((i) => named(i)).length === 1 && nonGuide.filter((i) => AGENCY_LIST_SHEET_RE.test(keys[i])).length === 1
    && namesLookLikeRequestForm(names) && namesHaveRecipientSheet(names)) return { kind: 'single' };

  // 한 번 읽기 = 이름으로 안 갈리는 시트의 앞 80행 + 통합 문서 정보(숨김 여부). 이름이 명단인 큰 시트는 읽지 않는다.
  let meta: XLSX.WorkBook | null = null;
  try {
    meta = XLSX.read(buffer, { type: 'buffer', sheets: names.filter((_, j) => other(j)), sheetRows: PLAN_ROWS, cellFormula: false, cellHTML: false });
  } catch {
    meta = null;
  }
  // ⛔ 숨김 탭(고객 눈에 안 보이는 탭 = 지난달 문안 · 명단 보관) — Codex 짝 4R ~ 6R 같은 부류 세 번째 = 단순한 기준 하나로 바꿈:
  //   **숨김 탭이 있는 파일은 오늘 경로(표준 한 건)로만 받는다. 그 밖은 숨긴 시트 이름을 적어 반려한다.**
  //   숨김 탭을 짝 판정 안에서 건너뛰거나 경계로 가르면, 그 구분이 틀리는 꼴마다 다른 건의 명단이 붙는다
  //   (숨긴 요청서 뒤의 명단 · 이름이 명단인 숨긴 요청서). 숨김 탭이 낀 채로는 짝을 만들지 않는다 = 그 길이 구조상 없다.
  //   숨김 탭의 종류는 없음(none)이고 인접은 파일 차례 그대로다(건너뛰지 않는다). 숨김 여부를 못 읽으면 전부 보이는 것으로 본다.
  const hiddenNames = new Set(((meta?.Workbook?.Sheets || []) as Array<{ name?: string; Hidden?: number }>)
    .filter((x) => !!x && !!x.Hidden).map((x) => String(x.name)));
  const isHidden = (i: number) => hiddenNames.has(names[i]);
  const rowsOf = (i: number): any[][] | null => {
    const sheet = meta?.Sheets[names[i]];
    return sheet ? (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][]) : null;
  };
  const kindCache = new Map<number, 'form' | 'list' | 'none'>();
  const kindOf = (i: number): 'form' | 'list' | 'none' => {
    if (i < 0 || i >= names.length) return 'none';
    let k = kindCache.get(i);
    if (k) return k;
    if (isGuide(i) || isHidden(i)) k = 'none';
    else if (named(i)) k = 'form';
    else if (listNamed(i)) k = 'list';
    else {
      const rows = rowsOf(i);
      k = !rows ? 'none' : agencyRowsLookLikeRequest(rows) ? 'form' : (!isTest(i) && agencyRowsLookLikeList(rows)) ? 'list' : 'none';
    }
    kindCache.set(i, k);
    return k;
  };

  const forms = names.map((_, i) => i).filter((i) => kindOf(i) === 'form');
  const lists = names.map((_, i) => i).filter((i) => kindOf(i) === 'list');
  if (forms.length === 0 || lists.length === 0) return { kind: 'single' };

  // 인접 짝 판정 = 요청서 시트 바로 뒤 시트가 그 건의 명단 · 이름 · 번호는 어긋남만 잡는다
  const reasons: string[] = [];
  const pairs: AgencySheetPair[] = [];
  const usedLists = new Set<number>();
  const formNo = (i: number) => { const m = NAMED_FORM_RE.exec(keys[i]); return m && m[2] ? Number(m[2]) : null; };
  const listNo = (i: number) => { const m = LIST_NUMBER_RE.exec(keys[i]); return m ? Number(m[1]) : null; };
  const linked = (fi: number, li: number) => keys[li].startsWith(keys[fi]) && LINKED_TAIL_RE.test(keys[li].slice(keys[fi].length));
  let lastListNo: { no: number; name: string } | null = null;
  for (const fi of forms) {
    const li = fi + 1;
    if (kindOf(li) !== 'list') {
      reasons.push(`요청서 시트 「${names[fi]}」에 짝이 되는 고객리스트 시트가 없습니다. 요청서 시트 바로 뒤에 그 건의 고객리스트 시트를 두어 주세요.`);
      continue;
    }
    usedLists.add(li);
    const fno = formNo(fi);
    const lno = listNo(li);
    if (fno !== null && lno !== null && fno !== lno) {
      reasons.push(`요청서 시트 「${names[fi]}」의 번호가 바로 뒤 「${names[li]}」와 다릅니다. 번호를 맞춰 주세요.`);
      continue;
    }
    if (lno !== null) {
      if (lastListNo && lno <= lastListNo.no) {
        reasons.push(`고객리스트 시트 번호가 차례대로가 아닙니다(「${lastListNo.name}」 다음에 「${names[li]}」). 요청서 시트마다 바로 뒤에 그 건의 고객리스트 시트를 두어 주세요.`);
        continue;
      }
      lastListNo = { no: lno, name: names[li] };
    }
    const owner = forms.filter((g) => g !== fi && linked(g, li)).sort((x, y) => keys[y].length - keys[x].length)[0];
    if (owner !== undefined && !linked(fi, li)) {
      reasons.push(`고객리스트 시트 「${names[li]}」은 이름이 요청서 시트 「${names[owner]}」의 명단인데 「${names[fi]}」 바로 뒤에 있습니다. 요청서 시트 바로 뒤에 그 건의 고객리스트 시트를 두어 주세요.`);
      continue;
    }
    pairs.push({ formSheet: names[fi], listSheet: names[li] });
  }
  for (const li of lists) {
    if (!usedLists.has(li)) reasons.push(`고객리스트 시트 「${names[li]}」 바로 앞에 그 건의 요청서 시트가 없습니다. 요청서 시트 바로 뒤에 그 건의 고객리스트 시트를 두어 주세요.`);
  }

  // 오늘 경로(표준 한 건) 조건 = 오늘 표준 판정이 참 + **보이는** 표준 이름 명단이 하나 + 오늘 고르기 규칙이 읽을 두 시트
  //   (요청서 → 내용 · 고객리스트 → 고객명단)가 다 보임. 그때는 오늘 고르기 규칙 그대로다(메모 탭 · 사이에 낀 보조 명단 · 남는 시트는
  //   오늘처럼 안 본다). 단 이름이 요청서인 시트(요청서 · 내용 · 내용N)가 둘 이상이면 반려 — 오늘 고르기 규칙이 다른 시트를 골라
  //   다른 문안이 그 명단에 붙거나 한 건이 조용히 빠진다(Codex 설계 5R · 구현 1R).
  const standardLists = names.map((_, i) => i).filter((i) => !isGuide(i) && !isHidden(i) && AGENCY_LIST_SHEET_RE.test(keys[i]));
  //   ⛔ 「오늘 읽을 두 시트」는 해석기와 **같은 함수**로 고른다(따로 고르면 확인한 시트와 읽는 시트가 갈린다 · Codex 짝 7R)
  const todayForm = names.indexOf(pickAgencyFormSheet(names));
  const todayList = names.indexOf(pickAgencyListSheet(names));
  const standardOne = todayForm >= 0 && todayList >= 0 && !isHidden(todayForm) && !isHidden(todayList)
    && standardLists.length === 1 && namesLookLikeRequestForm(names) && namesHaveRecipientSheet(names);
  const todayPath = (): AgencyWorkbookPlan => {
    const namedForms = names.filter((_, i) => named(i));
    return namedForms.length > 1
      ? { kind: 'invalid', requestSheets: forms.length, reasons: [`요청서 시트가 ${namedForms.map((n) => `「${n}」`).join(', ')} 여러 장입니다. 요청서가 여러 건이면 요청서 시트마다 바로 뒤에 「고객리스트1」 「고객리스트2」처럼 번호를 붙인 명단 시트를 두고, 한 건이면 요청서 시트를 하나만 남겨 주세요.`] }
      : { kind: 'single' };
  };

  // ★(2) 판정 차례(Codex 짝 1R ~ 6R · 덧댄 예외 대신 차례 하나):
  //   ⓪ 숨김 탭이 있는 파일 = 표준 한 건(짝이 하나 이하)일 때만 오늘 경로 · 그 밖은 숨긴 시트 이름을 적어 반려(짝을 만들지 않는다).
  if (hiddenNames.size > 0) {
    if (standardOne && pairs.length < 2) return todayPath();
    const hid = names.filter((_, i) => isHidden(i));
    const shown = hid.slice(0, 5).map((n) => `「${n}」`).join(', ') + (hid.length > 5 ? ` 외 ${hid.length - 5}개` : '');
    return { kind: 'invalid', requestSheets: forms.length, reasons: [`숨겨진 시트(${shown})가 있어 요청서와 고객리스트의 짝을 확인할 수 없습니다. 숨겨진 시트를 지우거나 숨김을 풀어 정리한 뒤 다시 보내 주세요.`] };
  }
  //   ① 인접 짝 판정에서 **짝이 둘 이상** 성립하면 여러 건 파일이다 — 표준 이름이 섞여 있어도
  //      (「내용」 「VIP리스트」 「일반 고객 발송」 「고객리스트」를 한 건으로 넘기면 VIP 문안이 일반 명단에 붙고 둘째 건이 빠진다).
  //      짝이 둘 이상 성립했는데 사유(짝 없는 명단 · 요청서 · 어긋남)가 있으면 **파일 전체를 반려**한다 — 표준 한 건으로 넘기면
  //      성립한 둘째 건이 조용히 빠진다(「내용」 「고객리스트」 「GOLD」 「GOLD리스트」 「이전리스트」 · Codex 짝 4R).
  if (pairs.length >= 2) return reasons.length === 0 ? { kind: 'pairs', pairs } : { kind: 'invalid', reasons, requestSheets: forms.length };
  //   ② 그렇지 않고 표준 한 건 조건이면 오늘 경로 그대로.
  if (standardOne) return todayPath();
  //   ③ 그 밖 = 인접 짝 판정 그대로(한 짝 · 또는 어긋남 사유로 반려).
  if (reasons.length > 0) return { kind: 'invalid', reasons, requestSheets: forms.length };
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
