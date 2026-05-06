import { useState, useEffect, useRef } from 'react';

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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const baseInputClass = 'w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none';

  return (
    <div ref={ref} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={open ? search : selectedLabel}
        onChange={(e) => { setSearch(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setOpen(true); setSearch(''); }}
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
                onClick={() => { onChange(o.value); setSearch(''); setOpen(false); inputRef.current?.blur(); }}
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
