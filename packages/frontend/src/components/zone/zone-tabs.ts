/**
 * zone-tabs.ts — 여러 주소를 한 메뉴의 탭으로 묶는 목록(★ 2026-09-30 AI 존 대개편 · 설계서 §4-12)
 *
 * AI 메모리 = 학습 · 자율 예측 · 세그먼트 · AI 사용량. 예측(0920)·세그먼트(0812)·사용량(0709)은 허브 타일에서 내려
 * AI 메모리 머리 버튼으로 옮긴 화면이다(Harold 확정). 이번 개편은 그 머리 버튼 셋을 **같은 탭 줄**로 바꾼다 —
 * 라우트는 그대로(주소가 탭을 소유 · 뒤로 가기가 탭을 되돌린다). 네 화면이 같은 목록을 import 해 탭이 갈라지지 않는다.
 */
import type { ZoneTab } from './ZoneHeader';

export const AI_MEMORY_TABS: ZoneTab[] = [
  { id: 'learn', label: '학습', to: '/ai-memory' },
  { id: 'predictive', label: '자율 예측', to: '/predictive' },
  { id: 'segments', label: '세그먼트', to: '/segments' },
  { id: 'usage', label: 'AI 사용량', to: '/ai-usage' },
];

/** 인앱 메시지 채널(주소 없음 · 채널 상태가 탭을 소유 · 웹 표시 불가 판정은 화면이 한다) */
export const INAPP_CHANNEL_TABS: ZoneTab[] = [
  { id: 'web', label: '웹 자사몰' },
  { id: 'app', label: '모바일 앱' },
];
