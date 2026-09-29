/**
 * target-extraction.ts — 직접 타겟 추출 보관본 화면 CT (★2026-09-29 한줄로 V2 R112 · 설계 docs/2026-09-28-v2-round4-send-redesign.md §2-1)
 *
 * 추출 명단 전체는 서버 발송 준비 표에 보관되고, 화면은 건수 · 앞 15명 · 가장 긴 값만 든다.
 * 서버 입구 = /api/customers/extract(keep) · /api/customers/extractions/:id/{search,remove,rows,callback}.
 * 화면(추출 창 · 대시보드 · 직접 타겟 발송 창)은 이 파일만 부른다 — 요청 모양·만료 판정이 한 곳에 있다.
 */

export interface TargetExtraction {
  /** 보관본 id = 발송 준비분 id(stagingId) */
  extractionId: string;
  /** 보관한 행 수 */
  count: number;
  /** 번호가 비었거나 너무 길어 넣지 않은 행 수 */
  skippedNoPhone: number;
  /** 앞 15명(추출 순서) — 표·미리보기·스팸 검사 첫 행 */
  sample: any[];
  /** 칸마다 가장 긴 값 — 최장 바이트 계산이 명단 전체 대신 이 한 행을 읽는다 */
  longest: Record<string, string>;
  /** 이 시각 뒤에는 발송할 수 없다(추출 + 23시간) */
  expiresAt: string;
  /** 번호 칸(추출과 같은 칸으로 검색·전체 행·회신번호를 잇는다) */
  phoneField: string;
  /** 추출 요청 본문(같은 조건으로 다시 추출) */
  filterBody: Record<string, any>;
}

export type ExtractionCallResult<T> =
  | { ok: true; data: T }
  | { ok: false; expired: boolean; error: string };

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
});

async function post<T>(url: string, body: unknown): Promise<ExtractionCallResult<T>> {
  try {
    const res = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success !== true) {
      return { ok: false, expired: data?.code === 'EXTRACTION_EXPIRED', error: data?.error || `서버 오류가 발생했습니다 (${res.status})` };
    }
    return { ok: true, data: data as T };
  } catch (e: any) {
    return { ok: false, expired: false, error: e?.message || '서버에 연결할 수 없습니다.' };
  }
}

/** 추출하고 보관본으로 받는다. filterBody = 지금 추출 요청 본문(dynamicFilters · smsOptIn · phoneField) */
export async function requestKeptExtraction(filterBody: Record<string, any>): Promise<ExtractionCallResult<TargetExtraction>> {
  const r = await post<any>('/api/customers/extract', { ...filterBody, keep: true });
  if (!r.ok) return r;
  const d = r.data;
  return {
    ok: true,
    data: {
      extractionId: d.extractionId || '',
      count: Number(d.count) || 0,
      skippedNoPhone: Number(d.skippedNoPhone) || 0,
      sample: Array.isArray(d.sample) ? d.sample : [],
      longest: d.longest && typeof d.longest === 'object' ? d.longest : {},
      expiresAt: d.expiresAt || '',
      phoneField: String(filterBody.phoneField || 'phone'),
      filterBody,
    },
  };
}

/** 보관본 전체에서 번호로 찾기(숫자만 · 3자리 이상 · 최대 50행) */
export function searchTargetExtraction(ext: TargetExtraction, q: string) {
  return post<{ count: number; matched: number; rows: any[] }>(
    `/api/customers/extractions/${ext.extractionId}/search`, { q, phoneField: ext.phoneField },
  );
}

/** 고른 번호를 보관본에서 뺀다 */
export function removeFromTargetExtraction(ext: TargetExtraction, phones: string[]) {
  return post<{ count: number; removed: number }>(`/api/customers/extractions/${ext.extractionId}/remove`, { phones });
}

/** 보관본 전체 행 — 알림톡·브랜드메시지로 넘길 때만 */
export function fetchTargetExtractionRows(ext: TargetExtraction) {
  return post<{ count: number; recipients: any[] }>(`/api/customers/extractions/${ext.extractionId}/rows`, { phoneField: ext.phoneField });
}

/** 수신자별 회신번호 칸을 골랐을 때 서버 보관본 회신번호를 채운다 → 빈 인원 */
export function fillTargetExtractionCallback(ext: TargetExtraction, column: string) {
  return post<{ count: number; missing: number }>(
    `/api/customers/extractions/${ext.extractionId}/callback`, { column, phoneField: ext.phoneField },
  );
}

/** 최장 바이트 계산용 한 행(getMaxByteMessage에 [이 행]을 넘기면 명단 전체 계산과 같은 값) */
export function longestRowOf(ext: TargetExtraction | null): any[] {
  return ext ? [ext.longest] : [];
}

/** 만료 시각 표시(예: "내일 오전 11:40") — 오늘·내일·그 밖은 날짜 */
export function formatExtractionDeadline(expiresAt: string, now: Date = new Date()): string {
  const t = new Date(expiresAt);
  if (Number.isNaN(t.getTime())) return '';
  const kst = (d: Date) => new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const a = kst(now);
  const b = kst(t);
  const dayDiff = Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
    - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 86400000);
  const time = t.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' });
  if (dayDiff === 0) return `오늘 ${time}`;
  if (dayDiff === 1) return `내일 ${time}`;
  return `${t.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' })} ${time}`;
}
