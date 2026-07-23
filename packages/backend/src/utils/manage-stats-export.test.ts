import { describe, it, expect } from 'vitest';
import { buildManageStatsCsv } from './manage-stats-export';

describe('manage-stats-export — 발송 통계 CSV(엑셀) 빌더 (서수란 2026-07-23)', () => {
  const BOM = '﻿';

  it('빈 입력 — BOM + 헤더만', () => {
    const csv = buildManageStatsCsv({});
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toBe(BOM + '채널,기간,발송ID,유형,전송,성공,실패,대기');
  });

  it('웹 행 — 채널=웹, 발송ID/유형/대기 공란', () => {
    const csv = buildManageStatsCsv({ webRows: [{ period: '2026-07-23', sent: 100, success: 95, fail: 5 }] });
    const lines = csv.replace(BOM, '').split('\n');
    expect(lines[1]).toBe('웹,2026-07-23,,,100,95,5,');
  });

  it('에이전트 행 — 채널=에이전트, 발송ID·유형·대기 채움', () => {
    const csv = buildManageStatsCsv({
      agentRows: [{ period: '2026-07-23', agent_send_id: 'D0002', type_label: 'SMS', msg_type: 'S', sent: 1632, success: 1612, fail: 20, pending: 0 }],
    });
    const lines = csv.replace(BOM, '').split('\n');
    expect(lines[1]).toBe('에이전트,2026-07-23,D0002,SMS,1632,1612,20,0');
  });

  it('웹+에이전트 합산 — 한 파일에 두 채널 행', () => {
    const csv = buildManageStatsCsv({
      webRows: [{ period: '2026-07', sent: 10, success: 9, fail: 1 }],
      agentRows: [
        { period: '2026-07', agent_send_id: 'D0002', type_label: 'LMS', sent: 5, success: 5, fail: 0, pending: 0 },
        { period: '2026-07', agent_send_id: 'D0003', type_label: '카카오알림톡', sent: 3, success: 2, fail: 1, pending: 0 },
      ],
    });
    const lines = csv.replace(BOM, '').split('\n');
    expect(lines).toHaveLength(4); // 헤더 + 웹1 + 에이전트2
    expect(lines[1].startsWith('웹,')).toBe(true);
    expect(lines[2]).toContain('에이전트,2026-07,D0002');
    expect(lines[3]).toContain('D0003,카카오알림톡');
  });

  it('type_label 없으면 msg_type 폴백', () => {
    const csv = buildManageStatsCsv({ agentRows: [{ period: '2026-07-23', agent_send_id: 'B0046', msg_type: 'M', sent: 1, success: 1, fail: 0, pending: 0 }] });
    expect(csv.replace(BOM, '').split('\n')[1]).toBe('에이전트,2026-07-23,B0046,M,1,1,0,0');
  });

  it('쉼표 포함 값은 큰따옴표로 이스케이프', () => {
    const csv = buildManageStatsCsv({ agentRows: [{ period: '2026-07-23', agent_send_id: 'A,B', type_label: 'SMS', sent: 1, success: 1, fail: 0, pending: 0 }] });
    expect(csv).toContain('"A,B"');
  });

  it('숫자 아닌 값·undefined는 0으로', () => {
    const csv = buildManageStatsCsv({ webRows: [{ period: '2026-07-23', sent: 'x' as any, success: undefined as any, fail: 3 }] });
    expect(csv.replace(BOM, '').split('\n')[1]).toBe('웹,2026-07-23,,,0,0,3,');
  });
});
