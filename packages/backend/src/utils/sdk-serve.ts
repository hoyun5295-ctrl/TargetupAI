/**
 * ★ CT: 한줄로 SDK(hanjul.min.js) 서빙 (CORS) — 2026-07-08 신설
 *
 * 인앱 SDK를 몰 스토어프론트가 교차 출처로 로드할 수 있게 CORS + CORP 헤더와 함께 서빙한다.
 * 실물 = backend/sdk-serving/{version}/hanjul.min.js (커밋 소스 — git pull이면 항상 존재).
 *   (2026-07-18 company-frontend 패키지 폐기로 옛 company-frontend/public/sdk에서 이전 — URL·응답 불변.)
 * 카페24 scripttag src는 Access-Control-Allow-Origin: * 를 요구(미동봉 = 422).
 *
 * ★ 버전 폴백: 요청 버전 파일이 없으면 커밋된 최신 버전으로 서빙한다.
 *   (팝폰 등 옛 스니펫이 정적 미배포 버전 v0.3.6을 부르면 SPA index.html이 아니라 실제 SDK를 받게 — 자동 복구)
 *
 * 소비처: cafe24 scripttag(/api/cafe24/sdk/…) + 수동 스니펫(/api/cdp/sdk/…) + nginx가 넘기는 레거시(/sdk/…).
 * 옛 인라인 위치 = routes/cafe24.ts (2026-07-08 본 CT로 추출·공용화, no_inline_duplication).
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import type { Request, Response } from 'express';

// src/utils·dist/utils 어디서든 2단계 위 = backend 루트 → sdk-serving (dist 스왑과 무관한 위치)
const SDK_DIR = resolve(__dirname, '../../sdk-serving');
const VERSION_RE = /^v[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9]+)?$/;
const sdkFileCache = new Map<string, Buffer>();

function parseVer(v: string): [number, number, number] {
  const parts = v.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** 커밋된 SDK 버전 중 최신(semver 내림차순). 파일 없으면 null. */
function latestAvailableVersion(): string | null {
  try {
    const dirs = readdirSync(SDK_DIR).filter(
      (d) => VERSION_RE.test(d) && existsSync(resolve(SDK_DIR, d, 'hanjul.min.js')),
    );
    if (dirs.length === 0) return null;
    dirs.sort((a, b) => {
      const [a0, a1, a2] = parseVer(a);
      const [b0, b1, b2] = parseVer(b);
      return b0 - a0 || b1 - a1 || b2 - a2;
    });
    return dirs[0];
  } catch {
    return null;
  }
}

/**
 * SDK 파일 서빙 (Express 핸들러). 요청 버전 파일이 있으면 그걸, 없으면 최신 커밋 버전을 서빙.
 * 카페24 scripttag + 수동 스니펫 + 레거시 /sdk/ 공용.
 */
export function serveSdkFile(req: Request, res: Response) {
  const requested = String(req.params.version || '');
  if (!VERSION_RE.test(requested)) {
    return res.status(400).type('text/plain').send('invalid version');
  }
  const hasRequested = existsSync(resolve(SDK_DIR, requested, 'hanjul.min.js'));
  const version = hasRequested ? requested : latestAvailableVersion();
  if (!version) {
    return res.status(404).type('text/plain').send('not found');
  }
  try {
    let buf = sdkFileCache.get(version);
    if (!buf) {
      buf = readFileSync(resolve(SDK_DIR, version, 'hanjul.min.js'));
      sdkFileCache.set(version, buf);
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*'); // scripttag/몰 교차출처 로드 요구
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // helmet 기본(same-origin) 덮어 교차 로드 허용
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (!hasRequested) res.setHeader('X-Hjl-Sdk-Fallback', version); // 폴백 서빙 버전 노출(디버깅)
    return res.send(buf);
  } catch (e: any) {
    console.log('[SDK serve] 서빙 실패 version=', version, e?.message || e);
    return res.status(404).type('text/plain').send('not found');
  }
}
