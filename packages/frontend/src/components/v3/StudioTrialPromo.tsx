/**
 * StudioTrialPromo — 로그인 직후 「이미지 스튜디오 무료체험 3회」 안내 창 (★ 2026-11-15 C135 · 설계서 docs/2026-11-15-v3-popup-trial-design.md §4)
 *
 * Harold 「요금제 미가입 업체에 기한 없는 3회 무료체험 · MMS 에 바로 활용 · 제품 이미지 누끼 → 포스터 합성 ·
 *   무료체험 3회 이용하고 싶습니다를 눌러야 3회만 체험으로 열림」.
 * 누가 보는지(체험 자격이 있고 아직 신청하지 않은 회사) · 몇 번 띄울지는 서버가 정한다(AiOperatorLoginPromo 의 선점 응답 variant 'trial').
 *   이 컴포넌트는 그 창의 안쪽이다: 틀의 규칙(탭 사이 한 번 · 다른 자동 안내 창과 안 겹침 · Esc · Tab 가두기 · 스크롤 잠금)은 AiOperatorLoginPromo 가 그대로 맡는다.
 * 창 안쪽(무대 · 글 · 버튼)은 승인된 목업에서 떼어 온 마크업(v3-popup-parts.ts) · 움직임 = v3-motion.ts.
 * 「무료체험 3회 이용하고 싶습니다」 = 서버에 신청(POST /api/image-studio/trial/request) → 열렸다는 답을 받은 뒤에만 「열렸습니다」를 보인다.
 * 기록 = 그 버튼을 누름(go) → 슈퍼관리자 「기능 관심 업체」(뜸 open 은 틀이 남긴다). 신청 자체는 체험 표에 남는다.
 * 바깥을 눌러도 닫히지 않는다(X · Esc · 「다음에 볼게요」).
 */
import { useEffect, useRef, type MouseEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { STUDIO_TRIAL_POPUP_ID } from '../../constants/login-popups';
import { reportPlanFeature } from '../../utils/plan-feature-report';
import { requestStudioTrial } from '../../utils/studio-trial';
import { dismissV3Intro } from '../../utils/v3-intro';
import { useToast } from '../ToastProvider';
import { V3_POPUP_CSS, V3_TRIAL_HTML } from './v3-popup-parts';
import { mountTrialStage } from './v3-motion';

const TRIAL_INNER = { __html: V3_TRIAL_HTML };

export default function StudioTrialPromo({ introKey, rootRef, onClose }: {
  /** 이 창의 판 열쇠(「이 안내 다시 보지 않기」가 서버에 돌려보낸다) */
  introKey?: string;
  /** 틀(AiOperatorLoginPromo)이 Tab 가두기에 쓰는 창 자리 */
  rootRef: RefObject<HTMLDivElement>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const busyRef = useRef(false);

  /**
   * 지금 안 보이는 버튼은 잠가 둔다(disabled) — 틀의 Tab 가두기는 「잠기지 않은 버튼」의 처음과 끝으로 돈다.
   *   숨은 버튼이 끝 자리에 끼면 마지막 보이는 버튼에서 Tab 이 창 밖으로 샌다.
   *   신청 전 = 「이미지 스튜디오로 가기」 잠금 · 신청 뒤 = 신청 · 다음에 · 다시 보지 않기 잠금.
   */
  const lockHidden = (pop: HTMLElement, opened: boolean) => {
    for (const el of Array.from(pop.querySelectorAll<HTMLElement>('[data-act]'))) {
      const act = el.dataset.act;
      const hidden = act === 'studio' ? !opened : act === 'trial' || act === 'later' || act === 'dismiss' ? opened : false;
      el.toggleAttribute('disabled', hidden);
    }
  };

  useEffect(() => {
    const pop = rootRef.current;
    if (!pop) return;
    lockHidden(pop, pop.classList.contains('opened'));
    const stop = mountTrialStage(pop);
    // 처음 포커스 = 신청 버튼. 틀이 「원래 포커스 자리」를 먼저 적어 둔 다음에 옮긴다(닫으면 그 자리로 돌아간다)
    const t = window.setTimeout(() => pop.querySelector<HTMLElement>('[data-act="trial"]')?.focus(), 0);
    return () => { window.clearTimeout(t); stop(); };
  }, [rootRef]);

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

  /** 「이 안내 다시 보지 않기」 — 서버에 적힌 뒤에만 약속한다(못 적으면 그렇다고 말하고 닫는다) */
  const dismiss = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const saved = await dismissV3Intro(introKey);
    busyRef.current = false;
    if (saved) toast.success('이 계정에서는 다시 띄우지 않아요');
    else toast.error('저장하지 못했어요. 다음에 다시 눌러 주세요.');
    onClose();
  };

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const act = el?.dataset.act;
    if (!el || !act) return;
    if (act === 'close' || act === 'later') onClose();
    else if (act === 'trial') void request(el);
    else if (act === 'dismiss') void dismiss();
    else if (act === 'studio') { onClose(); navigate('/image-studio'); }
  };

  return createPortal(
    <div className="v3p">
      <style>{V3_POPUP_CSS}</style>
      <div className="scrim" />
      <div
        ref={rootRef}
        className="pop qA"
        role="dialog"
        aria-modal="true"
        aria-label="이미지 스튜디오 무료체험 안내"
        onClick={onClick}
        dangerouslySetInnerHTML={TRIAL_INNER}
      />
    </div>,
    document.body,
  );
}
