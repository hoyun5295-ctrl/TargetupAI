import { useState, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * D144 P11+P13 (2026-05-06): 검색 가능한 Select 공통 컴포넌트
 *
 * 슈퍼관리자 사용자 추가 모달(소속회사) + 발송통계 회사 필터에서 공통 사용.
 * 옵션이 많은(67개+ 회사) 케이스에서 스크롤 대신 입력으로 검색 가능.
 *
 * - 입력으로 label 부분 매칭 검색 (대소문자 무시)
 * - 클릭으로 선택
 * - 선택 후 input에 label 표시
 * - 외부 클릭 시 자동 close
 */
export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
  /** 빈 옵션(전체) 추가 — 'all' / '' 등 */
  emptyLabel?: string;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = '선택하세요',
  className = '',
  required = false,
  emptyLabel,
}: SearchableSelectProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allOptions: SearchableSelectOption[] = emptyLabel !== undefined
    ? [{ value: '', label: emptyLabel }, ...options]
    : options;

  const selectedLabel = allOptions.find(o => o.value === value)?.label || '';
  const filtered = !search
    ? allOptions
    : allOptions.filter(o => o.label.toLowerCase().includes(search.toLowerCase()));

  /**
   * ★ 2026-08-04 **고르지 않고 닫으면 선택을 비운다**(Codex 적대검증 high 2R·3R 수용).
   *   그전에는 검색 문자열과 확정 선택값이 따로 놀았다 — A를 고른 뒤 입력창에 B를 쳐 놓고
   *   목록에서 고르지 않은 채 바로 [등록]을 누르면, 사용자는 B를 등록한다고 믿는데 A가 저장된다.
   *   최소과금 등록에서 이러면 엉뚱한 회사가 일괄발급에서 빠지고 정액 청구까지 나간다.
   *
   *   판정 기준은 **입력을 건드렸는가(dirty)**다. 마지막 검색어가 비어 있는지가 아니다 —
   *   B를 쳤다가 전부 지우고 실행하면 사용자는 "비웠다"고 믿는데 A가 그대로 저장됐다(3R).
   *   닫는 경로는 외부 클릭·포커스 이탈·Esc·Enter 넷을 **한 함수**로 모은다. 그전에는 외부
   *   클릭뿐이라 form 안에서 Enter를 누르면 정리를 통째로 건너뛰고 옛 값이 제출됐다(3R).
   *   비우는 것은 **닫을 때 한 번**이다(타이핑마다 비우면 onChange가 조회를 다시 태우는 소비처가 있다).
   *   최신 값은 ref로 읽는다 — 핸들러를 한 번만 등록해 두고 클로저의 옛 값을 보면 판정이 틀어진다.
   */
  const [dirty, setDirty] = useState(false);
  // 열림 상태는 ref로도 든다 — 같은 상호작용에서 focusout·mousedown이 겹쳐도 리렌더 전에 중복 실행을 막는다.
  const openRef = useRef(false);
  // 세션 시작 시점의 확정값 — 편집 중에 부모가 값을 바꾸면 그쪽이 진실이다.
  const startValueRef = useRef(value);

  // 커밋된 값만 게시한다 — 렌더 단계에서 공유 ref를 바꾸면, 폐기될 수 있는 렌더의 값을
  // 이미 화면에 있는 드롭다운의 이벤트 핸들러가 읽을 수 있다(Codex 4R medium).
  const latest = useRef({ search, value, selectedLabel, onChange, dirty, filtered });
  useLayoutEffect(() => {
    latest.current = { search, value, selectedLabel, onChange, dirty, filtered };
  });

  /** 세션 시작 — 이미 열려 있으면 아무것도 하지 않는다(입력↔목록 사이 재포커스는 같은 세션이다). */
  const openSession = () => {
    if (openRef.current) return;
    openRef.current = true;
    startValueRef.current = latest.current.value;
    setOpen(true); setSearch(''); setDirty(false);
  };

  /** 세션 종료 — 고르지 않고 나갔으면 선택을 비운다. */
  const closeSession = () => {
    if (!openRef.current) return;
    const { search: s, value: v, selectedLabel: label, onChange: change, dirty: edited } = latest.current;
    const typed = s.trim();
    openRef.current = false;
    setOpen(false); setSearch(''); setDirty(false);
    // ① 입력을 건드렸고 ② 그 사이 부모가 값을 바꾸지 않았고 ③ 친 그대로가 선택된 이름이 아닐 때만 비운다.
    if (edited && v && v === startValueRef.current && typed.toLowerCase() !== label.toLowerCase()) change('');
  };

  const pick = (v: string) => {
    openRef.current = false;
    onChange(v);
    setSearch(''); setDirty(false); setOpen(false);
    inputRef.current?.blur();
  };

  // ★ capture 단계로 듣는다(Codex 5R high) — bubble이면 바깥 요소의 onMouseDown이 부모 value를
  //   먼저 예약해도 우리 close가 나중에 실행돼 빈 값으로 덮어쓴다. capture면 close가 먼저 예약되고
  //   그 뒤 target 쪽 부모 변경이 최종 권위를 갖는다. 해제도 같은 옵션으로 해야 리스너가 남지 않는다.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeSession();
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, []);

  const baseInputClass = 'w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none';

  return (
    // 포커스 경계는 **wrapper**다 — 입력에만 걸면 Tab으로 목록 버튼을 거쳐 다음 필드로 나갈 때
    // 정리가 한 번도 실행되지 않아 옛 선택이 그대로 제출된다(Codex 4R high).
    <div
      ref={ref}
      className={`relative ${className}`}
      onFocus={openSession}
      onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) closeSession(); }}
    >
      <input
        ref={inputRef}
        type="text"
        value={open ? search : selectedLabel}
        onChange={(e) => { openSession(); setSearch(e.target.value); setDirty(true); }}
        onKeyDown={(e) => {
          // 한글 조합을 확정하는 Enter는 우리 것이 아니다 — 가로채면 미완성 검색어로 회사가 골라진다.
          const ne = e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number };
          if (ne?.isComposing || ne?.keyCode === 229) return;
          if (e.key === 'Escape') { e.preventDefault(); closeSession(); return; }
          if (e.key !== 'Enter' || !openRef.current) return;
          // 미확정 검색 상태의 Enter가 form을 제출하면 옛 선택이 그대로 저장된다 — 제출을 막고 정리한다.
          e.preventDefault();
          const only = latest.current.filtered;
          if (latest.current.dirty && only.length === 1) pick(only[0].value);
          else closeSession();
        }}
        placeholder={placeholder}
        className={baseInputClass}
        autoComplete="off"
      />
      {/* required 충족용 hidden input */}
      {required && (
        <input
          type="text"
          value={value}
          onChange={() => {}}
          required
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }}
        />
      )}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border rounded-lg shadow-lg z-50">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400">검색 결과 없음</div>
          ) : (
            filtered.map(o => (
              <button
                key={o.value || '_empty'}
                type="button"
                // ★ mousedown에서 포커스 이동을 막는다(Codex 5R high) — 버튼에 포커스를 주지 않는
                //   브라우저(Safari/macOS)에서는 input이 body로 blur되면서 click 전에 목록이 사라져
                //   선택이 아예 안 되거나 기존 값만 비워진다. 키보드 선택을 위해 onClick은 그대로 둔다.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o.value)}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 ${value === o.value ? 'bg-blue-50 text-blue-700 font-medium' : ''}`}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
