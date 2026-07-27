/**
 * ★ 대량 발송 파이프라인 — 청크 처리 컨트롤타워 (2026-05-30)
 *
 * direct-send 핸들러의 청크 단위 처리 로직을 추출 (no_inline_duplication).
 * worker(direct-send-worker.ts)가 staging 청크(최대 1만건)마다 호출.
 *
 * 본 함수가 담당: 수신거부 필터 + customers 변수매핑 SELECT + 채널별 큐 INSERT + 집계.
 * 본 함수 제외(commit/worker 레벨): 중복제거(worker가 DB 1회) / 개별회신번호 확인 모달 /
 *   잔액 차감 / 캠페인 생성 / 분할·예약 시각 계산(worker가 sendTime 주입).
 */
import { query } from '../config/database';
import { normalizePhone } from './normalize-phone';
import { prepareSendMessage, replaceVariables } from './messageUtils';
import { fillAlimtalkVarMap } from './alimtalk-vars';
import { resolveAlimtalkFallback } from './alimtalk-fallback';
import { bulkInsertSmsQueue, insertKakaoQueue, insertAlimtalkQueue, AlimtalkQueueInsertError, toQtmsgType } from './sms-queue';
import { normalizeMmsImagePaths } from './mms-image-util';
import { resolveCustomerCallback } from './callback-filter';
// ★ 2026-07-05: 발송 피로도 카운터 (광고성 발송 기록 — 발송 무영향 fire-and-forget)
import { recordFatigueSends } from './fatigue-guard';
import { buildAlimtalkEtcJson } from './alimtalk-emphasize';

/** 청크 1건 수신자 — worker가 staging row + 계산된 sendTime을 채워 전달 */
export interface ChunkRecipient {
  phone: string;
  name?: string | null;
  extra1?: string | null;
  extra2?: string | null;
  extra3?: string | null;
  callback?: string | null;
  /** worker가 계산: 즉시발송이면 '' (bulkInsertSmsQueue가 NOW()), 예약/분할이면 KST 문자열 */
  sendTime: string;
}

export interface SendChunkParams {
  companyId: string;
  campaignId: string;
  companyTables: string[];
  recipients: ChunkRecipient[];
  /** worker가 prepareFieldMappings로 1회 조회해 주입 (청크마다 재조회 X) */
  directFieldMappings: Record<string, any>;

  sendChannel: string; // 'sms' | 'kakao' | 'both' | 'alimtalk'
  msgType: string;     // SMS | LMS | MMS
  message: string;
  subject: string;
  callback: string;
  useIndividualCallback: boolean;
  finalIsAd: boolean;
  /** worker가 getOpt080Number로 1회 조회해 주입 */
  opt080: string;
  mmsImagePaths: any[];
  /** 즉시발송 여부 — bulkInsertSmsQueue NOW() 사용 분기 */
  useNow: boolean;

  // 카카오 브랜드메시지
  kakaoBubbleType?: string;
  kakaoSenderKey?: string;
  kakaoTargeting?: string;
  kakaoAttachmentJson?: string;
  kakaoCarouselJson?: string;
  kakaoResendType?: string;

  // 알림톡 (commit이 gate 검증 후 send_config에 저장 → worker 주입)
  alimtalkTemplateCode?: string;
  alimtalkVariableMap?: Record<string, string>;
  alimtalkButtonJson?: string | null;
  alimtalkNextType?: string;
  alimtalkNextContents?: string;
  alimtalkNextSubject?: string;
  alimtalkEtcJson?: string | null;
}

export interface SendChunkResult {
  sentCount: number;
  failedCount: number;
}

/**
 * 청크 1건 처리. 수신거부 필터 → customers 변수매핑 → 채널별 큐 INSERT → 집계.
 * 환불은 worker가 전체 청크 누적 후 1회 처리.
 */
export async function processSendChunk(p: SendChunkParams): Promise<SendChunkResult> {
  // null → undefined 변환 (prepareSendMessage/replaceVariables는 null 미허용)
  const toAddressBookFields = (r: ChunkRecipient) => ({
    name: r.name ?? undefined,
    extra1: r.extra1 ?? undefined,
    extra2: r.extra2 ?? undefined,
    extra3: r.extra3 ?? undefined,
    callback: r.callback ?? undefined,
  });

  // 수신거부·중복제거·금액필터는 commit에서 staging 전체 대상 1회 처리 (청크별 X — 청크 간 중복 누락 방지)
  const recipients = p.recipients;
  if (recipients.length === 0) return { sentCount: 0, failedCount: 0 };

  // 2. customers 변수매핑 SELECT (storageType 동적 컬럼 — D72)
  const mappingCols = Object.values(p.directFieldMappings)
    .filter((m: any) => m.storageType !== 'custom_fields')
    .map((m: any) => m.column);
  const selectCols = [...new Set(['phone', 'custom_fields', ...mappingCols])].join(', ');
  const phoneList = recipients.map((r) => normalizePhone(r.phone));
  const custResult = await query(
    `SELECT ${selectCols} FROM customers WHERE company_id = $1 AND phone = ANY($2)`,
    [p.companyId, phoneList]
  );
  const custMap = new Map<string, Record<string, any>>();
  custResult.rows.forEach((c: any) => custMap.set(normalizePhone(c.phone), c));

  let sentCount = 0;

  // 3-A. SMS (sms 또는 both)
  if (p.sendChannel === 'sms' || p.sendChannel === 'both') {
    const smsRows: any[][] = [];
    for (const r of recipients) {
      const cleanPhone = normalizePhone(r.phone);
      const dbCustomer = custMap.get(cleanPhone) || null;
      const { message: finalMessage, subject: finalSubject } = prepareSendMessage(
        p.message, dbCustomer, p.directFieldMappings,
        {
          msgType: p.msgType, isAd: p.finalIsAd, opt080Number: p.opt080,
          addressBookFields: toAddressBookFields(r),
          subject: p.subject || '', skipNumberFormatting: true,
        }
      );
      const recipientCallback = resolveCustomerCallback(r, p.useIndividualCallback, p.callback);
      const mms = normalizeMmsImagePaths(p.mmsImagePaths);
      smsRows.push([
        cleanPhone, recipientCallback, finalMessage,
        toQtmsgType(p.msgType), finalSubject, r.sendTime,
        p.campaignId, p.companyId, mms[0] || '', mms[1] || '', mms[2] || '',
      ]);
    }
    sentCount = await bulkInsertSmsQueue(p.companyTables, smsRows, p.useNow);
  }

  // 3-B. 카카오 (kakao 또는 both) — per-recipient 축적
  if (p.sendChannel === 'kakao' || p.sendChannel === 'both') {
    let kakaoSent = 0;
    for (const r of recipients) {
      try {
        const cleanPhone = normalizePhone(r.phone);
        const dbCustomer = custMap.get(cleanPhone) || null;
        const finalMessage = replaceVariables(
          p.message, dbCustomer, p.directFieldMappings,
          toAddressBookFields(r),
          { skipNumberFormatting: true }
        );
        const recipientCallback = resolveCustomerCallback(r, p.useIndividualCallback, p.callback);
        await insertKakaoQueue({
          bubbleType: p.kakaoBubbleType || 'TEXT',
          senderKey: p.kakaoSenderKey || '',
          phone: cleanPhone,
          targeting: p.kakaoTargeting || 'I',
          message: finalMessage,
          isAd: p.finalIsAd,
          reservedDate: p.useNow ? undefined : r.sendTime,
          attachmentJson: p.kakaoAttachmentJson || undefined,
          carouselJson: p.kakaoCarouselJson || undefined,
          resendType: p.sendChannel === 'both' ? 'NO' : (p.kakaoResendType || 'SM'),
          resendFrom: recipientCallback,
          unsubscribePhone: p.opt080,
          requestUid: p.campaignId,
        });
        kakaoSent++;
      } catch (kakaoErr) {
        console.error('[direct-send-processor] 카카오 INSERT 실패:', kakaoErr);
      }
    }
    // both이면 SMS 성공수 유지, kakao 단독이면 kakao 성공수
    if (p.sendChannel === 'kakao') sentCount = kakaoSent;
  }

  // 3-C. 알림톡
  if (p.sendChannel === 'alimtalk') {
    const toExtraFromVarMap = (recipient: ChunkRecipient, dbCustomer: any): Record<string, string> => {
      const out: Record<string, string> = {};
      if (!p.alimtalkVariableMap || typeof p.alimtalkVariableMap !== 'object') return out;
      for (const [rawKey, rawVal] of Object.entries(p.alimtalkVariableMap)) {
        const cleanKey = String(rawKey).replace(/^#\{|\}$/g, '').trim();
        const v = String(rawVal || '');
        if (v.startsWith('@@') && v.endsWith('@@')) {
          const fieldKey = v.slice(2, -2);
          const source = dbCustomer?.[fieldKey] ?? (recipient as any)?.[fieldKey] ?? '';
          out[cleanKey] = String(source ?? '');
        } else {
          out[cleanKey] = v;
        }
      }
      return out;
    };

    // ★ QTmsg 매뉴얼: 알림톡 강조 k_etc_json = {title}만 (senderkey는 표준 라인=중계서버 자동 / 비토 라인=CT-04 insertAlimtalkQueue 주입). commit이 {title} 저장 → row별 #{변수} 치환 재생성.
    let alimEmphasizeTitleRaw: string | undefined;
    let alimAttachmentLink: Record<string, string> | null = null;  // ★ commit이 저장한 대표링크(snake attachment_link) — 고정링크라 row별 재생성 시 그대로 보존.
    if (p.alimtalkEtcJson) {
      try {
        const parsedEtc = JSON.parse(p.alimtalkEtcJson) as { title?: string; attachment_link?: Record<string, string> };
        alimEmphasizeTitleRaw = parsedEtc?.title;
        if (parsedEtc?.attachment_link && Object.keys(parsedEtc.attachment_link).length > 0) alimAttachmentLink = parsedEtc.attachment_link;
      } catch { /* 형식 오류 → title 없음 취급 */ }
    }
    // ★ 2026-07-27: 전환재발송 설정 검증은 행을 만들기 전에 1회. 청크가 순차라 행 중간에서 죽으면
    //   앞 청크는 이미 큐에 들어간 뒤라 부분 발송이 된다 — 설정 결함은 첫 INSERT 전에 걸러낸다.
    resolveAlimtalkFallback({
      nextType: p.alimtalkNextType,
      nextContents: p.alimtalkNextContents,
      nextSubject: p.alimtalkNextSubject,
    });
    // 강등은 행마다 찍지 않고 청크당 1줄로 센다 — 대량 캠페인에서 수십만 줄 + 전화번호 원문이 로그에 쌓인다.
    let alimDowngradedCount = 0;
    const alimtalkRows = recipients.map((recipient) => {
      const cleanPhone = normalizePhone(recipient.phone);
      const dbCustomer = custMap.get(cleanPhone) || null;
      const extraVars = toExtraFromVarMap(recipient, dbCustomer);
      let finalMessage = replaceVariables(
        p.message, dbCustomer, p.directFieldMappings,
        toAddressBookFields(recipient),
        { skipNumberFormatting: true }
      );
      for (const [k, v] of Object.entries(extraVars)) {
        finalMessage = finalMessage.replace(
          new RegExp(`#\\{${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g'), v
        );
      }
      // ★ 대체문구(k_next_contents)도 본문과 동일 치환 — raw 발송 시 #{변수} 노출 차단.
      let filledNextContents: string | undefined;
      if (p.alimtalkNextContents) {
        const ncBase = replaceVariables(
          p.alimtalkNextContents, dbCustomer, p.directFieldMappings,
          toAddressBookFields(recipient), { skipNumberFormatting: true }
        );
        filledNextContents = fillAlimtalkVarMap(ncBase, p.alimtalkVariableMap, dbCustomer, recipient as Record<string, any>);
      }
      // ★ 2026-07-27: 전환재발송 규칙 CT 단일 진입점(alimtalk-fallback) — 4경로 공통.
      //   설정은 위에서 이미 통과했다. 여기서 비는 경우는 이 수신자의 변수가 전부 빈 값이라
      //   치환 후 문안이 사라진 행뿐이므로, 그 행만 전환 없음으로 내리고 본 발송은 그대로 보낸다.
      const alimFallback = resolveAlimtalkFallback(
        {
          nextType: p.alimtalkNextType,
          nextContents: filledNextContents,
          nextSubject: p.alimtalkNextSubject,
        },
        { emptyContentsPolicy: 'disableFallback' },
      );
      if (alimFallback.downgradedToNone) alimDowngradedCount++;
      return {
        phone: cleanPhone,
        callback: normalizePhone(p.callback),
        message: finalMessage,
        templateCode: p.alimtalkTemplateCode as string,
        nextType: alimFallback.nextType,
        nextContents: alimFallback.nextContents,
        titleStr: alimFallback.titleStr,
        buttonJson: p.alimtalkButtonJson || undefined,
        // ★ QTmsg 매뉴얼: 알림톡 강조 k_etc_json = {title}만(senderkey는 CT-04가 비토 라인만 주입) — #{변수} 본문과 동일 치환.
        etcJson: buildAlimtalkEtcJson({
          emphasizeTitle: alimEmphasizeTitleRaw,
          attachmentLink: alimAttachmentLink,
          substitute: (raw) => {
            const base = replaceVariables(raw, dbCustomer, p.directFieldMappings, toAddressBookFields(recipient), { skipNumberFormatting: true });
            return fillAlimtalkVarMap(base, p.alimtalkVariableMap, dbCustomer, recipient as Record<string, any>);
          },
        }),
        companyId: p.companyId,
      };
    });
    if (alimDowngradedCount > 0) {
      console.log(`[direct-send-processor] 대체문안 치환 결과 공백 ${alimDowngradedCount}건 — 해당 수신자만 전환 없이 알림톡 발송 campaign=${p.campaignId}`);
    }
    try {
      // 강조표기형 7300 진단 로그(ALIMTALK-DEBUG2)는 원인 확정으로 제거(2026-06-10).
      // 근본 = 에이전트 qtmsg.xml select_sql의 sendercode 합성에서 sender_code NULL → k_etc_json 전체 NULL.
      // 한줄로 측 etcJson은 {"title":치환값}만 — IMC 메일(2026-06-10)로 확정.
      sentCount = await insertAlimtalkQueue(p.companyTables, alimtalkRows, p.campaignId);
    } catch (alimtalkErr) {
      console.error('[direct-send-processor] 알림톡 INSERT 실패:', alimtalkErr);
      // ★ 2026-07-27 (B-0727-1): 실패해도 앞 배치는 커밋되어 발송된다. 0으로 지우면 워커가
      //   그만큼을 미적재로 보고 환불한 뒤 실제로는 나가버린다(환불 후 실발송).
      sentCount = alimtalkErr instanceof AlimtalkQueueInsertError ? alimtalkErr.inserted : 0;
    }
  }

  // ★ 2026-07-05 발송 피로도 카운터 — 광고성만, 큐 커밋 후 fire-and-forget (staging 대량·자동마케팅 발송 공용 지점)
  if (p.finalIsAd && sentCount > 0) {
    void recordFatigueSends(p.companyId, recipients.map((r) => String(r.phone || '')));
  }

  return { sentCount, failedCount: recipients.length - sentCount };
}
