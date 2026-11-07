/**
 * StudioLogoControls — 결과 화면의 로고 줄 하나(★ 2026-11-07 · 설계서 docs/2026-11-07-c112-studio-brand-logo-design.md D9 · D11 · D12 · §6)
 *
 * 스튜디오 결과 카드와 DM 삽입 창 결과 단계가 같은 부품을 쓴다(두 화면 소스 계약 시험).
 * 무엇을 그릴지 = lib/studio-layers logoRowView(서버 확정 설정이 표시값) · 이 부품은 그리기만 하고 바꾼 설정을 부른 쪽에 넘긴다.
 * 흰 표면 창 안에서도 그려진다 → 다크 전제 색 금지 · 좁으면 줄바꿈(부품 안 화면 폭 분기 0).
 */
import { useState } from 'react';
import { Globe, RotateCcw } from 'lucide-react';
import ZoneSegmented from '../zone/ZoneSegmented';
import { logoRowView, logoSettingsOf, type LogoCandidate, type LogoCorner, type LogoSettings, type LogoSize, type LogoView } from '../../lib/studio-layers';

const BOX = 'rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5';
const SUB_BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-[12px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40';

export default function StudioLogoControls({ logo, failed, saved, disabled, onChange, onFind, onUse }: {
  logo: LogoView | null;
  failed: boolean;
  saved: boolean;
  disabled: boolean;
  /** 끄고 켜기 · 자리 · 크기 · 다시 얹기 = 새 설정으로 미리보기를 다시 받는다 */
  onChange: (s: LogoSettings) => void;
  /** ★ C113 D9 1단계 — 키트 로고가 없을 때 홈페이지 주소 → 로고 후보 찾기(키트에 쓰지 않음) */
  onFind: (url: string) => Promise<LogoCandidate | null>;
  /** ★ C113 D9 2단계 — 본 후보를 「이 로고로 저장」(키트 빈 칸에만) → 미리보기 */
  onUse: (c: LogoCandidate) => void;
}) {
  const v = logoRowView({ saved, failed, logo });
  // null = 손대지 않음 → 키트의 홈페이지 주소를 미리 채워 보인다
  const [url, setUrl] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<LogoCandidate | null>(null);
  const find = async (u: string) => {
    const c = await onFind(u);
    if (c) setCandidate(c);
  };

  if (v.mode === 'hidden') return null;
  if (v.mode === 'saved') return <p className="text-[12px] text-slate-500 break-keep">{v.text}</p>;

  if (v.mode === 'failed' || v.mode === 'note') {
    return (
      <div className={`${BOX} flex items-center gap-2 flex-wrap`}>
        <span className="text-[12px] text-slate-600 break-keep">{v.text}</span>
        {v.action && (
          <button type="button" onClick={() => onChange(logoSettingsOf(logo))} disabled={disabled} className={SUB_BTN}>
            <RotateCcw className="w-3.5 h-3.5" /> {v.action}
          </button>
        )}
      </div>
    );
  }

  if (v.mode === 'read' && candidate) {
    return (
      <div className={`${BOX} space-y-2`}>
        <p className="text-[12px] font-semibold text-slate-700">홈페이지에서 찾은 로고예요</p>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2">
            <img src={candidate.preview} alt="찾은 로고" className="max-h-12 max-w-[10rem] object-contain" />
          </span>
          <button type="button" onClick={() => onUse(candidate)} disabled={disabled} className={SUB_BTN}>이 로고로 저장</button>
          <button type="button" onClick={() => setCandidate(null)} disabled={disabled} className={SUB_BTN}>다른 주소로</button>
        </div>
        <p className="text-[12px] text-slate-500 break-keep">{v.hint}</p>
      </div>
    );
  }

  if (v.mode === 'read') {
    const shown = url ?? (v.homepage || '');
    return (
      <div className={`${BOX} space-y-2`}>
        <p className="text-[12px] font-semibold text-slate-700">{v.text}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={shown}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && shown.trim() && !disabled) void find(shown.trim()); }}
            placeholder="회사 홈페이지 주소 (예: https://www.우리회사.com)"
            className="flex-1 min-w-[12rem] h-9 px-3 bg-white border border-slate-200 rounded-lg text-[12px] text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-300"
          />
          <button type="button" onClick={() => void find(shown.trim())} disabled={disabled || !shown.trim()} className={SUB_BTN}>
            <Globe className="w-3.5 h-3.5" /> {v.button}
          </button>
        </div>
        <p className="text-[12px] text-slate-500 break-keep">{v.hint}</p>
      </div>
    );
  }

  return (
    <div className={`${BOX} flex items-center gap-x-3 gap-y-2 flex-wrap`}>
      <span className="text-[11px] font-semibold text-slate-500">로고</span>
      <button
        type="button"
        role="switch"
        aria-checked={v.on}
        aria-label="로고 얹기"
        disabled={disabled}
        onClick={() => onChange({ on: !v.on, corner: v.corner, size: v.size })}
        className={`relative w-10 h-6 rounded-full transition-colors ${v.on ? 'bg-indigo-600' : 'bg-slate-300'} disabled:opacity-40`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${v.on ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      {v.on && v.corners.length > 0 && (
        <ZoneSegmented<LogoCorner>
          items={v.corners.map((c) => ({ ...c, disabled }))}
          value={v.corner}
          onChange={(corner) => { if (corner !== v.corner) onChange({ on: true, corner, size: v.size }); }}
          ariaLabel="로고 자리"
        />
      )}
      {v.on && v.sizes.length > 0 && (
        <ZoneSegmented<LogoSize>
          items={v.sizes.map((s) => ({ ...s, disabled }))}
          value={v.size}
          onChange={(size) => { if (size !== v.size) onChange({ on: true, corner: v.corner, size }); }}
          ariaLabel="로고 크기"
        />
      )}
      {v.on && v.sizeNote && <p className="basis-full text-[12px] text-slate-500 break-keep">{v.sizeNote}</p>}
    </div>
  );
}
