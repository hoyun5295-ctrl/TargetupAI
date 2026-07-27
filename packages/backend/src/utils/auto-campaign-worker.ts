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
import { fillAlimtalkVarMap } from './alimtalk-vars';
import { resolveAlimtalkFallback } from './alimtalk-fallback';
import { convertButtonsToQTmsg } from './alimtalk-button';
import { buildAlimtalkEtcJson } from './alimtalk-emphasize';
import {
  toKoreaTimeStr, toQtmsgType,
  getCompanySmsTables, getAuthSmsTable, hasCompanyLineGroup, getNextSmsTable,
  bulkInsertSmsQueue, AlimtalkQueueInsertError,
} from './sms-queue';
import { prepaidDeduct, prepaidRefund, REFUND_KEYS } from './prepaid';
import { markRefundPending } from './refund-pending';
import { normalizePhone } from './normalize-phone';
import { resolveCustomerCallback } from './callback-filter';
// ★ 2026-07-05: 발송 피로도 보호 — 차감 전 게이트 + 광고 발송 카운터
import { getFatigueCap, getFatigueBlockedSet, recordFatigueSends } from './fatigue-guard';
import { extractVarCatalog, filterVarCatalogByData, generateMessages } from '../services/ai';
import { autoSpamTestWithRegenerate } from './spam-test-queue';
import { buildUnsubscribeFilter } from './unsubscribe-helper';
// ★ D114 P7: personalFields → displayName 변환용
import { getFieldByKey } from './standard-field-map';
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
// ★ 1단계: D-1 AI 문안 생성 + 스팸테스트
// ai_generate_enabled=true AND next_run_at 12~36시간 이내 AND 아직 미생성
//
// ★ D142 (2026-04-28) Harold님 정책:
//   "하루전날 문안생성하고 테스트하고 그 문안으로 다음날 발송시점 2시간전에 테스트하고
//    스팸에 안걸리면 담당자에게 테스트보내는걸로 자동으로 예약이 걸리게 하면 되잖아?"
//   → 4단계(D-2 생성/D-1 사전알림/D-day 2h 스팸/D-day 발송) → 3단계로 단순화.
//   → 1단계(생성+스팸)를 D-1 시점으로 당김 (PDF 0428 #7 — D-2 미만 풀백 무한리턴 차단).
//   → 사전알림(`runPreNotification`)은 메인 루프에서 호출 제거 (단계 자체 폐지).
// ============================================================

async function runMessageGeneration(): Promise<void> {
  const logPrefix = '[auto-worker][gen]';

  try {
    // ★ D153 (2026-05-13): 윈도우 12~36h → 23~25h로 좁힘 (D-1 정확 정합).
    //   → 기존 12~36h + cron 1분 tick은 first match가 next-36h 시점에 잡혀
    //     발송 36h 전(D-1 새벽 4시 등 부적절 시각)에 generate되던 사고 (PDF 0512 신고 2).
    //   → 5/13 16:00 발송 → 5/12 04:00에 generate되어 직원 새벽 알림 사고.
    // ★ D142 (2026-04-28) 12h 하한은 24h 미만 등록 풀백 무한리턴 차단 의도 — 여전히 유지
    //   (24h 미만은 L1131-1137 D-day 2h 전 fallback 분기에서 generate).
    //   → "하루 전날 문안생성"(Harold님 정책) — 23~25h 윈도우 = next-25h~next-24h first match.
    //   → 5/13 16:00 → 5/12 15:00~16:00 KST generate (직원 자연 D-1 인식 ✓).
    // ★ D114 P6: generating_at 잠금 — 워커 폴링 중복 픽업 방지 (AI 생성+스팸테스트 1분+ 소요)
    const result = await query(
      `SELECT * FROM auto_campaigns
       WHERE status = 'active'
         AND ai_generate_enabled = true
         AND next_run_at > NOW() + INTERVAL '23 hours'
         AND next_run_at <= NOW() + INTERVAL '25 hours'
         AND (generated_at IS NULL OR generated_at < NOW() - INTERVAL '25 hours')
         AND (generating_at IS NULL OR generating_at < NOW() - INTERVAL '30 minutes')
       ORDER BY next_run_at ASC`
    );

    if (result.rows.length === 0) return;

    console.log(`${logPrefix} AI 문안 생성 대상 ${result.rows.length}건`);

    for (const ac of result.rows) {
      // ★ D114 P6: 원자적 잠금 — generating_at 마킹 (다음 워커 tick에서 skip)
      const lockResult = await query(
        `UPDATE auto_campaigns SET generating_at = NOW()
         WHERE id = $1 AND (generating_at IS NULL OR generating_at < NOW() - INTERVAL '30 minutes')
         RETURNING id`,
        [ac.id]
      );
      if (lockResult.rows.length === 0) {
        console.log(`${logPrefix} ${ac.id} 이미 생성 중 — skip`);
        continue;
      }

      try {
        await generateMessageForAutoCampaign(ac);
      } catch (genErr) {
        // 실패 시 잠금 해제 (다음 tick에서 재시도 가능)
        await query('UPDATE auto_campaigns SET generating_at = NULL WHERE id = $1', [ac.id]);
        console.error(`${logPrefix} ${ac.id} 생성 실패 → 잠금 해제:`, genErr);
      }
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

    // ★ D121: 실제 데이터가 있는 필드만 남김 — filterVarCatalogByData 컨트롤타워
    await filterVarCatalogByData(varCatalog, availableVars, ac.company_id);

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
    // ★ D114 P7: 개인화 변수 — field key → displayName 변환
    //   이전: ['name','birth_date'] → AI가 %name% 생성 → replaceVariables에서 매칭 실패 → NULL
    //   수정: ['고객명','생일'] → AI가 %고객명% 생성 → replaceVariables에서 정상 매칭
    const rawPersonalFields: string[] = Array.isArray(ac.personal_fields) ? ac.personal_fields : [];
    // 커스텀 필드(custom_N) 라벨 조회
    let customFieldLabels: Record<string, string> = {};
    if (rawPersonalFields.some(k => k.startsWith('custom_'))) {
      const cfdResult = await query(
        `SELECT field_key, field_label FROM customer_field_definitions WHERE company_id = $1 AND field_key LIKE 'custom_%'`,
        [ac.company_id]
      );
      for (const row of cfdResult.rows) {
        customFieldLabels[row.field_key] = row.field_label;
      }
    }
    const personalizationVars: string[] = rawPersonalFields.map(key => {
      // FIELD_MAP에서 displayName 조회 (직접 컬럼 필드)
      const field = getFieldByKey(key);
      if (field) return field.displayName;
      // 커스텀 필드는 customer_field_definitions 라벨
      if (customFieldLabels[key]) return customFieldLabels[key];
      return key; // 폴백
    });
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
      // ★ D225+ Brand Voice Learning — 회사별 가이드라인 자동 주입
      companyId: ac.company_id,
    };

    const aiResult = await generateMessages(ac.ai_prompt || ac.campaign_name, targetInfo, extraContext);

    let generatedContent = '';
    let generatedSubject = '';
    let aiGenerationStatus = 'ai_generated';
    let spamTestResult: any = null;

    if (aiResult.variants && aiResult.variants.length > 0) {
      // ★ B12(0417 PDF #12): 요청A — 3개 variant → 1개로 축소
      //   기존: AI가 3 variant 생성 → 스팸테스트 3회 → 첫번째만 사용 = 2/3 낭비
      //   변경: 1 variant만 테스트. 차단 시 CT-09 재생성 로직(최대 2회) 유지.
      //   Harold님 지시 2026-04-21.
      let testedVariants = aiResult.variants.slice(0, 1);

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
            // ★ B12: testedVariants(1개) 전달 — 스팸테스트 3회 → 1회
            variants: testedVariants.map((v: any) => ({
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
    // ★ D150-3 (2026-05-10) LOW#8 fix: generating_at NULL 동시 정리 (잠금 해제).
    //   이전: generated_at만 갱신, generating_at은 그대로 → 다음 워커 polling에서 30분 timeout으로만 풀림.
    //   이후: 생성 완료 시점에 잠금 즉시 해제 (cosmetic, race 없음).
    await query(
      `UPDATE auto_campaigns SET
        generated_message_content = $2,
        generated_message_subject = $3,
        generated_at = NOW(),
        generating_at = NULL,
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

        // ★ D153 (2026-05-13): D-1 사전알림 통합 — 발송 대상 인원 수 계산 후 알림 SMS에 포함
        //   Harold님 정책 "D-1에 어떤 문안으로 몇 명에게 나가는지 안내" 정합.
        //   customer-filter (CT-01) + store_code + unsubscribes 필터 = 실제 발송 라우트(L694-714) 동일 패턴.
        //   COUNT만 조회 (실제 발송 시 재조회) — D-1 시점 추정치, 직원 사전 확인용.
        let d1TargetCount = 0;
        try {
          const filterRes = buildFilterQueryCompat(ac.target_filter, ac.company_id);
          let countStoreFilter = '';
          const countStoreParams: any[] = [];
          if (ac.store_code) {
            countStoreFilter = ` AND c.store_code = $${filterRes.nextIndex}`;
            countStoreParams.push(ac.store_code);
          }
          const countUnsubIdx = filterRes.nextIndex + countStoreParams.length;
          const countUnsubFilter = ` AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${countUnsubIdx} AND u.phone = c.phone)`;
          const countRes = await query(
            `SELECT COUNT(*)::int AS cnt FROM customers c
             WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true
             ${filterRes.where}${countStoreFilter}${countUnsubFilter}`,
            [ac.company_id, ...filterRes.params, ...countStoreParams, ac.user_id]
          );
          d1TargetCount = countRes.rows[0]?.cnt || 0;
        } catch (countErr) {
          console.error(`${logPrefix} D-1 발송 대상 카운트 실패 (알림은 발송, 인원 표시만 0):`, countErr);
        }

        const genNotifyMsg = buildAiGeneratedNotifyMessage({
          campaignName: ac.campaign_name,
          scheduledDateStr,
          scheduledTimeStr,
          targetCount: d1TargetCount,
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

          // ★ D123 P8: AI 문안 생성 알림도 이력에 기록 (이전에는 INSERT 누락 → 이력 탭에 안 나옴)
          //   status='ai_generated_notified' / target=sent=success=phones.length (알림류 run은 sync 대상 아님 → 즉시 기록)
          try {
            const runNumberResult = await query(
              `SELECT COALESCE(MAX(run_number), 0) + 1 as next_run FROM auto_campaign_runs WHERE auto_campaign_id = $1`,
              [ac.id]
            );
            await query(
              `INSERT INTO auto_campaign_runs (
                auto_campaign_id, run_number, status, scheduled_at, notified_at, notify_message,
                generated_message_content, generated_message_subject, ai_generation_status,
                target_count, sent_count, success_count
              ) VALUES ($1, $2, 'ai_generated_notified', $3, NOW(), $4, $5, $6, $7, $8, $8, $8)`,
              [
                ac.id, runNumberResult.rows[0].next_run, ac.next_run_at, genNotifyMsg,
                generatedContent,
                generatedSubject || null,
                aiGenerationStatus,
                genNotifyRows.length,
              ]
            );
          } catch (runInsertErr) {
            console.error(`${logPrefix} AI 생성 알림 run 기록 실패 (무시):`, runInsertErr);
          }
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
    // ★ D114 P8-1: target_count/sent_count 추가 — 알림 발송 1건 기록 (0 표시 방지)
    const runNumberResult = await query(
      `SELECT COALESCE(MAX(run_number), 0) + 1 as next_run FROM auto_campaign_runs WHERE auto_campaign_id = $1`,
      [ac.id]
    );
    // ★ D120 P7: 알림류 run은 sync 대상이 아니므로 success_count를 즉시 기록
    await query(
      `INSERT INTO auto_campaign_runs (
        auto_campaign_id, run_number, status, scheduled_at, notified_at, notify_message,
        generated_message_content, generated_message_subject, ai_generation_status,
        target_count, sent_count, success_count
      ) VALUES ($1, $2, 'notified', $3, NOW(), $4, $5, $6, $7, $8, $8, $8)`,
      [
        ac.id, runNumberResult.rows[0].next_run, ac.next_run_at, notifyMessage,
        ac.generated_message_content || null,
        ac.generated_message_subject || null,
        ac.ai_generate_enabled ? (ac.generated_message_content ? 'ai_generated' : 'ai_fallback') : 'fixed',
        phones.length,
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

    // ★ D150-3 (2026-05-10) HIGH#2 fix: 직전 spam_tested 결과가 차단(blocked)이면 본 발송 중단.
    //   이전: maxRetries:2 후에도 차단된 채로 spam_tested INSERT만 하고 본 발송 진행 → 사용자 정책 위반.
    //   이후: 본 발송 직전 spam_tested.spam_test_result.isBlocked 체크 → 차단 시 markFailed + 담당자 알림.
    try {
      const spamCheck = await query(
        `SELECT spam_test_result FROM auto_campaign_runs
         WHERE auto_campaign_id = $1
           AND status = 'spam_tested'
           AND scheduled_at = $2
         ORDER BY id DESC LIMIT 1`,
        [ac.id, ac.next_run_at]
      );
      const spamRow = spamCheck.rows[0];
      if (spamRow?.spam_test_result?.isBlocked === true) {
        console.warn(`${logPrefix} 스팸필터 차단된 문안 — 본 발송 중단 (담당자 확인 필요)`);
        await markFailed(ac, '스팸필터 차단으로 발송 중단 — 문안 수정 후 재시도');
        return;
      }
    } catch (spamGuardErr) {
      // 가드 자체 실패는 무시 (발송 진행) — 가드 실패가 발송 차단 사유는 아님
      console.error(`${logPrefix} 스팸 차단 가드 조회 실패 (발송 진행):`, spamGuardErr);
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

    let customers = customersResult.rows;

    if (customers.length === 0) {
      console.log(`${logPrefix} 타겟 고객 0명 — 스킵`);
      await markFailed(ac, '타겟 고객 없음 (필터 결과 0명)');
      return;
    }

    // ★ 2026-07-05 발송 피로도 보호 — 회사 opt-in + 광고 캠페인만. 차감(prepaidDeduct) 전 제외 = 환불 배관 불필요.
    if (ac.is_ad) {
      const fatigueCap = await getFatigueCap(ac.company_id);
      if (fatigueCap) {
        const blockedSet = await getFatigueBlockedSet(ac.company_id, fatigueCap, customers.map((c: any) => String(c.phone || '')));
        if (blockedSet.size > 0) {
          const beforeFatigue = customers.length;
          customers = customers.filter((c: any) => !blockedSet.has(normalizePhone(String(c.phone || ''))));
          console.log(`${logPrefix} 피로도 보호 — ${beforeFatigue - customers.length}명 제외 (${customers.length}명 남음)`);
        }
        if (customers.length === 0) {
          console.log(`${logPrefix} 피로도 보호로 전원 제외 — 스킵`);
          await markFailed(ac, '피로도 보호로 발송 대상 전원 제외');
          return;
        }
      }
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

    // ★ D150-3 (2026-05-10) MED#3 fix: 개별회신번호 필터 후 발송 대상 0명 가드.
    //   이전: filteredCustomers.length === 0이어도 빈 INSERT 진행 → sentCount=0 → 'failed' 회차 + 차감만 환불.
    //   이후: 사전에 가드 + 차감 환불 + 'failed' 회차 + advanceNextRun.
    if (filteredCustomers.length === 0) {
      console.warn(`${logPrefix} 개별회신번호 필터 후 발송 대상 0명 — 발송 스킵 (전체 환불)`);
      try {
        await prepaidRefund(
          ac.company_id,
          customers.length,
          ac.message_type,
          campaignId,
          '개별회신번호 미보유로 전체 제외 — 환불',
          'campaign',
          { refundKey: REFUND_KEYS.NOT_LOADED },   // 큐에 한 건도 안 들어간 분 = 미적재 항아리
        );
      } catch (refundErr) {
        console.error(`${logPrefix} 환불 실패:`, refundErr);
      }
      await query(
        `UPDATE auto_campaign_runs
         SET status = 'failed', completed_at = NOW(),
             sent_count = 0, success_count = 0, fail_count = $2,
             cancel_reason = $3
         WHERE id = $1`,
        [runId, customers.length, '개별회신번호 미보유로 전체 제외'],
      );
      await query(
        `UPDATE campaigns SET status = 'failed', sent_count = 0, sent_at = NOW() WHERE id = $1`,
        [campaignId],
      );
      await advanceNextRun(ac);
      return;
    }

    // ★ D130: 알림톡 분기 — channel='alimtalk'이면 insertAlimtalkQueue 사용 (SMS/LMS/MMS 경로 분리)
    let sentCount = 0;
    if (ac.channel === 'alimtalk') {
      // 승인 이중 가드
      if (!ac.alimtalk_template_code || !ac.alimtalk_profile_id) {
        console.warn(`${logPrefix} 알림톡 템플릿/발신프로필 미설정 — 발송 스킵`);
        await query(
          `UPDATE auto_campaign_runs SET status = 'failed', completed_at = NOW(), cancel_reason = $2 WHERE id = $1`,
          [runId, '알림톡 템플릿 또는 발신프로필 미설정']
        );
        await advanceNextRun(ac);
        return;
      }
      const gate = await query(
        `SELECT t.status AS tstatus, t.buttons AS tbuttons, t.emphasize_title AS temphasize_title, t.represent_link AS trepresent_link, p.approval_status, p.profile_key
           FROM kakao_templates t
           JOIN kakao_sender_profiles p ON p.id = t.profile_id
          WHERE t.id = $1 AND t.company_id = $2 LIMIT 1`,
        [ac.alimtalk_template_id, ac.company_id]
      );
      if (gate.rows.length === 0 || !['APPROVED', 'APR', 'A'].includes(String(gate.rows[0].tstatus).toUpperCase()) || gate.rows[0].approval_status !== 'APPROVED') {
        console.warn(`${logPrefix} 알림톡 가드 실패 (템플릿/프로필 미승인)`);
        await query(
          `UPDATE auto_campaign_runs SET status = 'failed', completed_at = NOW(), cancel_reason = $2 WHERE id = $1`,
          [runId, '알림톡 템플릿 또는 발신프로필이 승인되지 않음']
        );
        await advanceNextRun(ac);
        return;
      }
      // ★ CT-87 (2026-06-10): 카카오 활성상태(A) 가드 — 활성 대기(R) 템플릿은 카카오가 전부 7300 거부
      {
        const { decideKakaoTemplateSendable, getImcTemplateStatusByIdSafe } = await import('./kakao-template-guard');
        const autoTplGuard = decideKakaoTemplateSendable(await getImcTemplateStatusByIdSafe(ac.alimtalk_template_id));
        if (!autoTplGuard.sendable) {
          console.warn(`${logPrefix} 알림톡 활성상태 가드 차단 — ${autoTplGuard.code}`);
          await query(
            `UPDATE auto_campaign_runs SET status = 'failed', completed_at = NOW(), cancel_reason = $2 WHERE id = $1`,
            [runId, autoTplGuard.reason || '카카오 템플릿이 활성(A) 상태가 아닙니다']
          );
          await advanceNextRun(ac);
          return;
        }
      }
      // ★ 매뉴얼: senderkey 제거 — 알림톡은 k_template_code로 중계서버가 자동 처리(k_etc_json엔 title만)
      // ★ 버그1: k_etc_json = senderkey + 강조표기 title(#{변수} row별 치환) / k_button_json = 템플릿 buttons
      const emphasizeTitleRaw = gate.rows[0].temphasize_title || null;
      const representLinkRaw = gate.rows[0].trepresent_link || null;
      const autoButtonJson = convertButtonsToQTmsg(gate.rows[0].tbuttons || []);

      const { insertAlimtalkQueue } = await import('./sms-queue');
      const alimRows = filteredCustomers.map((customer: any) => {
        // 템플릿 기반 content 치환 + #{변수} variable map 적용
        let finalMessage = messageContent;
        const { message: personalizedMessage } = prepareSendMessage(finalMessage, customer, fieldMappings, {
          msgType: 'LMS', isAd: false, opt080Number: '', subject: '',
        });
        finalMessage = personalizedMessage;
        // alimtalk_variable_map: { "#{name}": "@@field@@" | "직접값" }
        const varMap = ac.alimtalk_variable_map || {};
        for (const [rawKey, rawVal] of Object.entries(varMap)) {
          const cleanKey = String(rawKey).replace(/^#\{|\}$/g, '').trim();
          const v = String(rawVal || '');
          const resolved = v.startsWith('@@') && v.endsWith('@@')
            ? String((customer as any)[v.slice(2, -2)] ?? '')
            : v;
          finalMessage = finalMessage.replace(
            new RegExp(`#\\{${cleanKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g'),
            resolved,
          );
        }
        const cleanPhone = normalizePhone(customer.phone);
        const callback = resolveCustomerCallback(customer, ac.use_individual_callback || false, ac.callback_number);
        // ★ 대체문구(k_next_contents)도 본문과 동일 치환 — raw 발송 시 #{변수} 노출 차단.
        let filledNextContents: string | undefined;
        if (ac.alimtalk_next_contents) {
          const { message: ncBase } = prepareSendMessage(ac.alimtalk_next_contents, customer, fieldMappings, {
            msgType: 'LMS', isAd: false, opt080Number: '', subject: '',
          });
          filledNextContents = fillAlimtalkVarMap(ncBase, ac.alimtalk_variable_map || {}, customer);
        }
        // ★ 2026-07-27: 전환재발송 규칙 CT 단일 진입점(alimtalk-fallback) — 4경로 공통.
        //   이 경로는 title_str을 아예 안 넣고 있었다(L/B 대체 LMS 제목 NULL = 통신사 검증 실패 미수신, D225+와 같은 사고).
        //   ⚠ auto_campaigns에는 alimtalk_next_subject 컬럼이 없다(2026-07-27 information_schema 실측).
        //   지금은 channel='alimtalk' 행이 0건이고 신규 생성도 410 Gone이라 도달 불가라서 컬럼을 만들지 않았다.
        //   이 경로를 되살린다면 ALTER로 컬럼부터 만들고 PUT·화면까지 배선해야 L/B가 제목을 갖는다.
        const alimFallback = resolveAlimtalkFallback({
          nextType: ac.alimtalk_next_type,
          nextContents: filledNextContents,
          nextSubject: ac.alimtalk_next_subject,
        });
        return {
          phone: cleanPhone,
          callback,
          message: finalMessage,
          templateCode: ac.alimtalk_template_code,
          nextType: alimFallback.nextType,
          nextContents: alimFallback.nextContents,
          titleStr: alimFallback.titleStr,
          buttonJson: autoButtonJson || undefined,
          // ★ 매뉴얼(qtmsg): 강조표기 title(#{변수} 본문과 동일 치환)만 → row별 k_etc_json (senderkey는 CT-04가 비토 라인만 주입).
          etcJson: buildAlimtalkEtcJson({
            emphasizeTitle: emphasizeTitleRaw,
            representLink: representLinkRaw,
            substitute: (raw) => {
              const { message: base } = prepareSendMessage(raw, customer, fieldMappings, { msgType: 'LMS', isAd: false, opt080Number: '', subject: '' });
              return fillAlimtalkVarMap(base, ac.alimtalk_variable_map || {}, customer);
            },
          }),
          companyId: ac.company_id,
        };
      });
      // ★ 2026-07-27 (B-0727-2): 배치 독립 커밋이라 실패해도 앞 배치는 큐에 남아 발송된다.
      //   여기서 그냥 던지면 아래 공통 종결·환불 블록을 건너뛰어, 적재된 건은 나가는데 전량이 미적재로 처리된다.
      //   커밋된 건수를 살려 정상 흐름(부분 실패 환불 + 상태 기록)을 그대로 타게 한다.
      try {
        sentCount = await insertAlimtalkQueue(companyTables, alimRows, campaignId);
      } catch (alimErr) {
        console.error(`${logPrefix} 알림톡 INSERT 실패:`, alimErr);
        if (alimErr instanceof AlimtalkQueueInsertError) sentCount = alimErr.inserted;
        else throw alimErr;
      }
    } else {
      // ★ D102: (광고)+080 — CT-AD 컨트롤타워 사용 (기존 누락 수정)
      const autoOpt080 = (ac.is_ad) ? await getOpt080Number(ac.user_id, ac.company_id) : '';

      const autoSmsRows: any[][] = [];
      for (const customer of filteredCustomers) {
        // ★ D103: prepareSendMessage 컨트롤타워 — 변수 치환 + (광고)+080 + ★ KISA 2026-05 제목(광고) 통합
        const { message: personalizedMessage, subject: personalizedSubject } = prepareSendMessage(messageContent, customer, fieldMappings, {
          msgType: ac.message_type, isAd: ac.is_ad ?? false, opt080Number: autoOpt080,
          subject: messageSubject || '',
        });
        const cleanPhone = normalizePhone(customer.phone);
        // ★ D103: resolveCustomerCallback 컨트롤타워 — 개별회신번호 resolve 통합
        const callback = resolveCustomerCallback(customer, ac.use_individual_callback || false, ac.callback_number);

        autoSmsRows.push([
          cleanPhone, callback, personalizedMessage, msgTypeCode,
          personalizedSubject, sendTime, campaignId, ac.company_id,
          mmsImages[0] || '', mmsImages[1] || '', mmsImages[2] || ''
        ]);
      }

      sentCount = await bulkInsertSmsQueue(companyTables, autoSmsRows, true);
    }

    // ★ 2026-07-05 발송 피로도 카운터 — 광고성만(알림톡/SMS 공통), 큐 커밋 후 fire-and-forget
    if (ac.is_ad && sentCount > 0) {
      void recordFatigueSends(ac.company_id, filteredCustomers.map((c: any) => String(c.phone || '')));
    }

    // ★ 부분 실패 시 환불
    const failCount = filteredCustomers.length - sentCount;
    if (failCount > 0) {
      console.warn(`${logPrefix} 부분 실패 — 성공: ${sentCount}, 실패: ${failCount}`);
      try {
        // 대상 − 큐 적재 성공 = 미적재(게이트웨이 실패가 아니다) — B-0727-2
        // prepaidRefund는 실패해도 throw하지 않으므로 ok를 봐야 한다. 실패분은 durable 의무로 남겨 워커가 재시도.
        const r = await prepaidRefund(ac.company_id, failCount, ac.message_type, campaignId, `자동발송 미적재 ${failCount}건 환불`, 'campaign', { refundKey: REFUND_KEYS.NOT_LOADED });
        if (!r.ok) await markRefundPending(campaignId, failCount, ac.message_type);
      } catch (refundErr) {
        console.error(`${logPrefix} 부분 실패 환불 오류:`, refundErr);
        await markRefundPending(campaignId, failCount, ac.message_type);
      }
    }

    // ★ D114 P8-3: success_count 초기값 0 — 큐 INSERT 건수 ≠ 실제 전송 성공 건수
    //   이전: success_count = sentCount (큐 INSERT 성공) → sync 전까지 "전부 성공" 오표시
    //   수정: success_count = 0 초기 → syncCampaignResults에서 campaign_runs 갱신 시 auto_campaign_runs도 갱신
    await query(
      `UPDATE auto_campaign_runs SET
        sent_count = $2, success_count = 0, fail_count = $3,
        status = $4, completed_at = NOW()
       WHERE id = $1`,
      [runId, sentCount, failCount, sentCount === 0 ? 'failed' : 'completed']
    );

    // ★ campaigns 상태 업데이트
    // ★ D144 후속: bulk INSERT 완료 = 발송완료 — 'sending' 단계 폐기, 즉시 'completed'.
    //   pending(통신사 처리)은 백그라운드. 화면 카운트는 MySQL 직접이라 실시간 갱신.
    const autoStatus = sentCount === 0 ? 'failed' : 'completed';
    await query(
      `UPDATE campaigns SET status = $2, sent_count = $3, sent_at = NOW() WHERE id = $1`,
      [campaignId, autoStatus, sentCount]
    );

    // ★ campaign_runs 연결 레코드
    await query(
      `INSERT INTO campaign_runs (campaign_id, run_number, target_count, sent_count, status, sent_at)
       VALUES ($1, 1, $2, $3, $4, NOW())`,
      [campaignId, customers.length, sentCount, autoStatus]
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

  // ★ D150-3 (2026-05-10) MED#5 fix: 7일간 연속 5회 이상 fail 시 자동 일시정지.
  //   이전: 알림톡 가드/타겟 0/시간 외/라인그룹 미설정 등 회차별 fail이 영원히 누적.
  //         담당자 알림 정책 미적용 시 운영자가 발견 못 함.
  //   이후: 자동 paused → 워커 polling에서 자동 제외 + 운영자 화면에서 paused 시각화로 발견 가능.
  try {
    const recentFails = await query(
      `SELECT COUNT(*)::int AS cnt
       FROM auto_campaign_runs
       WHERE auto_campaign_id = $1
         AND status = 'failed'
         AND created_at >= NOW() - INTERVAL '7 days'`,
      [ac.id]
    );
    if ((recentFails.rows[0]?.cnt || 0) >= 5) {
      const pauseResult = await query(
        `UPDATE auto_campaigns
         SET status = 'paused', next_run_at = NULL, updated_at = NOW()
         WHERE id = $1 AND status IN ('active', 'executing')
         RETURNING id`,
        [ac.id]
      );
      if (pauseResult.rows.length > 0) {
        console.warn(`[auto-worker][${ac.id}] 7일간 5회 이상 실패 — 자동 일시정지 (운영자 확인 필요)`);
        return; // advanceNextRun 호출 안 함 (paused로 next_run 의미 없음)
      }
    }
  } catch (pauseErr) {
    console.error(`[auto-worker][${ac.id}] 자동 일시정지 체크 실패:`, pauseErr);
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
    // ★ D150-3 (2026-05-10) HIGH#1 fix: 치명 오류로도 status='executing' stuck 차단.
    //   이전: catch 후 status는 그대로 'executing' → 워커 polling이 active만 픽업 → 영원히 발동 안 됨.
    //   이후: fallback UPDATE로 active 강제 복원 (next_run_at은 그대로 → 다음 polling 시 정상 진행).
    try {
      await query(
        `UPDATE auto_campaigns SET status = 'active', updated_at = NOW()
         WHERE id = $1 AND status = 'executing'`,
        [ac.id]
      );
    } catch (recoverErr) {
      console.error(`[auto-worker][${ac.id}] executing → active fallback 복원도 실패:`, recoverErr);
    }
  }
}

// ============================================================
// ★ 2단계: D-day 2시간 전 자동 스팸 재테스트 + 담당자 테스트발송 (D105 신설, D142 단계 번호 변경)
// next_run_at 0~2시간 이내 AND 아직 스팸테스트 안 한 건
// 스팸 통과 시 담당자 테스트발송 자동 예약 (Harold님 정책 — D142 2026-04-28).
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
    // ★ D142+ (2026-04-29) 0429 PDF B3 — 24h 미만 등록 사각지대 fallback
    //   1단계 윈도우(D-1, 12~36h)를 못 잡은 캠페인이 D-day 2h 윈도우 진입 시
    //   generated_message_content가 비어있으면 그 시점에 AI 생성 통합 진행.
    //   이전: 풀백 메시지(fallback_message_content/message_content)로 본 발송 → "풀백 무한 리턴" 신고
    //   이후: D-day 2h 전에라도 AI 생성 + 스팸테스트 + 담당자 테스트 보장
    if (ac.ai_generate_enabled && !ac.generated_message_content) {
      console.log(`${logPrefix} generated_message_content 없음 — D-day 2h 전 AI 생성 시도 (24h 미만 등록 fallback)`);
      try {
        await generateMessageForAutoCampaign(ac);
        // 재조회하여 최신 generated_message_content 확보
        const refreshed = await query('SELECT * FROM auto_campaigns WHERE id = $1', [ac.id]);
        if (refreshed.rows[0]) Object.assign(ac, refreshed.rows[0]);
      } catch (genErr) {
        console.error(`${logPrefix} D-day 2h 전 AI 생성 실패:`, genErr);
      }
    }

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

    // ★ D142+ (2026-04-29) 0429 PDF B3 — Harold님 정책: 스팸 차단 시 새 문안 생성하여 통과까지 재시도
    //   이전: maxRetries: 0 → 차단되어도 결과 기록만 + 그대로 발송 → 사용자 의도 위반
    //   이후: maxRetries: 2 + regenerateCallback → 통과한 문안으로 담당자 테스트 + 본 발송
    const spamRejectNumber = await getOpt080Number(ac.user_id, ac.company_id);
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
      rejectNumber: spamRejectNumber,
      firstRecipient,
      maxRetries: 2, // ★ Harold님 정책: 통과까지 재시도
      regenerateCallback: async (blockedVariantId: string) => {
        try {
          console.log(`${logPrefix} 스팸 차단 — 새 문안 재생성 (variant ${blockedVariantId})`);
          // 1단계와 동일 패턴: 회사 정보 조회 + extraContext 구성 + generateMessages 호출
          const companyResult = await query(
            `SELECT company_name, brand_name, brand_tone, brand_description, brand_slogan,
                    COALESCE(reject_number, opt_out_080_number) as reject_number, customer_schema
             FROM companies WHERE id = $1`,
            [ac.company_id]
          );
          const companyInfo = companyResult.rows[0] || {};
          if (ac.user_id) {
            const userOptResult = await query('SELECT opt_out_080_number FROM users WHERE id = $1', [ac.user_id]);
            const userOpt080 = userOptResult.rows[0]?.opt_out_080_number;
            if (userOpt080) companyInfo.reject_number = userOpt080;
          }
          const { fieldMappings: varCatalog, availableVars } = extractVarCatalog(companyInfo.customer_schema);
          await filterVarCatalogByData(varCatalog, availableVars, ac.company_id);
          const rawPersonalFields: string[] = Array.isArray(ac.personal_fields) ? ac.personal_fields : [];
          let customFieldLabels: Record<string, string> = {};
          if (rawPersonalFields.some(k => k.startsWith('custom_'))) {
            const cfdResult = await query(
              `SELECT field_key, field_label FROM customer_field_definitions WHERE company_id = $1 AND field_key LIKE 'custom_%'`,
              [ac.company_id]
            );
            for (const row of cfdResult.rows) customFieldLabels[row.field_key] = row.field_label;
          }
          const personalizationVars: string[] = rawPersonalFields.map(key => {
            const field = getFieldByKey(key);
            if (field) return field.displayName;
            if (customFieldLabels[key]) return customFieldLabels[key];
            return key;
          });
          const regenResult = await generateMessages(
            (ac.ai_prompt || ac.campaign_name) + '\n(이전 문안이 스팸필터에 차단되었습니다. 다른 표현으로 작성해주세요.)',
            { total_count: 0, avg_purchase_count: 0, avg_total_spent: 0 },
            {
              brandName: companyInfo.brand_name || companyInfo.company_name || '브랜드',
              brandTone: companyInfo.brand_tone,
              brandDescription: companyInfo.brand_description,
              brandSlogan: companyInfo.brand_slogan,
              channel: channel,
              isAd: ac.is_ad ?? false,
              rejectNumber: companyInfo.reject_number,
              availableVarsCatalog: varCatalog,
              availableVars,
              usePersonalization: personalizationVars.length > 0,
              personalizationVars,
            }
          );
          if (regenResult.variants?.length > 0) {
            const nv = regenResult.variants[0] as any;
            return {
              messageText: nv.message_text || nv.sms_text || nv.lms_text || '',
              subject: nv.subject,
            };
          }
          return null;
        } catch (regenErr) {
          console.error(`${logPrefix} 재생성 실패:`, regenErr);
          return null;
        }
      },
    });

    // ★ D142+ B3: 재생성된 문안이 있으면 generated_message_content UPDATE
    //   본 발송(`executeAutoCampaign`) 시 최신 통과 문안 사용 보장
    const regeneratedFinal = spamResult.variants[0];
    if (regeneratedFinal?.regenerated && regeneratedFinal.messageText) {
      await query(
        `UPDATE auto_campaigns SET generated_message_content = $1, generated_message_subject = $2 WHERE id = $3`,
        [regeneratedFinal.messageText, regeneratedFinal.subject || ac.generated_message_subject, ac.id]
      );
      ac.generated_message_content = regeneratedFinal.messageText;
      if (regeneratedFinal.subject) ac.generated_message_subject = regeneratedFinal.subject;
      console.log(`${logPrefix} 재생성된 문안으로 generated_message_content 갱신`);
    }

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
    // ★ D114 P8-1 + D120 P7: target_count/sent_count/success_count 추가 (알림류 run은 sync 대상 아님 → 즉시 기록)
    await query(
      `INSERT INTO auto_campaign_runs (
        auto_campaign_id, run_number, status, scheduled_at, started_at,
        spam_test_result, ai_generation_status, target_count, sent_count, success_count
      ) VALUES ($1, $2, 'spam_tested', $3, NOW(), $4, $5, 3, 3, 3)`,
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
// 메인 실행 함수 (3단계 순차 실행)
//
// ★ D142 (2026-04-28) Harold님 정책 — 4단계 → 3단계 단순화.
//   1단계: D-1 AI 문안생성 + 스팸테스트 (12~36h 이전)
//   2단계: D-day 2h전 스팸 재테스트 + 통과 시 담당자 테스트발송 (0~2h 이전)
//   3단계: D-day 실제 발송 (next_run_at <= NOW())
//
//   사전알림(runPreNotification) 단계는 폐지 — 함수 자체는 dead code로 보존(롤백 가능).
// ============================================================

export async function runAutoCampaignWorker(): Promise<void> {
  const logPrefix = '[auto-worker]';

  // ★ 2026-06-11 영구 폐기 봉인 — D188 폐기(POST 410) 후에도 active 잔존(인비토 4건)이 매주/매월
  //   계속 실행·발송되던 사고 차단. 레코드가 다시 active가 되어도 문안생성/스팸테스트/발송 전 단계가 돌지 않는다.
  //   데이터는 보존(슈퍼관리자 수동 조치용 PUT/DELETE 라우트 유지). 재가동이 필요하면 이 상수만 해제.
  const AUTO_CAMPAIGN_RETIRED = true;
  if (AUTO_CAMPAIGN_RETIRED) return;

  try {
    // ★ D150-3 (2026-05-10) HIGH#1 안전망: executing 5분 이상 stuck 자동 복원.
    //   advanceNextRun fallback이 실패한 극단 케이스 + 워커 프로세스 강제 종료 케이스 대비.
    //   updated_at 5분 이전 = 정상 발송이라면 이미 active로 복원됐을 시간 충분 경과.
    try {
      const recovered = await query(
        `UPDATE auto_campaigns SET status = 'active', updated_at = NOW()
         WHERE status = 'executing' AND updated_at < NOW() - INTERVAL '5 minutes'
         RETURNING id`
      );
      if (recovered.rows.length > 0) {
        console.warn(`${logPrefix} executing → active 자동 복원 ${recovered.rows.length}건 (stuck 안전망)`);
      }
    } catch (recoverErr) {
      console.error(`${logPrefix} stuck 복원 안전망 실패 (무시하고 계속):`, recoverErr);
    }

    // ★ 1단계: D-1 AI 문안 생성 + 스팸테스트 (12~36시간 이전)
    await runMessageGeneration();

    // ★ 2단계: D-day 2시간 전 스팸 재테스트 + 담당자 테스트발송 (0~2h 이전)
    await runPreSendSpamTest();

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
