/**
 * LiquidPreviewModal.tsx — Phase B-1 Liquid Templating (D191 2026-05-22)
 *
 * 10개 샘플 고객 미리보기 모달
 * - 좌측: 샘플 고객 선택 (라벨 + 데이터)
 * - 우측: 실시간 Liquid 렌더링 결과 (제목 + 본문)
 * - 에러 표시 (Liquid syntax error 영역)
 *
 * 회사 admin이 작성한 Liquid 메시지가 사용자별로 어떻게 렌더링되는지 즉시 가시화.
 */

import { useMemo, useState } from 'react';
import { Code, Eye, X, AlertCircle, Sparkles, User } from 'lucide-react';
import {
  renderLiquid,
  type LiquidError,
} from '../../utils/liquid-templating';

export interface PreviewSample {
  label: string;
  customerId: string;
  sampleCustomer: Record<string, any>;
  sampleCustomerFields: Record<string, any>;
  modelVersion: string | null;
}

interface LiquidPreviewModalProps {
  messageTemplate: string;
  subject: string;
  samples: PreviewSample[];
  onClose: () => void;
}

export default function LiquidPreviewModal({ messageTemplate, subject, samples, onClose }: LiquidPreviewModalProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  const previews = useMemo(() => {
    return samples.map((sample) => {
      const customer = sample.sampleCustomerFields;
      const messageResult = renderLiquid(messageTemplate, { customer });
      const subjectResult = subject ? renderLiquid(subject, { customer }) : { rendered: '', errors: [] as LiquidError[], hasLiquidSyntax: false };
      return {
        label: sample.label,
        data: sample.sampleCustomerFields,
        messageRendered: messageResult.rendered,
        messageErrors: messageResult.errors,
        subjectRendered: subjectResult.rendered,
        subjectErrors: subjectResult.errors,
      };
    });
  }, [messageTemplate, subject, samples]);

  const selected = previews[selectedIdx];
  const totalErrors = previews.reduce((sum, p) => sum + p.messageErrors.length + p.subjectErrors.length, 0);

  if (samples.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-900 border border-violet-400/30 rounded-xl max-w-md w-full p-6 text-center" onClick={(e) => e.stopPropagation()}>
          <Code className="w-8 h-8 text-violet-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold mb-2">미리보기 대상 없음</h3>
          <p className="text-sm text-white/60 mb-4 leading-relaxed">현재 이 여정 조건에 맞는 고객이 아직 없습니다. 여정을 켜두면 조건을 충족하는 고객이 생기는 즉시 자동 발송됩니다.</p>
          <button onClick={onClose} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white/80 rounded text-sm">닫기</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-violet-400/30 rounded-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-violet-500/5">
          <div className="flex items-center gap-2">
            <Code className="w-5 h-5 text-violet-400" />
            <h3 className="text-base font-semibold">Liquid 동적 콘텐츠 미리보기</h3>
            <span className="px-2 py-0.5 bg-violet-500/20 text-violet-200 rounded text-[10px]">10명 매트릭스</span>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 안내 + 에러 요약 */}
        <div className="px-4 py-2 border-b border-white/10 bg-slate-950/50">
          <div className="text-[11px] text-white/60 flex items-center gap-3">
            <span>발송 시점 사용자별 동적 렌더링 결과: 1개 메시지 + 10명 고객 = 10가지 결과</span>
            {totalErrors > 0 && (
              <span className="flex items-center gap-1 text-rose-400">
                <AlertCircle className="w-3 h-3" /> 오류 {totalErrors}건 감지
              </span>
            )}
          </div>
        </div>

        {/* 본문 */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 overflow-hidden">
          {/* 좌측: 샘플 고객 매트릭스 */}
          <div className="border-r border-white/10 overflow-y-auto bg-slate-950/30">
            <div className="p-3 text-[11px] text-white/40 sticky top-0 bg-slate-950/95 backdrop-blur-sm border-b border-white/5">
              샘플 고객 (10명)
            </div>
            {previews.map((p, idx) => {
              const hasError = p.messageErrors.length > 0 || p.subjectErrors.length > 0;
              return (
                <button
                  key={idx}
                  onClick={() => setSelectedIdx(idx)}
                  className={`w-full text-left px-3 py-2.5 border-b border-white/5 hover:bg-white/5 transition-colors ${
                    selectedIdx === idx ? 'bg-violet-500/10 border-l-2 border-l-violet-400' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <User className="w-3 h-3 text-white/40 flex-shrink-0" />
                      <span className="text-xs font-medium truncate">{p.label}</span>
                    </div>
                    {hasError && <AlertCircle className="w-3 h-3 text-rose-400 flex-shrink-0" />}
                  </div>
                  <div className="text-[10px] text-white/40 mt-1 truncate">
                    {p.data.grade || '-'} · {p.data.region || '-'} · {p.data.purchase_count ?? 0}회 구매
                  </div>
                </button>
              );
            })}
          </div>

          {/* 우측: 렌더링 결과 (2 컬럼) */}
          <div className="md:col-span-2 overflow-y-auto p-4 space-y-4">
            {/* 고객 데이터 미리 */}
            <div className="p-3 bg-slate-950/40 border border-white/5 rounded-lg">
              <div className="text-[11px] text-white/40 mb-2 flex items-center gap-1">
                <User className="w-3 h-3" /> 고객 데이터
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-1 text-[11px] font-mono">
                {Object.entries(selected.data).slice(0, 12).map(([key, value]) => (
                  <div key={key} className="flex items-baseline gap-1 truncate">
                    <span className="text-violet-300">{key}:</span>
                    <span className="text-white/80 truncate">{value == null ? <span className="text-white/30">null</span> : String(value)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 제목 렌더링 */}
            {subject && (
              <div>
                <div className="text-[11px] text-white/40 mb-1.5 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> 제목 렌더링
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 bg-slate-950/60 border border-white/5 rounded text-[11px] font-mono whitespace-pre-wrap break-words">
                    <div className="text-white/40 text-[10px] mb-1">원본</div>
                    <div className="text-white/70">{subject}</div>
                  </div>
                  <div className="p-2.5 bg-violet-500/5 border border-violet-400/20 rounded text-[11px] font-mono whitespace-pre-wrap break-words">
                    <div className="text-violet-300 text-[10px] mb-1 flex items-center gap-1">
                      <Eye className="w-2.5 h-2.5" /> 렌더링
                    </div>
                    <div className="text-white/90">{selected.subjectRendered || <span className="text-white/30">(빈 결과)</span>}</div>
                    {selected.subjectErrors.length > 0 && (
                      <div className="mt-1 text-rose-400 text-[10px]">
                        {selected.subjectErrors.map((e, i) => <div key={i}>· {e.type}: {e.message}</div>)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 본문 렌더링 */}
            <div>
              <div className="text-[11px] text-white/40 mb-1.5 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> 본문 렌더링
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 bg-slate-950/60 border border-white/5 rounded text-[11px] font-mono whitespace-pre-wrap break-words min-h-[200px]">
                  <div className="text-white/40 text-[10px] mb-1.5">원본 (Liquid 문법)</div>
                  <div className="text-white/70">{messageTemplate}</div>
                </div>
                <div className="p-3 bg-violet-500/5 border border-violet-400/20 rounded text-[11px] font-mono whitespace-pre-wrap break-words min-h-[200px]">
                  <div className="text-violet-300 text-[10px] mb-1.5 flex items-center gap-1">
                    <Eye className="w-2.5 h-2.5" /> 렌더링 결과
                  </div>
                  <div className="text-white/90">{selected.messageRendered || <span className="text-white/30">(빈 결과)</span>}</div>
                  {selected.messageErrors.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-rose-400/30 text-rose-400 text-[10px]">
                      <div className="font-semibold mb-1 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Liquid 오류
                      </div>
                      {selected.messageErrors.map((e, i) => <div key={i}>· {e.type}: {e.message}</div>)}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Liquid 문법 가이드 toggle */}
            <details className="p-3 bg-slate-950/40 border border-white/5 rounded-lg text-[11px]">
              <summary className="cursor-pointer text-white/60 hover:text-white/80 flex items-center gap-1.5">
                <Code className="w-3 h-3" /> Liquid 문법 가이드
              </summary>
              <div className="mt-3 space-y-2 text-white/70 font-mono">
                <div>
                  <div className="text-violet-300 mb-0.5">변수 출력:</div>
                  <div className="pl-2">{'{{ customer.name }}'} / {'{{ customer.grade }}'}</div>
                </div>
                <div>
                  <div className="text-violet-300 mb-0.5">기본값 fallback:</div>
                  <div className="pl-2">{'{{ customer.name | default: \'고객\' }}'}</div>
                </div>
                <div>
                  <div className="text-violet-300 mb-0.5">숫자 포맷 (한국 천 단위 콤마):</div>
                  <div className="pl-2">{'{{ customer.points | format_number }}'}</div>
                </div>
                <div>
                  <div className="text-violet-300 mb-0.5">계산:</div>
                  <div className="pl-2">{'{{ customer.points | minus: 1000 }}'} / {'{{ customer.amount | times: 0.1 | round: 0 }}'}</div>
                </div>
                <div>
                  <div className="text-violet-300 mb-0.5">조건 분기:</div>
                  <div className="pl-2 whitespace-pre">
                    {'{% if customer.grade == \'VIP\' %}\n  VIP 안내\n{% elsif customer.purchase_count > 10 %}\n  단골 안내\n{% else %}\n  일반 안내\n{% endif %}'}
                  </div>
                </div>
                <div>
                  <div className="text-violet-300 mb-0.5">사용 가능 필드:</div>
                  <div className="pl-2 text-white/60">name / phone / grade / age / gender / region / points / purchase_count / recent_purchase_store / recent_purchase_amount / recent_purchase_date</div>
                </div>
                <div>
                  <div className="text-violet-300 mb-0.5">filter 10건:</div>
                  <div className="pl-2 text-white/60">default / upcase / downcase / capitalize / minus / plus / divided_by / times / round / format_number</div>
                </div>
              </div>
            </details>
          </div>
        </div>

        {/* 푸터 */}
        <div className="p-3 border-t border-white/10 bg-slate-950/40 flex items-center justify-between text-[11px] text-white/50">
          <div>1:1 진정 개인화: 1개 메시지 작성 = 사용자별 무한 분기 자동 처리</div>
          <button onClick={onClose} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white/80 rounded text-xs">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
