/**
 * HelpDock — 도움말 런처 + 패널 마운트 (★ 2026-08-22). App.tsx 라우트 바깥에 하나만 둔다.
 *
 * 노출 = 서버가 준 `eligible`(요금제 사용 중인 회사)뿐. 프론트는 요금제를 판정하지 않는다.
 * 런처는 인터럽트(`data-interrupt-open`)가 뜨면 숨고, 토스트(`data-toast-open`)가 뜨면 위로 비켜선다.
 * 캔버스 화면(/dm-builder · /image-studio)과 로그인·관리자 화면에서는 띄우지 않는다.
 * 패널 컴포넌트는 App.tsx가 lazy로 만들어 넘긴다(동적 import 리터럴은 App.tsx 안에 있어야 난독화 예외를 탄다).
 */
import { Suspense, useEffect, useState, type ComponentType } from 'react';
import { useLocation } from 'react-router-dom';
import { LifeBuoy, X } from 'lucide-react';
import { useSurfaceFlag } from '../../lib/surface-flags';
import { fetchHelpContext, isHelpHiddenPath, type HelpContext } from './help-api';
import { HELP_LAUNCHER_BTN, HELP_LAUNCHER_COUNT, HELP_LAUNCHER_LABEL, HELP_LAUNCHER_WRAP, HELP_LAUNCHER_WRAP_SHIFTED } from './help-ui';

interface PanelProps { ctx: HelpContext; path: string; onClose: () => void }

interface Props {
  Panel: ComponentType<PanelProps>;
}

/** 한 세션에서 "대상 아님"이 한 번 나오면 다시 묻지 않는다(화면을 옮길 때마다 요금제 조회를 안 한다) */
let ineligibleOnce = false;

export default function HelpDock({ Panel }: Props) {
  const location = useLocation();
  const path = location.pathname;
  const [ctx, setCtx] = useState<HelpContext | null>(null);
  const [open, setOpen] = useState(false);
  const interrupt = useSurfaceFlag('data-interrupt-open');
  const toast = useSurfaceFlag('data-toast-open');

  const hidden = isHelpHiddenPath(path) || !localStorage.getItem('token');

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

  // 인터럽트가 뜨면 패널도 닫는다(차단 창 뒤에 열려 있으면 혼란)
  useEffect(() => { if (interrupt) setOpen(false); }, [interrupt]);

  if (hidden || !ctx || !ctx.eligible || interrupt) return null;

  const onboarding = ctx.mode === 'onboarding';
  const done = onboarding ? (ctx.wizard?.available && ctx.wizard.step ? Math.max(0, ctx.wizard.step - 1) : 0) : 0;

  return (
    <>
      {open && (
        <Suspense fallback={null}>
          <Panel ctx={ctx} path={path} onClose={() => setOpen(false)} />
        </Suspense>
      )}
      <div className={toast ? HELP_LAUNCHER_WRAP_SHIFTED : HELP_LAUNCHER_WRAP}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? '도움말 닫기' : '도움말 열기'}
          aria-expanded={open}
          className={HELP_LAUNCHER_BTN}
        >
          {open ? <X className="w-5 h-5" strokeWidth={2.2} /> : <LifeBuoy className="w-5 h-5" strokeWidth={2} />}
          {!open && onboarding && (
            <span className={HELP_LAUNCHER_LABEL}>
              시작 안내{ctx.wizard?.available && <span className={`${HELP_LAUNCHER_COUNT} ml-1.5`}>{done}/5</span>}
            </span>
          )}
        </button>
      </div>
    </>
  );
}
