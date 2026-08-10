/**
 * components/cdp/CdpDeveloperDoc.tsx — 개발자 자료 3층 표시 (★2026-08-10)
 *
 * 설계서 = docs/2026-08-09-cdp-integration-redesign-design.md §5-0(3층) · §5-5(시인성 규격)
 *
 * 고치는 문제 — 앱 탭이 개발자용 계약 문서를 **전부 펼친 채** 쏟아내고 있었다.
 * 모든 블록이 같은 무게라 훑을 수 없고, 담당자에게는 한 줄도 필요 없는 내용이다.
 *
 * 원칙 그대로 적용한다:
 *   - **담당자 화면에는 한 줄 요약과 액션 하나.** 상세는 기본 접힘 — 필요한 사람만 편다.
 *   - **개발자에게 넘기는 것이 주 액션.** 읽으라고 두는 게 아니라 전달하라고 둔다.
 *   - 펼쳐진 상세는 하나뿐(§5-5) — 아코디언은 단일 열림.
 */

import { useState } from 'react';
import { ChevronDown, Copy, Code2 } from 'lucide-react';

export interface DeveloperDocItem {
  title: string;
  desc: string;
  code?: string;
}
export interface DeveloperDocSection {
  key: string;
  heading: string;
  items: DeveloperDocItem[];
}

export interface CdpDeveloperDocProps {
  title: string;
  /** 담당자가 읽을 한 줄. 개발자용 설명을 여기 쓰지 않는다. */
  summary: string;
  sections: DeveloperDocSection[];
  onCopyAll?: () => void;
}

/** 섹션 묶음을 개발자에게 그대로 넘길 평문으로 — 화면에서 읽히는 형태와 같은 순서. */
export function developerDocToText(title: string, sections: DeveloperDocSection[]): string {
  const lines: string[] = [`[${title}]`, ''];
  for (const sec of sections) {
    lines.push(`■ ${sec.heading}`);
    for (const it of sec.items) {
      lines.push(`  · ${it.title}`);
      lines.push(`    ${it.desc}`);
      if (it.code) {
        lines.push('');
        for (const l of it.code.split('\n')) lines.push(`    ${l}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n').trimEnd();
}

export default function CdpDeveloperDoc({ title, summary, sections, onCopyAll }: CdpDeveloperDocProps) {
  // 펼쳐진 상세는 하나뿐(§5-5). 기본은 전부 접힘.
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-cyan-500/20">
          <Code2 className="w-4.5 h-4.5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white">{title}</div>
          <p className="text-[12px] text-white/50 leading-relaxed mt-0.5">{summary}</p>
        </div>
      </div>

      {/* 주 액션 하나 — 읽으라고 두는 게 아니라 전달하라고 둔다 */}
      {onCopyAll && (
        <button
          type="button"
          onClick={onCopyAll}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-violet-500/25 hover:bg-violet-500/40 border border-violet-400/30 text-[12.5px] font-medium text-violet-100 transition-colors"
        >
          <Copy className="w-3.5 h-3.5" /> 개발자에게 보낼 내용 복사
        </button>
      )}

      {/* 상세 — 기본 접힘. 필요한 사람만 편다. */}
      <div className="space-y-1">
        {sections.map((sec) => {
          const open = openKey === sec.key;
          return (
            <div key={sec.key} className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenKey(open ? null : sec.key)}
                aria-expanded={open}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-white/[0.03] transition-colors"
              >
                <span className="text-[12.5px] font-medium text-white/80">{sec.heading}</span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] text-white/30">{sec.items.length}</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
                </span>
              </button>
              {open && (
                <div className="px-3 pb-3 space-y-2">
                  {sec.items.map((it, i) => (
                    <div key={i} className="rounded-lg bg-slate-900/40 border border-white/[0.07] p-2.5">
                      <div className="text-[12px] font-semibold text-white/85">{it.title}</div>
                      <p className="text-[11.5px] text-white/50 leading-relaxed mt-1">{it.desc}</p>
                      {it.code && (
                        <pre className="mt-2 bg-slate-950 border border-white/10 rounded-lg p-2.5 text-[11px] text-cyan-200 overflow-x-auto whitespace-pre">{it.code}</pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
