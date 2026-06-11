/**
 * kakao-template-sync-worker.ts (D217+ 2026-05-26 Harold 명시 진단 영역 정정)
 *
 * 옛 D147 영역 = 검수 통과 후 IMC 안 진정 카카오 templateCode 영역 영구 발급 →
 * 한줄로 안 동기화 영역 영구 누락 사고 영역 정정 = 30분 cron 영역 영구 안전망.
 *
 * 흐름:
 *   1) 서버 부팅 60초 후 첫 runOnce 영역
 *   2) 30분 주기 setInterval 영역
 *   3) syncTemplateCodes() 호출 → 옛 Tmp_xxx 영역 = 진정 카카오 templateCode 영구 정정
 *
 * 영구 안전망 영역:
 *   - _running flag = 중복 실행 영구 차단 (옛 영역 영구 사이클 영역 영구 안전)
 *   - try/catch 영구 보호 (옛 IMC 영역 영구 실패 시 worker 영역 영구 stop 영역 차단)
 *   - 옛 캠페인 sync worker 영역 패턴 정합 (campaign-sync-worker.ts 영역)
 */

import { syncTemplateCodes, syncTemplateStatuses } from './kakao-template-sync';

const INTERVAL_MS = 30 * 60 * 1000; // 30분 영역
const BOOT_DELAY_MS = 60 * 1000;    // 60초 영역 (서버 부팅 영구 안전)

let _running = false;
let _timer: NodeJS.Timeout | null = null;
let _boot: NodeJS.Timeout | null = null;

function log(...args: any[]) {
  console.log('[kakao-template-sync-worker]', ...args);
}

async function runOnce(): Promise<void> {
  if (_running) {
    log('이전 사이클 영역 진행 중 — skip');
    return;
  }
  _running = true;
  const startedAt = Date.now();
  try {
    const result = await syncTemplateCodes();
    const elapsedMs = Date.now() - startedAt;
    if (result.scanned > 0) {
      log(
        `사이클 종결 — scanned=${result.scanned} matched=${result.matched} updated=${result.updated} skipped=${result.skipped} failed=${result.failed} (${elapsedMs}ms)`,
      );
    }

    // ★ 2026-06-10: IMC 템플릿 활성상태(A/R/S) 동기화 — 검수 승인인데 활성 대기(R)라 7300 나던 사례의 영구 안전망
    try {
      const st = await syncTemplateStatuses();
      if (st.updated > 0) {
        log(`활성상태 동기화 — scanned=${st.scanned} updated=${st.updated}`);
      }
    } catch (stErr: any) {
      log('활성상태 동기화 오류 (skip):', stErr?.message || stErr);
    }
  } catch (err: any) {
    log('전체 오류:', err?.message || err);
  } finally {
    _running = false;
  }
}

export function startKakaoTemplateSyncWorker(): void {
  if (_timer || _boot) return;
  log(`started — boot ${BOOT_DELAY_MS / 1000}초 후 첫 실행, 이후 ${INTERVAL_MS / 1000}초 주기`);
  _boot = setTimeout(() => {
    _boot = null;
    runOnce();
    _timer = setInterval(runOnce, INTERVAL_MS);
  }, BOOT_DELAY_MS);
}

export function stopKakaoTemplateSyncWorker(): void {
  if (_boot) {
    clearTimeout(_boot);
    _boot = null;
  }
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  log('stopped');
}
