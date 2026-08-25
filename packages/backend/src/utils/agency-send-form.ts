/**
 * agency-send-form.ts — 대행발송 요청서 파서 CT (★ 2026-08-25(3) 신설 · Harold "요청서 엑셀 규격화")
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §17. 요청서 엑셀(규격)과 명단 엑셀(자유형)을 서버가
 * 읽어 원스텝 접수 재료로 바꾼다. **브라우저에는 상위 50건 샘플과 집계만 내려간다**(전 행 전송이
 * 화면 접수가 느린 진짜 원인이었다 — 중복 검사 계산이 아니라 전송이 병목).
 *
 * 규격(양식 = frontend/public/agency-request-form.xlsx):
 *   A열 = 항목 라벨, B열 = 값. **행 위치가 아니라 라벨로 읽는다**(행이 밀려도 라벨이 맞으면 읽힌다).
 *   항목 = 제목 · 문안 · 보낼 시각 · 회신번호 · 광고 여부 · 담당자 번호. C열(도움말)은 읽지 않는다.
 *
 * ⛔ 광고 기본 = 예(Harold 2026-08-25 지시). "아니오"라고 적은 경우만 해제한다.
 * ⛔ 회신번호 칸은 두 가지를 받는다: 번호(직접) 또는 명단의 열 이름(열 방식).
 *   열 방식이면 접수가 **회신번호별로 나뉜다** — 대행발송이 타는 적재 배관(주소록 슬롯 5칸)은
 *   수신자별 회신번호를 나르지 못하기 때문이다(agency-send-worker 적재부 주석이 그 사실을 소유).
 * ⛔ 전화번호 열은 이름이 아니라 **값이 실제 휴대폰 번호인 비율**로 고른다(이름 추정은 오탈자에 진다).
 */
import * as XLSX from 'xlsx';
import { normalizePhone } from './normalize-phone';

export interface AgencyFormError { field: string; error: string }

export interface ParsedAgencyForm {
  subject: string;
  content: string;
  requestedAtText: string;
  requestedAt: Date | null;
  callbackRaw: string;
  isAd: boolean;
  managerPhones: string[];
  errors: AgencyFormError[];
}

export type CallbackPlan =
  | { mode: 'fixed'; number: string }
  | { mode: 'column'; column: string }
  | { mode: 'none' };

const ONLY_DIGITS = (s: string) => String(s || '').replace(/[^0-9]/g, '');

/** 라벨 정규화(공백 제거). "보낼시각"과 "보낼 시각"을 같게 본다 */
const normLabel = (s: any) => String(s ?? '').replace(/\s+/g, '').trim();

/** 셀 값 → 문자열(셀이 Date면 KST 문자로) */
function cellText(v: any): string {
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}`;
  }
  return String(v ?? '').trim();
}

/**
 * "2026-09-01 14:00" 류를 서버 시각(KST 운영)으로 읽는다. 구분자 - . / 허용, 초는 허용·무시.
 * ⛔ 끝까지 고정한다(시간대 접미사 등 잔여 문자는 거절) + **달력 왕복 대조**를 한다(★Codex 적대 1R) —
 *   JS Date는 2월 30일을 3월 2일로 조용히 굴려서, 검증만 통과하고 사용자가 적지 않은 날에 나간다.
 */
export function parseWhenText(text: string): Date | null {
  const m = String(text || '').trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})[\sT]+(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const [y, mo, dd, hh, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59) return null;
  const d = new Date(y, mo - 1, dd, hh, mi, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  // 왕복 대조 — 넣은 값 그대로 나오지 않으면 달력에 없는 날짜다
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== dd || d.getHours() !== hh || d.getMinutes() !== mi) return null;
  return d;
}

/** 광고 여부. 기본 = 예(Harold 지시) — 명시적인 부정만 끈다 */
function parseIsAd(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, '').toLowerCase();
  return !['아니오', '아니요', '아님', 'no', 'n', 'x', '없음', '비광고'].includes(t) || t === '';
}

/** 요청서 시트를 라벨 기준으로 읽는다 */
export function parseAgencyRequestForm(buffer: Buffer): ParsedAgencyForm {
  const errors: AgencyFormError[] = [];
  let rows: any[][] = [];
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellFormula: false, cellHTML: false, sheetStubs: false });
    // ⛔ 시트는 이름("요청서")으로 먼저 찾는다(★Codex 적대 1R) — 첫 시트만 읽으면 숨김·잔여 시트가
    //   보이는 값과 다른 값을 진실로 만들 수 있다. 이름이 없으면 그때만 첫 시트다.
    const sheetName = wb.SheetNames.find((n) => normLabel(n) === '요청서') || wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];
  } catch {
    return {
      subject: '', content: '', requestedAtText: '', requestedAt: null, callbackRaw: '',
      isAd: true, managerPhones: [], errors: [{ field: '요청서', error: '요청서 파일을 읽지 못했습니다. 양식 그대로인지 확인해 주세요.' }],
    };
  }

  // ⛔ 중복은 **의미(필드) 단위**로 반려한다(★Codex 적대 1R·2R) — "광고 여부"와 "광고"처럼 별칭이
  //   달라도 같은 사실이면 값이 갈릴 때 반려한다. 첫 값이 조용히 이기면 사용자가 보는 값과 다른
  //   값(특히 광고 여부)이 진실이 된다.
  const FIELD_ALIASES: Array<{ field: string; labels: string[] }> = [
    { field: '제목', labels: ['제목'] },
    { field: '문안', labels: ['문안', '문안내용', '내용'] },
    { field: '보낼 시각', labels: ['보낼 시각', '발송일시', '발송 시각', '요청발송일시'] },
    { field: '회신번호', labels: ['회신번호', '발신번호', '보내는 번호'] },
    { field: '광고 여부', labels: ['광고 여부', '광고'] },
    { field: '담당자 번호', labels: ['담당자 번호', '담당자', '담당자번호'] },
  ];
  const occurrences: Array<{ label: string; value: string }> = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 2) continue;
    const label = normLabel(r[0]);
    if (!label) continue;
    occurrences.push({ label, value: cellText(r[1]) });
  }
  const fieldValue = new Map<string, string>();
  for (const spec of FIELD_ALIASES) {
    const aliasSet = new Set(spec.labels.map(normLabel));
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
  const managerPhones: string[] = [];
  {
    const seen = new Set<string>();
    for (const raw of pick('담당자 번호').split(/[\s,;\n/]+/)) {
      const phone = normalizePhone(ONLY_DIGITS(raw));
      if (!phone || phone.length < 10 || seen.has(phone)) continue;
      seen.add(phone);
      managerPhones.push(phone);
      if (managerPhones.length >= 10) break;
    }
  }

  if (!content) errors.push({ field: '문안', error: '문안 칸이 비어 있습니다.' });
  const requestedAt = requestedAtText ? parseWhenText(requestedAtText) : null;
  if (!requestedAtText) errors.push({ field: '보낼 시각', error: '보낼 시각 칸이 비어 있습니다.' });
  else if (!requestedAt) errors.push({ field: '보낼 시각', error: `보낼 시각을 읽지 못했습니다: "${requestedAtText}". 예: 2026-09-01 14:00` });
  if (!callbackRaw) errors.push({ field: '회신번호', error: '회신번호 칸이 비어 있습니다. 번호 또는 명단의 열 이름을 적어 주세요.' });
  if (managerPhones.length === 0) errors.push({ field: '담당자 번호', error: '테스트 문자를 받을 담당자 휴대폰 번호가 없습니다.' });

  return { subject, content, requestedAtText, requestedAt, callbackRaw, isAd, managerPhones, errors };
}

/** 명단 상한. 접수 상한(3만)의 두 배까지 읽고 그 위는 자른다(초과는 분석 단계가 반려한다) */
export const MAX_LIST_ROWS = 60000;
export const MAX_LIST_COLUMNS = 100;

/**
 * 명단 엑셀(자유형 · 첫 줄 = 열 이름).
 * ⛔ 열 이름은 **원래 자리(인덱스)를 보존**해 읽는다(★Codex 적대 1R high) — 빈 헤더를 걸러내며
 *   인덱스를 압축하면 그 뒤 모든 열이 한 칸씩 밀려 **다른 사람 번호로 발송**된다.
 * ⛔ 같은 이름의 열이 두 개면 duplicates로 알린다(뒤 열이 앞 열을 조용히 덮으면 값이 뒤바뀐다).
 */
export function parseAgencyRecipientList(buffer: Buffer): {
  headers: string[]; rows: Record<string, any>[]; duplicates: string[]; truncated: boolean; columnsOverflow: boolean;
} {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellFormula: false, cellHTML: false, sheetStubs: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];
  if (aoa.length === 0) return { headers: [], rows: [], duplicates: [], truncated: false, columnsOverflow: false };

  const cols: Array<{ name: string; index: number }> = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  (aoa[0] || []).slice(0, MAX_LIST_COLUMNS).forEach((h: any, index: number) => {
    const name = String(h ?? '').trim();
    if (!name) return; // 빈 헤더 열은 건너뛴다 — 단, index는 보존되므로 뒤 열이 밀리지 않는다
    if (seen.has(name)) { duplicates.push(name); return; }
    seen.add(name);
    cols.push({ name, index });
  });

  const columnsOverflow = (aoa[0] || []).length > MAX_LIST_COLUMNS;
  const truncated = aoa.length - 1 > MAX_LIST_ROWS;
  const rows: Record<string, any>[] = [];
  const end = Math.min(aoa.length, MAX_LIST_ROWS + 1);
  for (let i = 1; i < end; i++) {
    const r = aoa[i];
    if (!Array.isArray(r) || r.every((c) => c === null || String(c).trim() === '')) continue;
    const obj: Record<string, any> = {};
    for (const c of cols) obj[c.name] = r[c.index] ?? null;
    rows.push(obj);
  }
  return { headers: cols.map((c) => c.name), rows, duplicates, truncated, columnsOverflow };
}

/** 휴대폰 번호로 보이는가(01로 시작하는 10~11자리) */
function looksMobile(v: any): boolean {
  const d = ONLY_DIGITS(String(v ?? ''));
  return (d.length === 10 || d.length === 11) && d.startsWith('01');
}

/**
 * 전화번호 열 선정 — 각 열의 **휴대폰 번호 비율**을 재서 가장 높은 열을 고른다(표본 최대 200행).
 * 과반이 번호인 열이 없으면 null(아무 열이나 집어 엉뚱한 값으로 발송하지 않는다).
 */
export function pickPhoneColumn(headers: string[], rows: Record<string, any>[]): string | null {
  if (headers.length === 0 || rows.length === 0) return null;
  const sample = rows.slice(0, 200);
  let best: string | null = null;
  let bestRatio = 0;
  for (const h of headers) {
    const hit = sample.filter((r) => looksMobile(r[h])).length;
    const ratio = hit / sample.length;
    if (ratio > bestRatio) { bestRatio = ratio; best = h; }
  }
  return bestRatio >= 0.5 ? best : null;
}

/** 회신번호 칸 해석 — 번호(8자리 이상 숫자)면 직접, 명단 열 이름과 맞으면 열 방식 */
export function resolveCallbackPlan(callbackRaw: string, headers: string[]): CallbackPlan {
  const raw = String(callbackRaw || '').trim();
  if (!raw) return { mode: 'none' };
  const digits = ONLY_DIGITS(raw);
  // "0507-0000-0000 (기본)" 같은 표기도 숫자만 추려 번호로 본다
  if (digits.length >= 8 && digits.length <= 12 && /^[\d\s()+-]+$/.test(raw)) {
    return { mode: 'fixed', number: normalizePhone(digits) || digits };
  }
  const name = raw.replace(/^열\s*이름\s*[:：]\s*/, '').trim();
  const hit = headers.find((h) => normLabel(h) === normLabel(name));
  if (hit) return { mode: 'column', column: hit };
  return { mode: 'none' };
}
