/**
 * ★ CT: 행사 캠페인 이미지 판독 (2026-07-08)
 *
 * 업로드 이미지(상품 목록 스샷 등)를 vision AI로 "보이는 것만 그대로 전사"해
 * 행사 내용 자유 텍스트로 반환한다. 반환 텍스트는 사용자가 직접 입력한 것과 동일하게
 * 3채널 생성기(모바일DM one-shot / 이메일 generate-sections / 인앱 ai-generate)에 주입된다.
 *
 * ⛔ 혜택·가격 날조 금지 영구 룰 양립:
 *   - 전사 결과가 곧 "행사 원문"이 되어, 다운스트림 event-brief 검증
 *     (validateProductsAgainstEventText·benefitMatchesEventText)이 그대로 걸린다.
 *   - 전사 단계 자체도 "이미지에 없는 가격·혜택·기간을 지어내지 않는다"를 시스템 프롬프트로 강제.
 *   - 사용자가 반환 텍스트를 입력칸에서 눈으로 확인·보정 → 사람 검증 + 기계 검증 이중.
 *
 * 크레딧: source 'event-image-extract' = 3 (callAIWithFallback이 성공 시에만 차감). 이미지 있으면 cache 우회.
 */
import { callAIWithFallback } from '../services/ai';
import { normalizeEventText } from './event-brief';

export interface EventImageInput {
  media_type: string;
  data: string; // base64 (no data URL prefix)
}

/** vision 판독 허용 이미지 형식 (Anthropic image content 지원 + 안전 화이트리스트) */
export const ALLOWED_IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** 한 번에 판독할 이미지 최대 장수 */
export const MAX_EVENT_IMAGES = 5;

/** 이미지 버퍼 매직 바이트 판별 (jpg/png/webp) — 확장자·mimetype 위장 업로드 차단용. 미지원 형식 = null. */
export function sniffImageMediaType(buf: Buffer | undefined): string | null {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

const EXTRACT_SYSTEM_PROMPT = `당신은 쇼핑몰 행사/프로모션 이미지를 읽어 "행사 내용"을 그대로 옮겨 적는 전사 담당입니다.

[출력 목표]
- 사용자가 마케팅 문자·DM·이메일·인앱을 만들려고 행사 내용을 손으로 붙여넣는 것과 같은 자연스러운 한국어 텍스트를 만드세요.
- 여러 장의 이미지는 하나의 행사로 보고 합쳐서 정리하세요.

[반드시 이미지에 실제로 보이는 것만]
- 상품이 나열돼 있으면 각 상품을 한 줄로: "상품명 / 정가 / 할인가 (할인율%)" — 이미지에 보이는 값만.
  예) 시세이도 퍼펙트 선 프로텍터 스프레이 150ml / 정가 52,000원 / 할인가 44,200원 (15%)
- 가격 숫자는 이미지에 보이는 숫자를 그대로 적습니다(콤마 포함/미포함 무관, 임의 반올림 금지).
- 행사 배너로 행사명·기간·혜택(쿠폰·사은품 등)이 크게 보이면 그것만 짧게 추가합니다(없으면 상품만).

[절대 넣지 말 것 — 노이즈 제외]
- 리뷰 수·별점("★ 4.73", "리뷰 66" 등 평점 정보)
- 10ml당·1개당 같은 단위당 환산가격
- "[네이버단독]"·"[리사세럼]" 같은 대괄호 채널/기획 태그 — 상품명에서도 이런 대괄호 태그는 빼고 핵심 상품명만 남깁니다
- 섹션 제목·헤드라인(예: "No.1 선케어", "리사세럼, 얼티뮨"), 이모지, 광고 수식어

[절대 금지]
- 이미지에 없는 가격·할인율·기간·혜택·상품을 지어내지 마세요.
- 이미지에서 값이 안 보이면 그 항목은 비워 두세요(추정 금지). 없는 정보를 채우지 마세요.
- 광고 문구를 새로 창작하지 마세요. 당신은 "옮겨 적기"만 합니다.

[형식]
- 순수 텍스트만 출력하세요. JSON, 표, 마크다운, 코드 블록, 설명 문장("다음은..." 등)을 붙이지 마세요.
- 이모지를 넣지 마세요.
- 각 항목은 줄바꿈으로 구분하세요.`;

/** 코드펜스/설명 접두를 제거하고 순수 전사 텍스트만 남긴다 (AI가 규칙을 어기고 감쌀 때 방어) */
function stripWrapping(raw: string): string {
  let t = String(raw ?? '').trim();
  // 코드펜스 통째로 감싼 경우 내부만
  const fence = t.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/);
  if (fence) t = fence[1].trim();
  return t;
}

// ── ★ 2026-07-19 구조화 판독 (Harold — "스샷 N장 → DM 70% 완성") ─────────────
// 산문 전사 대신 이미지당 행사 1블록의 구조(JSON)로 전사한다. 단일 AI 호출(3크레딧 불변).
// 프론트가 이 구조를 디터미니스틱하게 DM 섹션(히어로+상품 카드)으로 조립 → 생성 변동성 제거.

export interface ExtractedEventProduct {
  name: string;
  price: number;          // 정가 (안 보이면 0)
  sale_price: number;     // 판매가 (안 보이면 0)
  discount_rate: number;  // 할인율 % 숫자 (안 보이면 0)
}
export interface ExtractedEvent {
  brand: string;
  title: string;      // 행사 제목 (크게 보이는 헤드라인)
  subtitle: string;   // 부제
  benefit: string;    // 쿠폰·혜택 문구 (보이는 그대로)
  products: ExtractedEventProduct[];
}

const EXTRACT_STRUCT_SYSTEM_PROMPT = `당신은 쇼핑몰 기획전/행사 페이지 스크린샷을 읽어 구조화된 JSON으로 "그대로 옮겨 적는" 전사 담당입니다.

[출력 — 반드시 아래 JSON 형식만, 다른 텍스트·코드펜스·설명 금지]
{"events":[{"brand":"","title":"","subtitle":"","benefit":"","products":[{"name":"","price":0,"sale_price":0,"discount_rate":0}]}]}

[규칙]
- 이미지 1장 = events 배열의 항목 1개. 이미지 순서대로.
- brand = 화면에 보이는 브랜드명(예: 상품 카드 위 브랜드 표기). title = 행사 제목(가장 크게 보이는 헤드라인). subtitle = 부제 문장. benefit = 쿠폰·혜택 문구(예: "7% 쿠폰혜택과 함께 티셔츠 쇼핑!") — 보이는 그대로.
- products = 보이는 상품마다 하나씩: name(상품명 — "[26SS 시즌오프]" 같은 대괄호 태그는 빼고 핵심 상품명만), price(정가·취소선 가격), sale_price(판매가·큰 가격), discount_rate(할인율 % 숫자만). 가격은 콤마 없는 정수.
- 안 보이는 값 = 빈 문자열 또는 0. 지어내기 절대 금지 (가격·할인율·혜택·기간 날조 금지).

[노이즈 제외 — 절대 넣지 말 것]
- 해시태그 필터(#원피스, #반팔셔츠 등)·카테고리 탭·네비게이션 메뉴
- 리뷰 수·별점, 단위당 환산가격, 이모지, 페이지 UI 문구("더보기" 등)`;

/** 구조 → 산문(행사 원문) 파생 — 기존 event_text 소비처(3채널 생성기·검증) 호환용. */
export function eventsToProse(events: ExtractedEvent[]): string {
  const lines: string[] = [];
  for (const ev of events) {
    const head = [ev.brand, ev.title].filter(Boolean).join(' — ');
    if (head) lines.push(head);
    if (ev.subtitle) lines.push(ev.subtitle);
    if (ev.benefit) lines.push(ev.benefit);
    for (const p of ev.products || []) {
      const parts = [p.name];
      if (p.price > 0) parts.push(`정가 ${p.price.toLocaleString()}원`);
      if (p.sale_price > 0) parts.push(`할인가 ${p.sale_price.toLocaleString()}원`);
      const priceLine = parts.join(' / ');
      lines.push(p.discount_rate > 0 ? `${priceLine} (${p.discount_rate}%)` : priceLine);
    }
    lines.push('');
  }
  return normalizeEventText(lines.join('\n'));
}

function toInt(v: any): number {
  const n = Math.round(Number(String(v ?? '').replace(/[^\d.-]/g, '')));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** AI 응답(JSON) 방어 파싱 — 형식 위반 시 null(호출측이 산문 폴백). */
function parseEvents(raw: string): ExtractedEvent[] | null {
  try {
    let t = stripWrapping(raw);
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    t = t.slice(start, end + 1);
    const obj = JSON.parse(t);
    const arr = Array.isArray(obj?.events) ? obj.events : null;
    if (!arr) return null;
    const events: ExtractedEvent[] = arr.slice(0, MAX_EVENT_IMAGES).map((e: any) => ({
      brand: String(e?.brand || '').trim().slice(0, 60),
      title: String(e?.title || '').trim().slice(0, 120),
      subtitle: String(e?.subtitle || '').trim().slice(0, 200),
      benefit: String(e?.benefit || '').trim().slice(0, 200),
      products: (Array.isArray(e?.products) ? e.products : []).slice(0, 20).map((p: any) => ({
        name: String(p?.name || '').trim().slice(0, 120),
        price: toInt(p?.price),
        sale_price: toInt(p?.sale_price),
        discount_rate: Math.min(99, toInt(p?.discount_rate)),
      })).filter((p: ExtractedEventProduct) => p.name),
    })).filter((e: ExtractedEvent) => e.title || e.benefit || e.products.length > 0);
    return events.length > 0 ? events : null;
  } catch {
    return null;
  }
}

/**
 * ★ 이미지 → 구조화 행사(events[]) + 산문(event_text). 단일 AI 호출(3크레딧).
 * JSON 파싱 실패 시 events=null·산문은 원문 그대로(폴백 — 기존 흐름과 동일 체감).
 */
export async function extractEventsFromImages(params: {
  images: EventImageInput[];
  companyId: string;
  userId?: string;
}): Promise<{ events: ExtractedEvent[] | null; eventText: string }> {
  const images = (params.images || [])
    .filter((im) => im && typeof im.data === 'string' && im.data.length > 0 && ALLOWED_IMAGE_MEDIA_TYPES.has(im.media_type))
    .slice(0, MAX_EVENT_IMAGES);
  if (!images.length) {
    throw new Error('판독할 이미지가 없습니다. jpg/png/webp 이미지를 올려주세요.');
  }

  const raw = await callAIWithFallback({
    system: EXTRACT_STRUCT_SYSTEM_PROMPT,
    userMessage: '위 이미지들에 실제로 보이는 행사 내용만 규칙대로 JSON으로 옮겨 적어줘. 안 보이는 값은 빈 문자열/0으로 두고 지어내지 마.',
    maxTokens: 2500,
    temperature: 0.1,
    companyId: params.companyId,
    userId: params.userId,
    source: 'event-image-extract',
    creditCost: 3,
    images,
  });

  const events = parseEvents(raw);
  if (events) {
    return { events, eventText: eventsToProse(events) };
  }
  // 형식 위반 폴백 — 원문을 산문으로(기존 체감 유지). 재호출 없음(중복 과금 방지).
  const text = normalizeEventText(stripWrapping(raw));
  if (!text) {
    throw new Error('이미지에서 행사 내용을 읽지 못했습니다. 텍스트가 잘 보이는 이미지로 다시 시도해주세요.');
  }
  return { events: null, eventText: text };
}

/**
 * 이미지 → 행사 내용 텍스트. 실패 시 throw(호출측이 사용자 안내).
 * @throws 유효 이미지 0장이면 에러 / AI 실패 시 callAIWithFallback 에러 전파
 */
export async function extractEventTextFromImages(params: {
  images: EventImageInput[];
  companyId: string;
  userId?: string;
}): Promise<string> {
  const images = (params.images || [])
    .filter((im) => im && typeof im.data === 'string' && im.data.length > 0 && ALLOWED_IMAGE_MEDIA_TYPES.has(im.media_type))
    .slice(0, MAX_EVENT_IMAGES);
  if (!images.length) {
    throw new Error('판독할 이미지가 없습니다. jpg/png/webp 이미지를 올려주세요.');
  }

  const raw = await callAIWithFallback({
    system: EXTRACT_SYSTEM_PROMPT,
    userMessage: '위 이미지에 실제로 보이는 행사 내용만 규칙대로 그대로 옮겨 적어줘. 보이지 않는 값은 지어내지 말고 비워 둬.',
    maxTokens: 1500,
    temperature: 0.2,
    companyId: params.companyId,
    userId: params.userId,
    source: 'event-image-extract',
    creditCost: 3,
    images,
  });

  const text = normalizeEventText(stripWrapping(raw));
  if (!text) {
    throw new Error('이미지에서 행사 내용을 읽지 못했습니다. 텍스트가 잘 보이는 이미지로 다시 시도해주세요.');
  }
  return text;
}
