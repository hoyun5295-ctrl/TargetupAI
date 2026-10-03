/**
 * mms-image-util.ts — MMS 이미지 경로/원본 파일명 추출 컨트롤타워 (백엔드)
 *
 * ★ D124 N4: campaigns.mms_image_paths(JSONB) 구조가 두 가지 형태를 동시 수용:
 *   - 과거: string[]                                — 절대경로만
 *   - 신규: Array<{ path: string; originalName: string }>  — 경로 + 원본 파일명
 *
 * QTmsg 큐 INSERT/발송 시에는 항상 절대경로 문자열만 필요.
 * 표시용(발송결과 UI/엑셀)에서는 원본 파일명이 있으면 그것을 우선 사용.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type MmsImageItem = string | { path?: string; originalName?: string };

/**
 * mms_image_paths에서 서버 절대경로만 추출.
 * QTmsg Agent가 파일 시스템에서 읽을 경로.
 */
export function getMmsImagePath(item: MmsImageItem): string {
  if (!item) return '';
  if (typeof item === 'string') return item;
  return item.path || '';
}

/**
 * mms_image_paths에서 표시용 파일명 추출.
 * - 신규 구조(객체)면 originalName 반환
 * - 과거 구조(문자열)면 경로의 basename 반환 (fallback)
 */
export function getMmsImageDisplayName(item: MmsImageItem): string {
  if (!item) return '';
  if (typeof item === 'object' && item.originalName) return item.originalName;
  const p = getMmsImagePath(item);
  return p.replace(/\\/g, '/').split('/').pop() || '';
}

/**
 * ★2026-09-10 표시용 원본 파일명 배열을 경로 배열과 같은 길이로 맞춘다(대행발송 `mms_image_names` · 임은지 접수).
 * 모자라면 빈칸 · 넘치면 자름 · 문자열이 아니면 빈칸 · 장당 200자. 빈칸은 표시 CT가 저장 파일명으로 대신한다.
 * ⛔ 이 값은 표시 전용이다. 발송 배관(QTmsg file_name)은 경로 배열만 읽는다.
 */
export function alignMmsImageNames(names: unknown, count: number): string[] {
  const src = Array.isArray(names) ? names : [];
  return Array.from({ length: Math.max(0, count) }, (_, i) =>
    (typeof src[i] === 'string' ? toDisplayName(src[i] as string) : ''));
}

/**
 * ★2026-10-03 경로 배열 + 원본 파일명 배열(같은 순서)을 캠페인 항목으로 묶는다(임은지 접수 · 대행 MMS 가 발송 결과 창에서만 UUID).
 * 프론트 `utils/mmsImage.ts withMmsImageNames` 와 같은 규칙: 이름이 있는 칸만 `{ path, originalName }` · 빈칸·이름 없음은 원래 항목.
 * 이름 정리(길이 맞춤 · trim · 200자 · 서로게이트)는 `alignMmsImageNames` 한 벌을 쓴다.
 * 발송 배관은 `normalizeMmsImagePaths` 로 경로만 읽으므로 묶어도 무변경이다(직접발송·AI 발송이 이미 이 모양을 저장한다).
 */
export function withMmsImageNames(paths: MmsImageItem[], names: unknown): MmsImageItem[] {
  if (!Array.isArray(paths)) return [];
  if (!Array.isArray(names)) return paths;
  const aligned = alignMmsImageNames(names, paths.length);
  return paths.map((item, i) => (aligned[i] ? { path: getMmsImagePath(item), originalName: aligned[i] } : item));
}

/**
 * 코드 포인트 단위로 200자에서 자르고, 짝 없는 서로게이트는 버린다.
 * ⛔ UTF-16 단위로 자르면 이모지가 반쪽으로 남고, PG jsonb가 그 값을 거절해 **접수 INSERT가 통째로 실패**한다.
 */
function toDisplayName(raw: string): string {
  return Array.from(raw.trim())
    .filter((ch) => !/^[\uD800-\uDFFF]$/.test(ch))
    .slice(0, 200)
    .join('');
}

/**
 * 배열 전체를 절대경로 string[]로 정규화 (QTmsg용).
 * null/undefined 항목 제거.
 */
export function normalizeMmsImagePaths(items: MmsImageItem[] | null | undefined): string[] {
  if (!Array.isArray(items)) return [];
  return items.map(getMmsImagePath).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────
// 저장 (★2026-08-28 대행발송 이메일 MMS 접수 · 서수란 cmtclkuhe04iujnotbi3xbuu3)
//   업로드 라우트(routes/mms-images.ts)의 디스크 저장 계약을 미러한다:
//   MMS_IMAGE_BASE/회사ID/uuid.jpg + 절대경로 반환. 발송(QTmsg)은 이 절대경로를 그대로 읽는다.
//   ⛔ 여기서는 변환하지 않는다. 규격(JPG·300KB) 검사는 호출부가 저장 전에 끝낸다.
// ─────────────────────────────────────────────────────────────
/** 라우트·image-studio와 같은 정의 미러(둘 다 자기 사본을 갖고 있다 · 통합은 추가 과제) */
export const MMS_IMAGE_BASE = process.env.MMS_IMAGE_PATH || path.resolve('./uploads/mms');

/**
 * ★ 2026-09-27 한줄로 V2 GATE m026 — 이 경로가 그 회사 MMS 저장소(MMS_IMAGE_BASE/회사ID/) 안의 파일인가.
 * 업로드·메일 접수가 저장하는 자리와 같은 규칙이다. 상대경로·저장소 밖·다른 회사 폴더·폴더 자체·'..' 탈출은 거절한다.
 * 발송 에이전트는 이 절대경로를 그대로 읽으므로, 클라이언트가 준 경로를 이 판정 없이 큐에 실으면 서버의 아무 파일이나 읽히려 한다.
 */
export function isCompanyMmsPath(companyId: string, p: unknown): boolean {
  if (!companyId || typeof p !== 'string' || !p.trim() || !path.isAbsolute(p)) return false;
  const root = path.resolve(MMS_IMAGE_BASE, companyId) + path.sep;
  const resolved = path.resolve(p);
  return resolved.startsWith(root) && resolved.length > root.length;
}

/** JPG 실체 판정: 확장자·MIME이 아니라 파일 첫 두 바이트(SOI 마커)로 본다. */
export function isJpegBuffer(buf: Buffer | null | undefined): boolean {
  return !!buf && buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

/** 이미지 버퍼를 회사 MMS 저장소에 저장하고 발송 계약 형태(절대경로)를 돌려준다. */
export function saveMmsImageBuffer(companyId: string, buffer: Buffer): { serverPath: string; filename: string } {
  const dir = path.join(MMS_IMAGE_BASE, companyId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${crypto.randomUUID()}.jpg`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);
  return { serverPath: path.resolve(filePath), filename };
}
