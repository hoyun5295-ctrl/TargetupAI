import React from 'react';

/**
 * ★ D93: 메시지 내 %변수% 부분을 하이라이트 span으로 감싸서 React 요소 배열로 반환
 *
 * 사용처: AiCampaignResultPopup(한줄로), AiCustomSendFlow(맞춤한줄), AiCampaignSendModal(발송확인)
 *
 * @param text 원본 메시지 (예: "안녕하세요 %고객명%님!")
 * @returns React.ReactNode[] — 일반 텍스트 + 하이라이트 span 배열
 */
export function highlightVars(text: string): React.ReactNode[] {
  if (!text) return [text];

  const parts: React.ReactNode[] = [];
  // ★ D93 fix: [^%\s]{1,20}으로 공백/줄바꿈 제외 — "30% 할인...%변수%" 같은 텍스트에서 30%~%변수% 사이 전체가 매칭되는 버그 방지
  const regex = /%([^%\s]{1,20})%/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    // 변수 앞의 일반 텍스트
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    // %변수% 하이라이트
    parts.push(
      <span key={key++} className="bg-amber-100 text-amber-800 px-0.5 rounded font-medium">
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
 * ★ 검수리스트 UX (B검수): 샘플 고객 데이터로 %변수% 치환 미리보기
 *
 * 캠페인 확정 화면에서 사용자가 "머지 결과 보기" 토글을 누르면
 * 첫 번째 고객(또는 추천 샘플)의 실제 값으로 치환된 결과를 표시.
 * 직원 의견: "리스트 적용이 아니라 머지 입력 구간이 직관적으로 보이게"
 *
 * 사용처: AiCampaignSendModal, AiCustomSendFlow의 메시지 미리보기 영역
 *
 * @param text 원본 메시지 (예: "안녕하세요 %고객명%님!")
 * @param sampleCustomer displayName 키 객체 (예: { "고객명": "김철수", "등급": "VIP" })
 * @returns React.ReactNode[] — 치환된 텍스트 + 치환 부분 강조 span
 */
export function mergeAndHighlightVars(
  text: string,
  sampleCustomer?: Record<string, string | number | null | undefined>
): React.ReactNode[] {
  if (!text) return [text];

  const parts: React.ReactNode[] = [];
  const regex = /%([^%\s]{1,20})%/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const varName = match[1];
    const value = sampleCustomer?.[varName];
    if (value !== null && value !== undefined && value !== '') {
      // 치환된 값 — 초록 배경(머지 완료 시각화)
      parts.push(
        <span key={key++} className="bg-emerald-100 text-emerald-800 px-0.5 rounded font-medium" title={`%${varName}% → 첫 고객 데이터로 치환됨`}>
          {String(value)}
        </span>
      );
    } else {
      // 데이터 없음 — 회색 배경 + 변수 그대로
      parts.push(
        <span key={key++} className="bg-gray-200 text-gray-500 px-0.5 rounded font-medium line-through" title={`%${varName}% — 샘플 고객에 데이터 없음`}>
          {match[0]}
        </span>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}
