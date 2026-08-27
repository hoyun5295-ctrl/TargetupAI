// EmailDesignThemeModal — 이메일 디자인 테마 8종 1클릭 적용 (★ 2026-07-13 디자인 3.0)
// 테마 = 캠페인 design(색·서체·아트디렉션) 패치 — 문안/섹션 구성은 건드리지 않는다.
// 커스텀 다크 모달(native dialog 0 · 백드롭 클릭 닫힘 없음 — X/취소만).
import { useEffect, type CSSProperties } from 'react';
import { Check, Palette, RotateCcw, X } from 'lucide-react';
import { EMAIL_DESIGN_THEMES, applyEmailTheme, type EmailDesign } from '../../utils/email-themes';
import { ensureSelfHostFontsLoaded } from '../../utils/brand-fonts';

export default function EmailDesignThemeModal({
  current, onApply, onReset, onClose,
}: {
  current: EmailDesign | null;
  onApply: (design: EmailDesign) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const currentTheme = current?.theme;

  // ★ 2026-08-27 서체 샘플용 자가호스팅 서체 로드(idempotent) — 발송 메일이 쓰는 파일과 동일.
  useEffect(() => { ensureSelfHostFontsLoaded(); }, []);
  return (
    <div className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shrink-0">
            <Palette className="w-4.5 h-4.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white">디자인 테마</div>
            <div className="text-[11px] text-white/50">색·서체·타이포 스케일·섹션 리듬을 한 번에 바꿉니다. 문안과 블록 구성은 그대로예요.</div>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10 shrink-0" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {EMAIL_DESIGN_THEMES.map((t) => {
              const active = currentTheme === t.id;
              const darkPreview = ['#0e1018', '#0b1220'].includes(t.design.palette?.background || '');
              return (
                <button
                  key={t.id}
                  onClick={() => { onApply(applyEmailTheme(current, t)); onClose(); }}
                  className={`text-left rounded-2xl overflow-hidden border transition-all ${active ? 'border-violet-400/70 ring-1 ring-violet-400/40' : 'border-white/10 hover:border-violet-400/40'}`}
                >
                  {/* 미리보기 스트립 — 테마 배경 + 서체 샘플 + 스와치 */}
                  <div style={{ background: t.design.palette?.background || '#fff' }} className="px-4 pt-3.5 pb-3 border-b border-black/5">
                    {/* .font-live = index.css 전역 !important 서체 강제의 탈출구(인라인 fontFamily는 눌려서 무효) */}
                    <div
                      style={{ ['--font-live']: t.previewFont || 'inherit', color: darkPreview ? '#f2f5fa' : (t.design.palette?.primary || '#111') } as CSSProperties}
                      className="font-live text-[17px] font-extrabold tracking-tight"
                    >
                      가나다 Aa 123
                    </div>
                    <div className="flex gap-1.5 mt-2.5">
                      {t.swatches.map((c, i) => (
                        <span key={i} className="w-4 h-4 rounded-md border border-black/10" style={{ background: c }} />
                      ))}
                    </div>
                  </div>
                  <div className="px-4 py-3 bg-white/5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-bold text-white">{t.name}</span>
                      {active && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-400/30 px-1.5 py-0.5 rounded-full">
                          <Check className="w-2.5 h-2.5" /> 적용됨
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-white/50 mt-1 leading-relaxed">{t.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-[10px] text-white/35 leading-relaxed">
              적용 후에도 블록별 구도·배경면·강조색은 편집 패널에서 개별 조정할 수 있어요. 다크 테마는 수신함에서 어두운 발송물로 보입니다.
            </div>
            {current && (
              <button
                onClick={() => { onReset(); onClose(); }}
                className="inline-flex items-center gap-1.5 shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white/10"
                title="테마를 지우고 기본 룩(브랜드 색)으로 돌아갑니다"
              >
                <RotateCcw className="w-3 h-3" /> 기본 룩
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
