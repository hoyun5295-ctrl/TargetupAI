/**
 * dm-interaction.ts — DM 인터랙션 DB 로직 CT (제출/추첨/조회/집계/사전지정/경품)
 *
 * 순수 추첨 로직은 dm-interaction-core.ts(TDD). 여기서는 DB 입출력만 담당.
 * 신규 테이블(dm_prizes/dm_winners/dm_draw_runs) 미생성 시 PG 에러를 그대로 throw →
 * 라우트가 isDbMigrationPendingError로 503 변환(db_alter_safety_net).
 * 발송·돈 경로 무관(수집·추첨·조회만). 당첨 통보 발송은 F/G.
 */
import { query, pool } from '../../config/database';
import { getDmByCode, extractFlatSectionsFromDm } from './dm-builder';
import { lookupDmRecipientToken } from './dm-recipient-token';
import {
  pickRouletteSegment,
  drawWinners,
  type DrawEntry,
  type RankPrize,
  type DrawnWinner,
  type ParsedWinner,
} from './dm-interaction-core';

function nowIso(): string {
  return new Date().toISOString();
}

/** ?p=phone → customers 매칭(서버 권위). 클라가 보낸 customer_id는 신뢰하지 않음. */
export async function resolveCustomerIdByPhone(companyId: string, phone: string | null): Promise<string | null> {
  if (!phone) return null;
  const digits = String(phone).replace(/[^0-9]/g, '');
  if (!digits) return null;
  const r = await query(
    `SELECT id FROM customers WHERE company_id = $1 AND phone = $2 LIMIT 1`,
    [companyId, digits],
  );
  return r.rows[0]?.id || null;
}

// ────────────────── 참여 제출 ──────────────────

export type SubmitInput = {
  code: string;
  sectionId: string;
  sectionType: string;
  data: any;
  anonymousId: string | null;
  /** 발송 링크 수신자 토큰(?r=) — 서버 권위 고객 확정 1순위 (2026-07-02) */
  token?: string | null;
  phone: string | null;
  ip: string | null;
  ua: string | null;
};
export type SubmitResult = {
  ok: boolean;
  error?: string;
  status?: number;
  already?: boolean;
  result?: any;
};

/** 공개 제출 처리: 동의 검증 → 식별 → INSERT(1인1회) → 룰렛이면 즉시 추첨. */
export async function submitEventResponse(input: SubmitInput): Promise<SubmitResult> {
  const dm = await getDmByCode(input.code);
  if (!dm) return { ok: false, error: 'DM을 찾을 수 없습니다.', status: 404 };
  const companyId = dm.company_id;
  const campaignId = dm.id;

  const sections = extractFlatSectionsFromDm(dm);
  const section = sections.find((s: any) => s?.id === input.sectionId);
  const props: any = section?.props || {};

  // 동의 검증 — consent_required 명시 or lucky_draw(개인정보 수집)
  const consentRequired = props.consent_required === true || input.sectionType === 'lucky_draw';
  if (consentRequired && input.data?.consent !== true) {
    return { ok: false, error: '개인정보 수집·이용 동의가 필요합니다.', status: 400 };
  }

  // 식별 — 토큰(발송 링크, 서버 권위) > phone > anonymous_id
  let customerId: string | null = null;
  if (input.token) {
    try {
      const lookup = await lookupDmRecipientToken(input.token);
      if (lookup && lookup.dmId === campaignId && lookup.companyId === companyId) {
        customerId = lookup.customerId;
      }
    } catch {
      // 토큰 테이블 미마이그레이션 등 = phone 폴백
    }
  }
  if (!customerId) customerId = await resolveCustomerIdByPhone(companyId, input.phone);
  const anonymousId = input.anonymousId || null;
  const dedupeKey = customerId || anonymousId;

  const responseData: any = { ...(input.data || {}) };
  if (input.data?.consent === true) responseData.consent_at = nowIso();
  if (input.phone) responseData.phone = String(input.phone).replace(/[^0-9]/g, '');

  // 1인1회 부분 UNIQUE 충돌 시 INSERT 무시 → 기존 결과 반환
  const ins = await query(
    `INSERT INTO dm_event_responses
       (company_id, campaign_id, section_id, section_type, customer_id, anonymous_id, response_data, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (campaign_id, section_id, COALESCE(customer_id::text, anonymous_id))
       WHERE COALESCE(customer_id::text, anonymous_id) IS NOT NULL
       DO NOTHING
     RETURNING id`,
    [
      companyId, campaignId, input.sectionId, input.sectionType,
      customerId, anonymousId, JSON.stringify(responseData),
      input.ip, input.ua,
    ],
  );

  if (ins.rows.length === 0) {
    // 이미 참여 — 기존 응답
    const ex = await query(
      `SELECT id, response_data FROM dm_event_responses
       WHERE campaign_id = $1 AND section_id = $2 AND COALESCE(customer_id::text, anonymous_id) = $3
       ORDER BY occurred_at ASC LIMIT 1`,
      [campaignId, input.sectionId, dedupeKey],
    );
    if (input.sectionType === 'roulette') {
      return { ok: true, already: true, result: ex.rows[0]?.response_data?.spin_result || null };
    }
    return { ok: true, already: true };
  }

  const responseId: string = ins.rows[0].id;

  if (input.sectionType === 'roulette') {
    const result = await runRouletteDraw(companyId, campaignId, input.sectionId, responseId, props, customerId, input.phone, input.data);
    return { ok: true, result };
  }
  return { ok: true };
}

/** 룰렛 실시간 추첨 + 원자적 재고 차감 + 당첨자 기록. */
async function runRouletteDraw(
  companyId: string, campaignId: string, sectionId: string, responseId: string,
  props: any, customerId: string | null, phone: string | null, data: any,
): Promise<any> {
  const segments = Array.isArray(props.segments)
    ? props.segments.map((s: any) => ({ id: String(s.id), label: String(s.label || ''), probability: Number(s.probability) || 0 }))
    : [];

  const pr = await query(
    `SELECT id, roulette_segment_id, remaining FROM dm_prizes
     WHERE campaign_id = $1 AND section_id = $2 AND win_method = 'roulette'`,
    [campaignId, sectionId],
  );
  const prizeBySegment: Record<string, { prizeId: string; remaining: number }> = {};
  for (const row of pr.rows) {
    if (row.roulette_segment_id) {
      prizeBySegment[String(row.roulette_segment_id)] = { prizeId: row.id, remaining: row.remaining };
    }
  }

  let pick = pickRouletteSegment(segments, prizeBySegment, Math.random);

  if (pick.won && pick.prizeId) {
    const dec = await query(
      `UPDATE dm_prizes SET remaining = remaining - 1 WHERE id = $1 AND remaining > 0 RETURNING id, name`,
      [pick.prizeId],
    );
    if (dec.rows.length === 0) {
      // 동시성으로 소진 → 꽝 재판정
      pick = { ...pick, won: false, prizeId: null };
    } else {
      const prizeName = dec.rows[0].name;
      await query(
        `INSERT INTO dm_winners
           (company_id, campaign_id, section_id, prize_id, response_id, customer_id, rank, win_method, winner_name, winner_phone, is_member)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, 'roulette', $7, $8, $9)
         ON CONFLICT (response_id) WHERE response_id IS NOT NULL DO NOTHING`,
        [companyId, campaignId, sectionId, pick.prizeId, responseId, customerId, data?.name || null, phone ? String(phone).replace(/[^0-9]/g, '') : null, !!customerId],
      );
      const spin = { segment_id: pick.segmentId, label: pick.label, won: true, reward: prizeName };
      await query(`UPDATE dm_event_responses SET response_data = response_data || $2::jsonb WHERE id = $1`, [responseId, JSON.stringify({ spin_result: spin })]);
      return spin;
    }
  }

  const spin = { segment_id: pick.segmentId, label: pick.label, won: false };
  await query(`UPDATE dm_event_responses SET response_data = response_data || $2::jsonb WHERE id = $1`, [responseId, JSON.stringify({ spin_result: spin })]);
  return spin;
}

// ────────────────── 회사 조회·집계 ──────────────────

export async function getResponses(companyId: string, dmId: string, page = 1, limit = 50): Promise<{ rows: any[]; total: number; page: number; limit: number }> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const offset = (Math.max(1, page) - 1) * safeLimit;
  const rows = await query(
    `SELECT r.id, r.section_id, r.section_type, r.customer_id, r.anonymous_id, r.response_data, r.occurred_at,
            c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email
     FROM dm_event_responses r
     LEFT JOIN customers c ON c.id = r.customer_id
     WHERE r.company_id = $1 AND r.campaign_id = $2
     ORDER BY r.occurred_at DESC
     LIMIT $3 OFFSET $4`,
    [companyId, dmId, safeLimit, offset],
  );
  const total = await query(
    `SELECT COUNT(*)::int AS n FROM dm_event_responses WHERE company_id = $1 AND campaign_id = $2`,
    [companyId, dmId],
  );
  return { rows: rows.rows, total: total.rows[0].n, page: Math.max(1, page), limit: safeLimit };
}

export async function getWinners(companyId: string, dmId: string): Promise<any[]> {
  const r = await query(
    `SELECT w.id, w.rank, w.win_method, w.winner_name, w.winner_phone, w.winner_email,
            w.is_member, w.reward_code, w.notified_at, w.drawn_at, p.name AS prize_name
     FROM dm_winners w
     LEFT JOIN dm_prizes p ON p.id = w.prize_id
     WHERE w.company_id = $1 AND w.campaign_id = $2
     ORDER BY w.rank ASC NULLS LAST, w.drawn_at ASC`,
    [companyId, dmId],
  );
  return r.rows;
}

/** 응모·당첨·열람 집계 — 실데이터만(임의 상수 0). */
export async function getResponseStats(companyId: string, dmId: string): Promise<any> {
  const bySection = await query(
    `SELECT section_type,
            COUNT(*)::int AS responses,
            COUNT(*) FILTER (WHERE customer_id IS NOT NULL)::int AS members
     FROM dm_event_responses WHERE company_id = $1 AND campaign_id = $2
     GROUP BY section_type ORDER BY section_type`,
    [companyId, dmId],
  );
  const totals = await query(
    `SELECT COUNT(*)::int AS total_responses,
            COUNT(DISTINCT COALESCE(customer_id::text, anonymous_id))::int AS unique_participants
     FROM dm_event_responses WHERE company_id = $1 AND campaign_id = $2`,
    [companyId, dmId],
  );
  const views = await query(
    `SELECT COUNT(*)::int AS views, COALESCE(AVG(duration_seconds), 0)::int AS avg_duration
     FROM dm_views WHERE company_id = $1 AND dm_id = $2`,
    [companyId, dmId],
  );
  const winners = await query(
    `SELECT COUNT(*)::int AS n FROM dm_winners WHERE company_id = $1 AND campaign_id = $2`,
    [companyId, dmId],
  );
  return {
    by_section: bySection.rows,
    total_responses: totals.rows[0].total_responses,
    unique_participants: totals.rows[0].unique_participants,
    views: views.rows[0].views,
    avg_duration_seconds: views.rows[0].avg_duration,
    winners: winners.rows[0].n,
  };
}

/** 다운로드용 행 — 회원여부·참여시각·당첨여부·당첨등급. */
export function buildResponseExportRows(responses: any[], winners: any[]): any[] {
  const winByResponse = new Map<string, any>();
  for (const w of winners) {
    if (w.response_id) winByResponse.set(w.response_id, w);
  }
  return responses.map((r) => {
    const w = winByResponse.get(r.id);
    return {
      이름: r.customer_name || r.response_data?.name || '',
      전화: r.customer_phone || r.response_data?.phone || '',
      이메일: r.customer_email || r.response_data?.email || '',
      회원여부: r.customer_id ? '회원' : '비회원',
      참여섹션: r.section_type,
      참여시각: r.occurred_at,
      당첨여부: w || r.response_data?.spin_result?.won ? '당첨' : '',
      당첨등급: w?.rank ?? '',
    };
  });
}

// ────────────────── 사전 지정(엑셀) ──────────────────

export async function importPresetWinners(companyId: string, dmId: string, sectionId: string | null, parsed: ParsedWinner[]): Promise<{ inserted: number; linked: number }> {
  let inserted = 0;
  let linked = 0;
  for (const w of parsed) {
    const cust = await resolveCustomerIdByPhone(companyId, w.phone);
    let responseId: string | null = null;
    if (sectionId) {
      const rr = await query(
        `SELECT id FROM dm_event_responses
         WHERE company_id = $1 AND campaign_id = $2 AND section_id = $3
           AND (customer_id = $4 OR response_data->>'phone' = $5)
         ORDER BY occurred_at ASC LIMIT 1`,
        [companyId, dmId, sectionId, cust, w.phone],
      );
      responseId = rr.rows[0]?.id || null;
    }
    const r = await query(
      `INSERT INTO dm_winners
         (company_id, campaign_id, section_id, response_id, customer_id, rank, win_method, winner_name, winner_phone, winner_email, is_member)
       VALUES ($1, $2, $3, $4, $5, $6, 'preset', $7, $8, $9, $10)
       ON CONFLICT (response_id) WHERE response_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [companyId, dmId, sectionId || null, responseId, cust, w.rank, w.name, w.phone, w.email, !!cust],
    );
    if (r.rows.length > 0) {
      inserted++;
      if (responseId) linked++;
    }
  }
  return { inserted, linked };
}

// ────────────────── 경품 설정(A editor·발행 공용) ──────────────────

export type PrizeInput = {
  rank: number;
  name: string;
  total_count: number;
  win_method: string; // 'random' | 'roulette'
  roulette_segment_id?: string | null;
  reward_code_pool?: any;
};

export async function replacePrizesForSection(companyId: string, dmId: string, sectionId: string, prizes: PrizeInput[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM dm_prizes WHERE company_id = $1 AND campaign_id = $2 AND section_id = $3`, [companyId, dmId, sectionId]);
    for (const p of prizes) {
      await client.query(
        `INSERT INTO dm_prizes
           (company_id, campaign_id, section_id, rank, name, total_count, remaining, win_method, roulette_segment_id, reward_code_pool)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9)`,
        [companyId, dmId, sectionId, p.rank, p.name, p.total_count, p.win_method, p.roulette_segment_id || null, p.reward_code_pool ? JSON.stringify(p.reward_code_pool) : null],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

const INTERACTION_SECTION_TYPES = ['lucky_draw', 'roulette', 'poll', 'survey', 'email_capture', 'click_rewards'];

/** DM이 인터랙션 캠페인(참여 수집/추첨 섹션 보유)인지 — F 발행 단가 분기용. */
export async function isInteractionCampaign(companyId: string, dmId: string): Promise<boolean> {
  const r = await query(`SELECT sections, pages FROM dm_pages WHERE id = $1 AND company_id = $2`, [dmId, companyId]);
  const dm = r.rows[0];
  if (!dm) return false;
  const sections = extractFlatSectionsFromDm(dm);
  return sections.some((s: any) => s && INTERACTION_SECTION_TYPES.includes(s.type));
}

/** 발행 시 lucky_draw/roulette 섹션 props → dm_prizes 동기화. 이미 당첨자 있으면 보존(재고 리셋 방지). */
export async function syncPrizesFromSections(companyId: string, dmId: string): Promise<void> {
  const hasWinners = await query(`SELECT 1 FROM dm_winners WHERE campaign_id = $1 LIMIT 1`, [dmId]);
  if (hasWinners.rows.length > 0) return;
  const dmRows = await query(`SELECT id, sections, pages FROM dm_pages WHERE id = $1 AND company_id = $2`, [dmId, companyId]);
  const dm = dmRows.rows[0];
  if (!dm) return;
  const sections = extractFlatSectionsFromDm(dm);
  for (const sec of sections) {
    if (sec?.type === 'lucky_draw') {
      const prizes = Array.isArray(sec.props?.prizes) ? sec.props.prizes : [];
      const list: PrizeInput[] = prizes
        .filter((p: any) => p && p.name && Number(p.count) > 0)
        .map((p: any) => ({ rank: Number(p.rank) || 1, name: String(p.name), total_count: Number(p.count), win_method: 'random' }));
      await replacePrizesForSection(companyId, dmId, sec.id, list);
    } else if (sec?.type === 'roulette') {
      const segs = Array.isArray(sec.props?.segments) ? sec.props.segments : [];
      const list: PrizeInput[] = segs
        .filter((s: any) => s && Number(s.prize_count) > 0 && s.reward_description)
        .map((s: any, idx: number) => ({ rank: idx + 1, name: String(s.reward_description), total_count: Number(s.prize_count), win_method: 'roulette', roulette_segment_id: String(s.id) }));
      await replacePrizesForSection(companyId, dmId, sec.id, list);
    }
  }
}

// ────────────────── 마감 추첨 워커 전용 DB ──────────────────

export type DrawableCampaign = { campaignId: string; companyId: string; sectionId: string; drawAt: string };

/**
 * 발행 중이거나 중지된 lucky_draw + 아직 미추첨(dm_draw_runs 없음) 중 draw_at 도래 후보.
 *
 * ★ 2026-08-06 **중지분을 뺐다가 다시 넣었다**(Codex 적대검증 high). 중지는 "새 접속을 막는 것"이지
 *   "이미 받은 응모의 추첨을 취소하는 것"이 아니다. 그런데 중지의 대표 용도가 **행사 종료**라서,
 *   후보에서 빼면 마감 직전에 내린 행사의 당첨자가 조용히 선정되지 않는다 —
 *   응모는 이미 받아 두고 추첨만 사라지는 것이라 고객 약속을 어긴다.
 *   공개 상태와 추첨 생명주기는 다른 축이다. 추첨을 취소하는 기능이 필요하면 그건 별도 축으로 만든다.
 */
export async function loadDrawableLuckyDraws(): Promise<DrawableCampaign[]> {
  const r = await query(
    `SELECT id, company_id, sections, pages FROM dm_pages
     WHERE status IN ('published', 'stopped')
       AND (event_type = 'lucky_draw' OR sections::text LIKE '%"lucky_draw"%' OR pages::text LIKE '%"lucky_draw"%')
       AND NOT EXISTS (SELECT 1 FROM dm_draw_runs dr WHERE dr.campaign_id = dm_pages.id)`,
  );
  const out: DrawableCampaign[] = [];
  for (const dm of r.rows) {
    const sections = extractFlatSectionsFromDm(dm);
    const sec = sections.find((s: any) => s?.type === 'lucky_draw');
    const drawAt = sec?.props?.draw_at;
    if (!sec || !drawAt) continue;
    if (new Date(drawAt).getTime() > Date.now()) continue; // 아직 마감 전
    out.push({ campaignId: dm.id, companyId: dm.company_id, sectionId: sec.id, drawAt });
  }
  return out;
}

/** 원자적 claim — 0행이면 이미 다른 사이클이 추첨함(중복 추첨 차단). */
export async function claimDrawRun(campaignId: string, sectionId: string, seed: string): Promise<boolean> {
  const r = await query(
    `INSERT INTO dm_draw_runs (campaign_id, section_id, seed) VALUES ($1, $2, $3)
     ON CONFLICT (campaign_id) DO NOTHING RETURNING campaign_id`,
    [campaignId, sectionId, seed],
  );
  return r.rows.length > 0;
}

export async function loadDrawEntriesAndPrizes(companyId: string, campaignId: string, sectionId: string): Promise<{ entries: DrawEntry[]; prizes: RankPrize[] }> {
  const er = await query(
    `SELECT id, COALESCE(customer_id::text, anonymous_id) AS key FROM dm_event_responses
     WHERE company_id = $1 AND campaign_id = $2 AND section_id = $3 AND section_type = 'lucky_draw'`,
    [companyId, campaignId, sectionId],
  );
  const entries: DrawEntry[] = er.rows.filter((x: any) => x.key).map((x: any) => ({ responseId: x.id, key: x.key }));
  const pr = await query(
    `SELECT id, rank, total_count FROM dm_prizes
     WHERE company_id = $1 AND campaign_id = $2 AND section_id = $3 AND win_method = 'random'`,
    [companyId, campaignId, sectionId],
  );
  const prizes: RankPrize[] = pr.rows.map((p: any) => ({ prizeId: p.id, rank: p.rank, count: p.total_count }));
  return { entries, prizes };
}

export async function persistDrawWinners(companyId: string, campaignId: string, sectionId: string, winners: DrawnWinner[], entryCount: number): Promise<number> {
  let inserted = 0;
  for (const w of winners) {
    const rr = await query(`SELECT customer_id, response_data FROM dm_event_responses WHERE id = $1`, [w.responseId]);
    const row: any = rr.rows[0] || {};
    const rd: any = row.response_data || {};
    const r = await query(
      `INSERT INTO dm_winners
         (company_id, campaign_id, section_id, prize_id, response_id, customer_id, rank, win_method, winner_name, winner_phone, winner_email, is_member)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'random', $8, $9, $10, $11)
       ON CONFLICT (response_id) WHERE response_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [companyId, campaignId, sectionId, w.prizeId, w.responseId, row.customer_id || null, w.rank, rd.name || null, rd.phone || null, rd.email || null, !!row.customer_id],
    );
    if (r.rows.length > 0) inserted++;
  }
  await query(`UPDATE dm_draw_runs SET entry_count = $2, winner_count = $3 WHERE campaign_id = $1`, [campaignId, entryCount, inserted]);
  return inserted;
}

/** 마감 추첨 1건 처리(워커 호출). seed = campaignId:drawAt(결정적·감사). */
export async function runLuckyDrawForCampaign(c: DrawableCampaign): Promise<{ drawn: boolean; winners: number; entries: number }> {
  const seed = `${c.campaignId}:${c.drawAt}`;
  const claimed = await claimDrawRun(c.campaignId, c.sectionId, seed);
  if (!claimed) return { drawn: false, winners: 0, entries: 0 };
  const { entries, prizes } = await loadDrawEntriesAndPrizes(c.companyId, c.campaignId, c.sectionId);
  const winners = drawWinners(entries, prizes, seed);
  const inserted = await persistDrawWinners(c.companyId, c.campaignId, c.sectionId, winners, entries.length);
  return { drawn: true, winners: inserted, entries: entries.length };
}
