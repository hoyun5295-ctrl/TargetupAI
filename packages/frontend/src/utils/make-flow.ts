/**
 * make-flow.ts — 만들기 개편 화면 공통 순수 로직 CT (★ 2026-09-27 설계서 docs/2026-09-27-make-redesign-design.md §2)
 *
 * 결과 화면 "고칠 곳" 판정 칩 · 블록 이름·요약(왼쪽 목록) · 블록 추가 팔레트 · 주소 읽기 카드 배지 · 첫 화면 카드칩 상태 ·
 * 결과 화면 주소 · 문자 기본 문안. AI 호출 0 · 금액 0 · DOM 0(백엔드 테스트가 그대로 import 한다).
 * 판정의 원천은 서버다(검수 = POST /api/dm/:id/validate · 면허 = 생성 때 서버 대조). 여기는 서버 결과를 사람 말로 옮길 뿐이다.
 * ⛔ 모델명 0 · 줄표 0 · 내부 코드명 0(사용자 노출 문구).
 */
import { DM_BLOCKS, blockOfSection } from './dm-blocks';
import { SECTION_META, type Section, type SectionType } from './dm-section-defaults';

// ─────────────── 결과 화면 주소 ───────────────

export type MakeChannel = 'dm' | 'email';

/** 결과 화면 = `/quick-campaign/result?channel=&draft=` (+ 같은 재료로 만든 다른 채널 `pair`) */
export function makeResultPath(channel: MakeChannel, draftId: string, pairId?: string | null): string {
  const q = new URLSearchParams({ channel, draft: draftId });
  if (pairId) q.set('pair', pairId);
  return `/quick-campaign/result?${q.toString()}`;
}

// ─────────────── 블록 이름·요약(왼쪽 목록 · 오른쪽 패널 머리) ───────────────

/** 왼쪽 목록에서 부르는 이름(담당자 말) — 없는 타입은 블록 팔레트 → 섹션 표 순 */
const LIST_LABEL: Partial<Record<SectionType, string>> = {
  header: '머리', hero: '첫 화면', text_card: '설명 글', product_carousel: '상품', footer: '하단 정보',
  gallery: '사진 모음', countdown: '남은 시간', reviews: '후기', store_info: '매장 안내', sns: '링크 모음',
};

export function blockLabel(section: Pick<Section, 'type' | 'props'>): string {
  if (section.type === 'cta') return blockOfSection(section as any)?.key === 'linkchip' ? '링크 칩' : '버튼';
  return LIST_LABEL[section.type] || blockOfSection(section as any)?.label || SECTION_META[section.type]?.label || section.type;
}

/** 오른쪽 패널 머리 아래 한 줄(무엇을 고치는 블록인가) */
const PANEL_SUB: Partial<Record<SectionType, string>> = {
  header: '로고 · 브랜드 이름', hero: '사진 · 제목 · 부제', text_card: '제목 · 본문', cta: '글자 · 누르면 갈 곳 · 모양',
  product_carousel: '담은 상품 · 배열 · 버튼 글자', footer: '회사 정보 · 문의처 · 수신거부', gallery: '사진 · 배열',
  coupon: '혜택 · 기한 · 코드', countdown: '마감 시각', reviews: '후기 · 별점', store_info: '매장 · 전화 · 주소', sns: '채널 주소',
};
export function blockPanelSub(type: SectionType): string {
  return PANEL_SUB[type] || SECTION_META[type]?.description || '';
}

const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const list = (v: unknown) => (Array.isArray(v) ? v : []);

/** 왼쪽 목록 둘째 줄 — 블록 안에서 가장 먼저 보이는 글자(없으면 빈 칸 안내) */
export function blockSummary(section: Pick<Section, 'type' | 'props'>): string {
  const p = (section.props || {}) as Record<string, any>;
  switch (section.type) {
    case 'header': return str(p.brand_name) || str(p.event_title) || (str(p.logo_url) ? '로고' : '로고·이름 넣기');
    case 'hero': return str(p.headline) || '제목 넣기';
    case 'text_card': return str(p.headline) || str(p.body).slice(0, 30) || '글 넣기';
    case 'cta': return str(list(p.buttons)[0]?.label) || '버튼 글자 넣기';
    case 'product_carousel': { const n = list(p.products).length; return n > 0 ? `${n}개` : '상품 담기'; }
    case 'gallery': { const n = list(p.images).length; return n > 0 ? `사진 ${n}장` : '사진 넣기'; }
    case 'coupon': return str(p.discount_label) || '혜택 넣기';
    case 'countdown': return str(p.end_datetime) ? '마감 시각 있음' : '마감 시각 넣기';
    case 'footer': return str(p.notes).slice(0, 24) || (str(p.cs_phone) ? `문의 ${str(p.cs_phone)}` : '회사 정보 · 수신거부');
    default: return str(p.title) || str(p.headline) || str(p.question) || blockPanelSub(section.type);
  }
}

/** 하단 정보처럼 발송 규칙이 채우는 블록 — 목록에 "자동" 표식 */
export function isAutoBlock(type: SectionType): boolean {
  return type === 'footer';
}

// ─────────────── 블록 추가 팔레트 ───────────────

export interface MakePaletteItem {
  key: string;
  label: string;
  icon: string;
  section: SectionType;
  defaults?: Record<string, any>;
  /** 참여형(발행 크레딧이 100 → 120) */
  interaction?: boolean;
}

/** 참여형 = 발행 120(서버 isInteractionCampaign 과 같은 목록) */
export const INTERACTION_SECTION_TYPES: readonly SectionType[] = ['lucky_draw', 'roulette', 'poll', 'survey', 'email_capture', 'click_rewards'];

const blockItem = (key: string, label?: string): MakePaletteItem | null => {
  const b = DM_BLOCKS.find((x) => x.key === key);
  if (!b) return null;
  return { key: b.key, label: label || b.label, icon: b.icon, section: b.section, defaults: b.defaults, interaction: INTERACTION_SECTION_TYPES.includes(b.section) };
};

/**
 * DM 팔레트 — 블록 조립 CT(DM_BLOCKS) 그대로 + 머리 + 사진 모음. 참여형은 한 칸으로 묶고 누르면 펼친다.
 * ★ 2026-10-01 머리(로고 · 브랜드 이름) — 만들기 개편(0927)에서 팔레트가 DM_BLOCKS 기반으로 바뀌며 빠졌다(이메일 팔레트엔 있음 · 남지현 접수 cmungizf9).
 *   이메일 팔레트와 같은 이름·아이콘(LIST_LABEL · SECTION_META). 한 쪽에 1개 상한은 스토어 addSection 이 지킨다.
 */
export function dmPaletteItems(): { main: MakePaletteItem[]; interaction: MakePaletteItem[] } {
  const main = [
    { key: 'header', label: LIST_LABEL.header as string, icon: SECTION_META.header?.icon || '🏷️', section: 'header' as SectionType },
    blockItem('headline'), blockItem('text', '설명 글'), blockItem('products', '상품'), blockItem('cta'),
    blockItem('linkchip', '링크 모음'),
    { key: 'gallery', label: '사진 모음', icon: '🖼️', section: 'gallery' as SectionType },
    blockItem('video'), blockItem('coupon'), blockItem('countdown', '남은 시간'), blockItem('reviews', '후기'),
    blockItem('store'),
  ].filter(Boolean) as MakePaletteItem[];
  const interaction = DM_BLOCKS.filter((b) => b.group === '참여').map((b) => blockItem(b.key)).filter(Boolean) as MakePaletteItem[];
  return { main, interaction };
}

/** 이메일에서 렌더되는 블록(백엔드 EMAIL_BLOCK_WHITELIST 미러 · EmailVisualEditor 와 같은 목록) */
export const EMAIL_PALETTE_TYPES: readonly SectionType[] = [
  'header', 'hero', 'text_card', 'product_carousel', 'gallery',
  'coupon', 'promo_code', 'cta', 'store_info', 'sns', 'reviews', 'footer',
];
export function emailPaletteItems(): MakePaletteItem[] {
  return EMAIL_PALETTE_TYPES.map((t) => ({ key: t, label: LIST_LABEL[t] || (t === 'cta' ? '버튼' : SECTION_META[t]?.label || t), icon: SECTION_META[t]?.icon || '▫️', section: t }));
}

// ─────────────── 결과 화면 "고칠 곳" ───────────────

export interface ValidationLike {
  items?: Array<{ area: string; severity: 'fatal' | 'recommend' | 'improve'; section_id?: string; message: string; fix_suggestion?: string; overridable?: boolean }>;
  can_publish?: boolean;
}

export type FixKind = 'must' | 'suggest' | 'ok' | 'info';
export interface FixItem {
  kind: FixKind;
  title: string;
  sub?: string;
  /** 누르면 고칠 블록 */
  sectionId?: string;
  /** 오른쪽 짧은 버튼 글자(넣기 · 고치기) */
  action?: string;
}

const CTA_EMPTY_RE = /CTA 버튼 \d+번의 URL이 비어/;

/**
 * 서버 검수 결과 + 블록 → 고칠 곳 목록. must(보내기 잠금) → suggest → ok → info 순.
 * 문구는 서버 문장을 쓰되, 담당자가 가장 자주 만나는 한 가지(버튼 주소 없음)만 사람 말로 바꾼다.
 */
export function fixItemsOf(v: ValidationLike | null, sections: ReadonlyArray<Pick<Section, 'id' | 'type' | 'props'>>, extraInfo: string[] = []): FixItem[] {
  const items = v?.items || [];
  const must: FixItem[] = [];
  const seenCta = new Set<string>();
  for (const it of items) {
    if (it.severity !== 'fatal') continue;
    if (it.area === 'link' && CTA_EMPTY_RE.test(it.message)) {
      const key = it.section_id || 'cta';
      if (seenCta.has(key)) continue;
      seenCta.add(key);
      must.push({ kind: 'must', title: '버튼이 갈 주소가 없어요', sub: '누르면 바로 넣을 수 있어요', sectionId: it.section_id, action: '넣기' });
      continue;
    }
    must.push({ kind: 'must', title: it.message, sub: it.fix_suggestion || (it.overridable ? '확인하고 넘길 수도 있어요' : undefined), sectionId: it.section_id, action: '고치기' });
  }
  const suggest: FixItem[] = items.filter((it) => it.severity === 'recommend').slice(0, 3)
    .map((it) => ({ kind: 'suggest' as const, title: it.message, sub: it.fix_suggestion, sectionId: it.section_id, action: it.section_id ? '고치기' : undefined }));
  const ok: FixItem[] = [];
  const hero = sections.find((s) => s.type === 'hero');
  if (hero && str((hero.props as any)?.image_url)) ok.push({ kind: 'ok', title: '첫 화면 사진 있음' });
  const ctas = sections.filter((s) => s.type === 'cta');
  if (ctas.length > 0 && seenCta.size === 0) ok.push({ kind: 'ok', title: '버튼 주소 넣음' });
  if (v && !items.some((it) => it.area === 'link')) ok.push({ kind: 'ok', title: '링크 정상' });
  if (v && !items.some((it) => it.area === 'required_info' && it.severity === 'fatal')) ok.push({ kind: 'ok', title: '회사 정보 · 수신거부 안내 있음' });
  const info: FixItem[] = extraInfo.filter(Boolean).slice(0, 4).map((t) => ({ kind: 'info' as const, title: t }));
  return [...must, ...suggest, ...ok, ...info];
}

/** 레일 머리 한 줄 */
export function fixHeadline(items: readonly FixItem[]): { tone: 'warn' | 'good' | 'plain'; text: string; count: number } {
  const must = items.filter((i) => i.kind === 'must').length;
  if (must > 0) return { tone: 'warn', text: `보내기 전에 ${must}곳만 채워 주세요`, count: must };
  const sug = items.filter((i) => i.kind === 'suggest').length;
  if (sug > 0) return { tone: 'plain', text: `보낼 수 있어요 · 더 좋게 할 곳 ${sug}`, count: 0 };
  return { tone: 'good', text: '보낼 준비가 됐어요', count: 0 };
}

// ─────────────── 주소 읽기 카드 안내 ───────────────

export interface ReadCardLike { licensed: boolean; periodRaw: string | null }

/**
 * 읽어 온 카드의 "그대로 쓰기" 안내(★ 2026-09-27 · Codex 3R~12R 결론) — 면허 = 담당자 체크(직접 입력 판과 같은 규칙).
 * 켜면 할인율·기간이 페이지에 적힌 그대로 실리고, 끄면 숫자는 빼고 싣는다. 기간은 해석하지 않고 페이지에 적힌 줄 그대로 보여 준다.
 */
export function readCardUseNote(c: ReadCardLike): { tone: 'ok' | 'plain'; text: string } {
  const period = c.periodRaw ? ` · 페이지 기간 ${c.periodRaw}` : '';
  return c.licensed
    ? { tone: 'ok', text: `할인율·기간을 적힌 그대로 실어요${period}` }
    : { tone: 'plain', text: `숫자는 빼고 실어요${period}` };
}

// ─────────────── 첫 화면 카드칩 상태 ───────────────

export type ChipStatus = 'draft' | 'scheduled' | 'sent' | 'stopped' | 'failed';
export const CHIP_STATUS_LABEL: Record<ChipStatus, string> = { draft: '초안', scheduled: '예약', sent: '보냄', stopped: '중지', failed: '보내지 못함' };

/** DM 목록 행 → 칩 상태(발행 축 status 가 먼저 · 중지 = stopped) */
export function dmChipStatus(dm: { status?: string | null; short_code?: string | null; has_send_history?: boolean; scheduled_at?: string | null }): ChipStatus {
  if (dm.status === 'stopped') return 'stopped';
  if (dm.scheduled_at && new Date(dm.scheduled_at).getTime() > Date.now()) return 'scheduled';
  if (dm.status === 'published' || dm.short_code || dm.has_send_history) return 'sent';
  return 'draft';
}

/** 이메일 캠페인 → 칩 상태 */
export function emailChipStatus(c: { status?: string | null }): ChipStatus {
  switch (c.status) {
    case 'scheduled': return 'scheduled';
    case 'completed': case 'sending': return 'sent';
    case 'failed': return 'failed';
    default: return 'draft';
  }
}

// ─────────────── 문자 기본 문안(보내기 창 · AI 0) ───────────────

/**
 * DM 내용으로 채운 문자 초안 — 제목 + 부제 + 링크 자리(%DM링크%). 광고 표기·수신거부 080 은 발송 CT 가 붙인다.
 * AI 를 부르지 않는다(자동 과금 0). 더 다듬고 싶으면 사람이 [다듬기]를 누른다.
 */
export function defaultDmSmsText(input: { brand?: string | null; title?: string | null; sub?: string | null }): string {
  const brand = str(input.brand);
  const title = str(input.title);
  const sub = str(input.sub);
  const head = brand ? `[${brand}] ${title}` : title;
  return [head, sub, '▶ 자세히 보기 %DM링크%'].filter(Boolean).join('\n');
}

/** 광고 야간 제한(21시~다음날 08시 · 백엔드 NIGHT_AD_RESTRICTED 와 같은 경계) */
export function isNightAdHour(d: Date): boolean {
  const h = d.getHours();
  return h < 8 || h >= 21;
}

// ─────────────── 이메일 카드칩 표지(저장된 블록의 첫 사진) ───────────────

/** 첫 화면 사진 → 사진 모음 → 상품 → 설명 글 사진 → 머리 배너 순. 없으면 null(표지 칸은 비운다) */
export function emailCoverOf(sections: ReadonlyArray<{ type: string; props?: any; order?: number }> | null | undefined): string | null {
  const list = (sections || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  for (const s of list) if (s.type === 'hero' && pick(s.props?.image_url)) return pick(s.props.image_url);
  for (const s of list) if (s.type === 'gallery' && pick(s.props?.images?.[0]?.url)) return pick(s.props.images[0].url);
  for (const s of list) if (s.type === 'product_carousel' && pick(s.props?.products?.[0]?.image_url)) return pick(s.props.products[0].image_url);
  for (const s of list) if (s.type === 'text_card' && pick(s.props?.image_url)) return pick(s.props.image_url);
  for (const s of list) if (s.type === 'header' && pick(s.props?.banner_image_url)) return pick(s.props.banner_image_url);
  return null;
}
