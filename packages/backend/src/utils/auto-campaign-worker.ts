/**
 * ★ D69+AI Premium: 자동발송 PM2 워커 (3단계 라이프사이클)
 *
 * 실행 방식: app.ts 내부 setInterval (매 10분)
 *
 * ★ 3단계 라이프사이클 (AI 문안 자동생성 지원):
 *   D-2 23:00  → runMessageGeneration()  — AI 문안 생성 + 스팸테스트
 *   D-1        → runPreNotification()    — 담당자에게 테스트 발송 + 알림
 *   D-day      → executeAutoCampaign()   — 실제 발송
 *
 * 기존 파이프라인 100% 재활용:
 * - customer-filter.ts (CT-01) → 타겟 필터링
 * - unsubscribe-helper.ts (CT-03) → 수신거부 제외
 * - sms-queue.ts (CT-04) → MySQL 큐 INSERT
 * - messageUtils.ts → 변수 치환
 * - prepaid.ts (CT-05) → 선불 차감
 * - services/ai.ts → AI 메시지 생성 (generateMessages)
 * - spam-test-queue.ts (CT-09) → 자동 스팸테스트/재생성
 *
 * 실패 정책: 스킵 + failed 기록 → next_run_at 다음 스케줄로 갱신 (중복 발송 방지)
 */

import { query } from '../config/database';
import { buildFilterQueryCompat } from './customer-filter';
import { replaceVariables, getOpt080Number, buildAdMessage, prepareFieldMappings } from './messageUtils';
import {
  toKoreaTimeStr,
  getCompanySmsTables, hasCompanyLineGroup, getNextSmsTable,
  bulkInsertSmsQueue,
} from './sms-queue';
import { prepaidDeduct, prepaidRefund } from './prepaid';
import { normalizePhone } from './normalize-phone';
import { extractVarCatalog, generateMessages } from '../services/ai';
import { autoSpamTestWithRegenerate } from './spam-test-queue';
import { SEND_HOURS } from '../config/defaults';

// ============================================================
// next_run_at 계산 (auto-campaigns.ts와 동일 로직)
// ============================================================

function calcNextRunAt(scheduleType: string, scheduleDay: number | null, scheduleTime: string): Date {
  // ★ D83: 서버 타임존에 관계없이 정확한 KST→UTC 변환
  // 이전: toLocaleString + kstToUtc 조합 → KST 서버에서 이중 변환 → 9시간 오차
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const [hours, minutes] = scheduleTime.split(':').map(Number);

  const now = new Date();
  const kstMs = now.getTime() + KST_OFFSET_MS;
  const kstDate = new Date(kstMs);
  const kstYear = kstDate.getUTCFullYear();
  const kstMonth = kstDate.getUTCMonth();
  const kstDay = kstDate.getUTCDate();
  const kstDow = kstDate.getUTCDay();
  const kstNowMinutes = kstDate.getUTCHours() * 60 + kstDate.getUTCMinutes();
  const targetMinutes = hours * 60 + minutes;

  let tYear = kstYear, tMonth = kstMonth, tDay: number;

  if (scheduleType === 'daily') {
    tDay = kstDay;
    if (targetMinutes <= kstNowMinutes) tDay++;
  } else if (scheduleType === 'weekly') {
    const daysUntil = (scheduleDay! - kstDow + 7) % 7;
    tDay = kstDay + daysUntil;
    if (daysUntil === 0 && targetMinutes <= kstNowMinutes) tDay += 7;
  } else if (scheduleType === 'monthly') {
    tDay = scheduleDay!;
    if (tDay < kstDay || (tDay === kstDay && targetMinutes <= kstNowMinutes)) {
      tMonth++;
      if (tMonth > 11) { tMonth = 0; tYear++; }
    }
  } else {
    throw new Error(`Invalid schedule_type: ${scheduleType}`);
  }

  return new Date(Date.UTC(tYear, tMonth, tDay, hours, minutes, 0) - KST_OFFSET_MS);
}

export function kstToUtc(kstDate: Date): Date {
  return new Date(kstDate.getTime() - 9 * 60 * 60 * 1000);
}

// ============================================================
// 발송 시간대 체크
// ============================================================

function isWithinSendHours(): boolean {
  const now = new Date();
  const kstHour = parseInt(
    now.toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false })
  );
  return kstHour >= SEND_HOURS.start && kstHour < SEND_HOURS.end;
}

// ============================================================
// ★ 1단계: D-2 AI 문안 생성 + 스팸테스트
// ai_generate_enabled=true AND next_run_at 24~48시간 이내 AND 아직 미생성
// ============================================================

async function runMessageGeneration(): Promise<void> {
  const logPrefix = '[auto-worker][gen]';

  try {
    // D-2 범위: next_run_at이 24~48시간 이내 + AI 모드 + 아직 생성 안 한 건
    const result = await query(
      `SELECT * FROM auto_campaigns
       WHERE status = 'active'
         AND ai_generate_enabled = true
         AND next_run_at > NOW() + INTERVAL '24 hours'
         AND next_run_at <= NOW() + INTERVAL '48 hours'
         AND (generated_at IS NULL OR generated_at < NOW() - INTERVAL '48 hours')
       ORDER BY next_run_at ASC`
    );

    if (result.rows.length === 0) return;

    console.log(`${logPrefix} AI 문안 생성 대상 ${result.rows.length}건`);

    for (const ac of result.rows) {
      await generateMessageForAutoCampaign(ac);
    }
  } catch (err: any) {
    console.error(`${logPrefix} 문안 생성 워커 에러:`, err);
  }
}

async function generateMessageForAutoCampaign(ac: any): Promise<void> {
  const logPrefix = `[auto-worker][gen][${ac.id}]`;

  try {
    console.log(`${logPrefix} AI 문안 생성 시작 (${ac.campaign_name})`);

    // 회사 정보 조회 (AI 생성에 필요)
    const companyResult = await query(
      `SELECT company_name, brand_name, brand_tone, brand_description, brand_slogan,
              COALESCE(reject_number, opt_out_080_number) as reject_number, customer_schema
       FROM companies WHERE id = $1`,
      [ac.company_id]
    );
    const companyInfo = companyResult.rows[0] || {};

    // 사용자별 080번호 우선
    if (ac.user_id) {
      const userOptResult = await query('SELECT opt_out_080_number FROM users WHERE id = $1', [ac.user_id]);
      const userOpt080 = userOptResult.rows[0]?.opt_out_080_number;
      if (userOpt080) companyInfo.reject_number = userOpt080;
    }

    const { fieldMappings: varCatalog, availableVars } = extractVarCatalog(companyInfo.customer_schema);

    // 타겟 통계 조회 (간략)
    const statsResult = await query(
      `SELECT COUNT(*) as total FROM customers WHERE company_id = $1 AND is_active = true AND sms_opt_in = true`,
      [ac.company_id]
    );
    const targetInfo = {
      total_count: parseInt(statsResult.rows[0].total),
      avg_purchase_count: 0,
      avg_total_spent: 0,
    };

    // ★ AI 메시지 생성 — services/ai.ts generateMessages() 재활용
    // message_type에 따라 SMS/LMS/MMS 전부 지원
    const channel = ac.message_type || 'SMS';
    const extraContext = {
      brandName: companyInfo.brand_name || companyInfo.company_name || '브랜드',
      brandTone: companyInfo.brand_tone,
      brandDescription: companyInfo.brand_description,
      brandSlogan: companyInfo.brand_slogan,
      channel,
      isAd: ac.is_ad ?? false,
      rejectNumber: companyInfo.reject_number,
      tone: ac.ai_tone || 'friendly',
      availableVarsCatalog: varCatalog,
      availableVars,
    };

    const aiResult = await generateMessages(ac.ai_prompt || ac.campaign_name, targetInfo, extraContext);

    let generatedContent = '';
    let generatedSubject = '';
    let aiGenerationStatus = 'ai_generated';
    let spamTestResult: any = null;

    if (aiResult.variants && aiResult.variants.length > 0) {
      // ★ 스팸테스트 — CT-09 autoSpamTestWithRegenerate 재활용
      // 프로 이상이므로 스팸테스트 가능
      let testedVariants = aiResult.variants;

      if (ac.callback_number && channel !== '카카오') {
        // ★ D101: 타겟 첫 번째 고객 조회 (스팸테스트 개인화 치환용)
        let firstRecipient: Record<string, any> | undefined;
        try {
          const filterResult = buildFilterQueryCompat(ac.target_filter, ac.company_id);
          const firstCustResult = await query(
            `SELECT * FROM customers WHERE company_id = $1 AND is_active = true AND sms_opt_in = true ${filterResult.where ? 'AND ' + filterResult.where : ''} ORDER BY updated_at DESC LIMIT 1`,
            [ac.company_id, ...filterResult.params]
          );
          if (firstCustResult.rows.length > 0) {
            const c = firstCustResult.rows[0];
            firstRecipient = { ...c, ...(c.custom_fields || {}) };
          }
        } catch (e) {
          console.warn(`${logPrefix} 스팸테스트용 첫 고객 조회 실패 (무시):`, e);
        }

        try {
          const spamResult = await autoSpamTestWithRegenerate({
            companyId: ac.company_id,
            userId: ac.user_id,
            callbackNumber: ac.callback_number,
            messageType: channel as 'SMS' | 'LMS' | 'MMS',
            variants: aiResult.variants.map((v: any) => ({
              variantId: v.variant_id || v.variantId || 'A',
              messageText: v.message_text || v.sms_text || v.lms_text || '',
              subject: v.subject,
            })),
            isAd: ac.is_ad || false,
            rejectNumber: companyInfo.reject_number,
            firstRecipient,
            regenerateCallback: async (blockedVariantId: string) => {
              try {
                console.log(`${logPrefix} 스팸 차단 variant ${blockedVariantId} 재생성`);
                const regenResult = await generateMessages(
                  (ac.ai_prompt || ac.campaign_name) + '\n(이전 문안이 스팸필터에 차단되었습니다. 다른 표현으로 작성해주세요.)',
                  targetInfo, extraContext
                );
                if (regenResult.variants?.length > 0) {
                  const nv = regenResult.variants[0] as any;
                  return {
                    messageText: nv.message_text || nv.sms_text || nv.lms_text || '',
                    subject: nv.subject,
                  };
                }
                return null;
              } catch {
                return null;
              }
            },
          });

          spamTestResult = {
            batchId: spamResult.batchId,
            totalTestCount: spamResult.totalTestCount,
            totalRegenerateCount: spamResult.totalRegenerateCount,
          };

          // 스팸 통과한 variant만 필터 (+ 재생성된 메시지 교체)
          for (const sv of spamResult.variants) {
            const original = testedVariants.find(
              (v: any) => (v.variant_id || v.variantId) === sv.variantId
            );
            if (original && sv.regenerated) {
              (original as any).message_text = sv.messageText;
              (original as any).sms_text = sv.messageText;
              (original as any).lms_text = sv.messageText;
              if (sv.subject) (original as any).subject = sv.subject;
            }
          }

          console.log(`${logPrefix} 스팸테스트 완료 — batch=${spamResult.batchId}`);
        } catch (spamErr) {
          console.error(`${logPrefix} 스팸테스트 오류 (AI 결과 그대로 사용):`, spamErr);
        }
      }

      // 최고 점수 variant 선택
      const best = testedVariants.sort((a: any, b: any) => (b.score || 0) - (a.score || 0))[0] as any;
      generatedContent = best.message_text || best.sms_text || best.lms_text || '';
      generatedSubject = best.subject || '';

      if (!generatedContent) {
        // AI가 빈 메시지를 생성한 경우 → 폴백
        generatedContent = ac.fallback_message_content || ac.message_content || '';
        generatedSubject = ac.message_subject || '';
        aiGenerationStatus = 'ai_fallback';
        console.warn(`${logPrefix} AI 생성 메시지 비어있음 → 폴백 사용`);
      }
    } else {
      // AI 생성 실패 → 폴백
      generatedContent = ac.fallback_message_content || ac.message_content || '';
      generatedSubject = ac.message_subject || '';
      aiGenerationStatus = 'ai_fallback';
      console.warn(`${logPrefix} AI 생성 실패 → 폴백 사용`);
    }

    // auto_campaigns에 생성된 문안 저장
    await query(
      `UPDATE auto_campaigns SET
        generated_message_content = $2,
        generated_message_subject = $3,
        generated_at = NOW(),
        updated_at = NOW()
       WHERE id = $1`,
      [ac.id, generatedContent, generatedSubject || null]
    );

    console.log(`${logPrefix} 문안 생성 완료 — status=${aiGenerationStatus}, length=${generatedContent.length}자`);
  } catch (err: any) {
    console.error(`${logPrefix} AI 문안 생성 에러:`, err);
    // 생성 실패해도 next_run_at은 건드리지 않음 — D-day에 fallback으로 발송
  }
}

// ============================================================
// ★ 2단계: D-1 사전 알림 (담당자 테스트 발송)
// pre_notify=true AND next_run_at 0~24시간 이내 AND 아직 미알림
// ============================================================

async function runPreNotification(): Promise<void> {
  const logPrefix = '[auto-worker][notify]';

  try {
    const result = await query(
      `SELECT ac.* FROM auto_campaigns ac
       WHERE ac.status = 'active'
         AND ac.pre_notify = true
         AND ac.notify_phones IS NOT NULL
         AND array_length(ac.notify_phones, 1) > 0
         AND ac.next_run_at > NOW()
         AND ac.next_run_at <= NOW() + INTERVAL '24 hours'
         AND NOT EXISTS (
           SELECT 1 FROM auto_campaign_runs acr
           WHERE acr.auto_campaign_id = ac.id
             AND acr.status = 'notified'
             AND acr.scheduled_at = ac.next_run_at
         )
       ORDER BY ac.next_run_at ASC`
    );

    if (result.rows.length === 0) return;

    console.log(`${logPrefix} 사전 알림 대상 ${result.rows.length}건`);

    for (const ac of result.rows) {
      await sendPreNotification(ac);
    }
  } catch (err: any) {
    console.error(`${logPrefix} 사전 알림 워커 에러:`, err);
  }
}

async function sendPreNotification(ac: any): Promise<void> {
  const logPrefix = `[auto-worker][notify][${ac.id}]`;

  try {
    // 라인그룹 체크
    if (!(await hasCompanyLineGroup(ac.company_id))) {
      console.warn(`${logPrefix} 라인그룹 미설정 — 알림 스킵`);
      return;
    }

    const companyTables = await getCompanySmsTables(ac.company_id, ac.user_id);
    const sendTime = toKoreaTimeStr(new Date());

    // 발송 예정 시각 (KST)
    const scheduledKst = new Date(ac.next_run_at).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

    // 사용할 메시지 결정 (AI 생성 문안 or 고정 문안)
    const messageContent = ac.ai_generate_enabled && ac.generated_message_content
      ? ac.generated_message_content
      : ac.message_content;

    // 알림 메시지 구성
    const notifyMessage = `[자동발송 사전알림]\n\n캠페인: ${ac.campaign_name}\n발송 예정: ${scheduledKst}\n타입: ${ac.message_type}\n\n▼ 발송 문안 미리보기 ▼\n${messageContent}\n\n※ 취소하려면 관리자 페이지에서 자동발송을 일시정지해주세요.`;

    // notify_phones에 테스트 발송
    const phones: string[] = ac.notify_phones || [];
    if (phones.length === 0) return;

    const notifyRows: any[][] = [];
    for (const phone of phones) {
      const cleanPhone = normalizePhone(phone);
      if (!cleanPhone) continue;
      notifyRows.push([
        cleanPhone, ac.callback_number, notifyMessage, 'L',  // 알림은 LMS로 (본문이 길어서)
        `[사전알림] ${ac.campaign_name}`, sendTime, null, ac.company_id,
        '', '', ''
      ]);
    }

    if (notifyRows.length > 0) {
      await bulkInsertSmsQueue(companyTables, notifyRows, true);
    }

    // auto_campaign_runs에 notified 기록
    const runNumberResult = await query(
      `SELECT COALESCE(MAX(run_number), 0) + 1 as next_run FROM auto_campaign_runs WHERE auto_campaign_id = $1`,
      [ac.id]
    );
    await query(
      `INSERT INTO auto_campaign_runs (
        auto_campaign_id, run_number, status, scheduled_at, notified_at, notify_message,
        generated_message_content, generated_message_subject, ai_generation_status
      ) VALUES ($1, $2, 'notified', $3, NOW(), $4, $5, $6, $7)`,
      [
        ac.id, runNumberResult.rows[0].next_run, ac.next_run_at, notifyMessage,
        ac.generated_message_content || null,
        ac.generated_message_subject || null,
        ac.ai_generate_enabled ? (ac.generated_message_content ? 'ai_generated' : 'ai_fallback') : 'fixed',
      ]
    );

    console.log(`${logPrefix} 사전 알림 발송 완료 → ${phones.length}명`);
  } catch (err: any) {
    console.error(`${logPrefix} 사전 알림 에러:`, err);
  }
}

// ============================================================
// ★ 3단계: D-day 실제 발송 (기존 executeAutoCampaign 개선)
// AI 생성 문안이 있으면 그것 사용, 없으면 고정 메시지
// ============================================================

async function executeAutoCampaign(ac: any): Promise<void> {
  const logPrefix = `[auto-worker][${ac.id}][${ac.campaign_name}]`;

  try {
    console.log(`${logPrefix} 실행 시작`);

    // ★ D83: 이중 실행 방지 — status를 'executing'으로 원자적 전환 (진짜 잠금)
    // 이전: active→active 업데이트는 잠금 역할 못 함 → 워커 재시작 시 중복 실행 → 3건 중복 발송
    const lockResult = await query(
      `UPDATE auto_campaigns SET status = 'executing', updated_at = NOW()
       WHERE id = $1 AND status = 'active' AND next_run_at <= NOW()
       RETURNING id`,
      [ac.id]
    );
    if (lockResult.rows.length === 0) {
      console.log(`${logPrefix} 이미 처리 중이거나 완료됨 (스킵)`);
      return;
    }

    // ★ 라인그룹 미설정 체크
    if (!(await hasCompanyLineGroup(ac.company_id))) {
      console.warn(`${logPrefix} 라인그룹 미설정 — 스킵`);
      await markFailed(ac, '발송 라인그룹 미설정');
      return;
    }

    // ★ 발송 시간대 체크
    if (!isWithinSendHours()) {
      console.warn(`${logPrefix} 발송 허용 시간 외 — 스킵`);
      await markFailed(ac, '발송 허용 시간 외');
      return;
    }

    const companyTables = await getCompanySmsTables(ac.company_id, ac.user_id);

    // 회사 스키마 조회 (변수 치환용)
    // ★ D102: prepareFieldMappings 컨트롤타워로 통합 (customer_schema 조회 + extractVarCatalog + enrichWithCustomFields)
    const fieldMappings = await prepareFieldMappings(ac.company_id);

    // 동적 SELECT 컬럼 구성
    const baseColumns = ['id', 'phone', 'custom_fields'];
    const mappingColumns = Object.values(fieldMappings).filter((m: any) => m.storageType !== 'custom_fields').map((m: any) => m.column);
    const selectColumns = [...new Set([...baseColumns, ...mappingColumns])].join(', ');

    // ★ customer-filter로 타겟 필터링
    const filterResult = buildFilterQueryCompat(ac.target_filter, ac.company_id);

    // store_code 필터
    let storeFilter = '';
    const storeParams: any[] = [];
    if (ac.store_code) {
      storeFilter = ` AND c.store_code = $${filterResult.nextIndex}`;
      storeParams.push(ac.store_code);
    }

    // ★ 수신거부 필터 (user_id 기준 — B17-01 준수)
    const unsubParamIdx = filterResult.nextIndex + storeParams.length;
    const unsubFilter = ` AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubParamIdx} AND u.phone = c.phone)`;

    const customersResult = await query(
      `SELECT ${selectColumns} FROM customers c
       WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true
       ${filterResult.where}${storeFilter}${unsubFilter}`,
      [ac.company_id, ...filterResult.params, ...storeParams, ac.user_id]
    );

    const customers = customersResult.rows;

    if (customers.length === 0) {
      console.log(`${logPrefix} 타겟 고객 0명 — 스킵`);
      await markFailed(ac, '타겟 고객 없음 (필터 결과 0명)');
      return;
    }

    console.log(`${logPrefix} 타겟 ${customers.length}명`);

    // ★ 기능 3: AI 생성 문안 vs 고정 메시지 결정
    // 폴백 체인: generated_message_content → fallback_message_content → message_content
    let messageContent: string;
    let messageSubject: string;
    let aiGenerationStatus: string;

    if (ac.ai_generate_enabled && ac.generated_message_content) {
      messageContent = ac.generated_message_content;
      messageSubject = ac.generated_message_subject || ac.message_subject || '';
      aiGenerationStatus = 'ai_generated';
      console.log(`${logPrefix} AI 생성 문안 사용 (${messageContent.length}자)`);
    } else if (ac.ai_generate_enabled && ac.fallback_message_content) {
      messageContent = ac.fallback_message_content;
      messageSubject = ac.message_subject || '';
      aiGenerationStatus = 'ai_fallback';
      console.warn(`${logPrefix} AI 생성 문안 없음 → 폴백 메시지 사용`);
    } else {
      messageContent = ac.message_content || '';
      messageSubject = ac.message_subject || '';
      aiGenerationStatus = 'fixed';
    }

    if (!messageContent) {
      console.warn(`${logPrefix} 메시지 내용 없음 — 스킵`);
      await markFailed(ac, '메시지 내용 없음 (AI 생성 실패 + 폴백 없음)');
      return;
    }

    // ★ campaign_runs에 run 기록
    const runNumberResult = await query(
      `SELECT COALESCE(MAX(run_number), 0) + 1 as next_run FROM auto_campaign_runs WHERE auto_campaign_id = $1`,
      [ac.id]
    );
    const runNumber = runNumberResult.rows[0].next_run;

    // ★ campaigns 테이블에 연결 레코드 생성
    const campaignResult = await query(
      `INSERT INTO campaigns (
        company_id, campaign_name, message_type, target_filter,
        message_content, subject, message_subject, message_template,
        is_ad, target_count, created_by, callback_number, status, send_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $6, $5, $7, $8, $9, $10, 'sending', 'auto')
      RETURNING id`,
      [
        ac.company_id,
        `[자동] ${ac.campaign_name} #${runNumber}`,
        ac.message_type,
        JSON.stringify(ac.target_filter),
        messageContent,
        messageSubject || null,
        ac.is_ad ?? false,
        customers.length,
        ac.user_id,
        ac.callback_number,
      ]
    );
    const campaignId = campaignResult.rows[0].id;

    // auto_campaign_runs 기록
    const runResult = await query(
      `INSERT INTO auto_campaign_runs (
        auto_campaign_id, campaign_id, run_number, target_count, status, scheduled_at, started_at,
        generated_message_content, generated_message_subject, ai_generation_status
      ) VALUES ($1, $2, $3, $4, 'sending', $5, NOW(), $6, $7, $8)
      RETURNING id`,
      [
        ac.id, campaignId, runNumber, customers.length, ac.next_run_at,
        ac.ai_generate_enabled ? messageContent : null,
        ac.ai_generate_enabled ? (messageSubject || null) : null,
        aiGenerationStatus,
      ]
    );
    const runId = runResult.rows[0].id;

    // ★ 선불 차감 (prepaid.ts 재활용)
    const deduct = await prepaidDeduct(ac.company_id, customers.length, ac.message_type, campaignId, ac.user_id);
    if (!deduct.ok) {
      console.warn(`${logPrefix} 잔액 부족 — ${deduct.error}`);
      await query(
        `UPDATE auto_campaign_runs SET status = 'failed', completed_at = NOW(), cancel_reason = $2 WHERE id = $1`,
        [runId, `잔액 부족: ${deduct.error}`]
      );
      await advanceNextRun(ac);
      return;
    }

    // ★ MySQL 큐 INSERT
    const sendTime = toKoreaTimeStr(new Date());
    const msgTypeCode = ac.message_type === 'SMS' ? 'S' : ac.message_type === 'LMS' ? 'L' : 'M';
    const mmsImages: string[] = [];  // MMS 이미지는 추후 지원

    // ★ D93: 개별회신번호 사용 시 CT-08 필터링 적용
    let filteredCustomers = customers;
    if (ac.use_individual_callback) {
      const { filterByIndividualCallback } = await import('./callback-filter');
      const cbResult = await filterByIndividualCallback(customers, ac.company_id);
      filteredCustomers = cbResult.filtered;
      if (cbResult.callbackSkippedCount > 0) {
        console.log(`${logPrefix} 개별회신번호 — ${cbResult.callbackSkippedCount}명 제외 (미보유 ${cbResult.callbackMissingCount}, 미등록 ${cbResult.callbackUnregisteredCount})`);
      }
    }

    // ★ D102: (광고)+080 — CT-AD 컨트롤타워 사용 (기존 누락 수정)
    const autoOpt080 = (ac.is_ad) ? await getOpt080Number(ac.user_id, ac.company_id) : '';

    const autoSmsRows: any[][] = [];
    for (const customer of filteredCustomers) {
      let personalizedMessage = replaceVariables(messageContent, customer, fieldMappings);
      // ★ D102: (광고) 접두사 + 080 수신거부 접미사 — 컨트롤타워 한 줄
      personalizedMessage = buildAdMessage(personalizedMessage, ac.message_type, ac.is_ad ?? false, autoOpt080);
      const personalizedSubject = messageSubject;
      const cleanPhone = normalizePhone(customer.phone);
      // ★ D93: 개별회신번호 사용 시 고객별 store_phone → callback
      const callback = ac.use_individual_callback
        ? (customer.store_phone || customer.callback || ac.callback_number)
        : ac.callback_number;

      autoSmsRows.push([
        cleanPhone, callback, personalizedMessage, msgTypeCode,
        personalizedSubject, sendTime, campaignId, ac.company_id,
        mmsImages[0] || '', mmsImages[1] || '', mmsImages[2] || ''
      ]);
    }

    const sentCount = await bulkInsertSmsQueue(companyTables, autoSmsRows, true);

    // ★ 부분 실패 시 환불
    const failCount = filteredCustomers.length - sentCount;
    if (failCount > 0) {
      console.warn(`${logPrefix} 부분 실패 — 성공: ${sentCount}, 실패: ${failCount}`);
      try {
        await prepaidRefund(ac.company_id, failCount, ac.message_type, campaignId, `자동발송 부분실패 ${failCount}건 환불`);
      } catch (refundErr) {
        console.error(`${logPrefix} 부분 실패 환불 오류:`, refundErr);
      }
    }

    // ★ auto_campaign_runs 완료 처리
    await query(
      `UPDATE auto_campaign_runs SET
        sent_count = $2, success_count = $2, fail_count = $3,
        status = $4, completed_at = NOW()
       WHERE id = $1`,
      [runId, sentCount, failCount, sentCount === 0 ? 'failed' : 'completed']
    );

    // ★ campaigns 상태 업데이트
    await query(
      `UPDATE campaigns SET status = 'sending', sent_count = $2, sent_at = NOW() WHERE id = $1`,
      [campaignId, sentCount]
    );

    // ★ campaign_runs 연결 레코드
    await query(
      `INSERT INTO campaign_runs (campaign_id, run_number, target_count, sent_count, status, sent_at)
       VALUES ($1, 1, $2, $3, 'sending', NOW())`,
      [campaignId, customers.length, sentCount]
    );

    // ★ auto_campaigns 통계 + next_run_at 갱신 + generated 초기화
    await advanceNextRun(ac, sentCount);

    // AI 모드: 생성 문안 초기화 (다음 회차에 새로 생성하도록)
    if (ac.ai_generate_enabled) {
      await query(
        `UPDATE auto_campaigns SET generated_message_content = NULL, generated_message_subject = NULL, generated_at = NULL WHERE id = $1`,
        [ac.id]
      );
    }

    console.log(`${logPrefix} 완료 — ${sentCount}/${customers.length}건 발송 (${aiGenerationStatus})`);
  } catch (err: any) {
    console.error(`${logPrefix} 실행 중 에러:`, err);
    await markFailed(ac, `실행 에러: ${err.message || '알 수 없는 오류'}`);
  }
}

// ============================================================
// 헬퍼: 실패 처리 + next_run_at 갱신
// ============================================================

async function markFailed(ac: any, reason: string): Promise<void> {
  try {
    const runNumberResult = await query(
      `SELECT COALESCE(MAX(run_number), 0) + 1 as next_run FROM auto_campaign_runs WHERE auto_campaign_id = $1`,
      [ac.id]
    );
    await query(
      `INSERT INTO auto_campaign_runs (auto_campaign_id, run_number, status, scheduled_at, completed_at, cancel_reason)
       VALUES ($1, $2, 'failed', $3, NOW(), $4)`,
      [ac.id, runNumberResult.rows[0].next_run, ac.next_run_at, reason]
    );
  } catch (err) {
    console.error(`[auto-worker][${ac.id}] 실패 기록 오류:`, err);
  }

  await advanceNextRun(ac);
}

async function advanceNextRun(ac: any, sentCount?: number): Promise<void> {
  try {
    const scheduleTime = typeof ac.schedule_time === 'string'
      ? ac.schedule_time
      : `${String(ac.schedule_time.hours || 0).padStart(2, '0')}:${String(ac.schedule_time.minutes || 0).padStart(2, '0')}`;

    const nextRunAt = calcNextRunAt(ac.schedule_type, ac.schedule_day, scheduleTime);

    // ★ D83: executing → active 복원 (잠금 해제) + next_run_at 전진
    const updateFields = sentCount !== undefined
      ? `status = 'active', next_run_at = $2, last_run_at = NOW(), total_runs = total_runs + 1, total_sent = total_sent + $3, updated_at = NOW()`
      : `status = 'active', next_run_at = $2, updated_at = NOW()`;

    const params = sentCount !== undefined
      ? [ac.id, nextRunAt, sentCount]
      : [ac.id, nextRunAt];

    await query(`UPDATE auto_campaigns SET ${updateFields} WHERE id = $1`, params);
  } catch (err) {
    console.error(`[auto-worker][${ac.id}] next_run_at 갱신 오류:`, err);
  }
}

// ============================================================
// 메인 실행 함수 (3단계 순차 실행)
// ============================================================

export async function runAutoCampaignWorker(): Promise<void> {
  const logPrefix = '[auto-worker]';

  try {
    // ★ 1단계: D-2 AI 문안 생성 (24~48시간 전)
    await runMessageGeneration();

    // ★ 2단계: D-1 사전 알림 (0~24시간 전)
    await runPreNotification();

    // ★ 3단계: D-day 발송 (next_run_at <= NOW())
    const result = await query(
      `SELECT * FROM auto_campaigns
       WHERE status = 'active' AND next_run_at <= NOW()
       ORDER BY next_run_at ASC`
    );

    if (result.rows.length === 0) return;

    console.log(`${logPrefix} ${result.rows.length}건 도래 — 실행 시작`);

    // 순차 실행 (병렬 X — 기간계 안정성)
    for (const ac of result.rows) {
      await executeAutoCampaign(ac);
    }

    console.log(`${logPrefix} 전체 실행 완료`);
  } catch (err: any) {
    console.error(`${logPrefix} 워커 에러:`, err);
  }
}

// ============================================================
// setInterval 기반 실행 (app.ts에서 호출)
// ============================================================

// ★ D102: 1시간→10분 (최대 지연 9분으로 축소, 11시 설정→11:49 발송 문제 해결)
const WORKER_INTERVAL_MS = 10 * 60 * 1000; // 10분

export function startAutoCampaignScheduler(): void {
  console.log('[auto-worker] 자동발송 스케줄러 시작 (매 10분 체크, 3단계 라이프사이클)');

  // 기동 시 즉시 1회 실행
  runAutoCampaignWorker().catch(err => {
    console.error('[auto-worker] 초기 실행 에러:', err);
  });

  // 이후 매 10분마다
  setInterval(() => {
    runAutoCampaignWorker().catch(err => {
      console.error('[auto-worker] 정기 실행 에러:', err);
    });
  }, WORKER_INTERVAL_MS);
}
