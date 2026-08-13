/**
 * ★ CT-36: Email 채널 컨트롤타워 — D215+ 전면 재작성 (2026-05-25)
 *
 * 🎯 목적
 *   회사 admin 본인 SMTP relay 활용 Email 캠페인 — campaign 신설 + send + event 트래킹.
 *   D215+ 정정: 옛 SendGrid 한줄로 마스터 흐름 영구 폐기 → CT-85 company-smtp-client 회사별 SMTP relay 활용.
 *
 * 📋 DB 테이블
 *   - email_campaigns: 캠페인 메타 (회사/제목/HTML/발송일자/상태/통계)
 *   - email_events: open/click/bounce/unsubscribe 이벤트 누적
 *
 * ⛔ 영구 원칙
 *   - 발송 시점 안전장치 — 회사 SMTP 미설정 시 차단 + 예약은 미래 1분+ / 즉시 confirm
 *     (야간 시간 제한 없음 — 전자우편은 정보통신망법 §50③ 단서 + 시행령 §61조의2 야간 광고 예외 매체)
 *   - Zero-Count #2 — recipients 0건 시 발송 차단
 *   - 정보통신망법 §50④ — (광고) prefix + 전송자 명칭·연락처 + 수신거부 링크 자동 부착 (광고성 이메일)
 *     수신거부 링크 존재 판정 = 실제 링크(마커/개인 토큰 URL)로만 — 본문 단어('수신거부') 존재로 생략 금지
 *   - 사용자 신뢰 #4 — 모델명 노출 X / 발송 결과 투명 표시
 *   - 발신 도메인 = 회사 admin 본인 도메인 (한줄로 도메인 사용 X — SaaS 핵심)
 */

import { query } from '../config/database';
import { sendEmail, isSmtpConfigured, getSmtpConfigPublic } from './company-smtp-client';
import { applyTracking, buildUnsubscribeUrl, UNSUB_URL_MARKER } from './email-tracking';
import { logCampaignTraining, updateTrainingMetrics, getSourceRef } from './training-logger';
import { buildEmailTrainingMessage } from './email-training-message';
import { renderEmailSections, EMAIL_FOOTER_SLOT } from './email/email-section-renderer';
import { resolveEmailSectionsForCustomer, renderEmailText } from './email/email-personalization';
import type { EmailDesign } from './email/email-tokens';
import { getCompanyBrandKit } from './dm/dm-brand-kit';
import { buildCustomerFilter } from './customer-filter';
import { hasUneditedPlaceholder } from './email-ai';
// ★ 2026-07-02 개인화 변수 동적화 — CT-58 회사 실측 프로필(채워진 필드만 노출)
import { getCompanyDataProfile } from './company-data-profile';
import type { Section } from './dm/dm-section-registry';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type EmailCampaignStatus = 'draft' | 'scheduled' | 'sending' | 'completed' | 'failed';

/** 예약 발송 대상 명세 — scheduled 캠페인의 발송 시점 수신자 해석 기준 (email-send-sweeper 소비) */
export type EmailTargetSpec =
  | { type: 'customers'; grades?: string[] }
  | { type: 'list'; recipients: Array<{ email: string; name?: string }> }
  | { type: 'filter'; filter: Record<string, { operator: string; value: any }> };

export interface EmailCampaign {
  id: string;
  companyId: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string | null;
  hasPlaceholder: boolean;  // AI 미입력 자리([…직접/입력해/작성해…]) 잔존 여부 — 목록 배지·발송 전 인지
  fromName: string;
  fromEmail: string;
  isAd: boolean;
  aiGenerated: boolean;
  targetSpec: EmailTargetSpec | null;
  scheduledAt: Date | null;
  sentAt: Date | null;
  status: EmailCampaignStatus;
  sentCount: number;
  openCount: number;
  clickCount: number;
  bounceCount: number;
  unsubscribeCount: number;
  sections: unknown[] | null; // 비주얼 빌더 Section[] (null = manual HTML)
  design: EmailDesign | null; // ★ 2026-07-13 캠페인 단위 디자인(테마·아트디렉션·서체·프리헤더) — 신규 ALTER 컬럼
  parentCampaignId: string | null; // 재발송 자식이면 원본 campaign id (null = 원본)
  resendGeneration: number;        // 원본=0, 재발송본=1 — 재발송 1회 한도 판정
  createdBy: string | null;
  createdAt: Date;
}

export interface CreateCampaignInput {
  companyId: string;
  createdBy: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  fromName?: string;
  fromEmail?: string;
  isAd?: boolean;
  aiGenerated?: boolean;
  sections?: unknown[] | null; // 비주얼 빌더 Section[] — 있으면 html_body는 렌더 산출물
  design?: EmailDesign | null; // ★ 2026-07-13 캠페인 단위 디자인 — 신규 ALTER 컬럼(미실행 시 throw → route 503)
  scheduledAt?: Date;
}

export interface EmailRecipient { email: string; name?: string; substitutions?: Record<string, string>; customer?: Record<string, any> }

export interface SendCampaignInput {
  campaignId: string;
  recipients: EmailRecipient[];
  immediate?: boolean;
}

// ════════════════════════════════════════════════════════════════════
// Campaign CRUD
// ════════════════════════════════════════════════════════════════════

// ★ 2026-07-13 (Codex 지적 정정) — design 쓰기는 INSERT/UPDATE "이전"에 컬럼 실재를 확인한다.
//   후행 UPDATE가 컬럼 부재로 죽으면 캠페인 행만 생기거나(재시도 중복) 렌더된 html_body만 남고
//   테마가 유실되는 부분 상태가 된다 → 선확인으로 아무것도 안 쓰고 503(부분 상태 0).
//   캐시는 dm-brand-kit ensureColumn 패턴 미러(ALTER→reload 배포 순서 전제, 조회 오류는 미캐시 재시도).
let designColumnExists: boolean | null = null;
async function ensureDesignColumnOrThrow(): Promise<void> {
  // 양성만 캐시 — 음성 캐시는 ALTER 적용 후에도 재기동 전까지 503을 고정시킨다(자가 치유 불가, Codex 4R).
  //   ALTER 전 창에서만 design 쓰기당 1회 조회가 추가될 뿐이라 부하 무시 가능.
  if (designColumnExists !== true) {
    const res = await query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'email_campaigns' AND column_name = 'design'`,
    );
    if (res.rows.length === 0) {
      // 'column' + 'does not exist' 포함 — route handleDbMigrationError가 503 DB_MIGRATION_PENDING으로 변환
      throw new Error('email_campaigns.design column does not exist — ALTER 실행 필요');
    }
    designColumnExists = true;
  }
}

/**
 * 신규 캠페인 생성 — fromEmail/fromName 기본값 = 회사 SMTP 설정 안 from_email/from_name 활용.
 */
export async function createEmailCampaign(input: CreateCampaignInput): Promise<EmailCampaign> {
  // ★ 2026-07-13 — design 동봉 생성은 INSERT 전에 컬럼 확인(부분 생성 차단 — Codex 지적)
  if (input.design && typeof input.design === 'object') await ensureDesignColumnOrThrow();
  // ★ 2026-07-14 (Codex 5R) — 후행 쓰기(sections/design/ai_generated)가 있는 예약 생성은 INSERT를 draft로
  //   시작하고 전 쓰기 성공 후에만 'scheduled'로 승격 — "scheduled 표시 = 콘텐츠 쓰기 완료" 불변식
  //   (후행 쓰기 실패 시 scheduled 행 잔존 → 스위퍼 오발송 클래스 구조 차단, 6원칙 ② 정신).
  const hasFollowUps = !!input.aiGenerated
    || (Array.isArray(input.sections) && input.sections.length > 0)
    || !!(input.design && typeof input.design === 'object');
  const deferSchedule = !!input.scheduledAt && hasFollowUps;
  // 회사 SMTP 설정 안 from_email/from_name 기본값 사용
  const smtpConfig = await getSmtpConfigPublic(input.companyId);
  const defaultFromEmail = input.fromEmail || smtpConfig?.fromEmail || '';
  const defaultFromName = input.fromName || smtpConfig?.fromName || '한줄로AI';

  if (!defaultFromEmail) {
    throw new Error('fromEmail 필수 — 회사 admin SMTP 설정 안 from_email 등록 후 진입 의무');
  }

  const result = await query(
    `INSERT INTO email_campaigns (
      id, company_id, created_by, name, subject, html_body, text_body,
      from_name, from_email, is_ad, scheduled_at, status,
      sent_count, open_count, click_count, bounce_count, unsubscribe_count,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      0, 0, 0, 0, 0,
      NOW(), NOW()
    ) RETURNING *`,
    [
      input.companyId,
      input.createdBy,
      input.name.slice(0, 200),
      input.subject.slice(0, 200),
      input.htmlBody,
      input.textBody || null,
      defaultFromName.slice(0, 100),
      defaultFromEmail,
      !!input.isAd,
      input.scheduledAt || null,
      input.scheduledAt && !deferSchedule ? 'scheduled' : 'draft',
    ]
  );
  const campaign = mapRow(result.rows[0]);

  // ai_generated 마킹은 신규 컬럼(별도 ALTER) 참조 — 기존 INSERT 경로 무손상 위해 분리.
  // 컬럼 미존재(ALTER 전) 시 throw → 호출 route의 503 분기가 처리 (db_alter_safety_net).
  if (input.aiGenerated) {
    await query(`UPDATE email_campaigns SET ai_generated = true WHERE id = $1::uuid`, [campaign.id]);
    campaign.aiGenerated = true;
  }
  // 비주얼 빌더 sections + design — 신규 ALTER 컬럼이라 메인 INSERT 밖 별도 저장(기존 raw HTML 흐름 보존).
  //   ★ 2026-07-13 (Codex 2R) — 둘 다 있으면 단문 결합(부분 상태 창 최소화). design 컬럼 실재는
  //   함수 초입 ensureDesignColumnOrThrow가 선확인 — 여기 도달 = 컬럼 존재.
  //   잔여: INSERT↔이 UPDATE 사이 일시 DB 오류 시 테마 없는 draft 행 1개 가능 — 기존 sections/ai_generated와
  //   동일 클래스(무과금 draft — 사용자가 목록에서 재편집), 트랜잭션 도입은 별도 과제.
  const wantSections = Array.isArray(input.sections) && input.sections.length > 0;
  const wantDesign = !!(input.design && typeof input.design === 'object');
  if (wantSections && wantDesign) {
    await query(
      `UPDATE email_campaigns SET sections = $1::jsonb, design = $2::jsonb WHERE id = $3::uuid`,
      [JSON.stringify(input.sections), JSON.stringify(input.design), campaign.id],
    );
    campaign.sections = input.sections!;
    campaign.design = input.design!;
  } else if (wantSections) {
    await query(`UPDATE email_campaigns SET sections = $1::jsonb WHERE id = $2::uuid`, [JSON.stringify(input.sections), campaign.id]);
    campaign.sections = input.sections!;
  } else if (wantDesign) {
    await query(`UPDATE email_campaigns SET design = $1::jsonb WHERE id = $2::uuid`, [JSON.stringify(input.design), campaign.id]);
    campaign.design = input.design!;
  }
  // ★ 2026-07-14 (Codex 5R) — 전 후행 쓰기 성공 후에만 scheduled 승격(위 deferSchedule 주석 참조).
  if (deferSchedule) {
    await query(`UPDATE email_campaigns SET status = 'scheduled', updated_at = NOW() WHERE id = $1::uuid`, [campaign.id]);
    campaign.status = 'scheduled';
  }
  return campaign;
}

export async function listEmailCampaigns(companyId: string, limit: number = 50, ownerId?: string | null): Promise<EmailCampaign[]> {
  const ownerClause = ownerId ? ' AND created_by = $3::uuid' : '';
  const params: any[] = [companyId, Math.min(limit, 200)];
  if (ownerId) params.push(ownerId);
  const result = await query(
    `SELECT * FROM email_campaigns WHERE company_id = $1::uuid${ownerClause}
     ORDER BY created_at DESC LIMIT $2`,
    params
  );
  return result.rows.map(mapRow);
}

export async function getEmailCampaign(companyId: string, campaignId: string, ownerId?: string | null): Promise<EmailCampaign | null> {
  const ownerClause = ownerId ? ' AND created_by = $3::uuid' : '';
  const params: any[] = [campaignId, companyId];
  if (ownerId) params.push(ownerId);
  const result = await query(
    `SELECT * FROM email_campaigns WHERE id = $1::uuid AND company_id = $2::uuid${ownerClause}`,
    params
  );
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
}

export async function updateEmailCampaign(
  companyId: string,
  campaignId: string,
  patch: Partial<CreateCampaignInput>,
  ownerId?: string | null,
): Promise<EmailCampaign | null> {
  // 데이터 격리 — 담당자(ownerId 지정)는 본인 생성분만 수정. 아니면 null(라우트 404).
  if (ownerId) {
    const own = await query(
      `SELECT 1 FROM email_campaigns WHERE id = $1::uuid AND company_id = $2::uuid AND created_by = $3::uuid`,
      [campaignId, companyId, ownerId],
    );
    if (own.rows.length === 0) return null;
  }
  // ★ 2026-07-13 (Codex 2R) — design 동봉 수정은 컬럼 선확인 후 "메인 UPDATE 단문에 동승"
  //   (html_body·sections만 저장되고 테마가 유실되는 부분 갱신 자체가 불가능한 구조).
  //   design 미동봉 patch는 design 컬럼을 참조하지 않아 컬럼 부재(ALTER 전)여도 정상 동작.
  const hasDesign = patch.design !== undefined;
  if (hasDesign) await ensureDesignColumnOrThrow();
  const result = await query(
    `UPDATE email_campaigns SET
       name = COALESCE($3, name),
       subject = COALESCE($4, subject),
       html_body = COALESCE($5, html_body),
       text_body = COALESCE($6, text_body),
       from_name = COALESCE($7, from_name),
       from_email = COALESCE($8, from_email),
       is_ad = COALESCE($9, is_ad),
       scheduled_at = COALESCE($10, scheduled_at),
       sections = COALESCE($11::jsonb, sections),
       ${hasDesign ? 'design = $12::jsonb,' : ''}
       updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid
     RETURNING *`,
    [
      campaignId,
      companyId,
      patch.name ?? null,
      patch.subject ?? null,
      patch.htmlBody ?? null,
      patch.textBody ?? null,
      patch.fromName ?? null,
      patch.fromEmail ?? null,
      patch.isAd === undefined ? null : patch.isAd,
      patch.scheduledAt ?? null,
      Array.isArray(patch.sections) && patch.sections.length > 0 ? JSON.stringify(patch.sections) : null,
      // design: null = 명시 초기화(기본 룩 복귀) — jsonb null 저장
      ...(hasDesign ? [patch.design ? JSON.stringify(patch.design) : null] : []),
    ]
  );
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
}

export async function deleteEmailCampaign(companyId: string, campaignId: string, ownerId?: string | null): Promise<boolean> {
  const ownerClause = ownerId ? ' AND created_by = $3::uuid' : '';
  const params: any[] = [campaignId, companyId];
  if (ownerId) params.push(ownerId);
  const result = await query(
    `DELETE FROM email_campaigns WHERE id = $1::uuid AND company_id = $2::uuid${ownerClause} RETURNING id`,
    params
  );
  return result.rows.length > 0;
}

// ════════════════════════════════════════════════════════════════════
// 발송 — 회사 SMTP relay 활용 (CT-85 sendEmail 호출)
// ════════════════════════════════════════════════════════════════════

/**
 * 캠페인 발송 — 회사 admin SMTP relay 활용. 옛 SendGrid 흐름 영구 폐기.
 * 흐름:
 *   1. 회사 SMTP 설정 완료 검증 (미완료 시 차단)
 *   2. recipients 0건 검증 (Zero-Count 영구 룰)
 *   3. status = 'sending' 갱신
 *   4. 광고성 prefix + 무료거부 자동 합성 (is_ad = true 시)
 *   5. recipients batch 100건 단위 — 회사 SMTP 한도 보호 (Google Workspace 2,000건/일 등 회사별 한도 다양)
 *   6. 발송 완료 후 status = 'completed' 갱신
 *   7. 발송 실패 시 status = 'failed' 갱신 + 에러 throw
 */
export async function sendEmailCampaign(input: SendCampaignInput): Promise<{ messageId: string; sentCount: number }> {
  // 캠페인 조회
  const campaignRes = await query(
    `SELECT * FROM email_campaigns WHERE id = $1::uuid`,
    [input.campaignId]
  );
  if (campaignRes.rows.length === 0) {
    throw new Error('캠페인을 찾을 수 없습니다.');
  }
  const campaign = mapRow(campaignRes.rows[0]);

  // 회사 SMTP 설정 검증
  const smtpReady = await isSmtpConfigured(campaign.companyId);
  if (!smtpReady) {
    throw new Error('회사 SMTP 설정 미완료 — 회사 admin이 SMTP 정보 등록 후 발송 진입 의무');
  }

  // ★ 2026-07-12 발송 엔진 단일 길목 placeholder 가드 (Codex HIGH 정정) —
  //   라우트/스위퍼 개별 검사만으론 엔진 직접 호출 경로(재발송 자식·subjectOverride)가 빠진다.
  //   미입력 자리 잔존 = 어떤 경로로도 발송 불가(AI 임의 혜택 영구 룰의 마지막 방어선).
  if (hasUneditedPlaceholder(campaign.subject, campaign.htmlBody, campaign.textBody)) {
    await query(
      `UPDATE email_campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1::uuid`,
      [campaign.id],
    );
    throw new Error('직접 입력이 필요한 자리가 남아 있어 발송할 수 없습니다. 편집에서 채운 뒤 다시 발송해주세요.');
  }

  // Zero-Count 영구 원칙
  if (input.recipients.length === 0) {
    throw new Error('수신자 0건 — Zero-Count 영구 원칙 발송 차단.');
  }

  // ★ 2026-07-12 재시도 멱등 (Codex MEDIUM 정정) — 부분 실패 후 같은 캠페인을 다시 발송할 때
  //   이미 delivered 기록된 수신자는 스킵(중복 발송 차단). 첫 발송은 delivered 0건이라 무영향.
  //   totalAccepted를 과거 발송분에서 시작해 sent_count 누적이 재시도에도 정확하게 유지된다.
  let alreadyDelivered = new Set<string>();
  try {
    const dRes = await query(
      `SELECT DISTINCT lower(email) AS email FROM email_events WHERE campaign_id = $1::uuid AND event_type = 'delivered'`,
      [campaign.id],
    );
    alreadyDelivered = new Set<string>(dRes.rows.map((r: any) => String(r.email)));
  } catch { /* 조회 실패 = 스킵 없이 기존 동작(발송 우선) */ }
  const sendTargets = alreadyDelivered.size > 0
    ? input.recipients.filter((r) => !alreadyDelivered.has(r.email.toLowerCase()))
    : input.recipients;
  if (alreadyDelivered.size > 0) {
    console.log(`[Email] 재시도 멱등 — 기발송(delivered) ${input.recipients.length - sendTargets.length}건 스킵 (campaign ${campaign.id})`);
  }

  // 발송 직전 status 갱신
  await query(
    `UPDATE email_campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1::uuid`,
    [campaign.id]
  );

  // 섹션 캠페인이면 수신자별로 Section[]을 렌더(변수 치환 + 조건부 표시). 섹션 없으면 기존 html_body 경로(무회귀).
  const campaignSections = Array.isArray(campaign.sections) ? (campaign.sections as Section[]) : [];
  const hasSections = campaignSections.length > 0;
  const brandKit = hasSections ? await getCompanyBrandKit(campaign.companyId) : null;
  // 정보통신망법 §50④ — 전송자 명칭 + 연락처(발신 이메일) + 수신거부 방법 명시
  const adFooter = `\n\n<hr><p style="font-size:11px;color:#999;text-align:center">본 메일은 ${campaign.fromName}(${campaign.fromEmail})의 광고 정보입니다. 수신을 원하지 않으시면 <a href="${UNSUB_URL_MARKER}">수신거부</a>를 눌러주세요.</p>`;
  // 수신거부 링크 실존 판정 — 마커 또는 개인 토큰 URL이 실제로 있어야 생략.
  // 본문에 '수신거부' 단어만 있는 경우(링크 없는 안내 문구)에 footer가 빠지면 수신거부 수단 0 = 법 위반.
  const hasUnsubLink = (html: string): boolean => html.includes(UNSUB_URL_MARKER) || html.includes('/api/email/u/');
  // ★ 2026-07-13 디자인 3.0 — 렌더러가 완전한 문서(</html>)를 내므로 footer는 EMAIL_FOOTER_SLOT(</body> 앞) 치환.
  //   슬롯 없는 HTML(수동 작성·과거 저장분) = 기존 말미 append 폴백(무회귀). footer 불요 시 슬롯만 제거.
  const injectFooter = (html: string, footer: string): string =>
    html.includes(EMAIL_FOOTER_SLOT) ? html.split(EMAIL_FOOTER_SLOT).join(footer) : (footer ? html + footer : html);

  // 광고성 prefix + 무료거부 자동 합성 — 수신거부는 마커로 두고 발송 시 수신자별 개인 토큰 URL로 치환(applyTracking)
  let finalSubject = campaign.subject;
  let finalHtml = campaign.htmlBody;
  if (campaign.isAd) {
    if (!/^\s*[(（]\s*광고\s*[)）]/.test(finalSubject)) finalSubject = `(광고) ${finalSubject}`; // 반각·전각 중복 방지
    finalHtml = injectFooter(finalHtml, hasUnsubLink(finalHtml) ? '' : adFooter);
  } else {
    finalHtml = injectFooter(finalHtml, '');
  }

  let lastMessageId = '';
  let totalAccepted = alreadyDelivered.size; // 재시도 시 과거 발송분 유지 — sent_count 정확
  let totalRejected = 0;

  try {
    // SMTP relay batch 100건 단위 — 회사 SMTP 한도 보호
    const BATCH_SIZE = 100;
    for (let i = 0; i < sendTargets.length; i += BATCH_SIZE) {
      const batch = sendTargets.slice(i, i + BATCH_SIZE);
      for (const recipient of batch) {
        try {
          // 섹션 캠페인 = 수신자별 개인화 렌더(변수+조건부). 섹션 없으면 기존 html_body 경로(무회귀).
          let personalizedHtml: string;
          let personalizedSubject: string;
          if (hasSections) {
            const cust = recipient.customer || { name: recipient.name || '고객' };
            const resolved = resolveEmailSectionsForCustomer(campaignSections, cust);
            let body = renderEmailSections(resolved, { brandKit, design: campaign.design, publicBase: process.env.PUBLIC_BASE_URL });
            body = injectFooter(body, campaign.isAd && !hasUnsubLink(body) ? adFooter : '');
            personalizedHtml = body;
            personalizedSubject = renderEmailText(finalSubject, cust);
          } else {
            personalizedHtml = finalHtml;
            personalizedSubject = finalSubject;
          }
          // 개인화 변수 치환 (substitutions {{변수}} 패턴 — 수동 HTML backward compat)
          if (recipient.substitutions) {
            for (const [key, value] of Object.entries(recipient.substitutions)) {
              const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
              personalizedHtml = personalizedHtml.replace(pattern, value);
              personalizedSubject = personalizedSubject.replace(pattern, value);
            }
          }
          // {{이름}} 기본 개인화 — 이름 없는 수신자도 토큰 원문이 남지 않게 '고객' fallback
          const nameForToken = recipient.name || '고객';
          personalizedHtml = personalizedHtml.replace(/\{\{\s*이름\s*\}\}/g, nameForToken);
          personalizedSubject = personalizedSubject.replace(/\{\{\s*이름\s*\}\}/g, nameForToken);

          // 오픈 픽셀 + 클릭 래핑 + 개인 토큰 수신거부 URL 치환 (수신자별)
          personalizedHtml = applyTracking(personalizedHtml, campaign.id, recipient.email);

          // ★ 2026-07-12 최종 방어선 (Codex MEDIUM 정정) — 미해결 {{...}} 토큰 잔존 제거.
          //   수동 HTML의 substitutions 밖 변수({{ customer.grade }} 등)가 원문 그대로 수신자에게
          //   노출되는 것을 차단. 수신거부 마커는 applyTracking이 이미 URL로 치환한 뒤라 안전.
          personalizedHtml = personalizedHtml.replace(/\{\{[^{}]*\}\}/g, '');
          personalizedSubject = personalizedSubject.replace(/\{\{[^{}]*\}\}/g, '');

          const result = await sendEmail({
            companyId: campaign.companyId,
            to: recipient.name ? { email: recipient.email, name: recipient.name } : recipient.email,
            subject: personalizedSubject,
            htmlBody: personalizedHtml,
            textBody: campaign.textBody || undefined,
            // 광고 메일 = List-Unsubscribe + One-Click(RFC 8058) — Gmail/Yahoo 대량 발송 요건 + 원클릭 수신거부.
            //   POST /api/email/u/:token이 본문 없이 수신거부를 처리하므로 One-Click 규격과 그대로 호환.
            headers: campaign.isAd
              ? {
                  'List-Unsubscribe': `<${buildUnsubscribeUrl(campaign.id, recipient.email)}>`,
                  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                }
              : undefined,
          });
          lastMessageId = result.messageId || lastMessageId;
          const acceptedN = result.accepted.length;
          totalAccepted += acceptedN;
          totalRejected += result.rejected.length;
          // 발송 성공 수신자 = delivered 이벤트 적재 (수신자별 이력/미오픈자 추출 토대). 실패해도 발송 흐름 유지.
          if (acceptedN > 0) {
            try {
              await recordEmailEvent({
                campaignId: campaign.id,
                email: recipient.email,
                eventType: 'delivered',
                occurredAt: new Date(),
              });
            } catch (evErr: any) {
              console.warn(`[Email] delivered 기록 실패 (${recipient.email}): ${evErr?.message}`);
            }
          }
        } catch (sendErr: any) {
          totalRejected += 1;
          console.warn(`[Email] 개별 발송 실패 (${recipient.email}): ${sendErr?.message}`);
        }
      }
      // batch 완료마다 sent_count + updated_at 갱신 — 진행 폴링 + sweeper 정체 감지(살아있음 신호)
      await query(
        `UPDATE email_campaigns SET sent_count = $2, updated_at = NOW() WHERE id = $1::uuid`,
        [campaign.id, totalAccepted]
      );
      // batch 간 1초 sleep — 회사 SMTP rate-limit 차단
      if (i + BATCH_SIZE < sendTargets.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    await query(
      `UPDATE email_campaigns SET
         status = 'completed',
         sent_at = NOW(),
         sent_count = $2,
         updated_at = NOW()
       WHERE id = $1::uuid`,
      [campaign.id, totalAccepted]
    );

    // 인비토AI 학습 적재 — 이메일 발송 단일 길목(즉시·예약 공통). fire-and-forget, source_ref(campaignId) 멱등, 발송·돈 영향 0.
    //   finalMessage = 원본 제목+본문(광고 footer 합성 전). 마스킹은 logTrainingData가 별도. metrics = 발송 실측(시도/성공/실패).
    //   ★ 재발송 자식(parentCampaignId)은 부모와 같은 카피라 문안 학습 코퍼스 이중 계상 방지 — 학습 적재 skip.
    //     (반응·채널 성과는 ai-memory-accumulator가 email_campaigns에서 별도 반영하므로 여기서 막는 건 카피 코퍼스뿐)
    if (!campaign.parentCampaignId) {
      void logCampaignTraining({
        campaignId: campaign.id,
        companyId: campaign.companyId,
        messageType: 'EMAIL',
        isAd: campaign.isAd,
        targetCount: input.recipients.length,
        finalMessage: buildEmailTrainingMessage(campaign.subject, campaign.textBody, campaign.htmlBody),
        finalSource: campaign.aiGenerated ? 'selected_as_is' : 'manual',
        sendAt: new Date(),
      })
        .then(() => updateTrainingMetrics({
          sourceRef: getSourceRef(campaign.id),
          sentCount: totalAccepted + totalRejected,
          successCount: totalAccepted,
          failCount: totalRejected,
        }))
        .catch(() => {});
    }

    return { messageId: lastMessageId, sentCount: totalAccepted };
  } catch (err: any) {
    await query(
      `UPDATE email_campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1::uuid`,
      [campaign.id]
    );
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════
// Event 트래킹 (외부 호출 — SMTP relay 안 자체 webhook 활용 X)
//   D215+ 정정: 옛 SendGrid Event Webhook 호출 흐름 영구 폐기.
//   회사 admin 본인 SMTP relay 활용 = open/click 트래킹 영역 = 자체 픽셀/링크 추적 imported 흐름.
// ════════════════════════════════════════════════════════════════════

export interface EmailEventInput {
  campaignId: string;
  email: string;
  eventType: 'open' | 'click' | 'bounce' | 'unsubscribe' | 'spam_report' | 'dropped' | 'delivered';
  url?: string;
  reason?: string;
  occurredAt: Date;
}

export async function recordEmailEvent(input: EmailEventInput): Promise<void> {
  const { campaignId, email, eventType, url, reason, occurredAt } = input;
  await query(
    `INSERT INTO email_events (
      id, campaign_id, email, event_type, url, reason, occurred_at, auto_processed, created_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6, false, NOW()
    )`,
    [campaignId, email, eventType, url || null, reason || null, occurredAt]
  );

  // 캠페인 통계 갱신 — 고유 수신자 1회만 카운트 (같은 사람 반복 오픈/클릭에 카운터 부풀림 차단 → 오픈율 100% 초과 방지).
  //   delivered = 카운터 없음. open/click/unsubscribe/bounce = 해당 email 첫 이벤트일 때만 +1.
  const column = {
    open: 'open_count',
    click: 'click_count',
    bounce: 'bounce_count',
    unsubscribe: 'unsubscribe_count',
    spam_report: 'bounce_count',
    dropped: 'bounce_count',
    delivered: null,
  }[eventType];

  if (column) {
    // INSERT 직후 이 (campaign, email, event_type) 누적 건수 = 1 이면 첫 발생 → 카운터 증가.
    const dupCheckTypes = eventType === 'spam_report' ? ['spam_report'] : eventType === 'dropped' ? ['dropped'] : [eventType];
    const cntRes = await query(
      `SELECT COUNT(*)::int AS n FROM email_events WHERE campaign_id = $1::uuid AND email = $2 AND event_type = ANY($3)`,
      [campaignId, email, dupCheckTypes]
    );
    if ((cntRes.rows[0]?.n || 0) <= 1) {
      await query(
        `UPDATE email_campaigns SET ${column} = ${column} + 1, updated_at = NOW() WHERE id = $1::uuid`,
        [campaignId]
      );
    }
  }

  // ★ D210+ Phase 3 B-5 (Harold 명시 2026-05-23): bounce / spam / unsubscribe 자동 처리
  //   bounce / spam_report / unsubscribe 이벤트 수신 시 customers 자동 unsubscribe.
  //   email_opt_in = false 갱신 + email_events.auto_processed = true
  if (eventType === 'bounce' || eventType === 'spam_report' || eventType === 'unsubscribe') {
    try {
      // 회사 ID = email_campaigns → company_id 매핑
      const cmp = await query(
        `SELECT company_id FROM email_campaigns WHERE id = $1::uuid LIMIT 1`,
        [campaignId]
      );
      const companyId = cmp.rows[0]?.company_id;
      if (companyId) {
        // customers 자동 처리 — email 매칭 + email_opt_in false
        await query(
          `UPDATE customers SET
             email_opt_in = false,
             updated_at = NOW()
           WHERE company_id = $1::uuid
             AND email = $2
             AND email_opt_in = true`,
          [companyId, email]
        );
        // email_events.auto_processed = true 갱신
        await query(
          `UPDATE email_events SET auto_processed = true
           WHERE campaign_id = $1::uuid AND email = $2 AND event_type = $3
             AND occurred_at = $4`,
          [campaignId, email, eventType, occurredAt]
        );
      }
    } catch (err: any) {
      console.warn('[Email] 자동 unsubscribe 처리 오류 (silent skip):', err?.message);
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// 수신자 해석 — 고객DB(customers) 연동
//   안전 필터(보수적): email 유효 + 수신거부/무효 신호 전부 제외.
//   email_opt_in = false(이메일 바운스·수신거부) / is_opt_out = true(전체 마케팅 거부) / is_invalid = true(무효 연락처)
// ════════════════════════════════════════════════════════════════════

const RECIPIENT_SAFETY_WHERE = `
  email IS NOT NULL AND email LIKE '%@%'
  AND email_opt_in IS DISTINCT FROM false
  AND is_opt_out IS DISTINCT FROM true
  AND is_invalid IS DISTINCT FROM true`;

// ★ 2026-07-02 개인화 변수 동적화 (Harold 지시 — 하드코딩 금지, 회사 실데이터 필드만)
//   수신자 SELECT·개인화 customer 객체·에디터 칩이 전부 이 목록 하나를 공유한다.
//   전부 CT-58(company-data-profile)이 운영에서 실측 COUNT하는 customers 표준 컬럼.
//   날짜형(생일·최근 구매일·결혼기념일)은 Date 객체가 영문 그대로 찍히는 문제로 이메일 치환에서 제외, email 자신도 제외.
const RECIPIENT_PERSONALIZATION_COLS = [
  'name', 'grade', 'gender', 'age', 'region', 'address', 'store_name', 'registered_store',
  'points', 'recent_purchase_amount', 'recent_purchase_store',
  'total_purchase_amount', 'purchase_count', 'avg_order_value', 'ltv_score',
] as const;
const RECIPIENT_NUMERIC_COLS = new Set([
  'age', 'points', 'recent_purchase_amount', 'total_purchase_amount', 'purchase_count', 'avg_order_value', 'ltv_score',
]);
const RECIPIENT_SELECT_COLS = RECIPIENT_PERSONALIZATION_COLS.join(', ');

export interface EmailPersonalizationVar {
  field: string;
  token: string;   // {{ customer.X }}
  label: string;
}

/**
 * 회사 실측 기반 개인화 변수 목록 — 에디터 칩/조건부 표시 필드용.
 * CT-58 safeFields(70%+ 채워짐)만 노출 = 빈 값 치환으로 문장이 깨지는 수신자 최소화.
 */
export async function listEmailPersonalizationVars(companyId: string): Promise<EmailPersonalizationVar[]> {
  const profile = await getCompanyDataProfile(companyId);
  const allowed = new Set<string>(RECIPIENT_PERSONALIZATION_COLS);
  return profile.safeFields
    .filter((f) => allowed.has(f.field))
    .map((f) => ({ field: f.field, token: `{{ ${f.liquidVar} }}`, label: f.label }));
}

/** customers row → EmailRecipient(+개인화 customer). 등급/필터 해석 공용 매핑. */
function mapEmailRecipientRow(r: any): EmailRecipient {
  const customer: Record<string, any> = {};
  for (const col of RECIPIENT_PERSONALIZATION_COLS) {
    customer[col] = RECIPIENT_NUMERIC_COLS.has(col) ? Number(r[col] || 0) : (r[col] || '');
  }
  customer.name = r.name || '고객';
  return {
    email: String(r.email).trim(),
    name: r.name ? String(r.name) : undefined,
    customer,
  };
}

/** 발송 대상 고객 해석 — 회사 격리 + 안전 필터 + 선택 등급. 발송 엔진/스위퍼가 소비. */
export async function resolveCustomerRecipients(
  companyId: string,
  grades?: string[],
): Promise<EmailRecipient[]> {
  const params: any[] = [companyId];
  let gradeClause = '';
  if (grades && grades.length > 0) {
    params.push(grades);
    gradeClause = ` AND grade = ANY($${params.length})`;
  }
  const result = await query(
    `SELECT DISTINCT ON (lower(email)) email, ${RECIPIENT_SELECT_COLS}
     FROM customers
     WHERE company_id = $1::uuid AND ${RECIPIENT_SAFETY_WHERE}${gradeClause}
     ORDER BY lower(email)`,
    params,
  );
  return result.rows.map(mapEmailRecipientRow);
}

/**
 * 발송 대상 고객 해석 — 회사 격리 + 안전 필터 + CT-01 structured filter.
 * 타겟 추출(/api/targets/extract)로 확정한 filter를 이메일 발송 대상으로 결합.
 * 안전 필터(RECIPIENT_SAFETY_WHERE)는 등급 경로와 동일 — 추출 미리보기 인원수와 실발송 일치.
 */
export async function resolveCustomerRecipientsByFilter(
  companyId: string,
  filter: Record<string, { operator: string; value: any }>,
): Promise<EmailRecipient[]> {
  const { sql: filterSql, params: filterParams } = buildCustomerFilter(filter, {
    tableAlias: 'c',
    startParamIndex: 2,
    storeCodeMode: 'skip',
    inputFormat: 'structured',
  });
  const result = await query(
    `SELECT DISTINCT ON (lower(c.email)) c.email, ${RECIPIENT_PERSONALIZATION_COLS.map((c) => `c.${c}`).join(', ')}
     FROM customers c
     WHERE c.company_id = $1::uuid AND ${RECIPIENT_SAFETY_WHERE}${filterSql}
     ORDER BY lower(c.email)`,
    [companyId, ...filterParams],
  );
  return result.rows.map(mapEmailRecipientRow);
}

/**
 * ★ 2026-08-13 (마케팅 플래너 Phase 2) 이메일 수신 가능 고객 수만 — 안전 필터는 위 발송 경로와 같은 단일 소스.
 *   previewCustomerRecipients는 등급 분포·표본까지 3쿼리를 도는데, 브리핑은 수 하나만 쓴다.
 *   그래서 같은 WHERE로 COUNT 1쿼리만 돌리는 문을 이 파일(이메일 수신자 축의 주인)에 둔다 — 호출부 인라인 복제 금지.
 */
export async function countCustomerEmailRecipients(companyId: string): Promise<number> {
  const r = await query(
    `SELECT COUNT(DISTINCT lower(email))::int AS total
     FROM customers WHERE company_id = $1::uuid AND ${RECIPIENT_SAFETY_WHERE}`,
    [companyId],
  );
  return Number(r.rows[0]?.total) || 0;
}

/** 발송 전 미리보기 — 대상 인원 + 등급 분포 + 표본 (RecipientsModal 고객DB 탭). */
export async function previewCustomerRecipients(
  companyId: string,
  grades?: string[],
): Promise<{ total: number; gradeBreakdown: Array<{ grade: string; count: number }>; sample: string[] }> {
  const params: any[] = [companyId];
  let gradeClause = '';
  if (grades && grades.length > 0) {
    params.push(grades);
    gradeClause = ` AND grade = ANY($${params.length})`;
  }
  const totalRes = await query(
    `SELECT COUNT(DISTINCT lower(email))::int AS total
     FROM customers WHERE company_id = $1::uuid AND ${RECIPIENT_SAFETY_WHERE}${gradeClause}`,
    params,
  );
  const breakdownRes = await query(
    `SELECT COALESCE(NULLIF(grade, ''), '미지정') AS grade, COUNT(DISTINCT lower(email))::int AS count
     FROM customers WHERE company_id = $1::uuid AND ${RECIPIENT_SAFETY_WHERE}${gradeClause}
     GROUP BY COALESCE(NULLIF(grade, ''), '미지정') ORDER BY count DESC`,
    params,
  );
  const sampleRes = await query(
    `SELECT DISTINCT ON (lower(email)) email
     FROM customers WHERE company_id = $1::uuid AND ${RECIPIENT_SAFETY_WHERE}${gradeClause}
     ORDER BY lower(email) LIMIT 5`,
    params,
  );
  return {
    total: totalRes.rows[0]?.total || 0,
    gradeBreakdown: breakdownRes.rows.map((r: any) => ({ grade: r.grade, count: Number(r.count) || 0 })),
    sample: sampleRes.rows.map((r: any) => String(r.email)),
  };
}

/**
 * 직접 입력(list) 수신자에서 수신거부·반송·무효 이력 이메일 제외 — 즉시/예약(list targetSpec) 공용.
 * 고객DB 경로(RECIPIENT_SAFETY_WHERE)와 달리 직접 입력은 필터가 없어, 과거 수신거부(자동 opt-out 포함)
 * 이메일에 재발송되는 구멍을 막는다. 고객DB에 없는 이메일(비고객)은 거부 신호가 없으므로 그대로 발송.
 * 같은 이메일이 여러 고객 행에 걸릴 땐 하나라도 거부 신호면 제외(보수 판정).
 */
export async function excludeOptedOutEmails(
  companyId: string,
  recipients: EmailRecipient[],
): Promise<{ recipients: EmailRecipient[]; excludedCount: number }> {
  if (recipients.length === 0) return { recipients, excludedCount: 0 };
  const emails = [...new Set(recipients.map((r) => r.email.toLowerCase()))];
  const res = await query(
    `SELECT DISTINCT lower(email) AS email FROM customers
     WHERE company_id = $1::uuid AND lower(email) = ANY($2)
       AND (email_opt_in = false OR is_opt_out = true OR is_invalid = true)`,
    [companyId, emails],
  );
  const blocked = new Set<string>(res.rows.map((r: any) => String(r.email)));
  if (blocked.size === 0) return { recipients, excludedCount: 0 };
  const kept = recipients.filter((r) => !blocked.has(r.email.toLowerCase()));
  return { recipients: kept, excludedCount: recipients.length - kept.length };
}

/** 회사 전체 등급 목록 (고객DB 탭 등급 선택지) */
export async function listCustomerGrades(companyId: string): Promise<Array<{ grade: string; count: number }>> {
  const result = await query(
    `SELECT COALESCE(NULLIF(grade, ''), '미지정') AS grade, COUNT(*)::int AS count
     FROM customers WHERE company_id = $1::uuid AND ${RECIPIENT_SAFETY_WHERE}
     GROUP BY COALESCE(NULLIF(grade, ''), '미지정') ORDER BY count DESC`,
    [companyId],
  );
  return result.rows.map((r: any) => ({ grade: r.grade, count: Number(r.count) || 0 }));
}

// ════════════════════════════════════════════════════════════════════
// 예약 발송 — target_spec 저장 (신규 ALTER 컬럼 — 503 분기 보호 대상)
// ════════════════════════════════════════════════════════════════════

/** 예약 발송 설정 — target_spec + scheduled_at 저장 + status='scheduled'. sweeper가 도래 시 발송. */
export async function scheduleCampaign(
  companyId: string,
  campaignId: string,
  targetSpec: EmailTargetSpec,
  scheduledAt: Date,
): Promise<EmailCampaign | null> {
  const result = await query(
    `UPDATE email_campaigns
       SET target_spec = $3::jsonb, scheduled_at = $4, status = 'scheduled', updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid
     RETURNING *`,
    [campaignId, companyId, JSON.stringify(targetSpec), scheduledAt],
  );
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
}

// ════════════════════════════════════════════════════════════════════
// 성과 집계 — 실측만 (추정치 0). email-ai insight / send-time / non-openers 소비.
// ════════════════════════════════════════════════════════════════════

/** 캠페인 실측 성과 — 고유 오픈/클릭 + 오픈 시간대(KST) 분포. */
export async function getCampaignPerformanceStats(campaignId: string): Promise<{
  sentCount: number;
  uniqueOpeners: number;
  uniqueClickers: number;
  bounceCount: number;
  unsubscribeCount: number;
  openRatePct: number | null;
  clickRatePct: number | null;
  topOpenHours: Array<{ hour: number; cnt: number }>;
}> {
  const campRes = await query(
    `SELECT sent_count, bounce_count, unsubscribe_count FROM email_campaigns WHERE id = $1::uuid`,
    [campaignId],
  );
  const sentCount = Number(campRes.rows[0]?.sent_count) || 0;
  const bounceCount = Number(campRes.rows[0]?.bounce_count) || 0;
  const unsubscribeCount = Number(campRes.rows[0]?.unsubscribe_count) || 0;

  const uniqRes = await query(
    `SELECT
       COUNT(DISTINCT email) FILTER (WHERE event_type = 'open')::int AS openers,
       COUNT(DISTINCT email) FILTER (WHERE event_type = 'click')::int AS clickers
     FROM email_events WHERE campaign_id = $1::uuid`,
    [campaignId],
  );
  const uniqueOpeners = Number(uniqRes.rows[0]?.openers) || 0;
  const uniqueClickers = Number(uniqRes.rows[0]?.clickers) || 0;

  const hourRes = await query(
    `SELECT EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Asia/Seoul')::int AS hour, COUNT(*)::int AS cnt
     FROM email_events WHERE campaign_id = $1::uuid AND event_type = 'open'
     GROUP BY 1 ORDER BY 2 DESC`,
    [campaignId],
  );

  return {
    sentCount,
    uniqueOpeners,
    uniqueClickers,
    bounceCount,
    unsubscribeCount,
    openRatePct: sentCount > 0 ? Math.round((uniqueOpeners / sentCount) * 1000) / 10 : null,
    clickRatePct: sentCount > 0 ? Math.round((uniqueClickers / sentCount) * 1000) / 10 : null,
    topOpenHours: hourRes.rows.map((r: any) => ({ hour: Number(r.hour), cnt: Number(r.cnt) })),
  };
}

/** 회사 전체 오픈 시간대 분포(최근 90일, KST) — 발송 시간 추천. */
export async function getCompanyOpenHourDistribution(companyId: string): Promise<Array<{ hour: number; cnt: number }>> {
  const result = await query(
    `SELECT EXTRACT(HOUR FROM ev.occurred_at AT TIME ZONE 'Asia/Seoul')::int AS hour, COUNT(*)::int AS cnt
     FROM email_events ev
     JOIN email_campaigns c ON c.id = ev.campaign_id
     WHERE c.company_id = $1::uuid AND ev.event_type = 'open'
       AND ev.occurred_at >= NOW() - INTERVAL '90 days'
     GROUP BY 1 ORDER BY 1`,
    [companyId],
  );
  return result.rows.map((r: any) => ({ hour: Number(r.hour), cnt: Number(r.cnt) }));
}

/** 미오픈자 — delivered 있고 open 없는 수신 이메일 → customers phone 매칭 (SMS 크로스 채널). */
export async function getCampaignNonOpeners(companyId: string, campaignId: string): Promise<{
  matched: Array<{ phone: string; name: string | null }>;
  unmatchedCount: number;
  totalNonOpeners: number;
}> {
  const nonOpenRes = await query(
    `SELECT DISTINCT d.email
     FROM email_events d
     WHERE d.campaign_id = $1::uuid AND d.event_type = 'delivered'
       AND NOT EXISTS (
         SELECT 1 FROM email_events o
         WHERE o.campaign_id = $1::uuid AND o.event_type = 'open' AND lower(o.email) = lower(d.email)
       )`,
    [campaignId],
  );
  const emails = nonOpenRes.rows.map((r: any) => String(r.email));
  const totalNonOpeners = emails.length;
  if (emails.length === 0) return { matched: [], unmatchedCount: 0, totalNonOpeners: 0 };

  const matchRes = await query(
    `SELECT DISTINCT ON (lower(email)) phone, name
     FROM customers
     WHERE company_id = $1::uuid AND lower(email) = ANY($2)
       AND phone IS NOT NULL AND phone <> ''
       AND is_opt_out IS DISTINCT FROM true AND is_invalid IS DISTINCT FROM true
     ORDER BY lower(email)`,
    [companyId, emails.map((e) => e.toLowerCase())],
  );
  const matched = matchRes.rows.map((r: any) => ({ phone: String(r.phone), name: r.name ? String(r.name) : null }));
  return { matched, unmatchedCount: Math.max(0, totalNonOpeners - matched.length), totalNonOpeners };
}

// ════════════════════════════════════════════════════════════════════
// 미수신자 재발송 (이메일 무료) — 미오픈자에게 같은 콘텐츠 재발송 (자식 캠페인)
//   대상 = delivered 있고 open 없으며 unsubscribe/bounce/spam_report/dropped 없는 수신 이메일.
//   고객DB 매칭 시 안전 필터(email_opt_in·is_opt_out·is_invalid) 통과분만, 미매칭 이메일은 원발송 대상이라 그대로 포함.
// ════════════════════════════════════════════════════════════════════

/** 재발송 대상 수신자 — 미오픈(수신거부·반송·스팸 제외) 이메일 → 개인화 customer 매칭. sendEmailCampaign 직접 소비. */
export async function getCampaignResendRecipients(companyId: string, campaignId: string): Promise<EmailRecipient[]> {
  const nonOpenRes = await query(
    `SELECT DISTINCT lower(d.email) AS email
     FROM email_events d
     WHERE d.campaign_id = $1::uuid AND d.event_type = 'delivered'
       AND NOT EXISTS (
         SELECT 1 FROM email_events x
         WHERE x.campaign_id = $1::uuid AND lower(x.email) = lower(d.email)
           AND x.event_type IN ('open', 'unsubscribe', 'bounce', 'spam_report', 'dropped')
       )`,
    [campaignId],
  );
  const emails = nonOpenRes.rows.map((r: any) => String(r.email));
  if (emails.length === 0) return [];

  // 고객DB 매칭 — 안전 필터 통과분(개인화 customer 포함). RECIPIENT_SAFETY_WHERE = 등급/필터 발송 경로와 동일.
  const safeRes = await query(
    `SELECT DISTINCT ON (lower(email)) lower(email) AS email, ${RECIPIENT_SELECT_COLS}
     FROM customers
     WHERE company_id = $1::uuid AND lower(email) = ANY($2) AND ${RECIPIENT_SAFETY_WHERE}
     ORDER BY lower(email)`,
    [companyId, emails],
  );
  const safeRecipients = safeRes.rows.map(mapEmailRecipientRow);

  // 고객DB에 존재하는 모든 이메일(안전 필터 무관). 미매칭(비고객·원발송 리스트분)만 그대로 포함하기 위한 차집합 —
  //   수신거부 고객은 customers에 is_opt_out=true 행으로 남아 present에 잡히므로 unmatched에서 자동 배제된다.
  const presentRes = await query(
    `SELECT DISTINCT lower(email) AS email FROM customers
     WHERE company_id = $1::uuid AND lower(email) = ANY($2)`,
    [companyId, emails],
  );
  const presentSet = new Set<string>(presentRes.rows.map((r: any) => String(r.email)));
  const unmatched: EmailRecipient[] = emails.filter((e) => !presentSet.has(e)).map((email) => ({ email }));

  return [...safeRecipients, ...unmatched];
}

/** 재발송 자식 수 — 재발송 1회 한도 판정 (parent_campaign_id = 원본 id). 신규 ALTER 컬럼 — 미실행 시 throw → 라우트 503 분기. */
export async function countResendChildren(companyId: string, campaignId: string): Promise<number> {
  const res = await query(
    `SELECT COUNT(*)::int AS cnt FROM email_campaigns
     WHERE company_id = $1::uuid AND parent_campaign_id = $2::uuid`,
    [companyId, campaignId],
  );
  return Number(res.rows[0]?.cnt) || 0;
}

/** 재발송 자식 캠페인 생성 — 원본 콘텐츠 복사 + parent_campaign_id + resend_generation. 완성 크레딧 재부과 없음(콘텐츠 재사용=무료). */
export async function createResendChildCampaign(
  parent: EmailCampaign,
  createdBy: string | null,
  subjectOverride?: string,
): Promise<EmailCampaign> {
  const childName = `${parent.name} (재발송)`.slice(0, 200);
  const childSubject = ((subjectOverride && subjectOverride.trim()) ? subjectOverride.trim() : parent.subject).slice(0, 200);
  // ★ 2026-07-13 (Codex 3R) — design 복사는 INSERT 단문에 동승(원자성). 후행 UPDATE 분리는 실패 시
  //   자식 행만 남아 "재발송 1회 한도"를 발송 없이 소진시킨다. parent.design이 있다는 것 =
  //   design 컬럼이 이미 존재한다는 뜻(SELECT *로 읽힘)이라 컬럼 참조가 안전하고,
  //   parent.design이 없으면(ALTER 전 포함) design을 참조하지 않는 기존 INSERT를 쓴다.
  const designCol = parent.design ? ', design' : '';
  const designVal = parent.design ? ', $14::jsonb' : '';
  const result = await query(
    `INSERT INTO email_campaigns (
       id, company_id, created_by, name, subject, html_body, text_body,
       from_name, from_email, is_ad, status,
       sent_count, open_count, click_count, bounce_count, unsubscribe_count,
       ai_generated, sections, parent_campaign_id, resend_generation${designCol},
       created_at, updated_at
     ) VALUES (
       gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6,
       $7, $8, $9, 'draft',
       0, 0, 0, 0, 0,
       $10, $11::jsonb, $12::uuid, $13${designVal},
       NOW(), NOW()
     ) RETURNING *`,
    [
      parent.companyId,
      createdBy,
      childName,
      childSubject,
      parent.htmlBody,
      parent.textBody,
      parent.fromName,
      parent.fromEmail,
      parent.isAd,
      parent.aiGenerated,
      parent.sections ? JSON.stringify(parent.sections) : null,
      parent.id,
      parent.resendGeneration + 1,
      ...(parent.design ? [JSON.stringify(parent.design)] : []),
    ],
  );
  return mapRow(result.rows[0]);
}

// ════════════════════════════════════════════════════════════════════
// 헬퍼
// ════════════════════════════════════════════════════════════════════

/** design JSONB 안전 파싱 — 문자열/객체 양쪽 수용, 불량 = null(렌더는 기존 기본 룩). */
function parseDesign(raw: unknown): EmailDesign | null {
  if (!raw) return null;
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as EmailDesign) : null;
  } catch { return null; }
}

function mapRow(row: any): EmailCampaign {
  // ai_generated / target_spec = 신규 ALTER 컬럼. SELECT * 결과에 없으면(ALTER 전) undefined → 기본값.
  let targetSpec: EmailTargetSpec | null = null;
  if (row.target_spec) {
    try {
      targetSpec = typeof row.target_spec === 'string' ? JSON.parse(row.target_spec) : row.target_spec;
    } catch { targetSpec = null; }
  }
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    subject: row.subject,
    htmlBody: row.html_body,
    textBody: row.text_body,
    hasPlaceholder: hasUneditedPlaceholder(row.subject, row.html_body, row.text_body),
    fromName: row.from_name,
    fromEmail: row.from_email,
    isAd: !!row.is_ad,
    aiGenerated: !!row.ai_generated,
    targetSpec,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
    sentAt: row.sent_at ? new Date(row.sent_at) : null,
    status: row.status,
    sentCount: row.sent_count || 0,
    openCount: row.open_count || 0,
    clickCount: row.click_count || 0,
    bounceCount: row.bounce_count || 0,
    unsubscribeCount: row.unsubscribe_count || 0,
    sections: Array.isArray(row.sections) ? row.sections : (row.sections ?? null),
    // ★ 2026-07-13 design = 신규 ALTER 컬럼. SELECT * 결과에 없으면(ALTER 전) null — 렌더는 기존 기본 룩.
    design: parseDesign(row.design),
    // parent_campaign_id / resend_generation = 신규 ALTER 컬럼. SELECT * 결과에 없으면(ALTER 전) 기본값.
    parentCampaignId: row.parent_campaign_id ?? null,
    resendGeneration: Number(row.resend_generation) || 0,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  };
}
