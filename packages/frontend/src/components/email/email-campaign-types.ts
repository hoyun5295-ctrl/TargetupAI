// 이메일 캠페인 공유 타입 — 페이지와 분석 모달이 함께 쓴다(컴포넌트↔페이지 순환 import 회피).
import type { Section } from '../../utils/dm-section-defaults';

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'completed' | 'failed';

export interface EmailCampaign {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string | null;
  hasPlaceholder?: boolean;  // 백엔드 계산 — AI 미입력 자리([…직접/입력해/작성해…]) 잔존 여부 (발송 전 인지 배지)
  fromName: string;
  fromEmail: string;
  isAd: boolean;
  aiGenerated?: boolean;
  scheduledAt: string | null;
  sentAt: string | null;
  status: CampaignStatus;
  sentCount: number;
  openCount: number;
  clickCount: number;
  bounceCount: number;
  unsubscribeCount: number;
  createdAt: string;
  sections?: Section[] | null; // 비주얼 빌더 Section[] (있으면 비주얼 에디터로 수정)
  completed?: boolean; // ★ 2026-07-02 완성(50크레딧 납부) 여부 — 미완성 = 발송 잠금 (PC 미리보기는 항상 허용 — 07-02(3) Harold 지시)
  parentCampaignId?: string | null; // ★ 2026-07-06 재발송 자식이면 원본 id (재발송 배지·재발송 게이트)
  resendGeneration?: number;        // 원본=0, 재발송본=1
}
