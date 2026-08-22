/**
 * TimelineToolbar — 검색 · 기간 · 종류 + 원천 안내 (★ 2026-08-22 v2). 훅 0, props만.
 *
 * 1행: 검색(CUI_FIELD, 250ms 자동 조회, Enter 즉시) + 기간 세그먼트 4칸 + 조건이 있을 때만 "조건 지우기"
 * 2행: 전체 + 종류 칩 8개 **한 줄 전부**(드롭다운 접기 0 = 1클릭 · 가로 스크롤 0 = 줄바꿈)
 * 그 아래: 원천 안내 — 잘림(INFO) · 일부 실패(NOTICE) · 24개월 상한(INFO). 목록 끝이 아니라 여기에 두어야 200건 고객도 본다.
 */
import { Search, X, Info, AlertTriangle } from 'lucide-react';
import { CUI_CHIP_OFF, CUI_CHIP_ON, CUI_FIELD, CUI_FIELD_INPUT } from '../../utils/console-ui';
import { FILTER_KINDS, KIND_STYLE, type TimelineKind } from './timeline-kinds';
import { RANGE_OPTIONS, type RangeKey } from './timeline-query';
import {
  C360_BANNER_ICON_INFO, C360_BANNER_ICON_NOTICE, C360_BANNER_INFO, C360_BANNER_NOTICE, C360_CLEAR_BTN,
  C360_SEARCH_CLEAR, C360_SEARCH_WRAP, C360_SEG, C360_SEG_OFF, C360_SEG_ON, C360_TOOLBAR1, C360_TOOLBAR2,
} from './c360-ui';
import type { TimelineSources } from './useCustomerTimeline';

interface Props {
  qInput: string;
  onQInput: (v: string) => void;
  onQEnter: () => void;
  onQClear: () => void;
  range: RangeKey;
  onRange: (r: RangeKey) => void;
  active: TimelineKind | null;
  onKind: (k: TimelineKind | null) => void;
  conditioned: boolean;
  onClearAll: () => void;
  sources: TimelineSources;
  hasEvents: boolean;
}

export default function TimelineToolbar({
  qInput, onQInput, onQEnter, onQClear, range, onRange, active, onKind, conditioned, onClearAll, sources, hasEvents,
}: Props) {
  const truncated = Object.entries(sources).filter(([, v]) => v?.truncated).map(([k]) => KIND_STYLE[k as TimelineKind]?.label || k);
  const errored = Object.entries(sources).filter(([, v]) => v?.error).map(([k]) => KIND_STYLE[k as TimelineKind]?.label || k);
  const rangeCapped = !!sources.send?.rangeCapped && range === 'all';

  return (
    <>
      <div className={C360_TOOLBAR1}>
        <div className={C360_SEARCH_WRAP}>
          <label className={CUI_FIELD}>
            <Search className="w-3.5 h-3.5 text-neutral-400 shrink-0" strokeWidth={2} aria-hidden="true" />
            <input
              type="search"
              value={qInput}
              onChange={(e) => onQInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onQEnter(); } }}
              placeholder="제목 · 내용 · 상품 검색"
              aria-label="활동 기록 검색"
              maxLength={40}
              className={CUI_FIELD_INPUT}
            />
            {qInput && (
              <button type="button" onClick={onQClear} aria-label="검색어 지우기" className={C360_SEARCH_CLEAR}>
                <X className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            )}
          </label>
        </div>

        <div className={C360_SEG} role="radiogroup" aria-label="기간">
          {RANGE_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={range === o.key}
              onClick={() => onRange(o.key)}
              className={range === o.key ? C360_SEG_ON : C360_SEG_OFF}
            >
              {o.label}
            </button>
          ))}
        </div>

        {conditioned && (
          <button type="button" onClick={onClearAll} className={C360_CLEAR_BTN}>조건 지우기</button>
        )}
      </div>

      <div className={C360_TOOLBAR2} role="tablist" aria-label="종류">
        <button type="button" role="tab" aria-selected={active === null} onClick={() => onKind(null)} className={active === null ? CUI_CHIP_ON : CUI_CHIP_OFF}>
          전체
        </button>
        {FILTER_KINDS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={active === k} onClick={() => onKind(k)} className={active === k ? CUI_CHIP_ON : CUI_CHIP_OFF}>
            {KIND_STYLE[k].label}
          </button>
        ))}
      </div>

      {errored.length > 0 && (
        <div className={C360_BANNER_NOTICE} role="status">
          <AlertTriangle className={C360_BANNER_ICON_NOTICE} strokeWidth={2} aria-hidden="true" />
          <span>{errored.join(' · ')} 기록은 지금 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</span>
        </div>
      )}
      {(truncated.length > 0 || rangeCapped) && hasEvents && (
        <div className={C360_BANNER_INFO} role="status">
          <Info className={C360_BANNER_ICON_INFO} strokeWidth={2} aria-hidden="true" />
          <span>
            {truncated.length > 0 && '기록이 많아 일부만 먼저 보입니다. 아래 "더 보기"로 이어집니다. '}
            {rangeCapped && '발송 기록은 최근 24개월까지 보입니다.'}
          </span>
        </div>
      )}
    </>
  );
}
