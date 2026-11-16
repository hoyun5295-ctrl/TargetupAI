/**
 * StudioTrialPromo — 로그인 직후 「이미지 스튜디오 무료체험 3회」 안내 창 (★ 2026-11-15 C135 · 설계서 docs/2026-11-15-v3-popup-trial-design.md §4)
 *
 * Harold 「요금제 미가입 업체에 기한 없는 3회 무료체험 · MMS 에 바로 활용 · 제품 이미지 누끼 → 포스터 합성 ·
 *   무료체험 3회 이용하고 싶습니다를 눌러야 3회만 체험으로 열림」.
 * 누가 보는지(체험 자격이 있고 아직 신청하지 않은 회사) · 몇 번 띄울지는 서버가 정한다(AiOperatorLoginPromo 의 선점 응답 variant 'trial').
 *   이 컴포넌트는 그 창의 안쪽이다: 틀의 규칙(탭 사이 한 번 · 다른 자동 안내 창과 안 겹침 · Esc · Tab 가두기 · 스크롤 잠금)은 AiOperatorLoginPromo 가 그대로 맡는다.
 * 창 안쪽(무대 · 글 · 버튼)의 글 · 그림은 이 번들에 없다(★ 2026-11-16 C136) — 틀이 로그인 뒤 서버에서 받아 그림까지 끼운 문자열(css · html)과 업종 셋(sets)을 넘겨준다 · 움직임 = v3-motion.ts.
 * 「무료체험 3회 이용하고 싶습니다」 = 서버에 신청(POST /api/image-studio/trial/request) → 열렸다는 답을 받은 뒤에만 「열렸습니다」를 보인다.
 * 기록 = 그 버튼을 누름(go) → 슈퍼관리자 「기능 관심 업체」(뜸 open 은 틀이 남긴다). 신청 자체는 체험 표에 남는다.
 * 바깥을 눌러도 닫히지 않는다(X · Esc · 「다음에 볼게요」).
 * ★ 2026-11-16 C138 「이 안내 다시 보지 않기」는 없앴다(Harold 「그거 눌러버리면 홍보가 안 되는데」 · 서버 보관 글에서도 뺐다 · 계정당 최대 3번은 그대로).
 */
import { useEffect, useMemo, useRef, type MouseEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { STUDIO_TRIAL_POPUP_ID } from '../../constants/login-popups';
import { reportPlanFeature } from '../../utils/plan-feature-report';
import { requestStudioTrial } from '../../utils/studio-trial';
import { useToast } from '../ToastProvider';
import { mountTrialStage, type MorphSet } from './v3-motion';

export default function StudioTrialPromo({ css, html, sets, rootRef, onClose }: {
  /** 서버가 준 글(그림 주소까지 끼운 것) */
  css: string;
  html: string;
  sets: readonly MorphSet[];
  /** 틀(AiOperatorLoginPromo)이 Tab 가두기에 쓰는 창 자리 */
  rootRef: RefObject<HTMLDivElement>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const busyRef = useRef(false);
  // 다시 그려져도 같은 객체 = React 가 안쪽 마크업을 다시 쓰지 않는다(신청 뒤 붙인 class · 잠금이 지워지지 않는다)
  const inner = useMemo(() => ({ __html: html }), [html]);

  /**
   * 지금 안 보이는 버튼은 잠가 둔다(disabled) — 틀의 Tab 가두기는 「잠기지 않은 버튼」의 처음과 끝으로 돈다.
   *   숨은 버튼이 끝 자리에 끼면 마지막 보이는 버튼에서 Tab 이 창 밖으로 샌다.
   *   보이는 줄은 글의 CSS 가 정한다: 신청 전 = .trial 줄 · 신청 뒤 = .done 줄 → 숨은 줄 안의 버튼을 전부 잠근다
   *   (★ 2026-11-16 C138 버튼 이름을 세지 않는다 — 배포 중 받은 옛 글에 다른 버튼이 있어도 숨은 줄이면 잠긴다).
   */
  const lockHidden = (pop: HTMLElement, opened: boolean) => {
    for (const el of Array.from(pop.querySelectorAll<HTMLElement>('.trial button, .done button'))) {
      el.toggleAttribute('disabled', el.closest('.trial') ? opened : !opened);
    }
  };

  useEffect(() => {
    const pop = rootRef.current;
    if (!pop) return;
    lockHidden(pop, pop.classList.contains('opened'));
    const stop = mountTrialStage(pop, sets);
    // 처음 포커스 = 신청 버튼. 틀이 「원래 포커스 자리」를 먼저 적어 둔 다음에 옮긴다(닫으면 그 자리로 돌아간다)
    const t = window.setTimeout(() => pop.querySelector<HTMLElement>('[data-act="trial"]')?.focus(), 0);
    return () => { window.clearTimeout(t); stop(); };
  }, [rootRef, sets]);

  /** 신청 — 요청 하나가 끝날 때까지 다시 누르지 못한다(버튼 잠금) · 열렸다는 답을 받은 뒤에만 「열렸습니다」 */
  const request = async (btn: HTMLElement) => {
    if (busyRef.current) return;
    busyRef.current = true;
    btn.setAttribute('disabled', '');
    reportPlanFeature(STUDIO_TRIAL_POPUP_ID, 'go');
    const state = await requestStudioTrial();
    busyRef.current = false;
    btn.removeAttribute('disabled');
    const pop = rootRef.current;
    if (!pop) return;
    if (!state || !state.requested) { toast.error('지금은 열지 못했어요. 잠시 뒤 다시 눌러 주세요.'); return; }
    const left = pop.querySelector('[data-remaining]');
    if (left) left.textContent = `남은 횟수 ${state.remaining}회`;
    pop.classList.add('opened');
    lockHidden(pop, true);
    pop.querySelector<HTMLElement>('[data-act="studio"]')?.focus();
  };

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const act = el?.dataset.act;
    if (!el || !act) return;
    if (act === 'close' || act === 'later') onClose();
    else if (act === 'trial') void request(el);
    else if (act === 'studio') { onClose(); navigate('/image-studio'); }
  };

  return createPortal(
    <div className="v3p">
      <style>{css}</style>
      <div className="scrim" />
      <div
        ref={rootRef}
        className="pop qA"
        role="dialog"
        aria-modal="true"
        aria-label="이미지 스튜디오 무료체험 안내"
        onClick={onClick}
        dangerouslySetInnerHTML={inner}
      />
    </div>,
    document.body,
  );
}
