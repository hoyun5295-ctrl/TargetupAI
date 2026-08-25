/**
 * 대행발송 문안 변수 슬롯 계약 (★ 2026-08-23) — docs/2026-08-22-agency-send-design.md §12 정정
 *
 * 이 파일이 잠그는 것:
 *   ① 접수 화면이 모은 값이 **실제로 문안에 들어간다** — 이 계약이 깨져 있었다
 *      (변수명 키로 넘긴 값을 치환 함수가 DB 컬럼 이름으로 찾아 전부 빈 문자열이 됐다)
 *   ② 슬롯은 네 칸뿐이고 그 이상은 접수에서 막힌다(발송 직전에 조용히 잘리지 않는다)
 *   ③ 변수 이름이 슬롯 이름과 겹쳐도 서로 덮어쓰지 않는다
 */
import { describe, it, expect } from 'vitest';
import {
  buildSlotPlan, extractAgencyVars, toSlotValues, resolveVarColumns, sameNameColumn,
  MAX_AGENCY_VARS, SLOT_VARS,
} from '../agency-send-vars';
import { normalizeVarSuggestions } from '../ai-column-mapper';
import { replaceVariables } from '../messageUtils';
import type { VarCatalogEntry } from '../../services/ai';
// 테스트 전용 import — 화면 미러의 **실제 값**을 비교한다(주석·문자열 매칭은 회귀를 못 잡는다).
//   프론트 빌드는 여전히 백엔드를 모른다(2026-07-18 빌드 사고 이후 빌드 구조 무접촉).
import * as frontApi from '../../../../frontend/src/components/agency/agency-send-api';

/** 회사 변수 카탈로그의 최소 형태. `%이름%`은 `customers.name`을 가리킨다 */
const MAPPINGS: Record<string, VarCatalogEntry> = {
  이름: { column: 'name', type: 'string', description: '고객 이름', sample: '홍길동' },
  등급: { column: 'grade', type: 'string', description: '등급', sample: 'VIP' },
};

describe('문안 변수 추출', () => {
  it('등장 순서를 지키고 같은 변수는 한 번만 센다', () => {
    expect(extractAgencyVars('%이름%님, %등급% 혜택입니다. %이름%님만!')).toEqual(['이름', '등급']);
  });

  it('본문의 퍼센트 기호는 변수가 아니다', () => {
    expect(extractAgencyVars('최대 50% 할인')).toEqual([]);
    expect(extractAgencyVars('%3일% 남았습니다')).toEqual([]); // 숫자로 시작하면 변수가 아니다
  });
});

describe('슬롯 배정', () => {
  it('문안 변수를 주소록 슬롯으로 바꾼다', () => {
    const plan = buildSlotPlan('%이름%님, %등급% 고객 전용입니다. 문의는 %매장%으로.');
    expect(plan.ok).toBe(true);
    expect(plan.order).toEqual(['이름', '등급', '매장']);
    expect(plan.slotContent).toBe('%이름%님, %기타1% 고객 전용입니다. 문의는 %기타2%으로.');
  });

  it('네 칸을 넘으면 접수에서 막는다 — 발송 직전에 잘리지 않는다', () => {
    const over = buildSlotPlan('%가% %나% %다% %라% %마%');
    expect(over.ok).toBe(false);
    expect(over.error).toContain(String(MAX_AGENCY_VARS));
    expect(buildSlotPlan('%가% %나% %다% %라%').ok).toBe(true);
    expect(SLOT_VARS.length).toBe(MAX_AGENCY_VARS);
  });

  it('변수 이름이 슬롯 이름과 겹쳐도 서로 덮어쓰지 않는다', () => {
    // 순차 치환이면 `%기타1%`을 `%이름%`으로 바꾼 결과를 다음 회차가 다시 집어 뭉갠다
    const plan = buildSlotPlan('%기타1% / %이름%');
    expect(plan.slotContent).toBe('%이름% / %기타1%');
  });
});

describe('수신자 값 옮기기', () => {
  it('변수명 키로 모은 값을 슬롯 자리로 옮긴다', () => {
    const plan = buildSlotPlan('%이름%님 %등급%');
    expect(toSlotValues({ 이름: '홍길동', 등급: 'VIP' }, plan.order))
      .toEqual({ name: '홍길동', extra1: 'VIP', extra2: '', extra3: '' });
  });

  it('값이 없거나 0이어도 자리를 지킨다', () => {
    const plan = buildSlotPlan('%포인트%');
    expect(toSlotValues({ 포인트: 0 }, plan.order).name).toBe('0');
    expect(toSlotValues({}, plan.order).name).toBe('');
    expect(toSlotValues(null, plan.order).name).toBe('');
  });
});

describe('화면 미러가 서버와 같은 답을 낸다', () => {
  it('항목 개수 상한이 같다 — 화면만 늘면 접수가 막힌다', () => {
    expect(frontApi.MAX_AGENCY_VARS).toBe(MAX_AGENCY_VARS);
  });

  it('변수로 보는 것이 같다 — 화면이 더 넓게 잡으면 매핑표에 본문 표기가 뜬다', () => {
    const samples = [
      '%이름%님 안녕하세요',
      '최대 50% 할인 %등급% 전용',
      '%3일% 뒤 마감',
      '%이름% %이름% %기타1%',
      '%아주아주아주아주아주아주아주긴변수이름입니다%',
      '퍼센트 % 하나만',
    ];
    for (const s of samples) {
      expect(frontApi.extractAgencyVars(s)).toEqual(extractAgencyVars(s));
    }
  });
});

describe('문안 항목 ↔ 명단 열 잇기 (★2026-08-25 원스텝 §17-6)', () => {
  const HEADERS = ['고객명', '휴대전화번호', '고객 등급', '포인트'];

  it('같은 이름의 열을 공백만 무시하고 찾는다', () => {
    expect(sameNameColumn(HEADERS, '고객명')).toBe('고객명');
    expect(sameNameColumn(HEADERS, '고객등급')).toBe('고객 등급');
    expect(sameNameColumn(HEADERS, '이름')).toBeNull();
  });

  it('조정값 > 같은 이름 순서로 잇고, 못 이은 항목은 null로 남는다', () => {
    const { resolved, badOverrides } = resolveVarColumns(['이름', '포인트'], HEADERS, { 이름: '고객명' });
    expect(resolved).toEqual([
      { name: '이름', column: '고객명', via: 'override' },
      { name: '포인트', column: '포인트', via: 'same' },
    ]);
    expect(badOverrides).toEqual([]);
    expect(resolveVarColumns(['이름'], HEADERS).resolved[0]).toEqual({ name: '이름', column: null, via: null });
  });

  it('조정값이 명단에 없는 열이면 폴백하지 않고 badOverrides로 알린다', () => {
    // 같은 이름 열(포인트)이 있어도 조정값이 틀렸으면 그리로 조용히 돌아가지 않는다(★2R 계약)
    const { resolved, badOverrides } = resolveVarColumns(['포인트'], HEADERS, { 포인트: '적립금' });
    expect(resolved[0].column).toBeNull();
    expect(badOverrides).toEqual(['포인트']);
  });

  it('조정값의 빈 문자열은 "아직 안 골랐다"라 같은 이름 규칙으로 내려간다', () => {
    const { resolved } = resolveVarColumns(['포인트', '이름'], HEADERS, { 포인트: '', 이름: '' });
    expect(resolved[0]).toEqual({ name: '포인트', column: '포인트', via: 'same' });
    expect(resolved[1].column).toBeNull();
  });
});

describe('AI 추천 응답 다듬기 (순수 계약)', () => {
  const VARS = ['이름', '적립금'];
  const COLS = ['고객명', '포인트'];

  it('명단에 있는 열 + 충분한 confidence만 추천으로 남는다', () => {
    const out = normalizeVarSuggestions({
      suggestions: [
        { name: '이름', column: '고객명', confidence: 0.95 },
        { name: '적립금', column: '마일리지', confidence: 0.9 }, // 명단에 없는 열
      ],
    }, VARS, COLS);
    expect(out).toEqual([
      { name: '이름', column: '고객명', confidence: 0.95 },
      { name: '적립금', column: null, confidence: 0.9 },
    ]);
  });

  it('낮은 confidence·항목 밖 응답·빠진 항목은 null로 접는다', () => {
    const out = normalizeVarSuggestions({
      suggestions: [
        { name: '이름', column: '고객명', confidence: 0.3 }, // 0.5 미만 = 억지 매핑 금지
        { name: '없는항목', column: '포인트', confidence: 1 },
      ],
    }, VARS, COLS);
    expect(out[0].column).toBeNull();
    expect(out[1]).toEqual({ name: '적립금', column: null, confidence: 0 });
    expect(normalizeVarSuggestions(null, VARS, COLS)).toHaveLength(2);
  });

  it('타입 이상은 fail-closed — 배열·불리언·범위 밖 수치가 정상 값으로 승격되지 않는다 (★Codex 1R)', () => {
    // String(["고객명"]) === "고객명" · Number(true) === 1 로 통과하던 구멍
    const out = normalizeVarSuggestions({
      suggestions: [
        { name: ['이름'], column: ['고객명'], confidence: true },
        { name: '적립금', column: '포인트', confidence: 1.2 }, // 범위 밖 = 무효
      ],
    }, VARS, COLS);
    expect(out[0]).toEqual({ name: '이름', column: null, confidence: 0 });
    expect(out[1]).toEqual({ name: '적립금', column: null, confidence: 0 });
  });

  it('같은 항목이 서로 다른 열로 두 번 오면 추천을 버린다 — 순서 의존 금지 (★Codex 1R)', () => {
    const conflicted = normalizeVarSuggestions({
      suggestions: [
        { name: '이름', column: '고객명', confidence: 0.9 },
        { name: '이름', column: '포인트', confidence: 0.9 },
      ],
    }, VARS, COLS);
    expect(conflicted[0]).toEqual({ name: '이름', column: null, confidence: 0 });
    // 같은 열이면 중복이어도 유지된다
    const agreed = normalizeVarSuggestions({
      suggestions: [
        { name: '이름', column: '고객명', confidence: 0.9 },
        { name: '이름', column: '고객명', confidence: 0.8 },
      ],
    }, VARS, COLS);
    expect(agreed[0].column).toBe('고객명');
  });
});

describe('치환까지 이어지는가 (이 축이 실제로 깨져 있던 지점)', () => {
  it('슬롯 문안 + 슬롯 값이면 발송 CT가 값을 넣는다', () => {
    const plan = buildSlotPlan('%이름%님, %등급% 혜택 안내');
    const v = toSlotValues({ 이름: '홍길동', 등급: 'VIP' }, plan.order);
    const out = replaceVariables(plan.slotContent, {}, MAPPINGS, v, { skipNumberFormatting: true });
    expect(out).toBe('홍길동님, VIP 혜택 안내');
  });

  it('옛 방식(변수명 키를 그대로 넘김)은 전부 빈칸이 된다 — 회귀 감시', () => {
    const broken = replaceVariables('%이름%님, %등급% 혜택 안내', { 이름: '홍길동', 등급: 'VIP' }, MAPPINGS);
    expect(broken).toBe('님,  혜택 안내');
    expect(broken).not.toContain('홍길동');
  });
});
