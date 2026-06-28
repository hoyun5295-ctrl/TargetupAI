// EmailTemplateGalleryModal — 즉시·무료 템플릿 골격을 비주얼 에디터로 불러오는 갤러리 모달.
// 커스텀 다크 모달(native dialog 0). 카드 그리드 + 1클릭 적용. 혜택은 placeholder(자동 생성 X).
import { Check, X } from 'lucide-react';
import { EMAIL_TEMPLATES } from '../../utils/email-templates';
import type { Section } from '../../utils/dm-section-defaults';

export default function EmailTemplateGalleryModal({
  onPick, onClose,
}: {
  onPick: (sections: Section[], label: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 md:p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div>
            <h3 className="text-sm font-bold text-white">템플릿에서 시작</h3>
            <p className="text-[11px] text-white/50">완성된 골격을 한 번에 불러와요 — 크레딧 0, 바로 편집</p>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {EMAIL_TEMPLATES.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => { onPick(t.sections, t.label); onClose(); }}
                  className="group text-left bg-white/5 hover:bg-white/10 border border-white/10 hover:border-violet-400/40 rounded-2xl p-4 transition-all"
                >
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${t.gradient} flex items-center justify-center mb-3 shadow-md`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="text-sm font-bold text-white">{t.label}</div>
                  <div className="text-[11px] text-white/50 mt-0.5">{t.hint}</div>
                  <div className="mt-3 space-y-1">
                    {t.sections.slice(0, 4).map((s, i) => (
                      <div key={s.id} className="h-1.5 rounded-full bg-white/10" style={{ width: `${55 + ((s.type.length + i * 7) % 40)}%` }} />
                    ))}
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1 text-[11px] text-violet-300 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Check className="w-3 h-3" /> 이 템플릿으로 시작
                  </div>
                </button>
              );
            })}
          </div>
          <div className="text-[10px] text-white/30 italic mt-3">혜택 문구(% / 원 / 쿠폰)는 회사 정책에 맞게 직접 작성해주세요 — 자동 생성하지 않습니다.</div>
        </div>
      </div>
    </div>
  );
}
