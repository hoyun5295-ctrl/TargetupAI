/**
 * ★ D69+AI Premium: 자동발송 PM2 워커 (4단계 라이프사이클)
 *
 * 실행 방식: app.ts 내부 setInterval (매 1분, 정각 align)
 *   - 워커 시작 시 다음 분의 0초까지 대기 후 첫 실행
 *   - 이후 60초 간격으로 반복
 *   - 정각 발송 설정(예: 11:00)이 최대 60초 이내에 잡히도록 보장 (B7 fix)
 *
 * ★ 4단계 라이프사이클 (AI 문안 자동생성 지원):
 *   D-2 23:00  → runMessageGeneration()  — AI 문안 생성 + 담당자 알림
 *   D-1        → runPreNotification()    — 담당자에게 사전알림
 *   D-day 2h전 → runPreSendSpamTest()    — 스팸테스트 + 결과 알림
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
 * - target-sample.ts (CT-A, B5) → 타겟 첫 고객 조회 (스팸테스트 개인화)
 * - auto-notify-message.ts (CT-B, B6) → 담당자 알림 메시지 빌더
 *
 * 실패 정책: 스킵 + failed 기록 → next_run_at 다음 스케줄로 갱신 (중복 발송 방지)
 */

import { query } from '../config/database';
import { buildFilterQueryCompat } from './customer-filter';
import { getOpt080Number, prepareFieldMappings, prepareSendMessage } from './messageUtils';
import {
  toKoreaTimeStr, toQtmsgType,
  getCompanySmsTables, getAuthSmsTable, hasCompanyLineGroup, getNextSmsTable,
  bulkInsertSmsQueue,
} from './sms-queue';
import { prepaidDeduct, prepaidRefund } from './prepaid';
import { normalizePhone } from './normalize-phone';
import { resolveCustomerCallback } from './callback-filter';
import { extractVarCatalog, generateMessages } from '../services/ai';
import { autoSpamTestWithRegenerate } from './spam-test-queue';
import { buildUnsubscribeFilter } from './unsubscribe-helper';
import { SEND_HOURS } from '../config/defaults';
// ★ B5/B6: 신규 컨트롤타워
import { fetchTargetSampleCustomer } from './target-sample';
import {
  buildAiGeneratedNotifyMessage,
  buildPreNotifyMessage,
  buildSpamTestResultNotifyMessage,
} from './auto-notify-message';

// ============================================================
// next_run_at 계산 (auto-campaigns.ts와 동일 로직)
// ============================================================

/**
 * ★ D111 E2: next_run_at 계산 컨트롤타워
 *
 * 이전: auto-campaigns.ts(routes)와 auto-campaign-worker.ts(utils) 2곳에 동일 로직 중복 →
 *       한쪽 수정 시 불일치 → 발송 시각 오차 재발 위험.
 * 이후: utils에 export — routes가 import해서 사용. 유일한 진입점.
 *
 * 로직:
 * - 서버 타임존에 관계없이 KST 기준으로 다음 실행 시각 계산
 * - Date.UTC + KST_OFFSET_MS 보정 (D83 — 이중변환 방지)
 * - daily: 오늘 시각이 지났으면 내일
 * - weekly: 이번 주 요일이 지났으면 다음 주
 * - monthly: 이번 달 날짜가 지났으면 다음 달
 */
export function calcNextRunAt(scheduleType: string, scheduleDay: number | null, scheduleTime: string): Date {
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
    // ★ B+0407-4: 개인화 변수 — ac.personal_fields에서 가져와 generateMessages에 전달
    //   누락 시 AI가 개인화 변수를 만들지 않는 버그 발생 (0407 PDF #6)
    //   ⚠️ services/ai.ts 시그니처는 personalizationVars (이름 일치 필수)
    const personalizationVars: string[] = Array.isArray(ac.personal_fields) ? ac.personal_fields : [];
    const usePersonalization = personalizationVars.length > 0;

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
      // ★ B+0407-4: 개인화 활성화 + 변수 목록 전달 (services/ai.ts 시그니처와 일치)
      usePersonalization,
      personalizationVars,
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
        // ★ B5: 타겟 첫 고객 조회 — CT-A target-sample.ts (인라인 SELECT 제거)
        //   store_code 격리 + 수신거부 제외 자동 적용
        const sampleResult = await fetchTargetSampleCustomer({
          companyId: ac.company_id,
          targetFilter: ac.target_filter,
          userId: ac.user_id,
          storeCode: ac.store_code,
        });
        const firstRecipient = sampleResult.raw || undefined;

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

    // ★ D105 P7: AI 문안 생성 완료 후 담당자에게 알림 SMS 발송
    // ★ D106: 담당자 알림은 테스트 라인으로 발송 (대량발송 Agent 차단 시에도 발송 가능)
    const phones: string[] = ac.notify_phones || [];
    if (phones.length > 0) {
      try {
        const companyTables = [await getAuthSmsTable()];
        const sendTime = toKoreaTimeStr(new Date());

        const scheduledDate = new Date(ac.next_run_at);
        const scheduledDateStr = scheduledDate.toLocaleString('ko-KR', {
          timeZone: 'Asia/Seoul',
          month: 'long', day: 'numeric',
        });
        const scheduledTimeStr = scheduledDate.toLocaleString('ko-KR', {
          timeZone: 'Asia/Seoul',
          hour: '2-digit', minute: '2-digit', hour12: false,
        });

        // ★ D111 P5: (광고)+무료거부 부착 — isAd/opt080Number 전달 (buildAdMessage 내장)
        const genOpt080 = ac.is_ad ? await getOpt080Number(ac.user_id, ac.company_id) : '';
        const genNotifyMsg = buildAiGeneratedNotifyMessage({
          campaignName: ac.campaign_name,
          scheduledDateStr,
          scheduledTimeStr,
          messageType: ac.message_type,
          messageContent: generatedContent,
          isAd: ac.is_ad ?? false,
          opt080Number: genOpt080,
        });

        const genNotifyRows: any[][] = [];
        for (const phone of phones) {
          const cleanPhone = normalizePhone(phone);
          if (!cleanPhone) continue;
          genNotifyRows.push([
            cleanPhone, ac.callback_number, genNotifyMsg, 'L',
            `[AI문안생성] ${ac.campaign_name}`, sendTime, null, ac.company_id,
            '', '', ''
          ]);
        }

        if (genNotifyRows.length > 0) {
          await bulkInsertSmsQueue(companyTables, genNotifyRows, true);
          console.log(`${logPrefix} AI 문안 생성 알림 → ${genNotifyRows.length}명`);
        }
      } catch (notifyErr) {
        console.error(`${logPrefix} AI 문안 생성 알림 발송 실패 (무시):`, notifyErr);
      }
    }
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
    // ★ D106: 담당자 알림은 테스트 라인으로 발송 (대량발송 Agent 차단 시에도 발송 가능)
    const companyTables = [await getAuthSmsTable()];
    const sendTime = toKoreaTimeStr(new Date());

    // ★ D105: 발송 예정 시각 — "내일 XX시 XX분" 형식
    const scheduledDate = new Date(ac.next_run_at);
    const scheduledTimeStr = scheduledDate.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const scheduledDateStr = scheduledDate.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'long', day: 'numeric',
    });

    // ★ D105: 타겟 고객 수 실시간 조회 (CT-01 + CT-03 재활용)
    let targetCount = 0;
    try {
      const filterResult = buildFilterQueryCompat(ac.target_filter, ac.company_id);
      let storeFilter = '';
      const storeParams: any[] = [];
      if (ac.store_code) {
        storeFilter = ` AND c.store_code = $${filterResult.nextIndex}`;
        storeParams.push(ac.store_code);
      }
      const unsubParamIdx = filterResult.nextIndex + storeParams.length;
      const unsubFilter = buildUnsubscribeFilter(`$${unsubParamIdx}`, 'c.phone');
      const countResult = await query(
        `SELECT COUNT(*) as cnt FROM customers c
         WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true
         ${filterResult.where}${storeFilter}${unsubFilter}`,
        [ac.company_id, ...filterResult.params, ...storeParams, ac.user_id]
      );
      targetCount = parseInt(countResult.rows[0].cnt);
    } catch (countErr) {
      console.warn(`${logPrefix} 타겟 수 조회 실패 (무시):`, countErr);
    }

    // 사용할 메시지 결정 (AI 생성 문안 or 고정 문안)
    const messageContent = ac.ai_generate_enabled && ac.generated_message_content
      ? ac.generated_message_content
      : ac.message_content;

    // ★ D111 P5: (광고)+무료거부 부착 — isAd/opt080Number 전달 (buildAdMessage 내장)
    const preOpt080 = ac.is_ad ? await getOpt080Number(ac.user_id, ac.company_id) : '';
    const notifyMessage = buildPreNotifyMessage({
      campaignName: ac.campaign_name,
      scheduledDateStr,
      scheduledTimeStr,
      targetCount,
      messageType: ac.message_type,
      messageContent,
      isAd: ac.is_ad ?? false,
      opt080Number: preOpt080,
    });

    // notify_phones에 알림 발송
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

    console.log(`${logPrefix} 사전 알림 발송 완료 → ${phones.length}명 (타겟 ${targetCount}명)`);
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
    const msgTypeCode = toQtmsgType(ac.message_type);
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
      // ★ D103: prepareSendMessage 컨트롤타워 — 변수 치환 + (광고)+080 한 함수로 통합
      const personalizedMessage = prepareSendMessage(messageContent, customer, fieldMappings, {
        msgType: ac.message_type, isAd: ac.is_ad ?? false, opt080Number: autoOpt080,
      });
      const personalizedSubject = messageSubject;
      const cleanPhone = normalizePhone(customer.phone);
      // ★ D103: resolveCustomerCallback 컨트롤타워 — 개별회신번호 resolve 통합
      const callback = resolveCustomerCallback(customer, ac.use_individual_callback || false, ac.callback_number);

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
// ★ 3단계: D-day 2시간 전 자동 스팸테스트 + 담당자 알림 (D105 신설)
// next_run_at 0~2시간 이내 AND 아직 스팸테스트 안 한 건
// ============================================================

async function runPreSendSpamTest(): Promise<void> {
  const logPrefix = '[auto-worker][spam]';

  try {
    const result = await query(
      `SELECT ac.* FROM auto_campaigns ac
       WHERE ac.status = 'active'
         AND ac.callback_number IS NOT NULL
         AND ac.next_run_at > NOW()
         AND ac.next_run_at <= NOW() + INTERVAL '2 hours'
         AND NOT EXISTS (
           SELECT 1 FROM auto_campaign_runs acr
           WHERE acr.auto_campaign_id = ac.id
             AND acr.status = 'spam_tested'
             AND acr.scheduled_at = ac.next_run_at
         )
       ORDER BY ac.next_run_at ASC`
    );

    if (result.rows.length === 0) return;

    console.log(`${logPrefix} D-day 스팸테스트 대상 ${result.rows.length}건`);

    for (const ac of result.rows) {
      await executePreSendSpamTest(ac);
    }
  } catch (err: any) {
    console.error(`${logPrefix} 스팸테스트 워커 에러:`, err);
  }
}

async function executePreSendSpamTest(ac: any): Promise<void> {
  const logPrefix = `[auto-worker][spam][${ac.id}]`;

  try {
    // 사용할 메시지 결정 (AI 생성 문안 or 고정 문안)
    const messageContent = ac.ai_generate_enabled && ac.generated_message_content
      ? ac.generated_message_content
      : ac.message_content;

    if (!messageContent) {
      console.warn(`${logPrefix} 메시지 내용 없음 — 스팸테스트 스킵`);
      return;
    }

    const channel = ac.message_type || 'SMS';

    // ★ B5: 타겟 첫 고객 조회 — CT-A target-sample.ts
    //   기존 인라인 SELECT는 store_code/수신거부 필터 누락으로 다른 브랜드 고객을 가져오는 버그 발생
    //   CT-A가 store_code 격리 + 수신거부 제외를 자동 적용
    const sampleRes = await fetchTargetSampleCustomer({
      companyId: ac.company_id,
      targetFilter: ac.target_filter,
      userId: ac.user_id,
      storeCode: ac.store_code,
    });
    const firstRecipient = sampleRes.raw || undefined;
    if (!sampleRes.matched) {
      console.warn(`${logPrefix} 스팸테스트용 첫 고객 조회 결과 0건 (필터 매칭 없음)`);
    }

    // ★ CT-09: autoSpamTestWithRegenerate 재활용
    // D-day 2시간 전 스팸테스트에서는 재생성하지 않음 (이미 문안이 확정된 상태)
    const spamResult = await autoSpamTestWithRegenerate({
      companyId: ac.company_id,
      userId: ac.user_id,
      callbackNumber: ac.callback_number,
      messageType: channel as 'SMS' | 'LMS' | 'MMS',
      variants: [{
        variantId: 'final',
        messageText: messageContent,
        subject: ac.message_subject || ac.generated_message_subject,
      }],
      isAd: ac.is_ad || false,
      rejectNumber: await getOpt080Number(ac.user_id, ac.company_id),
      firstRecipient,
      maxRetries: 0, // 재생성 없이 1회 테스트만
    });

    // 결과 판정
    const finalVariant = spamResult.variants[0];
    const isBlocked = finalVariant?.spamResult === 'blocked';
    // ★ D111 P6: 순수 '통과'/'차단' 문자열로 단순화. 이전 '통과 ✓' → 빌더 내부 replace(✓→'통과')와 겹쳐 '통과 통과' 중복 발생
    const resultLabel = isBlocked ? '차단' : '통과';

    console.log(`${logPrefix} 스팸테스트 완료 — ${resultLabel}`);

    // ★ auto_campaign_runs에 spam_tested 기록
    const runNumberResult = await query(
      `SELECT COALESCE(MAX(run_number), 0) + 1 as next_run FROM auto_campaign_runs WHERE auto_campaign_id = $1`,
      [ac.id]
    );
    await query(
      `INSERT INTO auto_campaign_runs (
        auto_campaign_id, run_number, status, scheduled_at, spam_test_result, ai_generation_status
      ) VALUES ($1, $2, 'spam_tested', $3, $4, $5)`,
      [
        ac.id, runNumberResult.rows[0].next_run, ac.next_run_at,
        JSON.stringify({ batchId: spamResult.batchId, isBlocked, result: resultLabel, variants: spamResult.variants }),
        ac.ai_generate_enabled ? (ac.generated_message_content ? 'ai_generated' : 'ai_fallback') : 'fixed',
      ]
    );

    // ★ 담당자에게 스팸테스트 결과 SMS 발송 (CT-04 재활용)
    // ★ D106: 담당자 알림은 테스트 라인으로 발송
    const phones: string[] = ac.notify_phones || [];
    if (phones.length > 0) {
      const companyTables = [await getAuthSmsTable()];
      const sendTime = toKoreaTimeStr(new Date());

      const scheduledTimeStr = new Date(ac.next_run_at).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });

      // ★ D111 P5: (광고)+무료거부 부착 — isAd/opt080Number 전달 (buildAdMessage 내장)
      const spamOpt080 = ac.is_ad ? await getOpt080Number(ac.user_id, ac.company_id) : '';
      const notifyMsg = buildSpamTestResultNotifyMessage({
        campaignName: ac.campaign_name,
        scheduledTimeStr,
        spamResultLabel: resultLabel,
        spamBlocked: isBlocked,
        messageType: ac.message_type,
        messageContent,
        isAd: ac.is_ad ?? false,
        opt080Number: spamOpt080,
      });

      const notifyRows: any[][] = [];
      for (const phone of phones) {
        const cleanPhone = normalizePhone(phone);
        if (!cleanPhone) continue;
        notifyRows.push([
          cleanPhone, ac.callback_number, notifyMsg, 'L',
          `[스팸테스트] ${ac.campaign_name}`, sendTime, null, ac.company_id,
          '', '', ''
        ]);
      }

      if (notifyRows.length > 0) {
        await bulkInsertSmsQueue(companyTables, notifyRows, true);
        console.log(`${logPrefix} 스팸테스트 결과 알림 → ${notifyRows.length}명`);
      }
    }
  } catch (err: any) {
    console.error(`${logPrefix} 스팸테스트 에러:`, err);
  }
}

// ============================================================
// 메인 실행 함수 (4단계 순차 실행)
// ============================================================

export async function runAutoCampaignWorker(): Promise<void> {
  const logPrefix = '[auto-worker]';

  try {
    // ★ 1단계: D-2 AI 문안 생성 (24~48시간 전)
    await runMessageGeneration();

    // ★ 2단계: D-1 사전 알림 (0~24시간 전)
    await runPreNotification();

    // ★ 3단계: D-day 2시간 전 스팸테스트 (D105 신설)
    await runPreSendSpamTest();

    // ★ 4단계: D-day 발송 (next_run_at <= NOW())
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

// ★ B7: 3분→1분 + 정각 align (정각 발송 최대 지연 60초 보장)
//   D106 3분 → 11:00 발송 설정인데 11:02에 잡히는 케이스(2분 지연) 발생
//   1분 + 다음 분의 0초에 align하면 11:00:00~11:00:59 사이 무조건 잡힘
const WORKER_INTERVAL_MS = 60 * 1000; // 1분

export function startAutoCampaignScheduler(): void {
  console.log('[auto-worker] 자동발송 스케줄러 시작 (매 1분 체크, 다음 분 0초 align, 4단계 라이프사이클)');

  // 기동 시 즉시 1회 실행 (현재 도래한 건 처리)
  runAutoCampaignWorker().catch(err => {
    console.error('[auto-worker] 초기 실행 에러:', err);
  });

  // ★ B7: 다음 분의 0초까지 대기 후 정각 align
  //   예: 현재 14:23:47 → 13초 후(14:24:00)에 첫 align 실행 → 이후 60초 간격
  const now = Date.now();
  const msToNextMinute = 60_000 - (now % 60_000);
  setTimeout(() => {
    // 정각 첫 실행
    runAutoCampaignWorker().catch(err => {
      console.error('[auto-worker] align 첫 실행 에러:', err);
    });
    // 이후 매 1분마다 (정각 ± 약간의 jitter)
    setInterval(() => {
      runAutoCampaignWorker().catch(err => {
        console.error('[auto-worker] 정기 실행 에러:', err);
      });
    }, WORKER_INTERVAL_MS);
  }, msToNextMinute);
}
