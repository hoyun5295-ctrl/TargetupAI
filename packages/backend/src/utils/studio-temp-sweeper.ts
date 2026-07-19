/**
 * utils/studio-temp-sweeper.ts — P4 이미지 스튜디오 temp 산출물 7일 스윕 (2026-07-19)
 *
 * 저장하지 않은 생성/합성 산출물(uploads/studio-temp/{companyId}/)을 mtime 7일 기준 1일 1회 정리.
 * 화면에 "7일 후 자동 삭제" 명시 → 스윕-편집 경합은 이 문구로 수용(설계 §5-1-8 / 리뷰 M-6).
 * 호출 = app.ts:listen 안 startStudioTempSweeper().
 */

import { sweepOldTemp, STUDIO_TEMP_TTL_DAYS } from './image-studio';

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1일 1회

export function startStudioTempSweeper() {
  if (process.env.VITEST) return;
  console.log(`🧹 [studio-temp] ${STUDIO_TEMP_TTL_DAYS}일 스윕 worker 시작 (1일 주기)`);
  runSweep();
  setInterval(runSweep, SWEEP_INTERVAL_MS);
}

function runSweep() {
  try {
    const removed = sweepOldTemp();
    if (removed > 0) console.log(`[studio-temp] ${removed}개 파일 정리(만료 ${STUDIO_TEMP_TTL_DAYS}일)`);
  } catch (err: any) {
    console.error('[studio-temp] 스윕 오류:', err?.message || err);
  }
}
