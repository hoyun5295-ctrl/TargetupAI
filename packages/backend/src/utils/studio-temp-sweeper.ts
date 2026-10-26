/**
 * utils/studio-temp-sweeper.ts — P4 이미지 스튜디오 temp 산출물 7일 스윕 (2026-07-19)
 *
 * 저장하지 않은 생성/합성 산출물(uploads/studio-temp/{companyId}/)을 mtime 7일 기준 1일 1회 정리.
 * 화면에 "7일 후 자동 삭제" 명시 → 스윕-편집 경합은 이 문구로 수용(설계 §5-1-8 / 리뷰 M-6).
 * ★ 2026-10-26 S10 · D3 — 같은 하루 주기에 SNS 파일도 정리한다(게시본 7일 · 원본 = 마지막으로 쓴 지 90일 · sns-media.ts).
 * 호출 = app.ts:listen 안 startStudioTempSweeper().
 */

import { sweepOldTemp, STUDIO_TEMP_TTL_DAYS } from './image-studio';
import { sweepSnsRenderFiles, sweepSnsMediaFiles } from './sns-media';
import { query } from '../config/database';

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1일 1회

export function startStudioTempSweeper() {
  if (process.env.VITEST) return;
  console.log(`🧹 [studio-temp] ${STUDIO_TEMP_TTL_DAYS}일 스윕 worker 시작 (1일 주기 · SNS 게시본 · 원본 포함)`);
  void runSweep();
  setInterval(() => { void runSweep(); }, SWEEP_INTERVAL_MS);
}

async function runSweep() {
  try {
    const removed = sweepOldTemp();
    if (removed > 0) console.log(`[studio-temp] ${removed}개 파일 정리(만료 ${STUDIO_TEMP_TTL_DAYS}일)`);
  } catch (err: any) {
    console.error('[studio-temp] 스윕 오류:', err?.message || err);
  }
  try {
    const renders = sweepSnsRenderFiles();
    const originals = await sweepSnsMediaFiles({ query });
    if (renders + originals > 0) console.log(`[sns-media] 게시본 ${renders}개 · 원본 ${originals}개 정리`);
  } catch (err: any) {
    console.error('[sns-media] 스윕 오류:', err?.message || err);
  }
}
