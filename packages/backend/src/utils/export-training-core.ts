/**
 * export-training-core — 학습 데이터셋 변환 순수 코어 (DB import 0)
 *
 * ai_training_logs(발송+성과)·operator_proposals(제안+승인/거부) 행을 파인튜닝용 JSONL 예시로 변환한다.
 * 라벨은 전부 실데이터(status·spam_blocked)에서 도출 — 임의 상수 없음.
 * DB 조회·파일 출력은 scripts/export-training-data.ts가 수행하고, 정제된 필드만 여기로 넘긴다.
 */

export interface ChatExample {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
}
export interface KtoExample {
  prompt: string;
  completion: string;
  label: 'desirable' | 'undesirable';
}
export interface SpamExample {
  input: Record<string, unknown>;
  label: 'block' | 'pass';
}

const MARKETING_SYSTEM =
  '당신은 한국어 마케팅 메시지를 작성하는 전문가입니다. 정보통신망법을 지키고, 회사가 정한 혜택만 사용합니다.';

/** 생성 SFT — userPrompt가 있는 발송만 (입력→최종 메시지). 둘 중 하나라도 비면 제외. */
export function buildGenerationExample(row: {
  userPrompt: string | null;
  finalMessage: string;
  messageType: string;
  isAd: boolean;
}): ChatExample | null {
  const prompt = (row.userPrompt || '').trim();
  const message = (row.finalMessage || '').trim();
  if (!prompt || !message) return null;
  const ctx = `채널: ${row.messageType}${row.isAd ? ' / 광고' : ''}`;
  return {
    messages: [
      { role: 'system', content: MARKETING_SYSTEM },
      { role: 'user', content: `${prompt}\n(${ctx})` },
      { role: 'assistant', content: message },
    ],
  };
}

/** 선호 KTO — operator 제안 채택/거부. approved·auto_executed=desirable / rejected=undesirable / 그 외=신호 없음. */
export function buildPreferenceExample(row: {
  objective: string;
  message: string;
  status: string;
}): KtoExample | null {
  const completion = (row.message || '').trim();
  if (!completion) return null;
  let label: 'desirable' | 'undesirable';
  if (row.status === 'approved' || row.status === 'auto_executed') label = 'desirable';
  else if (row.status === 'rejected') label = 'undesirable';
  else return null;
  return { prompt: (row.objective || '').trim(), completion, label };
}

/** 스팸 분류 — message_features + spam_blocked 실측 → block/pass. features 없으면 제외. */
export function buildSpamExample(row: {
  features: Record<string, unknown> | null;
  spamBlocked: number | null;
}): SpamExample | null {
  if (!row.features) return null;
  return { input: row.features, label: (row.spamBlocked || 0) > 0 ? 'block' : 'pass' };
}

/** 학습/검증 결정적 분리 — valEvery마다 1건을 검증셋으로(난수 X, 재현 가능). */
export function splitTrainVal<T>(examples: T[], valEvery = 5): { train: T[]; val: T[] } {
  const train: T[] = [];
  const val: T[] = [];
  examples.forEach((ex, i) => {
    if (valEvery > 0 && i % valEvery === valEvery - 1) val.push(ex);
    else train.push(ex);
  });
  return { train, val };
}
