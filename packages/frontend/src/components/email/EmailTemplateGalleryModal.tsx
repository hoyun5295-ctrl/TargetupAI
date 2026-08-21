// EmailTemplateGalleryModal — 정예 템플릿(디자인 4.0) 갤러리 모달.
// ★ 2026-07-14 Harold 지시 — 옛 12종 노출 제거, 정예 10종만(목적×스토리 구조 — 서버 design-core 컴파일).
// 커스텀 다크 모달(native dialog 0). 카드 그리드 + 1클릭 적용. 혜택은 placeholder(자동 생성 X).
import { useEffect, useState } from 'react';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import type { Section } from '../../utils/dm-section-defaults';
import type { EmailDesign } from '../../utils/email-themes';

/** ★ 2026-07-14 디자인 4.0 — 정예 템플릿(서버 design-core 컴파일 산출) */
interface EliteTemplate {
  id: string;
  label: string;
  hint: string;
  difference: string;
  swatches: [string, string, string];
  sections: Section[];
  design?: EmailDesign;
}

export default function EmailTemplateGalleryModal({
  onPick, onClose, authHeaders,
}: {
  /** ★ 2026-07-13 — 골든 템플릿의 추천 테마(design)도 함께 전달(캠페인 design으로 동승) */
  onPick: (sections: Section[], label: string, design?: EmailDesign) => void;
  onClose: () => void;
  authHeaders: () => Record<string, string>;
}) {
  const [elite, setElite] = useState<EliteTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // ★ 2026-07-14 디자인 4.0 — 정예 10종(목적×스토리 구조, 서버 컴파일 — FE 복제 없음)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/design/golden-templates?channel=email', { headers: authHeaders() });
        const data = await res.json();
        if (data?.success && Array.isArray(data.templates)) setElite(data.templates);
      } catch {
        // 조회 실패 = 아래 안내 폴백 (빈 모달 방지)
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 md:p-4">
      <div
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div>
            <h3 className="text-sm font-bold text-white">템플릿에서 시작</h3>
            <p className="text-[11px] text-white/50">완성된 골격을 한 번에 불러와요 (크레딧 0 · 바로 편집)</p>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* ★ 2026-07-14 Harold 지시 — 정예 템플릿만 노출(옛 12종 제거). 각 카드 = 목적×스토리 구조 완성형 */}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-14 text-white/50 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> 정예 템플릿을 불러오는 중...
            </div>
          )}
          {!loading && elite.length === 0 && (
            <div className="py-14 text-center text-sm text-white/50">템플릿을 불러오지 못했어요. 모달을 닫았다 다시 열어주세요.</div>
          )}
          {elite.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold text-amber-200">
                <Sparkles className="w-3.5 h-3.5" /> 정예 템플릿: 목적으로 고르세요
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {elite.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { onPick(t.sections, t.label, t.design); onClose(); }}
                    className="group text-left bg-white/5 hover:bg-white/10 border border-amber-400/25 hover:border-amber-400/60 rounded-2xl p-4 transition-all"
                  >
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="inline-flex h-6 w-16 rounded-lg overflow-hidden border border-white/15">
                        {t.swatches.map((c, i) => <span key={i} className="flex-1" style={{ background: c }} />)}
                      </span>
                      <span className="text-[10px] text-amber-200 bg-amber-500/15 border border-amber-400/25 px-1.5 py-0.5 rounded-full">정예</span>
                    </div>
                    <div className="text-sm font-bold text-white">{t.label}</div>
                    <div className="text-[11px] text-white/50 mt-0.5">{t.hint}</div>
                    <div className="text-[10px] text-white/35 mt-2 leading-relaxed line-clamp-2">{t.difference}</div>
                    <div className="mt-2.5 inline-flex items-center gap-1 text-[11px] text-amber-300 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Check className="w-3 h-3" /> 이 템플릿으로 시작
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="text-[10px] text-white/30 italic">적용 후 편집기의 "행사·상품 정보 붙여넣기"에 상품·행사문을 넣으면 상품 카드와 내용이 자동으로 채워져요. 혜택 문구는 원문에 있는 것만 사용됩니다.</div>
        </div>
      </div>
    </div>
  );
}
