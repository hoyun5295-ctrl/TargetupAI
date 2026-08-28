/**
 * 시스템 알림 문구 계약 (★2026-08-28 Harold 지적)
 *
 * 무엇이 문제였나 — 운영자에게 가는 LMS가 이렇게 나가고 있었다.
 *   「대행발송 예약을 되돌리지 못했다 request=d37bd97f-… campaign=1521bc0f-… 사유=… 큐 잔존 여부 확인 필요」
 *   ①반말 ②36자 UUID 두 개가 본문의 절반 ③사실·식별자·요청이 한 줄에 뭉쳐 읽히지 않음.
 *   문자는 폭이 좁아 한 줄에 하나씩 놓아야 눈에 들어온다.
 *
 * 못 박는 것
 *   1. UUID는 어떤 형태로 들어와도 본문에 남지 않는다(옛 `message` 경로 포함).
 *   2. 구조화 입력은 제목·내역·조치가 빈 줄로 갈린다.
 *   3. 실제로 나갔던 그 문장이 정리된다(회귀 고정).
 */
import { describe, it, expect } from 'vitest';
import { stripInternalIds, buildSystemAlertBody } from '../system-alert';

describe('내부 식별자는 문자에 실리지 않는다', () => {
  it('맨 UUID를 걷어낸다', () => {
    const out = stripInternalIds('취소 실패 1521bc0f-24eb-4ff4-8794-b649f2d20e08 확인');
    expect(out).not.toMatch(/1521bc0f/);
    expect(out).toContain('취소 실패');
    expect(out).toContain('확인');
  });

  it('`키=UUID` 형태를 통째로 걷어낸다', () => {
    const out = stripInternalIds('예약 실패 request=d37bd97f-d28d-4fe1-aba9-9d08ecb53ea0 사유=취소');
    expect(out).not.toMatch(/request=/);
    expect(out).not.toMatch(/d37bd97f/);
    expect(out).toContain('사유=취소');
  });

  it('★0828 실제로 나갔던 문장이 읽을 수 있게 남는다', () => {
    const real = '대행발송 예약을 되돌리지 못했다 request=d37bd97f-d28d-4fe1-aba9-9d08ecb53ea0 '
      + 'campaign=1521bc0f-24eb-4ff4-8794-b649f2d20e08 사유=담당자 취소(마무리) '
      + '오류=취소 가능한 상태가 아닙니다 큐 잔존 여부 확인 필요';
    const out = stripInternalIds(real);
    expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(out).toContain('사유=담당자 취소(마무리)');
    // 식별자를 걷어낸 자리에 공백이 뭉치지 않는다
    expect(out).not.toMatch(/ {2,}/);
  });

  it('식별자가 없으면 원문 그대로다', () => {
    expect(stripInternalIds('발송 큐가 살아 있을 수 있습니다.')).toBe('발송 큐가 살아 있을 수 있습니다.');
  });

  it('빈 값을 안전하게 다룬다', () => {
    expect(stripInternalIds('')).toBe('');
  });
});

describe('구조화 알림은 줄로 나뉜다', () => {
  it('제목·내역·조치가 빈 줄로 갈린다', () => {
    const body = buildSystemAlertBody({
      dedupKey: 'k',
      title: '대행발송 예약을 되돌리지 못했습니다.',
      details: ['사유: 담당자 취소(마무리)', '오류: 취소 가능한 상태가 아닙니다'],
      action: '발송 큐가 살아 있을 수 있습니다. 대행발송 접수 화면에서 확인해 주세요.',
    });
    expect(body).toBe(
      '대행발송 예약을 되돌리지 못했습니다.\n'
      + '\n'
      + '사유: 담당자 취소(마무리)\n'
      + '오류: 취소 가능한 상태가 아닙니다\n'
      + '\n'
      + '발송 큐가 살아 있을 수 있습니다. 대행발송 접수 화면에서 확인해 주세요.',
    );
  });

  it('내역이 없으면 빈 줄도 없다', () => {
    const body = buildSystemAlertBody({ dedupKey: 'k', title: '제목입니다.', action: '조치입니다.' });
    expect(body).toBe('제목입니다.\n\n조치입니다.');
  });

  it('옛 `message` 호출은 그대로 쓴다 (하위호환)', () => {
    expect(buildSystemAlertBody({ dedupKey: 'k', message: '옛 문구' })).toBe('옛 문구');
  });

  it('제목이 있으면 message보다 우선한다', () => {
    expect(buildSystemAlertBody({ dedupKey: 'k', title: '새 문구', message: '옛 문구' })).toBe('새 문구');
  });
});
