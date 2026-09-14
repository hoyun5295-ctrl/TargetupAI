/**
 * 알림톡 예약·분할 발송 — 화면에서 서버까지 값이 끊기지 않는다 (2026-09-14 박성용 접수 cmu0zpd0z02gyjnluuclvxk9r)
 *
 * 경위: 알림톡 발송 창에 예약·분할이 없었고, Dashboard 발송 실행은 알림톡이면 분할을 false로 막고
 *   예약은 **직접발송 패널의 전역 값**을 그대로 실었다. 직접발송에서 예약을 켜 둔 채 알림톡 창으로 넘어가면
 *   확인 창은 즉시 발송인데 서버는 예약으로 접수하는 경로가 열려 있었다
 *   (0914 운영 PG 조회: send_channel='alimtalk' + send_config.scheduled=true 캠페인 1건 a8cf5f94…).
 *
 * 못 박는 것:
 *   1. 알림톡 창이 예약·분할 값을 스스로 들고, 확인 창으로 넘긴다(type·dateTime·splitEnabled·splitCount).
 *   2. Dashboard 발송 실행의 알림톡 분기는 확인 창이 가져온 값만 쓴다(직접발송 패널 전역 값 금지 · 분할 강제 false 금지).
 *   3. 예약 문안 수정 경로는 알림톡 행을 문자 문안으로 덮지 않는다(템플릿 불일치 방지).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n');
}

const FRONT = join(__dirname, '../../../frontend/src');
const modal = stripComments(readFileSync(join(FRONT, 'components/AlimtalkSendModal.tsx'), 'utf8'));
const dash = stripComments(readFileSync(join(FRONT, 'pages/Dashboard.tsx'), 'utf8'));
const campaigns = stripComments(readFileSync(join(__dirname, '../routes/campaigns.ts'), 'utf8'));

const between = (src: string, start: string, end: string) => {
  const s = src.indexOf(start);
  expect(s, `${start} 없음`).toBeGreaterThan(-1);
  const e = src.indexOf(end, s + start.length);
  return src.slice(s, e === -1 ? undefined : e);
};

describe('알림톡 발송 창 — 예약·분할 값을 스스로 들고 확인 창으로 넘긴다', () => {
  it('예약 시각 창을 알림톡 창 안에서 연다', () => {
    expect(modal).toMatch(/import ScheduleTimeModal from '\.\/ScheduleTimeModal'/);
    expect(modal).toMatch(/<ScheduleTimeModal[\s\S]*?setReserveEnabled=\{setReserveEnabled\}/);
  });

  it('확인 창으로 예약 여부·시각·분할 값을 넘긴다', () => {
    const send = between(modal, 'onSendConfirm({', '});');
    expect(send).toMatch(/type:\s*reserveEnabled \? 'scheduled' : 'immediate'/);
    expect(send).toMatch(/dateTime:\s*reserveEnabled \? reserveDateTime : undefined/);
    expect(send).toMatch(/splitEnabled,/);
    expect(send).toMatch(/splitCount,/);
  });

  it('확인 창 계약 타입이 즉시 발송 고정이 아니다', () => {
    const props = between(modal, 'onSendConfirm: (data: {', '}) => void;');
    expect(props).toMatch(/type: 'immediate' \| 'scheduled';/);
    expect(props).toMatch(/splitEnabled: boolean;/);
    expect(props).toMatch(/splitCount: number;/);
  });
});

describe('Dashboard — 알림톡 분기는 확인 창이 가져온 값만 쓴다', () => {
  it('알림톡 창의 값을 확인 창 상태에 싣는다', () => {
    const handler = between(dash, '<AlimtalkSendModal', 'setToast={setToast}');
    expect(handler).toMatch(/type:\s*data\.type,/);
    expect(handler).toMatch(/dateTime:\s*data\.dateTime,/);
    expect(handler).toMatch(/alimtalkSplitEnabled:\s*data\.splitEnabled,/);
    expect(handler).toMatch(/alimtalkSplitCount:\s*data\.splitCount,/);
  });

  it('발송 실행이 알림톡이면 직접발송 패널의 예약·분할 전역 값을 쓰지 않는다', () => {
    const exec = between(dash, 'const executeDirectSend = async', "fetch('/api/campaigns/direct-send/commit'");
    expect(exec).not.toMatch(/isAlimtalk \? false : splitEnabled/);
    expect(exec).toMatch(/scheduled:\s*isAlimtalk \? alimScheduled : reserveEnabled,/);
    expect(exec).toMatch(/splitEnabled:\s*isAlimtalk \? alimSplitEnabled : splitEnabled,/);
    expect(exec).toMatch(/const alimScheduled = isAlimtalk && sendConfirm\.type === 'scheduled' && !!sendConfirm\.dateTime;/);
  });
});

describe('예약 문안 수정 — 알림톡 행을 덮지 않는다', () => {
  const route = between(campaigns, "router.put('/:id/message'", 'router.');

  it('알림톡 캠페인·알림톡 행이 있으면 수정 전에 거부한다', () => {
    expect(route).toMatch(/send_channel === 'alimtalk' \|\| recipients\.some\(\(r: any\) => r\.msg_type === 'K'\)/);
  });

  it('일괄 수정 UPDATE도 브랜드·알림톡 행을 조건으로 제외한다(경합 대비 이중 방어)', () => {
    expect(route).toMatch(/msg_type NOT IN \('F', 'K'\)/);
  });
});
