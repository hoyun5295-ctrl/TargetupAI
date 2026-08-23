/**
 * ★ CT: 캠페인 표시 축(채널·발송유형)의 단일 판정 — 2026-07-31 신설
 *
 * 신설 이유 = 같은 캠페인을 보는 화면들이 서로 다른 리터럴로 판정하고 있었다.
 *   · 채널: `send_channel === 'kakao'` 한 줄만 비교해서, 전용 발송이 쓰는 `'kakao_brand'`가
 *     어디에도 안 걸리고 `message_type`('LMS')으로 흘러내렸다 → 브랜드메시지가 화면마다 **LMS**.
 *     상세 발송내역만 SMSQ `msg_type`('F') 축을 읽어 제대로 나와서, 같은 발송이 두 이름으로 보였다.
 *   · 유형: `send_type === 'direct' ? '수동' : 'AI'` 이분법이 6곳에 복제돼 있어
 *     자동발송(`'auto'`)·여정(`'journey'`)이 전부 **AI**로 뭉개졌다.
 *
 * 판정은 여기 한 곳이다. 화면에서 `send_channel`·`send_type` 문자열을 직접 비교하지 않는다.
 *
 * ⚠ 채널 목록은 백엔드 `utils/billing-types.ts`의 `BRAND_CAMPAIGN_CHANNELS`와 **같은 값이어야 한다.**
 *   갈라지면 화면과 청구가 다른 발송을 브랜드로 세게 된다. 프론트가 백엔드 파일을 import하지 않는 것은
 *   2026-07-18 프론트 빌드 사고(동적 import 청크 누락으로 전 고객 다운) 이후 빌드 구조를 건드리지
 *   않기로 했기 때문이고, 대신 `backend/src/utils/brand-axis-invariants.test.ts`가 두 목록의
 *   일치와 화면 리터럴 잔존 0건을 기계로 확인한다.
 */

/** 브랜드메시지로 나가는 캠페인 채널값 (백엔드 `BRAND_CAMPAIGN_CHANNELS` 미러) */
export const BRAND_CAMPAIGN_CHANNELS = ['kakao', 'kakao_brand', 'both'] as const;

/** 알림톡 채널값 */
export const ALIMTALK_CAMPAIGN_CHANNEL = 'alimtalk';

/**
 * ★ AI 캠페인이 고를 수 있는 메시지 유형 (2026-08-17 신설 — Codex 적대검토 high)
 *
 * 이 값은 화면 표시용이 아니라 **캠페인의 `messageType`이 되어 백엔드 차감 축으로 쓰인다.**
 * 그런데 AI 응답(`recommended_channel`)을 그대로 받아 넣고 있었고 거르는 값은 '카카오' 하나였다.
 * 모델이 `RCS` 같은 값을 돌려주면 그대로 캠페인에 저장되고, 백엔드 단가표에 없는 유형이라
 * `unknownType`으로 **막히지 않고 0원 통과**한다(무료 발송). 큐에는 알 수 없는 값이라 LMS로 바뀌어 들어간다.
 *
 * ⚠ 백엔드 `utils/billing-types.ts`의 `CHARGEABLE_MESSAGE_TYPES`와 **같은 값이어야 한다.**
 *   (미러 이유·기계 검증 방식은 이 파일 헤더 주석과 같다)
 */
export const AI_MESSAGE_CHANNELS = ['SMS', 'LMS', 'MMS'] as const;

export type AiMessageChannel = (typeof AI_MESSAGE_CHANNELS)[number];

/**
 * AI가 준 채널 추천을 **반드시 유효한 유형으로 좁혀서** 돌려준다.
 *
 * 목록 밖 값(카카오·RCS·오타·빈값)은 전부 `'LMS'`로 떨어뜨린다 — 이미지가 필요 없고 길이 제한이
 * 넉넉해 어떤 문안이 와도 잘리지 않는 쪽이다(백엔드 `toQtmsgType`의 미지값 처리와 같은 판단).
 * 기존에 '카카오'만 LMS로 바꾸던 분기를 이 함수가 흡수한다 — 값마다 분기를 더하면 또 빠뜨린다.
 */
export function normalizeAiMessageChannel(raw: unknown): AiMessageChannel {
  if (typeof raw !== 'string') return 'LMS';
  const v = raw.trim().toUpperCase();
  return (AI_MESSAGE_CHANNELS as readonly string[]).includes(v) ? (v as AiMessageChannel) : 'LMS';
}

/**
 * 메시지 유형 코드 → 표시명.
 * `F`는 옛 이름이 '친구톡'이었으나 그 상품은 폐지됐고 지금 실체는 브랜드메시지다.
 */
export const MSG_TYPE_LABEL: Record<string, string> = {
  SMS: 'SMS', LMS: 'LMS', MMS: 'MMS',
  S: 'SMS', L: 'LMS', M: 'MMS',
  K: '알림톡', F: '브랜드메시지',
};

export interface CampaignAxisRow {
  send_channel?: string | null;
  message_type?: string | null;
  send_type?: string | null;
}

const channelOf = (c: CampaignAxisRow | null | undefined): string =>
  String(c?.send_channel || '').trim();

/** 알림톡 캠페인인가 */
export function isAlimtalkChannel(c: CampaignAxisRow | null | undefined): boolean {
  return channelOf(c) === ALIMTALK_CAMPAIGN_CHANNEL;
}

/**
 * 전량 브랜드메시지로 나가는 캠페인인가.
 * `both`는 문자와 함께 나가므로 여기 해당하지 않는다(백엔드 `isBrandOnlyChannel`과 같은 기준).
 */
export function isBrandOnlyChannel(c: CampaignAxisRow | null | undefined): boolean {
  const v = channelOf(c);
  return v === 'kakao' || v === 'kakao_brand';
}

/** 문자와 브랜드메시지가 함께 나가는 캠페인인가 */
export function isBothChannel(c: CampaignAxisRow | null | undefined): boolean {
  return channelOf(c) === 'both';
}

/** 카카오 계열(알림톡·브랜드메시지) 전체 — 색·아이콘 분기용 */
export function isKakaoFamilyChannel(c: CampaignAxisRow | null | undefined): boolean {
  return isAlimtalkChannel(c) || isBrandOnlyChannel(c);
}

/**
 * 채널 표시명. 카카오 구분은 `message_type`이 아니라 `send_channel`이 담당한다 —
 * 알림톡·브랜드메시지는 `campaigns.message_type` CHECK 허용값에 없어 전부 `'LMS'`로 저장된다.
 */
export function resolveChannelLabel(c: CampaignAxisRow | null | undefined): string {
  if (isAlimtalkChannel(c)) return '알림톡';
  if (isBrandOnlyChannel(c)) return '브랜드메시지';
  if (isBothChannel(c)) return '문자+브랜드메시지';
  const t = String(c?.message_type || '').trim();
  return MSG_TYPE_LABEL[t] || t || 'SMS';
}

/**
 * 채널 칩 색상 — 알림톡 emerald / 브랜드 amber / 문자·혼합 indigo / 그 외 neutral
 *
 * ★ 2026-08-17: 문자·혼합이 violet이었는데 관리 화면 액센트를 인디고로 통일하면서 함께 옮겼다.
 *   violet은 이 앱에서 AI 기능 화면이 쓰는 색이다(LESSONS_FRONTEND 톤앤매너).
 *   알림톡·브랜드는 채널을 구분하는 의미색이라 그대로 둔다.
 */
export function resolveChannelChipClass(c: CampaignAxisRow | null | undefined): string {
  if (isAlimtalkChannel(c)) return 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15';
  if (isBrandOnlyChannel(c)) return 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/15';
  const t = String(c?.message_type || '').trim();
  const isLmsMms = t === 'LMS' || t === 'MMS' || t === 'L' || t === 'M';
  if (isBothChannel(c) || isLmsMms) return 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/15';
  return 'bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-900/[.06]';
}

/**
 * 채널 칩 아이콘 — 이름만 돌려준다(컴포넌트를 여기서 import하지 않는다).
 *
 * ★ 2026-08-17: 전에는 소비처가 `'📨' / '💬' / '📱'` 이모지 문자를 라벨 앞에 붙였다.
 *   이모지는 OS·브라우저마다 다르게 그려지고 폰트 크기에 안 맞아 뭉개진다(Harold 지적).
 *   판정은 여기가 소유하고, 어떤 아이콘 컴포넌트를 그릴지는 화면이 정한다 —
 *   유틸이 lucide를 import하면 이 파일을 쓰는 모든 곳이 아이콘 번들을 끌고 온다.
 */
export type ChannelIconName = 'alimtalk' | 'brand' | 'message';

export function resolveChannelIconName(c: CampaignAxisRow | null | undefined): ChannelIconName {
  if (isAlimtalkChannel(c)) return 'alimtalk';
  if (isBrandOnlyChannel(c)) return 'brand';
  return 'message';
}

/**
 * 발송 유형 표시명 — `campaigns.send_type` 저장값 그대로가 진실이다.
 *   direct  = 직접발송(수신자를 직접 넣어 보낸 것. 브랜드메시지 전용 발송 포함)
 *   ai      = AI 추천(타겟 조건으로 만든 캠페인)
 *   auto    = 자동발송(auto_campaigns 워커)
 *   journey = 여정(여정 실행기가 step마다 만든 캠페인)
 * 모르는 값은 지어내지 않고 그대로 보여준다 — 새 경로가 생겼을 때 조용히 AI로 뭉개지지 않게.
 */
export const SEND_TYPE_LABEL: Record<string, string> = {
  direct: '직접발송',
  ai: 'AI 추천',
  auto: '자동발송',
  journey: '여정',
  // ★ 2026-08-18 AI 오퍼레이터 제안 승인 발송. 'AI 추천'(타겟 조건 캠페인)과 다른 기능이라 값을 나눈다.
  //   백엔드 CT(`utils/send-type-axis.ts`)와 같은 값이어야 한다 — 한쪽만 늘리면 화면에 원값이 노출된다.
  operator: 'AI 오퍼레이터',
};

export function resolveSendTypeLabel(sendType: string | null | undefined): string {
  const v = String(sendType || '').trim();
  return SEND_TYPE_LABEL[v] || v || '직접발송';
}

/** 발송 유형 아이콘 */
export function resolveSendTypeIcon(sendType: string | null | undefined): string {
  const v = String(sendType || '').trim();
  if (v === 'direct') return '📤';
  if (v === 'auto') return '🔁';
  if (v === 'journey') return '🧭';
  return '🤖';
}

/** 발송 유형 칩 색상 */
export function resolveSendTypeChipClass(sendType: string | null | undefined): string {
  const v = String(sendType || '').trim();
  if (v === 'direct') return 'bg-emerald-100 text-emerald-700';
  if (v === 'auto') return 'bg-amber-100 text-amber-700';
  if (v === 'journey') return 'bg-sky-100 text-sky-700';
  return 'bg-violet-100 text-violet-700';
}

/** 발송결과 유형 필터 값 — `'all'`은 무필터 */
export const SEND_TYPE_FILTERS = ['all', 'direct', 'ai', 'auto', 'journey', 'operator'] as const;
export type SendTypeFilter = (typeof SEND_TYPE_FILTERS)[number];

/** 필터 일치 판정 — 이분법(`direct`가 아니면 전부 AI)이 자동발송·여정을 AI에 섞던 것을 막는다 */
export function matchesSendTypeFilter(sendType: string | null | undefined, filter: string): boolean {
  if (!filter || filter === 'all') return true;
  return String(sendType || '').trim() === filter;
}
