/**
 * PM2 영구 설정 (운영 영역)
 *
 * D183 (2026-05-20) — 슈퍼관리자 통계/캠페인/예약 페이지 응답 지연 사고 영구 fix.
 *
 * 진정 본질:
 *   - PG/MySQL 쿼리 영역 = 빠름 (5~10 ms, 본질 아님)
 *   - Node V8 Heap 영역 = 92.57% 점유 (315/341 MiB) → GC stop-the-world 빈번 = 진정 사고 본질
 *   - 진정 fix = Heap 한도 확장 + max_memory_restart 안전망
 *
 * D182 영구 안전망 보호:
 *   - mysql-refund-sweeper 30초 cron INTERVAL_MS 영역 변경 0건 (선불 오환불 reverse refund 영구 안전망)
 *   - 다른 컨트롤타워 영역 변경 0건
 *
 * 운영 적용:
 *   1) git pull (서버에서 본 파일 가져오기)
 *   2) cd /home/administrator/targetup-app
 *   3) pm2 delete targetup-backend
 *   4) pm2 start ecosystem.config.js
 *   5) pm2 save
 *   6) pm2 monit 으로 Heap Usage 65~75% 영역 확인
 */
module.exports = {
  apps: [
    {
      name: 'targetup-backend',
      script: '/usr/bin/ts-node',
      args: 'src/app.ts',
      cwd: '/home/administrator/targetup-app/packages/backend',

      // ★ 진정 1순위 fix — Heap 영역 2GB 확장 (기본 ~341MB → 2048MB)
      // ts-node 영역 운영 시 V8 JIT 컴파일 + AI Operator(Anthropic SDK) + Continuous Operator
      // + 6 sub-agent + Memory + Batch + Citations 누적 메모리 점유 대응.
      node_args: '--max-old-space-size=2048',

      // ★ 안전망 — 1.7GB 초과 시 자동 재시작 (OOM 차단)
      // node_args 2048MB 한도의 ~83% 임계값 = GC 정상 동작 + 메모리 누수 발견 시 자동 복구.
      max_memory_restart: '1700M',

      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,

      // 로그 영역 — 기존 PM2 default 경로 정합
      error_file: '/home/administrator/.pm2/logs/targetup-backend-error.log',
      out_file: '/home/administrator/.pm2/logs/targetup-backend-out.log',
      merge_logs: true,
      time: true,

      // 재시작 영역 — 안정성 강화
      min_uptime: '60s',           // 60초 이내 재시작 시 unstable 카운트
      max_restarts: 10,            // unstable 재시작 10회 초과 시 중단

      env: {
        NODE_ENV: 'production',
      },
    },
    // ★ 2026-09-06 AI 영업 아웃리치 렌더 워커 — 별도 프로세스(DB 자격 없음 · 동시 1건 · 127.0.0.1:4317 · 크롬은 워커 안 로컬 프록시 뒤).
    //   설계 = docs/2026-09-06-campaign-engine-design.md §S1 · 운영 = status/OPS.md §2-2-E ⑧
    //   기동(최초 1회 · delete 금지): pm2 start ecosystem.config.js --only outreach-render && pm2 save
    //   이후 코드 변경: pm2 reload outreach-render (env 변경 시 pm2 restart outreach-render --update-env)
    //   이 프로세스가 없어도 backend 는 정적 크롤로 정직하게 전진한다(ECONNREFUSED 즉시 폴백 · 사유 = stage_results.rendering).
    {
      name: 'outreach-render',
      script: '/usr/bin/ts-node',
      args: 'src/workers/outreach-render-worker.ts',
      cwd: '/home/administrator/targetup-app/packages/backend',
      node_args: '--max-old-space-size=512',
      // 크롬 자식 프로세스는 별도라 이 값은 ts-node 프로세스 자신의 상한이다. 크롬 폭주는 워커가 컨텍스트 종료 5초 초과 시 SIGKILL 로 수거한다.
      max_memory_restart: '900M',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      error_file: '/home/administrator/.pm2/logs/outreach-render-error.log',
      out_file: '/home/administrator/.pm2/logs/outreach-render-out.log',
      merge_logs: true,
      time: true,
      min_uptime: '30s',
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        OUTREACH_RENDER_PORT: '4317',
      },
    },
  ],
};
