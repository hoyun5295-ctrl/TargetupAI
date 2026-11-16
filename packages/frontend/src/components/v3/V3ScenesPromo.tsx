/**
 * V3ScenesPromo — 로그인 직후 「한줄로 V3」 장면 창의 안쪽 (★ 2026-11-16 C136 · 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §2-3)
 *
 * 어제(C135)까지 로그인 화면에 뜨던 V3 안내 창을 로그인 뒤로 옮긴 것이다(Harold 「의미없이 전부 공개로 해놓으면 서비스 내용만 가져가서 복제 · 안내창도 마찬가지로」).
 *   장면 넷(무엇을 보여 주는지는 서버 보관 글이 원본이다 = backend content/gated/v3-popup.ts · 여기에 장면의 내용을 적지 않는다).
 *   (로그인 화면 창의 다섯째 장면 = 인증 안내 요약은 뺐다. 로그인 화면은 종전 인증 안내 창으로 돌아갔다.)
 * 창의 글 · 그림은 이 번들에 없다 — 틀(AiOperatorLoginPromo)이 서버에서 받아 그림까지 끼운 문자열(css · html)과 업종 셋(sets)을 넘겨준다.
 *   이 컴포넌트는 그 문자열을 창에 넣고 버튼 동작만 맡는다. 움직임 = v3-motion.ts.
 * 누가 · 몇 번 보는지와 틀의 규칙(탭 사이 한 번 · 다른 자동 안내 창과 안 겹침 · Esc · Tab 가두기 · 스크롤 잠금)은 틀이 맡는다.
 * 버튼 = 「이미지 스튜디오 보기」(누름 기록 go) · 「다음에 볼게요」 · 「이 소개 다시 보지 않기」(서버에 적힌 뒤에만 약속한다) · 닫기(X).
 * 바깥을 눌러도 닫히지 않는다.
 */
import { useEffect, useMemo, useRef, type MouseEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { reportPlanFeature } from '../../utils/plan-feature-report';
import { dismissV3Intro } from '../../utils/v3-intro';
import { useToast } from '../ToastProvider';
import { mountScenes, type MorphSet } from './v3-motion';

/** 기록의 기능 id — 틀(AiOperatorLoginPromo LOGIN_PROMO_FEATURE_ID) · 등록부(constants/login-popups.ts)와 같은 값 */
const FEATURE_ID = 'login-promo';

export default function V3ScenesPromo({ introKey, css, html, sets, rootRef, onClose }: {
  /** 이 창의 판 열쇠(「이 소개 다시 보지 않기」가 서버에 돌려보낸다) */
  introKey: string;
  /** 서버가 준 글(그림 주소까지 끼운 것) */
  css: string;
  html: string;
  sets: readonly MorphSet[];
  /** 틀이 Tab 가두기에 쓰는 창 자리 */
  rootRef: RefObject<HTMLDivElement>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const busyRef = useRef(false);
  // 다시 그려져도 같은 객체 = React 가 안쪽 마크업을 다시 쓰지 않는다(움직임이 붙인 class 가 지워지지 않는다)
  const inner = useMemo(() => ({ __html: html }), [html]);

  useEffect(() => {
    const pop = rootRef.current;
    if (!pop) return;
    const stop = mountScenes(pop, sets);
    // 처음 포커스 = 창 자체(버튼에 포커스 테두리가 미리 그려지지 않는다). 틀이 「원래 포커스 자리」를 먼저 적어 둔 다음에 옮긴다
    const t = window.setTimeout(() => pop.focus(), 0);
    return () => { window.clearTimeout(t); stop(); };
  }, [rootRef, sets]);

  /** 「이 소개 다시 보지 않기」 — 서버에 적힌 뒤에만 약속한다(못 적으면 그렇다고 말하고 닫는다) */
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
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'close' || act === 'later') onClose();
    else if (act === 'dismiss') void dismiss();
    else if (act === 'go') { reportPlanFeature(FEATURE_ID, 'go'); onClose(); navigate('/image-studio'); }
  };

  return createPortal(
    <div className="v3p">
      <style>{css}</style>
      <div className="scrim" />
      <div
        ref={rootRef}
        className="pop pA"
        data-pager=""
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="한줄로 V3 안내"
        onClick={onClick}
        dangerouslySetInnerHTML={inner}
      />
    </div>,
    document.body,
  );
}
