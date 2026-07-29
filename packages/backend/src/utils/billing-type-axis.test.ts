/**
 * 청구 유형 축(BILLING_TYPES) 불변식 — 2026-07-29 신설
 *
 * 유형키·표시명·단가컬럼·큐 코드가 `send-usage-aggregation.ts` 안에서만 7군데에 복제돼 있던 것을
 * 표 하나에서 파생하도록 바꿨다. 이 테스트의 일은 두 가지다.
 *
 *  1) **파생 결과가 옛 리터럴과 한 글자도 다르지 않음을 못박는다.** 리팩터로 금액이 변하면 안 된다.
 *     아래 기대값은 리팩터 직전 소스에서 그대로 옮긴 것이고, 표에서 다시 계산하지 않는다 —
 *     표에서 계산하면 표가 틀려도 테스트가 같이 틀려서 아무것도 못 잡는다.
 *  2) **유형을 새로 추가할 때 빠뜨림을 막는다.** 게이트웨이 코드만 넣고 단가 컬럼을 안 넣으면
 *     그 유형은 발행 시점에 차단된다(2026-07-29 브랜드메시지 `G`가 정확히 그 상태였다).
 */

import { describe, it, expect } from 'vitest';
import {
  BILLING_TYPES,
  MSG_TYPE_TO_USAGE_KEY,
  AGENT_MSG_TYPE_TO_USAGE_KEY,
  USAGE_TYPE_LABEL,
} from './send-usage-aggregation';
import { MESSAGE_TYPE_PRICE_COLUMN } from './unit-price';

/** 리팩터 직전 소스의 값 그대로 (손으로 옮김 — 표에서 유도 금지) */
const LEGACY_MSG_TYPE_TO_USAGE_KEY = { S: 'SMS', L: 'LMS', M: 'MMS', K: 'KAKAO' };
const LEGACY_AGENT_MSG_TYPE_TO_USAGE_KEY = { S: 'SMS', L: 'LMS', M: 'MMS', K: 'KAKAO' };
const LEGACY_USAGE_TYPE_LABEL = {
  SMS: 'SMS',
  LMS: 'LMS',
  MMS: 'MMS',
  KAKAO: '카카오알림톡',
  TEST_SMS: '테스트 SMS',
  TEST_LMS: '테스트 LMS',
  SPAM_SMS: '스팸테스트 SMS',
  SPAM_LMS: '스팸테스트 LMS',
};
const LEGACY_TYPE_ORDER = ['SMS', 'LMS', 'MMS', 'KAKAO', 'TEST_SMS', 'TEST_LMS', 'SPAM_SMS', 'SPAM_LMS'];
const LEGACY_AGENT_PRICE_COLUMN = {
  SMS: 'cost_per_sms', LMS: 'cost_per_lms', MMS: 'cost_per_mms', KAKAO: 'cost_per_kakao',
};

describe('청구 유형 축 — 리팩터 전후 값 동일성', () => {
  it('SMSQ msg_type 매핑이 옛 리터럴과 같다', () => {
    // 유형을 추가해도 옛 코드의 매핑은 그대로여야 한다(추가는 허용, 변경은 불가).
    for (const [code, key] of Object.entries(LEGACY_MSG_TYPE_TO_USAGE_KEY)) {
      expect(MSG_TYPE_TO_USAGE_KEY[code]).toBe(key);
    }
  });

  it('에이전트 MsgType 매핑이 옛 리터럴과 같다', () => {
    for (const [code, key] of Object.entries(LEGACY_AGENT_MSG_TYPE_TO_USAGE_KEY)) {
      expect(AGENT_MSG_TYPE_TO_USAGE_KEY[code]).toBe(key);
    }
  });

  it('표시명이 옛 리터럴과 같다 — 엑셀 피벗이 갈라지지 않게', () => {
    for (const [key, label] of Object.entries(LEGACY_USAGE_TYPE_LABEL)) {
      expect(USAGE_TYPE_LABEL[key]).toBe(label);
    }
  });

  it('기존 8유형의 상대 순서가 유지된다 — 청구서 항목 인쇄 순서', () => {
    const keys = BILLING_TYPES.map((t) => t.key);
    const positions = LEGACY_TYPE_ORDER.map((k) => keys.indexOf(k));
    expect(positions.every((p) => p >= 0)).toBe(true);       // 하나도 사라지지 않았다
    expect(positions).toEqual([...positions].sort((a, b) => a - b)); // 서로의 앞뒤가 그대로다
  });

  it('발송ID 단가 컬럼이 옛 리터럴과 같다', () => {
    for (const [key, col] of Object.entries(LEGACY_AGENT_PRICE_COLUMN)) {
      expect(BILLING_TYPES.find((t) => t.key === key)?.agentPriceColumn).toBe(col);
    }
  });
});

describe('청구 유형 축 — 추가 시 빠뜨림 차단', () => {
  it('게이트웨이 코드가 있으면 발송ID 단가 컬럼도 있어야 한다', () => {
    // 이것이 없으면 그 유형은 청구 단가를 못 찾아 발행이 통째로 차단된다(브랜드메시지 G 사례).
    const broken = BILLING_TYPES.filter((t) => t.agentCode && !t.agentPriceColumn).map((t) => t.key);
    expect(broken).toEqual([]);
  });

  it('유형키가 중복되지 않는다', () => {
    const keys = BILLING_TYPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('표시명이 중복되지 않는다 — 같은 이름이면 엑셀에서 두 유형이 한 줄로 합쳐진다', () => {
    const labels = BILLING_TYPES.map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('선불 차감 단가 컬럼이 청구 유형 축과 어긋나지 않는다', () => {
    // 선불 차감(MESSAGE_TYPE_PRICE_COLUMN)은 축보다 **범위가 좁다**(테스트·스팸이 없다).
    // 범위 차이는 허용하되, 겹치는 유형의 단가 컬럼이 갈라지면 차감과 청구가 다른 단가를 쓰게 된다.
    for (const [key, col] of Object.entries(MESSAGE_TYPE_PRICE_COLUMN)) {
      const def = BILLING_TYPES.find((t) => t.key === key);
      expect(def, `${key}가 청구 유형 축에 없다`).toBeTruthy();
      expect(def?.companyPriceColumn).toBe(col);
    }
  });

  it('큐 코드가 중복되지 않는다 — 한 코드가 두 유형으로 갈리면 매핑이 덮어써진다', () => {
    const smsq = BILLING_TYPES.map((t) => t.smsqCode).filter(Boolean);
    expect(new Set(smsq).size).toBe(smsq.length);
    const agent = BILLING_TYPES.map((t) => t.agentCode).filter(Boolean);
    expect(new Set(agent).size).toBe(agent.length);
  });
});
