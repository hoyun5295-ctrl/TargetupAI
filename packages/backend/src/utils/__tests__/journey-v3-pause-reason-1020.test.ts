/**
 * 여정 V.3 묶음 3 — 멈춘 이유를 사람 말로(2026-10-20 · 설계서 §6-6)
 *
 * 실행기 · 감시 · 사전검사 스캐너 · 사람 멈춤이 남기는 pause_reason 원문 전부를 표로 고정한다(문자열이 늘면 이 시험이 깨진다).
 * 화면에는 원문을 내보내지 않는다(내부 말 · 「step 3」 · 「status=」 0).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { pauseReasonView } from '../journey-pause-reason';

const TABLE: Array<[string | null, string]> = [
  ['이번 달 크레딧이 모자라 발송을 멈췄습니다', 'credit'],
  ['잔액 부족 (보유 1,000원 < 필요 1,200원)', 'balance'],
  ['잔액 부족', 'balance'],
  ['요금제가 잠겨 발송을 멈췄습니다', 'plan'],
  ['발송 라인그룹 미설정', 'line'],
  ['SMS 발송 테이블 미할당', 'line'],
  ['회신번호가 비어있어 발송 차단됨', 'callback'],
  ['step 2 알림톡 템플릿 코드가 비어있어 발송 차단', 'template'],
  ['step 2 알림톡 템플릿(T123) 미존재 또는 회사 격리 위반', 'template'],
  ['step 2 알림톡 템플릿 미승인 (status=REJ)', 'template'],
  ['step 2 카카오 템플릿 비활성', 'template'],
  ['step 3 제목이 비어있어 LMS/MMS 발송 차단', 'subject'],
  ['step 비용 12,000원 > 임계값 10,000원', 'cost'],
  ['이번 달 누적 120,000원 > 월 예산 100,000원', 'budget'],
  ['통신사 일시 발송 실패 (자동 재시도 1회 후에도 fail)', 'carrier'],
  ['조건 평가 DB 오류 (자동 재시도 후에도 실패)', 'condition'],
  ['대량 진입 감지 (신규 후보 500건 초과). 자동 정지, 담당자 확인 필요', 'cap'],
  ['신규 고객 판정 불가: 가입일 없음', 'identity'],
  ['발송 2시간 전 스팸필터 통과 실패 (자동 재생성 후에도 차단). 문안 직접 확인 필요', 'pretest'],
  ['발송 2시간 전 스팸필터를 통과하도록 고친 문안을 담당자에게 알리지 못해 여정을 멈췄습니다. 문안을 확인한 뒤 재개해 주세요.', 'pretest'],
  ['관리자 일시정지', 'manual'],
  ['담당자가 안내 문자 링크에서 여정 전체를 일시정지했습니다.', 'manual'],
  [null, 'manual'],
  ['', 'manual'],
  ['알 수 없는 새 사유 xyz', 'unknown'],
];

describe('pauseReasonView', () => {
  it.each(TABLE)('%s → %s', (raw, kind) => {
    expect(pauseReasonView(raw).kind).toBe(kind);
  });
  it('화면 문장에 원문 · 내부 말 0', () => {
    for (const [raw] of TABLE) {
      const v = pauseReasonView(raw);
      expect(v.text).not.toMatch(/step \d|status=|T123|라인그룹|테이블|격리|임계값|fail|DB/);
      if (raw) expect(v.text).not.toContain(raw);
      expect(v.text).not.toContain('—');
    }
  });
  it('크레딧 · 요금제 = 요금제 올리기 신청 · 잔액 = 충전 · 사람 멈춤 = 다시 켜기', () => {
    expect(pauseReasonView('이번 달 크레딧이 모자라 발송을 멈췄습니다').fix?.action).toBe('plan_upgrade');
    expect(pauseReasonView('요금제가 잠겨 발송을 멈췄습니다').fix?.action).toBe('plan_upgrade');
    expect(pauseReasonView('잔액 부족').fix?.action).toBe('charge');
    expect(pauseReasonView('관리자 일시정지').fix?.action).toBe('resume');
  });
  it('실행기의 멈춤 문자열이 모두 표에 있다(새 문자열이 생기면 여기서 깨진다)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'journey-executor.ts'), 'utf-8');
    const raws = [...src.matchAll(/pauseJourney\(exec\.journey_id, (['`])([^'`]+)\1\)/g)].map((m) => m[2].replace(/\$\{[^}]+\}/g, 'X'));
    expect(raws.length).toBeGreaterThan(10);
    for (const r of raws) expect(pauseReasonView(r).kind, r).not.toBe('unknown');
  });
});
