/**
 * HelpDock — 도움말 런처 + 패널 마운트 (★ 2026-08-22). App.tsx 라우트 바깥에 하나만 둔다.
 *
 * 노출 = 서버가 준 `eligible`(요금제 사용 중인 회사)뿐. 프론트는 요금제를 판정하지 않는다.
 * 런처는 인터럽트(`data-interrupt-open`)가 뜨면 숨는다.
 * 캔버스 화면(/dm-builder · /image-studio)과 로그인·관리자 화면에서는 띄우지 않는다.
 * 패널 컴포넌트는 App.tsx가 lazy로 만들어 넘긴다(동적 import 리터럴은 App.tsx 안에 있어야 난독화 예외를 탄다).
 *
 * ★ 2026-08-22(2) 세 가지가 바뀌었다.
 *   1. 열림 상태를 `lib/help-open.ts`가 소유한다 — 진입점이 둘(여기 런처 · 대시보드 헤더 버튼)이라
 *      각자 들면 한쪽에서 연 것을 다른 쪽이 모른다.
 *   2. 토스트에 비켜서던 동작을 걷어냈다 — 공용 알림은 우측 상단이라 애초에 겹치지 않았다.
 *   3. 첫 진입 1회 티저 — Harold "우측 아래 버튼은 봤지만 저게 도움말인지 어떻게 알겠냐".
 *      1.2초 뒤 문구가 펼쳐지고 4초 뒤 스스로 접힌다. 누르면 즉시 접고 다음부터 뜨지 않는다.
 */
import { Suspense, useEffect, useState, type ComponentType } from 'react';
import { useLocation } from 'react-router-dom';
import { LifeBuoy, X } from 'lucide-react';
import { useSurfaceFlag } from '../../lib/surface-flags';
import { closeHelp, setHelpEligible, toggleHelp, useHelpOpen } from '../../lib/help-open';
import { fetchHelpContext, isHelpHiddenPath, type HelpContext } from './help-api';
import {
  HELP_LAUNCHER_BTN, HELP_LAUNCHER_COUNT, HELP_LAUNCHER_ICON, HELP_LAUNCHER_TEXT,
  HELP_LAUNCHER_TEXT_CLOSED, HELP_LAUNCHER_TEXT_OPEN, HELP_LAUNCHER_WRAP, HELP_TEASE_TEXT,
} from './help-ui';

interface PanelProps { ctx: HelpContext; path: string; onClose: () => void }

interface Props {
  Panel: ComponentType<PanelProps>;
}

/** 한 세션에서 "대상 아님"이 한 번 나오면 다시 묻지 않는다(화면을 옮길 때마다 요금제 조회를 안 한다) */
let ineligibleOnce = false;
/** 티저는 계정당 1회. 저장이 막힌 브라우저에서도 이 세션 안에서는 두 번 뜨지 않게 모듈에서 한 번 더 잠근다 */
let teasedOnce = false;
const TEASE_KEY = 'help_teased_v1';
/** 펼쳐지기까지 · 펼친 뒤 접히기까지 */
const TEASE_DELAY_MS = 1200;
const TEASE_HOLD_MS = 4000;

export default function HelpDock({ Panel }: Props) {
  const location = useLocation();
  const path = location.pathname;
  const [ctx, setCtx] = useState<HelpContext | null>(null);
  const open = useHelpOpen();
  const [teasing, setTeasing] = useState(false);
  const interrupt = useSurfaceFlag('data-interrupt-open');

  const hidden = isHelpHiddenPath(path) || !localStorage.getItem('token');
  const eligible = !!ctx?.eligible;

  useEffect(() => {
    if (hidden || ineligibleOnce) return;
    let alive = true;
    const t = setTimeout(() => {
      fetchHelpContext(path).then((c) => {
        if (!alive) return;
        if (!c.eligible) { ineligibleOnce = true; setCtx(null); return; }
        setCtx(c);
      }).catch(() => { if (alive) setCtx(null); });
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [path, hidden]);

  // 헤더 버튼이 자기를 보일지 판단할 근거. 판정은 서버 한 곳이고 그 응답을 받는 곳이 여기다
  useEffect(() => { setHelpEligible(eligible); }, [eligible]);

  // 인터럽트가 뜨면 패널을 닫는다(차단 창 뒤에 열려 있으면 혼란). open도 같이 보므로 헤더로 연 경우도 걸린다
  useEffect(() => { if (interrupt && open) closeHelp(); }, [interrupt, open]);

  // 티저 펼침 — 대상 회사에 첫 1회만
  useEffect(() => {
    if (hidden || !eligible || teasedOnce || open) return;
    let stored: string | null = null;
    try { stored = localStorage.getItem(TEASE_KEY); } catch { stored = null; }
    if (stored) { teasedOnce = true; return; }
    const t = setTimeout(() => {
      teasedOnce = true;
      try { localStorage.setItem(TEASE_KEY, '1'); } catch { /* 저장이 막힌 브라우저 — 모듈 잠금으로 갈음 */ }
      setTeasing(true);
    }, TEASE_DELAY_MS);
    return () => clearTimeout(t);
  }, [hidden, eligible, open]);

  // 티저 접힘 — 펼쳐진 뒤부터 센다(화면을 옮겨도 펼쳐진 채 남지 않게 `teasing`에 매단다)
  useEffect(() => {
    if (!teasing) return;
    const t = setTimeout(() => setTeasing(false), TEASE_HOLD_MS);
    return () => clearTimeout(t);
  }, [teasing]);

  // 열면 티저는 제 몫을 다한 것이다
  useEffect(() => { if (open) setTeasing(false); }, [open]);

  if (hidden || !ctx || !eligible || interrupt) return null;

  const onboarding = ctx.mode === 'onboarding';
  const done = onboarding ? (ctx.wizard?.available && ctx.wizard.step ? Math.max(0, ctx.wizard.step - 1) : 0) : 0;
  // 접힌 상태가 기본이고, 티저 중이거나 온보딩 안내가 있을 때만 문구 자리가 열린다
  const textOpen = !open && (teasing || onboarding);

  return (
    <>
      {open && (
        <Suspense fallback={null}>
          <Panel ctx={ctx} path={path} onClose={closeHelp} />
        </Suspense>
      )}
      <div className={HELP_LAUNCHER_WRAP}>
        <button
          type="button"
          onClick={toggleHelp}
          aria-label={open ? '도움말 닫기' : '도움말 열기'}
          aria-expanded={open}
          className={HELP_LAUNCHER_BTN}
        >
          <span className={HELP_LAUNCHER_ICON}>
            {open ? <X className="w-5 h-5" strokeWidth={2.2} /> : <LifeBuoy className="w-5 h-5" strokeWidth={2} />}
          </span>
          <span className={`${HELP_LAUNCHER_TEXT} ${textOpen ? HELP_LAUNCHER_TEXT_OPEN : HELP_LAUNCHER_TEXT_CLOSED}`} aria-hidden={!textOpen}>
            {teasing ? HELP_TEASE_TEXT : (
              <>
                시작 안내
                {ctx.wizard?.available && <span className={HELP_LAUNCHER_COUNT}>{done}/5</span>}
              </>
            )}
          </span>
        </button>
      </div>
    </>
  );
}
