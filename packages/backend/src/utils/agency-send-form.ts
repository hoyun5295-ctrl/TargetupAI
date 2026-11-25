/**
 * agency-send-form.ts — 대행발송 요청서 파서 CT (★ 2026-08-25(3) 신설 · Harold "요청서 엑셀 규격화")
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §17. 요청서 엑셀(규격)과 명단 엑셀(자유형)을 서버가
 * 읽어 원스텝 접수 재료로 바꾼다. **브라우저에는 상위 50건 샘플과 집계만 내려간다**(전 행 전송이
 * 화면 접수가 느린 진짜 원인이었다 — 중복 검사 계산이 아니라 전송이 병목).
 *
 * 규격(양식 = frontend/public/agency-request-form.xlsx):
 *   **행 위치가 아니라 라벨로 읽는다**(행이 밀려도 라벨이 맞으면 읽힌다). 라벨 = 행의 첫 비어 있지
 *   않은 셀, 값 = 그 다음 셀. 라벨 대조는 괄호 부연을 뗀 뒤 한다("발신번호(=회신번호)" = "발신번호").
 *   항목 = 제목 · 문안 · 보낼 시각 · 회신번호 · 광고 여부 · 담당자 번호 (+ 선택 = 수신자 열 이름 · 문자타입).
 *
 * ★2026-08-26(2) 업계 관행 양식으로 통일(Harold 승인 · 카카오톡 수신 실물 실측):
 *   시트1 "내용"(항목) + 시트2 "고객리스트"(명단)가 **한 파일**이다. 구양식(시트 "요청서" + 별도
 *   명단 파일)도 계속 읽는다 — 시트 이름으로 갈라 읽으므로 두 세대가 공존한다.
 *   ⛔ 템플릿 안내 문구("월 일 시 분" 등)가 값 칸에 남아 오면 **빈칸으로 취급**한다(PLACEHOLDER_VALUES).
 *   ⛔ 구양식의 "고객 명단 예시" 시트는 명단이 아니다 — 명단 시트 판정은 이름 **정확 일치**만 쓴다.
 *
 * ⛔ 광고 기본 = 예(Harold 2026-08-25 지시). "아니오"라고 적은 경우만 해제한다.
 * ⛔ 회신번호 칸은 두 가지를 받는다: 번호(직접) 또는 명단의 열 이름(열 방식).
 *   열 방식이면 접수가 **회신번호별로 나뉜다** — 대행발송이 타는 적재 배관(주소록 슬롯 5칸)은
 *   수신자별 회신번호를 나르지 못하기 때문이다(agency-send-worker 적재부 주석이 그 사실을 소유).
 * ⛔ 전화번호 열은 이름이 아니라 **값이 실제 휴대폰 번호인 비율**로 고른다(이름 추정은 오탈자에 진다).
 */
import * as XLSX from 'xlsx';
import { normalizePhone, normalizeAgencyPhone, restoreMobileLeadingZero } from './normalize-phone';
import { formatSheetDateCode } from './normalize';

export interface AgencyFormError { field: string; error: string }

export interface ParsedAgencyForm {
  subject: string;
  content: string;
  requestedAtText: string;
  requestedAt: Date | null;
  callbackRaw: string;
  isAd: boolean;
  managerPhones: string[];
  /** ★2026-08-26 §18-4 양식 신설 칸 "수신자 열 이름". 값이 있으면 그것이 진실(추정 제거) · 선택 항목이라 비면 '' */
  phoneColumnName: string;
  /**
   * ★2026-08-26(2) 업계 양식의 "이미지 파일명" 칸 값(첫 줄). 화면 접수는 확인 화면에서 이미지를
   * 붙이므로 무시하고, **이메일 접수만** 이 값이 있으면 반려한다(첨부 없는 이미지 지정 = 기대와 다른 발송).
   */
  imageFileName: string;
  /**
   * ★ 2026-11-25 「이미지 파일명」 칸 ① 줄 값 + 그 아래 ②③ 줄(번호표 · 앞뒤 공백 뺌 · 순서 = ①②③ · 빈 줄 뺌).
   *   메일 다건 접수가 첨부 이미지를 이름으로 맞출 때 쓴다(설계서 docs/2026-11-25-agency-intake-slip-multisheet-design.md §7).
   */
  imageFileNames: string[];
  /**
   * ★2026-08-27 §18-13 "청구 계정" 칸(선택). 한 이메일 주소가 여러 귀속(청구 계정)에 등록된 경우
   * 어느 계정 명의로 접수·청구할지 담당자가 지정한다. 대조는 워커가 matchBillingTarget으로 한다.
   * 선택 항목이라 비면 '' (귀속이 1개인 대부분 업체는 적을 필요가 없다).
   */
  billingTarget: string;
  errors: AgencyFormError[];
}

export type CallbackPlan =
  | { mode: 'fixed'; number: string }
  | { mode: 'column'; column: string }
  | { mode: 'none' };

const ONLY_DIGITS = (s: string) => String(s || '').replace(/[^0-9]/g, '');

/** 라벨 정규화(공백 제거). "보낼시각"과 "보낼 시각"을 같게 본다 */
const normLabel = (s: any) => String(s ?? '').replace(/\s+/g, '').trim();

/**
 * 라벨 대조 키 — 괄호 부연을 뗀다. 업계 양식의 라벨은 "발신번호(=회신번호)"처럼 부연이 붙어
 * 정확 일치 대조에서 지기 때문이다(★2026-08-26(2) 실물 실측). **라벨에만** 쓴다 — 값의 괄호는 내용이다.
 */
const labelKey = (s: any) => normLabel(String(s ?? '').replace(/[(（][^)）]*[)）]/g, ''));

/**
 * 템플릿 안내 문구가 값 칸에 그대로 남아 온 경우 = 빈칸. 목록은 배포 양식·업계 실물 양식의
 * 값 칸 안내문 전량이다. ⛔ 새 양식을 만들 때 값 칸에 안내문을 넣지 마라(여기 목록이 늘어난다) —
 * 안내는 안내 열·안내 시트에만 둔다(build-agency-request-form.js 규약).
 */
const PLACEHOLDER_VALUES = new Set([
  '월일시분',
  "(고객별로발신번호가상이할경우,'고객리스트'시트에고객별로발신번호기재부탁드립니다.)",
].map(normLabel));
const isPlaceholderValue = (v: string) => {
  const n = normLabel(v);
  if (!n) return false;
  if (PLACEHOLDER_VALUES.has(n)) return true;
  // 이미지 파일명 칸의 "①" 같은 순번 표시만 있는 값
  return /^[①②③④⑤]+$/.test(n);
};

/** 명단 시트 이름(정확 일치만 · "고객 명단 예시" 같은 예시 시트가 명단으로 오인되면 안 된다) */
const RECIPIENT_SHEET_NAMES = new Set(['고객리스트', '고객명단']);

/** 셀 값 → 문자열. 날짜 셀은 읽을 때 이미 벽시계 글자다(sheetDatesToText) */
function cellText(v: any): string {
  return String(v ?? '').trim();
}

/**
 * 시트 읽기 옵션(★2026-09-13(3)). 날짜 셀을 Date로 만들지 않고 서식(z)을 받아 날짜를 가른다.
 * ⛔ `cellDates:true`로 되돌리지 마라. xlsx 0.18.5는 서버 시간대(KST)에서 52초 이른 Date를 만든다(0913 실측):
 *   요청서 14:30 셀이 14:29로, 날짜만 적힌 셀이 전날 23:59로 조용히 접수됐고, 명단 날짜는 UTC ISO 글자로 고객 문자에 들어갔다.
 */
const SHEET_READ_OPTS = {
  type: 'buffer' as const, cellDates: false, cellNF: true, cellFormula: false, cellHTML: false, sheetStubs: false,
};

/**
 * 날짜 서식의 숫자 셀을 엑셀에 보이는 벽시계 글자로 바꾼다(제자리 · sheet_to_json 전에 부른다).
 * 일련번호를 달력 산술(SSF)로 풀어 시간대를 거치지 않는다. 글자 규칙 = normalize.formatSheetDateCode.
 * 날짜 서식이 아닌 숫자·문자·불리언 셀은 건드리지 않는다(값 형태가 종전과 같다).
 */
function sheetDatesToText(sheet: XLSX.WorkSheet | undefined): void {
  if (!sheet) return;
  // 대용량 명단에서 키 배열을 만들지 않게 for...in으로 돈다
  for (const addr in sheet) {
    if (addr[0] === '!') continue;
    const cell = sheet[addr] as XLSX.CellObject;
    if (!cell || cell.t !== 'n' || typeof cell.v !== 'number' || cell.z === undefined || !XLSX.SSF.is_date(cell.z)) continue;
    const code = XLSX.SSF.parse_date_code(cell.v);
    if (!code) continue;
    sheet[addr] = { t: 's', v: formatSheetDateCode(code) };
  }
}

/**
 * "2026-09-01 14:00" 류를 서버 시각(KST 운영)으로 읽는다. 구분자 - . / 허용, 초는 허용·무시.
 * ★2026-08-26(2) 한국어 표기도 받는다: "2026년 9월 1일 14시 30분" · "2026년 9월 1일(월) 오후 2시".
 *   ★2026-08-26(4) **연도 없는 표기("8월 30일 10시")를 받는다**(Harold 확정 · 서수란 실측 반려에서).
 *   실물 양식 안내문이 "월 일 시 분"이라 업체 대부분이 연도를 뺀다. 해석 규칙:
 *   ①올해로 본다 ②이미 지났으면 내년으로 보되, **내년 해석은 60일 이내일 때만**(NEAR_ROLLOVER_DAYS ·
 *   연말의 "1월 3일"은 통과, 6월의 "1월 3일" 오타는 먼 미래로 조용히 잡히는 대신 올해 과거로 남아
 *   리드타임 검증이 정확한 사유로 반려한다). 최종 안전망 = 승인 문자·화면에 시각이 찍히고 승인 없이는 안 나간다.
 * ⛔ 끝까지 고정한다(시간대 접미사 등 잔여 문자는 거절) + **달력 왕복 대조**를 한다(★Codex 적대 1R) —
 *   JS Date는 2월 30일을 3월 2일로 조용히 굴려서, 검증만 통과하고 사용자가 적지 않은 날에 나간다.
 */
export const NEAR_ROLLOVER_DAYS = 60;

// ★2026-08-26(4) 시간부 공용 문법(Harold "여러 경우의 수를 알아듣게") — 날짜형·상대형이 같은 조각을 쓴다.
//   받는 것 = "14:00" · "14시" · "14시 30분" · "14시 반" · "14시 분"(빈 분) · "14" · 오전/오후/새벽/아침/낮/저녁/밤 · 끝의 "쯤/경".
const TIME_PART = String.raw`(?:(오전|오후|새벽|아침|낮|저녁|밤)\s*)?(\d{1,2})(?:\s*:\s*(\d{1,2})(?::\d{2})?|\s*시\s*(?:(\d{1,2})\s*분?|(반)|분)?)?\s*(?:쯤|경)?`;
const DATE_TIME_RE = new RegExp(
  String.raw`^(?:(\d{4})\s*[년\-./]\s*)?(\d{1,2})\s*[월\-./]\s*(\d{1,2})\s*일?\s*(?:[(（][^)）]{1,4}[)）])?[\sT]*` + TIME_PART + String.raw`\s*$`,
);
const RELATIVE_RE = new RegExp(String.raw`^(오늘|내일|모레)\s*` + TIME_PART + String.raw`\s*$`);

/** 시간부 해석. 모호한 표기("밤 12시" = 자정인지 낮인지)는 null = 반려(적은 값과 다른 시각 금지) */
function resolveTimePart(half: string | undefined, hhRaw: string, miColon?: string, miSi?: string, ban?: string): { hh: number; mi: number } | null {
  let hh = Number(hhRaw);
  const isAm = half === '오전' || half === '새벽' || half === '아침';
  const isPm = half === '오후' || half === '낮' || half === '저녁' || half === '밤';
  if (half === '밤' && hh === 12) return null; // "밤 12시" = 자정 관용이라 낮 12시로 읽으면 오발송이다
  if (isPm && hh < 12) hh += 12;
  if (isAm && hh === 12) hh = 0;
  const mi = Number(miColon ?? miSi ?? (ban ? 30 : 0));
  if (hh > 23 || mi > 59) return null;
  return { hh, mi };
}

export function parseWhenText(text: string, now: Date = new Date()): Date | null {
  const s = String(text || '').trim();
  // ★2026-08-26(4) 날짜부와 시간부를 한 문법으로 통합(Harold "시간 정도는 읽어서 판단해라") —
  //   "2026-09-01 14:00" · "09-01 14시" · "9월 1일 오후 2시" · "8월 30일 10시 분" · "09-01 14" ·
  //   "내일 10시 반"처럼 숫자형·한국어형·상대형이 섞여도 읽는다. 시간 숫자 자체가 없으면 반려 유지.
  const rel = s.match(RELATIVE_RE);
  if (rel) {
    const t = resolveTimePart(rel[2], rel[3], rel[4], rel[5], rel[6]);
    if (!t) return null;
    const offset = rel[1] === '오늘' ? 0 : rel[1] === '내일' ? 1 : 2;
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, t.hh, t.mi, 0, 0);
    return Number.isNaN(base.getTime()) ? null : base;
  }

  const k = s.match(DATE_TIME_RE);
  if (!k) return null;
  const yearText = k[1];
  const [mo, dd] = [Number(k[2]), Number(k[3])];
  const t = resolveTimePart(k[4], k[5], k[6], k[7], k[8]);
  if (!t) return null;
  const { hh, mi } = t;
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;

  /** 그 해로 조립 + 달력 왕복 대조. 달력에 없는 날짜면 null */
  const build = (y: number): Date | null => {
    const d = new Date(y, mo - 1, dd, hh, mi, 0, 0);
    if (Number.isNaN(d.getTime())) return null;
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== dd || d.getHours() !== hh || d.getMinutes() !== mi) return null;
    return d;
  };

  if (yearText) return build(Number(yearText));

  const thisYear = build(now.getFullYear());
  if (!thisYear) return null;
  if (thisYear.getTime() > now.getTime()) return thisYear;
  const nextYear = build(now.getFullYear() + 1);
  if (nextYear && nextYear.getTime() - now.getTime() <= NEAR_ROLLOVER_DAYS * 24 * 60 * 60 * 1000) {
    return nextYear;
  }
  // 내년으로도 가깝지 않다 = 지난 날짜를 적었을 가능성이 압도적이다. 올해 과거 그대로 돌려주고
  // 리드타임 검증("이미 지난 시각")이 사용자가 적은 날짜 기준의 정확한 사유로 반려하게 한다.
  return thisYear;
}

/** 광고 여부. 기본 = 예(Harold 지시) — 명시적인 부정만 끈다 */
function parseIsAd(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, '').toLowerCase();
  return !['아니오', '아니요', '아님', 'no', 'n', 'x', '없음', '비광고'].includes(t) || t === '';
}

/**
 * 요청서를 읽지 못했을 때의 값(한 벌). 파서 catch와 별도 프로세스 파싱 실패(★2026-09-26 S1-H03)가 같은 반려를 낸다.
 */
export function unreadableAgencyForm(): ParsedAgencyForm {
  return {
    subject: '', content: '', requestedAtText: '', requestedAt: null, callbackRaw: '',
    isAd: true, managerPhones: [], phoneColumnName: '', imageFileName: '', imageFileNames: [], billingTarget: '',
    errors: [{ field: '요청서', error: '요청서 파일을 읽지 못했습니다. 양식 그대로인지 확인해 주세요.' }],
  };
}

/** ★ 2026-11-25 문안 칸 라벨(요청서 시트 판정 · planAgencyWorkbook 과 해석기가 같은 표를 쓴다) */
const CONTENT_LABELS = ['문안', '문안내용', '내용', '메시지 내용'];
const WHEN_LABELS = ['보낼 시각', '발송일시', '발송 시각', '요청발송일시', '발송날짜 및 시간', '발송 날짜', '발송날짜'];
/**
 * ★ 2026-11-25(2) 탭 이름 판정 한 벌(공백 뺀 이름) — 짝 판정(planAgencyWorkbook)과 명단 시트 고르기가 같이 쓴다.
 *   안내 · 예시 탭 = 요청서 · 명단 어느 쪽도 아님 / 테스트 탭(「테스트 명단」) = 받는 사람 명단이 아님(테스트 번호가 실제 발송 대상에 붙지 않게).
 */
export const AGENCY_GUIDE_SHEET_RE = /(안내|예시|설명|가이드|참고|guide|sample|example)/i;
export const AGENCY_TEST_SHEET_RE = /(테스트|test)/i;

/** ★ 2026-11-25 명단 시트 이름 꼴(한 파일 여러 건 · 「고객리스트1」 · 공백 뺀 이름) */
export const AGENCY_LIST_SHEET_RE = /^(고객리스트|고객명단)(\d*)$/;

/** 시트 이름(공백 뺌) — 시트 판정 공용 */
export const agencySheetKey = (name: string) => normLabel(name);

/**
 * ★ 2026-11-25 이 시트 행들이 요청서로 보이는가(문안 라벨 행이 있음 · 라벨 = 행의 첫 비어 있지 않은 칸 · 해석기와 같은 규칙).
 *   한 파일 여러 건 판정(planAgencyWorkbook)이 쓴다.
 */
export function agencyRowsLookLikeRequest(rows: any[][]): boolean {
  // 문안 라벨(값 있음)과 보낼 시각 라벨이 둘 다 있어야 요청서(안내 · 메모 탭의 라벨만 적힌 줄로 요청서가 되지 않게 · Codex 설계 3R · 4R)
  const contentKeys = new Set(CONTENT_LABELS.map(labelKey));
  const whenKeys = new Set(WHEN_LABELS.map(labelKey));
  let content = false; let when = false;
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const li = r.findIndex((c) => String(c ?? '').trim() !== '');
    if (li < 0) continue;
    const k = labelKey(r[li]);
    if (contentKeys.has(k) && String(r[li + 1] ?? '').trim() !== '') content = true;
    if (whenKeys.has(k)) when = true;
  }
  return content && when;
}

/**
 * ★ 2026-11-25 이 시트 행들이 명단으로 보이는가 — 한 열의 과반이 휴대폰 번호이고 그 번호가 두 줄 이상
 *   (전화번호 열 점수표 scorePhoneColumns = 명단 해석과 같은 판정 한 벌).
 *   한 파일 여러 건 판정이 이름에 「리스트」 · 「명단」이 없는 명단 시트(「Sheet2」 · 「DB」)를 알아보는 데 쓴다.
 *   ⛔ 연락처 한 칸만 적힌 메모 시트는 명단이 아니다(번호 두 줄 이상).
 */
export function agencyRowsLookLikeList(aoa: any[][]): boolean {
  const body = (aoa || []).filter((r) => Array.isArray(r) && r.some((c) => cellText(c) !== ''));
  if (body.length < 2) return false;
  const width = body.reduce((w, r) => Math.max(w, r.length), 0);
  const cols = Array.from({ length: width }, (_, i) => `c${i}`);
  const rows = body.map((r) => Object.fromEntries(cols.map((h, i) => [h, r[i]])));
  return scorePhoneColumns(cols, rows).some((sc) => sc.ratio >= 0.5 && rows.filter((r) => looksMobile(r[sc.column])).length >= 2);
}

/**
 * ★ 2026-11-25 「테스트 명단」 옆 표에서 담당자(테스트) 번호를 읽는다(설계서 §8-1 · 시세이도 실물 「(오른쪽 테스트 명단 참고) →」).
 *   「테스트 명단」 칸 아래 첫 머리줄에서 휴대폰 · 핸드폰 열을 먼저, 없으면 전화 · 연락처 · 번호 열을 고르고 아래로 빈칸 전까지.
 */
function readTestListPhones(rows: any[][]): string[] {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const c0 = row.findIndex((c) => normLabel(c) === '테스트명단');
    if (c0 < 0) continue;
    for (let h = r + 1; h < Math.min(rows.length, r + 4); h++) {
      const head = rows[h];
      if (!Array.isArray(head)) continue;
      const cols = head.map((c, i) => ({ i, k: normLabel(c) })).filter((x) => x.i >= c0 && x.k);
      const pick = cols.find((x) => /휴대폰|핸드폰/.test(x.k)) || cols.find((x) => /전화|연락처|번호/.test(x.k) && !/매장|지점|점포/.test(x.k));
      if (!pick) continue;
      const out: string[] = [];
      const seen = new Set<string>();
      for (let d = h + 1; d < rows.length; d++) {
        const v = Array.isArray(rows[d]) ? rows[d][pick.i] : null;
        if (v === null || v === undefined || String(v).trim() === '') break;
        const phone = normalizeAgencyPhone(String(v));
        if (!phone || phone.length < 10 || seen.has(phone)) continue;
        seen.add(phone);
        out.push(phone);
        if (out.length >= 10) break;
      }
      return out;
    }
  }
  return [];
}

/**
 * ★ 2026-11-25 이미지 파일명 칸 ① 줄 + 그 아래 ②③ 줄(번호표 · 앞뒤 공백 뺌).
 *   라벨 줄이 여럿이면(빈 「이미지 파일명」 + 값 있는 「이미지파일명」) 모두 모은다 — 일반 해석기(imageFileName)와 같은 값을 놓치지 않게(Codex 구현 1R).
 */
function readImageFileNames(rows: any[][]): string[] {
  const stripNo = (s: string) => s.replace(/^[①②③④⑤]\s*/, '').trim();
  const key = labelKey('이미지 파일명');
  let out: string[] = [];
  const seenBlocks = new Set<string>();
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const li = row.findIndex((c) => String(c ?? '').trim() !== '');
    if (li < 0 || labelKey(row[li]) !== key) continue;
    // 라벨 묶음 하나(① 줄 + 아래 ②③) = 자리 차례 그대로(같은 이름 두 자리도 남긴다 = 맞추기가 「같은 첨부 두 자리」로 반려 · Codex 구현 2R)
    const block: string[] = [];
    const firstRaw = cellText(row[li + 1]);
    const first = isPlaceholderValue(firstRaw) ? '' : stripNo(firstRaw);
    if (first) block.push(first);
    for (let n = r + 1; n < rows.length; n++) {
      const next = rows[n];
      const ni = Array.isArray(next) ? next.findIndex((c) => String(c ?? '').trim() !== '') : -1;
      if (ni < 0) break;
      const t = cellText(next[ni]);
      if (!/^[②③④⑤]/.test(t)) break;
      const name = stripNo(t) || stripNo(cellText(next[ni + 1]));
      if (name) block.push(name);
    }
    // 라벨 묶음이 여럿이면(빈 줄 + 값 있는 줄) 처음 나온 묶음만 잇는다(같은 묶음 반복 = 한 번 · 묶음 안 같은 이름 · 자리 차례는 보존)
    const blockKey = block.join('\u0000');
    if (block.length > 0 && !seenBlocks.has(blockKey)) { seenBlocks.add(blockKey); out = [...out, ...block]; }
  }
  return out;
}

/**
 * 요청서 시트를 라벨 기준으로 읽는다.
 * ★ 2026-11-25 opts.formSheet = 한 파일 여러 건의 짝 시트 이름(planAgencyWorkbook). 없으면 종전 고르기 규칙 그대로.
 */
export function parseAgencyRequestForm(buffer: Buffer, opts: { formSheet?: string | null; workbook?: XLSX.WorkBook | null } = {}): ParsedAgencyForm {
  const errors: AgencyFormError[] = [];
  let rows: any[][] = [];
  try {
    // ★ 2026-11-25(2) opts.workbook = 호출부가 이미 통째로 읽은 통합 문서(readAgencyWorkbook). 한 파일 여러 건은 짝마다 다시 읽지 않는다
    //   (공유 문자열 xlsx · xls 는 시트만 골라 읽어도 읽을 때마다 문자열 표 · 파일 전체를 다시 푼다 = 12짝 × 5,000명 실측 9초 · 24초 → 한 번 1초).
    // ★2026-09-13 **요청서 시트만** 읽는다(적대검토 medium). 통일 양식은 한 파일에 고객리스트 시트가 같이 있어
    //   워크북 전체를 읽으면 명단을 한 번 더 파싱한다(0913 실측 20만 행: 전체 4,174ms · 시트 이름만 2ms · 요청서 시트만 1ms).
    //   시트 고르는 규칙은 종전 그대로이고, 형식상 시트만 골라 읽기가 안 되면 종전처럼 전체를 읽는다.
    const names = opts.workbook ? opts.workbook.SheetNames : XLSX.read(buffer, { type: 'buffer', bookSheets: true }).SheetNames;
    if (opts.formSheet && !names.includes(opts.formSheet)) return unreadableAgencyForm();
    // ⛔ 시트는 이름으로 먼저 찾는다(★Codex 적대 1R) — 첫 시트만 읽으면 숨김·잔여 시트가
    //   보이는 값과 다른 값을 진실로 만들 수 있다. "요청서"(구양식) → "내용"(통일 양식) → 첫 시트.
    const sheetName = opts.formSheet || pickAgencyFormSheet(names);
    let sheet = opts.workbook ? opts.workbook.Sheets[sheetName] : XLSX.read(buffer, { ...SHEET_READ_OPTS, sheets: [sheetName] }).Sheets[sheetName];
    if (!sheet && !opts.workbook) sheet = XLSX.read(buffer, SHEET_READ_OPTS).Sheets[sheetName];
    sheetDatesToText(sheet);
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];
  } catch {
    return unreadableAgencyForm();
  }

  // ⛔ 중복은 **의미(필드) 단위**로 반려한다(★Codex 적대 1R·2R) — "광고 여부"와 "광고"처럼 별칭이
  //   달라도 같은 사실이면 값이 갈릴 때 반려한다. 첫 값이 조용히 이기면 사용자가 보는 값과 다른
  //   값(특히 광고 여부)이 진실이 된다.
  const FIELD_ALIASES: Array<{ field: string; labels: string[] }> = [
    // ★2026-08-26(2) 업계 양식 라벨(메시지 제목·메시지 내용·발송날짜 및 시간·테스트 문자 받을 번호)을
    //   별칭으로 합류. 대조는 labelKey(괄호 부연 제거)라 "(LMS,MMS만 해당)" 같은 부연은 자동으로 떨어진다.
    { field: '제목', labels: ['제목', '메시지 제목'] },
    { field: '문안', labels: ['문안', '문안내용', '내용', '메시지 내용'] },
    { field: '보낼 시각', labels: ['보낼 시각', '발송일시', '발송 시각', '요청발송일시', '발송날짜 및 시간', '발송 날짜', '발송날짜'] },
    { field: '회신번호', labels: ['회신번호', '발신번호', '보내는 번호'] },
    { field: '광고 여부', labels: ['광고 여부', '광고'] },
    // ★ 2026-11-25 업계 양식 「테스트번호 (여러 개 가능)」(시세이도 실물 · 설계서 §8-1) 별칭 합류
    { field: '담당자 번호', labels: ['담당자 번호', '담당자', '담당자번호', '테스트 문자 받을 번호', '테스트문자받을번호', '테스트번호', '테스트 번호', '테스트 수신번호'] },
    // ★2026-08-26 §18-4 신설(선택) — 명단에서 받는 사람 번호가 든 열의 이름. 있으면 자동 선정을 안 한다
    { field: '수신자 열 이름', labels: ['수신자 열 이름', '수신자 열', '수신자열', '전화번호 열', '전화번호열'] },
    // ★2026-08-26(2) 업계 양식 칸 — 문자타입은 알림톡·친구톡 반려 판정에만 쓴다(타입 자체는 배관이 정한다)
    { field: '문자타입', labels: ['문자타입', '문자 타입', '메시지타입', '메시지 타입'] },
    { field: '이미지 파일명', labels: ['이미지 파일명', '이미지파일명'] },
    // ★2026-08-27 §18-13 신설(선택) — 한 주소가 여러 청구 계정에 등록된 경우의 지정 칸(이메일 접수 전용 소비)
    // ★2026-09-05 §21-2 배포 양식 27행 라벨이 '발송 ID'가 됐다(Harold 확정). 내부 field 키는 그대로 두고
    //   labels에만 더한다 — 기존 7종은 하나도 빼지 않는다(0827부터 그 이름으로 보내는 담당자가 있다).
    //   ⛔ '발송 계정'·단독 '계정'·단독 '아이디'는 넣지 마라: 업체 자체 양식의 다른 뜻 라벨이 지정으로 읽혀
    //      계정이 하나뿐인 업체까지 billing_target_mismatch로 전량 반려된다(그 회신은 원인 칸을 말하지 않는다).
    {
      field: '청구 계정',
      labels: [
        '청구 계정', '청구계정', '청구 부서', '청구부서', '귀속 계정', '귀속계정', '청구 계정명',
        '발송 ID', '발송ID', '발송 아이디', '발송아이디',
      ],
    },
  ];
  const occurrences: Array<{ label: string; value: string }> = [];
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    // 라벨 = 행의 첫 비어 있지 않은 셀(업계 양식은 A열이 비어 B열부터 시작한다), 값 = 그 다음 셀
    const li = r.findIndex((c) => String(c ?? '').trim() !== '');
    if (li < 0) continue;
    const label = labelKey(r[li]);
    if (!label) continue;
    let value = li + 1 < r.length ? cellText(r[li + 1]) : '';
    if (isPlaceholderValue(value)) value = '';
    occurrences.push({ label, value });
  }
  const fieldValue = new Map<string, string>();
  for (const spec of FIELD_ALIASES) {
    const aliasSet = new Set(spec.labels.map(labelKey));
    const values = occurrences.filter((o) => aliasSet.has(o.label)).map((o) => o.value);
    const distinct = [...new Set(values.filter((v) => v !== ''))];
    if (distinct.length > 1) {
      errors.push({ field: spec.field, error: `요청서에 "${spec.field}" 항목이 여러 번 있고 값이 다릅니다. 하나만 남겨 주세요.` });
    }
    fieldValue.set(spec.field, distinct[0] || '');
  }
  const pick = (field: string): string => fieldValue.get(field) || '';

  const subject = pick('제목');
  const content = pick('문안');
  const requestedAtText = pick('보낼 시각');
  const callbackRaw = pick('회신번호');
  const isAd = parseIsAd(pick('광고 여부'));
  const phoneColumnName = pick('수신자 열 이름');
  const imageFileName = pick('이미지 파일명');

  // ★2026-08-26(2) 업계 양식은 알림톡·친구톡 겸용이다 — 이 접수 축은 문자만 받으므로 명확한 사유로 반려한다.
  //   SMS·LMS·MMS·빈칸은 통과(실제 타입은 문안 길이·이미지로 배관이 정한다 — 판정을 늘리지 않는다).
  const messageTypeText = pick('문자타입');
  if (/알림톡|친구톡|카카오|RCS/i.test(messageTypeText)) {
    errors.push({ field: '문자타입', error: '이 접수는 문자(SMS·LMS·MMS)만 받습니다. 알림톡·친구톡 발송은 담당자에게 따로 요청해 주세요.' });
  }
  const managerPhones: string[] = [];
  {
    const seen = new Set<string>();
    for (const raw of pick('담당자 번호').split(/[\s,;\n/]+/)) {
      // 0 유실 복원(★0826 §18-4) — 요청서 B열도 엑셀 숫자 셀이면 앞 0이 떨어진다
      const phone = normalizeAgencyPhone(raw);
      if (!phone || phone.length < 10 || seen.has(phone)) continue;
      seen.add(phone);
      managerPhones.push(phone);
      if (managerPhones.length >= 10) break;
    }
    // ★ 2026-11-25 칸에 번호가 없으면(「(오른쪽 테스트 명단 참고) →」 · 빈칸) 시트의 「테스트 명단」 표에서 읽는다(설계서 §8-1)
    if (managerPhones.length === 0) managerPhones.push(...readTestListPhones(rows));
  }

  if (!content) errors.push({ field: '문안', error: '문안 칸이 비어 있습니다.' });
  const requestedAt = requestedAtText ? parseWhenText(requestedAtText) : null;
  if (!requestedAtText) errors.push({ field: '보낼 시각', error: '보낼 시각 칸이 비어 있습니다.' });
  else if (!requestedAt) errors.push({ field: '보낼 시각', error: `보낼 시각을 읽지 못했습니다: "${requestedAtText}". 예: 8월 30일 10시 30분 또는 2026-09-01 14:00` });
  // ★ 2026-11-25 빈 회신번호 판정은 명단을 아는 analyzeOneStep 이 한다(명단 매장번호 열 · 설계서 §8-2 · 같은 문장)
  if (managerPhones.length === 0) errors.push({ field: '담당자 번호', error: '테스트 문자를 받을 담당자 휴대폰 번호가 없습니다.' });

  return {
    subject, content, requestedAtText, requestedAt, callbackRaw, isAd, managerPhones, phoneColumnName,
    imageFileName, imageFileNames: readImageFileNames(rows), billingTarget: pick('청구 계정'), errors,
  };
}

/**
 * 명단 행 상한.
 *
 * ★2026-09-12 6만에서 **없앴다**(0 = 제한 없음 · 남지현 접수 `cmtwlz0sf00kkjnlusipmsof8`).
 *   종전 근거는 "접수 상한(3만)의 두 배"였는데 그 접수 상한부터가 관례값이었고, 실측으로 둘 다 근거가 없다.
 *     - 시간: 이메일 접수는 1분 워커가 백그라운드로 돌고 겹침 가드(`running` + advisory lock)가 있어
 *       한 통이 오래 걸려도 다음 틱이 겹치지 않는다. 사용자가 기다리는 화면이 없다.
 *     - 메모리: 100만 행(6열 · 37MB 파일) 파싱 RSS 피크 310MB이고 접수가 끝나면 회수된다(서버 가용 46Gi).
 *   ⛔ **행수로 막지 않는다. 실질 방어선은 파일·메일 크기다** — 메일은 첨부 합계 상한, 화면 접수는
 *      업로드 파일 크기 상한이 먼저 건다. 행 상한을 다시 만들면 그 두 상한 안에 드는 정상 파일이 잘린다.
 *   실측(0912): 6열 5만=1.9MB · 20만=7.5MB · 50만=18.7MB · 100만=37.4MB (12열은 약 2배)
 */
export const MAX_LIST_ROWS = 0;
export const MAX_LIST_COLUMNS = 100;

/**
 * 명단 엑셀(자유형 · 첫 줄 = 열 이름).
 * ⛔ 열 이름은 **원래 자리(인덱스)를 보존**해 읽는다(★Codex 적대 1R high) — 빈 헤더를 걸러내며
 *   인덱스를 압축하면 그 뒤 모든 열이 한 칸씩 밀려 **다른 사람 번호로 발송**된다.
 * ⛔ 같은 이름의 열이 두 개면 duplicates로 알린다(뒤 열이 앞 열을 조용히 덮으면 값이 뒤바뀐다).
 * ★2026-08-26 §18-4 무헤더 명단: 첫 줄에 휴대폰 모양 값이 있으면 그 줄은 열 이름이 아니라 데이터다.
 *   그대로 두면 첫 고객이 열 이름으로 소비돼 **조용히 1명 유실**된다(Harold 실물 명단 실측).
 *   열 이름을 "열1·열2…"로 합성하고 첫 줄부터 데이터로 읽는다(자리 보존 원칙 동일).
 */
export function parseAgencyRecipientList(buffer: Buffer, opts: { listSheet?: string | null; workbook?: XLSX.WorkBook | null } = {}): {
  headers: string[]; rows: Record<string, any>[]; duplicates: string[]; truncated: boolean; columnsOverflow: boolean;
  /** 첫 줄이 데이터(무헤더)로 판정됐는가. 열 이름은 합성("열N")이다 */
  headerless: boolean;
} {
  // ★ 2026-11-25 **명단 시트만** 읽는다(요청서 읽기와 같은 방식 · 0913). 한 파일 여러 건은 짝마다 이 함수를 부르므로
  //   통합 문서 전체를 읽으면 짝 수 × 전체 크기로 불어난다(12짝 × 5,000명 실측 = 짝당 1.1초 · Codex 상한 1R).
  //   시트 고르는 규칙은 종전 그대로이고, 형식상 시트만 골라 읽기가 안 되면 종전처럼 전체를 읽는다.
  //   ★(2) opts.workbook = 이미 통째로 읽은 통합 문서(요청서 해석과 같음 · 여러 건은 파일마다 한 번만 읽는다).
  const names = opts.workbook ? opts.workbook.SheetNames : (XLSX.read(buffer, { type: 'buffer', bookSheets: true }).SheetNames || []);
  // ★2026-08-26(2) 통일 양식(한 파일)은 "고객리스트" 시트가 명단이다. 이름 정확 일치가 없을 때만
  //   첫 시트(별도 명단 파일 = 구양식·자유형 하위호환). "고객 명단 예시" 같은 예시 시트는 일치하지 않는다.
  // ★ 2026-11-25 opts.listSheet = 한 파일 여러 건의 짝 명단 시트(planAgencyWorkbook) · 없으면 종전 규칙 · 지정했는데 없으면 빈 명단(엉뚱한 시트로 폴백 0)
  if (opts.listSheet && !names.includes(opts.listSheet)) return { headers: [], rows: [], duplicates: [], truncated: false, columnsOverflow: false, headerless: false };
  //   ⛔ 이 고르기 규칙(표준 이름 → 첫 시트)은 바꾸지 않는다 — 탭 이름 일부(「안내」 · 「테스트」)로 첫 시트를 건너뛰면
  //   「당첨 안내 대상」 같은 진짜 명단 대신 뒤 시트(지난달 명단)가 받는 사람이 된다(Codex 짝 3R · 2R 에 넣었다가 되돌림).
  const sheetName = opts.listSheet || pickAgencyListSheet(names);
  let sheet = opts.workbook ? opts.workbook.Sheets[sheetName]
    : sheetName ? XLSX.read(buffer, { ...SHEET_READ_OPTS, sheets: [sheetName] }).Sheets[sheetName] : undefined;
  if (!sheet && !opts.workbook) sheet = XLSX.read(buffer, SHEET_READ_OPTS).Sheets[sheetName];
  // 시트를 못 찾음 = 종전처럼 읽지 못함(호출부가 「명단 파일을 읽지 못했습니다」로 받는다 · 빈 명단으로 조용히 넘기지 않는다)
  if (!sheet) throw new Error('agency-send-form: list sheet not readable');
  // ★2026-09-13(3) 날짜 셀 = 엑셀에 보이는 벽시계 글자(SHEET_READ_OPTS 주석 · 종전에는 UTC ISO로 저장돼 문자에 들어갔다)
  sheetDatesToText(sheet);
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];
  if (aoa.length === 0) return { headers: [], rows: [], duplicates: [], truncated: false, columnsOverflow: false, headerless: false };

  const headerless = (aoa[0] || []).some((c: any) => looksMobile(c));
  const cols: Array<{ name: string; index: number }> = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  if (headerless) {
    (aoa[0] || []).slice(0, MAX_LIST_COLUMNS).forEach((_: any, index: number) => {
      cols.push({ name: `열${index + 1}`, index });
    });
  } else {
    (aoa[0] || []).slice(0, MAX_LIST_COLUMNS).forEach((h: any, index: number) => {
      const name = String(h ?? '').trim();
      if (!name) return; // 빈 헤더 열은 건너뛴다 — 단, index는 보존되므로 뒤 열이 밀리지 않는다
      if (seen.has(name)) { duplicates.push(name); return; }
      seen.add(name);
      cols.push({ name, index });
    });
  }

  const dataStart = headerless ? 0 : 1;
  const columnsOverflow = (aoa[0] || []).length > MAX_LIST_COLUMNS;
  // ★2026-09-12 `MAX_LIST_ROWS = 0` = 제한 없음(상수 주석 참조). 0이면 자르지도, 잘렸다고 알리지도 않는다.
  const rowLimit = MAX_LIST_ROWS > 0 ? MAX_LIST_ROWS : Infinity;
  const truncated = aoa.length - dataStart > rowLimit;
  const rows: Record<string, any>[] = [];
  const end = Math.min(aoa.length, rowLimit + dataStart);
  for (let i = dataStart; i < end; i++) {
    const r = aoa[i];
    if (!Array.isArray(r) || r.every((c) => c === null || String(c).trim() === '')) continue;
    const obj: Record<string, any> = {};
    for (const c of cols) obj[c.name] = r[c.index] ?? null;
    rows.push(obj);
  }
  return { headers: cols.map((c) => c.name), rows, duplicates, truncated, columnsOverflow, headerless };
}

/** 휴대폰 번호로 보이는가(01로 시작하는 10~11자리 · ★0826 엑셀 0 유실 복원 후 판정) */
function looksMobile(v: any): boolean {
  const d = restoreMobileLeadingZero(ONLY_DIGITS(String(v ?? '')));
  return (d.length === 10 || d.length === 11) && d.startsWith('01');
}

/**
 * ★ 2026-11-25(2) 그 열의 **비어 있지 않은 값**(명단 전체)의 **절반을 넘는** 칸이 휴대폰 번호인가 — 문안 자리(이름 등)에 이을 열에서 번호 열을 가려낸다.
 *   아래 점수표(수신번호 열 고르기)는 빈 칸도 행 수에 넣으므로 빈 칸이 많은 번호 열이 과반 미만으로 나온다 → 이 판정을 따로 둔다
 *   (같은 뜻 이름 자동 연결 · 괄호 자리 후보 제외가 같이 쓴다 · Codex 같은 뜻 2R).
 *   ⛔ 칸 **전체**가 번호 모양인 값만 센다 — 「김민지 (010-0000-0011)」처럼 이름과 번호가 같이 적힌 칸은 번호 칸이 아니다 · 정확히 절반은 번호 열이 아니다(3R).
 *   명단 전체를 한 번 훑는다(앞 200행만 보면 뒤쪽이 번호인 열을 놓친다 · 4R) — 부르는 쪽은 후보로 오른 열에만 부른다.
 */
export function agencyColumnMostlyMobile(column: string, rows: Array<Record<string, any>>): boolean {
  let filled = 0; let mobile = 0;
  for (const r of rows) {
    const t = cellText(r?.[column]);
    if (t === '') continue;
    filled++;
    if (agencyCellIsMobile(t)) mobile++;
  }
  return filled > 0 && mobile * 2 > filled;
}

/** 칸 전체가 휴대폰 번호인가(숫자 · 공백 · 하이픈 · 괄호 · 마침표 · 더하기만 + 휴대폰 번호 모양) — 위 판정과 같은 뜻 이름 판정이 같이 쓴다 */
export function agencyCellIsMobile(v: any): boolean {
  const t = cellText(v);
  return t !== '' && /^[0-9\s\-().+]+$/.test(t) && looksMobile(t);
}

/**
 * 전화번호 열 점수표 — 각 열의 **휴대폰 번호 비율**(표본 최대 200행)을 비율 내림차순으로 돌려준다.
 * ★2026-08-26 §18-4: 판정 구현은 이 한 벌이다. 화면(0.5)과 이메일(0.9 + 격차)은 **임계만 다르다** —
 *   임계별로 구현을 복제하면 화면과 메일의 열 선정이 갈린다(회의론자 지적).
 */
export function scorePhoneColumns(headers: string[], rows: Record<string, any>[]): Array<{ column: string; ratio: number }> {
  if (headers.length === 0 || rows.length === 0) return [];
  const sample = rows.slice(0, 200);
  return headers
    .map((h) => ({ column: h, ratio: sample.filter((r) => looksMobile(r[h])).length / sample.length }))
    .sort((a, b) => b.ratio - a.ratio);
}

/**
 * 전화번호 열 선정(화면·원스텝) — 과반이 번호인 열이 없으면 null(아무 열이나 집어 엉뚱한 값으로 발송하지 않는다).
 * 사람이 확인 화면에서 고쳐 볼 수 있는 경로라 0.5로 충분하다.
 */
export function pickPhoneColumn(headers: string[], rows: Record<string, any>[]): string | null {
  const scores = scorePhoneColumns(headers, rows);
  return scores.length > 0 && scores[0].ratio >= 0.5 ? scores[0].column : null;
}

/**
 * 전화번호 열 선정(이메일 접수 · ★0826 §18-3) — 사람 눈이 없는 경로라 임계를 조인다:
 * 최고 비율 0.9 이상 **이고** 2등과 0.3 이상 격차일 때만 자동 채택. 아니면 null(반려).
 */
export function pickPhoneColumnStrict(headers: string[], rows: Record<string, any>[]): string | null {
  const scores = scorePhoneColumns(headers, rows);
  if (scores.length === 0 || scores[0].ratio < 0.9) return null;
  if (scores.length > 1 && scores[0].ratio - scores[1].ratio < 0.3) return null;
  return scores[0].column;
}

/**
 * 이 버퍼가 "요청서" 파일로 보이는가(시트 이름 기준 · §17-5 계약).
 * 이메일 첨부 2개 중 어느 쪽이 요청서인지 **파일명이 아니라 내용으로** 가른다(★0826 §18-3).
 * ★2026-08-26(2) 통일 양식 = "내용" + "고객리스트" 시트 짝. "내용" 단독은 오탐 위험이라 짝일 때만 참.
 */
export function looksLikeRequestForm(buffer: Buffer): boolean {
  try {
    return namesLookLikeRequestForm(XLSX.read(buffer, { type: 'buffer', bookSheets: true }).SheetNames || []);
  } catch {
    return false;
  }
}

/** ★ 2026-11-25(2) 위 판정의 이름판(이미 시트 이름을 가진 호출부 = 짝 판정이 파일을 다시 읽지 않게 · 규칙은 이 한 벌) */
export function namesLookLikeRequestForm(sheetNames: string[]): boolean {
  const names = sheetNames.map((n) => normLabel(n));
  return names.includes('요청서')
    || (names.includes('내용') && names.some((n) => RECIPIENT_SHEET_NAMES.has(n)));
}

/** 명단 시트(고객리스트 · 고객명단)가 있는가 — 이름판 */
export function namesHaveRecipientSheet(sheetNames: string[]): boolean {
  return sheetNames.some((n) => RECIPIENT_SHEET_NAMES.has(normLabel(n)));
}

/**
 * ★ 2026-11-25(2) 오늘 고르기 규칙 한 벌 — 해석기 둘과 짝 판정(planAgencyWorkbook)이 같은 함수를 쓴다.
 *   판정이 「이 시트가 보인다」고 확인한 시트와 해석기가 실제로 읽는 시트가 다르면, 확인하지 않은 시트(숨긴 지난달 명단)가 읽힌다(Codex 짝 7R).
 *   요청서 = "요청서"(구양식) → "내용"(통일 양식) → 첫 시트 · 명단 = 파일 차례로 처음 나오는 고객리스트 · 고객명단 → 첫 시트.
 */
export function pickAgencyFormSheet(sheetNames: string[]): string {
  return sheetNames.find((n) => normLabel(n) === '요청서') || sheetNames.find((n) => normLabel(n) === '내용') || sheetNames[0];
}
export function pickAgencyListSheet(sheetNames: string[]): string {
  return sheetNames.find((n) => RECIPIENT_SHEET_NAMES.has(normLabel(n))) || sheetNames[0];
}

/** ★ 2026-11-25(2) 통합 문서를 통째로 한 번 읽는다(해석기와 같은 읽기 옵션) — 한 파일 여러 건의 짝마다 해석에 넘긴다 */
export function readAgencyWorkbook(buffer: Buffer): XLSX.WorkBook {
  return XLSX.read(buffer, SHEET_READ_OPTS);
}

/**
 * 이 버퍼에 명단 시트("고객리스트")가 들어 있는가(★2026-08-26(2) 통일 양식 = 한 파일).
 * 참이면 명단 파일 없이 이 파일 하나로 접수가 성립한다 — parseAgencyRecipientList가 그 시트를 읽는다.
 */
export function hasRecipientSheet(buffer: Buffer): boolean {
  try {
    return namesHaveRecipientSheet(XLSX.read(buffer, { type: 'buffer', bookSheets: true }).SheetNames || []);
  } catch {
    return false;
  }
}

/** 이름으로 명단 열 찾기(공백 무시 · 회신번호 열 방식과 같은 판정 한 벌). 없으면 null */
export function matchHeader(name: string, headers: string[]): string | null {
  const n = normLabel(name);
  if (!n) return null;
  return headers.find((h) => normLabel(h) === n) ?? null;
}

/** 회신번호 칸 해석 — 번호(8자리 이상 숫자)면 직접, 명단 열 이름과 맞으면 열 방식 */
/**
 * ★ 2026-11-25 빈 발신번호 = 명단의 매장 전화 열(Harold 「매장번호 있잖아? 거기 항상 채워서 줘」 · 설계서 §8-2).
 *   이름(공백 뺌)이 (매장|지점|점포|가맹점) 과 (번호|전화|연락처) 를 함께 품은 열 = 후보.
 *   후보가 정확히 하나이고 · 수신자 열이 아니며 · 휴대폰 값 비율 < 0.5(매장 전화 = 유선 · Codex 설계 1R)일 때만 그 열.
 *   그 밖 = null(부르는 쪽이 「회신번호 칸이 비어 있습니다」 + 후보 이름으로 반려).
 */
export function pickStoreCallbackColumn(
  headers: string[], rows: Record<string, any>[], phoneColumn: string | null,
): { column: string | null; candidates: string[] } {
  const candidates = headers.filter((h) => {
    const k = normLabel(h);
    return /(매장|지점|점포|가맹점)/.test(k) && /(번호|전화|연락처)/.test(k);
  });
  if (candidates.length !== 1) return { column: null, candidates };
  const col = candidates[0];
  if (col === phoneColumn) return { column: null, candidates };
  const ratio = scorePhoneColumns([col], rows)[0]?.ratio ?? 0;
  return { column: ratio < 0.5 ? col : null, candidates };
}

export function resolveCallbackPlan(callbackRaw: string, headers: string[]): CallbackPlan {
  const raw = String(callbackRaw || '').trim();
  if (!raw) return { mode: 'none' };
  const digits = ONLY_DIGITS(raw);
  // "0507-0000-0000 (기본)" 같은 표기도 숫자만 추려 번호로 본다. 0 유실 복원은 휴대폰 패턴에만 닿는다(★0826)
  if (digits.length >= 8 && digits.length <= 12 && /^[\d\s()+-]+$/.test(raw)) {
    return { mode: 'fixed', number: restoreMobileLeadingZero(normalizePhone(digits) || digits) };
  }
  const name = raw.replace(/^열\s*이름\s*[:：]\s*/, '').trim();
  const hit = matchHeader(name, headers);
  if (hit) return { mode: 'column', column: hit };
  return { mode: 'none' };
}
