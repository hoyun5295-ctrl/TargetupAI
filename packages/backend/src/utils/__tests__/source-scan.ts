/**
 * 소스 전수 스캔 헬퍼 — **테스트 전용**(vitest include는 `*.test.ts`라 이 파일은 수집되지 않는다).
 *
 * ★2026-08-17 신설. 경위: 불변식 테스트들이 파일마다 자기 walker를 두고 **테스트마다 트리를 다시
 * 읽고 있었다**(ai-call-invariants 3회 × 573파일 · brand-axis-invariants 5회 × 백엔드+프론트).
 * IO가 느린 환경에서 첫 테스트가 기본 5초 타임아웃을 넘겨 pre-push가 막혔다 — 불변식 위반이 아니라
 * 읽기 중복이 원인이었다. 루트별로 한 번만 읽어 캐시한다.
 *
 * 스캔 대상 = `.ts`·`.tsx`(테스트 파일 제외) · `node_modules`·`dist` 제외.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

export interface ScannedFile {
  /** 절대 경로 */
  path: string;
  /** 스캔 루트 기준 상대 경로(위반 보고용) */
  rel: string;
  /** 파일 전문 */
  src: string;
}

const cache = new Map<string, ScannedFile[]>();

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    // withFileTypes라 statSync를 따로 부르지 않는다(항목 수만큼 시스템 콜이 줄어든다)
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** 루트별 1회 스캔 후 캐시. 같은 러너 프로세스 안에서 몇 번을 불러도 IO는 한 번이다. */
export function scanSources(root: string): ScannedFile[] {
  const hit = cache.get(root);
  if (hit) return hit;
  const files = walk(root, []).map((path) => ({
    path,
    rel: relative(root, path),
    src: readFileSync(path, 'utf8'),
  }));
  cache.set(root, files);
  return files;
}

/** IO가 느린 환경(실시간 검사·병렬 러너)에서도 첫 스캔이 끝나도록 주는 여유. */
export const SCAN_TIMEOUT_MS = 60_000;
