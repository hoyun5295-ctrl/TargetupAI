/**
 * automarketing-interview.ts — 자동 마케팅 한 줄의 질문표 · 답 검증(★ 2026-10-24 설계서 docs/2026-10-24-automarketing-oneline-design.md §1)
 *
 * 한 줄 → 모자란 것만 묻는다. 「반드시」 갈래는 닫힌 목록 여섯이다(숫자 상한이 아니라 갈래를 고정).
 *   ① 칸을 못 정한 말 ② 누구에게(번역 실패 · 조건 없음 · AI 가 「전체 고객」을 고름) ③ 사람이 쓴 주기가 같은 고객 반복에 막힘
 *   ④ 혜택(행사 말인데 값 없음 · 값이 조건과 섞임) ⑤ 회신번호(기본 없음 + 후보 둘 이상) ⑥ 담당자 알림 번호 없음
 * 그 밖은 추천으로 채우고 멈추지 않는다(결과 문장에 보인다). 질문을 고르고 답을 검증하는 것은 순수 함수다(AI 0 · DB 0).
 *   대상 판정을 AI 에 넘기지 않는 원칙(신뢰 설계 §2-1) — AI 는 대상 번역 1회 · 문안에만 쓴다.
 */
import { pickAnswer, type LineAnswers, type LineQuestion, type LineQuestionOption } from './one-line-ct/questions';
import { checkSchedulePairing, getSegmentContract } from './automarketing-segment';
import type { AudienceTranslation } from './audience-translate';

export const OPERATOR_BENEFIT_MAX = 200;

/** ② 선택지의 축 한 줄(이 회사에서 쓸 수 있는가 · 근거 = 축 가용 판정) */
export interface OperatorAxisChoice { key: string; label: string; available: boolean; reason: string }

/** 질문을 고를 사실(부르는 쪽이 보관본 · DB 에서 모은다) */
export interface OperatorQuestionFacts {
  translation: AudienceTranslation;
  /** ② 선택지(「전체 고객」 제외 · 순서 그대로) */
  axes: OperatorAxisChoice[];
  /** 수신 동의한 전체 고객 수(모르면 null) */
  everyoneCount: number | null;
  /** 지금 주기(사람이 쓰지 않았으면 부르는 쪽이 대상에 맞춰 정한 추천 주기) */
  schedule: string;
  /** ④ 혜택을 물어야 하면 그 까닭과 채워 둘 사람 글 조각 · 묻지 않으면 null */
  benefitAsk: { reason: 'missing' | 'mixed'; prefill: string | null } | null;
  /** ⑤ 기본 번호가 없고 후보가 둘 이상이면 그 후보(숫자만) · 묻지 않으면 null */
  callbackCandidates: string[] | null;
  /** ⑥ 담당자 알림 번호가 없다 */
  adminPhoneMissing: boolean;
}

export type OperatorQuestion = LineQuestion & { required: true };

const everyLabel = (schedule: string) => (schedule === 'daily' ? '매일' : '매주');

function phoneLabel(d: string): string {
  if (/^02\d{7,8}$/.test(d)) return d.length === 9 ? `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}` : `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return d;
}

/**
 * 이 주기로 이 축을 고를 수 있는가 — 데이터가 없으면 자물쇠 + 사유.
 *   짝(같은 고객 반복)에 막히면 잠그지 않고 「매월로 보내요」 보기로 준다(axis:KEY|monthly · Codex 1R: 보기가 전부 잠겨 답할 수 없는 질문 0).
 */
function axisOption(a: OperatorAxisChoice, schedule: string, label = a.label): LineQuestionOption {
  if (!a.available) return { value: `axis:${a.key}`, label, disabled: true, reason: a.reason };
  const pair = checkSchedulePairing(schedule, { segmentKey: a.key });
  return pair.ok
    ? { value: `axis:${a.key}`, label, desc: getSegmentContract(a.key)?.description }
    : { value: `axis:${a.key}|monthly`, label: `${label} · 매월로 보내요`, desc: pair.reason };
}

/** (순수) 사실 → 질문(없으면 빈 배열 = 바로 문안) */
export function buildOperatorQuestions(f: OperatorQuestionFacts): OperatorQuestion[] {
  const out: OperatorQuestion[] = [];
  const tr = f.translation;

  // ① 칸을 못 정한 말 — 값이 있는 칸만 고를 수 있다(빈 칸은 자물쇠 + 사유)
  if (tr.kind === 'needs_choice') {
    for (const u of tr.unresolved) {
      out.push({
        id: `field:${u.term}`, kind: 'choice', required: true,
        label: `「${u.term}」은(는) 어느 칸으로 볼까요?`,
        help: '값이 있는 칸만 고를 수 있어요. 맞는 칸이 없으면 대상을 넓혀서 보내지 않아요.',
        options: tr.options.map((o) => ({
          value: o.field,
          label: o.label,
          desc: o.disabled ? undefined : `값 있는 고객 ${o.fillCount.toLocaleString('ko-KR')}명${o.samples.length ? ` · 예: ${o.samples.join(' · ')}` : ''}`,
          disabled: !!o.disabled,
          reason: o.disabled ? '값 있는 고객이 없어 고를 수 없어요.' : undefined,
        })),
      });
    }
  }

  // ② 누구에게 — 한 줄에서 받는 분을 못 읽었거나 AI 가 「전체 고객」을 골랐다(넓게 보내는 것은 사람이 고른다 · 미리 고른 답 0)
  const noAudience = tr.kind === 'blocked' && (tr.code === 'NO_CONDITION' || tr.code === 'TRANSLATE_FAILED');
  const aiEveryone = tr.kind === 'axis' && tr.segmentKey === 'all' && tr.mapped;
  if (noAudience || aiEveryone) {
    const everyone: OperatorAxisChoice = { key: 'all', label: '전체 고객', available: true, reason: '' };
    out.push({
      id: 'audience', kind: 'choice', required: true,
      label: '누구에게 보낼까요?',
      help: aiEveryone ? '한 줄에 받는 분이 없어 전체 고객에게 보낼지 여쭤봐요.' : '한 줄에서 받는 분을 찾지 못했어요.',
      options: [
        ...f.axes.filter((a) => a.key !== 'all').map((a) => axisOption(a, f.schedule)),
        axisOption(everyone, f.schedule, `수신 동의한 전체 고객${f.everyoneCount != null ? ` · ${f.everyoneCount.toLocaleString('ko-KR')}명` : ''}`),
      ],
    });
  }

  // ③ 주기가 같은 고객 반복에 막힘 — 막힌 값은 자물쇠 + 사유 · [매월로] · [새로 해당된 고객에게 같은 주기로]
  //   ★ Codex 1R — 질문 표시와 안전 검증을 가르지 않는다: 사람이 쓴 주기든 추천 주기든 막히면 묻는다(추천 주기는 부르는 쪽이 대상에 맞춰 다시 정한다)
  if ((tr.kind === 'axis' || tr.kind === 'filters') && !aiEveryone) {
    const pair = checkSchedulePairing(f.schedule, tr.kind === 'axis' ? { segmentKey: tr.segmentKey } : { hasConditions: true });
    if (!pair.ok) {
      const every = everyLabel(f.schedule);
      const suggest = pair.suggestKey ? getSegmentContract(pair.suggestKey) : null;
      out.push({
        id: 'schedule', kind: 'choice', required: true,
        label: `${every} 보내면 같은 고객이 ${every} 다시 받게 돼요. 어떻게 보낼까요?`,
        options: [
          { value: 'monthly', label: '매월 한 번 보내기' },
          ...(suggest ? [{ value: `axis:${suggest.key}`, label: `「${suggest.label}」에게만 ${every} 보내기`, desc: suggest.description }] : []),
          { value: 'keep', label: `지금 대상에게 ${every} 보내기`, disabled: true, reason: pair.reason },
        ],
      });
    }
  }

  // ④ 혜택 — 적어 주신 혜택만 싣는다(AI 가 지어 쓰지 않는다)
  if (f.benefitAsk) {
    out.push({
      id: 'benefit', kind: 'text', required: true,
      label: f.benefitAsk.reason === 'missing' ? '어떤 혜택을 실을까요?' : '실을 혜택이 맞나요?',
      help: f.benefitAsk.reason === 'missing'
        ? '행사 말은 있는데 혜택 값이 없어요. 적어 주신 혜택만 그대로 실어요.'
        : '한 줄에서 혜택으로 보이는 말을 넣어 두었어요. 받는 분 조건은 빼고 혜택만 남겨 주세요.',
      placeholder: '예: 30% 할인 쿠폰',
      maxLength: OPERATOR_BENEFIT_MAX,
      noneLabel: '혜택 없이 보내기',
      ...(f.benefitAsk.prefill ? { recommended: f.benefitAsk.prefill } : {}),
    });
  }

  // ⑤ 회신번호 — 기본 번호가 없고 후보가 둘 이상(하나면 그 번호를 칸에 적는다 · 부르는 쪽)
  if (f.callbackCandidates && f.callbackCandidates.length >= 2) {
    out.push({
      id: 'callback', kind: 'choice', required: true,
      label: '어느 번호로 보낼까요?',
      help: '기본 발신번호가 정해져 있지 않아 여쭤봐요.',
      options: f.callbackCandidates.map((d) => ({ value: d, label: phoneLabel(d) })),
    });
  }

  // ⑥ 담당자 알림 번호 — 회차마다 보내기 전 문안 · 대상 수를 이 번호로 알린다
  if (f.adminPhoneMissing) {
    out.push({
      id: 'admin_phone', kind: 'text', required: true,
      label: '회차 알림을 받을 휴대폰 번호를 알려 주세요.',
      help: '보내기 전에 그날 문안과 대상 수를 이 번호로 알려 드려요.',
      placeholder: '휴대폰 번호',
      maxLength: 13,
    });
  }
  return out;
}

/** 답이 고칠 값(부르는 쪽이 보관본에 반영한다) */
export interface OperatorAnswerPatch {
  /** ① 말 → 고른 칸 */
  fields: Record<string, string>;
  /** ② · ③ 고른 축 */
  segmentKey?: string;
  /** ③ 매월로 */
  schedule?: 'monthly';
  /** ④ undefined = 묻지 않음 · null = 혜택 없이 */
  benefit?: string | null;
  callback?: string;
  adminPhone?: string;
}

/**
 * 날짜를 가리키는 말(연월일 · 월일) — 회차마다 같은 글이 나가면 지나간 날짜가 된다.
 *   「이번 주 · 오늘만 · N일간」은 회차 기준 상대 말이라 넣지 않는다. 연 1회(yearly)는 월일이 해마다 맞아 연월일만.
 */
const DATED_YMD_RE = /(?<!\d)\d{4}\s*(?:[.\-/]|년)\s*\d{1,2}\s*(?:[.\-/]|월)\s*\d{1,2}\s*일?(?!\d)/g;
const DATED_MD_RE = /(?<!\d)\d{1,2}\s*월\s*\d{1,2}\s*일/g;
export function datedTerms(text: string, schedule?: string | null): string[] {
  const t = String(text || '');
  const out: string[] = [];
  const add = (w: string) => { const v = w.replace(/\s+/g, ' ').trim(); if (v && !out.includes(v)) out.push(v); };
  for (const m of t.matchAll(DATED_YMD_RE)) add(m[0]);
  if (schedule !== 'yearly') for (const m of t.replace(DATED_YMD_RE, ' ').matchAll(DATED_MD_RE)) add(m[0]);
  return out;
}

/** (순수) 회차 문안을 만들 목표 — 날짜를 가리키는 말을 뺀다(원문은 보존 · 생성 입력에서만) */
export function objectiveForRounds(objective: string, schedule?: string | null): string {
  let t = String(objective || '');
  for (const w of datedTerms(t, schedule)) t = t.split(w).join(' ');
  return t.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

/** (순수) 서버가 보관한 질문표로만 답을 검증한다 — 질문표 밖 답은 버린다 */
export function decideOperatorAnswers(
  questions: OperatorQuestion[],
  answers: LineAnswers,
): { ok: true; patch: OperatorAnswerPatch } | { ok: false; error: string } {
  const patch: OperatorAnswerPatch = { fields: {} };
  for (const q of questions) {
    const a = pickAnswer(q, answers || {});
    if (!a.ok) return a;
    const v = a.value;
    if (q.id.startsWith('field:')) patch.fields[q.id.slice('field:'.length)] = v;
    else if (q.id === 'audience') {
      const [key, then] = v.slice('axis:'.length).split('|');
      patch.segmentKey = key;
      if (then === 'monthly') patch.schedule = 'monthly';   // 짝에 막힌 대상을 고르면 매월로(보기 글에 적혀 있다)
    } else if (q.id === 'schedule') {
      if (v === 'monthly') patch.schedule = 'monthly';
      else patch.segmentKey = v.slice('axis:'.length);
    } else if (q.id === 'benefit') {
      const dated = datedTerms(v);
      if (dated.length > 0) return { ok: false, error: `혜택 글의 「${dated[0]}」은(는) 회차마다 지나가는 날짜예요. 날짜는 빼고 적어 주세요.` };
      patch.benefit = v || null;
    } else if (q.id === 'callback') patch.callback = v;
    else if (q.id === 'admin_phone') {
      const d = v.replace(/\D/g, '');
      if (!/^01\d{8,9}$/.test(d)) return { ok: false, error: '휴대폰 번호를 다시 확인해 주세요.' };
      patch.adminPhone = d;
    }
  }
  return { ok: true, patch };
}
