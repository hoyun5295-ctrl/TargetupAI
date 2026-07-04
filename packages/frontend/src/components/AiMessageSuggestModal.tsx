import { useEffect, useState } from 'react';
import { Sparkles, X, Loader2, Lightbulb, Trophy, Palette, ChevronDown, ChevronUp } from 'lucide-react';

// ★ 2026-07-04 스타일 참고(specs/2026-07-04-best-copy-evolution-design.md §4)
//   위 = 내 승리 문안(자사 데이터) / 아래 = 업종 스타일(AI 재창작 예시 — 타사 원문 절대 아님, 캡션 고정)
interface MyBestCopy { text: string; messageType: string; sentCount: number; successRate: number | null }
interface StyleExample { id: string; text: string; tags: string[] }

interface AiMessageSuggestModalProps {
  show: boolean;
  onClose: () => void;
  aiHelperPrompt: string;
  setAiHelperPrompt: (v: string) => void;
  aiHelperLoading: boolean;
  aiHelperResults: any[];
  aiHelperRecommendation: string;
  onGenerate: () => void;
  onSelectMessage: (variant: any) => void;
  msgType: string;
}

export default function AiMessageSuggestModal({
  show, onClose, aiHelperPrompt, setAiHelperPrompt,
  aiHelperLoading, aiHelperResults, aiHelperRecommendation,
  onGenerate, onSelectMessage, msgType,
}: AiMessageSuggestModalProps) {
  // ★ 2026-07-04 스타일 참고 — 모달 자체 fetch(부모 배선 0). 실패·빈 결과 = 섹션 미노출(조용히 degrade)
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [myBest, setMyBest] = useState<MyBestCopy[]>([]);
  const [styles, setStyles] = useState<StyleExample[]>([]);
  const [industryName, setIndustryName] = useState<string | null>(null);
  const [galleryLoaded, setGalleryLoaded] = useState(false);

  useEffect(() => {
    if (!show || galleryLoaded) return;
    (async () => {
      try {
        const r = await fetch('/api/ai/style-gallery', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        const j = await r.json();
        if (j.success) {
          setMyBest(j.myBest || []);
          setStyles(j.styles || []);
          setIndustryName(j.industryLabel || null);
        }
      } catch { /* 스타일 참고는 부가 기능 — 실패해도 문구 추천 흐름 무영향 */ }
      setGalleryLoaded(true);
    })();
  }, [show, galleryLoaded]);

  const applyMyBest = (c: MyBestCopy) => {
    const base = aiHelperPrompt.trim();
    setAiHelperPrompt(
      `${base ? `${base}\n\n` : ''}[스타일 참고] 지난 발송 중 반응이 좋았던 우리 문안의 톤·구조를 참고해줘:\n"${c.text}"`,
    );
    setGalleryOpen(false);
  };

  const applyStyle = (s: StyleExample) => {
    const base = aiHelperPrompt.trim();
    const tagLine = s.tags.length > 0 ? s.tags.join(' · ') : '업종 추천';
    setAiHelperPrompt(
      `${base ? `${base}\n\n` : ''}[스타일 참고] ${tagLine} 스타일로, 후킹 → 핵심 내용 → 행동 유도 구성으로 작성해줘.`,
    );
    setGalleryOpen(false);
  };

  if (!show) return null;

  const hasGallery = myBest.length > 0 || styles.length > 0;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-[zoomIn_0.25s_ease-out] max-md:fixed max-md:inset-0 max-md:max-w-none max-md:max-h-none max-md:rounded-none">

        {/* 헤더 — sticky + 그라데이션 + Sparkles 아이콘 */}
        <div className="sticky top-0 z-10 px-6 py-4 bg-gradient-to-r from-slate-950 via-violet-950/40 to-slate-950 backdrop-blur-sm border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30 shrink-0">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-white font-bold text-lg">AI 문구 추천</h3>
              <p className="text-xs text-white/50 mt-0.5">어떤 내용의 메시지를 보낼지 알려주세요</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white p-1.5 hover:bg-white/5 rounded transition-colors shrink-0"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 프롬프트 입력 */}
        <div className="px-6 pt-4 pb-3">
          <textarea
            value={aiHelperPrompt}
            onChange={(e) => setAiHelperPrompt(e.target.value)}
            placeholder="예) 봄 신상 입고 안내, VIP 고객 감사 이벤트, 설 연휴 배송 안내..."
            className="w-full h-20 px-4 py-3 bg-white/5 border border-white/15 rounded-xl text-sm text-white resize-none focus:outline-none focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/20 transition-all placeholder-white/30"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onGenerate(); } }}
            autoFocus
          />
          <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
            <span className="text-xs text-white/40">채널: <span className="text-violet-300 font-medium">{msgType}</span> · Enter로 생성</span>
            <button
              onClick={onGenerate}
              disabled={aiHelperLoading || !aiHelperPrompt.trim()}
              className="px-4 py-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-sm font-medium rounded-xl hover:from-violet-500 hover:to-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 shadow-md shadow-violet-500/30"
            >
              {aiHelperLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  생성 중...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  문구 생성
                </>
              )}
            </button>
          </div>
        </div>

        {/* ★ 2026-07-04 스타일 참고 — 접이식. 내 승리(자사) / 업종 스타일(AI 재창작 예시) 층 분리 */}
        {hasGallery && (
          <div className="px-6 pb-3">
            <button
              onClick={() => setGalleryOpen(!galleryOpen)}
              className="w-full flex items-center justify-between px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white/70 hover:bg-white/10 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-violet-300" />
                스타일 참고 (선택) — 내 승리 문안 {myBest.length} · 업종 스타일 {styles.length}
              </span>
              {galleryOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {galleryOpen && (
              <div className="mt-2 space-y-3 max-h-[38vh] overflow-y-auto pr-1">
                {myBest.length > 0 && (
                  <div>
                    <p className="text-[11px] text-emerald-300/80 font-medium flex items-center gap-1 mb-1.5">
                      <Trophy className="w-3 h-3" /> 내 승리 문안 — 우리 회사 발송 중 성과 상위
                    </p>
                    <div className="space-y-1.5">
                      {myBest.map((c, i) => (
                        <button
                          key={i}
                          onClick={() => applyMyBest(c)}
                          className="w-full text-left p-3 bg-emerald-500/5 border border-emerald-400/20 rounded-xl hover:bg-emerald-500/10 hover:border-emerald-400/40 transition-colors"
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-[9px] bg-white/10 text-white/60 px-1.5 py-0.5 rounded font-mono">{c.messageType}</span>
                            {c.successRate !== null && (
                              <span className="text-[9px] bg-emerald-500/20 text-emerald-200 px-1.5 py-0.5 rounded">성공률 {c.successRate}%</span>
                            )}
                            <span className="text-[9px] text-white/40 ml-auto">클릭 = 프롬프트에 참고 지시 추가</span>
                          </div>
                          <p className="text-[11px] text-white/80 leading-relaxed line-clamp-3 whitespace-pre-wrap">{c.text}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {styles.length > 0 && (
                  <div>
                    <p className="text-[11px] text-violet-300/80 font-medium flex items-center gap-1 mb-1.5">
                      <Palette className="w-3 h-3" /> {industryName ? `${industryName} ` : ''}업종 스타일 추천
                    </p>
                    <div className="space-y-1.5">
                      {styles.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => applyStyle(s)}
                          className="w-full text-left p-3 bg-violet-500/5 border border-violet-400/20 rounded-xl hover:bg-violet-500/10 hover:border-violet-400/40 transition-colors"
                        >
                          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                            {s.tags.map((t) => (
                              <span key={t} className="text-[9px] bg-violet-500/20 text-violet-200 px-1.5 py-0.5 rounded">{t}</span>
                            ))}
                            <span className="text-[9px] text-white/40 ml-auto">클릭 = 이 스타일로 작성 지시</span>
                          </div>
                          <p className="text-[11px] text-white/70 leading-relaxed line-clamp-3 whitespace-pre-wrap">{s.text}</p>
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-white/35 italic mt-1.5">
                      AI가 업종 공통 패턴을 분석해 작성한 예시입니다. 실제 업체의 발송 문안이 아닙니다.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 결과 영역 */}
        {aiHelperResults.length > 0 && (
          <div className="px-6 pb-5 space-y-2.5 max-h-[50vh] overflow-y-auto">
            <p className="text-xs text-white/60 font-medium flex items-center gap-1.5">
              <Lightbulb className="w-3 h-3 text-amber-300" />
              원하는 문구를 선택하세요 (선택 후 자유 수정 가능)
            </p>
            {aiHelperResults.map((variant: any, idx: number) => {
              const msg = variant.message_text || (msgType === 'SMS' ? variant.sms_text : variant.lms_text) || '';
              const isRecommended = variant.variant_id === aiHelperRecommendation;
              return (
                <button
                  key={idx}
                  onClick={() => onSelectMessage(variant)}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all hover:scale-[1.01] ${
                    isRecommended
                      ? 'border-violet-400/40 bg-violet-500/10 hover:border-violet-400/60 hover:bg-violet-500/15 shadow-md shadow-violet-500/20'
                      : 'border-white/10 bg-white/5 hover:border-violet-400/30 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                        isRecommended
                          ? 'bg-violet-500/20 text-violet-200 border-violet-400/30'
                          : 'bg-white/10 text-white/70 border-white/10'
                      }`}
                    >
                      {variant.variant_name || `${String.fromCharCode(65 + idx)}안`}
                    </span>
                    {isRecommended && (
                      <span className="text-xs bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> 추천
                      </span>
                    )}
                    {variant.score && (
                      <span className="text-xs text-white/40 ml-auto">{variant.score}점</span>
                    )}
                  </div>
                  {variant.concept && (
                    <p className="text-xs text-white/50 mb-1.5">{variant.concept}</p>
                  )}
                  <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap">{msg}</p>
                </button>
              );
            })}
            <div className="text-[10px] text-white/30 italic pt-1">
              Data source — AI 문구 추천 (자율 진단 + 자연어 입력)
            </div>
          </div>
        )}

        {/* 로딩 스켈레톤 */}
        {aiHelperLoading && (
          <div className="px-6 pb-5 space-y-2.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 rounded-xl border border-white/10 bg-white/5 animate-pulse">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-5 bg-white/10 rounded-full" />
                  <div className="w-20 h-4 bg-white/10 rounded" />
                </div>
                <div className="space-y-2">
                  <div className="h-3 bg-white/10 rounded w-full" />
                  <div className="h-3 bg-white/10 rounded w-4/5" />
                  <div className="h-3 bg-white/10 rounded w-3/5" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
