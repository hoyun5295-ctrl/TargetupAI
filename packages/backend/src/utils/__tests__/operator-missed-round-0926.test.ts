/**
 * 자동 마케팅 회차를 건너뛰면 담당자에게 알린다 (★2026-09-26 한줄로 V2 R1-24)
 *
 * 옛: 생성 워커가 발송 희망 시각이 지난 뒤에 돌면(서버 재시작·지연) 다음 회차를 계산해 이번 회차를 **말없이** 건너뛰었다.
 * 처방: 동작(늦게 보내지 않음 = 예상 밖 시각 발송·과금 방지)은 그대로 두고, 건너뛴 사실을 운영 알림(무과금 인증 라인)으로 남긴다.
 *   판정 = 순수 함수 detectMissedOperatorRound: 저장된 생성 시각(next_run_at = 희망 시각 − 준비시간) + 준비시간 ≤ 지금이면 그 희망 시각을 돌려준다.
 *   AI 최적 시각 모드는 희망 시각이 고정이 아니라 대상 아님.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { detectMissedOperatorRound } from '../autosend-policy';

const at = (iso: string) => new Date(iso);

describe('detectMissedOperatorRound', () => {
  it('희망 시각이 지난 뒤에 돌면 그 시각을 돌려준다', () => {
    const r = detectMissedOperatorRound({ nextRunAt: at('2026-09-26T00:00:00Z'), leadMinutes: 120, sendTimeMode: 'fixed', now: at('2026-09-26T02:30:00Z') });
    expect(r?.toISOString()).toBe('2026-09-26T02:00:00.000Z');
  });
  it('준비 창 안(희망 시각 전)이면 null', () => {
    expect(detectMissedOperatorRound({ nextRunAt: at('2026-09-26T00:00:00Z'), leadMinutes: 120, sendTimeMode: 'fixed', now: at('2026-09-26T01:30:00Z') })).toBeNull();
  });
  it('첫 실행(next_run_at 없음)·AI 최적 시각 모드는 null', () => {
    expect(detectMissedOperatorRound({ nextRunAt: null, leadMinutes: 120, sendTimeMode: 'fixed', now: at('2026-09-26T05:00:00Z') })).toBeNull();
    expect(detectMissedOperatorRound({ nextRunAt: at('2026-09-26T00:00:00Z'), leadMinutes: 120, sendTimeMode: 'ai_optimal', now: at('2026-09-26T05:00:00Z') })).toBeNull();
  });
});

describe('배선', () => {
  const src = readFileSync(join(__dirname, '..', 'continuous-operator.ts'), 'utf8');
  it('제안 생성 첫머리에서 판정하고 담당자에게 알린다(발송 동작은 그대로)', () => {
    const fn = src.slice(src.indexOf('export async function generateProposalForOperator('));
    const iDetect = fn.indexOf('const missedAt = detectMissedOperatorRound({');
    expect(iDetect).toBeGreaterThan(-1);
    expect(fn.slice(iDetect, iDetect + 1500)).toContain("'[AI 오퍼레이션 회차 건너뜀]'");
  });
});
