/**
 * 쓸수록 배우는 목소리 · 습관 CT (★ 2026-10-28 AI 메모리 설계 K14 · I16 · docs/2026-10-28-ai-memory-brand-voice-design.md)
 *
 * K14-1 고친 차이 = 허브 3안을 담당자가 고쳐 보낸 기록(학습 원장 · 정규화 뒤)에서
 *   - 자동으로 배우는 것 = 모양 · 형식만(줄 수 · 빈 줄 · 기호 집합 · 어체 바꿈) · 글자를 싣지 않는 값.
 *   - 담당자가 새로 넣은 글귀 · 지운 표현 = 서로 다른 발송 3건 이상 반복될 때 후보 칩으로만 · 사람이 받아들인 것만 「쓸 것 · 피할 것」.
 *     사실(숫자 · 혜택 · 가린 자리 · 칸)이 섞인 글귀는 후보로도 올리지 않는다.
 * K14-2 습관 프로필 = 「사람이 보낸 발송」 CT 로만 · 요일 · 시각(KST) · 간격 중앙값 · 채널 · 광고 비율 · 혜택 종류 · 10건 미만 = 없음.
 *   문안 프롬프트에는 싣지 않는다(시각 · 주기 조언에만).
 * K14-3 조언 = 숫자로 만든 코드 문장(AI 0).
 * 행 = ai_company_memory · voice_edit/main · habit_profile/main · DDL 0 · 20시간 멱등(워커).
 */
import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { query, pool } from '../config/database';
import { measureText, normalizeForShape } from './copy-shape';
import { detectBenefits, AI_FILL_DIRECT_PATTERN } from './copy-benefit-detector';
import { getTenantRef } from './training-logger';
import { listHumanSentCandidates, type HumanSentCandidate } from './human-sent-messages';

// ─────────────── 고친 차이(K14-1) ───────────────

export interface EditForm {
  /** 고친 글이 줄을 더 나눈 비율(줄 수 늘림 / 표본) */
  moreLines: number;
  fewerLines: number;
  /** 고친 글이 더한 기호(글자 아님) */
  addedSymbols: string[];
  removedSymbols: string[];
  /** 어체 바꿈(같은 문장 끝 음절만 바뀐 것) 방향 */
  toHaeyo: number;
  toHapsho: number;
  samples: number;
}

export interface PhraseCandidate { id: string; mode: 'use' | 'avoid'; text: string; count: number }

export interface VoiceEditRow {
  form: EditForm | null;
  candidates: PhraseCandidate[];
  accepted_use: Array<{ text: string; at: string; by: string | null }>;
  accepted_avoid: Array<{ text: string; at: string; by: string | null }>;
  dismissed: string[];
  updatedAt: string;
}

export const EMPTY_VOICE_EDIT: VoiceEditRow = { form: null, candidates: [], accepted_use: [], accepted_avoid: [], dismissed: [], updatedAt: '' };

/** 후보 반복 하한(서로 다른 발송) */
export const PHRASE_REPEAT_MIN = 3;

function sentences(t: string): string[] {
  return normalizeForShape(t).split(/\n+|(?<=[.!?。])\s+/).map((x) => x.trim()).filter((x) => x.length >= 4);
}

/** 사실이 섞인 글귀(숫자 · 혜택 값 · 가린 자리 · 칸 · 변수)는 후보로도 올리지 않는다(I16) */
function isFactFree(s: string): boolean {
  if (/\d/.test(s)) return false;
  if (/\{[a-z_]+\}/i.test(s)) return false;
  if (/%[^%\s]{1,20}%/.test(s)) return false;
  if (AI_FILL_DIRECT_PATTERN.test(s)) return false;
  if (detectBenefits(s).hasBenefit) return false;
  return s.length <= 40;
}

const HAEYO = /(?<!세)요[.!?~]?$/;
const HAPSHO = /(니다|니까|십시오)[.!?~]?$/;

/** (순수) 고친 기록 → 형식 값 + 글귀 후보(반복 3 · 사실 0 · 지운 칩 다시 안 올림) */
export function learnFromEdits(
  pairs: ReadonlyArray<{ sendKey: string; before: string; after: string }>,
  dismissed: ReadonlyArray<string> = [],
): { form: EditForm | null; candidates: PhraseCandidate[] } {
  if (pairs.length === 0) return { form: null, candidates: [] };
  let moreLines = 0; let fewerLines = 0; let toHaeyo = 0; let toHapsho = 0;
  const addSym = new Map<string, number>();
  const remSym = new Map<string, number>();
  const added = new Map<string, Set<string>>();
  const removed = new Map<string, Set<string>>();
  for (const p of pairs) {
    const a = measureText(p.before);
    const b = measureText(p.after);
    if (b.lines > a.lines) moreLines++;
    if (b.lines < a.lines) fewerLines++;
    for (const s of Object.keys(b.symbols)) if (!(s in a.symbols)) addSym.set(s, (addSym.get(s) || 0) + 1);
    for (const s of Object.keys(a.symbols)) if (!(s in b.symbols)) remSym.set(s, (remSym.get(s) || 0) + 1);
    const sa = sentences(p.before);
    const sb = sentences(p.after);
    const setA = new Set(sa);
    const setB = new Set(sb);
    // 어체 바꿈 = 끝 음절만 바뀐 같은 문장
    for (const x of sa) {
      const stem = x.replace(/(요|니다|니까|십시오)[.!?~]?$/, '');
      const y = sb.find((z) => z !== x && z.startsWith(stem) && stem.length >= 4);
      if (y) { if (HAEYO.test(y) && HAPSHO.test(x)) toHaeyo++; if (HAPSHO.test(y) && HAEYO.test(x)) toHapsho++; }
    }
    for (const s of sb) if (!setA.has(s) && isFactFree(s)) (added.get(s) || added.set(s, new Set()).get(s)!).add(p.sendKey);
    for (const s of sa) if (!setB.has(s) && isFactFree(s)) (removed.get(s) || removed.set(s, new Set()).get(s)!).add(p.sendKey);
  }
  const half = (m: Map<string, number>) => Array.from(m.entries()).filter(([, n]) => n * 2 >= pairs.length).map(([s]) => s);
  const dis = new Set(dismissed);
  const cand = (mode: 'use' | 'avoid', m: Map<string, Set<string>>): PhraseCandidate[] =>
    Array.from(m.entries()).filter(([, keys]) => keys.size >= PHRASE_REPEAT_MIN)
      .map(([text, keys]) => ({ id: phraseId(mode, text), mode, text, count: keys.size }))
      .filter((c) => !dis.has(c.id));
  return {
    form: { moreLines, fewerLines, addedSymbols: half(addSym), removedSymbols: half(remSym), toHaeyo, toHapsho, samples: pairs.length },
    candidates: [...cand('use', added), ...cand('avoid', removed)].sort((x, y) => y.count - x.count).slice(0, 12),
  };
}

export function phraseId(mode: 'use' | 'avoid', text: string): string {
  return createHash('sha256').update(`${mode}:${text}`).digest('hex').slice(0, 16);
}

/** (순수) 형식 값 → 지시 줄(글자 0 · 기호는 글자가 아니다) */
export function editFormLines(f: EditForm | null): string[] {
  if (!f || f.samples < PHRASE_REPEAT_MIN) return [];
  const out: string[] = [];
  if (f.moreLines * 2 > f.samples) out.push('- 담당자는 AI 안을 고칠 때 줄을 더 나눈다(한 줄을 짧게).');
  if (f.fewerLines * 2 > f.samples) out.push('- 담당자는 AI 안을 고칠 때 줄을 합친다(덜 끊는다).');
  if (f.addedSymbols.length) out.push(`- 담당자가 자주 더하는 기호: ${f.addedSymbols.join(' ')}`);
  if (f.removedSymbols.length) out.push(`- 담당자가 자주 지우는 기호: ${f.removedSymbols.join(' ')} (쓰지 않는다)`);
  if (f.toHaeyo > f.toHapsho && f.toHaeyo >= PHRASE_REPEAT_MIN) out.push('- 담당자는 합쇼체를 해요체로 고친다.');
  if (f.toHapsho > f.toHaeyo && f.toHapsho >= PHRASE_REPEAT_MIN) out.push('- 담당자는 해요체를 합쇼체로 고친다.');
  return out;
}

export function parseVoiceEdit(raw: unknown): VoiceEditRow {
  let v: any = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { v = null; } }
  if (!v || typeof v !== 'object') return { ...EMPTY_VOICE_EDIT };
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((e: any) => e && typeof e.text === 'string') : []);
  return {
    form: v.form && typeof v.form === 'object' ? v.form : null,
    candidates: Array.isArray(v.candidates) ? v.candidates.filter((c: any) => c && typeof c.id === 'string' && typeof c.text === 'string') : [],
    accepted_use: list(v.accepted_use),
    accepted_avoid: list(v.accepted_avoid),
    dismissed: Array.isArray(v.dismissed) ? v.dismissed.map(String) : [],
    updatedAt: String(v.updatedAt || ''),
  };
}

// ─────────────── 습관 프로필(K14-2) · 조언(K14-3) ───────────────

export interface HabitProfile {
  samples: number;
  topWeekdays: number[];      // 0 = 일 · KST
  topHours: number[];         // KST
  intervalMedianDays: number | null;
  channels: Record<string, number>;
  adRatio: number;
  benefitTypes: Record<string, number>;
}

/** 습관을 재는 하한(완료 10건 미만 = 없음 · 못 읽음 ≠ 0) */
export const HABIT_MIN_SAMPLES = 10;

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000);

/** (순수) 「사람이 보낸 발송」 → 습관 */
export function buildHabitProfile(rows: ReadonlyArray<Pick<HumanSentCandidate, 'sentAt' | 'channel' | 'isAd' | 'text'>>): HabitProfile | null {
  const dated = rows.filter((r) => r.sentAt && Number.isFinite(Date.parse(r.sentAt)));
  if (dated.length < HABIT_MIN_SAMPLES) return null;
  const wd = new Map<number, number>(); const hr = new Map<number, number>();
  const ch: Record<string, number> = {}; const bt: Record<string, number> = {};
  for (const r of dated) {
    const d = kst(r.sentAt!);
    wd.set(d.getUTCDay(), (wd.get(d.getUTCDay()) || 0) + 1);
    hr.set(d.getUTCHours(), (hr.get(d.getUTCHours()) || 0) + 1);
    ch[r.channel] = (ch[r.channel] || 0) + 1;
    for (const t of detectBenefits(r.text).tokens) {
      const kind = /%/.test(t) ? '할인율' : /원/.test(t) ? '금액 할인' : /\+/.test(t) ? '묶음' : t;
      bt[kind] = (bt[kind] || 0) + 1;
    }
  }
  const top = (m: Map<number, number>) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).filter(([, n]) => n * 4 >= dated.length).map(([k]) => k);
  const times = dated.map((r) => Date.parse(r.sentAt!)).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => (t - times[i]) / 86400000).filter((g) => g > 0.5).sort((a, b) => a - b);
  return {
    samples: dated.length,
    topWeekdays: top(wd),
    topHours: top(hr),
    intervalMedianDays: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]) : null,
    channels: ch,
    adRatio: Math.round((dated.filter((r) => r.isAd).length / dated.length) * 100) / 100,
    benefitTypes: bt,
  };
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
/** (순수) 숫자로 만든 조언 한 장(AI 0) · 없으면 「아직 배울 재료가 없어요」 */
export function habitAdvice(p: HabitProfile | null): string[] {
  if (!p) return [];
  const out: string[] = [];
  if (p.topWeekdays.length || p.topHours.length) {
    const days = p.topWeekdays.map((d) => WD[d]).join(' · ');
    const hours = p.topHours.map((h) => `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}시`).join(' · ');
    out.push(`보내시는 때는 주로 ${days ? `${days}요일` : ''}${days && hours ? ' ' : ''}${hours}예요.`);
  }
  if (p.intervalMedianDays) out.push(`보통 ${p.intervalMedianDays}일마다 보내세요.`);
  const mainCh = Object.entries(p.channels).sort((a, b) => b[1] - a[1])[0];
  if (mainCh) out.push(`${mainCh[0]} 문자를 가장 많이 보내세요(${Math.round((mainCh[1] / p.samples) * 100)}%).`);
  const ben = Object.entries(p.benefitTypes).sort((a, b) => b[1] - a[1])[0];
  if (ben) out.push(`혜택은 ${ben[0]}을 자주 쓰세요.`);
  return out;
}

// ─────────────── DB(워커 · 라우트) ───────────────

const ROW = (type: string) => `company_id = $1::uuid AND memory_type = '${type}' AND memory_key = 'main'`;

export async function readVoiceEdit(companyId: string): Promise<VoiceEditRow> {
  const r = await query(`SELECT memory_value FROM ai_company_memory WHERE ${ROW('voice_edit')}`, [companyId]);
  return parseVoiceEdit(r.rows[0]?.memory_value);
}

export async function readHabit(companyId: string): Promise<{ profile: HabitProfile | null; advice: string[]; computedAt: string | null }> {
  const r = await query(`SELECT memory_value FROM ai_company_memory WHERE ${ROW('habit_profile')}`, [companyId]);
  let v: any = null;
  const raw = r.rows[0]?.memory_value;
  try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { v = null; }
  return { profile: v?.profile ?? null, advice: Array.isArray(v?.advice) ? v.advice : [], computedAt: v?.computedAt ?? null };
}

async function upsertRow(c: { query: PoolClient['query'] } | typeof pool, companyId: string, type: string, value: unknown): Promise<void> {
  await c.query(
    `INSERT INTO ai_company_memory (id, company_id, memory_type, memory_key, memory_value, importance, source, metadata, last_accessed_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, $2, 'main', $3, 10, 'system', '{}'::jsonb, NOW(), NOW(), NOW())
     ON CONFLICT (company_id, memory_type, memory_key) DO UPDATE SET memory_value = EXCLUDED.memory_value, updated_at = NOW()`,
    [companyId, type, JSON.stringify(value)],
  );
}

/** 회사 하나 다시 재기(습관 + 고친 차이) · 사람이 받아들인 · 지운 기록은 그대로 둔다 */
export async function refreshVoiceHabits(companyId: string): Promise<void> {
  const sent = await listHumanSentCandidates(companyId, { userId: null, userType: 'company_admin' }, { days: 180 });
  const profile = buildHabitProfile(sent);
  await upsertRow(pool, companyId, 'habit_profile', { profile, advice: habitAdvice(profile), computedAt: new Date().toISOString(), samples: sent.length });

  const logs = await query(
    `SELECT source_ref, candidates, selected_candidate_id, final_message
       FROM ai_training_logs
      WHERE tenant_ref = $1 AND final_source = 'edited' AND model_params ? 'hubVariants'
        AND created_at >= NOW() - INTERVAL '180 days'
      ORDER BY created_at DESC
      LIMIT 200`,
    [getTenantRef(companyId)],
  );
  const pairs: Array<{ sendKey: string; before: string; after: string }> = [];
  for (const row of logs.rows as any[]) {
    const cands = Array.isArray(row.candidates) ? row.candidates : [];
    const picked = cands.find((x: any) => x?.candidate_id === row.selected_candidate_id);
    if (picked?.text && row.final_message) pairs.push({ sendKey: String(row.source_ref), before: String(picked.text), after: String(row.final_message) });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT memory_value FROM ai_company_memory WHERE ${ROW('voice_edit')} FOR UPDATE`, [companyId]);
    const prev = parseVoiceEdit(cur.rows[0]?.memory_value);
    const accepted = new Set([...prev.accepted_use, ...prev.accepted_avoid].map((a) => a.text));
    const learned = learnFromEdits(pairs, prev.dismissed);
    await upsertRow(client, companyId, 'voice_edit', {
      ...prev,
      form: learned.form,
      candidates: learned.candidates.filter((c) => !accepted.has(c.text)),
      updatedAt: new Date().toISOString(),
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** 후보 칩 받아들이기 · 지우기(사람 클릭 · 같은 행 잠금) */
export async function decidePhraseCandidate(companyId: string, id: string, action: 'accept' | 'dismiss', by: string | null): Promise<'ok' | 'not_found'> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT memory_value FROM ai_company_memory WHERE ${ROW('voice_edit')} FOR UPDATE`, [companyId]);
    const row = parseVoiceEdit(cur.rows[0]?.memory_value);
    const c = row.candidates.find((x) => x.id === id);
    if (!c) { await client.query('ROLLBACK'); return 'not_found'; }
    const at = new Date().toISOString();
    const next: VoiceEditRow = {
      ...row,
      candidates: row.candidates.filter((x) => x.id !== id),
      dismissed: action === 'dismiss' ? Array.from(new Set([...row.dismissed, id])) : row.dismissed,
      accepted_use: action === 'accept' && c.mode === 'use' ? [...row.accepted_use, { text: c.text, at, by }] : row.accepted_use,
      accepted_avoid: action === 'accept' && c.mode === 'avoid' ? [...row.accepted_avoid, { text: c.text, at, by }] : row.accepted_avoid,
    };
    await upsertRow(client, companyId, 'voice_edit', next);
    await client.query('COMMIT');
    return 'ok';
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** 받아들인 글귀 지우기(화면 칸에서) */
export async function removeAcceptedPhrase(companyId: string, mode: 'use' | 'avoid', text: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT memory_value FROM ai_company_memory WHERE ${ROW('voice_edit')} FOR UPDATE`, [companyId]);
    const row = parseVoiceEdit(cur.rows[0]?.memory_value);
    const key = mode === 'use' ? 'accepted_use' : 'accepted_avoid';
    await upsertRow(client, companyId, 'voice_edit', { ...row, [key]: row[key].filter((a) => a.text !== text), dismissed: Array.from(new Set([...row.dismissed, phraseId(mode, text)])) });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
