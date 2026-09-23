/**
 * template-export.ts — 템플릿 목록 엑셀 행 빌더 컨트롤타워 (★ 2026-09-23 신설)
 *
 * 신설 사유(숭실원격평생교육원 요청 · 직원 접수): 알림톡·브랜드메시지·RCS 템플릿 관리 화면에
 *   엑셀 다운로드가 없어, 등록한 템플릿 문안을 한 번에 받아볼 방법이 없었다.
 *
 * 설계 원칙 (manage-stats-export.ts 와 같다):
 *   - 행을 만드는 함수는 순수하게 두고, 서식은 xlsx-writer CT 가 입힌다.
 *   - 범위 = 목록 GET 과 같은 행 전부. 화면의 상태·검색 필터는 적용하지 않는다 —
 *     그 판정을 서버에 한 벌 더 두면 갈라진다. 대신 머리행 자동 필터로 엑셀에서 거른다.
 *   - 라벨은 화면과 같은 말을 쓴다. 화면(프론트)과 이 파일 두 곳에 있으므로
 *     template-export.test.ts 의 계약 테스트가 한쪽만 바뀌는 것을 막는다.
 */

import type { XlsxSheetSpec } from './xlsx-writer';
import { kstDateTag } from './ai-credit-calc';

// ────────────── 라벨 (화면 사본 · 계약 테스트로 고정) ──────────────

/** = AlimtalkManagementSection.tsx STATUS_LABELS */
export const ALIMTALK_STATUS_LABELS: Record<string, string> = {
  DRAFT: '등록',
  REG: '등록',
  REQUESTED: '검수요청',
  REQ: '검수요청',
  KREQ: '카카오 검수요청',
  APPROVED: '승인',
  APR: '승인',
  HREJ: '내부 반려',
  KREJ: '카카오 반려',
  REJECTED: '반려',
  REJ: '반려',
  REVIEWING: '검수중',
  REV: '검수중',
  DORMANT: '휴면',
  DELETED: '삭제',
};

/** = alimtalk-types.ts MSG_TYPES */
export const ALIMTALK_MSG_TYPE_LABELS: Record<string, string> = {
  BA: '기본형',
  EX: '부가 정보형',
  AD: '채널 추가형',
  MI: '복합형',
};

/** = alimtalk-types.ts EMPH_TYPES */
export const ALIMTALK_EMPH_TYPE_LABELS: Record<string, string> = {
  NONE: '사용안함',
  TEXT: '강조 표기형',
  IMAGE: '이미지형',
  ITEM_LIST: '아이템리스트형',
};

/** = BrandTemplateManagementSection.tsx CHAT_BUBBLE_LABELS (brand-message.ts BUBBLE_TYPES 라벨과 다르다 · WIDE) */
export const BRAND_BUBBLE_LABELS: Record<string, string> = {
  TEXT: '텍스트',
  IMAGE: '이미지',
  WIDE: '와이드',
  WIDE_ITEM_LIST: '와이드 리스트',
  CAROUSEL_FEED: '캐러셀 피드',
  PREMIUM_VIDEO: '프리미엄 동영상',
  COMMERCE: '커머스',
  CAROUSEL_COMMERCE: '캐러셀 커머스',
};

/** = BrandTemplateManagementSection.tsx STATUS_LABELS */
export const BRAND_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '정상',
  INACTIVE: '중지',
};

/** = KakaoRcsPage.tsx STATUS_BADGE */
export const RCS_STATUS_LABELS: Record<string, string> = {
  pending: '승인대기',
  approved: '승인',
  rejected: '반려',
  dormant: '휴면',
};

// ────────────── 셀 값 ──────────────

function text(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** 모르는 값은 저장값을 그대로 적는다(지어낸 라벨로 덮지 않는다) */
function label(map: Record<string, string>, v: unknown): string {
  const key = text(v);
  return map[key] ?? key;
}

/** 한국시간 「YYYY-MM-DD HH:mm」. 값이 없거나 날짜가 아니면 빈칸 */
export function formatKstDateTime(v: Date | string | null | undefined): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/** 버튼 한 개에서 보여줄 링크 — 모바일 링크 우선. 저장 형태가 채널마다 달라 두 표기를 다 본다 */
const BUTTON_LINK_KEYS = [
  'urlMobile', 'url_mobile', 'url', 'urlPc', 'url_pc',
  'schemeAndroid', 'scheme_android', 'schemeIos', 'scheme_ios',
  'telNumber', 'tel_number', 'phoneNumber', 'copyText',
];

/**
 * 버튼 목록을 「버튼명: 링크」 한 줄씩으로. 링크 없는 버튼(채널 추가·봇키워드 등)은 이름만.
 * 버튼 종류 코드는 적지 않는다 — 종류 라벨 원장이 채널마다 따로 있어 사본을 하나 더 만들지 않는다.
 */
export function formatTemplateButtons(buttons: unknown): string {
  let list: unknown = buttons;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { return ''; }
  }
  if (!Array.isArray(list)) return '';
  return list
    .map((b: any) => {
      if (!b || typeof b !== 'object') return '';
      const name = text(b.name).trim();
      const linkKey = BUTTON_LINK_KEYS.find((k) => text(b[k]).trim() !== '');
      const link = linkKey ? text(b[linkKey]).trim() : '';
      if (name && link) return `${name}: ${link}`;
      return name || link;
    })
    .filter(Boolean)
    .join('\n');
}

function joinLines(...parts: unknown[]): string {
  return parts.map(text).filter((s) => s.trim() !== '').join('\n');
}

function caption(now: Date, count: number, extra?: string): string {
  return [`${formatKstDateTime(now)} 기준`, `총 ${count}건`, '머리행 필터로 원하는 상태만 골라 볼 수 있습니다', extra]
    .filter(Boolean)
    .join(' · ');
}

// ────────────── 시트 ──────────────

export type TemplateExportKind = 'alimtalk' | 'brand' | 'rcs';

const FILENAME_PREFIX: Record<TemplateExportKind, string> = {
  alimtalk: '알림톡템플릿',
  brand: '브랜드템플릿',
  rcs: 'RCS템플릿',
};

/**
 * 파일명 = 「종류_한국날짜.xlsx」(발송통계_… 와 같은 모양).
 * 화면 헬퍼(lib/auth-download.ts)가 원래 이름(filename*)을 먼저 읽도록 0923 에 고쳐 한글이 그대로 도착한다.
 */
export function templateExportFilename(kind: TemplateExportKind, now: Date): string {
  return `${FILENAME_PREFIX[kind]}_${kstDateTag(now)}.xlsx`;
}

/** 알림톡 템플릿 — kakao_templates 목록 GET 행(SELECT t.*, profile_name, created_by_name, created_by_login_id) */
export function buildAlimtalkTemplateSheet(rows: any[], now: Date): XlsxSheetSpec {
  return {
    sheetName: '알림톡 템플릿',
    title: '알림톡 템플릿 목록',
    caption: caption(now, rows.length),
    columns: [
      { header: '템플릿명', width: 28 },
      { header: '템플릿코드', width: 22 },
      { header: '고객사 관리코드', width: 16 },
      { header: '발신프로필', width: 20 },
      { header: '유형', width: 22 },
      { header: '상태', width: 14 },
      { header: '강조 제목', width: 20 },
      { header: '본문', width: 60 },
      { header: '부가정보', width: 32 },
      { header: '버튼', width: 40 },
      { header: '반려사유', width: 32 },
      { header: '등록자', width: 18 },
      { header: '등록일시', width: 18 },
      { header: '수정일시', width: 18 },
    ],
    rows: rows.map((t) => {
      // = alimtalk-types.ts formatTemplateType: 강조 없음이면 메시지 유형만, 그 외 「메시지유형·강조유형」
      const msg = label(ALIMTALK_MSG_TYPE_LABELS, t.message_type);
      const emph = text(t.emphasize_type);
      const type = !emph || emph === 'NONE' ? msg : `${msg}·${label(ALIMTALK_EMPH_TYPE_LABELS, emph)}`;
      const creator = t.created_by_name
        ? (t.created_by_login_id ? `${t.created_by_name} (${t.created_by_login_id})` : text(t.created_by_name))
        : '';
      return [
        text(t.template_name),
        text(t.template_code),
        text(t.custom_template_code),
        text(t.profile_name),
        type,
        label(ALIMTALK_STATUS_LABELS, t.status),
        joinLines(t.emphasize_title, t.emphasize_subtitle),
        text(t.content),
        text(t.extra_content),
        formatTemplateButtons(t.buttons),
        text(t.reject_reason),
        creator,
        formatKstDateTime(t.created_at),
        formatKstDateTime(t.updated_at),
      ];
    }),
  };
}

/** 브랜드메시지 템플릿 — brand_message_templates 목록 GET 행(SELECT b.*, profile_name) */
export function buildBrandTemplateSheet(rows: any[], now: Date): XlsxSheetSpec {
  return {
    sheetName: '브랜드 템플릿',
    title: '브랜드메시지 템플릿 목록',
    caption: caption(now, rows.length, '캐러셀 유형의 카드별 문구는 화면의 상세보기에서 확인할 수 있습니다'),
    columns: [
      { header: '관리명', width: 24 },
      { header: '템플릿키', width: 30 },
      { header: '고객사 관리코드', width: 16 },
      { header: '발신프로필', width: 20 },
      { header: '유형', width: 16 },
      { header: '상태', width: 10 },
      { header: '헤더', width: 20 },
      { header: '본문', width: 60 },
      { header: '부가 내용', width: 30 },
      { header: '버튼', width: 40 },
      { header: '등록일시', width: 18 },
      { header: '최종 수정', width: 18 },
    ],
    rows: rows.map((t) => [
      text(t.manage_name),
      text(t.template_key),
      text(t.custom_template_code),
      text(t.profile_name),
      label(BRAND_BUBBLE_LABELS, t.chat_bubble_type),
      label(BRAND_STATUS_LABELS, t.status),
      text(t.header),
      text(t.content),
      text(t.additional_content),
      formatTemplateButtons(t.buttons),
      formatKstDateTime(t.created_at),
      formatKstDateTime(t.updated_at),
    ]),
  };
}

/** RCS 템플릿 — rcs_templates 목록 GET 행(SELECT *). 메시지 유형은 화면처럼 저장값 그대로 */
export function buildRcsTemplateSheet(rows: any[], now: Date): XlsxSheetSpec {
  return {
    sheetName: 'RCS 템플릿',
    title: 'RCS 템플릿 목록',
    caption: caption(now, rows.length),
    columns: [
      { header: '템플릿명', width: 28 },
      { header: '메시지 유형', width: 16 },
      { header: '상태', width: 12 },
      { header: '브랜드', width: 20 },
      { header: '본문', width: 60 },
      { header: '버튼', width: 40 },
      { header: '반려사유', width: 32 },
      { header: '등록일시', width: 18 },
    ],
    rows: rows.map((t) => [
      text(t.template_name),
      text(t.message_type),
      label(RCS_STATUS_LABELS, t.status),
      text(t.brand_name),
      text(t.content),
      formatTemplateButtons(t.buttons),
      text(t.reject_reason),
      formatKstDateTime(t.created_at),
    ]),
  };
}
