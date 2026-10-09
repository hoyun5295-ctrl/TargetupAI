/**
 * ★ 2026-09-23 AI 영업 화면 공용(모달 · 담당자 발송 패널 · 발송 확인 창 · 작업대)
 * 설계 = docs/2026-09-23-outreach-direct-send-design.md §12
 * 규율: 화면은 서버가 계산한 값만 그린다(잠금 사유·문장·줄·건수 = 서버 완성). 프론트가 판정을 복제하지 않는다.
 */

export async function outreachFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem('token');
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
}

export type ContactDomainVerdict = 'same' | 'free' | 'other' | 'unknown';

export interface OutreachDirectInfo {
  contact: { email: string | null; name: string | null; basis: string | null };
  domainVerdict: ContactDomainVerdict;
  domainAcked: boolean;
  contactPages: string[];
  naverStoreUrl: string | null;
  lock: { locked: boolean; reasons: string[]; messages: string[] };
  stage: { effective: number; env: number; data: number; blockers: string[] };
  today: number;
  cap: number;
  review: { reviewedAssetId: string | null; latestAssetId: string | null; reviewed: boolean; hold: { reason: string | null; at: string } | null };
  directSubject: string | null;
  dmCaptureUrl: string | null;
  lastSend: { id: string; outcome: string; mode: string; review_flag: string | null; created_at: string; finished_at: string | null } | null;
  directLast: { outcome: string; detail: string; at: string; mode: string } | null;
  mailerReady: boolean;
}

export interface WorkbenchCard {
  id: string;
  companyName: string;
  homepageUrl: string;
  stage: string;
  lane: WorkbenchLane;
  failReason: string | null;
  contact: { email: string | null; name: string | null; basis: string | null };
  domainVerdict: ContactDomainVerdict;
  naverStoreUrl: string | null;
  /** ★0924 B 스토어에서 가져온 기획 수·시각 */
  storeGrab: { campaigns: number; at: string } | null;
  subject: string | null;
  directSubject: string | null;
  emailAssetId: string | null;
  captureUrl: string | null;
  dmUrl: string | null;
  previewUrl: string | null;
  visionOk: boolean | null;
  visionItems: { passed: number; total: number } | null;
  lock: { locked: boolean; reasons: string[]; messages: string[] };
  reviewed: boolean;
  hold: { reason: string | null; at: string } | null;
  autoConfirmed: boolean;
  autoSendApproved: boolean;
  events: string[];
  chainIndex: number | null;
  send: { id: string; outcome: string; reviewFlag: string | null; mode: string; at: string } | null;
  directLast: { outcome: string; detail: string; at: string; mode: string } | null;
  mailResult: string | null;
  /** ★ 2026-10-09 R13 판정 카드 — 메일 첫 화면의 히어로 · 고른 템플릿과 이유 · 재료 수(옛 서버 응답에는 없다) */
  heroUrl?: string | null;
  heroKind?: 'poster' | 'banner' | 'card' | null;
  templateName?: string | null;
  templateReason?: string | null;
  productCount?: number | null;
  eventCount?: number | null;
}

export type WorkbenchLane = 'reading' | 'confirm' | 'producing' | 'review' | 'hold' | 'send' | 'sent' | 'post_review' | 'failed';

export interface WorkbenchData {
  batch: string;
  batches: Array<{ batch: string; firstAt: string; n: number }>;
  cards: WorkbenchCard[];
  laneCounts: Record<string, number>;
  stage: { effective: number; env: number; data: number; blockers: string[] };
  today: number;
  cap: number;
}

/** 줄 이름(순서 = 작업 흐름) */
export const WORKBENCH_LANES: Array<{ key: WorkbenchLane; label: string }> = [
  { key: 'reading', label: '읽는 중' },
  { key: 'confirm', label: '확인 대기' },
  { key: 'producing', label: '제작 중' },
  { key: 'review', label: '검토 대기' },
  { key: 'hold', label: '보류' },
  { key: 'send', label: '발송 대기' },
  { key: 'sent', label: '보낸 건' },
  { key: 'post_review', label: '사후 확인' },
  { key: 'failed', label: '실패' },
];

/**
 * ★ 2026-10-09 R12 머리 띠 탭 3개 = 줄 묶음(줄 키·서버 계산값 불변 · 화면 묶음만)
 *   사후 확인([잘못 나감] = 자동 발송 정지 장치)·실패는 "확인할 것" 안에서 건수가 있으면 늘 보인다.
 */
export type WorkbenchGroup = 'making' | 'check' | 'sent';
export const WORKBENCH_GROUPS: Array<{ id: WorkbenchGroup; label: string; lanes: WorkbenchLane[] }> = [
  { id: 'making', label: '만드는 중', lanes: ['reading', 'producing'] },
  { id: 'check', label: '확인할 것', lanes: ['review', 'confirm', 'post_review', 'failed', 'hold'] },
  { id: 'sent', label: '보낸 것', lanes: ['send', 'sent'] },
];
export function groupOfLane(lane: WorkbenchLane): WorkbenchGroup {
  return (WORKBENCH_GROUPS.find((g) => g.lanes.includes(lane)) || WORKBENCH_GROUPS[1]).id;
}

/** 히어로 종류 이름(판정 카드 한 줄) */
export const HERO_KIND_LABEL: Record<'poster' | 'banner' | 'card', string> = { poster: '스튜디오 포스터', banner: '홈 배너', card: '행사 배너' };

/** 담당자 도메인 뱃지(같음 녹색 · 개인 메일 주황 · 다른 회사 빨강) */
export const DOMAIN_BADGE: Record<ContactDomainVerdict, { label: string; cls: string }> = {
  same: { label: '홈페이지와 같은 도메인', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  free: { label: '개인 메일', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  other: { label: '다른 회사 도메인', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  unknown: { label: '도메인 확인 불가', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
};

/** 이메일을 로컬부 · 도메인으로(도메인을 굵게 보이려고) */
export function splitEmail(email: string | null | undefined): { local: string; domain: string } {
  const v = String(email || '');
  const at = v.lastIndexOf('@');
  return at > 0 ? { local: v.slice(0, at), domain: v.slice(at) } : { local: v, domain: '' };
}

/** ★ v3 사람 수정 사유 5값(서버 화이트리스트와 같은 값 · 학습 원장 · 보류 사유) */
export const EDIT_REASON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'no_text', label: '설명 글자가 없음' }, { value: 'duplicate', label: '중복' }, { value: 'blurry', label: '흐림·품질' }, { value: 'wrong', label: '내용 틀림' }, { value: 'tone', label: '톤이 다름' },
];

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).slice(0, 16).replace('T', ' ');
}
