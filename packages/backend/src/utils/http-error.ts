/**
 * http-error.ts — 고객에게 보일 오류 글 한 곳(★ 2026-10-24 뿌리 대장 R10 · docs/ROOT-LEDGER.md)
 *
 * 옛: 고객 쪽 라우터 221곳이 5xx 응답에 오류 원문(`err.message`)을 실었다. DB(「column … does not exist」) · 메일(SMTP 영어 응답) ·
 * 외부 API 원문이 그대로 화면에 나갔다(1023 여정 · 1024 자동마케팅은 각자 고쳤고 나머지 기능에는 퍼지지 않았다).
 * 판정 = 허용 꼴 하나 — **우리가 쓴 한국어 문장**만 그대로 보인다(한글이 있고, 제품 낱말을 빼면 로마자가 없다).
 * 그 밖(라이브러리 · DB · 외부 원문)은 그 자리의 안내 문장을 보이고 원문은 로그에만 남긴다.
 */

/** 화면 글에 써도 되는 로마자 낱말(제품 · 채널 이름) — 이것을 지운 뒤 로마자가 남으면 원문으로 본다 */
const PRODUCT_WORDS = /\b(?:DM|SMS|LMS|MMS|RCS|URL|ID|CSV|SMTP|AI|API|SNS|PDF|HTML|QR|PC|VIP|SDK|KB|MB|GB|OK|DB|CDP|KT|SKT|LGU|JPG|JPEG|PNG|GIF|WebP|jpg|jpeg|png|gif|webp|xlsx|xls|csv|txt)\b/g;
const DEFAULT_FALLBACK = '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';

/**
 * ★ 2026-10-25 사용자 조건 · 상태 오류 한 종류(뿌리 대장 R10 · 원장 docs/2026-10-25-oneline-all-structure-check.md Z7).
 * 옛: 유틸이 사용자 조건(입력 없음 · 상태가 안 맞음)을 일반 `Error` 로 던져 라우트마다 500 · 4xx 를 짐작했다.
 * 이 종류는 상태 · 코드 · 고객 문장을 함께 든다 · 라우트 catch 는 `userErrorResponse` 로 그 상태 그대로 돌려준다.
 */
export class UserFacingError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly extra: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'UserFacingError';
  }
}

/** UserFacingError → 응답(상태 · 본문) · 그 밖 = null(호출부가 지금처럼 잇는다) */
export function userErrorResponse(err: unknown): { status: number; body: Record<string, unknown> } | null {
  if (!(err instanceof UserFacingError)) return null;
  return { status: err.status, body: { success: false, error: err.message, code: err.code, ...(err.extra || {}) } };
}

/** 라우트 catch 첫 줄 — UserFacingError 면 그 상태로 답하고 true(호출부는 return) · 아니면 false */
export function respondUserError(res: { status: (n: number) => { json: (b: unknown) => unknown } }, err: unknown): boolean {
  const r = userErrorResponse(err);
  if (!r) return false;
  res.status(r.status).json(r.body);
  return true;
}

const UPLOAD_FALLBACK = '올린 파일을 읽지 못했어요. 다시 올려 주세요.';
const sizeText = (b: number): string => (b >= 1024 * 1024 ? `${Math.round((b / 1024 / 1024) * 10) / 10}MB` : `${Math.round(b / 1024)}KB`);

/**
 * ★ 2026-10-25 원장 Z5 · #106 · #118 — 업로드 오류 번역 한 곳(크기 · 개수 · 형식). multer 원문(영어 「File too large」 · 「Too many files」)은 고객 문장에 쓰지 않는다.
 *   limits = 그 업로드가 multer 에 준 상한 객체 그대로(숫자 두 벌 0). 형식 거절(fileFilter 의 우리 문장)은 publicErrorText 가 거른다.
 */
export function uploadErrorText(err: unknown, limits: { fileSize?: number; files?: number } = {}): string {
  const code = String((err as any)?.code || '');
  if (code === 'LIMIT_FILE_SIZE') return limits.fileSize ? `파일 하나는 ${sizeText(limits.fileSize)} 이하만 올릴 수 있어요.` : '파일이 너무 커요. 더 작은 파일로 올려 주세요.';
  if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') return limits.files ? `파일은 한 번에 ${limits.files}개까지 올릴 수 있어요.` : '올린 파일 수가 너무 많아요.';
  if (code.startsWith('LIMIT_')) return UPLOAD_FALLBACK;
  return publicErrorText(err, UPLOAD_FALLBACK, 'upload');
}

/** (순수) 오류 → 고객 글. 허용 꼴이 아니면 fallback(원문은 label 과 함께 로그) */
export function publicErrorText(err: unknown, fallback: string = DEFAULT_FALLBACK, label?: string): string {
  if (err instanceof UserFacingError) return err.message;   // ★ 2026-10-25 R10 — 종류가 곧 「고객 문장」(상태는 respondUserError 가 낸다)
  const raw = err == null ? '' : typeof err === 'string' ? err : String((err as any)?.message ?? '');
  const msg = raw.trim();
  const ours = !!msg && msg.length <= 300 && !/[\r\n]/.test(msg) && /[가-힣]/.test(msg) && !/[A-Za-z]/.test(msg.replace(PRODUCT_WORDS, ''));
  if (ours) return msg;
  if (msg) console.error(`[server-error]${label ? ` ${label}` : ''} 고객 글로 바꿔 보냄: ${msg.slice(0, 500)}`);
  return fallback;
}
