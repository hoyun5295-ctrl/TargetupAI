/**
 * line-headline-make.ts — 한 줄 「첫 화면」 헤드라인 그림 만들기 핵심(누끼 → 생성 → 영구 저장) (★ 2026-10-21 · 설계서 docs/2026-10-21-oneline-content-design.md §3-4)
 *
 * 라우트(POST /api/image-studio/line-headline · 멱등 · 차감)와 시연 세트 명령(scripts/oneline-demo-set.ts · 무차감)이 같은 함수를 쓴다.
 * ⛔ 돈 · 잠금 · 멱등 · 글자 검사는 호출부 몫(이 함수는 그림만 만든다). 실패 = 던짐(호출부가 차감 전 실패로 처리).
 */
import fs from 'fs';
import path from 'path';
import { getTemplate, type StudioTemplate } from './image-studio-templates';
import {
  resolvePreset, buildPosterPrompt, generatePoster, studioImageEngine, removeBackground,
  writeTempBuffer, allocTempPath, moveTempToPermanent, findTempFile, clearTempMeta,
} from './image-studio';
import { fetchImageGuarded } from './sales-outreach-produce';
import { isCompanyImageUrl } from './ai-auto-build-materials';
import { buildImageDiskPath } from './campaign-quick';

export class LineHeadlineInputError extends Error {
  constructor(public code: 'HEADLINE_IMAGE_INVALID' | 'HEADLINE_IMAGE_UNREADABLE', message: string) { super(message); }
}

/** (순수) 상품 사진 주소 판정 — 우리 서버 사진 = 디스크 경로 · 바깥 = https 만 · 그 밖 = 오류 */
export function lineHeadlineImageSource(raw: string, companyId: string): { kind: 'disk'; path: string } | { kind: 'remote'; url: string } | null | 'invalid' {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (isCompanyImageUrl(s, companyId)) {
    const p = buildImageDiskPath(s, companyId);
    return p ? { kind: 'disk', path: p } : 'invalid';
  }
  return /^https:\/\//i.test(s) ? { kind: 'remote', url: s } : 'invalid';
}

/** 그림 하나 만들기 → 이 회사 영구 경로 주소(/api/cdp/inapp/image/회사/파일) */
export async function makeLineHeadlineImage(input: {
  companyId: string;
  template: StudioTemplate;
  texts: { title: string; label?: string };
  /** 제품 템플릿일 때만 쓴다 */
  productImage?: string | null;
}): Promise<{ url: string; filename: string }> {
  const { companyId, template } = input;
  const isProduct = (template.kind ?? 'product') === 'product';
  const src = isProduct ? lineHeadlineImageSource(input.productImage || '', companyId) : null;
  if (src === 'invalid') throw new LineHeadlineInputError('HEADLINE_IMAGE_INVALID', '상품 사진 주소를 다시 확인해 주세요.');
  let cutout: { base64: string; mime: string } | null = null;
  if (src) {
    let buf: Buffer | null = null;
    if (src.kind === 'disk') { try { buf = fs.readFileSync(src.path); } catch { buf = null; } }
    else { const got = await fetchImageGuarded(src.url); buf = got ? got.buffer : null; }
    if (!buf) throw new LineHeadlineInputError('HEADLINE_IMAGE_UNREADABLE', '상품 사진을 읽지 못했어요. 다른 사진으로 해 주세요.');
    const srcTemp = allocTempPath(companyId, 'png');
    const cut = allocTempPath(companyId, 'png');
    try {
      fs.writeFileSync(srcTemp.absPath, buf);
      await removeBackground(srcTemp.absPath, cut.absPath);
      cutout = { base64: fs.readFileSync(cut.absPath).toString('base64'), mime: 'image/png' };
    } finally {
      for (const p of [srcTemp.absPath, cut.absPath]) { try { fs.unlinkSync(p); } catch { /* noop */ } }
    }
  }
  const preset = resolvePreset('poster');
  const prompt = buildPosterPrompt({ template, preset, texts: input.texts, hasProduct: !!cutout, textPosition: isProduct ? null : 'top' });
  const img = await generatePoster(prompt, preset, cutout, { engine: studioImageEngine() });
  const ext = (img.mime.split('/')[1] || 'jpeg').replace('jpg', 'jpeg');
  const tempId = writeTempBuffer(companyId, Buffer.from(img.base64, 'base64'), {
    kind: 'poster', ext, mime: img.mime, prompt, presetKey: preset.key, channelSpec: preset.channelSpec, aspectRatio: preset.aspectRatio, width: null, height: null,
  });
  let moved: ReturnType<typeof moveTempToPermanent> = null;
  try { moved = moveTempToPermanent(companyId, tempId); } catch { moved = null; }
  if (!moved) {
    // 영구 이동 실패 = 임시 그림 · 사이드카를 회수(쌓이면 임시 용량 상한에 걸린다 · Codex R4)
    const left = findTempFile(companyId, tempId);
    if (left) { try { fs.unlinkSync(left.absPath); } catch { /* noop */ } }
    clearTempMeta(companyId, tempId);
    throw new Error('HEADLINE_SAVE_FAILED');
  }
  return { url: moved.url, filename: moved.filename };
}

export { getTemplate };

// ─────────────── 작업 원장(파일 · ★ Codex R4 · 같은 부류 4회째 → 기억을 프로세스 메모리에서 파일로) ───────────────
// 회사 · 담당자 · 한 줄마다 「만드는 중 / 완료 주소」 + 입력 지문마다 「완료 주소」를 작은 JSON 으로 남긴다.
//   재기동 · 공용 캐시 상한과 무관하게 낸 그림을 되찾고, 만드는 중이면 화면이 기다린다(새 유료 생성 0) · 담당자별이라 다른 담당자에게 안 보인다.
//   위치 = INAPP_IMAGE_BASE/.line-headline/<회사>/ (이미지 서빙 경로의 회사 폴더 밖 = 공개되지 않는다).
const LEDGER_BASE = path.join(process.env.INAPP_IMAGE_PATH || path.resolve('./uploads/inapp'), '.line-headline');
/** 만드는 중 기록이 이 시간 넘게 그대로면 끊긴 것으로 본다(생성 최대 120초 + 누끼 60초 + 여유) */
export const LINE_HEADLINE_RUNNING_MS = 5 * 60_000;
/** 완료 기록을 되찾기로 보여 주는 기간 */
export const LINE_HEADLINE_KEEP_MS = 24 * 3600_000;
const safeName = (s: string) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);

/** running = 만드는 중 · settling = 그림은 있고 차감 중(주소를 내보내지 않는다 · 차감 실패면 지워진다 · Codex R6) · done = 공개 */
export interface LineHeadlineRecord { state: 'running' | 'settling' | 'done'; url?: string; at: number; /** settling = 과금 지문(차감 확인 → 완료 복구 · Codex R7) */ fp?: string }
/** 헤드라인 한 장의 과금 멱등키(라우트 차감 · /last 복구가 같은 키) */
export const lineHeadlineCreditKey = (companyId: string, fp: string) => `line-headline:${companyId}:${fp}`;
function ledgerPath(companyId: string, name: string): string { return path.join(LEDGER_BASE, safeName(companyId), `${safeName(name)}.json`); }
function readRec(p: string): LineHeadlineRecord | null {
  try { const r = JSON.parse(fs.readFileSync(p, 'utf8')); return r && (r.state === 'running' || r.state === 'settling' || r.state === 'done') && Number.isFinite(r.at) ? r : null; } catch { return null; }
}
/** 쓰기 실패 = false(호출부가 생성 · 차감을 멈춘다 · 기록 없는 유료 결과 0 · Codex R5) */
function writeRec(p: string, r: LineHeadlineRecord): boolean {
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(r)); return true; } catch { return false; }
}
const lastName = (userId: string, lineFp: string) => `last-${userId}-${lineFp}`;
const fpName = (fp: string) => `fp-${fp}`;

/** 담당자 · 한 줄의 지금 상태(만드는 중 = 5분 안 · 차감 중 · 완료 = 24시간 안 · 그 밖 = null)
 *  settling 은 그대로 돌려준다 — 공개 여부는 호출부가 차감 원장으로 정한다(resolveLineHeadlineLast) */
export function readLineHeadlineLast(companyId: string, userId: string, lineFp: string, nowMs = Date.now()): LineHeadlineRecord | null {
  if (!userId || !lineFp) return null;
  const r = readRec(ledgerPath(companyId, lastName(userId, lineFp)));
  if (!r) return null;
  if (r.state === 'running') return nowMs - r.at < LINE_HEADLINE_RUNNING_MS ? r : null;
  return nowMs - r.at < LINE_HEADLINE_KEEP_MS && r.url ? r : null;
}
/** 같은 입력으로 이미 만든 그림(기간 없음 · 낸 그림 = 같은 입력이면 늘 같은 주소) */
export function readLineHeadlineByFp(companyId: string, fp: string): string | null {
  const r = readRec(ledgerPath(companyId, fpName(fp)));
  return r && r.state === 'done' && r.url ? r.url : null;
}
export function markLineHeadlineRunning(companyId: string, userId: string, lineFp: string, nowMs = Date.now()): boolean {
  return !(userId && lineFp) || writeRec(ledgerPath(companyId, lastName(userId, lineFp)), { state: 'running', at: nowMs });
}
/** 차감 전 = settling(차감된 그림은 늘 원장에 있다) · 차감 뒤 = done(그때부터 주소 공개) · 둘 다 써져야 true */
export function markLineHeadlineDone(companyId: string, userId: string, lineFp: string, fp: string, url: string, state: 'settling' | 'done' = 'done', nowMs = Date.now()): boolean {
  if (!writeRec(ledgerPath(companyId, fpName(fp)), { state, url, at: nowMs, fp })) return false;
  return !(userId && lineFp) || writeRec(ledgerPath(companyId, lastName(userId, lineFp)), { state, url, at: nowMs, fp });
}

/** /last 판정 — settling 은 차감 원장을 본다: 차감됨 = 완료로 되살려 공개(완료 기록 실패 · 응답 유실 뒤에도 유료 그림을 되찾는다 · Codex R7)
 *  · 아직 = 5분 안이면 만드는 중 · 그 뒤 = 없음(차감 안 된 그림 = 내보내지 않는다) · 차감 확인 실패 = 만드는 중(화면이 다시 묻는다) */
export async function resolveLineHeadlineLast(companyId: string, userId: string, lineFp: string, isCharged: (key: string) => Promise<boolean>, nowMs = Date.now(), tries = 3): Promise<{ running: boolean; url: string | null }> {
  const r = readLineHeadlineLast(companyId, userId, lineFp, nowMs);
  if (!r) return { running: false, url: null };
  if (r.state === 'running') return { running: true, url: null };
  if (r.state === 'done') return { running: false, url: r.url || null };
  if (!r.fp || !r.url) return { running: false, url: null };
  let charged = false;
  try { charged = await isCharged(lineHeadlineCreditKey(companyId, r.fp)); } catch { return { running: true, url: null }; }
  if (!charged) return { running: nowMs - r.at < LINE_HEADLINE_RUNNING_MS, url: null };
  // 그 그림의 입력 지문 기록은 늘 완료로(지문마다 따로 = 다른 그림을 덮지 않는다)
  writeRec(ledgerPath(companyId, fpName(r.fp)), { state: 'done', url: r.url, at: r.at, fp: r.fp });
  // 담당자 · 한 줄 기록은 기다리는 사이 안 바뀌었을 때만(다른 입력의 최신 결과를 덮지 않게 · 바뀌었으면 지금 기록으로 다시 판정 · Codex R8)
  const p = ledgerPath(companyId, lastName(userId, lineFp));
  const now = readRec(p);
  if (now && now.state === r.state && now.fp === r.fp && now.url === r.url && now.at === r.at) {
    writeRec(p, { state: 'done', url: r.url, at: r.at, fp: r.fp });
    return { running: false, url: r.url };
  }
  return tries > 1 ? resolveLineHeadlineLast(companyId, userId, lineFp, isCharged, nowMs, tries - 1) : { running: true, url: null };
}
/** 완료 기록 되돌리기(차감 실패 · 기록 실패로 그림을 지울 때 · 그 그림을 가리키는 기록만) */
export function unmarkLineHeadlineDone(companyId: string, userId: string, lineFp: string, fp: string, url: string): void {
  const names = [fpName(fp), ...(userId && lineFp ? [lastName(userId, lineFp)] : [])];
  for (const n of names) {
    const p = ledgerPath(companyId, n);
    const r = readRec(p);
    if (r && r.url === url) { try { fs.unlinkSync(p); } catch { /* noop */ } }
  }
}
/** 실패 = 만드는 중 기록을 지운다(지난 완료 기록은 그대로 두려고 완료가 아니면만) */
export function clearLineHeadlineRunning(companyId: string, userId: string, lineFp: string): void {
  if (!userId || !lineFp) return;
  const p = ledgerPath(companyId, lastName(userId, lineFp));
  const r = readRec(p);
  if (r && r.state === 'running') { try { fs.unlinkSync(p); } catch { /* noop */ } }
}
