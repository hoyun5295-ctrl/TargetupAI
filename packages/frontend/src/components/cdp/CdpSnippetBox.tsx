/**
 * components/cdp/CdpSnippetBox.tsx — 설치 스니펫 단일 표시 (★2026-08-10)
 *
 * 설계서 = docs/2026-08-09-cdp-integration-redesign-design.md §5-4 · §5-5
 *
 * 고치는 문제 — 웹 탭이 거의 같은 스크립트 두 개(웹 / 앱 웹뷰)를 나란히 쌓아 보여줬다.
 * 차이는 속성 한 줄(`data-hjl-platform="app"`)뿐인데 화면 높이는 두 배로 먹고,
 * 담당자는 둘 중 무엇을 줘야 할지 매번 고민하게 된다.
 *
 * 규격(§5-5): **코드 블록 동시 노출은 1개.** 토글로 전환하고 복사 버튼도 하나만 둔다.
 */

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export interface CdpSnippetVariant {
  key: string;
  label: string;
  code: string;
  /** 그 변형에만 해당하는 한 줄 안내(선택) */
  note?: string;
}

export interface CdpSnippetBoxProps {
  variants: CdpSnippetVariant[];
  onCopy: (code: string, label: string) => void;
}

export default function CdpSnippetBox({ variants, onCopy }: CdpSnippetBoxProps) {
  const [activeKey, setActiveKey] = useState(variants[0]?.key);
  const active = variants.find((v) => v.key === activeKey) || variants[0];
  if (!active) return null;

  return (
    <div className="space-y-2.5">
      {variants.length > 1 && (
        <div className="inline-flex gap-1 bg-white/5 border border-white/10 rounded-lg p-1" role="tablist">
          {variants.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={v.key === active.key}
              onClick={() => setActiveKey(v.key)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                v.key === active.key ? 'bg-violet-500/40 text-white' : 'text-white/55 hover:bg-white/5'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      {active.note && <p className="text-[11.5px] text-white/45 leading-relaxed">{active.note}</p>}

      <pre className="bg-slate-950 border border-white/10 rounded-xl p-3 text-[11px] text-emerald-200 overflow-x-auto whitespace-pre-wrap break-all">{active.code}</pre>

      <button
        type="button"
        onClick={() => onCopy(active.code, `${active.label} 설치 스크립트`)}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-500/35 hover:bg-violet-500/55 text-white text-[12px] font-medium transition-colors"
      >
        <Copy className="w-3.5 h-3.5" /> {active.label} 스크립트 복사
      </button>
      <p className="text-[11px] text-white/35 inline-flex items-center gap-1">
        <Check className="w-3 h-3 text-emerald-400/70" /> 붙여넣고 페이지를 한 번 열면 아래 &quot;첫 데이터 확인&quot;이 자동으로 켜집니다.
      </p>
    </div>
  );
}
