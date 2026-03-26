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
