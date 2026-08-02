/**
 * 여정 진입(신규 고객 판정) 불변식 — 소스 스캔 고정 (2026-08-01)
 *
 * 왜 소스 스캔인가
 *   여기서 지키려는 것들은 타입으로 막히지 않는다. SQL 문자열 안의 절이거나,
 *   "이 함수를 쓰지 마라"는 금지이거나, 워커 분기의 존재 여부다.
 *   전부 되돌리기 쉬운 형태라 되돌아간 적이 있다(2026-08-01 Codex 적대검증 3건).
 *
 * ⛔ LESSONS_BACKEND — 소스 스캔은 **검출기 자체를 fixture로 고정**한다.
 *   주석에 값이 남아 있기만 해도 통과하면 그 검사는 거짓이다. 그래서 주석을 걷어낸 뒤 검사하고,
 *   "주석에만 있으면 반드시 실패한다"를 함께 단정한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EXTRACTOR = resolve(process.cwd(), 'src/utils/journey-target-extractor.ts');
const WATCHER = resolve(process.cwd(), 'src/utils/journey-trigger-watcher.ts');
const PROFILE = resolve(process.cwd(), 'src/utils/company-data-profile.ts');

/** 블록 주석과 줄 주석을 걷어낸다 — 주석에 남은 흔적이 검사를 통과시키지 않게. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const code = (p: string) => stripComments(readFileSync(p, 'utf8'));

describe('검출기 자체 검증 (fixture)', () => {
  it('주석에만 있는 값은 통과하지 않는다', () => {
    const onlyInComment = stripComments(`
      // DISTINCT ON (c.phone)
      /* COALESCE(c.phone, '') <> '' */
      const x = 1;
    `);
    expect(/DISTINCT ON \(c\.phone\)/.test(onlyInComment)).toBe(false);
    expect(/COALESCE\(c\.phone/.test(onlyInComment)).toBe(false);
  });

  it('코드에 있는 값은 남는다 (과잉 제거 아님)', () => {
    const inCode = stripComments(`const sql = 'DISTINCT ON (c.phone)'; // 설명`);
    expect(/DISTINCT ON \(c\.phone\)/.test(inCode)).toBe(true);
  });
});

describe('신규 고객 추출 불변식 (journey-target-extractor)', () => {
  const src = code(EXTRACTOR);

  it('사람 단위로 중복 제거한다 — 같은 번호 두 행이 한 회차에 함께 나가지 않게', () => {
    expect(src).toMatch(/DISTINCT ON \(c\.phone\)/);
  });

  it('중복 제거를 LIMIT보다 먼저 한다 — 중복이 정원을 먹으면 진짜 신규가 밀린다', () => {
    // 서브쿼리 안에 DISTINCT ON, 바깥에 LIMIT.
    const sub = src.indexOf('DISTINCT ON (c.phone)');
    const lim = src.indexOf('LIMIT $', sub);
    const close = src.indexOf(') s', sub);
    expect(sub).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(sub);
    expect(lim).toBeGreaterThan(close);
  });

  it('전화번호 없는 행은 신규 후보에서 뺀다 — 발송도 원장 기록도 안 되는데 매회 되살아난다', () => {
    expect(src).toMatch(/COALESCE\(c\.phone, ''\) <> ''/);
  });

  it('기존 고객 술어를 부정으로 건다', () => {
    expect(src).toMatch(/AND NOT \$\{existingPred\}/);
  });

  it('판정 CT를 직접 쓴다 — 인라인 재구현 금지', () => {
    expect(src).toMatch(/from '\.\/journey-identity-signals'/);
  });

  // ★ 2026-08-01 Codex 3R — 추출은 회사 능력을 조회하지 않는다.
  //   능력을 읽은 시점과 고객 행을 읽는 시점이 갈리면 그 사이 데이터 변화가 술어를 무력하게 만든다.
  //   술어는 고객 데이터로만 평가되므로 능력을 알 필요가 없다. 결합이 되살아나면 경합도 되살아난다.
  it('회사 능력 계산과 결합하지 않는다 — 판정-추출 경합 원천 차단', () => {
    expect(src).not.toMatch(/company-data-profile/);
    expect(src).not.toMatch(/getCompanyIdentityCapability/);
  });
});

describe('이관 유예 배선 (journey-target-extractor)', () => {
  const src = code(EXTRACTOR);

  it('유예 대상 판정은 CT가 소유한다 — 추출에 트리거 목록을 다시 적지 않는다', () => {
    expect(src).toMatch(/isBulkStateTrigger\(triggerEvent\)/);
  });

  it('상태형 4분기(휴면·포인트·상시·주기이탈)에 전부 걸린다', () => {
    // ★ §11-5 #6 — customer.cycle_lapsed도 이관 배치가 통째로 걸리는 상태형이라 유예 대상.
    const hits = src.match(/buildIntakeGraceClause\('c', params, graceDays\)/g) || [];
    expect(hits).toHaveLength(4);
  });

  it('유예 절은 대상 조건(cond)보다 먼저 params에 들어간다 — $N 어긋남 방지', () => {
    // 각 분기에서 grace 선언이 cond 선언보다 앞서야 파라미터 번호가 맞는다.
    for (const m of src.matchAll(/const grace = buildIntakeGraceClause/g)) {
      const condIdx = src.indexOf('const cond = applyCustomerConditions', m.index!);
      expect(condIdx).toBeGreaterThan(m.index!);
    }
  });
});

// ★ 2026-08-01 §11-3 — 커서 축을 도착(created_at)으로 옮겼다. 발생 축으로 되돌아가면
//   배치로 늦게 도착한 데이터와 익명→회원 소급 연결분이 다시 영영 안 잡힌다.
describe('커서 축 전환 (journey-target-extractor · journey-trigger-watcher)', () => {
  const ex = code(EXTRACTOR);
  const wa = code(WATCHER);

  it('축은 화이트리스트 두 값뿐 — 문자열이 SQL에 그대로 들어간다', () => {
    expect(ex).toMatch(/cursor\.axis === 'created_at' \? 'created_at' : 'occurred_at'/);
  });

  it('동시각 타이를 이벤트 id로 가른다', () => {
    expect(ex).toMatch(/\(e\.created_at, e\.id\) > /);
    expect(ex).toMatch(/ORDER BY e\.\$\{axis\} ASC, e\.id ASC/);
  });

  it('축 전환은 커서 id 컬럼이 있을 때만 켠다 — 옛 커서 값은 발생 시각이라 그대로 읽으면 처리분을 다시 잡는다', () => {
    expect(wa).toMatch(/last_event_cursor_id/);
    expect(wa).toMatch(/arrivalAxis \? 'created_at' : 'occurred_at'/);
  });

  it('컬럼 확인은 트랜잭션 밖에서 한다 — 트랜잭션 안에서 실패하면 통째로 깨진다', () => {
    // ★2026-08-02 F1: 읽기에 ::text 원문 컬럼이 끼었다 — 시각·원문·id가 같은 SELECT라는 불변식은 유지.
    const probe = wa.indexOf('SELECT last_event_cursor, last_event_cursor::text');
    const begin = wa.indexOf("client.query('BEGIN')", probe);
    expect(probe).toBeGreaterThan(-1);
    expect(begin).toBeGreaterThan(probe);
  });

  it('커서 시각과 id를 같은 조회에서 읽는다 — 따로 읽으면 옛 축 시각과 새 축 id가 한 쌍이 된다', () => {
    expect(wa).toMatch(/SELECT last_event_cursor, last_event_cursor::text AS last_event_cursor_raw, last_event_cursor_id/);
  });

  it('컬럼 부재(42703)만 옛 축으로 폴백한다 — 다른 오류를 삼키면 축이 섞인다', () => {
    expect(wa).toMatch(/err\?\.code !== '42703'/);
    expect(wa).toMatch(/throw err/);
  });

  it('창 끝은 DB 시계에서 받고 안전 지연을 둔다 — 미커밋 적재를 건너뛰지 않게', () => {
    expect(wa).toMatch(/SELECT NOW\(\) - INTERVAL '1 minute'/);
    expect(wa).toMatch(/Math\.max\(/);
  });
});

describe('판정 불가 런타임 차단 (journey-trigger-watcher)', () => {
  const src = code(WATCHER);

  it('신규 고객 여정에서 판정 가능 여부를 확인한다', () => {
    expect(src).toMatch(/customer\.created/);
    expect(src).toMatch(/resolveNewCustomerJudgement/);
    expect(src).toMatch(/canJudge/);
  });

  it('판정 불가면 사유를 남기고 정지한다 — 조용한 0건 금지', () => {
    expect(src).toMatch(/pause_reason/);
    expect(src).toMatch(/신규 고객 판정 불가/);
  });
});

describe('판정 근거 계산은 개인화 캐시를 재사용하지 않는다 (company-data-profile)', () => {
  const src = code(PROFILE);
  const fnStart = src.indexOf('export async function getCompanyIdentityCapability');
  // ★ 경계는 "다음 export"까지 — 고정 길이로 자르면 다음 함수까지 넘어가 남의 코드를 검사한다.
  //   실제로 2000자 고정 슬라이스가 formatProfileForAiPrompt의 fillRate를 잡아 오탐을 냈다.
  const fnEnd = src.indexOf('\nexport ', fnStart + 1);
  const fnBody = fnStart > -1 ? src.slice(fnStart, fnEnd > -1 ? fnEnd : undefined) : '';

  it('함수가 존재한다', () => {
    expect(fnStart).toBeGreaterThan(-1);
  });

  it('5분 캐시 프로파일을 쓰지 않는다 — 싱크 적재가 무효화를 호출하지 않아 stale이 더 보내는 방향으로 샌다', () => {
    expect(fnBody).not.toMatch(/getCompanyDataProfile/);
  });

  it('반올림된 충족률로 판정하지 않는다 — 201명 중 1명이 0으로 떨어진다', () => {
    expect(fnBody).not.toMatch(/fillRate/);
  });

  it('EXISTS로 회사별 근거를 직접 본다', () => {
    expect(fnBody).toMatch(/EXISTS \(SELECT 1 FROM customers WHERE company_id = \$1::uuid/);
  });
});
