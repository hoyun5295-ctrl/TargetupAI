/**
 * AiOperatorLoginPromo — 로그인 직후 안내 창의 틀 (★ 2026-10-06 Harold 지시 · 목업 승인 → ★ 2026-11-13 C133 F7 → ★ 2026-11-15 C135 → ★ 2026-11-16 C136)
 *
 * 이 컴포넌트는 틀이다: 누가 · 몇 번 · 언제 띄우는지와 창이 열려 있는 동안의 키보드 규칙을 맡고, 창의 안쪽은 서버가 정한 판이 그린다.
 *   - 판 = 「한줄로 V3」 장면 창(V3ScenesPromo) · 이미지 스튜디오 무료체험 창(StudioTrialPromo · 요금제 미가입 + 아직 신청 안 한 회사).
 *   - 대상 · 노출 = 서버가 정한다(고객사 사용자 · 한 계정에 최대 3번 · 한 로그인에 한 번 · 「다시 보지 않기」 = 그 계정에 영구 · backend utils/v3-intro.ts).
 *   - 바깥을 눌러도 닫히지 않는다(X · Esc · 「다음에 볼게요」).
 * ★ 2026-11-16 C136(설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §2 · Harold 「의미없이 전부 공개로 해놓으면 서비스 내용만 가져가서 복제」)
 *   창의 글 · 그림은 이 번들에 없다. 로그인 뒤 서버가 준다. 순서 = 준비(peek · 노출을 쓰지 않는다) → 그림 전부 받기 → 선점(claim · 노출 한 번) → 띄움.
 *   그림을 하나라도 못 받으면 선점하지 않는다(그림 장애가 노출 수를 태우지 않는다 · Codex 설계 1R). 닫으면 받아 둔 그림 주소를 버린다.
 * 빈도 = 로그인 한 번마다 한 번(토큰은 로그인할 때만 새로 저장된다 · authStore) · 같은 로그인에서는 새로고침해도 다시 뜨지 않는다.
 * 기록 = 뜬 것(open) · 주 버튼(go) → 슈퍼관리자 「기능 관심 업체」(등록부 constants/login-popups.ts).
 * ★ Codex 1R(1006) — ① 탭 두 개가 함께 들어와도 한 번: 탭 사이 잠금(navigator.locks) 안에서 표식을 다시 보고 저장한 탭만 묻고 띄운다
 *   ② 다른 자동 안내 창(요금제 변경 알림 · 마케팅 진단 초대)과 겹치지 않게 부모가 blocked 를 주면 그 창이 닫힐 때까지 기다린다(표식 = 실제로 물을 때)
 *   ③ Tab · Shift+Tab 은 창 안에서만 돌고, 닫으면 포커스를 원래 자리로 돌려놓는다.
 * ★ Codex 2R(1006) — 「한 번」은 원자적으로 잡을 수 있을 때만 약속한다: 탭 사이 잠금이 없거나 표식을 저장하지 못하면 띄우지 않는다
 *   (모르면 띄우지 않는다 · 중복 노출 · 닫아도 다시 뜨는 것보다 안 뜨는 쪽) · 한 화면에서는 한 번 물으면 다시 묻지 않는다.
 */
import { useEffect, useRef, useState } from 'react';
import { STUDIO_TRIAL_POPUP_ID } from '../constants/login-popups';
import { resolveGated, type ResolvedGated } from '../utils/gated-content';
import { reportPlanFeature } from '../utils/plan-feature-report';
import { claimV3Intro, peekV3Intro, type V3IntroVariant } from '../utils/v3-intro';
import StudioTrialPromo from './v3/StudioTrialPromo';
import V3ScenesPromo from './v3/V3ScenesPromo';
import { readMorphSets, type MorphSet } from './v3/v3-motion';

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

/** 띄울 창 — 판 열쇠 · 판 · 그림까지 받은 글 · 업종 셋 */
interface Shown { introKey: string; variant: V3IntroVariant; text: ResolvedGated; sets: MorphSet[] }

export default function AiOperatorLoginPromo({ blocked = false }: { /** 다른 자동 안내 창이 열려 있으면 true — 닫힐 때까지 기다린다 */ blocked?: boolean }) {
  const [eligible, setEligible] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const askedRef = useRef(false); // 한 화면에서 한 번 — 닫은 뒤 효과가 다시 돌아도 다시 묻지 않는다
  const dialogRef = useRef<HTMLDivElement>(null);
  const open = shown !== null;

  // ① 후보 판정 — 이 로그인에서 아직 안 물었으면 후보(대상인지 · 계정당 3번을 넘었는지는 ② 의 서버가 정한다)
  useEffect(() => {
    const mark = loginMark();
    if (!mark || readSeen() === mark) return;
    setEligible(true);
  }, []);

  // ② 표시 — 다른 자동 안내 창이 없을 때 · 탭 사이 잠금 안에서 표식을 다시 보고 저장한 탭만: 준비 → 그림 받기 → 선점 → 띄움
  useEffect(() => {
    if (!eligible || blocked || open || askedRef.current) return;
    const mark = loginMark();
    const locks = (navigator as any).locks;
    if (!mark || !locks?.request) return; // 탭 사이 잠금이 없으면 「한 번」을 지킬 수 없다 → 띄우지 않는다
    let alive = true;
    const take = (): boolean => {
      if (!alive || readSeen() === mark) return false; // 그 사이 막혔으면(다른 안내 창 · 화면 이동) 표식을 잡지 않는다 — 다음 기회에 묻는다
      return writeSeen(mark); // 저장 못 하면 잡지 않는다(닫아도 다시 뜨는 것을 막는다)
    };
    const run = async () => {
      const won: boolean = await locks.request('ai-op-login-promo', async () => take());
      if (!alive || !won) return;
      askedRef.current = true; // 이 화면은 여기서 끝 — 서버가 띄우지 말라고 답해도 다시 묻지 않는다
      const peek = await peekV3Intro(); // 준비(노출을 쓰지 않는다 · 대상 · 판 판정)
      if (!alive || !peek) return;
      const text = await resolveGated(peek.content); // 그림 전부 받기(하나라도 못 받으면 null)
      if (!text) return;
      if (!alive) { text.release(); return; }
      const claimed = await claimV3Intro(peek.introKey); // 선점(노출 한 번 · 그 사이 판이 바뀌었으면 false)
      if (!alive || !claimed) { text.release(); return; }
      setShown({ introKey: peek.introKey, variant: peek.variant, text, sets: readMorphSets(peek.content.sets) });
      reportPlanFeature(peek.variant === 'trial' ? STUDIO_TRIAL_POPUP_ID : LOGIN_PROMO_FEATURE_ID, 'open');
    };
    void run().catch(() => { /* 잠금 실패 = 이번에는 띄우지 않는다 */ });
    return () => { alive = false; };
  }, [eligible, blocked, open]);

  // 열려 있는 동안: Esc 닫기 · Tab 은 창 안에서만 · 뒤 화면 스크롤 잠금 · 닫으면 포커스 복귀(처음 포커스는 안쪽 창이 정한다)
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShown(null); return; }
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
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open]);

  // 닫히면(또는 화면을 떠나면) 받아 둔 그림 주소를 버린다 — 로그아웃 뒤에 남지 않게
  const text = shown?.text;
  useEffect(() => () => { text?.release(); }, [text]);

  if (!shown) return null;
  const close = () => setShown(null);
  const inner = { introKey: shown.introKey, css: shown.text.css, html: shown.text.html, sets: shown.sets, rootRef: dialogRef, onClose: close };
  return shown.variant === 'trial' ? <StudioTrialPromo {...inner} /> : <V3ScenesPromo {...inner} />;
}
