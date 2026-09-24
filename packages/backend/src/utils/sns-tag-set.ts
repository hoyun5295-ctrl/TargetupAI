/**
 * sns-tag-set.ts — 회사 '자주 쓰는 태그' (2026-09-24 B-5)
 * 설계 SoT = docs/2026-09-24-sns-channel-design.md §4 B-5 · 저장 위치 = `companies.brand_kit.sns_tag_set`(jsonb · 신규 테이블 0).
 *
 * ⛔ **말없이 지우지 않는다.** 규칙이 바뀌어 형식 위반이 된 옛 값은 `invalid[]` 로 돌려주고 사용자가 뺀다.
 * ⛔ 더하기·빼기는 한 트랜잭션 · 회사 행 `FOR UPDATE` · `jsonb_set` 으로 이 키만 바꾼다(다른 brand_kit 키 불변).
 * ⛔ 상한 50(더하기·통째 저장 모두).
 */

import { pool, query } from '../config/database';
import { checkSnsTag, extractBodyHashtags, invalidSnsTags, normalizeSnsTags } from './sns-caption-rules';

export const SNS_TAG_SET_MAX = 50;
/** 세트가 비었을 때 보여 줄 씨앗 개수 */
export const SNS_TAG_SEED_LIMIT = 10;

export class SnsTagSetError extends Error {
  readonly code: string;
  readonly status: number;
  readonly invalid: Array<{ raw: string; reason: string }>;
  constructor(code: string, message: string, status = 400, invalid: Array<{ raw: string; reason: string }> = []) {
    super(message);
    this.name = 'SnsTagSetError';
    this.code = code;
    this.status = status;
    this.invalid = invalid;
  }
}

export interface SnsTagSetView {
  tags: string[];
  invalid: Array<{ raw: string; reason: string }>;
}

function rawList(brandKit: any): string[] {
  const list = brandKit?.sns_tag_set;
  return Array.isArray(list) ? list.map((v: unknown) => String(v ?? '')).filter((v: string) => v.trim()) : [];
}

function view(raw: string[]): SnsTagSetView {
  return { tags: normalizeSnsTags(raw), invalid: invalidSnsTags(raw) };
}

/** 같은 태그인가(앞 `#` · 공백 · 대소문자 무시). */
function tagKey(raw: string): string {
  return String(raw ?? '').trim().replace(/^#+/, '').replace(/\s+/g, '').normalize('NFC').toLowerCase();
}

export async function readSnsTagSet(companyId: string): Promise<SnsTagSetView> {
  const r = await query(`SELECT brand_kit FROM companies WHERE id = $1::uuid`, [companyId]);
  return view(rawList(r.rows[0]?.brand_kit));
}

/** 통째 저장(옛 화면 호환). 형식 위반·상한 초과는 거절한다. */
export async function replaceSnsTagSet(companyId: string, input: unknown[]): Promise<SnsTagSetView> {
  const invalid = invalidSnsTags(input);
  if (invalid.length) throw new SnsTagSetError('TAG_INVALID', invalid[0].reason, 400, invalid);
  const tags = normalizeSnsTags(input);
  if (tags.length > SNS_TAG_SET_MAX) throw new SnsTagSetError('TAG_SET_FULL', `자주 쓰는 태그는 ${SNS_TAG_SET_MAX}개까지 저장할 수 있어요.`);
  await query(
    `UPDATE companies
        SET brand_kit = jsonb_set(COALESCE(brand_kit, '{}'::jsonb), '{sns_tag_set}', $2::jsonb, true), updated_at = NOW()
      WHERE id = $1::uuid`,
    [companyId, JSON.stringify(tags)],
  );
  return view(tags);
}

/** 더하기·빼기. 빼기는 옛 형식 위반 값도 뺄 수 있다(원문 비교). */
export async function patchSnsTagSet(companyId: string, input: { add?: unknown[]; remove?: unknown[] }): Promise<SnsTagSetView> {
  const addRaw = Array.isArray(input.add) ? input.add : [];
  const removeKeys = new Set((Array.isArray(input.remove) ? input.remove : []).map((v) => tagKey(String(v ?? ''))).filter(Boolean));
  const invalid = invalidSnsTags(addRaw);
  if (invalid.length) throw new SnsTagSetError('TAG_INVALID', invalid[0].reason, 400, invalid);
  const add = addRaw.map((v) => checkSnsTag(v)).filter((r): r is { ok: true; tag: string } => !!r && r.ok).map((r) => r.tag);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT brand_kit FROM companies WHERE id = $1::uuid FOR UPDATE`, [companyId]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      throw new SnsTagSetError('COMPANY_NOT_FOUND', '회사 정보를 찾을 수 없어요.', 404);
    }
    const next = rawList(cur.rows[0].brand_kit).filter((t) => !removeKeys.has(tagKey(t)));
    const seen = new Set(next.map(tagKey));
    for (const t of add) {
      const k = tagKey(t);
      if (seen.has(k)) continue;
      seen.add(k);
      next.push(t);
    }
    if (next.length > SNS_TAG_SET_MAX) {
      await client.query('ROLLBACK');
      throw new SnsTagSetError('TAG_SET_FULL', `자주 쓰는 태그는 ${SNS_TAG_SET_MAX}개까지 저장할 수 있어요. 안 쓰는 태그를 먼저 빼 주세요.`);
    }
    await client.query(
      `UPDATE companies
          SET brand_kit = jsonb_set(COALESCE(brand_kit, '{}'::jsonb), '{sns_tag_set}', $2::jsonb, true), updated_at = NOW()
        WHERE id = $1::uuid`,
      [companyId, JSON.stringify(next)],
    );
    await client.query('COMMIT');
    return view(next);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 씨앗 — 세트가 비었을 때만 쓴다. 이 회사 지난 글의 tags ∪ 본문 #태그를 빈도순 상위 10(AI 0).
 * 최근 200건만 본다.
 */
export async function snsTagSeeds(companyId: string): Promise<string[]> {
  const r = await query(
    `SELECT body, tags FROM sns_posts WHERE company_id = $1::uuid ORDER BY created_at DESC LIMIT 200`,
    [companyId],
  );
  const count = new Map<string, { tag: string; n: number }>();
  for (const row of r.rows) {
    const tags = [
      ...normalizeSnsTags(Array.isArray(row.tags) ? row.tags : []),
      ...extractBodyHashtags(String(row.body ?? '')),
    ];
    const once = new Set<string>();
    for (const t of tags) {
      const k = t.toLowerCase();
      if (once.has(k)) continue;
      once.add(k);
      const cur = count.get(k);
      if (cur) cur.n += 1;
      else count.set(k, { tag: t, n: 1 });
    }
  }
  return [...count.values()].sort((a, b) => b.n - a.n).slice(0, SNS_TAG_SEED_LIMIT).map((v) => v.tag);
}
