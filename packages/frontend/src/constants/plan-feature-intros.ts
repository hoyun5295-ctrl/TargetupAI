/**
 * plan-feature-intros.ts — 기능 안내 원장의 화면 쪽 받기 · 그리기 도구
 *
 * ★ 2026-10-07 Harold 「구멍 자체를 만들지 마」: 원장 글(쓰는 순서 · 직접 정할 것 · 지켜 주는 것)과 예시 영상은
 *   이 파일(누구나 받는 화면 코드)에 두지 않는다. 원장 = backend/src/content/plan-feature-intros.ts ·
 *   로그인한 사람에게만 GET /api/plans/feature-intros 가 내려준다(영상 = 잠깐만 유효한 서명 주소).
 *   여기는 받은 값을 한 번 담아 두고(로그인 토큰이 바뀌면 다시) 아이콘 이름을 그림으로 바꿀 뿐이다.
 */
import { useEffect, useState } from 'react';
import {
  BarChart3, Brain, CalendarDays, Eye, FileSpreadsheet, Filter, ImagePlus, LineChart, ListChecks, Mail,
  MessageSquare, PenLine, Plug, Search, Send, Share2, ShieldCheck, Smartphone, Sparkles, Target, Upload, Users, Wand2, Workflow,
  type LucideIcon,
} from 'lucide-react';

/** 최소 요금제 이름 — 요금제 안내 문장(공개 정보)이라 화면에 둔다 · 서버 원장의 PLAN_FEATURE_MIN_PLAN 과 같은 값 */
export const PLAN_FEATURE_MIN_PLAN = '스타터';

const ICONS: Record<string, LucideIcon> = {
  BarChart3, Brain, CalendarDays, Eye, FileSpreadsheet, Filter, ImagePlus, LineChart, ListChecks, Mail,
  MessageSquare, PenLine, Plug, Search, Send, Share2, ShieldCheck, Smartphone, Sparkles, Target, Upload, Users, Wand2, Workflow,
};
const iconOf = (name: unknown): LucideIcon => ICONS[String(name)] || Sparkles;

export interface PlanFeatureIntro {
  id: string;
  title: string;
  summary: string;
  icon: LucideIcon;
  gradient: string;
  path?: string;
  steps: { icon: LucideIcon; title: string; text: string }[];
  costs: { label: string; source: string; credits: number }[];
  costNote?: string;
  video?: { src: string; poster: string };
  options?: { title: string; text: string; chips?: string[]; wide?: boolean }[];
  safeguards?: { title: string; text: string }[];
  tagline?: string;
}

export interface AboutConfig {
  groups: { key: string; no: string; title: string; sub: string; ids: string[] }[];
  hero: { center: string; left: string; right: string };
  slotIds: string[];
  guards: { id: string; title: string; line: string }[];
}

export interface PlanFeatureIntrosData {
  intros: PlanFeatureIntro[];
  /** 기능 설명 화면 워터마크(미가입 · 무료 체험 회사 · 지정 계정) — 판정 = 서버 */
  watermark: boolean;
  /** /about 구성 — 허용 계정에만 온다 */
  about: AboutConfig | null;
  find: (id: string) => PlanFeatureIntro | null;
  idForPath: (path: string) => string | null;
}

/** 영상 서명 주소 유효 시간(서버 12시간)보다 일찍 다시 받는다 */
const REFRESH_MS = 6 * 3600 * 1000;
let cache: { token: string; at: number; data: PlanFeatureIntrosData } | null = null;
let inflight: { token: string; p: Promise<PlanFeatureIntrosData | null> } | null = null;

function build(raw: any): PlanFeatureIntrosData {
  const intros: PlanFeatureIntro[] = (Array.isArray(raw?.intros) ? raw.intros : []).map((f: any) => ({
    ...f,
    icon: iconOf(f.icon),
    steps: (Array.isArray(f.steps) ? f.steps : []).map((s: any) => ({ ...s, icon: iconOf(s.icon) })),
    costs: Array.isArray(f.costs) ? f.costs : [],
  }));
  const byId = new Map(intros.map((f) => [f.id, f]));
  const byPath = new Map(intros.filter((f) => f.path).map((f) => [f.path as string, f.id]));
  return {
    intros,
    watermark: raw?.watermark === true,
    about: raw?.about && typeof raw.about === 'object' ? raw.about : null,
    find: (id) => byId.get(id) || null,
    idForPath: (p) => byPath.get(p) || null,
  };
}

/** 원장 받기 — 같은 토큰이면 한 번만(동시에 여러 곳이 불러도 요청 하나) · 실패면 null */
export function loadPlanFeatureIntros(): Promise<PlanFeatureIntrosData | null> {
  const token = localStorage.getItem('token') || '';
  if (!token) return Promise.resolve(null);
  if (cache && cache.token === token && Date.now() - cache.at < REFRESH_MS) return Promise.resolve(cache.data);
  if (inflight && inflight.token === token) return inflight.p;
  const p = fetch('/api/plans/feature-intros', { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d?.success) return null;
      const data = build(d);
      cache = { token, at: Date.now(), data };
      return data;
    })
    .catch(() => null)
    .finally(() => { if (inflight?.p === p) inflight = null; });
  inflight = { token, p };
  return p;
}

/** 받은 원장(받는 중이면 null) — 처음 쓰는 화면이 받기를 시작한다 */
export function usePlanFeatureIntros(): PlanFeatureIntrosData | null {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') || '' : '';
  const fresh = cache && cache.token === token ? cache.data : null;
  const [data, setData] = useState<PlanFeatureIntrosData | null>(fresh);
  useEffect(() => {
    let alive = true;
    void loadPlanFeatureIntros().then((d) => { if (alive && d) setData(d); });
    return () => { alive = false; };
  }, [token]);
  return data;
}
