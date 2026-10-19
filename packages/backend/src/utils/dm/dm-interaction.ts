/**
 * dm-interaction.ts — DM 인터랙션 DB 로직 CT (제출/추첨/조회/집계/사전지정/경품)
 *
 * 순수 추첨 로직은 dm-interaction-core.ts(TDD). 여기서는 DB 입출력만 담당.
 * 신규 테이블(dm_prizes/dm_winners/dm_draw_runs) 미생성 시 PG 에러를 그대로 throw →
 * 라우트가 isDbMigrationPendingError로 503 변환(db_alter_safety_net).
 * 발송·돈 경로 무관(수집·추첨·조회만). 당첨 통보 발송은 F/G.
 */
import { query, pool, withTransaction } from '../../config/database';
import { getDmByCode, extractFlatSectionsFromDm } from './dm-builder';
import { PARTICIPATION_TYPES } from './dm-section-registry';
import { lookupDmRecipientToken } from './dm-recipient-token';
import {
  pickRouletteForParticipant,
  type RoulettePick,
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
  /** ★ 2026-10-19 B-1014-3② 테스트 발송 링크(?p=test) — 기록 · 재고 · 1인 1회에 닿지 않았다 */
  test?: boolean;
};

/** ★ 2026-10-19 B-1014-3② — 테스트 발송 링크 표식(routes/dm.ts test-send 가 ?p=test 로 만든다 · 열람 기록도 같은 표식으로 거른다) */
export const DM_TEST_LINK_MARKER = 'test';

/** 공개 제출 처리: 동의 검증 → 식별 → INSERT(1인1회) → 룰렛이면 즉시 추첨. */
export async function submitEventResponse(input: SubmitInput): Promise<SubmitResult> {
  const dm = await getDmByCode(input.code);
  if (!dm) return { ok: false, error: 'DM을 찾을 수 없습니다.', status: 404 };
  const companyId = dm.company_id;
  const campaignId = dm.id;

  const sections = extractFlatSectionsFromDm(dm);
  const section = sections.find((s: any) => s?.id === input.sectionId);
  // ★ 2026-10-19 B-1014-3⑥ — 블록 종류 = 서버가 가진 DM 의 그 블록(옛: 클라이언트가 보낸 section_type 을 믿고 기록 · 판정했다).
  //   참여 8종이 아니거나 블록이 없으면 받지 않는다.
  if (!section || !(PARTICIPATION_TYPES as readonly string[]).includes(String(section.type))) {
    return { ok: false, error: '참여할 블록을 찾을 수 없어요. 화면을 새로 고친 뒤 다시 시도해 주세요.', status: 404 };
  }
  const sectionType = String(section.type);
  const props: any = section.props || {};

  // 동의 검증 — 추첨(개인정보 수집)은 늘 · 이메일 수집은 명시 false 가 아니면(★ 1019 B-1014-3⑥ 미지정 = 강제 · 렌더가 같은 기준으로 data-consent 를 낸다) · 그 밖 = 명시 true
  const consentRequired = sectionType === 'lucky_draw'
    || (sectionType === 'email_capture' ? props.consent_required !== false : props.consent_required === true);
  if (consentRequired && input.data?.consent !== true) {
    return { ok: false, error: '개인정보 수집·이용 동의가 필요합니다.', status: 400 };
  }
  // ★ 2026-10-19 B-1014-3⑥ — 필수 = 서버도 본다(옛: 뷰어만 막았다)
  if (sectionType === 'survey') {
    const qs = Array.isArray(props.questions) ? props.questions : [];
    const missing = qs.some((q: any, qi: number) => q && q.required && !String(input.data?.[`q_${q.id || qi}`] ?? '').trim());
    if (missing) return { ok: false, error: '필수 질문에 답해주세요.', status: 400 };
  }
  if (sectionType === 'lucky_draw') {
    const fields = Array.isArray(props.form_fields) ? props.form_fields : [];
    const missing = fields.some((f: any) => f && f.required && f.name && !String(input.data?.[f.name] ?? '').trim());
    if (missing) return { ok: false, error: '필수 칸을 채워 주세요.', status: 400 };
  }
  // ★ 2026-10-19 B-1014-3⑥ — 즉시쿠폰 만료 = 서버가 본다(옛: 화면 표시만 · 만료 뒤에도 발급됐다)
  if (sectionType === 'instant_coupon' && props.expires_at) {
    const until = Date.parse(String(props.expires_at));
    if (Number.isFinite(until) && Date.now() > until) return { ok: false, error: '이미 끝난 쿠폰이에요.', status: 409 };
  }
  // ★ 2026-10-19 B-1014-3② — 테스트 발송 링크 = 판정만 하고 기록 · 재고 · 1인 1회에 닿지 않는다(옛: 직원 테스트가 실제 참여 · 재고를 썼다)
  if (input.phone === DM_TEST_LINK_MARKER && !input.token) {
    if (sectionType === 'roulette') {
      const segs = Array.isArray(props.segments) ? props.segments : [];
      const s = segs.length > 0 ? segs[Math.floor(Math.random() * segs.length)] : null;
      return { ok: true, test: true, result: s ? { segment_id: String(s.id), label: String(s.label || ''), won: false, test: true } : null };
    }
    return { ok: true, test: true };
  }

  // 식별 — 토큰(발송 링크, 서버 권위) > phone > anonymous_id
  let customerId: string | null = null;
  // ★ 2026-09-26 한줄로 V2 R1-27 — 발송 토큰으로 확인된 참여자인가(재고 경품 자격 · 전화번호 입력은 확인 수단이 아니다)
  let tokenVerified = false;
  if (input.token) {
    try {
      const lookup = await lookupDmRecipientToken(input.token);
      if (lookup && lookup.dmId === campaignId && lookup.companyId === companyId) {
        customerId = lookup.customerId;
        tokenVerified = true;
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

  // ★ 2026-10-19 B-1014-3⑥ 선착순 = 총 수량을 서버가 지킨다(같은 블록 잠금 안에서 센 뒤 넣는다 · 옛: 화면 표시만 · 수량 넘게 참여됐다)
  const totalQuantity = sectionType === 'limited_quantity' ? Math.max(0, Math.floor(Number(props.total_quantity) || 0)) : 0;

  // 1인1회 부분 UNIQUE 충돌 시 INSERT 무시 → 기존 결과 반환
  // ★ 2026-08-08 (0806 트랙 Codex 4R high) **추첨이 이미 실행된 lucky_draw는 응모를 받지 않는다 — 같은 문장 안에서.**
  //   stop·resume·A/B 시작·추첨 claim을 잇는 per-DM 잠금 공사 대신, 실제 피해("당첨될 수 없는 응모")가
  //   생기는 길목 하나를 막는다. 판정이 문장 밖이면 그 사이에 5분 워커가 claim해 같은 상태가 생긴다(TOCTOU).
  //   `draw_at`은 축이 아니다 — claim 전 응모는 추첨 모수에 들어가므로 막을 이유가 없다.
  //   가드 축은 별도 boolean 파라미터로 — 한 파라미터를 컬럼 대입과 비교 두 문맥에 쓰면 42P08 부류다.
  const insertSql = `INSERT INTO dm_event_responses
       (company_id, campaign_id, section_id, section_type, customer_id, anonymous_id, response_data, ip_address, user_agent)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
      WHERE $10::boolean = false
         OR NOT EXISTS (SELECT 1 FROM dm_draw_runs dr WHERE dr.campaign_id = $2::uuid)
     ON CONFLICT (campaign_id, section_id, COALESCE(customer_id::text, anonymous_id))
       WHERE COALESCE(customer_id::text, anonymous_id) IS NOT NULL
       DO NOTHING
     RETURNING id`;
  const insertParams = [
    companyId, campaignId, input.sectionId, sectionType,
    customerId, anonymousId, JSON.stringify(responseData),
    input.ip, input.ua,
    sectionType === 'lucky_draw',
  ];
  let soldOut = false;
  const ins = sectionType === 'limited_quantity'   // ★ G1 총 수량 0 = 마감(렌더 「남은 0개」와 같은 뜻 · 잘못된 값도 0)
    ? await withTransaction(async (run) => {
      await run(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`dm-lq:${campaignId}:${input.sectionId}`]);
      const cnt = await run(`SELECT COUNT(*)::int AS n FROM dm_event_responses WHERE campaign_id = $1 AND section_id = $2`, [campaignId, input.sectionId]);
      if (Number(cnt.rows[0]?.n || 0) >= totalQuantity) { soldOut = true; return { rows: [] as any[] }; }
      return run(insertSql, insertParams);
    })
    : await query(insertSql, insertParams);

  if (ins.rows.length === 0) {
    // 이미 참여 — 기존 응답
    const ex = await query(
      `SELECT id, response_data FROM dm_event_responses
       WHERE campaign_id = $1 AND section_id = $2 AND COALESCE(customer_id::text, anonymous_id) = $3
       ORDER BY occurred_at ASC LIMIT 1`,
      [campaignId, input.sectionId, dedupeKey],
    );
    if (ex.rows.length > 0) {
      if (sectionType === 'roulette') {
        return { ok: true, already: true, result: ex.rows[0]?.response_data?.spin_result || null };
      }
      return { ok: true, already: true };
    }
    if (soldOut) return { ok: false, status: 409, error: '선착순이 마감됐어요.' };
    // 기존 응답도 없는데 0행 = 위 추첨 마감 가드가 걸렀다. 추첨은 1회뿐이라 이 응모는 당첨될 수 없다 —
    // 받은 척하지 않고 사실대로 알린다(바뀐 것이 없으면 성공이라 답하지 않는다).
    return { ok: false, status: 409, error: '이미 추첨이 끝난 이벤트예요. 다음 행사를 기다려 주세요.' };
  }

  const responseId: string = ins.rows[0].id;

  if (sectionType === 'roulette') {
    const result = await runRouletteDraw(companyId, campaignId, input.sectionId, responseId, props, customerId, input.phone, input.data, tokenVerified);
    return { ok: true, result };
  }
  // ★ 2026-10-19 B-1014-3⑥ 클릭 리워드 = 목표 대비 참여 수를 서버가 센다(진행률 표시가 켜진 화면이 받아 그린다 · 옛: 목표 숫자만 보였다)
  if (sectionType === 'click_rewards' && Number(props.target_count) > 0) {
    const cnt = await query(`SELECT COUNT(*)::int AS n FROM dm_event_responses WHERE campaign_id = $1 AND section_id = $2`, [campaignId, input.sectionId]);
    return { ok: true, result: { progress: { joined: Number(cnt.rows[0]?.n || 0), target: Math.floor(Number(props.target_count)) } } };
  }
  return { ok: true };
}

/** 룰렛 실시간 추첨 + 원자적 재고 차감 + 당첨자 기록. */
async function runRouletteDraw(
  companyId: string, campaignId: string, sectionId: string, responseId: string,
  props: any, customerId: string | null, phone: string | null, data: any,
  /** ★ 2026-09-26 R1-27 — 발송 토큰으로 확인된 수신자만 재고 경품 대상 */
  stockEligible: boolean,
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

  const firstPick = pickRouletteForParticipant(segments, prizeBySegment, stockEligible, Math.random);
  if (firstPick.recipientsOnly) {
    const spin = { segment_id: '', label: '', won: false, recipients_only: true };
    await query(`UPDATE dm_event_responses SET response_data = response_data || $2::jsonb WHERE id = $1`, [responseId, JSON.stringify({ spin_result: spin })]);
    return spin;
  }
  let pick: RoulettePick = firstPick;

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
    // ★ 2026-09-27 한줄로 V2 R217 — 응답과 연결되지 않은 당첨자(response_id NULL)는 유니크 인덱스가 막지 못해
    //   같은 엑셀을 다시 올리면 또 들어갔다 → 같은 DM·섹션·번호의 사전 당첨자가 있으면 건너뛴다.
    const r = await query(
      `INSERT INTO dm_winners
         (company_id, campaign_id, section_id, response_id, customer_id, rank, win_method, winner_name, winner_phone, winner_email, is_member)
       SELECT $1, $2, $3, $4, $5, $6, 'preset', $7, $8, $9, $10
        WHERE NOT EXISTS (
          SELECT 1 FROM dm_winners
           WHERE company_id = $1 AND campaign_id = $2
             AND section_id IS NOT DISTINCT FROM $3 AND win_method = 'preset' AND winner_phone IS NOT DISTINCT FROM $8
        )
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

// ★ 2026-10-19 B-1014-3⑤ — 참여형 발행비 판정 = 참여 8종(registry PARTICIPATION_TYPES 하나 · 옛 손 목록 6종은 즉시쿠폰 · 선착순을 뺐다)
const INTERACTION_SECTION_TYPES: readonly string[] = PARTICIPATION_TYPES;

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
/** ★ 2026-09-27 R219 — 추첨 한 건을 한 트랜잭션에서 돌리려고 쿼리 실행기를 받는다(기본 = 풀) */
type DrawQuery = (sql: string, params?: any[]) => Promise<any>;

export async function claimDrawRun(campaignId: string, sectionId: string, seed: string, q: DrawQuery = query): Promise<boolean> {
  const r = await q(
    `INSERT INTO dm_draw_runs (campaign_id, section_id, seed) VALUES ($1, $2, $3)
     ON CONFLICT (campaign_id) DO NOTHING RETURNING campaign_id`,
    [campaignId, sectionId, seed],
  );
  return r.rows.length > 0;
}

export async function loadDrawEntriesAndPrizes(companyId: string, campaignId: string, sectionId: string, q: DrawQuery = query): Promise<{ entries: DrawEntry[]; prizes: RankPrize[] }> {
  const er = await q(
    `SELECT id, COALESCE(customer_id::text, anonymous_id) AS key FROM dm_event_responses
     WHERE company_id = $1 AND campaign_id = $2 AND section_id = $3 AND section_type = 'lucky_draw'`,
    [companyId, campaignId, sectionId],
  );
  const entries: DrawEntry[] = er.rows.filter((x: any) => x.key).map((x: any) => ({ responseId: x.id, key: x.key }));
  const pr = await q(
    `SELECT id, rank, total_count FROM dm_prizes
     WHERE company_id = $1 AND campaign_id = $2 AND section_id = $3 AND win_method = 'random'`,
    [companyId, campaignId, sectionId],
  );
  const prizes: RankPrize[] = pr.rows.map((p: any) => ({ prizeId: p.id, rank: p.rank, count: p.total_count }));
  return { entries, prizes };
}

export async function persistDrawWinners(companyId: string, campaignId: string, sectionId: string, winners: DrawnWinner[], entryCount: number, q: DrawQuery = query): Promise<number> {
  let inserted = 0;
  for (const w of winners) {
    const rr = await q(`SELECT customer_id, response_data FROM dm_event_responses WHERE id = $1`, [w.responseId]);
    const row: any = rr.rows[0] || {};
    const rd: any = row.response_data || {};
    const r = await q(
      `INSERT INTO dm_winners
         (company_id, campaign_id, section_id, prize_id, response_id, customer_id, rank, win_method, winner_name, winner_phone, winner_email, is_member)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'random', $8, $9, $10, $11)
       ON CONFLICT (response_id) WHERE response_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [companyId, campaignId, sectionId, w.prizeId, w.responseId, row.customer_id || null, w.rank, rd.name || null, rd.phone || null, rd.email || null, !!row.customer_id],
    );
    if (r.rows.length > 0) inserted++;
  }
  await q(`UPDATE dm_draw_runs SET entry_count = $2, winner_count = $3 WHERE campaign_id = $1`, [campaignId, entryCount, inserted]);
  return inserted;
}

/** 마감 추첨 1건 처리(워커 호출). seed = campaignId:drawAt(결정적·감사). */
export async function runLuckyDrawForCampaign(c: DrawableCampaign): Promise<{ drawn: boolean; winners: number; entries: number }> {
  const seed = `${c.campaignId}:${c.drawAt}`;
  // ★ 2026-09-27 한줄로 V2 R219 — 실행 권리 선점 · 참가자·경품 조회 · 당첨자 적재를 한 트랜잭션으로.
  //   옛: 권리를 먼저 커밋하고 적재를 트랜잭션 밖에서 해, 중간에 실패하면 권리만 남아 다시 돌지 않았다(추첨 누락).
  //   이제 실패 = 권리도 되돌아가 다음 주기에 다시 돈다. 동시 실행은 권리 행 유니크(ON CONFLICT)가 막는다.
  const client = await pool.connect();
  const q: DrawQuery = (sql, params) => client.query(sql, params);
  try {
    await client.query('BEGIN');
    const claimed = await claimDrawRun(c.campaignId, c.sectionId, seed, q);
    if (!claimed) { await client.query('ROLLBACK'); return { drawn: false, winners: 0, entries: 0 }; }
    const { entries, prizes } = await loadDrawEntriesAndPrizes(c.companyId, c.campaignId, c.sectionId, q);
    const winners = drawWinners(entries, prizes, seed);
    const inserted = await persistDrawWinners(c.companyId, c.campaignId, c.sectionId, winners, entries.length, q);
    await client.query('COMMIT');
    return { drawn: true, winners: inserted, entries: entries.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
