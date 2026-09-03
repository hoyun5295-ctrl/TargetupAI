/**
 * BestCopyPage.tsx — 업종 베스트 문안 큐레이션 (슈퍼관리자 공용, 2026-07-04 재설계)
 *
 * 학습 페이지(ceo 전용)에서 분리된 별도 메뉴. 직원 누구나:
 *   1) [+추가] → 핸드폰 목업 입력 모달(업종·채널·광고성·문안) → 저장
 *   2) 저장 카드(세로 핸드폰 목업) 클릭 → 같은 모달 편집(수정/삭제)
 *   3) [AI 전수 채굴] → 업종 학습 코퍼스 전건 AI 판정(백그라운드+진행률) → 후보 검수 → 선택 승인 저장
 * 저장분은 브랜드보이스 미등록 업체(Track B) 문안 생성의 참고 원문으로만 쓰인다.
 * native dialog 0(ConfirmModal+useToast), 모델명 미노출, 백드롭 클릭 닫힘 없음(X·취소·ESC).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import {
  ArrowLeft, MessageSquareText, Plus, Loader2, RefreshCw, Sparkles, X, Trash2, Check, Megaphone, Info,
} from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import ConfirmModal, { ConfirmState } from '../components/ConfirmModal';

interface SeedUsage { uses: number; approxSent: number; approxSuccess: number }
interface Seed { id: string; text: string; industryCode: string; messageType: string; isAd: boolean; usage?: SeedUsage | null }
interface IndustryInfo { code: string; label: string; count: number }
interface FormulaInfo { content: string; createdAt: string }
interface StyleExampleInfo { id: string; text: string; tags: string[] }
interface MiningCandidate { text: string; messageType: string; score: number; reason: string }
interface MiningState {
  status: 'none' | 'running' | 'done' | 'error';
  totalMessages: number; totalBatches: number; processedBatches: number; failedBatches: number;
  candidates: MiningCandidate[];
  error?: string | null;
}

const CHANNELS = ['SMS', 'LMS', 'MMS', 'KAKAO'] as const;
// ★ 2026-09-03 참조 골격(DM·이메일 구성 학습)은 이 화면이 아니라 ceo 전용 "베스트 구성"(/admin/best-layout · BestLayoutPage)이 소유한다.
//   이 화면은 문안 학습(직원 공용)만 남는다 — 두 학습은 같은 생성 CT로 들어간다(설계서 docs/2026-09-03-reference-skeleton-learning-design.md §8).

interface EditorState {
  id?: string; // 있으면 편집 모드
  text: string;
  industryCode: string;
  messageType: string;
  isAd: boolean;
}

const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

/** 세로 핸드폰 목업 프레임 — 카드·편집 모달 공용 */
function PhoneFrame({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[1.75rem] border border-white/15 bg-slate-950 p-2 shadow-xl shadow-black/30 ${className}`}>
      <div className="rounded-[1.35rem] bg-gradient-to-b from-slate-900 to-slate-950 overflow-hidden">
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-14 h-1.5 rounded-full bg-white/15" />
        </div>
        {children}
      </div>
    </div>
  );
}

export default function BestCopyPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [industries, setIndustries] = useState<IndustryInfo[]>([]);
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [active, setActive] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // ★ 2026-07-04 진화: 업종 승리 공식 + 재창작 예시(사용자 갤러리 소스) 패널
  const [formula, setFormula] = useState<FormulaInfo | null>(null);
  const [styleExamples, setStyleExamples] = useState<StyleExampleInfo[]>([]);
  const [refreshingFormula, setRefreshingFormula] = useState(false);

  const [mining, setMining] = useState<MiningState | null>(null);
  const [mineStarting, setMineStarting] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [approving, setApproving] = useState(false);

  const activeLabel = useMemo(
    () => industries.find((i) => i.code === active)?.label || '전체',
    [industries, active],
  );

  const load = useCallback(async (industry: string) => {
    setLoading(true);
    try {
      const q = industry !== 'all' ? `?industryCode=${encodeURIComponent(industry)}` : '';
      const r = await fetch(`/api/admin/best-copy/list${q}`, { headers: authHeader() });
      const j = await r.json();
      if (j.success) {
        setSeeds(j.seeds || []);
        setIndustries(j.industries || []);
        setFormula(j.formula || null);
        setStyleExamples(j.styleExamples || []);
      } else toast.error(`조회 실패: ${j.error || '오류'}`);
    } catch (e: any) {
      toast.error(`조회 실패: ${e?.message || '네트워크 오류'}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchMineStatus = useCallback(async (industry: string) => {
    if (industry === 'all') { setMining(null); return; }
    try {
      const r = await fetch(`/api/admin/best-copy/mine/status?industryCode=${encodeURIComponent(industry)}`, { headers: authHeader() });
      const j = await r.json();
      if (j.success) setMining(j.status === 'none' ? null : j);
    } catch { /* 폴링 실패는 다음 주기에 재시도 */ }
  }, []);

  useEffect(() => { void load(active); void fetchMineStatus(active); }, [active, load, fetchMineStatus]);

  // 채굴 진행 중 폴링(2.5초) — 완료 시 검수 모달 자동 오픈
  useEffect(() => {
    if (mining?.status !== 'running') return;
    const t = setInterval(() => void fetchMineStatus(active), 2500);
    return () => clearInterval(t);
  }, [mining?.status, active, fetchMineStatus]);

  useEffect(() => {
    if (mining?.status === 'done' && !reviewOpen) {
      setPicked(new Set(mining.candidates.map((_, i) => i)));
      setReviewOpen(true);
    }
    if (mining?.status === 'error') toast.error(`AI 채굴 실패: ${mining.error || '오류'}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mining?.status]);

  // ESC = 편집/검수 모달 닫기 (백드롭 클릭 닫힘은 정책상 없음)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (reviewOpen) setReviewOpen(false);
      else if (editor) setEditor(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reviewOpen, editor]);

  const openCreate = () => {
    setEditor({
      text: '',
      industryCode: active !== 'all' ? active : (industries[0]?.code || 'etc'),
      messageType: 'LMS',
      isAd: true,
    });
  };

  const saveEditor = async () => {
    if (!editor) return;
    if (!editor.text.trim()) { toast.error('문안을 입력해주세요.'); return; }
    setSaving(true);
    try {
      const isEdit = !!editor.id;
      const r = await fetch(isEdit ? `/api/admin/best-copy/${editor.id}` : '/api/admin/best-copy/save', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          text: editor.text, industryCode: editor.industryCode, messageType: editor.messageType, isAd: editor.isAd,
        }),
      });
      const j = await r.json();
      if (j.success) {
        toast.success(isEdit ? '수정되었습니다.' : '베스트 문안이 저장되었습니다.');
        setEditor(null);
        void load(active);
      } else {
        toast.error(j.error || '저장 실패');
      }
    } catch (e: any) {
      toast.error(`저장 실패: ${e?.message || '네트워크 오류'}`);
    } finally {
      setSaving(false);
    }
  };

  const askDelete = () => {
    if (!editor?.id) return;
    setConfirm({
      mode: 'danger',
      title: '베스트 문안 삭제',
      description: '이 문안을 삭제하면 브랜드보이스 미등록 업체의 문안 생성 참고에서 제외됩니다.',
      confirmLabel: '삭제',
      onConfirm: async () => {
        const r = await fetch(`/api/admin/best-copy/${editor.id}`, { method: 'DELETE', headers: authHeader() });
        const j = await r.json();
        if (j.success) { toast.success('삭제되었습니다.'); setEditor(null); void load(active); }
        else toast.error(j.error || '삭제 실패');
      },
    });
  };

  const askMine = () => {
    if (active === 'all') { toast.info('업종을 먼저 선택해주세요.'); return; }
    setConfirm({
      mode: 'info',
      title: 'AI 전수 채굴',
      description: `${activeLabel} 업종의 학습 문안 전체를 AI가 판정해 마케팅성 베스트 후보를 추립니다.\n문안 수에 따라 몇 분 걸릴 수 있습니다.`,
      confirmLabel: '시작',
      onConfirm: async () => {
        setMineStarting(true);
        try {
          const r = await fetch('/api/admin/best-copy/mine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader() },
            body: JSON.stringify({ industryCode: active }),
          });
          const j = await r.json();
          if (!j.success) { toast.error(j.error || '채굴 시작 실패'); return; }
          if (j.already) toast.info('이미 채굴이 진행 중입니다.');
          await fetchMineStatus(active);
        } finally {
          setMineStarting(false);
        }
      },
    });
  };

  // ★ 2026-07-04: 공식·예시 갱신 — 시드 → 승리 공식 증류 + 사용자 갤러리 예시 재창작(유사도 가드)
  const refreshFormula = async () => {
    if (active === 'all') return;
    setRefreshingFormula(true);
    try {
      const r = await fetch('/api/admin/best-copy/formula/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ industryCode: active }),
      });
      const j = await r.json();
      if (j.success) {
        toast.success(`공식 갱신 완료: 예시 ${j.exampleCount}건${j.discardedBySimilarity > 0 ? ` (유사도 가드 제외 ${j.discardedBySimilarity})` : ''}`);
        void load(active);
      } else {
        toast.error(j.error || '공식 갱신 실패');
      }
    } catch (e: any) {
      toast.error(`공식 갱신 실패: ${e?.message || '네트워크 오류'}`);
    } finally {
      setRefreshingFormula(false);
    }
  };

  const approvePicked = async () => {
    if (!mining || picked.size === 0) { toast.error('저장할 후보를 선택해주세요.'); return; }
    setApproving(true);
    try {
      const items = mining.candidates
        .filter((_, i) => picked.has(i))
        .map((c) => ({ text: c.text, messageType: c.messageType, isAd: true }));
      const r = await fetch('/api/admin/best-copy/mine/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ industryCode: active, items }),
      });
      const j = await r.json();
      if (j.success) {
        toast.success(`${j.inserted}건이 베스트 문안으로 저장되었습니다.`);
        setReviewOpen(false);
        void load(active);
      } else {
        toast.error(j.error || '저장 실패');
      }
    } catch (e: any) {
      toast.error(`저장 실패: ${e?.message || '네트워크 오류'}`);
    } finally {
      setApproving(false);
    }
  };

  const totalCount = useMemo(() => industries.reduce((s, i) => s + i.count, 0), [industries]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-violet-950 to-slate-950 text-white">
      {/* 헤더 */}
      <div className="bg-slate-900/60 backdrop-blur-md border-b border-white/10 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3 flex-wrap">
          <button onClick={() => goBackOr(navigate, '/admin')} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="슈퍼관리자로">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-amber-500/20">
            <MessageSquareText className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-semibold">업종 베스트 문안</h1>
              <span className="text-[10px] bg-gradient-to-r from-violet-400 to-fuchsia-500 text-white px-2 py-0.5 rounded-full font-bold tracking-wide">CURATION</span>
            </div>
            <p className="text-xs text-white/50 mt-0.5 hidden md:block">
              업종별 베스트 문안을 직접 등록·AI 채굴로 모아, 브랜드보이스 미등록 업체의 문안 생성 참고 원문으로 씁니다.
            </p>
          </div>
          <button
            onClick={askMine}
            disabled={active === 'all' || mining?.status === 'running' || mineStarting}
            className="text-xs bg-gradient-to-r from-violet-500 to-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-2 rounded-lg flex items-center gap-1.5"
            title={active === 'all' ? '업종을 먼저 선택해주세요' : 'AI 전수 채굴'}
          >
            {mining?.status === 'running' || mineStarting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">AI 전수 채굴</span>
          </button>
          <button onClick={() => { void load(active); void fetchMineStatus(active); }} className="text-xs text-white/70 hover:bg-white/10 px-3 py-2 rounded-lg flex items-center gap-1.5" aria-label="새로고침">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">새로고침</span>
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-5">
        {/* 업종 카테고리 칩 */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActive('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              active === 'all' ? 'bg-violet-500/30 border-violet-400/50 text-white' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
            }`}
          >
            전체 <span className="ml-1 text-white/50">{totalCount}</span>
          </button>
          {industries.map((ind) => (
            <button
              key={ind.code}
              onClick={() => setActive(ind.code)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                active === ind.code ? 'bg-violet-500/30 border-violet-400/50 text-white' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
              }`}
            >
              {ind.label} <span className={`ml-1 ${ind.count > 0 ? 'text-emerald-300' : 'text-white/40'}`}>{ind.count}</span>
            </button>
          ))}
        </div>

        {/* AI 채굴 진행 카드 */}
        {mining?.status === 'running' && (
          <div className="p-4 bg-gradient-to-r from-violet-500/15 to-fuchsia-500/15 border border-violet-400/30 rounded-2xl">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-violet-300 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">AI 전수 판정 중: {activeLabel}</div>
                <div className="text-xs text-white/50 mt-0.5">
                  대상 {mining.totalMessages.toLocaleString()}건 · 배치 {mining.processedBatches}/{mining.totalBatches}
                  {mining.failedBatches > 0 && ` · 실패 ${mining.failedBatches}`}
                </div>
              </div>
            </div>
            <div className="mt-3 h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-400 to-fuchsia-400 transition-all"
                style={{ width: `${mining.totalBatches > 0 ? Math.round(mining.processedBatches / mining.totalBatches * 100) : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* ★ 2026-07-04: 업종 승리 공식 패널 — 시드에서 증류, Track B 프롬프트·사용자 스타일 갤러리 소스 */}
        {active !== 'all' && (
          <div className="p-4 bg-white/5 border border-white/10 rounded-2xl">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-300" /> {activeLabel} 승리 공식
                {styleExamples.length > 0 && (
                  <span className="text-[10px] bg-violet-500/20 text-violet-200 px-2 py-0.5 rounded-full">사용자 예시 {styleExamples.length}건 게시 중</span>
                )}
              </div>
              <button
                onClick={refreshFormula}
                disabled={refreshingFormula}
                className="text-xs bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white/80 px-3 py-1.5 rounded-lg flex items-center gap-1.5"
              >
                {refreshingFormula ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                공식·예시 갱신
              </button>
            </div>
            {formula ? (
              <pre className="mt-3 text-xs text-white/70 leading-relaxed whitespace-pre-wrap font-sans">{formula.content}</pre>
            ) : (
              <p className="mt-3 text-xs text-white/40">아직 공식이 없습니다. 시드 3건 이상 저장 후 [공식·예시 갱신]을 눌러주세요.</p>
            )}
            <div className="text-[10px] text-white/30 italic mt-2">
              공식은 문안 생성 프롬프트 지침으로, 재창작 예시는 사용자 "스타일 참고"로만 쓰입니다. 시드 원문은 사용자에게 노출되지 않습니다.
            </div>
          </div>
        )}

        {/* 채굴 완료 후 검수 재오픈 */}
        {mining?.status === 'done' && !reviewOpen && (
          <button
            onClick={() => { setPicked(new Set(mining.candidates.map((_, i) => i))); setReviewOpen(true); }}
            className="w-full p-3 bg-emerald-500/10 border border-emerald-400/30 rounded-2xl text-sm text-emerald-200 flex items-center justify-center gap-2 hover:bg-emerald-500/15 transition-colors"
          >
            <Check className="w-4 h-4" /> AI 채굴 완료: 후보 {mining.candidates.length}건 검수하기
          </button>
        )}

        {/* 카드 그리드 */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-white/40" /></div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* +추가 카드 */}
            <button
              onClick={openCreate}
              className="rounded-[1.75rem] border-2 border-dashed border-white/20 hover:border-violet-400/50 hover:bg-white/5 transition-colors flex flex-col items-center justify-center gap-2 min-h-[280px] text-white/50 hover:text-white/80"
            >
              <div className="w-12 h-12 rounded-2xl bg-violet-500/20 flex items-center justify-center">
                <Plus className="w-6 h-6 text-violet-300" />
              </div>
              <div className="text-sm font-medium">베스트 문안 추가</div>
              <div className="text-[11px] text-white/40">직원 직접 입력</div>
            </button>

            {seeds.map((s) => {
              const label = industries.find((i) => i.code === s.industryCode)?.label || s.industryCode;
              return (
                <button key={s.id} onClick={() => setEditor({ id: s.id, text: s.text, industryCode: s.industryCode, messageType: s.messageType, isAd: s.isAd })} className="text-left group">
                  <PhoneFrame className="group-hover:border-violet-400/40 transition-colors">
                    <div className="px-3 pb-3">
                      <div className="flex items-center gap-1 mb-2">
                        <span className="text-[9px] bg-white/10 text-white/70 px-1.5 py-0.5 rounded font-mono">{s.messageType}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5 ${s.isAd ? 'bg-amber-500/20 text-amber-200' : 'bg-cyan-500/20 text-cyan-200'}`}>
                          {s.isAd ? <Megaphone className="w-2.5 h-2.5" /> : <Info className="w-2.5 h-2.5" />}
                          {s.isAd ? '광고' : '정보'}
                        </span>
                      </div>
                      <div className="relative h-[190px] overflow-hidden">
                        <div className="bg-white/10 border border-white/10 rounded-2xl rounded-tl-sm p-3 text-[11px] leading-relaxed text-white/85 whitespace-pre-wrap break-words">
                          {s.text}
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-slate-950 to-transparent" />
                      </div>
                      <div className="flex items-center gap-1.5 mt-2 min-w-0">
                        <span className="text-[10px] text-white/40 truncate">{label}</span>
                        {s.usage && s.usage.uses > 0 && (
                          <span className="text-[9px] bg-emerald-500/15 text-emerald-200/90 px-1.5 py-0.5 rounded ml-auto shrink-0" title="생성 프롬프트 참고 횟수 · 참고 후 7일 내 발송 성공률(근사)">
                            참고 {s.usage.uses}회{s.usage.approxSent > 0 ? ` · ${Math.round(s.usage.approxSuccess / s.usage.approxSent * 100)}%` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </PhoneFrame>
                </button>
              );
            })}
          </div>
        )}

        {!loading && seeds.length === 0 && (
          <div className="text-center text-white/40 text-sm py-4">
            {active === 'all' ? '저장된 베스트 문안이 없습니다. +추가 또는 업종 선택 후 AI 전수 채굴로 시작하세요.' : `${activeLabel} 업종에 저장된 문안이 없습니다.`}
          </div>
        )}

        <div className="text-[10px] text-white/30 italic">
          Data source: 큐레이션 시드(승인분만). 브랜드보이스 미등록 업체의 문안 생성에만 참고 원문으로 활용됩니다.
        </div>
      </div>

      {/* 입력/편집 모달 — 좌: 큰 액정(흰 화면·검은 글씨, 실제 문자 느낌) / 우: 기능(업종·채널·광고성·저장) */}
      {editor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                  <MessageSquareText className="w-4 h-4 text-white" />
                </div>
                <h3 className="text-sm font-semibold">{editor.id ? '베스트 문안 편집' : '베스트 문안 추가'}</h3>
              </div>
              <button onClick={() => setEditor(null)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors" aria-label="닫기">
                <X className="w-4 h-4 text-white/50" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="grid md:grid-cols-[minmax(0,1fr)_280px]">
                {/* 좌: 핸드폰 액정 — 문안 작성 전용. 흰 화면 + 검은 글씨 명시색(상속 금지) */}
                <div className="p-5 flex items-center justify-center bg-slate-950/40">
                  <div className="w-full max-w-[340px] rounded-[1.75rem] border border-white/15 bg-slate-950 p-2 shadow-xl shadow-black/30">
                    <div className="rounded-[1.35rem] bg-white overflow-hidden">
                      <div className="flex justify-center pt-2 pb-1 bg-slate-100 border-b border-slate-200">
                        <div className="w-14 h-1.5 rounded-full bg-slate-300" />
                      </div>
                      <textarea
                        value={editor.text}
                        onChange={(e) => setEditor({ ...editor, text: e.target.value })}
                        placeholder={'베스트 문안을 붙여넣거나 입력하세요.\n(받아본 문자 중 반응이 좋았던 문안)'}
                        className="block w-full h-[340px] md:h-[420px] bg-white text-slate-900 placeholder:text-slate-400 p-4 text-[13px] leading-relaxed resize-none focus:outline-none"
                        autoFocus
                      />
                      <div className="text-right text-[11px] text-slate-400 bg-white px-4 pb-2.5">{editor.text.length}자</div>
                    </div>
                  </div>
                </div>

                {/* 우: 기능 */}
                <div className="p-5 border-t md:border-t-0 md:border-l border-white/10 flex flex-col gap-4">
                  <div>
                    <label className="text-[11px] text-white/50 block mb-1">업종</label>
                    <select
                      value={editor.industryCode}
                      onChange={(e) => setEditor({ ...editor, industryCode: e.target.value })}
                      className="w-full bg-slate-800 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-violet-400/50"
                    >
                      {industries.map((i) => <option key={i.code} value={i.code}>{i.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-white/50 block mb-1">채널</label>
                    <select
                      value={editor.messageType}
                      onChange={(e) => setEditor({ ...editor, messageType: e.target.value })}
                      className="w-full bg-slate-800 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-violet-400/50"
                    >
                      {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  <button
                    onClick={() => setEditor({ ...editor, isAd: !editor.isAd })}
                    className="w-full flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      {editor.isAd ? <Megaphone className="w-4 h-4 text-amber-300" /> : <Info className="w-4 h-4 text-cyan-300" />}
                      <span>{editor.isAd ? '광고성 문안' : '정보성 문안'}</span>
                    </div>
                    <div className={`w-10 h-6 rounded-full transition-colors relative ${editor.isAd ? 'bg-amber-500/60' : 'bg-white/15'}`}>
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${editor.isAd ? 'left-[18px]' : 'left-0.5'}`} />
                    </div>
                  </button>

                  <p className="text-[11px] text-white/40 leading-relaxed">
                    전화번호·URL·이메일·브랜드명은 저장 시 자동으로 일반화됩니다. 저장분은 브랜드보이스 미등록 업체의 문안 생성 참고로만 쓰입니다.
                  </p>

                  <div className="flex-1" />

                  <button
                    onClick={saveEditor}
                    disabled={saving || !editor.text.trim()}
                    className="w-full px-4 py-2.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 disabled:opacity-40 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5"
                  >
                    {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} 저장
                  </button>
                  <button
                    onClick={() => setEditor(null)}
                    disabled={saving}
                    className="w-full px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/80 rounded-lg text-sm disabled:opacity-50"
                  >
                    취소
                  </button>
                  {editor.id && (
                    <button
                      onClick={askDelete}
                      disabled={saving}
                      className="w-full px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300/90 rounded-lg text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> 이 문안 삭제
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI 채굴 후보 검수 모달 */}
      {reviewOpen && mining?.status === 'done' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">AI 채굴 후보 검수: {activeLabel}</h3>
                  <p className="text-[11px] text-white/50">
                    전체 {mining.totalMessages.toLocaleString()}건 판정 · 후보 {mining.candidates.length}건 · 체크한 문안만 저장됩니다
                  </p>
                </div>
              </div>
              <button onClick={() => setReviewOpen(false)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors" aria-label="닫기">
                <X className="w-4 h-4 text-white/50" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {mining.candidates.length === 0 ? (
                <div className="text-center py-16 text-white/40 text-sm">
                  마케팅성 고득점 문안이 없습니다. 이 업종은 직접 입력으로 채워주세요.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {mining.candidates.map((c, i) => {
                    const on = picked.has(i);
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          const next = new Set(picked);
                          if (on) next.delete(i); else next.add(i);
                          setPicked(next);
                        }}
                        className={`text-left p-3 rounded-xl border transition-colors ${on ? 'bg-violet-500/15 border-violet-400/50' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`w-4 h-4 rounded flex items-center justify-center ${on ? 'bg-violet-400' : 'bg-white/15'}`}>
                            {on && <Check className="w-3 h-3 text-slate-900" />}
                          </div>
                          <span className="text-[10px] bg-white/10 text-white/70 px-1.5 py-0.5 rounded font-mono">{c.messageType}</span>
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-200 px-1.5 py-0.5 rounded font-semibold">{c.score}점</span>
                        </div>
                        <div className="text-[11px] leading-relaxed text-white/85 whitespace-pre-wrap break-words max-h-32 overflow-hidden">
                          {c.text}
                        </div>
                        {c.reason && <div className="text-[10px] text-violet-200/70 mt-2">{c.reason}</div>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 p-4 border-t border-white/10 bg-slate-950/50">
              <div className="text-xs text-white/50">{picked.size}건 선택</div>
              <div className="flex-1" />
              <button onClick={() => setReviewOpen(false)} disabled={approving} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 rounded-lg text-sm disabled:opacity-50">
                닫기
              </button>
              <button
                onClick={approvePicked}
                disabled={approving || picked.size === 0}
                className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 disabled:opacity-40 text-white rounded-lg text-sm font-semibold flex items-center gap-1.5"
              >
                {approving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} 선택 {picked.size}건 저장
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
