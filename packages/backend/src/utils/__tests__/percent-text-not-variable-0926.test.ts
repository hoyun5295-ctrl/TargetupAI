/**
 * 퍼센트 문구는 변수가 아니다 (★ 2026-09-26 한줄로 V2 R269 · 고객 문안 무단 변경)
 *
 * 잔여 변수 안전망(`cleanLeftoverVars`)이 `30%할인+10%적립`의 `%할인+10%`를 변수로 읽어 지웠다
 * → 발송 문안이 `30적립`으로 나갔다. 모든 발송 경로의 치환 CT(`replaceVariables`)가 이 안전망을 지난다.
 * 대행발송 변수 추출(`extractAgencyVars`·`buildSlotPlan`)도 같은 식이라 퍼센트 문구가 변수 칸을 먹었다.
 *
 * 이 파일이 잠그는 것:
 *   ① 숫자 바로 뒤의 %에서 시작하는 조각은 변수가 아니다(지우지 않고 추출하지 않는다)
 *   ② 진짜 변수·오타 변수는 종전대로(매핑 변수 치환 · 매핑 없는 변수 제거) — 기존 동작 불변
 *   ③ 건너뛴 조각의 닫는 %가 다음 변수의 여는 %면 그 변수는 그대로 읽는다
 *   ④ 화면 미러(formatDate · agency-send-api)가 같은 판정을 한다(미리보기 = 발송)
 */
import { describe, it, expect } from 'vitest';
import { cleanLeftoverVars, replaceVariables, findVarTokens } from '../messageUtils';
import { extractAgencyVars, buildSlotPlan } from '../agency-send-vars';
import type { VarCatalogEntry } from '../../services/ai';
// 테스트 전용 import — 화면 미러의 실제 값을 비교한다
import * as frontFormat from '../../../../frontend/src/utils/formatDate';
import * as frontApi from '../../../../frontend/src/components/agency/agency-send-api';

const MAPPINGS: Record<string, VarCatalogEntry> = {
  이름: { column: 'name', type: 'string', description: '고객 이름', sample: '홍길동' },
};

describe('퍼센트 문구 보존 (발송 치환 CT)', () => {
  it('30%할인+10%적립 은 그대로 나간다', () => {
    expect(replaceVariables('30%할인+10%적립', { name: '홍길동' }, MAPPINGS)).toBe('30%할인+10%적립');
    expect(replaceVariables('30%할인+10%적립', null, MAPPINGS)).toBe('30%할인+10%적립');
  });

  it('영문·기호가 섞인 퍼센트 문구도 그대로 나간다', () => {
    expect(cleanLeftoverVars('50%OFF+5% 추가')).toBe('50%OFF+5% 추가');
    expect(cleanLeftoverVars('최대30%할인·10%적립')).toBe('최대30%할인·10%적립');
    expect(cleanLeftoverVars('30%할인+10%적립20%')).toBe('30%할인+10%적립20%');
  });

  it('진짜 변수는 종전대로 치환된다', () => {
    expect(replaceVariables('%이름%님 30%할인+10%적립', { name: '홍길동' }, MAPPINGS)).toBe('홍길동님 30%할인+10%적립');
  });

  it('매핑 없는 변수(오타)는 종전대로 지운다', () => {
    expect(cleanLeftoverVars('%이룸%님 안녕하세요')).toBe('님 안녕하세요');
    expect(replaceVariables('%등급%님 30%할인+10%적립', { name: '홍길동' }, MAPPINGS)).toBe('님 30%할인+10%적립');
  });

  it('건너뛴 퍼센트 문구 바로 뒤의 변수도 읽는다', () => {
    expect(cleanLeftoverVars('10%할인%오타%님')).toBe('10%할인님');
    expect(findVarTokens('10%할인%오타%님').map((t) => t.name)).toEqual(['오타']);
  });

  it('숫자로 시작하는 %는 종전대로 변수가 아니다', () => {
    expect(cleanLeftoverVars('%3일% 남았습니다 50%~30%')).toBe('%3일% 남았습니다 50%~30%');
  });
});

describe('퍼센트 문구 보존 (대행발송 변수)', () => {
  it('퍼센트 문구는 변수 칸을 먹지 않는다', () => {
    expect(extractAgencyVars('30%할인+10%적립 %매장%에서')).toEqual(['매장']);
    const plan = buildSlotPlan('30%할인+10%적립 %매장%에서');
    expect(plan.ok).toBe(true);
    expect(plan.slotContent).toBe('30%할인+10%적립 %이름%에서');
  });
});

describe('화면 미러 = 서버 판정', () => {
  const SAMPLES = [
    '30%할인+10%적립',
    '%이름%님 30%할인+10%적립 %등급%',
    '10%할인%오타%님',
    '50%OFF+5% 추가 %기타1%',
    '%3일% 남았습니다 50%~30%',
    '30%할인+10%적립20% %매장%',
    '',
  ];
  it('잔여 변수 제거가 같다', () => {
    for (const s of SAMPLES) expect(frontFormat.cleanLeftoverVars(s)).toBe(cleanLeftoverVars(s));
  });
  it('조각 판정이 같다', () => {
    for (const s of SAMPLES) expect(frontFormat.findVarTokens(s)).toEqual(findVarTokens(s));
  });
  it('대행 변수 추출이 같다', () => {
    for (const s of SAMPLES) expect(frontApi.extractAgencyVars(s)).toEqual(extractAgencyVars(s));
  });
});
