/**
 * Agent 버전 단일 진입점
 *
 * 배경(2026-06-11 인비토 첫 연동 실측): 실행 배너/heartbeat/서버 등록/자동 업데이터가 전부
 *   config.enc에 저장된 agent.version을 사용 → 구버전 설정을 보존한 채 exe만 교체해도
 *   새 바이너리가 옛 버전(v1.5.1)으로 표시/보고되어 실제 실행 파일 버전을 식별할 수 없었다.
 *   또한 버전 문자열이 5곳에 하드코딩되어(1.4.0/1.5.4 혼재) 서로 어긋났다.
 *
 * 원칙: 버전의 진실은 package.json 하나.
 *   - 번들 빌드(esbuild): define으로 __AGENT_VERSION__에 package.json version 주입
 *   - dev(tsx)/tsc 실행: package.json 직접 읽기
 *   - config.enc의 agent.version은 "마지막 저장 시점 기록"일 뿐, 표시/보고에 사용하지 않는다.
 */

declare const __AGENT_VERSION__: string | undefined;

function resolveVersion(): string {
  try {
    if (typeof __AGENT_VERSION__ === 'string' && __AGENT_VERSION__.length > 0) {
      return __AGENT_VERSION__;
    }
  } catch {
    // define 미주입 환경 — 아래 package.json 폴백
  }
  try {
    const pkg = require('../package.json') as { version?: string };
    if (pkg && typeof pkg.version === 'string' && pkg.version.length > 0) {
      return pkg.version;
    }
  } catch {
    // package.json 접근 불가 환경
  }
  return '0.0.0';
}

export const AGENT_VERSION: string = resolveVersion();
