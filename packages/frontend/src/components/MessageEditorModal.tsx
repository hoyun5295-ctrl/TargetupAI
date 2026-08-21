/**
 * MessageEditorModal.tsx — 문안 전용 편집기 모달 (2026-07-02 Harold 지시)
 *
 * 배경: AI Operator 결과 카드의 인라인 직접 편집(작은 textarea)은 보기 힘들고,
 *   링크/변수 삽입 도구를 붙일 공간이 없음 → 전용 편집기 모달로 격상.
 *
 * 구성
 *   좌측 = 큰 본문 편집 + 실시간 바이트 게이지 + 스마트 경고
 *          ((광고)/수신거부 직접 입력 감지 · EUC-KR 비호환 이모지 감지 · 채널 한도 초과)
 *        + 휴대폰 미리보기 탭(실제 수신 모습 — (광고)·무료거부 자동 부착 + 상위 고객 데이터 머지)
 *   우측 = 삽입 도구 패널: 개인화 변수 칩 · 우리 회사 CTA/빈출 표현 칩(브랜드보이스 가이드라인 자동 로드)
 *          · 브랜드 링크(커서 삽입) · 특수문자함(회사 이모지 우선 + EUC-KR 안전 세트)
 *
 * 원칙: 커서 삽입 = textInsert CT 재사용 · native dialog 0 · 모델명 노출 0 · 모바일 반응형.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Pencil, X, Eye, Type, Sparkles, Link2, Hash, AtSign, RotateCcw, Check, AlertTriangle, Smartphone,
} from 'lucide-react';
import { insertAtCursor } from '../utils/textInsert';
import { SMS_SAFE_CHARS, koreanBytes, hasIncompatibleEmoji } from '../utils/smsSafeChars';
import { highlightVars, mergeAndHighlightVars } from '../utils/highlightVars';
import BrandLinkChips from './BrandLinkChips';

interface MessageEditorModalProps {
  open: boolean;
  initialText: string;
  /** AI가 만든 원본 (복원 버튼용 — 없으면 복원 버튼 미표시) */
  originalText?: string;
  channel: string; // 'SMS' | 'LMS' | 'MMS' | ...
  isAd?: boolean;
  rejectNumber?: string;
  /** 개인화 변수 — token은 % 없는 bare (예: '고객명') */
  variables?: Array<{ token: string; label: string }>;
  sampleCustomer?: Record<string, any> | null;
  sampleCustomerFields?: Record<string, any> | null;
  onApply: (text: string) => void;
  onClose: () => void;
}

interface BrandExpressions {
  ctaPatterns: string[];
  frequentExpressions: string[];
  emojiWhitelist: string[];
}

export default function MessageEditorModal({
  open, initialText, originalText, channel, isAd, rejectNumber,
  variables = [], sampleCustomer, sampleCustomerFields, onApply, onClose,
}: MessageEditorModalProps) {
  const [draft, setDraft] = useState(initialText);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [mergedPreview, setMergedPreview] = useState(false);
  const [brandExpr, setBrandExpr] = useState<BrandExpressions | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(initialText);
      setTab('edit');
    }
  }, [open, initialText]);

  // 우리 회사 표현(CTA·빈출·이모지) — 브랜드보이스 가이드라인에서 1회 로드
  useEffect(() => {
    if (!open || brandExpr) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch('/api/ai-memory/brand-voice', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        const g = d?.guideline;
        setBrandExpr({
          ctaPatterns: Array.isArray(g?.cta_patterns) ? g.cta_patterns.filter(Boolean) : [],
          frequentExpressions: Array.isArray(g?.frequent_expressions) ? g.frequent_expressions.filter(Boolean) : [],
          emojiWhitelist: Array.isArray(g?.emoji_whitelist) ? g.emoji_whitelist.filter(Boolean) : [],
        });
      })
      .catch(() => setBrandExpr({ ctaPatterns: [], frequentExpressions: [], emojiWhitelist: [] }));
  }, [open, brandExpr]);

  const channelUpper = String(channel || 'LMS').toUpperCase();
  const byteLimit = channelUpper === 'SMS' ? 90 : 2000;
  const bytes = useMemo(() => koreanBytes(draft), [draft]);
  const bytePercent = Math.min(100, Math.round((bytes / byteLimit) * 100));
  const overLimit = bytes > byteLimit;

  const warnings = useMemo(() => {
    const list: string[] = [];
    if (/\(광고\)/.test(draft)) list.push('"(광고)"는 발송 시 자동으로 붙습니다. 본문에서 빼주세요.');
    if (/무료수신거부|무료거부|080[- ]?\d{3,4}[- ]?\d{4}/.test(draft)) list.push('무료수신거부 번호는 발송 시 자동으로 붙습니다. 본문에서 빼주세요.');
    if (hasIncompatibleEmoji(draft)) list.push('문자에서 깨질 수 있는 이모지가 있습니다. 특수문자함의 기호로 바꿔주세요.');
    if (overLimit) list.push(`${channelUpper} 한도(${byteLimit.toLocaleString()}바이트)를 초과했습니다.`);
    return list;
  }, [draft, overLimit, channelUpper, byteLimit]);

  // 커서 위치 삽입 — 미리보기 탭이면 편집 탭으로 전환 후 끝에 붙임(다음 편집부터 커서 삽입)
  function insertText(text: string) {
    if (tab === 'preview') {
      setTab('edit');
      setDraft((prev) => prev + text);
      return;
    }
    const ok = insertAtCursor(textareaRef.current, text, setDraft);
    if (!ok) setDraft((prev) => prev + text);
  }

  if (!open) return null;

  const previewBody = isAd && draft
    ? `(광고)\n${draft}${rejectNumber ? `\n무료거부 ${rejectNumber}` : ''}`
    : draft;

  const specialChars = brandExpr && brandExpr.emojiWhitelist.length > 0
    ? [...brandExpr.emojiWhitelist, ...SMS_SAFE_CHARS.filter((c) => !brandExpr.emojiWhitelist.includes(c))]
    : SMS_SAFE_CHARS;

  const hasBrandExpr = !!brandExpr && (brandExpr.ctaPatterns.length > 0 || brandExpr.frequentExpressions.length > 0);

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 backdrop-blur-sm p-2 md:p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[94vh] flex flex-col overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between gap-3 px-4 md:px-5 py-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-fuchsia-500 flex items-center justify-center shadow-lg shrink-0">
              <Pencil className="w-[18px] h-[18px] text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white truncate">문안 편집기</h3>
              <p className="text-[11px] text-white/40">{channelUpper} · 우측 도구로 변수·링크·표현을 커서 위치에 삽입</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* 좌측 — 편집/미리보기 */}
          <div className="flex-1 flex flex-col p-4 md:p-5 min-w-0 overflow-y-auto">
            <div className="flex items-center gap-1.5 mb-3 shrink-0">
              <button
                type="button"
                onClick={() => setTab('edit')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  tab === 'edit' ? 'bg-amber-400/25 text-amber-100 ring-1 ring-amber-300/40' : 'bg-white/5 text-white/45 hover:text-white/70'
                }`}
              >
                <Type className="w-3.5 h-3.5" /> 편집
              </button>
              <button
                type="button"
                onClick={() => setTab('preview')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  tab === 'preview' ? 'bg-emerald-400/25 text-emerald-100 ring-1 ring-emerald-400/40' : 'bg-white/5 text-white/45 hover:text-white/70'
                }`}
              >
                <Eye className="w-3.5 h-3.5" /> 미리보기
              </button>
              {tab === 'preview' && sampleCustomer && (
                <button
                  type="button"
                  onClick={() => setMergedPreview((v) => !v)}
                  className={`ml-auto px-2.5 py-1.5 rounded-lg text-[11px] transition-all ${
                    mergedPreview ? 'bg-emerald-400/20 text-emerald-100 ring-1 ring-emerald-400/30' : 'bg-white/5 text-white/45 hover:text-white/70'
                  }`}
                  title="상위 고객 데이터로 변수 치환 미리보기"
                >
                  {mergedPreview ? '고객 데이터 적용 중' : '고객 데이터로 보기'}
                </button>
              )}
            </div>

            {tab === 'edit' ? (
              <>
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  autoFocus
                  placeholder="문안을 입력하세요"
                  className="flex-1 min-h-[280px] lg:min-h-[380px] w-full bg-slate-950/70 border border-white/10 focus:border-amber-400/50 rounded-xl p-4 text-[15px] text-white/90 leading-relaxed font-sans resize-none outline-none placeholder-white/25 transition-colors"
                />
                {isAd && (
                  <p className="mt-2 text-[11px] text-white/35 italic shrink-0">
                    (광고)·무료거부 {rejectNumber}는 발송 시 자동으로 붙습니다. 본문만 입력하세요.
                  </p>
                )}
              </>
            ) : (
              <div className="flex-1 flex justify-center items-start py-2">
                <div className="w-full max-w-[340px] rounded-[2.5rem] border-4 border-slate-700 bg-slate-950 p-3 shadow-2xl">
                  <div className="rounded-[2rem] bg-slate-900 overflow-hidden">
                    <div className="px-4 py-2 text-center text-[11px] text-white/40 border-b border-white/5 flex items-center justify-center gap-1.5">
                      <Smartphone className="w-3 h-3" /> {channelUpper} 실제 수신 모습
                    </div>
                    <div className="p-4 min-h-[380px]">
                      <div className="rounded-2xl rounded-tl-sm bg-violet-600/90 text-white text-[14px] px-4 py-3 whitespace-pre-wrap leading-relaxed break-words">
                        {previewBody
                          ? (mergedPreview && sampleCustomer
                              ? mergeAndHighlightVars(previewBody, sampleCustomer, 'dark', sampleCustomerFields || undefined)
                              : highlightVars(previewBody, 'dark'))
                          : '(본문 없음)'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 바이트 게이지 + 경고 */}
            <div className="mt-3 shrink-0">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-white/40">본문 {draft.length.toLocaleString()}자</span>
                <span className={overLimit ? 'text-rose-300 font-semibold' : 'text-white/50'}>
                  {bytes.toLocaleString()} / {byteLimit.toLocaleString()} bytes
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${overLimit ? 'bg-rose-500' : bytePercent > 85 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                  style={{ width: `${bytePercent}%` }}
                />
              </div>
              {warnings.length > 0 && (
                <div className="mt-2 space-y-1">
                  {warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[11px] text-amber-300/90">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 우측 — 삽입 도구 패널 */}
          <div className="w-full lg:w-[320px] shrink-0 border-t lg:border-t-0 lg:border-l border-white/10 p-4 space-y-4 overflow-y-auto bg-slate-950/40">
            {variables.length > 0 && (
              <section>
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-white/70 mb-2">
                  <AtSign className="w-3.5 h-3.5 text-violet-300" /> 개인화 변수
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {variables.map((v) => (
                    <button
                      key={v.token}
                      type="button"
                      onClick={() => insertText(`%${v.token}%`)}
                      className="px-2 py-1 text-[11px] rounded-lg border bg-violet-500/15 text-violet-200 border-violet-400/30 hover:bg-violet-500/30 hover:text-white transition-colors"
                      title={`%${v.token}% 삽입`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {hasBrandExpr && (
              <section>
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-white/70 mb-2">
                  <Sparkles className="w-3.5 h-3.5 text-fuchsia-300" /> 우리 회사 표현
                  <span className="font-normal text-white/35">(브랜드보이스 학습값)</span>
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {brandExpr!.ctaPatterns.map((c, i) => (
                    <button
                      key={`cta-${i}`}
                      type="button"
                      onClick={() => insertText(c)}
                      className="px-2 py-1 text-[11px] rounded-lg border bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-400/30 hover:bg-fuchsia-500/30 hover:text-white transition-colors"
                      title="CTA 패턴 삽입"
                    >
                      {c}
                    </button>
                  ))}
                  {brandExpr!.frequentExpressions.map((f, i) => (
                    <button
                      key={`freq-${i}`}
                      type="button"
                      onClick={() => insertText(f)}
                      className="px-2 py-1 text-[11px] rounded-lg border bg-white/5 text-white/70 border-white/15 hover:bg-white/15 hover:text-white transition-colors"
                      title="빈출 표현 삽입"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-white/70 mb-2">
                <Link2 className="w-3.5 h-3.5 text-sky-300" /> 브랜드 링크
              </h4>
              <BrandLinkChips tone="dark" onInsert={(u) => insertText(u)} />
            </section>

            <section>
              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-white/70 mb-2">
                <Hash className="w-3.5 h-3.5 text-emerald-300" /> 특수문자
                <span className="font-normal text-white/35">(문자 발송 안전 기호만)</span>
              </h4>
              <div className="grid grid-cols-8 gap-1">
                {specialChars.map((c, i) => (
                  <button
                    key={`${c}-${i}`}
                    type="button"
                    onClick={() => insertText(c)}
                    className="h-8 flex items-center justify-center text-sm rounded-lg border border-white/10 bg-white/5 text-white/80 hover:bg-emerald-500/20 hover:border-emerald-400/40 hover:text-white transition-colors"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-between gap-2 px-4 md:px-5 py-3 border-t border-white/10 shrink-0">
          <div>
            {originalText !== undefined && draft !== originalText && (
              <button
                type="button"
                onClick={() => setDraft(originalText)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs text-white/60 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                title="AI가 만든 원본 문안으로 되돌립니다"
              >
                <RotateCcw className="w-3.5 h-3.5" /> 원본 복원
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-white/70 border border-white/15 rounded-lg hover:bg-white/10 transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => onApply(draft)}
              className="flex items-center gap-1.5 px-5 py-2 text-sm bg-gradient-to-r from-amber-500 to-fuchsia-600 hover:from-amber-400 hover:to-fuchsia-500 text-white rounded-lg font-semibold shadow-lg transition-all"
            >
              <Check className="w-4 h-4" /> 적용
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
