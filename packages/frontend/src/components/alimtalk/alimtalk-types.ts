/**
 * 알림톡 템플릿 타입/한글 라벨 컨트롤타워.
 *
 * IMC 매뉴얼(`kakao_alimtalk.md` 라인 343-346, 587-590, 1636, 1666) 100% 정합.
 * AlimtalkTemplateFormV2 / AlimtalkManagementSection 양쪽이 import해서 사용.
 * 인라인 라벨 정의 금지 — 본 파일이 유일한 진실의 원천.
 */

export type MsgType = 'BA' | 'EX' | 'AD' | 'MI';
export type EmphType = 'NONE' | 'TEXT' | 'IMAGE' | 'ITEM_LIST';

export const MSG_TYPES: { value: MsgType; label: string; desc: string }[] = [
  { value: 'BA', label: '기본형',       desc: '본문만' },
  { value: 'EX', label: '부가 정보형',  desc: '본문 + 부가정보' },
  { value: 'AD', label: '채널 추가형',  desc: '본문 + 채널 추가 버튼' },
  { value: 'MI', label: '복합형',       desc: '본문 + 부가정보 + 채널 추가' },
];

export const EMPH_TYPES: { value: EmphType; label: string }[] = [
  { value: 'NONE',      label: '사용안함' },
  { value: 'TEXT',      label: '강조 표기형' },
  { value: 'IMAGE',     label: '이미지형' },
  { value: 'ITEM_LIST', label: '아이템리스트형' },
];

export function getMsgTypeLabel(value: string): string {
  return MSG_TYPES.find((t) => t.value === value)?.label || value;
}

export function getEmphTypeLabel(value: string): string {
  return EMPH_TYPES.find((t) => t.value === value)?.label || value;
}

/**
 * 템플릿 유형 한글 표기 — 목록 화면 표시용.
 * NONE(사용안함)이면 messageType만 표시, 그 외엔 "메시지유형·강조유형" 형식.
 */
export function formatTemplateType(messageType: string, emphasizeType: string): string {
  const m = getMsgTypeLabel(messageType);
  if (!emphasizeType || emphasizeType === 'NONE') return m;
  const e = getEmphTypeLabel(emphasizeType);
  return `${m}·${e}`;
}
