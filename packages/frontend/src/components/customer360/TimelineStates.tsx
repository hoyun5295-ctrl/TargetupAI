/**
 * TimelineStates — 스켈레톤 · 빈 상태 · 오류 (★ 2026-08-22 v2). 훅 0, props만.
 *
 * 빈 상태는 원인별로 갈리고 전부 **1클릭 복구 버튼**을 준다 — 막다른 길을 만들지 않는다.
 */
import { Clock, RotateCcw } from 'lucide-react';
import {
  CUI_BTN_OUTLINE, CUI_DANGER_BOX, CUI_DANGER_ICON, CUI_DANGER_TEXT, CUI_EMPTY, CUI_EMPTY_BADGE, CUI_EMPTY_DESC, CUI_EMPTY_TITLE,
} from '../../utils/console-ui';
import { AlertTriangle } from 'lucide-react';
import {
  C360_EMPTY_ACTIONS, C360_EMPTY_DESC, C360_EMPTY_LIGHT, C360_EMPTY_TITLE, C360_ERROR_WRAP,
  C360_SK_BAR, C360_SK_SUB, C360_SK_TILE, C360_SK_TIME, C360_SK_TITLE_WIDTHS, C360_ROW, C360_ROW_STATIC,
} from './c360-ui';
import { KIND_STYLE, type TimelineKind } from './timeline-kinds';

export function TimelineSkeleton() {
  return (
    <div aria-busy="true" aria-label="활동 기록 불러오는 중">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={`${C360_ROW} ${C360_ROW_STATIC}`} aria-hidden="true">
          <div className={C360_SK_TIME} />
          <div className={C360_SK_TILE} />
          <div className="min-w-0 pt-0.5">
            <div className={`${C360_SK_BAR} ${C360_SK_TITLE_WIDTHS[i % C360_SK_TITLE_WIDTHS.length]}`} />
            <div className={C360_SK_SUB} />
          </div>
          <div />
        </div>
      ))}
    </div>
  );
}

export function TimelineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={C360_ERROR_WRAP}>
      <div className={CUI_DANGER_BOX} role="alert">
        <AlertTriangle className={CUI_DANGER_ICON} strokeWidth={2} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className={CUI_DANGER_TEXT}>{message}</p>
          <button type="button" onClick={onRetry} className={`${CUI_BTN_OUTLINE} mt-3`}>
            <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />다시 시도
          </button>
        </div>
      </div>
    </div>
  );
}

interface EmptyProps {
  active: TimelineKind | null;
  q: string;
  rangeIsAll: boolean;
  onShowAll: () => void;
  onClearQ: () => void;
  onRangeAll: () => void;
}

export function TimelineEmpty({ active, q, rangeIsAll, onShowAll, onClearQ, onRangeAll }: EmptyProps) {
  // 검색어가 있을 때
  if (q) {
    return (
      <div className={C360_EMPTY_LIGHT} role="status">
        <p className={C360_EMPTY_TITLE}>'{q}'에 맞는 기록이 없습니다</p>
        <p className={C360_EMPTY_DESC}>{rangeIsAll ? '다른 검색어로 찾아보세요' : '기간을 넓히거나 다른 검색어로 찾아보세요'}</p>
        <div className={C360_EMPTY_ACTIONS}>
          <button type="button" onClick={onClearQ} className={CUI_BTN_OUTLINE}>검색어 지우기</button>
          {!rangeIsAll && <button type="button" onClick={onRangeAll} className={CUI_BTN_OUTLINE}>기간 전체로</button>}
        </div>
      </div>
    );
  }
  // 종류·기간 조건만 있을 때
  if (active || !rangeIsAll) {
    return (
      <div className={C360_EMPTY_LIGHT} role="status">
        <p className={C360_EMPTY_TITLE}>{active ? `${KIND_STYLE[active].label} 기록이 없습니다` : '이 기간에는 기록이 없습니다'}</p>
        <p className={C360_EMPTY_DESC}>{active ? '다른 종류를 고르거나 전체로 보세요' : '기간을 넓혀 보세요'}</p>
        <div className={C360_EMPTY_ACTIONS}>
          {active && <button type="button" onClick={onShowAll} className={CUI_BTN_OUTLINE}>전체 보기</button>}
          {!rangeIsAll && <button type="button" onClick={onRangeAll} className={CUI_BTN_OUTLINE}>기간 전체로</button>}
        </div>
      </div>
    );
  }
  // 기록 자체가 0
  return (
    <div className="p-5">
      <div className={CUI_EMPTY} role="status">
        <div className={CUI_EMPTY_BADGE}><Clock className="w-5 h-5" strokeWidth={1.8} aria-hidden="true" /></div>
        <p className={CUI_EMPTY_TITLE}>아직 기록이 없습니다</p>
        <p className={CUI_EMPTY_DESC}>메시지를 보내거나 고객이 반응하면 여기에 시간순으로 쌓입니다.</p>
      </div>
    </div>
  );
}
