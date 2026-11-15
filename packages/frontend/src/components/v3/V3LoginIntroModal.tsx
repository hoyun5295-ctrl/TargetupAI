/**
 * V3LoginIntroModal — 로그인 화면의 「한줄로 V3 업그레이드」 안내 창 (★ 2026-11-15 C135 · 설계서 docs/2026-11-15-v3-popup-trial-design.md §2)
 *
 * Harold 「로그인 화면 팝업을 한줄로 V3 업그레이드 소개로 · 페이징 · 모션그래픽처럼 · 장면은 이야기로」.
 *   다섯 장면 = ① 제품 사진 → 누끼 → 포스터 ② 담아 두고 안 산 고객에게 바로 보내기 ③ 가입하는 순간 환영 알림톡 → 여정이 자동으로
 *   ④ 같은 업종 평균과 비교 ⑤ 인증 안내(지금의 인증 안내 창 요약 · 「인증 안내 전체 보기」 = 그 창).
 * 띄울지는 LoginNoticeSwitch 가 정한다(스위치 = 서버 ENV · 꺼져 있으면 종전 인증 안내 창).
 * 창 안쪽(장면 · 글 · 쪽 번호)은 승인된 목업에서 떼어 온 마크업(v3-popup-parts.ts)이고, 움직임은 v3-motion.ts 가 맡는다.
 *   이 컴포넌트는 창의 틀 · 키보드 규칙 · 버튼 동작만 맡는다(다시 그려져도 안쪽 마크업은 같은 문자열이라 그대로 둔다).
 * 바깥을 눌러도 닫히지 않는다(X · Esc · 「오늘 하루 보지 않기」). 기록 = 없음(로그인 전 = 회사를 모른다).
 */
import { useEffect, useRef, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { CHANGES, hideLoginPolicyNoticeToday } from '../LoginPolicyNoticeModal';
import { V3_POPUP_CSS, V3_LOGIN_HTML } from './v3-popup-parts';
import { mountLoginIntro } from './v3-motion';
import { useDialogTrap } from './use-dialog-trap';

/** 「V3 자세히 보기」가 가는 공개 페이지(정적 파일 · public/about-v3.html) */
export const V3_PAGE_PATH = '/about-v3.html';

const LOGIN_INNER = { __html: V3_LOGIN_HTML };

export default function V3LoginIntroModal({ onClose, onAuthNotice }: {
  onClose: () => void;
  /** 「인증 안내 전체 보기」 — 종전 인증 안내 창으로 바꾼다 */
  onAuthNotice: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    // 다섯째 장면의 세 줄 = 인증 안내 창의 CHANGES 그대로(문구 원본 한 곳 · 유지 시간이 바뀌면 같이 바뀐다)
    const list = pop.querySelector('[data-auth]');
    if (list) {
      list.replaceChildren(...CHANGES.map((c, i) => {
        const li = document.createElement('li');
        li.style.setProperty('--i', String(i));
        const b = document.createElement('b');
        b.textContent = c.label;
        li.append(b, c.title);
        return li;
      }));
    }
    return mountLoginIntro(pop);
  }, []);

  useDialogTrap(popRef, onClose);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'close') onClose();
    else if (act === 'hide-today') { hideLoginPolicyNoticeToday(); onClose(); }
    else if (act === 'go') window.location.assign(V3_PAGE_PATH);
    else if (act === 'auth') onAuthNotice();
  };

  return createPortal(
    <div className="v3p">
      <style>{V3_POPUP_CSS}</style>
      <div className="scrim" />
      <div
        ref={popRef}
        className="pop pA"
        data-pager=""
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="한줄로 V3 업그레이드 안내"
        onClick={onClick}
        dangerouslySetInnerHTML={LOGIN_INNER}
      />
    </div>,
    document.body,
  );
}
