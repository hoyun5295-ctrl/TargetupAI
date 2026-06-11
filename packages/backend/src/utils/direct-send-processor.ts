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
import { bulkInsertSmsQueue, insertKakaoQueue, insertAlimtalkQueue, toQtmsgType } from './sms-queue';
import { normalizeMmsImagePaths } from './mms-image-util';
import { resolveCustomerCallback } from './callback-filter';
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

    // ★ QTmsg 매뉴얼: 알림톡 강조 k_etc_json = {title}만 (senderkey는 k_template_code로 중계서버 자동). commit이 {title} 저장 → row별 #{변수} 치환 재생성.
    let alimEmphasizeTitleRaw: string | undefined;
    if (p.alimtalkEtcJson) {
      try {
        const parsedEtc = JSON.parse(p.alimtalkEtcJson) as { title?: string };
        alimEmphasizeTitleRaw = parsedEtc?.title;
      } catch { /* 형식 오류 → title 없음 취급 */ }
    }
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
      let finalNextContents: string | undefined;
      if ((p.alimtalkNextType === 'A' || p.alimtalkNextType === 'B') && p.alimtalkNextContents) {
        const ncBase = replaceVariables(
          p.alimtalkNextContents, dbCustomer, p.directFieldMappings,
          toAddressBookFields(recipient), { skipNumberFormatting: true }
        );
        finalNextContents = fillAlimtalkVarMap(ncBase, p.alimtalkVariableMap, dbCustomer, recipient as Record<string, any>);
      }
      return {
        phone: cleanPhone,
        callback: normalizePhone(p.callback),
        message: finalMessage,
        templateCode: p.alimtalkTemplateCode as string,
        nextType: p.alimtalkNextType || 'L',
        nextContents: finalNextContents,
        titleStr: (p.alimtalkNextType === 'L' || p.alimtalkNextType === 'B') ? (p.alimtalkNextSubject || '') : undefined,
        buttonJson: p.alimtalkButtonJson || undefined,
        // ★ QTmsg 매뉴얼: 알림톡 강조 k_etc_json = {title}만(senderkey 제외) — #{변수} 본문과 동일 치환.
        etcJson: buildAlimtalkEtcJson({
          emphasizeTitle: alimEmphasizeTitleRaw,
          substitute: (raw) => {
            const base = replaceVariables(raw, dbCustomer, p.directFieldMappings, toAddressBookFields(recipient), { skipNumberFormatting: true });
            return fillAlimtalkVarMap(base, p.alimtalkVariableMap, dbCustomer, recipient as Record<string, any>);
          },
        }),
        companyId: p.companyId,
      };
    });
    try {
      // 강조표기형 7300 진단 로그(ALIMTALK-DEBUG2)는 원인 확정으로 제거(2026-06-10).
      // 근본 = 에이전트 qtmsg.xml select_sql의 sendercode 합성에서 sender_code NULL → k_etc_json 전체 NULL.
      // 한줄로 측 etcJson은 {"title":치환값}만 — IMC 메일(2026-06-10)로 확정.
      sentCount = await insertAlimtalkQueue(p.companyTables, alimtalkRows, p.campaignId);
    } catch (alimtalkErr) {
      console.error('[direct-send-processor] 알림톡 INSERT 실패:', alimtalkErr);
      sentCount = 0;
    }
  }

  return { sentCount, failedCount: recipients.length - sentCount };
}
