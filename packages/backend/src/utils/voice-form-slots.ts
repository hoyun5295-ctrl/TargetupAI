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
import { LINK_PLACEHOLDER, type BrandLink } from './brand-link-core';
import type { LineQuestion } from './one-line-ct/questions';

export const VOICE_FORM_SLOTS = ['link', 'store', 'phone'] as const;
export type VoiceFormSlot = (typeof VOICE_FORM_SLOTS)[number];
export type VoiceFormEntry = { value: string } | { omit: true };
export type VoiceFormDecision = Partial<Record<VoiceFormSlot, VoiceFormEntry>>;

/** 질문 글 = 서버 상수(AI 한줄로 답 식별도 이 글) */
export const VOICE_FORM_ASK: Record<VoiceFormSlot, { label: string; help: string; placeholder: string; maxLength: number }> = {
  link: { label: '문자에 넣을 링크 주소를 알려 주세요', help: '학습한 우리 회사 문자에 링크 줄이 있어요. 비우면 그 줄 없이 써요.', placeholder: 'https://', maxLength: 200 },
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

/** (순수) 링크 꼴(http · https · 도메인 · 공백 0 · 200자) — 사설 주소 · 숫자 주소는 받지 않는다 */
export function cleanFormLink(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!v || v.length > 200 || /\s/.test(v)) return null;
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || h === 'localhost' || h.endsWith('.local')) return null;
  return v;
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
    const v = s === 'link' ? cleanFormLink(raw) : s === 'phone' ? cleanFormPhone(raw) : raw.slice(0, VOICE_FORM_ASK.store.maxLength);
    if (!v) {
      return { ok: false, slot: s, error: s === 'link' ? '링크는 https:// 로 시작하는 주소로 적어 주세요.' : '문의 번호는 숫자와 하이픈으로 적어 주세요.' };
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
      const v = s === 'link' ? cleanFormLink(e.value) : s === 'phone' ? cleanFormPhone(e.value) : e.value.trim().slice(0, VOICE_FORM_ASK.store.maxLength);
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
export function resolveFormLink(registered: readonly BrandLink[], decision: VoiceFormDecision | null | undefined): { mode: FormLinkMode; links: BrandLink[] } {
  const reg = (registered || []).filter((l) => l && l.label && l.url);
  const d = decision?.link;
  if (d && 'omit' in d) return { mode: 'omit', links: [] };
  if (d && 'value' in d) return { mode: 'once', links: [...reg, { label: ONCE_LINK_LABEL, url: d.value }] };
  return reg.length > 0 ? { mode: 'registered', links: reg } : { mode: 'none', links: [] };
}

/** (순수) 링크 생략 결정 = 링크 토큰 · 자리 표시가 든 줄 전체를 지운다(§8-1 · AI 재호출 0) · 연속 빈 줄은 하나로 */
export function stripLinkLines(text: string): string {
  const lines = String(text || '').split('\n');
  const kept = lines.filter((l) => !/\{\{\s*LINK\s*:/i.test(l) && !l.includes(LINK_PLACEHOLDER));
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
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
      if (e && 'value' in e) lines.push(input.useLinkTokens ? `- 링크 칸: {{LINK:${ONCE_LINK_LABEL}}} 토큰으로 쓴다` : `- 링크 칸: ${e.value}`);
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
