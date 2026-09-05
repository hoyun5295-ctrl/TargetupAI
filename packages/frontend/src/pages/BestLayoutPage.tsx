/**
 * BestLayoutPage.tsx — 베스트 구성 (참조 골격 학습층 · ceo 전용 · 2026-09-03)
 *
 * 설계 = docs/2026-09-03-reference-skeleton-learning-design.md §8. 베스트 문안(직원 공용 · 문안 학습)과 짝을 이루는
 * 구성 학습 화면: 직원이 완성한 모바일 DM·이메일 실물의 **섹션 골격(타입 순서·통계)** 을 올리고, 자동 생성에 적용(서빙)을 켠다.
 *   - 열람 = 서버 게이트(BEST_LAYOUT_VIEWER_IDS 기본 ceo). 403이면 안내 화면(AiTrainingDataPage 선례).
 *   - 참조 골격 패널은 섹션 타입 순서·통계만 그린다(문구·이미지·브랜드명 없음). 유형 라벨은 사람 말로만(개발 용어 0).
 *   - ★2026-09-05 실물 예시 패널(AI 영업 학습)은 **서버가 마스킹한 본문**만 그린다(브랜드·상품·수치·링크·연락처 0 · 원문 미표시).
 *     단축코드 붙여넣기 → 찾기 → DM·이메일 후보 체크 + 업종 → 올리기. 삭제는 두 번 클릭(native dialog 0).
 *   - 서빙 토글 기본 off. 켜기 전까지 자동 생성은 지금과 같다.
 * native dialog 0(useToast), 모델명 미노출, 백드롭 클릭 닫힘 없음(X·취소·ESC).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import { ArrowLeft, Check, Loader2, Lock, Plus, RefreshCw, Sparkles, X } from 'lucide-react';
import { useToast } from '../components/ToastProvider';

type SkeletonChannel = 'DM' | 'EMAIL';
type SkeletonAuthorType = 'media' | 'catalog';
interface SkeletonChainInfo {
  seq: string[]; authorType: SkeletonAuthorType; authorTypeSource: 'auto' | 'human'; src: string;
  refKind: string | null; refId: string | null; promotedAt: string | null;
}
interface SkeletonStatsInfo {
  n: number; len: { p50: number; min: number; max: number };
  opening: Array<[string, string, number]>; closing: Array<[string, number]>;
  repeat: Record<string, { p50: number; max: number }>; freq: Record<string, number>;
  cta: { p50: number; max: number }; text_card: { p50: number; max: number }; by_type: Record<string, number>;
}
interface SkeletonInfo {
  id: string; industryCode: string; channel: SkeletonChannel; content: string; stats: SkeletonStatsInfo;
  serving: { enabled: boolean; enabled_by: string | null; enabled_at: string | null };
  chains: SkeletonChainInfo[]; createdAt: string;
}
interface SkeletonCandidate {
  id: string; title: string; createdBy: string | null; createdAt: string; sectionCount: number; types: string[];
  inferredAuthorType: SkeletonAuthorType; aiEdited: boolean; alreadyPromoted: boolean; rejectReason: string | null;
}
interface IndustryInfo { code: string; label: string }
// ★ 2026-09-05 실물 예시(AI 영업 학습) — 서버가 마스킹한 본문만 온다(브랜드·상품·수치·링크·연락처 0)
interface ExampleInfo {
  id: string; channel: SkeletonChannel; industryCode: string; content: string; createdAt: string; chars: number; promotedAt: string | null;
  source: { kind: 'dm' | 'email' | null; title: string; shortCode: string | null; createdBy: string | null };
}
interface ResolvedDmInfo {
  code: string; otherCodes?: string[]; id: string; title: string; storeName: string | null; createdBy: string | null; createdAt: string; sectionCount: number;
  alreadyPromoted: boolean; rejectReason: string | null; preview: string; aliases: string[]; suggestedEmailId: string | null;
}
interface EmailCandidateInfo {
  id: string; name: string; subject: string | null; createdBy: string | null; createdAt: string; sectionCount: number;
  alreadyPromoted: boolean; rejectReason: string | null; preview: string; aliases: string[];
}

const SKELETON_GENERAL = 'general';
const CHANNEL_LABEL: Record<SkeletonChannel, string> = { DM: '모바일 DM', EMAIL: '이메일' };
const TYPE_LABEL: Record<SkeletonAuthorType, string> = { media: '이벤트형', catalog: '상품형' };
const CHIP_MAX = 12;

const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

function TypeChips({ types }: { types: string[] }) {
  return (
    <div className="flex flex-wrap gap-1 flex-1 min-w-0">
      {types.slice(0, CHIP_MAX).map((t, j) => (
        <span key={`${t}-${j}`} className="text-[10px] font-mono bg-white/5 border border-white/10 text-white/70 px-1.5 py-0.5 rounded">{t}</span>
      ))}
      {types.length > CHIP_MAX && <span className="text-[10px] text-white/40">+{types.length - CHIP_MAX}</span>}
    </div>
  );
}

export default function BestLayoutPage() {
  const navigate = useNavigate();
  const toastCtx = useToast();
  // ★ 2026-09-05 toast 컨텍스트 값은 매 토스트마다 신원이 바뀐다 → useCallback 의존성에 넣으면 오류 토스트가 재요청을 부르는 루프가 된다. ref로 고정.
  const toastRef = useRef(toastCtx);
  toastRef.current = toastCtx;
  const toast = useMemo(() => ({
    success: (m: string) => toastRef.current.success(m),
    error: (m: string) => toastRef.current.error(m),
    info: (m: string) => toastRef.current.info(m),
  }), []);

  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [skeletons, setSkeletons] = useState<SkeletonInfo[]>([]);
  const [industries, setIndustries] = useState<IndustryInfo[]>([]);
  const [channel, setChannel] = useState<SkeletonChannel>('DM');
  const [industry, setIndustry] = useState<string>(SKELETON_GENERAL);
  const [toggling, setToggling] = useState(false);

  const [promoteOpen, setPromoteOpen] = useState(false);
  const [candidates, setCandidates] = useState<SkeletonCandidate[]>([]);
  const [candCompany, setCandCompany] = useState<{ id: string; name: string } | null>(null);
  const [candLoading, setCandLoading] = useState(false);
  const [candPicked, setCandPicked] = useState<Set<string>>(new Set());
  const [candTypeOverride, setCandTypeOverride] = useState<Record<string, SkeletonAuthorType>>({});
  const [promoteIndustry, setPromoteIndustry] = useState<string>(SKELETON_GENERAL);
  const [promoting, setPromoting] = useState(false);

  // ★ 2026-09-05 실물 예시(AI 영업 학습) — 단축코드 붙여넣기 → 해석 → 이메일 후보·업종 지정 → 마스킹본 저장
  const [examples, setExamples] = useState<ExampleInfo[]>([]);
  const [exLoading, setExLoading] = useState(false);
  const [exOpen, setExOpen] = useState(false);
  const [exCodes, setExCodes] = useState('');
  const [exResolving, setExResolving] = useState(false);
  const [exResolved, setExResolved] = useState<ResolvedDmInfo[]>([]);
  const [exUnresolved, setExUnresolved] = useState<string[]>([]);
  const [exEmails, setExEmails] = useState<EmailCandidateInfo[]>([]);
  const [exCompany, setExCompany] = useState<{ id: string; name: string | null } | null>(null);
  const [exBulkIndustry, setExBulkIndustry] = useState<string>('etc');
  const [exRowIndustry, setExRowIndustry] = useState<Record<string, string>>({});   // key = dm:<id> | email:<id>
  const [exPicked, setExPicked] = useState<Set<string>>(new Set());                  // key = dm:<id> | email:<id>
  const [exPreviewOpen, setExPreviewOpen] = useState<string | null>(null);
  const [exPromoting, setExPromoting] = useState(false);
  const [exDeleteArmed, setExDeleteArmed] = useState<string | null>(null);
  const [exFilterChannel, setExFilterChannel] = useState<'ALL' | SkeletonChannel>('ALL');

  const loadExamples = useCallback(async () => {
    setExLoading(true);
    try {
      const r = await fetch('/api/admin/best-layout/examples', { headers: authHeader() });
      if (r.status === 403) { setDenied(true); return; }
      const j = await r.json();
      if (j.success) setExamples(j.examples || []);
      else toast.error(j.error || '실물 예시 조회 실패');
    } catch (e: any) {
      toast.error(`실물 예시 조회 실패: ${e?.message || '네트워크 오류'}`);
    } finally {
      setExLoading(false);
    }
  }, [toast]);
  useEffect(() => { void loadExamples(); }, [loadExamples]);

  const openExamples = () => {
    setExOpen(true);
    setExDeleteArmed(null);
    setExCodes('');
    setExResolved([]);
    setExUnresolved([]);
    setExEmails([]);
    setExPicked(new Set());
    setExRowIndustry({});
    setExPreviewOpen(null);
  };

  const resolveCodes = async () => {
    if (exResolving || !exCodes.trim()) return;
    setExResolving(true);
    try {
      const r = await fetch('/api/admin/best-layout/examples/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ codes: exCodes }),
      });
      const j = await r.json();
      if (!j.success) { toast.error(j.error || '단축코드 확인 실패'); return; }
      const resolved: ResolvedDmInfo[] = (j.resolved || []).filter((x: any) => x.dm).map((x: any) => x.dm);
      const unresolved: string[] = (j.resolved || []).filter((x: any) => !x.dm).map((x: any) => String(x.code));
      setExResolved(resolved);
      setExUnresolved([...unresolved, ...((j.invalid || []) as string[])]);
      setExEmails(j.emails || []);
      setExCompany(j.company || null);
      const picked = new Set<string>();
      for (const d of resolved) {
        if (!d.rejectReason && !d.alreadyPromoted) picked.add(`dm:${d.id}`);
        if (d.suggestedEmailId) {
          const e = (j.emails || []).find((x: any) => x.id === d.suggestedEmailId);
          if (e && !e.rejectReason && !e.alreadyPromoted) picked.add(`email:${e.id}`);
        }
      }
      setExPicked(picked);
      if (resolved.length === 0) toast.info('내부 전용 회사에서 찾은 DM이 없습니다. 코드를 확인해주세요.');
    } catch (e: any) {
      toast.error(`단축코드 확인 실패: ${e?.message || '네트워크 오류'}`);
    } finally {
      setExResolving(false);
    }
  };

  const industryFor = (key: string) => exRowIndustry[key] || exBulkIndustry;
  const togglePick = (key: string) => setExPicked((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const submitExamples = async () => {
    if (exPromoting || exPicked.size === 0) return;
    setExPromoting(true);
    try {
      const items = [...exPicked].map((key) => {
        const [kind, id] = key.split(':');
        return { kind, id, industryCode: industryFor(key) };
      });
      const r = await fetch('/api/admin/best-layout/examples/promote', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ items }),
      });
      const j = await r.json();
      if (!j.success) {
        const why: string[] = (j.skipped || []).map((s: any) => s.reason);
        toast.error(`${j.error || '올리기 실패'}${why.length ? ` · ${why.slice(0, 3).join(' / ')}` : ''}`);
        return;
      }
      toast.success(`실물 예시 ${j.added}건을 학습에 올렸습니다${(j.skipped || []).length ? ` · 제외 ${j.skipped.length}건` : ''}`);
      if ((j.skipped || []).length) toast.info((j.skipped as any[]).slice(0, 4).map((s) => s.reason).join(' / '));
      setExOpen(false);
      await loadExamples();
    } catch (e: any) {
      toast.error(`올리기 실패: ${e?.message || '네트워크 오류'}`);
    } finally {
      setExPromoting(false);
    }
  };

  // 삭제 무장은 5초 뒤 자동 해제(오래 전 무장이 다음 클릭에 바로 지우지 않게)
  useEffect(() => {
    if (!exDeleteArmed) return;
    const t = setTimeout(() => setExDeleteArmed(null), 5000);
    return () => clearTimeout(t);
  }, [exDeleteArmed]);

  const deleteExample = async (id: string) => {
    if (exDeleteArmed !== id) { setExDeleteArmed(id); return; }
    setExDeleteArmed(null);
    try {
      const r = await fetch(`/api/admin/best-layout/examples/${id}`, { method: 'DELETE', headers: authHeader() });
      const j = await r.json();
      if (!j.success) { toast.error(j.error || '삭제 실패'); return; }
      toast.success('실물 예시를 학습에서 뺐습니다.');
      await loadExamples();
    } catch (e: any) {
      toast.error(`삭제 실패: ${e?.message || '네트워크 오류'}`);
    }
  };

  const loadSkeletons = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/best-layout/skeleton', { headers: authHeader() });
      if (r.status === 403) { setDenied(true); return; }
      const j = await r.json();
      if (j.success) {
        setSkeletons(j.skeletons || []);
        setIndustries(j.industries || []);
      } else toast.error(`조회 실패: ${j.error || '오류'}`);
    } catch (e: any) {
      toast.error(`조회 실패: ${e?.message || '네트워크 오류'}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { void loadSkeletons(); }, [loadSkeletons]);

  const current = useMemo(
    () => skeletons.find((s) => s.channel === channel && s.industryCode === industry) || null,
    [skeletons, channel, industry],
  );
  const industryLabel = industry === SKELETON_GENERAL ? '업종 공통' : (industries.find((i) => i.code === industry)?.label || industry);
  const countOf = (code: string) => skeletons.filter((s) => s.industryCode === code && s.channel === channel).reduce((a, s) => a + s.stats.n, 0);

  const toggleServing = async () => {
    if (!current || toggling) return;
    setToggling(true);
    try {
      const r = await fetch('/api/admin/best-layout/skeleton/serving', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ industryCode: industry, channel, enabled: !current.serving.enabled }),
      });
      const j = await r.json();
      if (j.success) {
        toast.success(j.enabled ? '자동 생성이 이 골격을 참고합니다.' : '자동 생성은 기본형으로 돌아갑니다.');
        await loadSkeletons();
      } else toast.error(j.error || '적용 설정 실패');
    } catch (e: any) {
      toast.error(`적용 설정 실패: ${e?.message || '네트워크 오류'}`);
    } finally {
      setToggling(false);
    }
  };

  const openPromote = async () => {
    setPromoteOpen(true);
    setPromoteIndustry(industry);
    setCandPicked(new Set());
    setCandTypeOverride({});
    setCandidates([]);
    setCandLoading(true);
    try {
      const r = await fetch(`/api/admin/best-layout/skeleton/candidates?channel=${channel}`, { headers: authHeader() });
      const j = await r.json();
      if (j.success) { setCandidates(j.candidates || []); setCandCompany(j.company || null); }
      else toast.error(j.error || '후보 조회 실패');
    } catch (e: any) {
      toast.error(`후보 조회 실패: ${e?.message || '네트워크 오류'}`);
    } finally {
      setCandLoading(false);
    }
  };

  const submitPromote = async () => {
    if (promoting || candPicked.size === 0) return;
    setPromoting(true);
    try {
      const items = [...candPicked].map((id) => ({ id, authorTypeOverride: candTypeOverride[id] || null }));
      const r = await fetch('/api/admin/best-layout/skeleton/promote', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ channel, industryCode: promoteIndustry, items }),
      });
      const j = await r.json();
      if (!j.success) { toast.error(j.error || '올리기 실패'); return; }
      const previewNotes: string[] = (j.previews || []).flatMap((p: any) => (p.notes || []).map((n: string) => `${p.title}: ${n}`));
      toast.success(`참조 골격 ${j.added}건 추가(중복 ${j.skippedDuplicate}건 · 제외 ${(j.skipped || []).length}건 · 총 ${j.total}건)`);
      if (previewNotes.length) toast.info(`정규화 예고 · ${previewNotes.slice(0, 4).join(' / ')}${previewNotes.length > 4 ? ` 외 ${previewNotes.length - 4}건` : ''}`);
      setPromoteOpen(false);
      setIndustry(promoteIndustry);
      await loadSkeletons();
    } catch (e: any) {
      toast.error(`올리기 실패: ${e?.message || '네트워크 오류'}`);
    } finally {
      setPromoting(false);
    }
  };

  useEffect(() => {
    if (!promoteOpen && !exOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPromoteOpen(false); setExOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [promoteOpen, exOpen]);

  if (denied) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-2xl p-6 text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-white/10 flex items-center justify-center mb-3"><Lock className="w-5 h-5 text-white/60" /></div>
          <div className="text-sm font-semibold">베스트 구성은 열람 권한이 있는 계정만 볼 수 있습니다.</div>
          <button onClick={() => goBackOr(navigate, '/admin')} className="mt-4 text-xs text-white/70 hover:bg-white/10 px-3 py-2 rounded-lg">관리자 홈으로</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* 상단 헤더 */}
      <div className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 flex items-center gap-3">
          <button onClick={() => goBackOr(navigate, '/admin')} className="p-2 rounded-lg hover:bg-white/10 text-white/70" aria-label="뒤로">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold">베스트 구성</div>
            <div className="text-[11px] text-white/45 truncate">직원이 완성한 모바일 DM·이메일의 구성(섹션 순서)을 참조 골격으로 올려 자동 생성에 적용합니다. 문안은 [베스트 문안]이 맡습니다.</div>
          </div>
          <button onClick={() => void loadSkeletons()} className="text-xs text-white/70 hover:bg-white/10 px-3 py-2 rounded-lg flex items-center gap-1.5" aria-label="새로고침">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">새로고침</span>
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-5">
        {/* 채널 · 업종 칩 */}
        <div className="flex flex-wrap items-center gap-2">
          {(['DM', 'EMAIL'] as const).map((ch) => (
            <button
              key={ch}
              onClick={() => setChannel(ch)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                channel === ch ? 'bg-violet-500/30 border-violet-400/50 text-white' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
              }`}
            >
              {CHANNEL_LABEL[ch]}
            </button>
          ))}
          <span className="w-px h-5 bg-white/10 mx-1" />
          {[{ code: SKELETON_GENERAL, label: '업종 공통' }, ...industries].map((ind) => {
            const n = countOf(ind.code);
            return (
              <button
                key={ind.code}
                onClick={() => setIndustry(ind.code)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  industry === ind.code ? 'bg-violet-500/30 border-violet-400/50 text-white' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                }`}
              >
                {ind.label} <span className={`ml-1 ${n > 0 ? 'text-emerald-300' : 'text-white/40'}`}>{n}</span>
              </button>
            );
          })}
        </div>

        {/* 참조 골격 패널 */}
        <div className="p-4 bg-white/5 border border-white/10 rounded-2xl">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm font-semibold flex items-center gap-2 flex-wrap">
              <Sparkles className="w-4 h-4 text-violet-300" /> {CHANNEL_LABEL[channel]} 참조 골격
              <span className="text-[10px] text-white/40">{industryLabel}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {current && (
                <button
                  onClick={toggleServing}
                  disabled={toggling}
                  title="켜면 자동 생성이 이 골격을 참고합니다. 끄면 지금과 같습니다."
                  className="text-xs text-white/80 bg-white/10 hover:bg-white/15 disabled:opacity-40 px-3 py-1.5 rounded-lg flex items-center gap-2"
                >
                  <span className={`w-8 h-4 rounded-full relative transition-colors ${current.serving.enabled ? 'bg-emerald-500/70' : 'bg-white/15'}`}>
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${current.serving.enabled ? 'left-4' : 'left-0.5'}`} />
                  </span>
                  {toggling ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  {current.serving.enabled ? '자동 생성에 적용 중' : '적용 안 함'}
                </button>
              )}
              <button
                onClick={openPromote}
                className="text-xs bg-violet-500/30 hover:bg-violet-500/45 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> 참조 골격 올리기
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>
          ) : current ? (
            <>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  ['표본', `${current.stats.n}건`],
                  ['길이', `보통 ${current.stats.len.p50}개 (${current.stats.len.min}~${current.stats.len.max})`],
                  ['시작', current.stats.opening[0] ? `${current.stats.opening[0][0]} → ${current.stats.opening[0][1]} ${Math.round(current.stats.opening[0][2] * 100)}%` : '-'],
                  ['마감', current.stats.closing[0] ? `${current.stats.closing[0][0]} ${Math.round(current.stats.closing[0][1] * 100)}%` : '-'],
                ].map(([k, v]) => (
                  <div key={k} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                    <div className="text-[10px] text-white/40">{k}</div>
                    <div className="text-xs text-white/85 mt-0.5 truncate" title={v}>{v}</div>
                  </div>
                ))}
              </div>
              <pre className="mt-3 text-xs text-white/70 leading-relaxed whitespace-pre-wrap font-sans">{current.content}</pre>
              <div className="mt-3 space-y-1.5">
                {current.chains.map((c, i) => (
                  <div key={`${c.refId || i}`} className="flex items-start gap-2 flex-wrap bg-black/20 border border-white/5 rounded-xl px-3 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${c.authorType === 'media' ? 'bg-fuchsia-500/20 text-fuchsia-200' : 'bg-cyan-500/20 text-cyan-200'}`}>
                      {TYPE_LABEL[c.authorType]}
                    </span>
                    <TypeChips types={c.seq} />
                    <span className="text-[10px] text-white/35 shrink-0">{c.seq.length}개{c.promotedAt ? ` · ${new Date(c.promotedAt).toLocaleDateString('ko-KR')}` : ''}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-white/40">아직 참조 골격이 없습니다. [참조 골격 올리기]로 직원 실물을 올려주세요.</p>
          )}
          <div className="text-[10px] text-white/30 italic mt-2">
            Data source: best_copy_assets(kind=structure) · 골격은 섹션 순서·통계뿐이며 문구·이미지는 저장하지 않습니다. 켜기 전까지 자동 생성은 지금과 같습니다.
          </div>
        </div>

        {/* ★ 2026-09-05 실물 예시(AI 영업 학습) 패널 — 마스킹본(브랜드·상품·수치 0)만 그린다 */}
        <div className="p-4 bg-white/5 border border-white/10 rounded-2xl">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm font-semibold flex items-center gap-2 flex-wrap">
              <Sparkles className="w-4 h-4 text-fuchsia-300" /> 실물 예시 · AI 영업 학습
              <span className="text-[10px] text-white/40">DM {examples.filter((e) => e.channel === 'DM').length}건 · 이메일 {examples.filter((e) => e.channel === 'EMAIL').length}건</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {(['ALL', 'DM', 'EMAIL'] as const).map((ch) => (
                <button key={ch} onClick={() => setExFilterChannel(ch)}
                  className={`px-2.5 py-1 rounded-full text-[11px] border ${exFilterChannel === ch ? 'bg-fuchsia-500/30 border-fuchsia-400/50 text-white' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}>
                  {ch === 'ALL' ? '전체' : CHANNEL_LABEL[ch]}
                </button>
              ))}
              <button onClick={openExamples} className="text-xs bg-fuchsia-500/30 hover:bg-fuchsia-500/45 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> 실물 예시 올리기
              </button>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-white/45">직원이 만든 모바일 DM·이메일 실물을 브랜드·상품·혜택 수치·링크·연락처를 가린 예시로 저장합니다. AI 영업이 DM·이메일 시안을 만들 때 구성·리듬·톤의 참고로 씁니다(문장은 베끼지 않습니다). 코드에 내장된 예시 19건은 폴백으로 남습니다.</p>
          {exLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>
          ) : examples.length === 0 ? (
            <p className="mt-3 text-xs text-white/40">아직 올린 실물 예시가 없습니다. [실물 예시 올리기]에 단축코드(hlj.kr/…)를 붙여넣어 주세요.</p>
          ) : (
            <div className="mt-3 space-y-1.5">
              {examples.filter((e) => exFilterChannel === 'ALL' || e.channel === exFilterChannel).map((e) => (
                <div key={e.id} className="bg-black/20 border border-white/5 rounded-xl px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${e.channel === 'DM' ? 'bg-cyan-500/20 text-cyan-200' : 'bg-violet-500/20 text-violet-200'}`}>{CHANNEL_LABEL[e.channel]}</span>
                    <span className="text-sm text-white/90 truncate">{e.source.title || '(제목 없음)'}</span>
                    <span className="text-[10px] text-white/40">{industries.find((i) => i.code === e.industryCode)?.label || e.industryCode}</span>
                    <span className="text-[10px] text-white/35">{e.source.createdBy || '-'} · {e.chars}자{e.promotedAt ? ` · ${new Date(e.promotedAt).toLocaleDateString('ko-KR')}` : ''}</span>
                    <div className="ml-auto flex items-center gap-1">
                      <button onClick={() => setExPreviewOpen(exPreviewOpen === e.id ? null : e.id)} className="text-[11px] text-white/60 hover:text-white px-2 py-1 rounded-lg hover:bg-white/10">{exPreviewOpen === e.id ? '접기' : '마스킹본'}</button>
                      <button onClick={() => void deleteExample(e.id)} className={`text-[11px] px-2 py-1 rounded-lg ${exDeleteArmed === e.id ? 'bg-rose-500/30 text-rose-100' : 'text-white/50 hover:text-rose-200 hover:bg-white/10'}`}>
                        {exDeleteArmed === e.id ? '한 번 더 누르면 삭제' : '삭제'}
                      </button>
                    </div>
                  </div>
                  {exPreviewOpen === e.id && <pre className="mt-2 text-[11px] text-white/65 whitespace-pre-wrap font-sans max-h-64 overflow-y-auto">{e.content}</pre>}
                </div>
              ))}
            </div>
          )}
          <div className="text-[10px] text-white/30 italic mt-2">
            Data source: best_copy_assets(kind=outreach_example) · 저장되는 것은 마스킹된 문구 구성뿐입니다. 이미지·링크·원문 브랜드명은 저장하지 않습니다.
          </div>
        </div>
      </div>

      {/* ★ 2026-09-05 실물 예시 올리기 모달 — 단축코드 붙여넣기 → 찾기 → DM·이메일 후보 체크 + 업종 → 올리기 */}
      {exOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-fuchsia-500 to-violet-500 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">실물 예시 올리기</div>
                  <div className="text-[11px] text-white/45 truncate">{exCompany?.name ? `${exCompany.name}의 발행 실물` : '내부 전용 회사의 발행 실물'} · 단축코드(hlj.kr/…)를 줄마다 붙여넣으면 DM을 찾고 같은 회사의 이메일 후보를 보여줍니다</div>
                </div>
              </div>
              <button onClick={() => setExOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/60" aria-label="닫기"><X className="w-4 h-4" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex gap-2 items-start">
                <textarea
                  value={exCodes}
                  onChange={(e) => setExCodes(e.target.value)}
                  rows={4}
                  placeholder={'올리브영 https://hlj.kr/Q59eDMq\n쿠팡 https://hlj.kr/lb0NuGC\n(브랜드명·담당자 표기가 섞여 있어도 코드만 읽습니다)'}
                  className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-fuchsia-500"
                />
                <button onClick={() => void resolveCodes()} disabled={exResolving || !exCodes.trim()}
                  className="shrink-0 px-4 py-2 bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white rounded-lg text-sm flex items-center gap-1.5">
                  {exResolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} 찾기
                </button>
              </div>
              {exUnresolved.length > 0 && <p className="text-[11px] text-amber-300">찾지 못한 코드: {exUnresolved.join(', ')}</p>}

              {exResolved.length > 0 && (
                <>
                  <div className="flex items-center gap-2 flex-wrap text-xs text-white/70">
                    일괄 업종
                    <select value={exBulkIndustry} onChange={(e) => setExBulkIndustry(e.target.value)} className="bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white">
                      {industries.map((ind) => <option key={ind.code} value={ind.code}>{ind.label}</option>)}
                    </select>
                    <span className="text-[11px] text-white/40">행마다 따로 고를 수 있습니다. 업종은 예시를 고를 때의 우선순위(같은 업종군 먼저)에만 쓰입니다.</span>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-white/80">모바일 DM {exResolved.length}건</div>
                    {exResolved.map((d) => {
                      const key = `dm:${d.id}`;
                      const disabled = !!d.rejectReason || d.alreadyPromoted;
                      const checked = exPicked.has(key);
                      return (
                        <div key={key} className={`rounded-xl border px-3 py-2.5 ${disabled ? 'border-white/5 bg-white/[0.02] opacity-60' : checked ? 'border-fuchsia-400/50 bg-fuchsia-500/10' : 'border-white/10 bg-white/5'}`}>
                          <div className="flex items-start gap-3">
                            <input type="checkbox" className="mt-1 accent-fuchsia-500" disabled={disabled} checked={checked} onChange={() => togglePick(key)} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm text-white/90 truncate">{d.title || '(제목 없음)'}</span>
                                <span className="text-[10px] font-mono text-white/40">{d.code}{d.otherCodes && d.otherCodes.length ? ` (+${d.otherCodes.length})` : ''}</span>
                                {d.alreadyPromoted && <span className="text-[10px] bg-emerald-500/15 text-emerald-200 px-1.5 py-0.5 rounded">이미 올림</span>}
                                {d.rejectReason && <span className="text-[10px] text-amber-300">{d.rejectReason}</span>}
                              </div>
                              <div className="text-[11px] text-white/45 mt-0.5">{d.createdBy || '-'} · {new Date(d.createdAt).toLocaleDateString('ko-KR')} · 섹션 {d.sectionCount}개 · 가리는 별칭 {d.aliases.slice(0, 4).join(', ')}{d.aliases.length > 4 ? ` 외 ${d.aliases.length - 4}` : ''}</div>
                              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                                <select value={exRowIndustry[key] || ''} onChange={(e) => setExRowIndustry((p) => ({ ...p, [key]: e.target.value }))} className="bg-slate-800 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white">
                                  <option value="">업종: 일괄 값</option>
                                  {industries.map((ind) => <option key={ind.code} value={ind.code}>{ind.label}</option>)}
                                </select>
                                <button onClick={() => setExPreviewOpen(exPreviewOpen === key ? null : key)} className="text-[11px] text-white/60 hover:text-white px-2 py-1 rounded-lg hover:bg-white/10">{exPreviewOpen === key ? '마스킹본 접기' : '마스킹본 보기'}</button>
                              </div>
                              {exPreviewOpen === key && <pre className="mt-2 text-[11px] text-white/65 whitespace-pre-wrap font-sans max-h-56 overflow-y-auto bg-black/20 rounded-lg p-2">{d.preview}</pre>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-white/80">같은 회사의 이메일 실물 {exEmails.length}건 <span className="font-normal text-white/40">(브랜드명이 맞는 것은 미리 체크했습니다)</span></div>
                    {exEmails.map((em) => {
                      const key = `email:${em.id}`;
                      const disabled = !!em.rejectReason || em.alreadyPromoted;
                      const checked = exPicked.has(key);
                      const pairedDm = exResolved.find((d) => d.suggestedEmailId === em.id);
                      return (
                        <div key={key} className={`rounded-xl border px-3 py-2.5 ${disabled ? 'border-white/5 bg-white/[0.02] opacity-60' : checked ? 'border-violet-400/50 bg-violet-500/10' : 'border-white/10 bg-white/5'}`}>
                          <div className="flex items-start gap-3">
                            <input type="checkbox" className="mt-1 accent-violet-500" disabled={disabled} checked={checked} onChange={() => togglePick(key)} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm text-white/90 truncate">{em.name || '(이름 없음)'}</span>
                                {em.subject && <span className="text-[11px] text-white/50 truncate">{em.subject}</span>}
                                {pairedDm && <span className="text-[10px] bg-fuchsia-500/15 text-fuchsia-200 px-1.5 py-0.5 rounded">DM {pairedDm.title}의 짝</span>}
                                {em.alreadyPromoted && <span className="text-[10px] bg-emerald-500/15 text-emerald-200 px-1.5 py-0.5 rounded">이미 올림</span>}
                                {em.rejectReason && <span className="text-[10px] text-amber-300">{em.rejectReason}</span>}
                              </div>
                              <div className="text-[11px] text-white/45 mt-0.5">{em.createdBy || '-'} · {new Date(em.createdAt).toLocaleDateString('ko-KR')} · 블록 {em.sectionCount}개</div>
                              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                                <select value={exRowIndustry[key] || ''} onChange={(e) => setExRowIndustry((p) => ({ ...p, [key]: e.target.value }))} className="bg-slate-800 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white">
                                  <option value="">업종: 일괄 값</option>
                                  {industries.map((ind) => <option key={ind.code} value={ind.code}>{ind.label}</option>)}
                                </select>
                                <button onClick={() => setExPreviewOpen(exPreviewOpen === key ? null : key)} className="text-[11px] text-white/60 hover:text-white px-2 py-1 rounded-lg hover:bg-white/10">{exPreviewOpen === key ? '마스킹본 접기' : '마스킹본 보기'}</button>
                              </div>
                              {exPreviewOpen === key && <pre className="mt-2 text-[11px] text-white/65 whitespace-pre-wrap font-sans max-h-56 overflow-y-auto bg-black/20 rounded-lg p-2">{em.preview}</pre>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="p-4 border-t border-white/10 shrink-0 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[11px] text-white/40">저장 전에 서버가 마스킹 검사를 다시 합니다. 브랜드·링크·연락처·수치가 남으면 그 건은 제외되고 사유가 표시됩니다.</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setExOpen(false)} className="px-3 py-2 text-xs text-white/60 hover:bg-white/10 rounded-lg">취소</button>
                <button onClick={() => void submitExamples()} disabled={exPromoting || exPicked.size === 0}
                  className="px-4 py-2 bg-gradient-to-r from-fuchsia-500 to-violet-500 disabled:opacity-40 text-white rounded-lg text-sm font-semibold flex items-center gap-1.5">
                  {exPromoting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} 선택 {exPicked.size}건 올리기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 참조 골격 올리기 모달 — 후보 체크 + 업종 1필드(추가 입력은 업종뿐) */}
      {promoteOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">참조 골격 올리기 · {CHANNEL_LABEL[channel]}</div>
                  <div className="text-[11px] text-white/45 truncate">{candCompany ? `${candCompany.name}의 발행 실물` : '내부 전용 회사의 발행 실물'} · 저장되는 것은 섹션 순서뿐입니다</div>
                </div>
              </div>
              <button onClick={() => setPromoteOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/60" aria-label="닫기"><X className="w-4 h-4" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {candLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>
              ) : candidates.length === 0 ? (
                <p className="text-center text-xs text-white/40 py-10">올릴 수 있는 발행 실물이 없습니다.</p>
              ) : candidates.map((c) => {
                const disabled = !!c.rejectReason;
                const checked = candPicked.has(c.id);
                const type = candTypeOverride[c.id] || c.inferredAuthorType;
                return (
                  <label key={c.id} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${disabled ? 'border-white/5 bg-white/[0.02] opacity-60' : checked ? 'border-violet-400/50 bg-violet-500/10' : 'border-white/10 bg-white/5 hover:bg-white/[0.08]'} ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      className="mt-1 accent-violet-500"
                      disabled={disabled}
                      checked={checked}
                      onChange={() => setCandPicked((prev) => { const next = new Set(prev); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); return next; })}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-white/90 truncate">{c.title || '(제목 없음)'}</span>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={(e) => { e.preventDefault(); setCandTypeOverride((prev) => ({ ...prev, [c.id]: type === 'media' ? 'catalog' : 'media' })); }}
                          title="클릭하면 유형을 바꿉니다"
                          className={`text-[10px] px-1.5 py-0.5 rounded ${type === 'media' ? 'bg-fuchsia-500/20 text-fuchsia-200' : 'bg-cyan-500/20 text-cyan-200'}`}
                        >
                          {TYPE_LABEL[type]}{candTypeOverride[c.id] ? ' · 직접 지정' : ''}
                        </button>
                        {c.alreadyPromoted && <span className="text-[10px] bg-emerald-500/15 text-emerald-200 px-1.5 py-0.5 rounded">이미 올림</span>}
                        {c.aiEdited && <span className="text-[10px] bg-white/10 text-white/50 px-1.5 py-0.5 rounded">AI 초안 + 사람 편집</span>}
                      </div>
                      <div className="text-[11px] text-white/45 mt-0.5">
                        {c.createdBy || '-'} · {new Date(c.createdAt).toLocaleDateString('ko-KR')} · 섹션 {c.sectionCount}개
                      </div>
                      <div className="mt-1.5"><TypeChips types={c.types} /></div>
                      {c.rejectReason && <div className="text-[11px] text-amber-300 mt-1">{c.rejectReason}</div>}
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="p-4 border-t border-white/10 shrink-0 flex items-center justify-between gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-xs text-white/70">
                업종
                <select
                  value={promoteIndustry}
                  onChange={(e) => setPromoteIndustry(e.target.value)}
                  className="bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
                >
                  <option value={SKELETON_GENERAL}>업종 공통</option>
                  {industries.map((ind) => <option key={ind.code} value={ind.code}>{ind.label}</option>)}
                </select>
              </label>
              <div className="flex items-center gap-2">
                <button onClick={() => setPromoteOpen(false)} className="px-3 py-2 text-xs text-white/60 hover:bg-white/10 rounded-lg">취소</button>
                <button
                  onClick={submitPromote}
                  disabled={promoting || candPicked.size === 0}
                  className="px-4 py-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 disabled:opacity-40 text-white rounded-lg text-sm font-semibold flex items-center gap-1.5"
                >
                  {promoting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} 선택 {candPicked.size}건 올리기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
