/**
 * RowActions.tsx — 표 한 행의 액션 묶음 (카카오 & RCS 표면 전용)
 *
 * 왜 있는가 (2026-08-17):
 *   이 화면의 관리 열에는 상태별로 액션이 최대 6개(상세보기/수정/검수요청/반려사유/재검수/삭제/이력) 붙었고,
 *   전부 `text-[11px]` 버튼으로 나란히 놓여 표 폭을 넘겼다(가로 스크롤 사고가 주석에 남아 있다).
 *   **대표 하나만 글자로 두고 나머지는 ⋯ 뒤로** 접는다. 대표 액션은 여전히 1클릭이다.
 *
 *   표 3곳(알림톡·브랜드·RCS)이 같은 형태를 쓰므로 인라인 3벌 대신 여기가 소유한다.
 *
 * 계약
 *   - `actions[0]`이 대표다. 호출부가 **상태에 맞는 대표를 0번에 놓는다**(등록이면 검수요청, 반려면 반려사유…).
 *   - 액션이 1개면 ⋯ 자체가 없다.
 *   - `danger`는 목록 안에서만 붉게 표시한다 — 대표 자리에 파괴적 액션을 두지 않는다(오클릭 방지).
 */
import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
  CUI_ACT,
  CUI_ACTS,
  CUI_ACT_MORE,
  CUI_MENU,
  CUI_MENU_ITEM,
  CUI_MENU_ITEM_DANGER,
} from '../../utils/console-ui';

export interface RowAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  actions: RowAction[];
  /** 모바일 카드에서는 행 hover가 없어 항상 펼친 형태가 낫다 */
  align?: 'end' | 'start';
}

export default function RowActions({ actions, align = 'end' }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  if (actions.length === 0) return null;

  const [primary, ...rest] = actions;

  return (
    <div className={`${CUI_ACTS} ${align === 'start' ? 'justify-start' : ''}`}>
      <button type="button" onClick={primary.onClick} className={CUI_ACT}>
        {primary.label}
      </button>

      {rest.length > 0 && (
        <div className="relative" ref={wrapRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={CUI_ACT_MORE}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`더 보기 — ${rest.map((a) => a.label).join(', ')}`}
          >
            <MoreHorizontal className="w-[15px] h-[15px]" />
          </button>

          {open && (
            <div className={CUI_MENU} role="menu">
              {rest.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    a.onClick();
                  }}
                  className={a.danger ? CUI_MENU_ITEM_DANGER : CUI_MENU_ITEM}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
