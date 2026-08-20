/**
 * crm-agency-access.test.ts — 캠페인 대행 상태 전이 + 고객 제안서 접근 판정 (★2026-08-20 신설)
 *
 * 기원: 0709 배포분은 분석이 성공해도 status가 안 움직였고(designed_at만 기록), 제안서 PDF는
 * 슈퍼관리자 전용이라 고객 전달이 시스템 밖(오프라인)이었다. 이 파일이 못 박는 것:
 *   1. 분석 실행의 상태 전이는 **후퇴 금지** — 전달 사실(delivered/done)은 재실행으로 되돌아가지 않는다.
 *   2. 고객 제안서 다운로드는 **전달된 상태 + PDF 실존**일 때만 — 설계 중 내부 산출물이 미리 새지 않는다.
 * 게이트는 효과가 만들어지는 함수 안에 — 라우트가 각자 판정하면 경로가 늘 때마다 샌다.
 */
import { describe, it, expect } from 'vitest';
import { nextStatusAfterDesign, canCustomerDownloadProposal } from '../crm-agency-access';

describe('nextStatusAfterDesign — 분석 성공 시 상태 전이(후퇴 금지)', () => {
  it('접수됨 → 설계 중', () => {
    expect(nextStatusAfterDesign('received')).toBe('designing');
  });

  it('설계 중은 유지', () => {
    expect(nextStatusAfterDesign('designing')).toBe('designing');
  });

  it('보류 → 설계 중 — 분석 실행은 직원의 명시 행위라 보류를 푼 것으로 본다', () => {
    expect(nextStatusAfterDesign('on_hold')).toBe('designing');
  });

  it('전달됨·완료는 후퇴하지 않는다 — 재실행은 PDF 덮어쓰기만', () => {
    expect(nextStatusAfterDesign('delivered')).toBe('delivered');
    expect(nextStatusAfterDesign('done')).toBe('done');
  });

  it('모르는 상태값은 그대로 유지(fail-safe) — 상태 축이 늘어도 여기가 조용히 덮지 않는다', () => {
    expect(nextStatusAfterDesign('some_future_status')).toBe('some_future_status');
  });
});

describe('canCustomerDownloadProposal — 고객 다운로드는 전달 이후 + PDF 실존만', () => {
  it('delivered + PDF = 허용', () => {
    expect(canCustomerDownloadProposal('delivered', true)).toBe(true);
  });

  it('done + PDF = 허용 — 완료 처리 후에도 고객은 자기 제안서를 받을 수 있다', () => {
    expect(canCustomerDownloadProposal('done', true)).toBe(true);
  });

  it('설계 중·접수됨·보류는 PDF가 있어도 거부 — 검토 전 내부 산출물 비노출', () => {
    expect(canCustomerDownloadProposal('designing', true)).toBe(false);
    expect(canCustomerDownloadProposal('received', true)).toBe(false);
    expect(canCustomerDownloadProposal('on_hold', true)).toBe(false);
  });

  it('전달 상태여도 PDF가 없으면 거부', () => {
    expect(canCustomerDownloadProposal('delivered', false)).toBe(false);
  });

  it('모르는 상태값은 거부(fail-closed)', () => {
    expect(canCustomerDownloadProposal('some_future_status', true)).toBe(false);
  });
});
