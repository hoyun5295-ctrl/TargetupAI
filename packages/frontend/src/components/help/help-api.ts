/**
 * help-api.ts — 도움말 API 얇은 미러 (★ 2026-08-22). 본문·판정은 전부 서버가 준다.
 * ⛔ 프론트가 요금제를 읽어 노출을 판정하지 않는다(판정이 두 벌이 된다). `eligible`만 믿는다.
 */

export interface HelpJob {
  id: string;
  title: string;
  goal: string;
  keywords: string[];
  steps: string[];
  blockers: { symptom: string; fix: string }[];
  /** `open` = 그 화면에서 열어야 하는 모달의 열쇠(쿼리). 화면 자체가 목적지면 없다 */
  entry: { path: string; via: string; open?: string };
  planKey: string | null;
  creditSource: string | null;
  related: string[];
  status: 'ready' | 'stub';
  /** 이 회사 요금제에서 잠겨 있는가(서버 판정) */
  locked: boolean;
}

export interface HelpContext {
  eligible: boolean;
  mode?: 'onboarding' | 'help';
  path?: string;
  here?: HelpJob[];
  starter?: HelpJob[];
  wizard?: { available: boolean; step: number | null; completed: boolean };
}

export interface HelpAskResult {
  answered: boolean;
  answer: string;
  /** 정의를 그대로 낸 답. answer는 비어 있고 jobs[0]이 답이다(서버가 판정) */
  direct: boolean;
  jobs: HelpJob[];
}

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });

export async function fetchHelpContext(path: string): Promise<HelpContext> {
  const res = await fetch(`/api/help/context?path=${encodeURIComponent(path)}`, { headers: auth() });
  if (!res.ok) return { eligible: false };
  const json = await res.json();
  return json?.success ? json : { eligible: false };
}

/** 직전 문답 한 쌍. 후속 질문("그게 안 되는데요")을 서버가 문맥으로 이해하게 한다(★2026-08-24) */
export interface HelpTurn { q: string; a: string }

export async function askHelp(question: string, path: string, history?: HelpTurn[]): Promise<HelpAskResult> {
  const res = await fetch('/api/help/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify({ question, path, history: history && history.length > 0 ? history : undefined }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) throw new Error(json?.error || '답변을 만들지 못했습니다.');
  return { answered: !!json.answered, answer: String(json.answer || ''), direct: !!json.direct, jobs: json.jobs || [] };
}

export async function leaveHelpQuestion(question: string, path: string): Promise<void> {
  const res = await fetch('/api/help/questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify({ question, path }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) throw new Error(json?.error || '문의를 남기지 못했습니다.');
}

export async function fetchHelpCatalog(): Promise<{ groups: { key: string; label: string; jobs: string[] }[]; jobs: HelpJob[] } | null> {
  const res = await fetch('/api/help/catalog', { headers: auth() });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.success ? { groups: json.groups, jobs: json.jobs } : null;
}

export async function fetchHelpJob(id: string): Promise<{ job: HelpJob; related: HelpJob[] } | null> {
  const res = await fetch(`/api/help/catalog/${encodeURIComponent(id)}`, { headers: auth() });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.success ? { job: json.job, related: json.related || [] } : null;
}

/** 런처를 띄우지 않는 화면 — 캔버스가 화면을 소유하는 곳(그 화면 오버레이가 인터럽트 층보다 위다) */
export const HELP_HIDDEN_PREFIXES = ['/dm-builder', '/image-studio', '/login', '/admin', '/onboarding', '/journey-pause', '/payment', '/cafe24'];

/** 경로 비교의 유일한 기준(쿼리·해시·끝 슬래시를 뗀다). 서버 `normalizePath`와 같은 규칙이어야 한다 */
export function normalizeHelpPath(path: string): string {
  const p = String(path || '').split('?')[0].split('#')[0].replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

/**
 * "이 화면 열기"가 실제로 갈 곳. `entry.open`이 있으면 그 화면 위의 모달까지 연다.
 * ⛔ 열쇠는 서버 카탈로그(`entry.open`)가 소유한다. 화면이 지어내지 않는다.
 */
export function helpEntryHref(job: HelpJob): string {
  return job.entry.open ? `${job.entry.path}?${job.entry.open}` : job.entry.path;
}

/**
 * 시작 지점이 **지금 보고 있는 화면 그 자체**인가.
 *
 * ★ 2026-08-24 신설. 봇의 "사용법" 목록은 정의상 `entry.path === 현재 경로`인 작업들이라,
 *   그 카드의 "이 화면 열기"는 제자리 이동이었다. 화면은 그대로인데 패널만 닫혀 미동작으로 보였다
 *   (접수 cmt6qjoqs00umjnot0xph8v2g · 남지현).
 * ⛔ `entry.open`이 있으면 제자리라도 **열 것이 있다** — 여기 해당하지 않는다.
 */
export function isAlreadyHere(job: HelpJob, pathname: string): boolean {
  if (job.entry.open) return false;
  return normalizeHelpPath(job.entry.path) === normalizeHelpPath(pathname);
}

export function isHelpHiddenPath(pathname: string): boolean {
  return HELP_HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
