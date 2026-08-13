/**
 * planner-participation.ts — 마케팅 플래너 참여 동의 체인 (★ 2026-08-13 Phase 4 · 설계서 §5-5)
 *
 * 흐름: 사전 안내 이메일 [참여하기] → 공개 착지(토큰 검증) → **참여 실측을 cdp_events로 투영** →
 *       후속 터치포인트(알림톡 안내·행사 당일 문자)가 그 참여자만 대상으로 잡는다.
 *
 * ⛔ 이 파일의 핵심 판단 둘 (다시 뒤집지 말 것)
 *   ① **수신자 식별은 이메일 클릭 실측이 한다.** 이메일 섹션 렌더러는 https가 아닌 url을 '#'로 바꾸고
 *      CTA url은 수신자별 치환 대상이 아니다(라벨만 치환) — 즉 주소에 개인 토큰을 심을 방법이 없다.
 *      그런데 클릭은 이미 수신자별로 기록된다(email_events: campaign_id + email + url).
 *      그래서 링크는 **행사 단위**로 두고, 참여자는 그 클릭 행에서 확정한다.
 *   ② **참여자 세그먼트를 만들지 않는다.** saved_segments는 사용자당 20개 상한의 화면 자산이고
 *      filter_jsonb는 customers 컬럼 필터 언어라 "참여 이벤트 보유"를 표현할 수 없다.
 *      대상은 cdp_events를 읽는 동적 술어로 잡는다 — 명단을 굳히지 않는다(진실 복사 금지).
 *
 * 투영은 `message_click`과 같은 부류다(클릭 → cdp_events). 원본은 email_events에 그대로 남고,
 * 이 표에는 회사·고객·행사 축으로 멱등 적재만 한다.
 */
import crypto from 'crypto';
import { query } from '../config/database';

/** 참여 이벤트 이름 — 표준 목록 밖이라 'custom_' 접두사 규칙(cdp-events validateEventName)을 지킨다. */
export const PLANNER_JOIN_EVENT = 'custom_planner_join';
/**
 * 이벤트 source. ⛔ 'sdk'를 쓰지 않는다 — inapp-display-eligibility가 source='sdk'의 최근 이벤트로
 * SDK 설치를 판정하므로, 참여 클릭이 SDK 설치 판정을 열어버린다(영향표 실측 근거).
 */
export const PLANNER_JOIN_SOURCE = 'planner';

/**
 * 참여 토큰 서명 키 (★ 2026-08-13(2) 정정 — 기본값 폴백 제거).
 * ⛔ **코드에 적힌 기본 문자열로 서명하지 않는다.** 그 문자열을 아는 사람은 다른 회사·다른 행사의 참여 토큰을
 *   직접 만들 수 있고, 참여자 명단이 오염되면 참여자 대상 알림톡·문자가 엉뚱한 사람에게 나간다.
 *   키가 없으면 링크를 만들지 않고 제작 단계에서 사유와 함께 잠근다(기능 문서 §3-5 — 재료가 없으면 정직하게 잠근다).
 * ⛔ 설정 이름은 서버 로그에만 남긴다 — 담당자 화면 문구에 내부 설정 이름을 쓰지 않는다.
 */
function requireTokenSecret(): string {
  const secret = String(process.env.PLANNER_JOIN_TOKEN_SECRET || process.env.JOURNEY_PAUSE_TOKEN_SECRET || '').trim();
  if (!secret) {
    console.error('[planner-participation] PLANNER_JOIN_TOKEN_SECRET 미설정 — 참여 링크를 만들지 않는다');
    throw new Error('참여 링크 설정이 완료되지 않았습니다 — 관리자 확인이 필요합니다.');
  }
  return secret;
}

export interface JoinTokenPayload {
  c: string;   // companyId
  e: string;   // planner_events.id
  exp: number; // unix ms
}

/** 참여 링크 토큰 — 무상태 HMAC(폐기·1회성이 필요 없다: 참여는 멱등 적재다). */
export function buildJoinToken(companyId: string, eventId: string, expiresAt: Date): string {
  const payload: JoinTokenPayload = { c: companyId, e: eventId, exp: expiresAt.getTime() };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', requireTokenSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyJoinToken(token: string): JoinTokenPayload | null {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  // ⛔ 키가 없으면 던지지 않고 무효로 답한다 — 착지 라우트는 고객이 브라우저로 도착하는 자리라
  //   500이 아니라 안내 화면이 맞다(검증 실패와 같은 취급).
  let secret: string;
  try {
    secret = requireTokenSecret();
  } catch {
    return null;
  }
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JoinTokenPayload;
    if (!payload?.c || !payload?.e || !(payload.exp > Date.now())) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 참여 링크 절대 주소 — 이메일 소재의 [참여하기] 버튼이 이 주소를 문다. */
export function buildJoinUrl(token: string): string {
  const base = String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');
  return `${base}/api/marketing-planner/participate/${token}`;
}

/** 링크 유효기간 = 행사 종료일 + 7일(안내를 늦게 열어본 고객도 접수된다). */
export function joinTokenExpiry(endsOn: string): Date {
  const d = new Date(`${endsOn}T23:59:59+09:00`);
  const base = Number.isNaN(d.getTime()) ? new Date() : d;
  return new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000);
}

/**
 * (순수) 참여자 대상 술어 — customers 알리아스 c 기준. params에 행사 id를 push하고 조각을 돌려준다.
 * 호출부(planner-audience)가 filterWhere에 이어 붙인다 — WHERE 조립 CT는 하나뿐이라는 계약 유지.
 */
export function buildParticipantPredicate(params: any[], plannerEventId: string): string {
  params.push(plannerEventId);
  const idx = params.length;
  return `AND EXISTS (
            SELECT 1 FROM cdp_events pj
             WHERE pj.company_id = $1
               AND pj.customer_id = c.id
               AND pj.event_name = '${PLANNER_JOIN_EVENT}'
               AND pj.properties->>'planner_event_id' = $${idx}
          )`;
}

/** 그 행사 참여자 수 — 실쿼리(추정 금지). */
export async function countPlannerParticipants(companyId: string, plannerEventId: string): Promise<number> {
  const r = await query(
    `SELECT COUNT(DISTINCT customer_id)::int AS cnt
       FROM cdp_events
      WHERE company_id = $1::uuid AND event_name = $2
        AND properties->>'planner_event_id' = $3
        AND customer_id IS NOT NULL`,
    [companyId, PLANNER_JOIN_EVENT, plannerEventId],
  );
  return Number(r.rows[0]?.cnt) || 0;
}

/**
 * 참여 클릭 → cdp_events 투영. 이메일 캠페인 1건 단위로 돈다(터치포인트가 그 캠페인을 안다).
 *
 * 멱등 = (회사·고객·행사) 조합 1건. 같은 사람이 세 번 눌러도 참여는 한 번이다.
 * ⛔ customers.email로 사람을 잇는다 — 회사 격리를 조인 조건에 직접 건다(다른 회사 같은 주소가 섞이지 않게).
 */
export async function ingestJoinClicksForCampaign(input: {
  companyId: string;
  emailCampaignId: string;
  plannerEventId: string;
  touchpointId: string;
}): Promise<{ inserted: number }> {
  const clicks = await query(
    `SELECT DISTINCT c.id AS customer_id, MIN(ee.occurred_at) AS first_click
       FROM email_events ee
       JOIN customers c ON lower(c.email) = lower(ee.email) AND c.company_id = $1::uuid
      WHERE ee.campaign_id = $2::uuid
        AND ee.event_type = 'click'
        AND ee.url LIKE '%/marketing-planner/participate/%'
      GROUP BY c.id`,
    [input.companyId, input.emailCampaignId],
  );
  let inserted = 0;
  for (const row of clicks.rows as any[]) {
    const res = await query(
      `INSERT INTO cdp_events (id, company_id, customer_id, event_name, properties, source, occurred_at, created_at)
       SELECT gen_random_uuid(), $1::uuid, $2::uuid, $3, $4::jsonb, $5, $6, NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM cdp_events
           WHERE company_id = $1::uuid AND customer_id = $2::uuid AND event_name = $3
             AND properties->>'planner_event_id' = $7
        )
       RETURNING id`,
      [
        input.companyId,
        row.customer_id,
        PLANNER_JOIN_EVENT,
        JSON.stringify({
          planner_event_id: input.plannerEventId,
          touchpoint_id: input.touchpointId,
          email_campaign_id: input.emailCampaignId,
        }),
        PLANNER_JOIN_SOURCE,
        row.first_click || new Date(),
        input.plannerEventId,
      ],
    );
    if (res.rows.length > 0) inserted++;
  }
  return { inserted };
}

/**
 * 참여 착지 화면 — 문자·이메일 링크를 눌러 브라우저로 도착한 **고객**이 보는 페이지다.
 * JSON을 보여줄 자리가 아니고, 로그인도 요구할 수 없다(고객은 우리 사용자가 아니다).
 * 화면 문구에 내부 용어·모델명을 쓰지 않는다.
 */
export function renderJoinLandingHtml(input: { ok: boolean; eventTitle?: string | null }): string {
  const title = input.ok ? '참여 신청이 접수되었습니다' : '링크가 만료되었습니다';
  const desc = input.ok
    ? `${input.eventTitle ? `'${escapeHtml(input.eventTitle)}' ` : ''}행사 참여 신청이 접수되었습니다. 자세한 안내는 등록된 연락처로 보내드립니다.`
    : '이 참여 링크는 유효 기간이 지났습니다. 안내 메시지를 다시 확인해 주세요.';
  const note = input.ok
    ? '참여 신청은 광고 수신동의와 별개이며, 신청하신 행사 안내에만 사용됩니다.'
    : '';
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0b0f17; color:#e5e7eb; font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif; padding:24px; }
  .card { width:100%; max-width:420px; background:#131a26; border:1px solid #1f2937; border-radius:18px; padding:32px 26px; text-align:center; }
  .mark { width:56px; height:56px; margin:0 auto 18px; border-radius:50%; display:flex; align-items:center; justify-content:center;
          background:${input.ok ? 'rgba(16,185,129,.14)' : 'rgba(148,163,184,.14)'}; color:${input.ok ? '#34d399' : '#94a3b8'}; font-size:26px; }
  h1 { margin:0 0 10px; font-size:19px; letter-spacing:-0.02em; }
  p { margin:0; font-size:14px; line-height:1.7; color:#9ca3af; }
  .note { margin-top:20px; padding-top:16px; border-top:1px solid #1f2937; font-size:12px; color:#6b7280; }
</style></head>
<body><div class="card">
  <div class="mark">${input.ok ? '&#10003;' : '&#9888;'}</div>
  <h1>${title}</h1>
  <p>${desc}</p>
  ${note ? `<div class="note">${note}</div>` : ''}
</div></body></html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
