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
 * 샘플 고객 데이터로 %변수% + {{ Liquid 변수 }}를 치환하고 강조 span으로 표시.
 *
 * 단순 케이스(%변수% + {{ 변수 }})는 토큰 단위로 둘 다 치환·강조한다.
 * 조건 블록({% if %} 등)이 있으면 전체 Liquid 렌더링 후 %변수%만 강조한다.
 *
 * 사용처: AiCampaignSendModal, AiCustomSendFlow, AiOperatorPage, JourneysPage 메시지 미리보기.
 *
 * @param text 원본 메시지 (예: "%고객명%님" 또는 "{{ customer.name }}님")
 * @param sampleCustomer 한국어 키 객체 (예: { "고객명": "김민수", "등급": "VIP" }) — %변수% 치환
 * @param theme 'light' (default) 또는 'dark'
 * @param sampleCustomerFields 영문 키 객체 (예: { name: "김민수", grade: "VIP" }) — {{ Liquid }} 렌더링
 * @returns React.ReactNode[] — 치환된 텍스트 + 강조 span
 */
export function mergeAndHighlightVars(
  text: string,
  sampleCustomer?: Record<string, string | number | null | undefined>,
  theme: 'light' | 'dark' = 'light',
  sampleCustomerFields?: Record<string, any>
): React.ReactNode[] {
  if (!text) return [text];

  // theme 별 강조 className
  const mergedClass = theme === 'dark'
    ? 'bg-emerald-400/25 text-emerald-100 px-1 py-0.5 rounded font-semibold ring-1 ring-emerald-400/40'
    : 'bg-emerald-100 text-emerald-800 px-0.5 rounded font-medium';
  const missingClass = theme === 'dark'
    ? 'bg-white/10 text-white/40 px-1 py-0.5 rounded font-medium line-through'
    : 'bg-gray-200 text-gray-500 px-0.5 rounded font-medium line-through';

  // {% if %}/{% for %} 등 조건·반복 블록이 있으면 분기 결과는 변수 단위 강조가 모호하다.
  // 이 경우 전체 Liquid 렌더링 후 %변수%만 강조 (기존 동작 유지).
  const hasBlockTag = /\{%/.test(text);
  if (hasBlockTag) {
    let renderedText = text;
    if (sampleCustomerFields) {
      try {
        const result = renderLiquid(text, { customer: sampleCustomerFields });
        if (result.errors.length === 0) renderedText = result.rendered;
      } catch {
        // 렌더링 오류 시 원본 fallback
      }
    }
    return highlightPercentVars(renderedText, sampleCustomer, mergedClass, missingClass);
  }

  // 단순 케이스: %변수% + {{ Liquid 변수 }}를 토큰 단위로 치환하고 둘 다 강조.
  const parts: React.ReactNode[] = [];
  const regex = /(%[^%\s]{1,20}%)|(\{\{[^}]+\}\})/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      // %변수% — sampleCustomer(한국어 키) 치환
      const varName = match[1].slice(1, -1);
      const value = sampleCustomer?.[varName];
      if (value !== null && value !== undefined && value !== '') {
        parts.push(
          <span key={key++} className={mergedClass} title={`%${varName}% → 첫 고객 데이터로 치환됨`}>
            {String(value)}
          </span>
        );
      } else {
        parts.push(
          <span key={key++} className={missingClass} title={`%${varName}%: 샘플 고객에 데이터 없음`}>
            {match[0]}
          </span>
        );
      }
    } else {
      // {{ Liquid 변수 }} — sampleCustomerFields(영문 키)로 개별 렌더
      let rendered = '';
      if (sampleCustomerFields) {
        try {
          const r = renderLiquid(match[0], { customer: sampleCustomerFields });
          if (r.errors.length === 0) rendered = r.rendered;
        } catch {
          // 무시 — 원본 표시
        }
      }
      if (rendered && rendered !== match[0]) {
        parts.push(
          <span key={key++} className={mergedClass} title={`${match[0]} → 고객 데이터로 치환됨`}>
            {rendered}
          </span>
        );
      } else {
        parts.push(
          <span key={key++} className={missingClass} title={`${match[0]}: 치환 데이터 없음`}>
            {match[0]}
          </span>
        );
      }
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

/**
 * 미리보기 전용 — 강조(span) 없이 순수 치환 결과 문자열만 반환.
 * 조건 블록({% %}) 유무와 무관하게 모든 step이 동일하게 "실제 발송 모습"으로 보이도록 통일.
 * (mergeAndHighlightVars는 블록이 있으면 {{ }} 강조가 빠져 step마다 강조가 들쭉날쭉했음)
 */
export function mergeVarsPlain(
  text: string,
  sampleCustomer?: Record<string, string | number | null | undefined>,
  sampleCustomerFields?: Record<string, any>,
): string {
  if (!text) return '';
  let result = text;
  // Liquid 렌더 ({% if %} 블록 + {{ 변수 }})
  if (sampleCustomerFields && /\{[{%]/.test(text)) {
    try {
      const r = renderLiquid(text, { customer: sampleCustomerFields });
      if (r.errors.length === 0) result = r.rendered;
    } catch {
      // 렌더 오류 시 원본 fallback
    }
  }
  // %변수% (한국어 키) 치환
  if (sampleCustomer) {
    result = result.replace(/%([^%\s]{1,20})%/g, (_m, name: string) => {
      const v = sampleCustomer[name];
      return (v !== null && v !== undefined && v !== '') ? String(v) : _m;
    });
  }
  return result;
}

// %변수%만 강조 (조건 블록 Liquid 렌더링 후 사용)
function highlightPercentVars(
  renderedText: string,
  sampleCustomer: Record<string, string | number | null | undefined> | undefined,
  mergedClass: string,
  missingClass: string,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /%([^%\s]{1,20})%/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(renderedText)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderedText.slice(lastIndex, match.index));
    }
    const varName = match[1];
    const value = sampleCustomer?.[varName];
    if (value !== null && value !== undefined && value !== '') {
      parts.push(
        <span key={key++} className={mergedClass} title={`%${varName}% → 첫 고객 데이터로 치환됨`}>
          {String(value)}
        </span>
      );
    } else {
      parts.push(
        <span key={key++} className={missingClass} title={`%${varName}%: 샘플 고객에 데이터 없음`}>
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

/**
 * default 필터 없는 Liquid 출력 변수({{ ... }})를 추출.
 *
 * `{{ customer.grade | default: '고객' }}`처럼 default 필터가 있으면 값이 없어도 대체값이 나가지만,
 * `{{ customer.grade }}`는 값이 없으면 그 자리가 통째로 비어 발송 문구의 줄이 빈다.
 * 작성자에게 default 추가를 권하기 위해 위험한 변수만 모아 반환한다.
 *
 * 사용처: JourneyMessageEditModal 빈 변수 경고.
 *
 * @param text 메시지 본문
 * @returns default 없는 {{ }} 출력 변수 목록(중복 제거, 원형 그대로)
 */
export function findUndefaultedLiquidVars(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  const regex = /\{\{([^}]+)\}\}/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    // default 필터가 있으면 값 누락 시에도 대체값으로 채워져 안전
    if (/\|\s*default\s*:/.test(match[1])) continue;
    found.push(match[0].trim());
  }
  return Array.from(new Set(found));
}
