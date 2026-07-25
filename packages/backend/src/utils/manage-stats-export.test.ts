import { describe, it, expect } from 'vitest';
import { buildManageStatsCsv, buildAdminAgentStatsCsv } from './manage-stats-export';

describe('manage-stats-export — 발송 통계 CSV(엑셀) 빌더 (서수란 2026-07-23)', () => {
  const BOM = '﻿';

  it('빈 입력 — BOM + 헤더만(발급명·대상ID 컬럼 포함)', () => {
    const csv = buildManageStatsCsv({});
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toBe(BOM + '채널,기간,발송ID,발급명,대상ID,유형,구분,전송,성공,실패,대기');
  });

  it('웹 행 — 유형 채움, 발송ID/발급명/대상ID는 공란(에이전트 전용 축)', () => {
    const csv = buildManageStatsCsv({ webRows: [{ period: '2026-07-23', type_label: 'SMS', sent: 100, success: 95, fail: 5, pending: 0 }] });
    const lines = csv.replace(BOM, '').split('\n');
    expect(lines[1]).toBe('웹,2026-07-23,,,,SMS,직접,100,95,5,0');
  });

  it('웹 행 — 유형 없으면 (유형 미상). 빈 셀은 데이터 누락으로 오인된다', () => {
    const csv = buildManageStatsCsv({ webRows: [{ period: '2026-07-23', sent: 100, success: 95, fail: 5 }] });
    const lines = csv.replace(BOM, '').split('\n');
    expect(lines[1]).toBe('웹,2026-07-23,,,,(유형 미상),직접,100,95,5,');
  });

  it('웹 행 — 알림톡 라벨도 그대로 실린다', () => {
    const csv = buildManageStatsCsv({ webRows: [{ period: '2026-07', type_label: '알림톡', sent: 7, success: 7, fail: 0, pending: 0 }] });
    expect(csv.replace(BOM, '').split('\n')[1]).toBe('웹,2026-07,,,,알림톡,직접,7,7,0,0');
  });

  it('에이전트 행 — 발급명·대상ID 채움(마리오 400)', () => {
    const csv = buildManageStatsCsv({
      agentRows: [{ period: '2026-07-23', agent_send_id: 'B0039', cust_name: '마리오아울렛_EBIZ', store_id: '400', type_label: 'SMS', msg_type: 'S', sent: 1632, success: 1612, fail: 20, pending: 0 }],
    });
    const lines = csv.replace(BOM, '').split('\n');
    expect(lines[1]).toBe('에이전트,2026-07-23,B0039,마리오아울렛_EBIZ,400,SMS,직접,1632,1612,20,0');
  });

  it('에이전트 행 — 대상ID 빈 값이면 (대상ID 없음)', () => {
    const csv = buildManageStatsCsv({
      agentRows: [{ period: '2026-07-23', agent_send_id: 'D0018', cust_name: '아난티', store_id: '', type_label: 'LMS', sent: 10, success: 10, fail: 0, pending: 0 }],
    });
    const lines = csv.replace(BOM, '').split('\n');
    expect(lines[1]).toBe('에이전트,2026-07-23,D0018,아난티,(대상ID 없음),LMS,직접,10,10,0,0');
  });

  it('에이전트 행 — 발급명·대상ID 모두 없으면 각각 공란·(대상ID 없음)', () => {
    const csv = buildManageStatsCsv({
      agentRows: [{ period: '2026-07-23', agent_send_id: 'D0002', type_label: 'SMS', msg_type: 'S', sent: 10, success: 10, fail: 0, pending: 0 }],
    });
    const lines = csv.replace(BOM, '').split('\n');
    expect(lines[1]).toBe('에이전트,2026-07-23,D0002,,(대상ID 없음),SMS,직접,10,10,0,0');
  });

  it('웹+에이전트 합산 — 한 파일에 두 채널 행', () => {
    const csv = buildManageStatsCsv({
      webRows: [{ period: '2026-07', sent: 10, success: 9, fail: 1 }],
      agentRows: [
        { period: '2026-07', agent_send_id: 'B0081', cust_name: '피케이포유_SMS', store_id: '한솔축산둔산점', type_label: 'LMS', sent: 5, success: 5, fail: 0, pending: 0 },
        { period: '2026-07', agent_send_id: 'D0003', type_label: '카카오알림톡', sent: 3, success: 2, fail: 1, pending: 0 },
      ],
    });
    const lines = csv.replace(BOM, '').split('\n');
    expect(lines).toHaveLength(4); // 헤더 + 웹1 + 에이전트2
    expect(lines[1].startsWith('웹,')).toBe(true);
    expect(lines[2]).toContain('에이전트,2026-07,B0081,피케이포유_SMS,한솔축산둔산점');
    expect(lines[3]).toContain('D0003,,(대상ID 없음),카카오알림톡,직접');
  });

  it('type_label 없으면 msg_type 폴백', () => {
    const csv = buildManageStatsCsv({ agentRows: [{ period: '2026-07-23', agent_send_id: 'B0046', store_id: '', msg_type: 'M', sent: 1, success: 1, fail: 0, pending: 0 }] });
    expect(csv.replace(BOM, '').split('\n')[1]).toBe('에이전트,2026-07-23,B0046,,(대상ID 없음),M,직접,1,1,0,0');
  });

  it('발송ID·발급명·대상ID에 쉼표 있으면 큰따옴표로 이스케이프', () => {
    const csv = buildManageStatsCsv({ agentRows: [{ period: '2026-07-23', agent_send_id: 'B0081', cust_name: '가,나', store_id: '장보고마트-나주,혁신점', type_label: 'SMS', sent: 1, success: 1, fail: 0, pending: 0 }] });
    expect(csv).toContain('"가,나"');
    expect(csv).toContain('"장보고마트-나주,혁신점"');
  });

  it('숫자 아닌 값·undefined는 0으로', () => {
    const csv = buildManageStatsCsv({ webRows: [{ period: '2026-07-23', sent: 'x' as any, success: undefined as any, fail: 3 }] });
    expect(csv.replace(BOM, '').split('\n')[1]).toBe('웹,2026-07-23,,,,(유형 미상),직접,0,0,3,');
  });

  it('부달 재전송 귀속분은 구분 열에 표시된다 — 직접분과 섞이면 정산 대조가 안 된다', () => {
    const csv = buildManageStatsCsv({
      agentRows: [{ period: '2026-07-24', agent_send_id: 'B0179', cust_name: '원업체', store_id: 'b0179_16601910', is_relay: true, type_label: 'SMS', sent: 12, success: 11, fail: 1, pending: 0 }],
    });
    expect(csv.replace(BOM, '').split('\n')[1]).toBe('에이전트,2026-07-24,B0179,원업체,b0179_16601910,SMS,부달재전송,12,11,1,0');
  });

  it('수식 주입 차단 — =,+,-,@로 시작하는 대상ID는 텍스트로 강제', () => {
    for (const evil of ['=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)']) {
      const csv = buildManageStatsCsv({
        agentRows: [{ period: '2026-07-23', agent_send_id: 'B0081', store_id: evil, type_label: 'SMS', sent: 1, success: 1, fail: 0, pending: 0 }],
      });
      expect(csv).toContain(`'${evil}`); // 선행 ' 로 수식 실행 차단
    }
  });

  it('수식 주입 차단 — 발급명·발송ID 등 다른 텍스트 컬럼도 동일 적용', () => {
    const csv = buildManageStatsCsv({
      agentRows: [{ period: '2026-07-23', agent_send_id: '=cmd', cust_name: '=HYPERLINK("x")', store_id: '400', type_label: 'SMS', sent: 1, success: 1, fail: 0, pending: 0 }],
    });
    expect(csv).toContain("'=cmd");
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`); // 따옴표 포함이라 감싸기까지
  });

  it('수식 주입 차단 — 전각(＝＋－＠)·LF 시작값도 텍스트로 강제', () => {
    for (const evil of ['＝1+1', '＋SUM(A1)', '－2', '＠SUM(A1)', '\n=1+1']) {
      const csv = buildManageStatsCsv({
        agentRows: [{ period: '2026-07-23', agent_send_id: 'B0081', store_id: evil, type_label: 'SMS', sent: 1, success: 1, fail: 0, pending: 0 }],
      });
      expect(csv).toContain(`'${evil}`);
    }
  });

  it('CR 포함 값은 큰따옴표로 감싸 행 분리 차단', () => {
    const csv = buildManageStatsCsv({
      agentRows: [{ period: '2026-07-23', agent_send_id: 'B0081', store_id: 'a\rb', type_label: 'SMS', sent: 1, success: 1, fail: 0, pending: 0 }],
    });
    expect(csv).toContain('"a\rb"');
  });
});

describe('buildAdminAgentStatsCsv — 슈퍼 에이전트 통계 CSV (정산 대조, 2026-07-24)', () => {
  const BOM = '﻿';

  it('빈 배열 — BOM + 헤더만(고객사·발급명·대상ID 컬럼 포함)', () => {
    const csv = buildAdminAgentStatsCsv([]);
    expect(csv).toBe(BOM + '기간,고객사,발송ID,발급명,대상ID,유형,구분,전송,성공,실패,대기');
  });

  it('행 — 기간×고객사×발송ID×발급명×대상ID×유형 전개', () => {
    const csv = buildAdminAgentStatsCsv([
      { period: '2026-07-23', company_name: '마리오아울렛', agent_send_id: 'B0039', cust_name: '마리오아울렛_EBIZ', store_id: '400', type_label: 'SMS', sent: 1632, success: 1612, fail: 20, pending: 0 },
      { period: '2026-07-23', company_name: '아난티', agent_send_id: 'D0018', cust_name: '아난티', store_id: '', type_label: 'LMS', sent: 10, success: 9, fail: 1, pending: 0 },
    ]);
    const lines = csv.replace(BOM, '').split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('2026-07-23,마리오아울렛,B0039,마리오아울렛_EBIZ,400,SMS,직접,1632,1612,20,0');
    expect(lines[2]).toBe('2026-07-23,아난티,D0018,아난티,(대상ID 없음),LMS,직접,10,9,1,0'); // 대상ID 빈 값 = 없음
  });

  it('고객사명·발송ID·발급명·대상ID 누락은 공란/없음, type_label 없으면 msg_type 폴백', () => {
    const csv = buildAdminAgentStatsCsv([{ period: '2026-07', msg_type: 'K', sent: 5, success: 5, fail: 0, pending: 0 }]);
    expect(csv.replace(BOM, '').split('\n')[1]).toBe('2026-07,,,,(대상ID 없음),K,직접,5,5,0,0');
  });

  it('슈퍼 — 미귀속 부달분도 버리지 않고 (미귀속)으로 남는다', () => {
    const csv = buildAdminAgentStatsCsv([
      { period: '2026-07-24', company_name: '(미귀속)', agent_send_id: 'B0061', store_id: 'zzzz_unknown', is_relay: true, type_label: 'SMS', sent: 3, success: 3, fail: 0, pending: 0 },
    ]);
    expect(csv.replace(BOM, '').split('\n')[1]).toBe('2026-07-24,(미귀속),B0061,,zzzz_unknown,SMS,부달재전송,3,3,0,0');
  });

  it('고객사명에 쉼표 있으면 이스케이프', () => {
    const csv = buildAdminAgentStatsCsv([{ period: '2026-07', company_name: '가,나', agent_send_id: 'B0046', store_id: '400', type_label: 'MMS', sent: 1, success: 1, fail: 0, pending: 0 }]);
    expect(csv).toContain('"가,나"');
  });
});
