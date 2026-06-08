// 메시지·콘텐츠 분석 — 순수 코어(DB-free). 임의 상수 0: 발송/성공은 실측 집계, 단가는 호출부에서 주입.
// 단가 없으면 비용은 null(데이터부족) — 지어내지 않는다. 길이 경계는 SMS 90·LMS 2000byte 통신 규격.
// campaigns message_type GROUP BY·본문 길이·companies 단가 SELECT는 호출부(buildMessageAnalysis) 담당.

export interface MessageTypeRow {
  messageType: string | null; // S/L/M/K 등
  sent: number;
  success: number;
}

export interface MessageTypePerf {
  rawType: string;
  label: string;
  sent: number;
  success: number;
  successRate: number; // 0~1
  unitCost: number | null; // 주입 단가(없으면 null)
  estimatedCost: number | null; // sent × unitCost(단가 없으면 null)
}

export interface LengthBucket {
  bucket: string;
  count: number;
}

/** message_type → 표시 라벨. campaigns 실제 값은 풀네임('SMS'/'LMS'/'MMS')이며 약자(S/L/M/K)도 견고하게 커버. */
function msgLabel(rawType: string): string {
  const u = rawType.toUpperCase();
  if (u === 'S' || u === 'SMS') return 'SMS';
  if (u === 'L' || u === 'LMS') return 'LMS';
  if (u === 'M' || u === 'MMS') return 'MMS';
  if (u === 'K' || u === 'KAKAO' || u === 'AT' || u === 'ALIMTALK') return '알림톡';
  return '기타';
}

const SMS_MAX_BYTES = 90; // SMS 단문 통신 규격
const LMS_MAX_BYTES = 2000; // LMS 통신 규격

/** message_type 유형별 발송/성공률 + 주입 단가 기반 추정 비용. 발송량 내림차순 정렬. */
export function computeMessageTypePerformance(
  rows: MessageTypeRow[],
  costMap: Record<string, number>,
): MessageTypePerf[] {
  const agg = new Map<string, { sent: number; success: number }>();
  for (const r of rows) {
    const key = (r.messageType && String(r.messageType).trim()) || '기타';
    const e = agg.get(key) || { sent: 0, success: 0 };
    e.sent += Number(r.sent) || 0;
    e.success += Number(r.success) || 0;
    agg.set(key, e);
  }
  return Array.from(agg.entries())
    .map(([rawType, e]) => {
      const unitCost = costMap[rawType] != null ? Number(costMap[rawType]) : null;
      return {
        rawType,
        label: msgLabel(rawType),
        sent: e.sent,
        success: e.success,
        successRate: e.sent > 0 ? e.success / e.sent : 0,
        unitCost,
        estimatedCost: unitCost != null ? e.sent * unitCost : null,
      };
    })
    .sort((a, b) => b.sent - a.sent);
}

/** 본문 byte 길이 분포 — 단문(≤90)/중문(91~2000)/장문(>2000). 항상 3버킷(빈 입력도 count 0). */
export function computeLengthDistribution(byteLengths: number[]): LengthBucket[] {
  let short = 0;
  let mid = 0;
  let long = 0;
  for (const b of byteLengths) {
    const v = Number(b) || 0;
    if (v <= SMS_MAX_BYTES) short += 1;
    else if (v <= LMS_MAX_BYTES) mid += 1;
    else long += 1;
  }
  return [
    { bucket: '단문', count: short },
    { bucket: '중문', count: mid },
    { bucket: '장문', count: long },
  ];
}
