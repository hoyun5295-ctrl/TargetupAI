/**
 * 목소리 꼴 칸 CT (★ 2026-10-29 설계서 docs/2026-10-29-voice-form-slots-ask-design.md · Codex 설계 4R approve)
 *
 * 꼴 칸 = 이 회사 문자 꼴에 늘 들어가는 칸(링크 · 매장 · 연락처). 사실 칸(상품 · 행사 · 기간 · 혜택 · 숫자)은 요청 · 기존 질문이 맡는다.
 * 판정 한 곳: 질문 단계(AI 한줄로 · 여정 · 자동마케팅 · 한 줄 단계 창)와 생성 지시문 · 링크 치환이 이 결과를 읽는다.
 *   - 칸 = 그 성격에서 생성이 고를 수 있는 뼈대 예시 전부(pickVoiceExamples 를 모든 종류 + null 로 · §7-4) + 확인된 문구 칸(§7-5).
 *   - 회사 값 = 링크(등록 브랜드 링크 1개 이상) · 연락처(브랜드 킷 contact.cs_phone · phone) · 매장 = 없음.
 *   - 결정 = 칸마다 값 · 명시 생략 · 미결정(§7-1). 질문 = 칸 − 회사 값 − 결정.
 * 목소리 미학습 · 칸 0 = 빈 목록(지금 동작).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { SKELETON_SLOT } from './brand-voice-skeleton';
import { COPY_CONTENT_TYPES } from './copy-content-type';
import { LINK_PLACEHOLDER, LINK_TOKEN_RE, type BrandLink, type LinkHabit } from './brand-link-core';
import type { LineQuestion } from './one-line-ct/questions';
import { lineUrlSegments, trimLinkTail } from './one-line-steps';

export const VOICE_FORM_SLOTS = ['link', 'store', 'phone'] as const;
export type VoiceFormSlot = (typeof VOICE_FORM_SLOTS)[number];
export type VoiceFormEntry = { value: string } | { omit: true };
export type VoiceFormDecision = Partial<Record<VoiceFormSlot, VoiceFormEntry>>;

/** ★ 2026-10-31 링크 글자 상한(사람이 적은 글자 · 한 줄 단계 창 URL_MAX 와 같은 값 · 설계서 docs/2026-10-31-ai-line-answer-link-design.md P5) */
export const LINK_MAX = 500;

/** 질문 글 = 서버 상수(AI 한줄로 답 식별도 이 글) */
export const VOICE_FORM_ASK: Record<VoiceFormSlot, { label: string; help: string; placeholder: string; maxLength: number }> = {
  link: { label: '문자에 넣을 링크 주소를 알려 주세요', help: '학습한 우리 회사 문자에 링크 줄이 있어요. 비우면 그 줄 없이 써요.', placeholder: 'https://', maxLength: LINK_MAX },
  store: { label: '안내할 매장 이름을 알려 주세요', help: '학습한 우리 회사 문자에 매장 줄이 있어요. 비우면 그 줄 없이 써요.', placeholder: '예: 강남점', maxLength: 40 },
  phone: { label: '문의 받을 번호를 알려 주세요', help: '학습한 우리 회사 문자에 문의 번호 줄이 있어요. 비우면 그 줄 없이 써요.', placeholder: '예: 02-1234-5678', maxLength: 20 },
};
export const VOICE_FORM_NONE_LABEL = '이 줄 없이';
/** 1회용 링크의 토큰 라벨(지시문 · 치환이 같은 글) */
export const ONCE_LINK_LABEL = '이번 문자 링크';

const SLOT_TEXT: Record<VoiceFormSlot, string> = { link: SKELETON_SLOT.link, store: SKELETON_SLOT.store, phone: SKELETON_SLOT.phone };

/** (순수) 글에 든 꼴 칸 */
export function formSlotsInText(text: string): VoiceFormSlot[] {
  const t = String(text || '');
  return VOICE_FORM_SLOTS.filter((s) => t.includes(SLOT_TEXT[s]));
}

export interface FormSlotSource {
  /** 생성이 고를 수 있는 뼈대 예시(종류마다 고른 결과의 합 · 호출부가 pickVoiceExamples 로 만든다) */
  skeletons: readonly string[];
  /** 그 성격의 확인된 문구 칸(서명 · 인사 · 행동 유도 · 자주 쓰는 표현 · 어미 예시) */
  phrases: readonly string[];
}

/** (순수) 꼴 칸 = 뼈대 + 문구에 한 번이라도 나온 칸 */
export function voiceFormSlotsOf(src: FormSlotSource): VoiceFormSlot[] {
  const found = new Set<VoiceFormSlot>();
  for (const t of [...src.skeletons, ...src.phrases]) for (const s of formSlotsInText(t)) found.add(s);
  return VOICE_FORM_SLOTS.filter((s) => found.has(s));
}

/** 모든 종류 + null 로 돌린 고르기 결과의 합(생성과 같은 함수 · 다른 성격 보충 포함) */
export function pickableSkeletons<T extends { skeleton: string; message: { id?: string } }>(
  pick: (contentType: (typeof COPY_CONTENT_TYPES)[number] | null) => ReadonlyArray<T>,
): string[] {
  const out = new Map<string, string>();
  for (const c of [null, ...COPY_CONTENT_TYPES]) for (const x of pick(c)) out.set(x.message.id || x.skeleton, x.skeleton);
  return [...out.values()];
}

export interface CompanyFormValues { link: boolean; phone: string | null; /** 등록 링크(비토큰 생산자에게 주소 그대로) */ links?: BrandLink[] }

/** (순수) 번호 꼴(숫자 · 하이픈 · 8~13자리 · 8자리 = 1588 같은 대표번호) */
export function cleanFormPhone(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!/^[0-9-]{8,20}$/.test(v)) return null;
  const digits = v.replace(/-/g, '').length;
  return digits >= 8 && digits <= 13 ? v : null;
}

/** (순수) 링크 꼴(http · https · 도메인 · 공백 0 · LINK_MAX 자) — 사설 주소 · 숫자 주소는 받지 않는다 */
export function cleanFormLink(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!v || v.length > LINK_MAX || /\s/.test(v)) return null;
  return httpLinkOk(v) ? v : null;
}

/** (순수) http(s) 주소 꼴 · 받는 주소(사설 · 숫자 · localhost 거절) — 길이는 부르는 쪽이 사람이 적은 글자로 본다 */
function httpLinkOk(v: string): boolean {
  let u: URL;
  try { u = new URL(v); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  return !(!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || h === 'localhost' || h.endsWith('.local'));
}

/** 답 한 덩어리 = `https://` 없는 도메인 꼴(`www.shop.com` · `shop.co.kr/event`) */
const BARE_DOMAIN_RE = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?$/i;

/**
 * ★ 2026-10-31 (순수) 주소 읽기 한 곳(설계서 P5) — raw = url = 사람이 적은 글자 그대로(결정 값 · 저장 · 지문 · 문자에 넣는 값 · Harold 1031 「적은 그대로 넣기」).
 *   공백 없는 한 덩어리는 그 자체로(https:// 없는 도메인 꼴은 검사할 때만 붙여 본다) · 아니면 글 속 http(s) 주소(lineUrls · 한 줄 단계 창과 같은 읽기).
 *   검증 = 사설 · 숫자 · localhost 거절 · 길이 = 사람이 적은 글자(LINK_MAX). ASCII 로 바꾸기는 쓰는 자리에서만(asciiLink).
 */
export function readLinkText(text: unknown): { raw: string; url: string } | null {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (!/\s/.test(s) && isWholeLink(s)) return { raw: s, url: s };
  // 글 속 = 링크 구간(linkSpans · 덩어리 먼저) 중 http(s) 주소 첫 개(한 줄에서는 https:// 없는 꼴을 링크로 읽지 않는다 · 낱말 오인 미리 채움 0)
  for (const sp of linkSpans(s)) {
    const url = /^https?:\/\//i.test(sp.link) ? cleanFormLink(sp.link) : null;
    if (url) return { raw: url, url };
  }
  return null;
}

/** (순수) 링크 꼴(길이 상한 없음 · 글에서 꺼낼 때) — http(s) 주소 또는 https:// 없는 도메인 꼴(검사할 때만 붙여 본다) · Codex 1031 ③ */
function linkShape(s: string): boolean {
  if (!s || /\s/.test(s)) return false;
  if (/^https?:\/\//i.test(s)) return httpLinkOk(s);
  return BARE_DOMAIN_RE.test(s) && httpLinkOk(`https://${s}`);
}
/** (순수) 사람이 적은 한 덩어리가 링크인가 = 꼴 + 길이(사람이 적은 글자 ≤ LINK_MAX) */
function isWholeLink(s: string): boolean {
  return !!s && s.length <= LINK_MAX && linkShape(s);
}

const SPAN_LEAD_RE = /^[("'「『[<]+/;
/**
 * ★ 2026-10-31 (순수) 글 속 링크 구간 읽기 한 곳(Codex 1031 ② · 주소 경계 부류 → 구조) — 공백으로 갈린 덩어리마다:
 *   덩어리 몸(앞 괄호를 떼고 끝은 trimLinkTail · 짝 맞는 괄호는 지킨다) 전체가 링크 꼴이면 그것 하나 · 아니면 그 안의 http(s) 주소(lineUrlSegments).
 *   안쪽에 다른 주소가 이어진 링크(shop.com/login?next=https://…)를 안쪽 주소로 쪼개 읽지 않는다. 링크 있음 · 다시 쓰기 · 사실 글 토큰화가 이 구간을 함께 쓴다.
 */
export function linkSpans(text: string): Array<{ start: number; end: number; link: string }> {
  const src = String(text ?? '');
  const out: Array<{ start: number; end: number; link: string }> = [];
  for (const m of src.matchAll(/\S+/g)) {
    const chunk = m[0];
    const at = m.index ?? 0;
    const lead = (chunk.match(SPAN_LEAD_RE) || [''])[0];
    const body = chunk.slice(lead.length);
    const core = trimLinkTail(body);   // 끝 떼기 = 주소 읽기와 같은 한 곳(짝 맞는 괄호는 지킨다)
    if (core && linkShape(core)) { out.push({ start: at + lead.length, end: at + lead.length + core.length, link: core }); continue; }
    let off = 0;
    for (const seg of lineUrlSegments(chunk)) {
      if ('url' in seg) {
        if (httpLinkOk(seg.url)) out.push({ start: at + off, end: at + off + seg.url.length, link: seg.url });
        off += seg.url.length + seg.tail.length;
      } else off += seg.text.length;
    }
  }
  return out;
}

/**
 * ★ 2026-10-31 (순수) 글 속 링크 꺼내기 한 곳 — http(s) 주소(lineUrls) + 공백으로 갈린 덩어리(앞뒤 괄호 · 끝 문장부호 뺀 몸)가 그대로 링크인 것(https:// 없이 적은 꼴).
 *   「링크가 결과에 있는가」(ensureOnceLink) · 「다시 쓰기가 링크를 뺐는가」(rewriteDropsLinks)가 이 함수 하나로 같은 링크를 본다(같음 = 글자 그대로).
 */
export function textLinks(text: string): string[] {
  return [...new Set(linkSpans(text).map((sp) => sp.link))];
}

/**
 * ★ 2026-10-31 (순수) 다시 쓴 글이 원문의 링크를 뺐는가(설계서 P6) — 원문에서 꺼낸 링크(textLinks) 중 다시 쓴 글에서 꺼낸 링크에 글자 그대로 없는 것.
 *   같은 칸 다시 쓰기(꾸미기 · 다듬기)만 부른다(근거가 같은 칸이 아닌 rewriteAddsFacts 와 섞지 않는다).
 */
export function rewriteDropsLinks(after: string, before: string): boolean {
  const have = new Set(textLinks(String(after ?? '')));
  return textLinks(String(before ?? '')).some((u) => !have.has(u));
}

/**
 * ★ 2026-10-31 (순수) 문자에 싣는 주소 = ASCII(설계서 P5 · Codex 설계 1R ③) — 출력 가능 ASCII 글자만이면 그대로(지금 값 = 지금 값),
 *   아니면 URL 표준 직렬화(한글 경로 = 퍼센트 부호 · 한글 도메인 = punycode · 이모지가 정제에서 깎이는 길을 닫는다).
 *   쓰는 자리 셋 = resolveFormLink once 치환 값 · voiceFormPromptSection 비토큰 링크 줄 · ensureOnceLink.
 */
export function asciiLink(url: string): string {
  const v = String(url || '').trim();
  if (/^[\x21-\x7e]+$/.test(v)) return v;
  // https:// 없이 적은 꼴은 붙여 직렬화한 뒤 다시 뗀다(적은 그대로 · ASCII 만 바꾼다)
  const bare = !/^https?:\/\//i.test(v);
  try { const href = new URL(bare ? `https://${v}` : v).href; return bare ? href.replace(/^https:\/\//, '') : href; } catch { return v; }
}

/** (순수) 회사가 가진 값 */
export function companyFormValuesOf(links: readonly BrandLink[], kitContact: { cs_phone?: unknown; phone?: unknown } | null | undefined): CompanyFormValues {
  const reg = (links || []).filter((l) => l && l.label && l.url);
  return {
    link: reg.length > 0,
    phone: cleanFormPhone(kitContact?.cs_phone) || cleanFormPhone(kitContact?.phone),
    links: reg,
  };
}

/** (순수) 물을 칸 = 꼴 칸 − 회사 값 − 결정(값 · 생략 모두) */
export function voiceFormAsksOf(slots: readonly VoiceFormSlot[], values: CompanyFormValues, decision: VoiceFormDecision | null | undefined): VoiceFormSlot[] {
  return slots.filter((s) => {
    if (decision && decision[s]) return false;
    if (s === 'link') return !values.link;
    if (s === 'phone') return !values.phone;
    return true;
  });
}

/** (순수) 질문표 꼴(여정 · 자동마케팅 · 한 줄 단계 창) — id = `voice:칸` */
export function voiceFormQuestions(asks: readonly VoiceFormSlot[]): LineQuestion[] {
  return asks.map((s) => ({
    id: `voice:${s}`, kind: 'text' as const, label: VOICE_FORM_ASK[s].label, help: VOICE_FORM_ASK[s].help,
    placeholder: VOICE_FORM_ASK[s].placeholder, maxLength: VOICE_FORM_ASK[s].maxLength, required: false, noneLabel: VOICE_FORM_NONE_LABEL,
  }));
}

/** 링크 답이 주소가 아닐 때(목소리 링크 칸 · AI 한줄로 링크 질문이 같은 글) */
export const LINK_INVALID_ERROR = '링크는 주소(https://… 또는 www.…)로 적어 주세요.';

/**
 * (순수) 물은 칸의 답 → 결정. 답 = { 칸: 글 } · 빈 글 · 없는 칸 = 명시 생략(질문을 거친 뒤의 결정).
 * 꼴이 틀린 답 = 칸 이름과 함께 거절(사람에게 다시 묻는다) · 물은 칸 밖의 키 = 무시(서버가 다시 계산한 질문만 믿는다).
 */
export function decideVoiceForm(asks: readonly VoiceFormSlot[], answers: Partial<Record<VoiceFormSlot, unknown>> | null | undefined):
  { ok: true; decision: VoiceFormDecision } | { ok: false; slot: VoiceFormSlot; error: string } {
  const decision: VoiceFormDecision = {};
  for (const s of asks) {
    const raw = String(answers?.[s] ?? '').trim();
    if (!raw) { decision[s] = { omit: true }; continue; }
    const v = s === 'link' ? readLinkText(raw)?.url ?? null : s === 'phone' ? cleanFormPhone(raw) : raw.slice(0, VOICE_FORM_ASK.store.maxLength);
    if (!v) {
      return { ok: false, slot: s, error: s === 'link' ? LINK_INVALID_ERROR : '문의 번호는 숫자와 하이픈으로 적어 주세요.' };
    }
    decision[s] = { value: v };
  }
  return { ok: true, decision };
}

/**
 * (순수) 요청이 보낸 답 → 결정 + 지문(★ Codex 구현 2R · 멱등 = 회사 값과 무관).
 *   보낸 칸(화이트리스트) = 사람의 결정 · 지금 물을 칸인데 안 보낸 칸 = 생략(결정에만) · 지문 = 보낸 칸만(회사 값이 바뀌어도 같은 요청 = 같은 지문).
 */
export function decideSentVoiceForm(asks: readonly VoiceFormSlot[], sent: Partial<Record<VoiceFormSlot, unknown>>):
  { ok: true; decision: VoiceFormDecision; print: string } | { ok: false; slot: VoiceFormSlot; error: string } {
  const sentSlots = VOICE_FORM_SLOTS.filter((s) => Object.prototype.hasOwnProperty.call(sent, s));
  const d = decideVoiceForm([...new Set([...sentSlots, ...asks])], sent);
  if (!d.ok) return d;
  const sentDecision: VoiceFormDecision = {};
  for (const s of sentSlots) sentDecision[s] = d.decision[s];
  return { ok: true, decision: d.decision, print: voiceFormPrint(sentDecision) };
}

/** (순수) 저장된 결정 읽기(모양이 틀리면 그 칸 = 미결정) */
export function readVoiceFormDecision(raw: unknown): VoiceFormDecision {
  const out: VoiceFormDecision = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const s of VOICE_FORM_SLOTS) {
    const e = (raw as any)[s];
    if (!e || typeof e !== 'object') continue;
    if (e.omit === true) out[s] = { omit: true };
    else if (typeof e.value === 'string') {
      const v = s === 'link' ? readLinkText(e.value)?.url ?? null : s === 'phone' ? cleanFormPhone(e.value) : e.value.trim().slice(0, VOICE_FORM_ASK.store.maxLength);
      if (v) out[s] = { value: v };
    }
  }
  return out;
}

/** (순수) 지문용 정규화 글(값 · 생략이 바뀌면 바뀐다 · 미결정 = 빠짐) */
export function voiceFormPrint(d: VoiceFormDecision | null | undefined): string {
  if (!d) return '';
  return VOICE_FORM_SLOTS.filter((s) => d[s]).map((s) => `${s}=${'omit' in d[s]! ? '-' : (d[s] as { value: string }).value}`).join('|');
}

export type FormLinkMode = 'registered' | 'once' | 'omit' | 'none';
/** (순수) 링크 결정 한 곳(§7-3) — 지시문 · 치환이 같은 목록을 받는다 */
export function resolveFormLink(registered: readonly BrandLink[], decision: VoiceFormDecision | null | undefined): { mode: FormLinkMode; links: BrandLink[]; once?: string } {
  const reg = (registered || []).filter((l) => l && l.label && l.url);
  const d = decision?.link;
  if (d && 'omit' in d) return { mode: 'omit', links: [] };
  // ★ 2026-10-31 once = 결정 값에서 바로(Codex 구현 1R ① · 회사가 같은 라벨을 등록해도 라벨로 거꾸로 찾지 않는다)
  if (d && 'value' in d) { const once = asciiLink(d.value); return { mode: 'once', links: [...reg, { label: ONCE_LINK_LABEL, url: once }], once }; }
  return reg.length > 0 ? { mode: 'registered', links: reg } : { mode: 'none', links: [] };
}

/** (순수) 링크 생략 결정 = 링크 토큰 · 자리 표시가 든 줄 전체를 지운다(§8-1 · AI 재호출 0) · 연속 빈 줄은 하나로 */
export function stripLinkLines(text: string): string {
  const lines = String(text || '').split('\n');
  const kept = lines.filter((l) => !/\{\{\s*LINK\s*:/i.test(l) && !l.includes(LINK_PLACEHOLDER));
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * ★ 2026-10-31 (순수) 사람이 정한 링크(once)의 지시문 절(설계서 P2) — 등록 링크 목록 대신 이번 문자 링크 하나 · 꼭 한 번.
 *   composeVoicePrompt 링크 절 한 곳이 once 일 때 부른다(등록 · 습관 · 생략 갈래는 그대로).
 */
export function onceLinkPromptSection(habit?: LinkHabit | null): string {
  const position = habit?.uses_url && habit.position === 'body_end'
    ? '이 회사 문안은 본문 마지막(CTA 문구 다음 줄)에 링크를 넣는 습관이 있습니다. CTA 문구 다음 줄에 배치하세요.'
    : '문안 흐름상 자연스러운 위치(CTA 부근) 1곳에 배치하세요.';
  return `

## 링크 (이번 문자 · 반드시 준수)

- 담당자가 이번 문자에 넣을 링크를 정했습니다. 문안마다 {{LINK:${ONCE_LINK_LABEL}}} 토큰을 꼭 한 번 그대로 쓰세요. 시스템이 그 주소로 바꿉니다.
- 다른 링크 토큰 · URL 직접 작성(https://... 형태) · 링크 자리 표시는 쓰지 않습니다.
- ${position}`;
}

/** 링크 자리 표시(생성기 · 여정 지시문이 가르치는 꼴) — once 주소로 바꾼다 */
const LINK_SPOTS: readonly string[] = [LINK_PLACEHOLDER, '[URL 입력]', '[URL: 회사 admin 수정]'];

/**
 * ★ 2026-10-31 (순수) 정해진 링크는 결과에 꼭 있다(설계서 P2 · 뿌리 대장 R32) — 링크 토큰(라벨 무관) · 링크 자리 표시 = 그 주소,
 *   그래도 본문에 없으면 마지막 줄에 붙인다(AI 재호출 0). url 이 없으면 그대로.
 */
export function ensureOnceLink(text: string, url: string | null | undefined): { text: string; appended: boolean } {
  const src = String(text ?? '');
  if (!url || !String(url).trim()) return { text: src, appended: false };
  const link = asciiLink(url);
  // ★ Codex 구현 1R ④ — 주소는 글자 그대로 넣는다(치환 문자열의 $ 문법 0 · 콜백) · ② 있음 = 바꾼 자리가 있거나 꺼낸 주소가 글자 그대로 같다
  let hit = false;
  let out = src.replace(new RegExp(LINK_TOKEN_RE.source, 'g'), () => { hit = true; return link; });
  for (const spot of LINK_SPOTS) if (out.includes(spot)) { hit = true; out = out.split(spot).join(link); }
  if (hit || textLinks(out).includes(link)) return { text: out, appended: false };
  return { text: `${out.replace(/\s+$/, '')}\n${link}`, appended: true };
}

/**
 * (순수) 생성 지시문 절 — 꼴 칸마다 쓸 값 · 줄을 뺄 칸. 꼴 칸이 없으면 빈 글.
 * 링크 = 토큰 생산자(useLinkTokens)는 {{LINK:라벨}} · 그 밖 생산자는 주소 글 그대로(사람이 적은 값).
 */
export function voiceFormPromptSection(input: {
  slots: readonly VoiceFormSlot[]; values: CompanyFormValues; decision: VoiceFormDecision | null | undefined; useLinkTokens: boolean;
}): string {
  if (input.slots.length === 0) return '';
  const d = input.decision || {};
  const lines: string[] = [];
  for (const s of input.slots) {
    const e = d[s];
    const name = s === 'link' ? '링크' : s === 'store' ? '매장' : '문의 번호';
    if (e && 'omit' in e) { lines.push(`- ${name} 칸: 이번 문자에는 쓰지 않는다(그 칸이 든 줄을 쓰지 않는다)`); continue; }
    if (s === 'link') {
      if (e && 'value' in e) lines.push(input.useLinkTokens ? `- 링크 칸: {{LINK:${ONCE_LINK_LABEL}}} 토큰으로 쓴다` : `- 링크 칸: ${asciiLink(e.value)}`);
      else if (input.values.link && input.useLinkTokens) lines.push('- 링크 칸: 아래 브랜드 링크 규칙의 토큰으로 쓴다');
      else if (input.values.link) lines.push(`- 링크 칸: 아래 주소 중 문안에 맞는 하나를 글자 그대로 쓴다(바꾸거나 지어내지 않는다): ${(input.values.links || []).map((l) => `${l.label} ${l.url}`).join(' / ')}`);
      else lines.push('- 링크 칸: 값이 없다(그 칸이 든 줄을 쓰지 않는다)');
      continue;
    }
    const v = e && 'value' in e ? e.value : s === 'phone' ? input.values.phone : null;
    lines.push(v ? `- ${name} 칸: ${v}` : `- ${name} 칸: 값이 없다(그 칸이 든 줄을 쓰지 않는다)`);
  }
  return `\n## 이 회사 문자 꼴 칸 값 (사람이 정한 값 · 이 값 그대로 쓴다 · 지어내지 않는다)\n${lines.join('\n')}\n`;
}

/**
 * ★ 2026-10-29 묶음 B(§8-2) — 한 줄 단계 창(DM · 이메일 · 인앱)은 한 요리 안에서 생산자 여럿(문구 · 머리글 · 블록)이 목소리를 부른다.
 *   결정을 생산자마다 넘기지 않고 요리 문맥에 싣는다 · composeVoicePrompt 가 입력에 결정이 없으면 이 문맥을 읽는다(한 곳).
 */
const voiceFormStore = new AsyncLocalStorage<{ decision: VoiceFormDecision }>();
export function runWithVoiceForm<T>(decision: VoiceFormDecision | null | undefined, fn: () => Promise<T>): Promise<T> {
  return decision && Object.keys(decision).length > 0 ? voiceFormStore.run({ decision }, fn) : fn();
}
export function currentVoiceForm(): VoiceFormDecision | null {
  return voiceFormStore.getStore()?.decision ?? null;
}
