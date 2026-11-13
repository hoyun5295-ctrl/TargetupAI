/**
 * AiOperatorLoginPromo — 로그인 직후 「한줄로 V3」 소개 창 (★ 2026-10-06 Harold 지시 · 목업 승인 → ★ 2026-11-13 C133 F7 내용 교체)
 *
 * ★ 2026-11-13 C133 F7(설계서 docs/2026-11-13-hanjul-v3-design.md §2 · Harold 「팝업도 교체해서 새로운 기능들 소개 · 이미지스튜디오 및 한줄로 V.3 팝업」)
 *   창의 틀(2칸 판 · 탭 사이 잠금 · 포커스 가두기 · 로그인당 한 번)은 그대로 두고 내용만 바꿨다.
 *   - 왼쪽 = 영상 대신 이미지 스튜디오 실샘플 포스터 · 오른쪽 = 제목 + 그 회사가 지금 쓸 수 있는 V3 기능 칩(서버가 준 것만 그린다 = 아직 안 연 기능을 약속하지 않는다)
 *   - 대상 = 고객사 사용자 전부(가입 · 미가입) · 한 계정에 최대 3번 · 「이 소개 다시 보지 않기」 = 그 계정에 영구.
 *     몇 번 띄웠는지는 **서버가 선점**한다(utils/v3-intro claimV3Intro · 기기 저장소는 「이 로그인에서 한 번」만 맡는다).
 *   - 버튼 = 이미지 스튜디오로(잠긴 회사는 그 화면의 요금제 관문이 기능 안내 창으로 돌린다 = 갈래를 여기서 새로 만들지 않는다)
 *   - 바깥을 눌러도 닫히지 않는다(X · Esc · 「다음에 볼게요」) · 예시 영상 · 영문 제품명을 쓰지 않는다.
 * 빈도 = 로그인 한 번마다 한 번(토큰은 로그인할 때만 새로 저장된다 · authStore) · 같은 로그인에서는 새로고침해도 다시 뜨지 않는다.
 * 기록 = 뜬 것(open) · 「이미지 스튜디오 보기」(go) → 슈퍼관리자 「기능 관심 업체」(featureId 'login-promo').
 * ★ Codex 1R — ① 탭 두 개가 함께 들어와도 한 번: 탭 사이 잠금(navigator.locks) 안에서 표식을 다시 보고 저장한 탭만 띄우고 기록한다
 *   ② 다른 자동 안내 창(요금제 변경 알림 · 마케팅 진단 초대)과 겹치지 않게 부모가 blocked 를 주면 그 창이 닫힐 때까지 기다린다(표식 = 실제로 뜰 때)
 *   ③ Tab · Shift+Tab 은 창 안에서만 돌고, 닫으면 포커스를 원래 자리로 돌려놓는다.
 * ★ Codex 2R — 「한 번」은 원자적으로 잡을 수 있을 때만 약속한다: 탭 사이 잠금이 없거나 표식을 저장하지 못하면 띄우지 않는다
 *   (모르면 띄우지 않는다 · 중복 노출 · 닫아도 다시 뜨는 것보다 안 뜨는 쪽) · 한 화면에서는 한 번 띄우면 다시 띄우지 않는다.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, X } from 'lucide-react';
import { reportPlanFeature } from '../utils/plan-feature-report';
import { claimV3Intro, dismissV3Intro, type V3Intro } from '../utils/v3-intro';
import { useToast } from './ToastProvider';

export const LOGIN_PROMO_FEATURE_ID = 'login-promo';
const SEEN_KEY = 'ai-op-login-promo-seen';

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
  const toast = useToast();
  const [eligible, setEligible] = useState(false);
  const [open, setOpen] = useState(false);
  const [intro, setIntro] = useState<V3Intro | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const shownRef = useRef(false); // 한 화면에서 한 번 — 닫은 뒤 효과가 다시 돌아도 다시 띄우지 않는다
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  // ① 후보 판정 — 이 로그인에서 아직 안 띄웠으면 후보(대상인지 · 계정당 3번을 넘었는지는 ② 의 서버 선점이 정한다)
  useEffect(() => {
    const mark = loginMark();
    if (!mark || readSeen() === mark) return;
    setEligible(true);
  }, []);

  // ② 표시 — 다른 자동 안내 창이 없을 때 · 탭 사이 잠금 안에서 표식을 다시 보고 저장한 탭만 서버에 묻고, 띄우라는 답일 때만 띄우고 기록한다
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
      shownRef.current = true; // 이 화면은 여기서 끝 — 서버가 띄우지 말라고 답해도 다시 묻지 않는다(묻는 것 = 노출 한 번)
      const got = await claimV3Intro(); // 서버 선점(계정당 최대 3번 · 다시 보지 않기 · 대상 판정)
      if (!alive || !got) return;
      setIntro(got);
      setOpen(true);
      reportPlanFeature(LOGIN_PROMO_FEATURE_ID, 'open');
    };
    void run().catch(() => { /* 잠금 실패 = 이번에는 띄우지 않는다 */ });
    return () => { alive = false; };
  }, [eligible, blocked, open]);

  // 열려 있는 동안: Esc 닫기 · Tab 은 창 안에서만 · 뒤 화면 스크롤 잠금 · 첫 포커스 = 이미지 스튜디오 보기 · 닫으면 포커스 복귀
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])'))
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
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open]);

  if (!open || !intro) return null;

  const close = () => setOpen(false);
  const go = () => {
    reportPlanFeature(LOGIN_PROMO_FEATURE_ID, 'go');
    setOpen(false);
    navigate('/image-studio');
  };
  /** 「이 소개 다시 보지 않기」 — 서버에 적힌 뒤에만 약속한다(못 적으면 그렇다고 말하고 닫는다) */
  const dismiss = async () => {
    if (dismissing) return;
    setDismissing(true);
    const saved = await dismissV3Intro();
    setDismissing(false);
    if (saved) toast.success('이 계정에서는 다시 띄우지 않아요');
    else toast.error('저장하지 못했어요. 다음에 다시 눌러 주세요.');
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/60 backdrop-blur-[6px] animate-backdrop-in motion-reduce:animate-none">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-op-login-promo-title"
        className="w-full sm:max-w-[760px] max-h-[92vh] overflow-y-auto overscroll-contain bg-white text-slate-900 rounded-t-2xl sm:rounded-[22px] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.6)] sm:grid sm:grid-cols-[280px_minmax(0,1fr)] animate-dialog-in motion-reduce:animate-none"
      >
        <div className="flex flex-col items-center justify-center gap-3 bg-slate-50 p-4 sm:p-5">
          <div className="grid grid-cols-3 sm:grid-cols-2 gap-2 w-full">
            {intro.posters.map((p, i) => (
              <img
                key={p.id}
                src={p.url}
                alt="이미지 스튜디오로 만든 포스터 예시"
                loading="eager"
                className={`w-full aspect-[3/4] object-cover rounded-xl bg-slate-200 shadow-[0_12px_28px_-16px_rgba(15,23,42,0.55)] ${i === 0 ? 'sm:col-span-2 sm:w-[72%] sm:justify-self-center' : ''}`}
              />
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400 text-center break-keep">이미지 스튜디오로 만든 예시입니다</p>
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
          <span className="self-start inline-flex items-center text-xs font-bold text-violet-700 bg-violet-50 rounded-full px-2.5 py-1">한줄로 V3</span>
          <h2 id="ai-op-login-promo-title" className="mt-3.5 pr-8 text-[22px] sm:text-[24px] font-bold leading-snug tracking-[-0.02em] break-keep">
            상품 사진 한 장이 행사 포스터가 됩니다
          </h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-slate-600 break-keep">
            사진을 올리고 문구만 적으면 완성본이 나옵니다. 만든 그림은 문자 · 모바일 DM · 이메일 · 자사몰 팝업에 그대로 씁니다.
          </p>
          {intro.chips.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {intro.chips.map((c) => (
                <span key={c.key} className="text-[12.5px] px-2.5 py-1.5 rounded-[10px] bg-slate-50 border border-slate-200 text-slate-700">
                  <b className="text-violet-700">{c.label}</b> {c.text}
                </span>
              ))}
            </div>
          )}
          <div className="mt-6 flex flex-col gap-1.5">
            <button
              ref={primaryRef}
              type="button"
              onClick={go}
              className="inline-flex items-center justify-center gap-2 rounded-[14px] bg-violet-600 hover:bg-violet-700 px-4 py-3.5 text-base font-bold text-white shadow-[0_14px_30px_-12px_rgba(124,58,237,0.8)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
            >
              이미지 스튜디오 보기
              <ArrowRight className="w-4 h-4" />
            </button>
            <button type="button" onClick={close} className="py-2 text-[13px] text-slate-400 hover:text-slate-600 transition-colors">다음에 볼게요</button>
            <button type="button" onClick={() => void dismiss()} disabled={dismissing} className="pb-1 text-[12px] text-slate-400 underline underline-offset-2 hover:text-slate-600 transition-colors disabled:opacity-50">
              이 소개 다시 보지 않기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
