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
 * ★2026-08-26(2) 한국어 표기도 받는다: "2026년 9월 1일 14시 30분" · "2026년 9월 1일(월) 오후 2시".
 *   **연도 없는 표기("9월 1일 14시")는 받지 않는다** — 이메일은 확인 화면이 없는 무인 경로라
 *   해를 추정하면 틀린 해로 그대로 나간다. 반려 회신이 올바른 예시를 안내한다.
 * ⛔ 끝까지 고정한다(시간대 접미사 등 잔여 문자는 거절) + **달력 왕복 대조**를 한다(★Codex 적대 1R) —
 *   JS Date는 2월 30일을 3월 2일로 조용히 굴려서, 검증만 통과하고 사용자가 적지 않은 날에 나간다.
 */
export function parseWhenText(text: string): Date | null {
  const s = String(text || '').trim();
  let y: number; let mo: number; let dd: number; let hh: number; let mi: number;
  const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})[\sT]+(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) {
    [y, mo, dd, hh, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  } else {
    const k = s.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:[(（][^)）]{1,4}[)）])?\s*(?:(오전|오후)\s*)?(\d{1,2})(?:\s*시\s*(?:(\d{1,2})\s*분?)?|\s*:\s*(\d{2}))$/);
    if (!k) return null;
    [y, mo, dd] = [Number(k[1]), Number(k[2]), Number(k[3])];
    hh = Number(k[5]);
    if (k[4] === '오후' && hh < 12) hh += 12;
    if (k[4] === '오전' && hh === 12) hh = 0;
    mi = Number(k[6] ?? k[7] ?? 0);
  }
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
    // ⛔ 시트는 이름으로 먼저 찾는다(★Codex 적대 1R) — 첫 시트만 읽으면 숨김·잔여 시트가
    //   보이는 값과 다른 값을 진실로 만들 수 있다. "요청서"(구양식) → "내용"(통일 양식) → 첫 시트.
    const sheetName = wb.SheetNames.find((n) => normLabel(n) === '요청서')
      || wb.SheetNames.find((n) => normLabel(n) === '내용')
      || wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];
  } catch {
    return {
      subject: '', content: '', requestedAtText: '', requestedAt: null, callbackRaw: '',
      isAd: true, managerPhones: [], phoneColumnName: '', imageFileName: '',
      errors: [{ field: '요청서', error: '요청서 파일을 읽지 못했습니다. 양식 그대로인지 확인해 주세요.' }],
    };
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
    { field: '담당자 번호', labels: ['담당자 번호', '담당자', '담당자번호', '테스트 문자 받을 번호', '테스트문자받을번호'] },
    // ★2026-08-26 §18-4 신설(선택) — 명단에서 받는 사람 번호가 든 열의 이름. 있으면 자동 선정을 안 한다
    { field: '수신자 열 이름', labels: ['수신자 열 이름', '수신자 열', '수신자열', '전화번호 열', '전화번호열'] },
    // ★2026-08-26(2) 업계 양식 칸 — 문자타입은 알림톡·친구톡 반려 판정에만 쓴다(타입 자체는 배관이 정한다)
    { field: '문자타입', labels: ['문자타입', '문자 타입', '메시지타입', '메시지 타입'] },
    { field: '이미지 파일명', labels: ['이미지 파일명', '이미지파일명'] },
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
  }

  if (!content) errors.push({ field: '문안', error: '문안 칸이 비어 있습니다.' });
  const requestedAt = requestedAtText ? parseWhenText(requestedAtText) : null;
  if (!requestedAtText) errors.push({ field: '보낼 시각', error: '보낼 시각 칸이 비어 있습니다.' });
  else if (!requestedAt) errors.push({ field: '보낼 시각', error: `보낼 시각을 읽지 못했습니다: "${requestedAtText}". 예: 2026-09-01 14:00` });
  if (!callbackRaw) errors.push({ field: '회신번호', error: '회신번호 칸이 비어 있습니다. 번호 또는 명단의 열 이름을 적어 주세요.' });
  if (managerPhones.length === 0) errors.push({ field: '담당자 번호', error: '테스트 문자를 받을 담당자 휴대폰 번호가 없습니다.' });

  return { subject, content, requestedAtText, requestedAt, callbackRaw, isAd, managerPhones, phoneColumnName, imageFileName, errors };
}

/** 명단 상한. 접수 상한(3만)의 두 배까지 읽고 그 위는 자른다(초과는 분석 단계가 반려한다) */
export const MAX_LIST_ROWS = 60000;
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
export function parseAgencyRecipientList(buffer: Buffer): {
  headers: string[]; rows: Record<string, any>[]; duplicates: string[]; truncated: boolean; columnsOverflow: boolean;
  /** 첫 줄이 데이터(무헤더)로 판정됐는가. 열 이름은 합성("열N")이다 */
  headerless: boolean;
} {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellFormula: false, cellHTML: false, sheetStubs: false });
  // ★2026-08-26(2) 통일 양식(한 파일)은 "고객리스트" 시트가 명단이다. 이름 정확 일치가 없을 때만
  //   첫 시트(별도 명단 파일 = 구양식·자유형 하위호환). "고객 명단 예시" 같은 예시 시트는 일치하지 않는다.
  const sheetName = wb.SheetNames.find((n) => RECIPIENT_SHEET_NAMES.has(normLabel(n))) || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
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
  const truncated = aoa.length - dataStart > MAX_LIST_ROWS;
  const rows: Record<string, any>[] = [];
  const end = Math.min(aoa.length, MAX_LIST_ROWS + dataStart);
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
    const wb = XLSX.read(buffer, { type: 'buffer', bookSheets: true });
    const names = (wb.SheetNames || []).map((n) => normLabel(n));
    return names.includes('요청서')
      || (names.includes('내용') && names.some((n) => RECIPIENT_SHEET_NAMES.has(n)));
  } catch {
    return false;
  }
}

/**
 * 이 버퍼에 명단 시트("고객리스트")가 들어 있는가(★2026-08-26(2) 통일 양식 = 한 파일).
 * 참이면 명단 파일 없이 이 파일 하나로 접수가 성립한다 — parseAgencyRecipientList가 그 시트를 읽는다.
 */
export function hasRecipientSheet(buffer: Buffer): boolean {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', bookSheets: true });
    return (wb.SheetNames || []).some((n) => RECIPIENT_SHEET_NAMES.has(normLabel(n)));
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
