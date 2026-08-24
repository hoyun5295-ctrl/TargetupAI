/**
 * help-answer.ts — 도움말 봇 답변 조립 CT (★ 2026-08-22 신설)
 *
 * 설계 = docs/FEATURE-HELP-CATALOG.md §4-5. 호출부 = routes/help.ts 하나.
 *
 * 환각 차단 4겹 (프롬프트 지시가 아니라 **코드 출구**다)
 *   1. 컨텍스트 = **카탈로그 전체의 공개 필드뿐.** 내부 문서·화면 문구·FEATURE-*.md는 넣지 않는다.
 *      (★2026-08-24 개정 · Harold 확정: 전에는 "매칭 실패 = 모델 호출 0"이었다. 돌려 말한 질문이
 *      정확히 모델이 잘하는 지점인데 그 지점에서 모델을 안 불렀다. 지금은 매칭이 못 찾은 질문도
 *      전체 원장을 들고 모델이 찾는다. 폐집합이라는 사실은 그대로다 — 재료가 카탈로그 밖에 없다.)
 *   2. 응답 계약 = JSON `{jobs: [id...], answer}`. **id가 카탈로그에 실존해야만** 카드가 된다.
 *      jobs가 비면 "모른다"다 — 산문으로 얼버무린 답을 내보내지 않고 문의 남기기로 보낸다.
 *   3. 출구 검사 — 응답 안 모든 `/경로`가 카탈로그 진입 경로 집합에 있는지 · 혜택 토큰(%·원·쿠폰·무료)이 없는지 ·
 *      모델명이 없는지. 하나라도 걸리면 답변을 버리고 후보 카드만으로 되돌린다.
 *   4. 요금제 문구는 모델이 쓰지 않는다 — 라우트가 `canUseFeature`로 판정해 `locked`를 붙이고 화면이 우리 문자열로 그린다.
 *
 * ★ 2026-08-22(2) 답변 틀 고정 (docs §10-1 ③): 본문이 있는 작업이 **분명한 1순위**면 모델을 부르지 않고 그 정의를
 *   카드 그대로 낸다(`direct`). 정의에 적힌 순서를 모델이 산문으로 풀어 쓰면 순서가 뭉개지고 이름을 바꿔 부른다.
 *   모델은 **어느 작업인지 가리기 어려울 때(1·2순위 점수 차가 작을 때)와 본문 없는 작업**에만 쓴다.
 * ★ 2026-08-22(2) 관련 기능은 id가 아니라 **화면 이름(title)** 으로 프롬프트에 넣는다 (docs §10-1 ②).
 *   영문 id(`quick-campaign`)를 넣었더니 모델이 "퀵 캠페인"이라는 없는 이름을 지어냈다. 구현 결함이었다.
 * ★ 2026-08-25 재시도·사유 (docs §10-7 · 0824 운영 실측 "못 답함" 원인 불명 건에서):
 *   계약·출구 위반은 위반 사유를 모델에 되먹여 **같은 호출 안에서 1회만 재시도**한다(확률성 실패가 대부분 여기서 사라진다).
 *   모델이 스스로 모른다고 한 것(no-answer)·한도·호출 실패는 재시도 대상이 아니다.
 *   거절 사유는 **코드로만** 밖으로 나간다 — 외부 오류 원문(모델명이 섞일 수 있다)은 서버 로그에만 남긴다.
 *
 * 과금 = 무료. `CREDIT_COST_MAP`에 등록하지 않는다(미등록 source = 0). 기록만 `ai_call_log`에 `help-ask`로 남긴다(원가 실측).
 * 남용 방지 = 캐시(5분·단발 질문만) · 회사당 일 30회·분 3회(초과 시 잠그지 않고 후보 카드만) · 입력 240자 · 후속 문답 3쌍.
 */
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODELS, isAdaptiveOnlyModel } from '../config/defaults';
import { FEATURE_CATALOG, toPublicJob, normalizePath, type FeatureJob, type PublicFeatureJob } from '../content/feature-catalog';
import { detectBenefits } from './copy-benefit-detector';
import { extractJsonFromAiText } from './ai-json';
import { generateCacheKey, getCachedResponse, setCachedResponse } from './ai-cache';
import { recordAiCall } from './ai-rate-limit';

export const HELP_SOURCE = 'help-ask';

/**
 * 기능 요청 버튼이 `/api/help/questions`로 보내는 **고정 문구** (★2026-08-24 · Harold "기능 요청 구분 표시").
 *
 * 사람이 친 질문이 아니라 버튼이 남기는 기록이라, 질문 이력에서 "못 답함"으로 세면 미답 비율이 오염된다.
 * 판정은 이 레지스트리 하나가 소유한다 — 컬럼을 새로 만들지 않는 이유는 이미 쌓인 행(배포 전 4건)도
 * 같은 기준으로 소급 분류되기 때문이다.
 * ⛔ 새 요청 버튼을 만들면 그 고정 문구를 여기 등록한다. 프론트 문구와 어긋나면 소스 계약 테스트가 잡는다
 *   (`help-answer.test.ts` — AgencySendIntroModal의 문구를 읽어 대조).
 */
export const HELP_REQUEST_PHRASES: readonly string[] = [
  '대행발송 이용을 요청합니다.', // AgencySendIntroModal "이용 요청 남기기"
];

/** 이력의 행 하나가 질문인가 기능 요청인가 */
export function helpQuestionKind(question: string): 'request' | 'question' {
  return HELP_REQUEST_PHRASES.includes(String(question || '').trim()) ? 'request' : 'question';
}
export const HELP_MAX_QUESTION = 240;
export const HELP_DAILY_LIMIT = 30;
export const HELP_MINUTE_LIMIT = 3;
/** 이 점수 이상만 직답 후보다. 미만이어도 모델 경로는 간다(★0824 개정 · 후보 카드 폴백의 문턱으로만 쓴다) */
export const HELP_MATCH_THRESHOLD = 3;
/**
 * 1순위와 2순위 점수 차가 이 값 이상이면 "분명한 1순위"로 보고 모델 없이 정의를 그대로 낸다.
 * 4 = 키워드 하나가 통째로 맞은 만큼의 점수(`matchJobs`). 그보다 작으면 어느 작업인지 모델이 가린다.
 */
export const HELP_DIRECT_MARGIN = 4;

// ────────────── 1. 폐집합 매칭 ──────────────

const norm = (s: string) => String(s || '').toLowerCase().replace(/\s+/g, '');

export interface MatchHit { job: FeatureJob; score: number }

/**
 * 키워드·제목·목적·현재 화면으로 점수를 매긴다. 임베딩을 쓰지 않는다 — 항목이 수십 개라 순회가 더 싸고,
 * "정의를 고쳤는데 벡터가 낡음"이라는 새 실패 모드를 들이지 않는다.
 */
export function matchJobs(question: string, currentPath?: string | null, catalog: readonly FeatureJob[] = FEATURE_CATALOG): MatchHit[] {
  const q = norm(question);
  if (!q) return [];
  const path = currentPath ? normalizePath(currentPath) : null;
  const hits: MatchHit[] = [];
  for (const job of catalog) {
    let score = 0;
    // 키워드 전체 일치 = 가장 강한 신호
    for (const k of job.keywords) {
      const nk = norm(k);
      if (nk && q.includes(nk)) score += 4;
    }
    const nt = norm(job.title);
    if (nt && q.includes(nt)) score += 4;
    // 낱말 단위(키워드·제목의 조각). 활용형("보내요"·"보내는")은 어간(끝 글자를 뺀 형태)으로 한 번 더 본다.
    // 같은 낱말이 여러 키워드에 겹쳐도 한 번만 센다 — 키워드 수로 점수가 부풀지 않게.
    const tokens = new Set<string>();
    for (const k of [...job.keywords, job.title]) for (const w of k.split(/\s+/)) { const nw = norm(w); if (nw.length >= 2) tokens.add(nw); }
    for (const tok of tokens) {
      if (q.includes(tok)) score += 2;
      else if (tok.length >= 3 && q.includes(tok.slice(0, tok.length - 1))) score += 1;
    }
    if (path && job.entry.path === path) score += 1;
    if (score > 0) hits.push({ job, score });
  }
  hits.sort((a, b) => b.score - a.score || (a.job.status === b.job.status ? 0 : a.job.status === 'ready' ? -1 : 1));
  return hits;
}

// ────────────── 2. 프롬프트 ──────────────

/**
 * ★ 2026-08-24(2) 스탠스 개편 (Harold: "너무 원론적이다. 난 챗봇을 만들고 싶었던 것").
 * 전 지시는 역할이 "정의 요약"뿐이라, 모델의 최선이 카드에 이미 있는 순서를 산문으로 다시 읽는 것이었다.
 * 지금은 **카드와 역할을 나눈다**: 순서는 카드가 보여주고, answer는 카드가 못 하는 것(공감·첫 걸음·되묻기·원인 좁히기)을 한다.
 * 되묻기가 성립하는 기반 = 후속 문답 3쌍(§10-6). 폐집합·JSON 계약·출구 검사는 그대로다.
 */
const SYSTEM_PROMPT = [
  '당신은 "한줄로" 서비스의 안내 상담원입니다. 사용자는 마케팅 담당자입니다.',
  '매뉴얼 낭독기가 아닙니다. 화면이 answer 아래에 jobs로 지목한 기능 카드를 그리고, 시작 위치와 순서 전체는 그 카드가 보여줍니다.',
  '그래서 answer에서 순서를 처음부터 끝까지 나열하지 않습니다. answer는 카드가 못 하는 것을 합니다.',
  '',
  '질문 유형에 따라 이렇게 답합니다.',
  '1) 어렵다, 모르겠다, 헷갈린다는 호소: 공감을 한 문장으로 하고, 지금 할 가장 쉬운 첫 걸음 하나만 짚고, 어디서 막혔는지 구체적인 선택지 두세 개로 되묻습니다.',
  '2) 방법 질문: 핵심 요지만 한두 문장으로 말하고, 자세한 순서는 아래 카드를 보라고 안내합니다.',
  '3) 안 된다는 신고: [기능 정의]의 blockers에서 가능성 높은 원인을 한두 개 골라, 무엇을 확인하면 되는지 알려줍니다.',
  '4) 앞 문답에 이어진 질문: 되물었던 그 지점만 깊게 답합니다. 이미 한 말을 반복하지 않습니다.',
  '되물을 때도 이야기한 기능의 id를 jobs에 담습니다.',
  '',
  '아래 [기능 정의]에 적힌 내용만으로 답합니다. 정의에 없는 기능·화면·버튼·조건을 말하지 않습니다.',
  '할인율·금액·쿠폰·무료 같은 혜택 수치를 만들지 않습니다. 요금제 이름이나 가격을 말하지 않습니다.',
  'answer에 화면 주소나 영문 id를 쓰지 않습니다. 갈 화면은 jobs 배열의 id가 가리키고, 화면이 그 카드에 이동 버튼을 답니다.',
  '기능을 부를 때는 [기능 정의]의 title과 related에 적힌 이름을 글자 그대로 씁니다. 이름을 줄이거나 바꾸거나 새로 짓지 않습니다.',
  '질문이 여러 기능에 걸치면 순서대로 엮어 안내합니다.',
  'answer는 한국어 존댓말, 5문장 이내, 긴 줄표·이모지·영어 약어 없이, 누를 것은 큰따옴표로 표시합니다.',
  '내부 시스템·모델·데이터베이스 이름을 말하지 않습니다.',
  '',
  '출력은 JSON 하나만 냅니다. 다른 글자를 붙이지 않습니다.',
  '{"jobs": ["안내에 쓴 기능의 id(관련도 순, 최대 3개)"], "answer": "안내 문장"}',
  '[기능 정의]에 답이 없으면 {"jobs": [], "answer": ""}를 냅니다. 비슷해 보이는 답을 지어내지 않습니다.',
].join('\n');

/** 관련 작업 id → 화면 이름. 모델에게 id를 보여주면 그것을 한국어로 옮기며 없는 이름을 짓는다 */
function relatedTitles(ids: string[], catalog: readonly FeatureJob[]): string[] {
  return ids.map((id) => catalog.find((c) => c.id === id)?.title).filter((t): t is string => !!t);
}

/**
 * 카탈로그 전체를 모델이 읽는 형태로 직렬화한다.
 *
 * ★ 2026-08-24 (Harold 확정 · Sonnet 5): 전에는 매칭된 후보 3개만 user 메시지에 넣었다. 지금은
 *   **전체 정의를 system에** 넣는다. system은 안정 문자열이라 프롬프트 캐시가 적중하고(5분 창),
 *   돌려 말한 질문·여러 기능을 엮는 질문도 원장 전체에서 찾을 수 있다.
 * ⛔ 회사별 값(잠금·요금제)은 넣지 않는다 — 답은 회사와 무관해야 응답 캐시를 전 회사가 공유하고,
 *   요금제 문구는 라우트가 `locked`로 붙인다(4겹의 4).
 * ⛔ keywords를 포함한다 — 사용자 어휘와 우리 용어의 간극을 메우는 필드라, 모델의 매칭이 이것에 기댄다.
 */
export function buildCatalogSystem(catalog: readonly FeatureJob[] = FEATURE_CATALOG): string {
  const defs = catalog.map((j) => ({
    id: j.id,
    title: j.title,
    goal: j.goal,
    keywords: j.keywords,
    entry: { via: j.entry.via },
    steps: j.steps,
    blockers: j.blockers,
    related: relatedTitles(j.related, catalog),
    status: j.status === 'stub' ? '본문 없음(제목·목적·시작 위치만 있음)' : '본문 있음',
  }));
  return `${SYSTEM_PROMPT}\n\n[기능 정의] ${JSON.stringify(defs)}`;
}

/** 후속 대화 한 쌍(화면이 보낸 이전 문답). 서버는 길이만 자르고 내용은 믿지 않는다 — 최종 방어는 출구 검사다 */
export interface HelpTurn { q: string; a: string }
export const HELP_MAX_HISTORY = 3;
export const HELP_MAX_HISTORY_ANSWER = 600;

export function buildHelpMessages(question: string, currentPath?: string | null, history?: HelpTurn[]) {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const t of (history || []).slice(-HELP_MAX_HISTORY)) {
    const q = String(t?.q || '').trim().slice(0, HELP_MAX_QUESTION);
    const a = String(t?.a || '').trim().slice(0, HELP_MAX_HISTORY_ANSWER);
    if (!q || !a) continue;
    messages.push({ role: 'user', content: q });
    messages.push({ role: 'assistant', content: a });
  }
  const user = [
    currentPath ? `[지금 보고 있는 화면] ${currentPath}` : '',
    `[질문] ${question}`,
  ].filter(Boolean).join('\n');
  messages.push({ role: 'user', content: user });
  return messages;
}

// ────────────── 3. 출구 검사 ──────────────

const MODEL_NAME_RE = /opus|sonnet|haiku|gpt|claude|anthropic/i;

export interface ExitCheck { ok: boolean; reason?: string }

/** 응답 본문이 폐집합을 벗어났는가. 걸리면 답변을 버린다 */
export function checkAnswer(text: string, allowedPaths: Set<string>): ExitCheck {
  if (!text || !text.trim()) return { ok: false, reason: 'empty' };
  if (MODEL_NAME_RE.test(text)) return { ok: false, reason: 'model-name' };
  // 경로처럼 보이는 토큰 전부가 허용 집합 안이어야 한다
  const paths = text.match(/\/[a-z][a-z0-9-]*(?:\/[a-z0-9:-]+)*/gi) || [];
  for (const p of paths) {
    if (!allowedPaths.has(normalizePath(p))) return { ok: false, reason: `path:${p}` };
  }
  const benefits = detectBenefits(text);
  if (benefits.hasBenefit) return { ok: false, reason: `benefit:${benefits.tokens.join(',')}` };
  // 긴 줄표(U+2014)는 "AI 티 1순위"라 답변에서 막는다. 리터럴을 소스에 두면 줄표 불변식 테스트에 걸리므로 코드 포인트로 만든다
  if (text.includes(String.fromCharCode(0x2014))) return { ok: false, reason: 'dash' };
  return { ok: true };
}

export function allowedPathSet(catalog: readonly FeatureJob[] = FEATURE_CATALOG): Set<string> {
  return new Set(catalog.map((j) => j.entry.path));
}

// ────────────── 4. 호출 제한(도움말 전용 소한도) ──────────────

interface Bucket { day: string; dayCount: number; minute: number; minuteCount: number }
const buckets = new Map<string, Bucket>();

/** 초과하면 false. 잠그지 않고 호출부가 후보 카드만 돌려준다 */
export function takeHelpQuota(companyId: string, now: Date = new Date()): boolean {
  const day = now.toISOString().slice(0, 10);
  const minute = Math.floor(now.getTime() / 60000);
  const b = buckets.get(companyId) || { day, dayCount: 0, minute, minuteCount: 0 };
  if (b.day !== day) { b.day = day; b.dayCount = 0; }
  if (b.minute !== minute) { b.minute = minute; b.minuteCount = 0; }
  if (b.dayCount >= HELP_DAILY_LIMIT || b.minuteCount >= HELP_MINUTE_LIMIT) { buckets.set(companyId, b); return false; }
  b.dayCount += 1; b.minuteCount += 1;
  buckets.set(companyId, b);
  return true;
}

/** 테스트용 */
export function resetHelpQuota(): void { buckets.clear(); }

// ────────────── 5. 모델 호출 ──────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });
const MAX_TOKENS = 800; // JSON 래핑 여유. 잘리면 파싱이 실패해 답을 버리므로 부족보다 여유가 낫다

export interface HelpAnswer {
  answered: boolean;
  /** answered=false거나 direct면 빈 문자열 */
  answer: string;
  /**
   * 정의를 그대로 낸다. answer는 비어 있고 jobs[0]이 답이다 — 화면은 그 카드를 펼쳐 보여준다.
   * 본문 있는 작업이 분명한 1순위일 때만 true(HELP_DIRECT_MARGIN).
   */
  direct: boolean;
  /** 매칭된 작업(공개 필드). 화면이 카드로 그린다 */
  jobs: PublicFeatureJob[];
  /** 모델을 불렀는가(원가 실측·디버그) */
  usedModel: boolean;
  /** 거절 사유 코드(★0825 질문 이력·PM2 로그가 같이 쓴다). 외부 오류 원문은 담지 않는다 — 라벨 변환 = helpReasonLabel */
  reason?: string;
}

/** 본문 있는 작업이 분명한 1순위인가. 1개뿐이거나 2순위와 점수 차가 여유 이상이면 모델 없이 정의를 낸다 */
export function isDirectHit(top: MatchHit[]): boolean {
  if (top.length === 0 || top[0].job.status !== 'ready') return false;
  if (top.length === 1) return true;
  return top[0].score - top[1].score >= HELP_DIRECT_MARGIN;
}

/**
 * 모델 응답(JSON 계약)을 검증해 카드와 답으로 바꾼다. **id 실존이 카드의 조건이다** — 모델이 지어낸
 * id는 조용히 버리고, 남는 카드가 없으면 답 전체를 버린다(안내문만 있고 갈 곳 없는 답은 절반짜리다).
 * ★0825 사유를 가른다 — `no-answer`(모델이 계약대로 "모른다"를 낸 것 · 위반이 아니라 재시도 안 함) vs
 * `no-grounded-job`(안내문은 있는데 근거 카드가 없거나 지어낸 id뿐 · 위반이라 재시도 대상).
 */
export function parseModelAnswer(
  text: string, catalog: readonly FeatureJob[],
): { ok: boolean; reason?: string; jobs: PublicFeatureJob[]; answer: string } {
  let parsed: any;
  try {
    parsed = extractJsonFromAiText(text);
  } catch {
    return { ok: false, reason: 'json', jobs: [], answer: '' };
  }
  const answer = typeof parsed?.answer === 'string' ? parsed.answer.trim() : '';
  const ids: string[] = Array.isArray(parsed?.jobs) ? parsed.jobs.filter((v: any) => typeof v === 'string') : [];
  const jobs = ids
    .map((id) => catalog.find((j) => j.id === id))
    .filter((j): j is FeatureJob => !!j)
    .slice(0, 3)
    .map((j) => toPublicJob(j));
  if (ids.length === 0 && !answer) return { ok: false, reason: 'no-answer', jobs: [], answer: '' };
  if (jobs.length === 0 || !answer) return { ok: false, reason: 'no-grounded-job', jobs: [], answer: '' };
  return { ok: true, jobs, answer };
}

/**
 * 거절 사유 코드 → 질문 이력 화면(ceo 전용)의 한글 라벨. 소유는 이 CT 하나다 — 화면이 코드를 해석하지 않는다.
 * 사유 코드에 외부 오류 원문은 없다(answerHelpQuestion이 `model-error` 코드로만 접는다).
 */
export function helpReasonLabel(reason?: string | null): string | null {
  if (!reason) return null;
  if (reason === 'quota') return '질문 한도 초과';
  if (reason.startsWith('model-error')) return 'AI 호출 실패';
  if (reason === 'contract:json') return '응답 형식 위반';
  if (reason === 'contract:no-answer') return '원장에 답 없음';
  if (reason === 'contract:no-grounded-job') return '기능 지목 실패';
  if (reason.startsWith('exit:path')) return '경로 표기 차단';
  if (reason.startsWith('exit:benefit')) return '혜택 표현 차단';
  if (reason.startsWith('exit:model-name')) return '내부 명칭 차단';
  if (reason.startsWith('exit:dash')) return '표기 규칙 차단';
  if (reason.startsWith('exit:')) return '출구 검사 차단';
  return reason;
}

/**
 * help_questions 접근 오류 분류 (★0825 · Codex 적대 1R high 정정 — 소비처 = routes/help.ts · routes/admin.ts).
 *
 * ⛔ 문자열 포함 순서로 가르면 안 된다 — PG의 42703 INSERT 메시지는
 *   column "reason" of relation "help_questions" does not exist 형태라 'relation'·'does not exist' 판정에도 걸려,
 *   컬럼 부재가 테이블 부재로 오인되고 레거시 INSERT 폴백에 영영 못 간다(코드 선배포·ALTER 후실행 창에서
 *   /ask 이력이 조용히 유실되고 /questions가 테이블이 있는데도 503을 낸다).
 * 판정은 SQLSTATE가 1순위(42703=undefined_column · 42P01=undefined_table)이고, 코드가 벗겨진 래핑 오류만
 * 메시지 폴백을 타되 column을 먼저 본다.
 */
export type HelpDbErrorKind = 'missing-relation' | 'missing-column' | 'other';
export function classifyHelpDbError(err: any): HelpDbErrorKind {
  const code = String(err?.code || '');
  if (code === '42703') return 'missing-column';
  if (code === '42P01') return 'missing-relation';
  if (code) return 'other'; // 다른 SQLSTATE가 확정돼 있으면 메시지로 재해석하지 않는다
  const msg = String(err?.message || '');
  if (!msg.includes('does not exist')) return 'other';
  if (msg.includes('column')) return 'missing-column';
  if (msg.includes('relation')) return 'missing-relation';
  return 'other';
}

/**
 * 위반 사유를 모델에 되먹이는 재시도 문구 (★0825 · 원칙 = 거절 사유는 모델과 로그 양쪽으로 흘린다).
 * 대상은 계약·출구 위반뿐이다 — 스스로 "모른다"고 한 답(no-answer)·한도·호출 실패는 재시도하지 않는다.
 */
function retryFeedback(reason: string): string {
  if (reason === 'contract:json') {
    return '방금 응답은 JSON 형식이 아니었습니다. 다른 글자 없이 {"jobs": ["기능 id"], "answer": "안내 문장"} JSON 하나만 다시 출력하세요.';
  }
  if (reason === 'contract:no-grounded-job') {
    return '방금 응답의 jobs가 비었거나 [기능 정의]에 없는 id였습니다. 안내에 쓴 기능의 id를 [기능 정의]에 있는 그대로 jobs에 담아 같은 안내를 다시 출력하세요. 정말 답할 수 없으면 {"jobs": [], "answer": ""}만 출력하세요.';
  }
  if (reason.startsWith('exit:path')) {
    return '방금 답에 화면 주소가 있었습니다. 주소 없이 같은 안내를 다시 출력하세요. 이동은 jobs의 id가 대신합니다.';
  }
  if (reason.startsWith('exit:benefit')) {
    return '방금 답에 할인·금액·쿠폰·무료 같은 혜택 표현이 있었습니다. 혜택 표현 없이 같은 안내를 다시 출력하세요.';
  }
  if (reason.startsWith('exit:model-name')) {
    return '방금 답에 내부 시스템 이름이 있었습니다. 그 단어 없이 같은 안내를 다시 출력하세요.';
  }
  if (reason.startsWith('exit:dash')) {
    return '방금 답에 긴 줄표 문자가 있었습니다. 줄표 없이 같은 안내를 다시 출력하세요.';
  }
  return '방금 응답이 출력 규칙을 어겼습니다. [기능 정의]와 출력 규칙을 지켜 같은 안내를 다시 출력하세요.';
}

export async function answerHelpQuestion(opts: {
  companyId: string;
  question: string;
  currentPath?: string | null;
  /** 화면이 보낸 직전 문답(후속 질문 이해용). 내용은 믿지 않는다 — 출구 검사가 최종 방어다 */
  history?: HelpTurn[];
  catalog?: readonly FeatureJob[];
  /** 테스트 주입 */
  callModel?: (system: string, messages: { role: 'user' | 'assistant'; content: string }[]) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}): Promise<HelpAnswer> {
  const catalog = opts.catalog || FEATURE_CATALOG;
  const question = String(opts.question || '').trim().slice(0, HELP_MAX_QUESTION);
  const hits = matchJobs(question, opts.currentPath, catalog);
  const top = hits.filter((h) => h.score >= HELP_MATCH_THRESHOLD).slice(0, 3);
  const fallbackJobs = hits.slice(0, 3).map((h) => toPublicJob(h.job));
  const history = (opts.history || []).slice(-HELP_MAX_HISTORY);

  // 답변 틀 고정: 본문 있는 작업이 분명한 1순위면 정의를 그대로 낸다. 모델 호출 0 · 한도 소모 0 · 출구 검사 불요(우리 문장이다)
  // ⛔ 후속 대화 중에는 직답을 건너뛴다 — "그게 안 되는데요"가 앞 문답 없이 새 매칭으로 잡히면 엉뚱한 카드가 나온다.
  if (history.length === 0 && isDirectHit(top)) {
    return { answered: true, answer: '', direct: true, jobs: top.map((h) => toPublicJob(h.job)), usedModel: false };
  }

  // ★ 2026-08-24 (Harold 확정): 매칭 실패도 여기로 온다. 전에는 이 자리에서 "no-match"로 끝났다 —
  //   돌려 말한 질문이 정확히 모델이 잘하는 지점인데 그 지점에서 모델을 안 불렀다.
  //   폐집합은 그대로다: 모델이 받는 재료도, 낼 수 있는 카드도 카탈로그뿐이다(2겹 · parseModelAnswer).
  if (!takeHelpQuota(opts.companyId)) return { answered: false, answer: '', direct: false, jobs: fallbackJobs, usedModel: false, reason: 'quota' };

  const system = buildCatalogSystem(catalog);
  const messages = buildHelpMessages(question, opts.currentPath, history);
  // 답은 회사와 무관하다(요금제 판정은 라우트가 따로 붙인다) — 캐시를 전 회사가 공유한다.
  // ⛔ 후속 대화는 캐시하지 않는다 — 히스토리가 키에 섞이면 적중이 0에 수렴하고, 빼면 남의 문맥 답이 나온다.
  const cacheKey = history.length === 0 ? generateCacheKey('help-global', system, messages[messages.length - 1].content) : null;
  if (cacheKey) {
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      const p = parseModelAnswer(cached, catalog);
      if (p.ok && checkAnswer(p.answer, allowedPathSet(catalog)).ok) {
        return { answered: true, answer: p.answer, direct: false, jobs: p.jobs, usedModel: false };
      }
    }
  }

  // ★0825 계약·출구 위반은 위반 사유를 되먹여 1회만 재시도한다. 확률성 실패(JSON 흘림·id 누락·표기 위반)가
  //   대부분 2회차에서 통과한다. 호출 실패·"모른다"(no-answer)는 재시도 대상이 아니다.
  const call = opts.callModel || callAnthropic;
  let convo = messages;
  let reason = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      const r = await call(system, convo);
      text = r.text; inputTokens = r.inputTokens; outputTokens = r.outputTokens;
    } catch (err: any) {
      // 원문(모델 id가 섞일 수 있다)은 서버 로그에만 — 밖으로는 코드 하나
      console.error('[help] 모델 호출 실패:', err?.message || err);
      await recordAiCall({ companyId: opts.companyId, source: HELP_SOURCE, modelType: 'sonnet', success: false });
      return { answered: false, answer: '', direct: false, jobs: fallbackJobs, usedModel: true, reason: 'model-error' };
    }
    await recordAiCall({ companyId: opts.companyId, source: HELP_SOURCE, modelType: 'sonnet', inputTokens, outputTokens, costWon: 0 });

    // 2겹: JSON 계약 + id 실존. 모델이 "모른다"(jobs·answer 모두 빈 값)면 지어내지 않은 것이다 — 문의 남기기로 보낸다
    const parsed = parseModelAnswer(text, catalog);
    if (parsed.ok) {
      // 3겹: 출구 검사
      const check = checkAnswer(parsed.answer, allowedPathSet(catalog));
      if (check.ok) {
        if (cacheKey) setCachedResponse(cacheKey, text);
        return { answered: true, answer: parsed.answer, direct: false, jobs: parsed.jobs, usedModel: true };
      }
      reason = `exit:${check.reason}`;
    } else {
      reason = `contract:${parsed.reason}`;
    }
    if (reason === 'contract:no-answer') break; // 계약을 지킨 "모른다" — 위반이 아니다
    if (attempt === 1) {
      convo = [...convo];
      if (text.trim()) convo.push({ role: 'assistant', content: text });
      convo.push({ role: 'user', content: retryFeedback(reason) });
    }
  }
  return { answered: false, answer: '', direct: false, jobs: fallbackJobs, usedModel: true, reason };
}

async function callAnthropic(
  system: string, messages: { role: 'user' | 'assistant'; content: string }[],
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const modelId = AI_MODELS.claude; // = Sonnet 5 (Harold 2026-08-24 확정. 이 안내 축은 모델 경로가 어려운 꼬리만 받는다)
  const adaptiveGuard: any = isAdaptiveOnlyModel(modelId) ? { thinking: { type: 'disabled' } } : {};
  const response: any = await anthropic.messages.create({
    model: modelId,
    max_tokens: MAX_TOKENS,
    // system = 지시 + 카탈로그 전체(안정 문자열). cache_control로 5분 캐시 — 두 번째 질문부터 입력 원가가 1/10이다
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } } as any],
    messages,
    ...adaptiveGuard,
  } as any);
  const text = (response.content || []).find((b: any) => b?.type === 'text')?.text || '';
  const usage = response.usage || {};
  const cacheRead = Number(usage.cache_read_input_tokens || 0);
  const cacheCreated = Number(usage.cache_creation_input_tokens || 0);
  // 합산 기록으로는 생성(정가 1.25배)과 읽기(정가 0.1배)가 안 갈린다 — 내역은 PM2 로그로(services/ai.ts와 같은 방식)
  console.log(`[help] 모델 호출 (Cache · read ${cacheRead}, created ${cacheCreated}, in ${usage.input_tokens || 0}, out ${usage.output_tokens || 0})`);
  return {
    text,
    // ★0825 캐시 "생성"분(cache_creation)도 합산한다 — 0824 실측에서 이 값(질문당 약 2.9만 토큰, 가장 비싼 부분)이
    //   기록에서 통째로 빠져 원가 실측 원장이 실제보다 적게 적히고 있었다. 원장 목적 = 원가 실측(docs §4-7).
    inputTokens: Number(usage.input_tokens || 0) + cacheRead + cacheCreated,
    outputTokens: Number(usage.output_tokens || 0),
  };
}
