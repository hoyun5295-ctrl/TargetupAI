/**
 * AiOperatorLoginPromo — 로그인 직후 한 번 AI Operator 기능 소개로 안내하는 창 (★ 2026-10-06 Harold 지시 · 목업 승인)
 *
 * 대상 = AI Operator 를 아직 쓸 수 없는 회사(서버 판정 `fetchAiOperatorAccess` = false · 허브가 기능 안내 창을 여는 기준과 같다).
 *   요금제를 쓰는 회사는 허브 카드를 누르면 기능으로 바로 들어가 영상을 보지 않는다 → 「소개 영상이 함께 있다」가 사실이 아니라 띄우지 않는다.
 *   판정을 모르면(조회 실패) 띄우지 않는다.
 * 빈도 = 로그인 한 번마다 한 번(토큰은 로그인할 때만 새로 저장된다 · authStore) · 같은 로그인에서는 새로고침해도 다시 뜨지 않는다.
 * 기록 = 뜬 것(open) · 「지금 바로가기」(go) → 슈퍼관리자 「기능 관심 업체」(featureId 'login-promo').
 * 칩 문장은 기능 안내 창 원장(plan-feature-intros.ts)과 같은 사실만 쓴다(10-06 코드 확인).
 * ★ Codex 1R — ① 탭 두 개가 함께 들어와도 한 번: 탭 사이 잠금(navigator.locks) 안에서 표식을 다시 보고 저장한 탭만 띄우고 기록한다
 *   ② 다른 자동 안내 창(요금제 변경 알림)과 겹치지 않게 부모가 blocked 를 주면 그 창이 닫힐 때까지 기다린다(표식 = 실제로 뜰 때)
 *   ③ Tab · Shift+Tab 은 창 안에서만 돌고, 닫으면 포커스를 원래 자리로 돌려놓는다.
 * ★ Codex 2R — 「한 번」은 원자적으로 잡을 수 있을 때만 약속한다: 탭 사이 잠금이 없거나 표식을 저장하지 못하면 띄우지 않는다
 *   (모르면 띄우지 않는다 · 중복 노출 · 닫아도 다시 뜨는 것보다 안 뜨는 쪽) · 한 화면에서는 한 번 띄우면 다시 띄우지 않는다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, X } from 'lucide-react';
import { fetchAiOperatorAccess } from '../utils/ai-operator-access';
import { reportPlanFeature } from '../utils/plan-feature-report';
import { usePlanFeatureIntros } from '../constants/plan-feature-intros'; // ★ 2026-10-07 영상 = 서버 서명 주소(공개 폴더에서 뺐다)
import FeatureWatermark from './FeatureWatermark';

export const LOGIN_PROMO_FEATURE_ID = 'login-promo';
const SEEN_KEY = 'ai-op-login-promo-seen';
/** 예시 영상 = 기능 안내 원장의 자동 마케팅 영상(서버가 로그인한 사람에게만 서명 주소로 준다) */
const PROMO_FEATURE_ID = 'auto-marketing';

/** 이 로그인의 표식(토큰 끝부분) — 토큰은 로그인할 때만 바뀐다 */
function loginMark(): string | null {
  const token = localStorage.getItem('token');
  return token ? token.slice(-24) : null;
}
function readSeen(): string | null {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}
/** 표식 저장 — 저장했으면 true(용량 초과 · 막힌 저장소 = false) */
function writeSeen(mark: string): boolean {
  try { localStorage.setItem(SEEN_KEY, mark); return localStorage.getItem(SEEN_KEY) === mark; } catch { return false; }
}

export default function AiOperatorLoginPromo({ blocked = false }: { /** 다른 자동 안내 창이 열려 있으면 true — 닫힐 때까지 기다린다 */ blocked?: boolean }) {
  const navigate = useNavigate();
  const intros = usePlanFeatureIntros();
  const promoVideo = intros?.find(PROMO_FEATURE_ID)?.video;
  const [eligible, setEligible] = useState(false);
  const [open, setOpen] = useState(false);
  const shownRef = useRef(false); // 한 화면에서 한 번 — 닫은 뒤 효과가 다시 돌아도 다시 띄우지 않는다
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // ① 후보 판정 — 이 로그인에서 아직 안 띄웠고 서버가 「못 씀」(false)이면 후보(모름 = 띄우지 않음)
  useEffect(() => {
    const mark = loginMark();
    if (!mark || readSeen() === mark) return;
    let alive = true;
    void fetchAiOperatorAccess().then((allowed) => {
      if (alive && allowed === false) setEligible(true);
    });
    return () => { alive = false; };
  }, []);

  // ② 표시 — 다른 자동 안내 창이 없을 때 · 탭 사이 잠금 안에서 표식을 다시 보고 저장한 탭만 띄우고 기록한다
  useEffect(() => {
    if (!eligible || blocked || open || shownRef.current) return;
    const mark = loginMark();
    const locks = (navigator as any).locks;
    if (!mark || !locks?.request) return; // 탭 사이 잠금이 없으면 「한 번」을 지킬 수 없다 → 띄우지 않는다
    let alive = true;
    const claim = (): boolean => {
      if (!alive || readSeen() === mark) return false; // 그 사이 막혔으면(다른 안내 창 · 화면 이동) 표식을 잡지 않는다 — 다음 기회에 띄운다
      return writeSeen(mark); // 저장 못 하면 잡지 않는다(닫아도 다시 뜨는 것을 막는다)
    };
    const run = async () => {
      const won: boolean = await locks.request('ai-op-login-promo', async () => claim());
      if (!alive || !won) return;
      shownRef.current = true;
      setOpen(true);
      reportPlanFeature(LOGIN_PROMO_FEATURE_ID, 'open');
    };
    void run().catch(() => { /* 잠금 실패 = 이번에는 띄우지 않는다 */ });
    return () => { alive = false; };
  }, [eligible, blocked, open]);

  // 열려 있는 동안: Esc 닫기 · Tab 은 창 안에서만 · 뒤 화면 스크롤 잠금 · 첫 포커스 = 지금 바로가기 · 닫으면 포커스 복귀 · 영상 무음 재생
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>('button, [href], video[controls], [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.hasAttribute('disabled'));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !root.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    primaryRef.current?.focus();
    const v = videoRef.current;
    if (v && !reduceMotion) {
      v.muted = true;
      const played = v.play();
      if (played && typeof played.catch === 'function') played.catch(() => { /* 막히면 포스터가 남는다 */ });
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open, reduceMotion]);

  if (!open) return null;

  const close = () => setOpen(false);
  const go = () => {
    reportPlanFeature(LOGIN_PROMO_FEATURE_ID, 'go');
    setOpen(false);
    navigate('/ai-operator');
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/60 backdrop-blur-[6px] animate-[fadeIn_0.2s_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <FeatureWatermark on={intros?.watermark === true} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-op-login-promo-title"
        className="w-full sm:max-w-[760px] max-h-[92vh] overflow-y-auto overscroll-contain bg-white text-slate-900 rounded-t-2xl sm:rounded-[22px] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.6)] sm:grid sm:grid-cols-[280px_minmax(0,1fr)] animate-[zoomIn_0.25s_ease-out]"
      >
        <div className="flex sm:flex-col items-center justify-center gap-3 bg-slate-50 p-4 sm:p-5">
          <video
            ref={videoRef}
            src={promoVideo?.src}
            poster={promoVideo?.poster}
            muted
            loop
            playsInline
            preload="metadata"
            autoPlay={!reduceMotion}
            controls={reduceMotion}
            aria-label="AI Operator 자동 마케팅 예시 영상"
            className="w-[120px] sm:w-[240px] aspect-[9/16] object-cover rounded-xl sm:rounded-2xl bg-black shadow-[0_16px_40px_-18px_rgba(15,23,42,0.55)]"
          />
          <p className="flex-1 sm:flex-none text-[11px] leading-relaxed text-slate-400 sm:text-center break-keep">자동 마케팅 예시 화면입니다</p>
        </div>

        <div className="relative flex flex-col px-5 sm:px-7 pt-6 sm:pt-7 pb-5">
          <button
            type="button"
            onClick={close}
            aria-label="닫기"
            className="absolute top-3 right-3 w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300"
          >
            <X className="w-4 h-4" />
          </button>
          <span className="self-start inline-flex items-center text-xs font-bold text-violet-700 bg-violet-50 rounded-full px-2.5 py-1">한줄로 AI Operator</span>
          <h2 id="ai-op-login-promo-title" className="mt-3.5 pr-8 text-[22px] sm:text-[24px] font-bold leading-snug tracking-[-0.02em] break-keep">
            지금 바로 한줄로 AI Operator 기능을 살펴보세요
          </h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-slate-600 break-keep">
            기능마다 짧은 소개 영상과 자세한 설명이 함께 있습니다. 눌러 보시면 어떻게 쓰는지 바로 보입니다.
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <span className="text-[12.5px] px-2.5 py-1.5 rounded-[10px] bg-slate-50 border border-slate-200 text-slate-700"><b className="text-violet-700">자동 마케팅</b> 한 번 승인하면 7일 자동</span>
            <span className="text-[12.5px] px-2.5 py-1.5 rounded-[10px] bg-slate-50 border border-slate-200 text-slate-700"><b className="text-violet-700">여정 자동화</b> 가입부터 재구매까지</span>
            <span className="text-[12.5px] px-2.5 py-1.5 rounded-[10px] bg-slate-50 border border-slate-200 text-slate-700"><b className="text-violet-700">마케팅 플래너</b> 행사만 담으면 완성본</span>
            <span className="text-[12.5px] px-2.5 py-1.5 rounded-[10px] bg-slate-50 border border-slate-200 text-slate-700"><b className="text-violet-700">이미지 스튜디오</b> 문구만 쓰면 포스터</span>
            <span className="text-[12.5px] px-2.5 py-1.5 rounded-[10px] bg-slate-50 border border-slate-200 text-slate-700">모바일 DM · 이메일 · 인앱 · SNS 등 <b className="text-violet-700">12가지</b></span>
          </div>
          <div className="mt-6 flex flex-col gap-1.5">
            <button
              ref={primaryRef}
              type="button"
              onClick={go}
              className="inline-flex items-center justify-center gap-2 rounded-[14px] bg-violet-600 hover:bg-violet-700 px-4 py-3.5 text-base font-bold text-white shadow-[0_14px_30px_-12px_rgba(124,58,237,0.8)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
            >
              지금 바로가기
              <ArrowRight className="w-4 h-4" />
            </button>
            <button type="button" onClick={close} className="py-2 text-[13px] text-slate-400 hover:text-slate-600 transition-colors">다음에 볼게요</button>
          </div>
        </div>
      </div>
    </div>
  );
}
