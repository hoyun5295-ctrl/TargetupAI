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
  entry: { path: string; via: string };
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
  jobs: HelpJob[];
}

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });

export async function fetchHelpContext(path: string): Promise<HelpContext> {
  const res = await fetch(`/api/help/context?path=${encodeURIComponent(path)}`, { headers: auth() });
  if (!res.ok) return { eligible: false };
  const json = await res.json();
  return json?.success ? json : { eligible: false };
}

export async function askHelp(question: string, path: string): Promise<HelpAskResult> {
  const res = await fetch('/api/help/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify({ question, path }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) throw new Error(json?.error || '답변을 만들지 못했습니다.');
  return { answered: !!json.answered, answer: String(json.answer || ''), jobs: json.jobs || [] };
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

export function isHelpHiddenPath(pathname: string): boolean {
  return HELP_HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
