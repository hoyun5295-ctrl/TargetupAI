// EmailFontModal — 이메일 캠페인 서체 지정 (★ 2026-08-27 임은지 접수 cmtb6kn6j0369jnotmslux7i2)
//
// 배경: 이메일 렌더러는 서체를 **이미 읽고 있었다**(email-tokens resolveEmailBrand — design.font_family →
//   brandKit.font_family → 기본). 없던 것은 고를 입구뿐이라, DM 퀵바 [서체]와 같은 자리를 이메일에도 만든다.
//
// ⛔ 적용 대상은 **캠페인 단위 design**이다. DM의 FontApplyModal은 브랜드킷을 바꾸는데, 그걸 따라 하면
//   이메일 한 통 때문에 DM·인앱 서체까지 함께 바뀐다. 여기서는 design만 패치한다.
// ⛔ 서체 목록은 DM_FONT_CATALOG **단일 소스**를 그대로 쓴다. 사본을 만들면 곧 한쪽만 갱신된다.
// 미리보기 글꼴 = /api/dm/v/fonts.css 자가호스팅(편집 캔버스·발송 메일과 같은 파일) — 보이는 대로 나간다.
// 커스텀 다크 모달(native dialog 0 · 백드롭 클릭 닫힘 없음 — X/취소만).
import { useEffect } from 'react';
import { Check, RotateCcw, Type, X } from 'lucide-react';
import { DM_FONT_CATALOG } from '../../utils/dm-tokens';
import type { EmailDesign } from '../../utils/email-themes';

export default function EmailFontModal({
  current, onApply, onReset, onClose,
}: {
  current: EmailDesign | null;
  onApply: (design: EmailDesign) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  // 미리보기용 자가호스팅 서체 로드 — 발송 메일이 쓰는 파일과 동일(idempotent).
  useEffect(() => {
    const ID = 'dm-selfhost-fonts';
    if (document.getElementById(ID)) return;
    const link = document.createElement('link');
    link.id = ID;
    link.rel = 'stylesheet';
    link.href = '/api/dm/v/fonts.css';
    document.head.appendChild(link);
  }, []);

  const currentFamily = current?.font_family || '';
  const isActive = (css: string) =>
    !!currentFamily && currentFamily.includes(css.split(',')[0].replace(/"/g, '').trim());

  return (
    <div className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shrink-0">
            <Type className="w-4.5 h-4.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white">서체</div>
            <div className="text-[11px] text-white/50">이 캠페인 전체 글꼴을 바꿉니다. 문안과 블록 구성은 그대로예요.</div>
          </div>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10 shrink-0" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {DM_FONT_CATALOG.map((f) => {
              const active = isActive(f.css);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { onApply({ ...(current || {}), font_family: f.css, font_display: f.css }); onClose(); }}
                  className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                    active
                      ? 'border-violet-400/60 bg-violet-500/15'
                      : 'border-white/10 bg-slate-950/50 hover:border-white/25 hover:bg-slate-950/80'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[11px] text-white/50">{f.label}</span>
                    {active && <Check className="w-3.5 h-3.5 text-violet-300 shrink-0" />}
                  </div>
                  {/* 실제 글꼴로 크게 — 어떤 서체인지 이름이 아니라 모양으로 고른다 */}
                  <div className="text-[19px] leading-snug text-white truncate" style={{ fontFamily: f.css }}>
                    가나다 마케팅 ABC 123
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 text-[11px] leading-relaxed text-white/40">
            보이는 글꼴 그대로 메일에 실립니다. 글꼴을 지원하지 않는 일부 수신함에서는 같은 계열의 기본 글꼴로 보입니다.
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-white/10">
          <button
            type="button"
            onClick={() => { onReset(); onClose(); }}
            className="inline-flex items-center gap-1.5 text-[12px] text-white/60 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/10"
          >
            <RotateCcw className="w-3.5 h-3.5" />기본 서체로
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] text-white/70 hover:text-white px-4 py-1.5 rounded-lg border border-white/10 hover:bg-white/10"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
