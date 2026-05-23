import React from 'react';
import { renderLiquid } from './liquid-templating';

/**
 * ★ D93: 메시지 내 %변수% / Liquid 태그({{ }}, {% %}) 부분을 하이라이트 span으로 감싸서 React 요소 배열로 반환
 *
 * 사용처: AiCampaignResultPopup(한줄로), AiCustomSendFlow(맞춤한줄), AiCampaignSendModal(발송확인), AiOperatorPage(D210+ fix4), JourneysPage(D210+ fix6)
 *
 * ★ D210+ Phase 2-fix4 (Harold 명시 2026-05-23): theme prop 신규 — dark 영역 = AiOperatorPage 보라색 배경 정합.
 * ★ D210+ Phase 2-fix9 (Harold 명시 2026-05-23): Liquid 태그/변수 영역도 amber 강조 추가 — 원본 영역 시각화 완전 매트릭스.
 *
 * @param text 원본 메시지 (예: "안녕하세요 %고객명%님! {% if customer.grade %}VIP{% endif %}")
 * @param theme 'light' (default, 기존 영역) 또는 'dark' (AiOperatorPage 보라색 배경)
 * @returns React.ReactNode[] — 일반 텍스트 + 하이라이트 span 배열
 */
export function highlightVars(text: string, theme: 'light' | 'dark' = 'light'): React.ReactNode[] {
  if (!text) return [text];

  const parts: React.ReactNode[] = [];
  // ★ D210+ Phase 2-fix9: %변수% + {{ Liquid 변수 }} + {% Liquid 태그 %} 모두 매칭
  //   D93 fix 영역: %영역 매칭 = 공백 X 정합 (30% 할인 영역 사고 차단)
  const regex = /(%[^%\s]{1,20}%)|(\{\{[^}]+\}\})|(\{%[^%]+%\})/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  // dark 영역 = AiOperatorPage 보라색 배경 정합 (amber 톤 dark)
  const className = theme === 'dark'
    ? 'bg-amber-300/25 text-amber-100 px-1 py-0.5 rounded font-semibold ring-1 ring-amber-300/40'
    : 'bg-amber-100 text-amber-800 px-0.5 rounded font-medium';

  while ((match = regex.exec(text)) !== null) {
    // 변수 앞의 일반 텍스트
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    // %변수% / Liquid 영역 하이라이트
    parts.push(
      <span key={key++} className={className}>
        {match[0]}
      </span>
    );
    lastIndex = regex.lastIndex;
  }

  // 마지막 일반 텍스트
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

/**
 * ★ 검수리스트 UX (B검수): 샘플 고객 데이터로 %변수% + Liquid 태그/변수 치환 미리보기
 *
 * 캠페인 확정 화면에서 사용자가 "머지 결과 보기" 토글을 누르면
 * 첫 번째 고객(또는 추천 샘플)의 실제 값으로 치환된 결과를 표시.
 *
 * 사용처: AiCampaignSendModal, AiCustomSendFlow, AiOperatorPage(D210+ fix4), JourneysPage(D210+ fix6) 메시지 미리보기 영역
 *
 * ★ D210+ Phase 2-fix4 (Harold 명시 2026-05-23): theme prop 신규 — dark 영역 매트릭스 추가.
 * ★ D210+ Phase 2-fix9 (Harold 명시 2026-05-23): sampleCustomerFields 옵션 신규 — Liquid 렌더링 통합.
 *   본질 = 옛 사고 영역 {% if customer.churn_risk > 0.6 %} 영역 그대로 표시 → renderLiquid 호출 영역으로 사용자별 분기 결과 렌더링 정합.
 *
 * @param text 원본 메시지 (예: "안녕하세요 %고객명%님!")
 * @param sampleCustomer displayName 키 객체 (예: { "고객명": "김민수", "등급": "VIP" }) — %변수% 매칭 영역
 * @param theme 'light' (default) 또는 'dark'
 * @param sampleCustomerFields field 키 객체 (예: { name: "김민수", grade: "VIP", churn_risk: 0.5 }) — Liquid 렌더링 영역
 * @returns React.ReactNode[] — 치환된 텍스트 + 치환 부분 강조 span
 */
export function mergeAndHighlightVars(
  text: string,
  sampleCustomer?: Record<string, string | number | null | undefined>,
  theme: 'light' | 'dark' = 'light',
  sampleCustomerFields?: Record<string, any>
): React.ReactNode[] {
  if (!text) return [text];

  // ★ D210+ Phase 2-fix9: Liquid 렌더링 영역 (sampleCustomerFields 영역 있을 때)
  //   {% if customer.churn_risk > 0.6 %} ... {% endif %} 영역 = 사용자별 분기 결과 렌더링 정합.
  //   {{ customer.name }} 영역 = Liquid 변수 → 실제 값 치환 영역.
  //   사고 차단 = 옛 영역 Liquid 태그 그대로 표시 사고 (renderLiquid 호출 X 영역 사고).
  let renderedText = text;
  if (sampleCustomerFields) {
    try {
      const result = renderLiquid(text, { customer: sampleCustomerFields });
      if (result.errors.length === 0) {
        renderedText = result.rendered;
      }
      // 렌더링 오류 영역 시 옛 text 영역 fallback (안전 영역)
    } catch {
      // 무시 — 옛 text 영역 fallback
    }
  }

  const parts: React.ReactNode[] = [];
  const regex = /%([^%\s]{1,20})%/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  // theme 별 className 매트릭스
  const mergedClass = theme === 'dark'
    ? 'bg-emerald-400/25 text-emerald-100 px-1 py-0.5 rounded font-semibold ring-1 ring-emerald-400/40'
    : 'bg-emerald-100 text-emerald-800 px-0.5 rounded font-medium';
  const missingClass = theme === 'dark'
    ? 'bg-white/10 text-white/40 px-1 py-0.5 rounded font-medium line-through'
    : 'bg-gray-200 text-gray-500 px-0.5 rounded font-medium line-through';

  while ((match = regex.exec(renderedText)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderedText.slice(lastIndex, match.index));
    }
    const varName = match[1];
    const value = sampleCustomer?.[varName];
    if (value !== null && value !== undefined && value !== '') {
      // 치환된 값 — 초록 배경(머지 완료 시각화)
      parts.push(
        <span key={key++} className={mergedClass} title={`%${varName}% → 첫 고객 데이터로 치환됨`}>
          {String(value)}
        </span>
      );
    } else {
      // 데이터 없음 — 회색 배경 + 변수 그대로
      parts.push(
        <span key={key++} className={missingClass} title={`%${varName}% — 샘플 고객에 데이터 없음`}>
          {match[0]}
        </span>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < renderedText.length) {
    parts.push(renderedText.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [renderedText];
}
