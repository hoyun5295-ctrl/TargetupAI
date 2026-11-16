/**
 * proposal-trial.ts — 제작 대행 체험(제안 페이지 /proposal)의 CT (★ 2026-11-16 C136 · 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §4 ~ §7)
 *
 * Harold 「팀장급에게 먹히는 체험 · 사진 3 ~ 4장을 받아 완성본(포스터 · 문안)을 만들어 돌려준다 · 담당자는 명단만 올려 평소 직접발송으로 · 대신 보내 주지 않는다 ·
 *   모바일DM 까지 제작대행 체험」.
 *   흐름 = 신청(회사당 한 번) → 기계 제작(포스터 3 · 문안 3 · 모바일 DM 1 · 통신사 스팸 검사) → 직원 확인 · 전달 → 담당자 알림 → 완성본 → 직접발송 작성 화면 채우기.
 *
 * ⛔ 지키는 것
 *   - 발송 · 과금 코드를 건드리지 않는다. 이 파일은 발송하지 않는다(완성본의 문안 · 그림은 담당자가 「명단만 올려 보내기」를 눌렀을 때 화면이 받아 간다).
 *   - AI 크레딧 원장 무접촉 = 제작 전체가 크레딧 묶음(runInCreditBundle) 안에서 돈다 · 모바일 DM 조립 CT 에는 차감하지 않는 deps 를 준다.
 *   - 스팸 검사 = 기존 무료 자동 검사 CT(선불 잔액 · 청구 무접촉).
 *   - 제작의 부품은 전부 있는 CT 를 부른다(이 파일에 생성 로직을 다시 쓰지 않는다).
 *
 * 밖에 흔적이 남는 일(그림 파일 · 자산 행 · DM 행)의 규약(Codex 설계 1R ~ 3R)
 *   ① 단계마다 kit 에 적는다(소유권 = produce_token 하나 · 시각을 소유권 조건으로 쓰지 않는다) ② 적힌 단계는 다시 만들지 않는다
 *   ③ 단계 기록이 0행이면(소유권을 잃음) 방금 만든 것을 지우고 멈춘다 ④ kit 에서 참조가 빠지는 문장은 같은 UPDATE 에서 그 참조를 garbage 에 더한다
 *   ⑤ 회수 = 지우고 → 지운 것만 목록에서 뺀다(포스터는 파일이 지워졌거나 원래 없을 때만).
 *   ⑥ 적지 못한 산출물은 그 자리에서 지우지 않는다(Codex 구현 1R · 2R) — 결과를 모르는 쓰기(오류 · 끊김)는 늦게 끝나 적힐 수 있다.
 *      제작 = 소유권을 먼저 내려 앞 쓰기를 막고(같은 행의 쓰기라 앞 쓰기가 끝난 뒤에 선다 · 내려놓은 뒤에는 앞 쓰기가 적히지 못한다) 한 문장으로
 *      「행이 이미 가리키면 그대로 · 아니면 회수 목록에」 남긴다. 신청 = 같은 자리를 다시 잡아 보아 가른다. 가르지 못하면 지우지 않고 사람에게 알린다.
 * 표 = proposal_trials(배포 원장 C136-DDL-1). 표가 없으면 문장이 42P01 을 던진다 → 라우트가 503 DB_MIGRATION_PENDING.
 */
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { query, pool } from '../config/database';
import { runInCreditBundle } from './ai-credit-context';
import { saveMaterialImages, buildImageDiskPath, generateFromBuildMaterials, defaultBuildDeps } from './campaign-quick';
import { isCompanyImageUrl } from './ai-auto-build-materials';
import { sniffImageMediaType } from './event-image-extract';
import { pickLineHeadlines } from './line-headline';
import { makeLineHeadlineImage, getTemplate } from './line-headline-make';
import { registerAsset, getAssetByUrl, deleteAsset } from './assets';
import { generateMessages } from '../services/ai';
import { getOpt080Number, stripAdParts } from './messageUtils';
import { autoSpamTestWithRegenerate, spamVerdictOf, isSpamHold, type SpamVerdict } from './spam-test-queue';
import { getRegisteredCallbackSet } from './callback-filter';
import { deleteDm } from './dm/dm-builder';
import { dmShortUrlOf, dmPublishBlockOf, publishDmWithPrizes } from './dm/dm-publish-core';
import { getBrandBasicInfo } from './brand-basic-info';
import { insertNoticeSms } from './sms-notice';
import { getPlatformNoticeCallback } from './sms-queue';
import { sendSystemAlert } from './system-alert';
import { PROPOSAL_PAGE_CSS, PROPOSAL_INTRO_HTML } from '../content/gated/proposal-page';

// ─────────────── 꼴 ───────────────

export type ProposalStatus = 'requested' | 'producing' | 'produced' | 'delivered';
export type ProposalChannel = 'LMS' | 'MMS';
/**
 * none = 아직 검사 안 함 · pass = 통과 · blocked = 통신사가 막음 · checking = 통신사 확인 중(통과도 차단도 아니다 · 잠시 뒤 「검사 다시」) ·
 *   rejected = 보낼 수 없는 글자가 있어 검사에 못 올림(문안을 고친다) · unknown = 검사하지 못함(발신번호 없음 · 장애)
 */
export type SpamState = 'none' | 'pass' | 'blocked' | 'checking' | 'rejected' | 'unknown';
export interface KitPoster { url: string; assetId: string | null; templateId: string }
export interface KitCopy { subject: string; text: string; spam: SpamState }
export interface ProposalKit {
  /** 포스터 안 헤드라인 */
  title?: string;
  /** 템플릿 후보(헤드라인 고르기 CT 가 준 순서) */
  picks?: string[];
  /** 자리 셋 · 비었으면 null */
  posters?: Array<KitPoster | null>;
  /** 자리별 다시 만든 횟수(템플릿 후보를 돌린다) */
  redo?: number[];
  copies?: KitCopy[];
  /** 칸 없음 = 아직 안 해 봄 · null = 만들지 못했다(조립 실패 · 발행 잠금에 걸림) · 있으면 발행까지 끝난 것(주소 없는 DM 은 두지 않는다) */
  dm?: { id: string; url: string } | null;
  callback?: string | null;
  spamDone?: boolean;
}
export type GarbageItem = { kind: 'poster'; assetId: string | null; url: string } | { kind: 'dm'; id: string };
export interface ProposalRow {
  company_id: string; requested_by: string; requested_at: string; src: string | null; channel: ProposalChannel; brief: string; extra: string | null;
  notify_phone: string | null; photo_urls: string[]; status: ProposalStatus; produce_token: string | null; produce_beat_at: string | null; produce_error: string | null;
  kit: ProposalKit; revision: number; garbage: GarbageItem[]; produced_at: string | null; delivered_at: string | null; delivered_by: string | null;
  notify_tries: number; notify_tried_at: string | null; notified_at: string | null; opened_at: string | null; used_at: string | null;
}

export const PROPOSAL_POSTERS = 3;
export const PROPOSAL_COPIES = 3;
export const PROPOSAL_PHOTO_MIN = 3;
export const PROPOSAL_PHOTO_MAX = 4;
export const PROPOSAL_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PROPOSAL_BRIEF_MAX = 120;
export const PROPOSAL_EXTRA_MAX = 200;
/** 끊긴 제작을 가져갈 수 있는 때(마지막 단계 기록 뒤 · 가장 긴 단계 = 스팸 검사보다 넉넉히) */
export const PROPOSAL_TAKEOVER_MINUTES = 30;
/** 알림 다시 보내기가 통하지 않는 동안(앞 시도가 아직 적재 중일 수 있다) · 적재 대기 상한 60초보다 길게 */
export const PROPOSAL_NOTIFY_HOLD_MINUTES = 2;
export const PROPOSAL_NOTICE_WAIT_MS = 60_000;

export class ProposalError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
/** 제작 단계 실패 — 사유 글자는 직원 화면(「제작이 멈췄습니다」)과 운영 경보에만 간다(담당자 화면에는 가지 않는다) */
const stepFailed = (message: string): ProposalError => new ProposalError(500, 'PRODUCE_STEP_FAILED', message);
/** 단계 기록이 0행 = 다른 실행이 가져갔다 */
export class LostOwnership extends Error { constructor() { super('LOST_OWNERSHIP'); } }

// ─────────────── 순수 함수 ───────────────

/** 링크의 src — 영문 · 숫자 · - _ . 40자(그 밖은 버린다) */
export function cleanProposalSrc(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[A-Za-z0-9._-]{1,40}$/.test(s) ? s : null;
}

const collapse = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

export interface ProposalRequestValue { channel: ProposalChannel; brief: string; extra: string | null; notifyPhone: string; src: string | null }
/** 신청 본문 검사(사진은 따로 본다) */
export function parseProposalRequest(body: any): { ok: true; value: ProposalRequestValue } | { ok: false; error: string } {
  const channel = String(body?.channel || '').toUpperCase();
  if (channel !== 'LMS' && channel !== 'MMS') return { ok: false, error: '보낼 방식을 골라 주세요.' };
  const brief = collapse(body?.brief);
  if (!brief) return { ok: false, error: '무엇을 알릴지 한 줄로 적어 주세요.' };
  if (brief.length > PROPOSAL_BRIEF_MAX) return { ok: false, error: `한 줄은 ${PROPOSAL_BRIEF_MAX}자까지 적을 수 있어요.` };
  const extra = collapse(body?.extra);
  if (extra.length > PROPOSAL_EXTRA_MAX) return { ok: false, error: `더 필요한 것은 ${PROPOSAL_EXTRA_MAX}자까지 적을 수 있어요.` };
  const phone = String(body?.notifyPhone || '').replace(/\D/g, '');
  if (!/^01[016789]\d{7,8}$/.test(phone)) return { ok: false, error: '완성본 알림을 받을 휴대폰 번호를 확인해 주세요.' };
  return { ok: true, value: { channel, brief, extra: extra || null, notifyPhone: phone, src: cleanProposalSrc(body?.src) } };
}

/** 사진 검사 — 3 ~ 4장 · 전부 그림(실체 바이트 판정) · 장당 10MB */
export function checkProposalPhotos(files: ReadonlyArray<{ buffer: Buffer }> | null | undefined): string | null {
  const list = files || [];
  if (list.length < PROPOSAL_PHOTO_MIN || list.length > PROPOSAL_PHOTO_MAX) return `사진은 ${PROPOSAL_PHOTO_MIN} ~ ${PROPOSAL_PHOTO_MAX}장을 올려 주세요.`;
  for (const f of list) {
    if (!f?.buffer?.length || f.buffer.length > PROPOSAL_PHOTO_MAX_BYTES) return '사진 한 장은 10MB 까지 올릴 수 있어요.';
    if (!sniffImageMediaType(f.buffer)) return 'JPG, PNG, WEBP 사진만 올릴 수 있어요.';
  }
  return null;
}

/** kit 이 가리키는 밖의 산출물 전부(회수 목록의 재료) */
export function kitRefs(kit: ProposalKit | null | undefined): GarbageItem[] {
  const out: GarbageItem[] = [];
  if (kit?.dm?.id) out.push({ kind: 'dm', id: kit.dm.id });
  for (const p of kit?.posters || []) if (p?.url) out.push({ kind: 'poster', assetId: p.assetId || null, url: p.url });
  return out;
}

export type ProposalRedo = { kind: 'resume' } | { kind: 'all' } | { kind: 'poster'; index: number } | { kind: 'dm' } | { kind: 'spam' };

/** (순수) 다시 만들기 = kit 에서 뺄 것을 빼고, 빠진 참조를 회수 목록으로 돌려준다 */
export function applyProposalRedo(kit: ProposalKit, redo: ProposalRedo): { kit: ProposalKit; garbage: GarbageItem[] } {
  if (redo.kind === 'resume') return { kit, garbage: [] };
  if (redo.kind === 'all') return { kit: {}, garbage: kitRefs(kit) };
  if (redo.kind === 'spam') {
    return { kit: { ...kit, spamDone: false, copies: (kit.copies || []).map((c) => ({ ...c, spam: 'none' as SpamState })) }, garbage: [] };
  }
  const dropDm = (k: ProposalKit): { kit: ProposalKit; garbage: GarbageItem[] } => {
    const { dm, ...rest } = k;
    return { kit: rest, garbage: dm?.id ? [{ kind: 'dm', id: dm.id }] : [] };
  };
  if (redo.kind === 'dm') return dropDm(kit);
  const i = redo.index;
  if (!Number.isInteger(i) || i < 0 || i >= PROPOSAL_POSTERS) return { kit, garbage: [] };
  const posters = Array.from({ length: PROPOSAL_POSTERS }, (_, x) => kit.posters?.[x] || null);
  const old = posters[i];
  posters[i] = null;
  const redoCount = Array.from({ length: PROPOSAL_POSTERS }, (_, x) => (kit.redo?.[x] || 0) + (x === i ? 1 : 0));
  let next: ProposalKit = { ...kit, posters, redo: redoCount };
  const garbage: GarbageItem[] = old?.url ? [{ kind: 'poster', assetId: old.assetId || null, url: old.url }] : [];
  // 모바일 DM 은 첫 포스터를 싣는다 → 첫 포스터를 다시 만들면 DM 도 다시 만든다
  if (i === 0) { const d = dropDm(next); next = d.kit; garbage.push(...d.garbage); }
  return { kit: next, garbage };
}

/** (순수) 완성본으로 내보낼 수 있는가 — 포스터 3(자산 등재까지) · 문안 3 */
export function kitComplete(kit: ProposalKit | null | undefined): boolean {
  const posters = kit?.posters || [];
  return posters.length === PROPOSAL_POSTERS && posters.every((p) => !!p?.url && !!p.assetId)
    && (kit?.copies || []).length === PROPOSAL_COPIES && (kit!.copies!).every((c) => !!c.text);
}

/** (순수) 검사 판정 → 완성본에 적는 상태. 기다림 갈래(확인 중 · 검사 중)는 통과도 차단도 아니다 = 자동으로 아무것도 하지 않고 직원이 잠시 뒤 「검사 다시」 */
export function spamStateOf(verdict: SpamVerdict): SpamState {
  if (isSpamHold(verdict)) return 'checking';
  const rest: Record<Exclude<SpamVerdict, 'pending' | 'unconfirmed'>, SpamState> = { pass: 'pass', blocked: 'blocked', rejected: 'rejected', error: 'unknown' };
  return rest[verdict];
}

/** (순수) 번호 가리기 — 화면에는 가운데를 가린다 */
export function maskPhone(p: string | null | undefined): string {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 10 ? `${d.slice(0, 3)}-****-${d.slice(-4)}` : '';
}

export const PROPOSAL_READY_TEXT = '[한줄로] 신청하신 완성본이 준비됐습니다. 로그인 후 확인해 주세요.\nhttps://hanjul.ai/proposal';

// ─────────────── SQL ───────────────

export const PROPOSAL_READ_SQL = `SELECT * FROM proposal_trials WHERE company_id = $1::uuid`;
export const PROPOSAL_EXISTS_SQL = `SELECT 1 FROM proposal_trials WHERE company_id = $1::uuid`;
/** 자리 잡기($1 회사 · $2 사용자 · $3 src · $4 방식 · $5 한 줄 · $6 더 필요한 것 · $7 번호) — 이미 있으면 0행 */
export const PROPOSAL_INSERT_SQL = `
  INSERT INTO proposal_trials (company_id, requested_by, src, channel, brief, extra, notify_phone, photo_urls)
  VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, '{}'::text[])
  ON CONFLICT (company_id) DO NOTHING
  RETURNING company_id`;
export const PROPOSAL_PHOTOS_SQL = `UPDATE proposal_trials SET photo_urls = $2::text[], updated_at = now() WHERE company_id = $1::uuid`;
/**
 * 제작 선점($1 회사 · $2 새 토큰 · $3 읽은 개정 번호 · $4 새 kit · $5 회수 목록에 더할 것).
 *   통하는 때 = 신청됨 · 확인 대기 · 30분 넘게 기록이 없는 제작 중. 읽은 뒤에 누가 바꿨으면(개정 번호가 다르면) 0행.
 */
export const PROPOSAL_CLAIM_SQL = `
  UPDATE proposal_trials
     SET status = 'producing', produce_token = $2::uuid, produce_beat_at = now(), produce_error = NULL,
         kit = $4::jsonb, garbage = garbage || $5::jsonb, revision = revision + 1, updated_at = now()
   WHERE company_id = $1::uuid AND revision = $3::int
     AND (status IN ('requested', 'produced')
          OR (status = 'producing' AND (produce_beat_at IS NULL OR produce_beat_at < now() - interval '${PROPOSAL_TAKEOVER_MINUTES} minutes')))
  RETURNING revision`;
/** 단계 기록($1 회사 · $2 내 토큰 · $3 kit · $4 회수 목록에 더할 것) — 0행 = 소유권을 잃었다 */
export const PROPOSAL_STEP_SQL = `
  UPDATE proposal_trials
     SET kit = $3::jsonb, garbage = garbage || $4::jsonb, revision = revision + 1, produce_beat_at = now(), updated_at = now()
   WHERE company_id = $1::uuid AND produce_token = $2::uuid AND status = 'producing'
  RETURNING revision`;
export const PROPOSAL_FINISH_SQL = `
  UPDATE proposal_trials
     SET status = 'produced', produced_at = now(), produce_token = NULL, revision = revision + 1, updated_at = now()
   WHERE company_id = $1::uuid AND produce_token = $2::uuid AND status = 'producing'
  RETURNING revision`;
/** 제작 실패 — 만든 단계는 kit 에 남는다(다시 누르면 이어 한다) */
export const PROPOSAL_FAIL_SQL = `
  UPDATE proposal_trials
     SET status = 'requested', produce_token = NULL, produce_error = $3, revision = revision + 1, updated_at = now()
   WHERE company_id = $1::uuid AND produce_token = $2::uuid AND status = 'producing'`;
/**
 * 적지 못한 산출물을 회수 목록에 남긴다($1 회사 · $2 항목 · $3 kit 이 그것을 가리키는지 볼 조각 · $4 회수 목록이 가리키는지 볼 조각).
 *   행이 이미 가리키면(kit 에 적혔다 · 회수 목록에 있다) 그대로 둔다. 한 문장이라 그 사이에 끼어드는 쓰기가 없다.
 */
export const PROPOSAL_PARK_SQL = `
  UPDATE proposal_trials
     SET garbage = CASE WHEN COALESCE(kit @> $3::jsonb, false) OR garbage @> $4::jsonb THEN garbage ELSE garbage || jsonb_build_array($2::jsonb) END,
         updated_at = now()
   WHERE company_id = $1::uuid
  RETURNING company_id`;
/** 회수 목록에서 한 항목 빼기($1 회사 · $2 항목) */
export const PROPOSAL_GARBAGE_POP_SQL = `
  UPDATE proposal_trials
     SET garbage = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(garbage) e WHERE e <> $2::jsonb), '[]'::jsonb), updated_at = now()
   WHERE company_id = $1::uuid`;
/** 직원의 문안 고치기 · 발신번호 바꾸기($1 회사 · $2 읽은 개정 번호 · $3 새 kit) — 확인 대기일 때만 */
export const PROPOSAL_EDIT_SQL = `
  UPDATE proposal_trials
     SET kit = $3::jsonb, revision = revision + 1, updated_at = now()
   WHERE company_id = $1::uuid AND status = 'produced' AND revision = $2::int
  RETURNING revision`;
/** 전달($1 회사 · $2 직원 화면이 본 개정 번호 · $3 누른 직원) — 확인 대기이고 그 판일 때만(둘이 눌러도 한 요청만 행을 받는다) */
export const PROPOSAL_DELIVER_SQL = `
  UPDATE proposal_trials
     SET status = 'delivered', delivered_at = now(), delivered_by = $3::uuid, revision = revision + 1, updated_at = now()
   WHERE company_id = $1::uuid AND status = 'produced' AND revision = $2::int
  RETURNING notify_phone`;
/** 알림 시도($1 회사 · $2 화면이 본 시도 수) — 한 요청만 통과 · 앞 시도 뒤 2분 동안은 통하지 않는다 */
export const PROPOSAL_NOTIFY_TRY_SQL = `
  UPDATE proposal_trials
     SET notify_tries = notify_tries + 1, notify_tried_at = now(), updated_at = now()
   WHERE company_id = $1::uuid AND status = 'delivered' AND notified_at IS NULL AND notify_tries = $2::int
     AND (notify_tried_at IS NULL OR notify_tried_at < now() - interval '${PROPOSAL_NOTIFY_HOLD_MINUTES} minutes')
  RETURNING notify_phone`;
export const PROPOSAL_NOTIFIED_SQL = `UPDATE proposal_trials SET notified_at = now(), updated_at = now() WHERE company_id = $1::uuid AND status = 'delivered' AND notified_at IS NULL`;
export const PROPOSAL_OPENED_SQL = `UPDATE proposal_trials SET opened_at = now(), updated_at = now() WHERE company_id = $1::uuid AND status = 'delivered' AND opened_at IS NULL`;
export const PROPOSAL_USED_SQL = `UPDATE proposal_trials SET used_at = now(), updated_at = now() WHERE company_id = $1::uuid AND status = 'delivered' AND used_at IS NULL`;

export async function readProposalTrial(companyId: string): Promise<ProposalRow | null> {
  const r = await query(PROPOSAL_READ_SQL, [companyId]);
  return (r.rows[0] as ProposalRow) || null;
}
export async function proposalTrialExists(companyId: string): Promise<boolean> {
  return (await query(PROPOSAL_EXISTS_SQL, [companyId])).rows.length > 0;
}

// ─────────────── 신청 ───────────────

export interface ProposalRequestInput extends ProposalRequestValue { companyId: string; userId: string; files: ReadonlyArray<{ buffer: Buffer; originalname?: string }> }
export interface ProposalRequestDeps {
  save(companyId: string, files: ReadonlyArray<{ buffer: Buffer; originalname?: string }>, max: number): Array<{ url: string }>;
  removeFile(companyId: string, url: string): boolean;
}
/** 그 회사의 그림 주소 → 파일 지우기. 지워졌거나 원래 없으면 true · 우리 주소 꼴이 아니면 지울 파일이 없는 것 = true · 그 밖의 오류 = false */
export function removeCompanyImageFile(companyId: string, url: string): boolean {
  if (!isCompanyImageUrl(url, companyId)) return true;
  const p = buildImageDiskPath(url, companyId);
  if (!p) return true;
  try {
    fs.unlinkSync(p);
    return true;
  } catch (err: any) {
    return err?.code === 'ENOENT';
  }
}
const requestDeps = (): ProposalRequestDeps => ({ save: (c, f, max) => saveMaterialImages(c, f, max), removeFile: removeCompanyImageFile });

/**
 * 결과를 모르는 신청(COMMIT 의 답을 못 받음 · 연결이 끊김)을 가른다 — **같은 자리(회사)를 다시 잡아 본다**(Codex 구현 2R).
 *   같은 열쇠의 INSERT 는 앞 트랜잭션이 끝날(적히거나 버려질) 때까지 그 자리에서 기다린다 = 늦게 끝나는 쓰기를 앞지르지 않는다.
 *   기다린 뒤 잡은 자리는 언제나 돌려놓고, 행을 읽어 가른다: 행이 이 요청의 사진을 가리키면 created · 아니면(행이 없다 = 앞 트랜잭션은 버려졌다 · 다른 신청의 행이다) gone.
 *   잡아 보지 못했다(기다림 초과 · 연결 실패) = unknown(아무것도 지우지 않는다).
 */
async function settleUncertainRequest(input: ProposalRequestInput, saved: ReadonlyArray<{ url: string }>): Promise<'created' | 'gone' | 'unknown'> {
  let client;
  try {
    client = await pool.connect();
  } catch {
    return 'unknown';
  }
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '10s'`);
    await client.query(PROPOSAL_INSERT_SQL, [input.companyId, input.userId, input.src, input.channel, input.brief, input.extra, input.notifyPhone]);
    await client.query('ROLLBACK');
    const kept: string[] = (await client.query(PROPOSAL_READ_SQL, [input.companyId])).rows[0]?.photo_urls || [];
    return saved.every((x) => kept.includes(x.url)) ? 'created' : 'gone';
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    return 'unknown';
  } finally {
    client.release();
  }
}

/**
 * 신청 — 자리를 먼저 잡고 사진은 그 뒤에 쓴다(한 트랜잭션 · 진 요청은 사진을 쓰지 않는다).
 *   created = 새로 신청됨 · exists = 이미 신청한 회사(쓰기 0).
 *   실패했을 때 이 요청이 쓴 사진은 **적히지 않았다고 확정된 때만** 지운다(COMMIT 을 보내기 전이고 ROLLBACK 이 통했다 · 또는 자리를 다시 잡아 보아 갈랐다).
 *   지웠는데 신청이 살아 있으면 고칠 길이 없다(회사당 한 번이라 다시 신청도 못 한다).
 */
export async function requestProposalTrial(input: ProposalRequestInput, deps: ProposalRequestDeps = requestDeps()): Promise<'created' | 'exists'> {
  const client = await pool.connect();
  let saved: Array<{ url: string }> = [];
  let sentCommit = false;
  let failure: any = null;
  let definite = false;
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '3s'`);
    const ins = await client.query(PROPOSAL_INSERT_SQL, [input.companyId, input.userId, input.src, input.channel, input.brief, input.extra, input.notifyPhone]);
    if (ins.rows.length === 0) {
      await client.query('ROLLBACK');
      return 'exists';
    }
    saved = deps.save(input.companyId, input.files, PROPOSAL_PHOTO_MAX);
    if (saved.length !== input.files.length) throw new ProposalError(400, 'PHOTO_INVALID', 'JPG, PNG, WEBP 사진만 올릴 수 있어요.');
    await client.query(PROPOSAL_PHOTOS_SQL, [input.companyId, saved.map((x) => x.url)]);
    sentCommit = true;
    await client.query('COMMIT');
    return 'created';
  } catch (err: any) {
    failure = err;
    // 적히지 않았다고 확정 = COMMIT 을 보내기 전이고 ROLLBACK 이 통했다. 그 밖은 결과를 모른다(COMMIT 은 됐는데 답을 못 받았을 수 있다).
    definite = (await client.query('ROLLBACK').then(() => true, () => false)) && !sentCommit;
  } finally {
    // 결과를 모르는 연결은 풀에 돌려주지 않고 닫는다(열린 트랜잭션이 자리를 쥔 채 남지 않게)
    client.release(failure && !definite ? failure : undefined);
  }
  if (saved.length > 0) {
    const settled = definite ? 'gone' : await settleUncertainRequest(input, saved);
    if (settled === 'created') return 'created';
    if (settled === 'gone') for (const x of saved) deps.removeFile(input.companyId, x.url);
    else console.error(`[proposal-trial] 신청 결과를 확인하지 못해 사진을 남겨 둡니다 company=${input.companyId} files=${saved.map((x) => x.url).join(',')}`);
  }
  // 같은 회사의 다른 신청이 자리를 잡는 중(3초 넘게) = 잠시 뒤 다시
  if (failure?.code === '55P03') throw new ProposalError(409, 'PROPOSAL_BUSY', '신청을 처리하고 있어요. 잠시 뒤 화면을 새로 고쳐 주세요.');
  throw failure;
}

// ─────────────── 제작 ───────────────

export interface ProduceDeps {
  companyInfo(companyId: string): Promise<{ name: string; industry: string | null }>;
  pickHeadlines(input: { companyId: string; userId: string; companyName: string; industry: string | null; line: string }): Promise<{ picks: string[]; title: string }>;
  makePoster(input: { companyId: string; templateId: string; title: string; photoUrl: string }): Promise<{ url: string }>;
  /** 그 주소의 자산 번호 — 이미 있으면 그 번호 · 없으면 등재 */
  ensurePosterAsset(input: { companyId: string; userId: string; url: string }): Promise<string | null>;
  makeCopies(input: { companyId: string; userId: string; brief: string; channel: ProposalChannel; companyName: string }): Promise<Array<{ subject: string; text: string }>>;
  buildDm(input: { companyId: string; userId: string; title: string; brief: string; images: string[] }): Promise<string | null>;
  /** 만든 DM 을 바로 발행해 주소를 얻는다(직원이 미리 본다 · 주소는 전달 전까지 담당자에게 가지 않는다) · 못 하면 null(그 DM 은 쓰지 않는다) */
  publishDmUrl(id: string, companyId: string): Promise<string | null>;
  callbackOf(companyId: string, userId: string): Promise<string | null>;
  spamCheck(input: { companyId: string; userId: string; callback: string; channel: ProposalChannel; copies: ReadonlyArray<{ subject: string; text: string }> }): Promise<SpamState[]>;
  deleteDm(id: string, companyId: string): Promise<boolean>;
  deleteAsset(companyId: string, assetId: string): Promise<{ deleted: boolean; inUse: boolean }>;
  /** 그 주소로 등재된 자산 번호(없으면 null) — 자산 번호가 안 적힌 포스터를 지울 때 찾는다 */
  assetIdOf(companyId: string, url: string): Promise<string | null>;
  removeFile(companyId: string, url: string): boolean;
  /** orphan = 적지도 회수 목록에 남기지도 못해 어디에도 안 적힌 채 남은 산출물(사람이 본다) */
  alert(input: { companyId: string; kind: 'requested' | 'produced' | 'failed' | 'orphan'; note?: string }): Promise<void>;
}

/** 운영 부품 — 전부 있는 CT 를 부른다 */
export function defaultProduceDeps(): ProduceDeps {
  return {
    companyInfo: async (companyId) => {
      const b: any = await getBrandBasicInfo(companyId).catch(() => null);
      return { name: String(b?.brand_name || '').trim() || String(b?.company_name || '').trim() || '우리 브랜드', industry: String(b?.industry_code || '').trim() || null };
    },
    pickHeadlines: async (i) => {
      const r = await pickLineHeadlines({ companyId: i.companyId, userId: i.userId, companyName: i.companyName, industry: i.industry, line: i.line, productNames: [], hasPhoto: true });
      return { picks: r.picks.map((p) => p.id), title: r.title };
    },
    makePoster: async (i) => {
      const template = getTemplate(i.templateId);
      if (!template) throw stepFailed(`포스터 템플릿을 찾지 못했습니다(${i.templateId})`);
      const made = await makeLineHeadlineImage({ companyId: i.companyId, template, texts: { title: i.title }, productImage: i.photoUrl });
      return { url: made.url };
    },
    ensurePosterAsset: async (i) => {
      const found = await getAssetByUrl(i.companyId, i.url);
      if (found?.id) return String(found.id);
      const disk = buildImageDiskPath(i.url, i.companyId);
      let bytes = 0;
      try { bytes = disk ? fs.statSync(disk).size : 0; } catch { bytes = 0; }
      const filename = path.basename(i.url);
      return registerAsset({
        companyId: i.companyId, createdBy: i.userId, kind: 'generated', url: i.url, filename, bytes,
        format: filename.endsWith('.png') ? 'png' : 'jpg', origin: 'studio', channelSpec: 'poster',
      });
    },
    makeCopies: async (i) => {
      const reject = await getOpt080Number(i.userId, i.companyId).catch(() => '');
      const r: any = await generateMessages(i.brief, { total_count: 0 }, {
        brandName: i.companyName, channel: i.channel, isAd: true, rejectNumber: reject, usePersonalization: false, exactVars: [],
        licenseText: i.brief, voiceKind: 'marketing', companyId: i.companyId,
      });
      if (r?.fallback) throw stepFailed('문안을 만들지 못했습니다');
      return (r?.variants || []).slice(0, PROPOSAL_COPIES).map((v: any) => ({ subject: collapse(v.subject).slice(0, 40), text: stripAdParts(String(v.lms_text || '')).trim() }));
    },
    buildDm: async (i) => {
      // 조립 CT 를 그대로 쓰되 크레딧은 묻지도 걷지도 않는다(체험 = 원장 무접촉 · 금액 0 으로 견적을 묶는다)
      const deps = { ...defaultBuildDeps(), enabled: () => true, creditEnabled: async () => false, checkCredit: async () => undefined, deductOutcome: async () => 'not_required' as const };
      const r = await generateFromBuildMaterials({
        companyId: i.companyId, userId: i.userId, channel: 'dm',
        materials: {
          version: 1, attemptToken: randomUUID(), expectedTotal: 0, channel: 'dm',
          eventCards: [{ id: 'card1', title: i.title, text: i.brief, licensed: true, images: i.images.map((url) => ({ url })), link: null }],
          products: [], features: null, brandName: null,
        },
      }, deps);
      return r?.draftId ? String(r.draftId) : null;
    },
    publishDmUrl: async (id, companyId) => {
      // 발행의 문은 코어 하나(경품 동기화 + 주소 확정) · 그 앞에 첫 발행 잠금(링크 결함 · 채울 자리 · 검수 치명)을 같은 판정으로 본다.
      //   발행비는 걷지 않는다(체험 = 우리 부담 · 회사당 DM 한 개).
      const block = await dmPublishBlockOf(companyId, id);
      if (block) {
        console.log(`[proposal-trial] 모바일 DM 발행 잠금 company=${companyId} dm=${id} code=${block.code} ${block.error}`);
        return null;
      }
      const pub = await publishDmWithPrizes(id, companyId);
      return pub?.short_code ? dmShortUrlOf(String(pub.short_code)) : null;
    },
    callbackOf: async (companyId, userId) => {
      const set = await getRegisteredCallbackSet(companyId, userId);
      const first = [...set].map((p) => String(p || '').replace(/\D/g, '')).find((p) => p.length >= 8);
      return first || null;
    },
    spamCheck: async (i) => {
      const rejectNumber = await getOpt080Number(i.userId, i.companyId).catch(() => '');
      const r = await autoSpamTestWithRegenerate({
        companyId: i.companyId, userId: i.userId, callbackNumber: i.callback, messageType: i.channel,
        variants: i.copies.map((c, x) => ({ variantId: `proposal-${x + 1}`, messageText: c.text, subject: c.subject })),
        isAd: true, rejectNumber, maxRetries: 0,
      });
      return i.copies.map((_, x) => {
        const v = r.variants.find((one) => one.variantId === `proposal-${x + 1}`);
        if (!v) return 'unknown';
        return spamStateOf(spamVerdictOf(v as any, r.totalTestCount));
      });
    },
    deleteDm: (id, companyId) => deleteDm(id, companyId),
    deleteAsset: (companyId, assetId) => deleteAsset(companyId, assetId),
    assetIdOf: async (companyId, url) => {
      const found = await getAssetByUrl(companyId, url);
      return found?.id ? String(found.id) : null;
    },
    removeFile: removeCompanyImageFile,
    alert: async (i) => {
      const what = i.kind === 'requested' ? '제작 대행 체험 신청이 들어왔습니다.' : i.kind === 'produced' ? '제작 대행 체험의 완성본이 확인을 기다립니다.'
        : i.kind === 'orphan' ? '제작 대행 체험의 산출물 하나가 기록 없이 남았습니다(직접 확인 필요).' : '제작 대행 체험의 제작이 멈췄습니다.';
      await sendSystemAlert({
        dedupKey: `proposal-trial:${i.kind}:${i.companyId}${i.kind === 'orphan' ? `:${i.note || ''}` : ''}`, companyId: i.companyId, title: what,
        details: i.note ? [`${i.kind === 'orphan' ? '대상' : '사유'}: ${i.note}`] : [], action: '슈퍼관리자 「제안 체험」 탭에서 확인해 주세요.', cooldownMs: 60_000,
      }).catch(() => undefined);
    },
  };
}

type RemoveDeps = Pick<ProduceDeps, 'deleteDm' | 'deleteAsset' | 'assetIdOf' | 'removeFile'>;

/**
 * 산출물 하나 지우기 — **회수(collectProposalGarbage)만 부른다**(회수 목록에 적힌 것만 지운다). true = 지웠다 · 원래 없다 · 다른 곳이 쓰는 중이라 그대로 둔다.
 *   포스터 = 자산 행(번호가 안 적혔으면 주소로 찾는다 = 자산 등재 뒤 그 기록이 실패한 경우) → 그림 파일(지워졌거나 원래 없을 때만 true). DM = DM 삭제 CT.
 */
async function removeArtifact(companyId: string, it: GarbageItem, deps: RemoveDeps): Promise<boolean> {
  if (it.kind === 'dm') {
    await deps.deleteDm(it.id, companyId);
    return true;
  }
  const assetId = it.assetId || (await deps.assetIdOf(companyId, it.url));
  const r = assetId ? await deps.deleteAsset(companyId, assetId) : { deleted: false, inUse: false };
  return r.inUse ? true : deps.removeFile(companyId, it.url);
}

/**
 * 만든 산출물을 적지 못했다 — **지우지 않고 회수 목록에 남긴다**(지우는 것은 다음 회수가 한다 · 규약 ⑥ · Codex 구현 1R · 2R).
 *   uncertain = null: 기록이 0행으로 끝났다(소유권을 잃음) = 쓰기는 끝났고 적히지 않았다.
 *   uncertain = 오류: 적혔는지 모른다(늦게 끝나 적힐 수 있다) → **먼저 소유권을 내려놓는다**(제작 실패 문장). 같은 행의 쓰기라 앞 쓰기가 끝난 뒤에 서고,
 *     내려놓은 뒤에는 늦게 도착한 앞 쓰기가 적히지 못한다(토큰이 다르다). 다시 읽어 가른 뒤 지우는 길은 이 순서를 보장하지 못해 쓰지 않는다.
 *   그다음 한 문장으로 「행이 이미 가리키면 그대로 · 아니면 회수 목록에 더한다」. 여기까지 하지 못하면(DB 가 죽음) 아무것도 지우지 않고 사람에게 알린다.
 */
async function parkUnrecorded(companyId: string, token: string, made: GarbageItem, uncertain: unknown, deps: Pick<ProduceDeps, 'alert'>): Promise<void> {
  const what = made.kind === 'dm' ? `모바일 DM ${made.id}` : `포스터 ${made.url}`;
  try {
    if (uncertain) await query(PROPOSAL_FAIL_SQL, [companyId, token, String((uncertain as any)?.message || '제작 실패').slice(0, 300)]);
    const inKit = made.kind === 'dm' ? { dm: { id: made.id } } : { posters: [{ url: made.url }] };
    const inGarbage = made.kind === 'dm' ? [{ kind: 'dm', id: made.id }] : [{ kind: 'poster', url: made.url }];
    const parked = await query(PROPOSAL_PARK_SQL, [companyId, JSON.stringify(made), JSON.stringify(inKit), JSON.stringify(inGarbage)]);
    if (parked.rows.length > 0) return;
  } catch (err: any) {
    console.error(`[proposal-trial] 적지 못한 산출물을 회수 목록에 남기지 못함 company=${companyId} ${what} err=${err?.message}`);
  }
  await deps.alert({ companyId, kind: 'orphan', note: what }).catch(() => undefined);
}

/** 이 프로세스에서 지금 제작 중인 회사(운영은 단일 fork · 살아 있는 제작을 가져가지 않게) */
const producingHere = new Set<string>();
export function isProducingHere(companyId: string): boolean { return producingHere.has(companyId); }

export type ProduceStart = { ok: true } | { ok: false; reason: 'none' | 'busy' | 'delivered' | 'changed' };

/**
 * 제작을 시작한다(신청 직후 · 직원의 다시 제작 · 한 장 다시 · DM 다시 · 검사 다시가 모두 이 한 문).
 *   선점이 통하면 제작을 띄우고 바로 돌아온다(기다리지 않는다). wait = 시험용(끝날 때까지 기다린다).
 */
export async function startProposalProduce(companyId: string, redo: ProposalRedo = { kind: 'resume' }, deps: ProduceDeps = defaultProduceDeps(), wait = false): Promise<ProduceStart> {
  if (producingHere.has(companyId)) return { ok: false, reason: 'busy' };
  const row = await readProposalTrial(companyId);
  if (!row) return { ok: false, reason: 'none' };
  if (row.status === 'delivered') return { ok: false, reason: 'delivered' };
  const next = applyProposalRedo(row.kit || {}, redo);
  const token = randomUUID();
  const claimed = await query(PROPOSAL_CLAIM_SQL, [companyId, token, row.revision, JSON.stringify(next.kit), JSON.stringify(next.garbage)]);
  if (claimed.rows.length === 0) return { ok: false, reason: row.status === 'producing' ? 'busy' : 'changed' };
  producingHere.add(companyId);
  const work = runProposalProduce(companyId, token, deps).finally(() => { producingHere.delete(companyId); });
  if (wait) await work; else void work.catch(() => undefined);
  return { ok: true };
}

/** 제작 본문 — 적힌 단계는 건너뛰고, 단계마다 적고, 적지 못한 산출물은 지우지 않고 회수 목록에 남긴다(소유권을 잃음 · 기록 오류가 같은 길) */
export async function runProposalProduce(companyId: string, token: string, deps: ProduceDeps): Promise<void> {
  await runInCreditBundle(async () => {
    try {
      const row = await readProposalTrial(companyId);
      if (!row || row.produce_token !== token) throw new LostOwnership();
      await collectProposalGarbage(companyId, deps);   // 내 실행일 때만 회수한다(소유권이 없는 실행은 아무것도 하지 않는다)
      let kit: ProposalKit = row.kit || {};
      const save = async (next: ProposalKit, drop: GarbageItem[] = []): Promise<void> => {
        const r = await query(PROPOSAL_STEP_SQL, [companyId, token, JSON.stringify(next), JSON.stringify(drop)]);
        if (r.rows.length === 0) throw new LostOwnership();
        kit = next;
      };
      /** 방금 만든 산출물(made)을 적는다 — 적지 못하면(0행 · 오류) 지우지 않고 회수 목록에 남긴다(parkUnrecorded) */
      const record = async (next: ProposalKit, made: GarbageItem, drop: GarbageItem[] = []): Promise<void> => {
        try {
          await save(next, drop);
        } catch (err) {
          await parkUnrecorded(companyId, token, made, err instanceof LostOwnership ? null : err, deps);
          throw err;
        }
      };
      const info = await deps.companyInfo(companyId);

      // 1) 포스터 안 헤드라인 · 템플릿 후보
      if (!kit.title || !kit.picks?.length) {
        const h = await deps.pickHeadlines({ companyId, userId: row.requested_by, companyName: info.name, industry: info.industry, line: row.brief });
        if (h.picks.length === 0 || !h.title) throw stepFailed('포스터 템플릿을 고르지 못했습니다');
        await save({ ...kit, title: h.title, picks: h.picks });
      }

      // 2) 포스터 셋 — 그림을 만들면 주소부터 적고, 그다음 자산 번호를 적는다
      for (let i = 0; i < PROPOSAL_POSTERS; i++) {
        const withPoster = (p: KitPoster): ProposalKit => ({ ...kit, posters: Array.from({ length: PROPOSAL_POSTERS }, (_, x) => (x === i ? p : kit.posters?.[x] || null)) });
        let p = kit.posters?.[i] || null;
        if (!p?.url) {
          const picks = kit.picks as string[];
          const templateId = picks[(i + (kit.redo?.[i] || 0)) % picks.length];
          const photoUrl = row.photo_urls[i % row.photo_urls.length];
          const made = await deps.makePoster({ companyId, templateId, title: kit.title as string, photoUrl });
          p = { url: made.url, assetId: null, templateId };
          await record(withPoster(p), { kind: 'poster', assetId: null, url: made.url });
        }
        if (!p.assetId) {
          // 자산 행은 주소로 찾을 수 있다(주소는 이미 적혀 있다) → 이 기록이 실패해도 다음 이어 하기가 같은 행을 찾고, 회수는 주소로 그 행을 지운다
          const assetId = await deps.ensurePosterAsset({ companyId, userId: row.requested_by, url: p.url });
          if (!assetId) throw stepFailed('포스터를 보관함에 올리지 못했습니다');
          await save(withPoster({ ...p, assetId }));
        }
      }

      // 3) 문안 셋
      if ((kit.copies || []).length < PROPOSAL_COPIES) {
        const copies = await deps.makeCopies({ companyId, userId: row.requested_by, brief: row.brief, channel: row.channel, companyName: info.name });
        if (copies.length < PROPOSAL_COPIES || copies.some((c) => !c.text)) throw stepFailed('문안을 만들지 못했습니다');
        await save({ ...kit, copies: copies.slice(0, PROPOSAL_COPIES).map((c) => ({ subject: c.subject, text: c.text, spam: 'none' as SpamState })), spamDone: false });
      }

      // 4) 모바일 DM — 못 만들어도 완성본으로 넘긴다(「만들지 못함」으로 적고 직원이 다시 누른다).
      //   kit 에는 발행까지 끝난 DM 만 둔다. 조립은 됐는데 발행하지 못한 DM 은 같은 기록에서 회수 목록으로 보낸다(어디에도 안 적힌 DM 0).
      if (kit.dm === undefined) {
        let built: string | null = null;
        let url: string | null = null;
        try {
          const first = (kit.posters as Array<KitPoster | null>)[0] as KitPoster;
          built = await deps.buildDm({ companyId, userId: row.requested_by, title: kit.title as string, brief: row.brief, images: [first.url, ...row.photo_urls].slice(0, 5) });
          if (built) url = await deps.publishDmUrl(built, companyId);
        } catch (err: any) {
          console.log(`[proposal-trial] 모바일 DM 조립 · 발행 실패 company=${companyId} err=${err?.message}`);
        }
        if (built && url) await record({ ...kit, dm: { id: built, url } }, { kind: 'dm', id: built });
        else if (built) await record({ ...kit, dm: null }, { kind: 'dm', id: built }, [{ kind: 'dm', id: built }]);
        else await save({ ...kit, dm: null });
      }

      // 5) 통신사 스팸 검사 — 발신번호가 없거나 검사가 안 되면 「검사 못 함」으로 적는다
      if (!kit.spamDone) {
        const copies = kit.copies as KitCopy[];
        const callback = kit.callback || (await deps.callbackOf(companyId, row.requested_by).catch(() => null));
        let states: SpamState[] = copies.map(() => 'unknown');
        if (callback) {
          try {
            states = await deps.spamCheck({ companyId, userId: row.requested_by, callback, channel: row.channel, copies });
          } catch (err: any) {
            console.log(`[proposal-trial] 스팸 검사 실패 company=${companyId} err=${err?.message}`);
          }
        }
        await save({ ...kit, callback: callback || null, copies: copies.map((c, x) => ({ ...c, spam: states[x] || 'unknown' })), spamDone: true });
      }

      const fin = await query(PROPOSAL_FINISH_SQL, [companyId, token]);
      if (fin.rows.length === 0) throw new LostOwnership();
      await collectProposalGarbage(companyId, deps);
      await deps.alert({ companyId, kind: 'produced' });
    } catch (err: any) {
      if (err instanceof LostOwnership) return;
      console.error(`[proposal-trial] 제작 실패 company=${companyId} err=${err?.message}`);
      await query(PROPOSAL_FAIL_SQL, [companyId, token, String(err?.message || '제작 실패').slice(0, 300)]).catch(() => undefined);
      await deps.alert({ companyId, kind: 'failed', note: String(err?.message || '').slice(0, 80) });
    }
  });
}

/**
 * 회수 — 목록의 항목마다 지우고, 지운 것만 목록에서 뺀다. DM 먼저 · 포스터 나중(DM 이 포스터 그림을 싣고 있다).
 *   포스터 = 자산 삭제 CT(쓰이는 중이면 지우지 않고 목록에서만 뺀다) 뒤에 그림 파일을 주소로 한 번 더 지운다 →
 *   파일이 지워졌거나 원래 없을 때만 뺀다. 지우다 실패한 항목은 남아 다음 회수가 다시 한다.
 */
export async function collectProposalGarbage(companyId: string, deps: RemoveDeps): Promise<number> {
  const row = await readProposalTrial(companyId);
  const items = Array.isArray(row?.garbage) ? row!.garbage : [];
  let left = 0;
  for (const it of [...items.filter((x) => x.kind === 'dm'), ...items.filter((x) => x.kind === 'poster')]) {
    let done = false;
    try {
      done = await removeArtifact(companyId, it, deps);
    } catch (err: any) {
      console.log(`[proposal-trial] 회수 실패(다음에 다시) company=${companyId} kind=${it.kind} err=${err?.message}`);
    }
    if (done) await query(PROPOSAL_GARBAGE_POP_SQL, [companyId, JSON.stringify(it)]);
    else left++;
  }
  return left;
}

// ─────────────── 직원 ───────────────

/** 문안 고치기($index 번째) — 고치면 그 문안의 검사 결과가 지워진다 · 확인 대기일 때만 · 읽은 뒤 누가 바꿨으면 changed */
export async function editProposalCopy(companyId: string, revision: number, index: number, value: { subject?: unknown; text?: unknown }): Promise<'ok' | 'changed' | 'invalid'> {
  const row = await readProposalTrial(companyId);
  const copies = row?.kit?.copies || [];
  const text = String(value.text ?? '').replace(/\r\n/g, '\n').trim();
  if (!row || !Number.isInteger(index) || index < 0 || index >= copies.length || !text || text.length > 2000) return 'invalid';
  const subject = collapse(value.subject).slice(0, 40);
  const kit: ProposalKit = { ...row.kit, spamDone: false, copies: copies.map((c, x) => (x === index ? { subject, text, spam: 'none' as SpamState } : c)) };
  const r = await query(PROPOSAL_EDIT_SQL, [companyId, revision, JSON.stringify(kit)]);
  return r.rows.length > 0 ? 'ok' : 'changed';
}

/** 검사에 쓸 발신번호 바꾸기 — 그 회사에 등록된 번호만 · 바꾸면 검사 결과가 지워진다 */
export async function setProposalCallback(companyId: string, revision: number, callback: unknown, listCallbacks: (companyId: string) => Promise<string[]> = proposalCallbacks): Promise<'ok' | 'changed' | 'invalid'> {
  const row = await readProposalTrial(companyId);
  const digits = String(callback || '').replace(/\D/g, '');
  if (!row || !digits || !(await listCallbacks(companyId)).includes(digits)) return 'invalid';
  const kit: ProposalKit = { ...row.kit, callback: digits, spamDone: false, copies: (row.kit.copies || []).map((c) => ({ ...c, spam: 'none' as SpamState })) };
  const r = await query(PROPOSAL_EDIT_SQL, [companyId, revision, JSON.stringify(kit)]);
  return r.rows.length > 0 ? 'ok' : 'changed';
}

/** 그 회사에 등록된 발신번호(숫자만 · 중복 없이) */
export async function proposalCallbacks(companyId: string): Promise<string[]> {
  const set = await getRegisteredCallbackSet(companyId);
  return [...new Set([...set].map((p) => String(p || '').replace(/\D/g, '')).filter((p) => p.length >= 8))];
}

export interface DeliverDeps {
  sendNotice(companyId: string, phone: string, text: string): Promise<number>;
  collect(companyId: string): Promise<number>;
}
export function defaultDeliverDeps(): DeliverDeps {
  return {
    sendNotice: (companyId, phone, text) => insertNoticeSms(
      // 행 꼴 = 다른 안내 문자와 같다(받는 번호 · 발신 · 본문 · 종류 · 제목 · 시각(지금 = 쓰지 않음) · app_etc1 · app_etc2 = 회사 · 그림 셋)
      [[phone, getPlatformNoticeCallback(), text, 'L', '[한줄로] 완성본 안내', null, '', companyId, '', '', '']],
      true, { companyId, source: 'proposal-trial' }, { boundedMs: PROPOSAL_NOTICE_WAIT_MS },
    ),
    collect: (companyId) => collectProposalGarbage(companyId, defaultProduceDeps()),
  };
}

export type DeliverResult = 'ok' | 'none' | 'not_ready' | 'incomplete' | 'changed';
/**
 * 전달 — 「확인 대기 → 전달」 한 문장. seenRevision = **직원 화면이 본 판**: 그 뒤에 다시 만들기 · 문안 고치기 · 발신번호 바꾸기가 끼었으면
 *   changed(직원이 보지 않은 완성본이 나가지 않는다). 밖에 남는 일은 여기서 하지 않는다(모바일 DM 은 만들 때 발행이 끝나 있다).
 *   알림은 전달이 통한 요청만 보낸다(둘이 눌러도 문자는 한 통).
 */
export async function deliverProposalKit(companyId: string, by: string, seenRevision: number, deps: DeliverDeps = defaultDeliverDeps()): Promise<{ result: DeliverResult; notice?: NotifyResult }> {
  await deps.collect(companyId).catch(() => 0);
  const row = await readProposalTrial(companyId);
  if (!row) return { result: 'none' };
  if (row.status !== 'produced') return { result: 'not_ready' };
  if (!kitComplete(row.kit)) return { result: 'incomplete' };
  const r = await query(PROPOSAL_DELIVER_SQL, [companyId, seenRevision, by]);
  if (r.rows.length === 0) return { result: 'changed' };
  return { result: 'ok', notice: await notifyProposalReady(companyId, 0, deps) };
}

export type NotifyResult = 'sent' | 'held' | 'no_phone' | 'unknown';
/**
 * 도착 알림 — 시도 수를 화면이 본 값일 때만 올리는 한 문장으로 한 요청만 통과시킨다.
 *   sent = 적재 확인 · held = 통하지 않음(다른 요청이 먼저 · 앞 시도 뒤 2분 안 · 이미 보냄) · unknown = 적재를 시작했고 끝을 모른다(실패 · 시간 초과).
 */
export async function notifyProposalReady(companyId: string, seenTries: number, deps: Pick<DeliverDeps, 'sendNotice'> = defaultDeliverDeps()): Promise<NotifyResult> {
  const r = await query(PROPOSAL_NOTIFY_TRY_SQL, [companyId, seenTries]);
  if (r.rows.length === 0) return 'held';
  const phone = String(r.rows[0].notify_phone || '').replace(/\D/g, '');
  if (!phone) return 'no_phone';
  try {
    const n = await deps.sendNotice(companyId, phone, PROPOSAL_READY_TEXT);
    if (n >= 1) {
      await query(PROPOSAL_NOTIFIED_SQL, [companyId]);
      return 'sent';
    }
  } catch (err: any) {
    console.error(`[proposal-trial] 알림 적재 실패 company=${companyId} err=${err?.message}`);
  }
  return 'unknown';
}

// ─────────────── 담당자 화면 ───────────────

export interface ProposalViewer { userId?: string; companyId?: string; userType?: string }
/** 완성본 · 진행 상태를 볼 수 있는 사람 = 신청자 본인 + 회사 관리자(「관리자 전체 · 사용자 자기 것」) */
export function canViewProposal(row: Pick<ProposalRow, 'requested_by'> | null, user: ProposalViewer): boolean {
  return !!row && (user.userType === 'company_admin' || (!!user.userId && row.requested_by === user.userId));
}

export type ProposalView =
  | { state: 'none' }
  | { state: 'other' }
  | { state: 'working'; brief: string; channel: ProposalChannel; photos: string[]; notifyPhone: string }
  | { state: 'ready'; brief: string; channel: ProposalChannel; posters: Array<{ url: string }>; copies: Array<{ subject: string; text: string; spam: SpamState }>; dmUrl: string | null };

/** 담당자 화면이 그릴 것 — 완성본을 처음 열면 연 시각을 적는다 */
export async function proposalViewFor(user: ProposalViewer): Promise<ProposalView> {
  const row = await readProposalTrial(String(user.companyId));
  if (!row) return { state: 'none' };
  if (!canViewProposal(row, user)) return { state: 'other' };
  if (row.status !== 'delivered') {
    return { state: 'working', brief: row.brief, channel: row.channel, photos: row.photo_urls, notifyPhone: maskPhone(row.notify_phone) };
  }
  if (!row.opened_at) await query(PROPOSAL_OPENED_SQL, [row.company_id]);
  return {
    state: 'ready', brief: row.brief, channel: row.channel,
    posters: (row.kit.posters || []).filter((p): p is KitPoster => !!p).map((p) => ({ url: p.url })),
    copies: (row.kit.copies || []).map((c) => ({ subject: c.subject, text: c.text, spam: c.spam })),
    dmUrl: row.kit.dm?.url || null,
  };
}

export interface ProposalFill { message: string; subject: string; msgType: ProposalChannel; assetId: string | null }
/**
 * 「명단만 올려 보내기」가 작성 화면에 채울 값 — 지금 계정의 열람 권한과 전달 상태를 다시 본다(화면이 넘긴 것은 번호뿐).
 *   poster = 0 ~ 2 또는 null(글만) · copy = 0 ~ 2 · withDm = 문안 끝에 모바일 DM 주소를 붙인다. 처음 누른 시각을 적는다.
 */
export async function proposalFillFor(user: ProposalViewer, pick: { poster: number | null; copy: number; withDm: boolean }): Promise<ProposalFill | null> {
  const row = await readProposalTrial(String(user.companyId));
  if (!row || row.status !== 'delivered' || !canViewProposal(row, user)) return null;
  const copy = (row.kit.copies || [])[pick.copy];
  if (!copy) return null;
  const poster = pick.poster === null ? null : (row.kit.posters || [])[pick.poster] || null;
  if (pick.poster !== null && !poster?.assetId) return null;
  const dmUrl = pick.withDm ? row.kit.dm?.url || null : null;
  if (pick.withDm && !dmUrl) return null;
  if (!row.used_at) await query(PROPOSAL_USED_SQL, [row.company_id]);
  return {
    message: dmUrl ? `${copy.text}\n\n${dmUrl}` : copy.text,
    subject: copy.subject,
    msgType: poster ? 'MMS' : 'LMS',
    assetId: poster?.assetId || null,
  };
}

/** 완성본 알림 번호 칸을 미리 채울 값 = 그 계정의 로그인 인증 번호(없으면 빈 칸) */
export const PROPOSAL_USER_PHONE_SQL = `SELECT mfa_phone FROM users WHERE id = $1::uuid`;
export async function proposalPrefillPhone(userId: string): Promise<string> {
  try {
    return String((await query(PROPOSAL_USER_PHONE_SQL, [userId])).rows[0]?.mfa_phone || '').replace(/\D/g, '');
  } catch {
    return '';
  }
}

/** 소개 문장의 금액 = 요금제 표에서 읽는다(글자로 박지 않는다) */
export const PROPOSAL_AGENCY_PLAN_SQL = `SELECT monthly_price FROM plans WHERE upper(plan_code) = 'BUSINESS' AND is_active = true LIMIT 1`;
/** (순수) 금액 글자 — 만 원 단위로 떨어질 때만 「(월 N만 원)」 · 그 밖 = 빈 글자(금액 없이 쓴다) */
export function agencyPriceText(monthlyPrice: unknown): string {
  const n = Number(monthlyPrice);
  return Number.isFinite(n) && n > 0 && n % 10000 === 0 ? `(월 ${(n / 10000).toLocaleString('ko-KR')}만 원)` : '';
}
/** 제안 페이지의 글 — CSS 는 언제나 · 소개 마크업은 신청 전 화면에만 */
export async function proposalPageContent(withIntro: boolean): Promise<{ css: string; html: string }> {
  if (!withIntro) return { css: PROPOSAL_PAGE_CSS, html: '' };
  let price = '';
  try {
    price = agencyPriceText((await query(PROPOSAL_AGENCY_PLAN_SQL)).rows[0]?.monthly_price);
  } catch {
    price = '';
  }
  return { css: PROPOSAL_PAGE_CSS, html: PROPOSAL_INTRO_HTML.replace('{{agencyPrice}}', price) };
}

// ─────────────── 슈퍼관리자 현황 ───────────────

export const PROPOSAL_AUDIT = { view: 'proposal_view', open: 'proposal_open' } as const;
export const PROPOSAL_AUDIT_TARGET = 'proposal';
export const PROPOSAL_LINK_DAYS = 30;

/** 링크별 = src 마다 열람 수 · 로그인한 회사 수(최근 30일 · audit_logs) */
export const PROPOSAL_LINKS_SQL = `
  SELECT COALESCE(NULLIF(details->>'src', ''), '(없음)') AS src,
         COUNT(*) FILTER (WHERE action = '${PROPOSAL_AUDIT.view}')::int AS views,
         COUNT(DISTINCT target_id) FILTER (WHERE action = '${PROPOSAL_AUDIT.open}')::int AS companies,
         MAX(created_at) AS last_at
    FROM audit_logs
   WHERE action IN ('${PROPOSAL_AUDIT.view}', '${PROPOSAL_AUDIT.open}') AND target_type = '${PROPOSAL_AUDIT_TARGET}'
     AND created_at > now() - interval '${PROPOSAL_LINK_DAYS} days'
   GROUP BY 1
   ORDER BY last_at DESC
   LIMIT 200`;
/** 회사별 = 로그인해 제안 페이지를 연 회사 전부(신청하지 않은 회사 포함) + 체험 행 + 보내기 누름 뒤 직접발송 수 */
export const PROPOSAL_COMPANIES_SQL = `
  WITH opened AS (
    SELECT target_id AS company_id, MIN(created_at) AS first_open, MAX(created_at) AS last_open,
           (ARRAY_AGG(NULLIF(details->>'src', '') ORDER BY created_at DESC) FILTER (WHERE NULLIF(details->>'src', '') IS NOT NULL))[1] AS src
      FROM audit_logs
     WHERE action = '${PROPOSAL_AUDIT.open}' AND target_type = '${PROPOSAL_AUDIT_TARGET}' AND target_id IS NOT NULL
     GROUP BY target_id
  ), ids AS (
    SELECT company_id::text AS company_id FROM proposal_trials
    UNION
    SELECT company_id::text FROM opened
  )
  SELECT i.company_id, c.company_name, COALESCE(t.src, o.src) AS src, o.first_open, o.last_open,
         t.status, t.requested_at, t.produced_at, t.delivered_at, t.opened_at, t.used_at, t.produce_error, t.produce_beat_at,
         t.notify_tries, t.notify_tried_at, t.notified_at, t.updated_at, t.channel,
         CASE WHEN t.used_at IS NULL THEN 0 ELSE (
           SELECT COUNT(*)::int FROM campaigns ca WHERE ca.company_id = t.company_id AND ca.send_type = 'direct' AND ca.created_at > t.used_at
         ) END AS sent_after
    FROM ids i
    LEFT JOIN proposal_trials t ON t.company_id::text = i.company_id
    LEFT JOIN opened o ON o.company_id::text = i.company_id
    LEFT JOIN companies c ON c.id::text = i.company_id
   ORDER BY COALESCE(t.updated_at, o.last_open) DESC NULLS LAST
   LIMIT 300`;

export async function loadProposalAdmin(): Promise<{ links: any[]; companies: any[] }> {
  const [links, companies] = await Promise.all([query(PROPOSAL_LINKS_SQL), query(PROPOSAL_COMPANIES_SQL)]);
  return { links: links.rows, companies: companies.rows };
}

/** 한 회사의 상세(직원 확인 화면) */
export async function loadProposalAdminDetail(companyId: string): Promise<{ row: ProposalRow; producing: boolean; callbacks: string[] } | null> {
  const row = await readProposalTrial(companyId);
  if (!row) return null;
  return { row, producing: isProducingHere(companyId), callbacks: await proposalCallbacks(companyId).catch(() => []) };
}
