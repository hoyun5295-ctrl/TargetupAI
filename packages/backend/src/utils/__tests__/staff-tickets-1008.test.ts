/**
 * ★2026-10-08 직원 접수 3건 고정(화면 · 담당자 문자 원문 계약)
 *   - 임은지 cmuz0id2k0su5jnn4jijv1zrs: 직접발송 · 직접 타겟 발송 「미리보기로 한 번에 보기」 줄 = 편집 도구 「미리보기」와 이중 → 제거(공용 훅 째로)
 *   - 남지현 cmuywtarp0s3gjnn490yxtqgo: 직접 타겟 발송 「내일 오전 10:16까지 발송 가능」 → 제거(만료됐을 때만 알림)
 *   - 남지현 cmuyx9jav0sedjnn4y7clu5sq: 자동마케팅 담당자 문자 · 승인 화면 문안 = 고객이 받는 모양((광고) · 무료수신거부 · 발송과 같은 080)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildAdMessage } from '../messageUtils';

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('직원 접수 1008', () => {
  it('발송 창 두 곳에 「한 번에 보기」 줄이 없다 · 공용 훅이 넘침 상태를 내지 않는다', () => {
    for (const p of ['frontend/src/components/DirectSendPanel.tsx', 'frontend/src/components/TargetSendModal.tsx']) {
      const src = read(p);
      expect(src).not.toContain('미리보기로 한 번에 보기');
      expect(src).not.toContain('editorOverflow');
    }
    expect(read('frontend/src/components/direct-send/useEditorFill.ts')).not.toMatch(/editorOverflow|syncEditorOverflow/);
  });

  it('직접 타겟 발송에 「~까지 발송 가능」 문구가 없다', () => {
    expect(read('frontend/src/components/TargetSendModal.tsx')).not.toContain('까지 발송 가능');
  });

  it('담당자 문안 문자 두 곳 = toSentCopy(발송과 같은 CT · 같은 080) · 검사 080 도 같은 값', () => {
    const src = read('backend/src/utils/continuous-operator.ts');
    expect(src).toContain("const toSentCopy = (body: string) => buildAdMessage(body, channelForSpam, isAd, adOpt080);");
    expect(src).toContain("'[AI 자동마케팅] 추천 문안', toSentCopy(finalNoticeCopy)");
    expect(src).toContain('sendAutoSendPrepNotice(operator, proposalRes.rows[0].id, toSentCopy(finalNoticeCopy)');
    expect(src).not.toContain('rejectNumber: ctx.reject_number || undefined');
    expect(src).toContain('adOptOut: await opt080By.get(owner)!');
  });

  it('승인 화면 문안 = 광고 미러로 감싼다', () => {
    const card = read('frontend/src/components/automarketing/ProposalDecisionCard.tsx');
    expect(card).toContain("buildAdMessageFront(effectiveBody, channelName, true, proposal.adOptOut || '')");
    expect(card).toContain('buildAdSubjectFront(effectiveSubject, channelName, true)');
  });

  it('본인 전용 계정의 해외 접속 · 접근 예외는 본인 화면에서만(현황 건수 · 예외 목록 · 해외 접속 이력 + 건수)', () => {
    const src = read('backend/src/routes/admin.ts');
    expect(src.match(/hiddenAccessOwnerIds\(req\.user\?\.userId\)/g)?.length).toBe(3);
    expect(src.match(/user_id::text <> ALL\(\$\d::text\[\]\)/g)?.length).toBe(4);
    expect(read('backend/src/utils/audit-log.ts')).toContain("process.env.PRIVATE_ACCESS_LOGIN_IDS || 'ceo'");
  });

  it('감싼 문안 모양(LMS) = (광고) 머리 · 무료수신거부 꼬리', () => {
    expect(buildAdMessage('본문\n[주식회사 인비토]', 'LMS', true, '080-000-0000'))
      .toBe('(광고) 본문\n[주식회사 인비토]\n무료수신거부 080-000-0000');
  });
});
