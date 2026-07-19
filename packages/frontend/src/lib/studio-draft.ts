/**
 * lib/studio-draft.ts — 이미지 스튜디오 → 채널 편집기 소재 주입 초안 (2026-07-19 P4)
 *
 * 라이브러리 소재 클릭 → [인앱/DM/이메일 만들기] 액션이 초안을 넣고 편집기로 이동하면,
 * 각 편집기가 mount 시 takeEventDraft(1회 소비·30분 TTL — EventCampaignModal 공용 CT)로 꺼내
 * 이미지가 삽입된 새 초안을 연다. 행사 캠페인 초안 주입과 동일 배관(검증된 선례) 재사용.
 */

export const STUDIO_INAPP_DRAFT_KEY = 'hj_studio_inapp_draft';
export const STUDIO_DM_DRAFT_KEY = 'hj_studio_dm_draft';
export const STUDIO_EMAIL_DRAFT_KEY = 'hj_studio_email_draft';

export interface StudioDraft {
  imageUrl: string;
  /** 소재 파일명(제목 시드용 — 선택). */
  name?: string | null;
}

/** 초안 넣기 — 소비는 takeEventDraft(key)로 (ts 기반 30분 TTL 공유). */
export function putStudioDraft(key: string, draft: StudioDraft): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), ...draft }));
  } catch { /* sessionStorage 불가 환경 — 조용히 무시(버튼 흐름만 저하) */ }
}
