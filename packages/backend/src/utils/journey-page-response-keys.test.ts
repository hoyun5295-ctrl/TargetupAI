/**
 * 여정 화면이 읽는 응답 키 ↔ 서버가 주는 키 (2026-08-08, Harold 접수)
 *
 * 기원
 *   `/operator/data-profile`은 `safeFields`·`conditionalFields`·`blockedFields`로 나눠 주는데
 *   화면이 `data.fields`를 읽고 있었다 → **항상 빈 배열**. 그래서 AI 꾸미기 컬럼 칩과 변수 넣기 카드가
 *   화면에서 통째로 사라졌고(0630 배선 이래), 같은 값을 쓰는 날짜축 빌더의 꾸미기도 함께 죽어 있었다.
 *   tsc는 `any` 응답의 키를 검사하지 않는다 — 어긋나도 통과한다. 그래서 여기서 못 박는다.
 *
 * ⛔ 이 테스트는 "키가 서로 맞는가"만 본다. 값이 실제로 채워지는지는 운영 실측이 답한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const backend = (rel: string) => readFileSync(resolve(process.cwd(), 'src', rel), 'utf8');
const front = (rel: string) => readFileSync(resolve(process.cwd(), '../frontend/src', rel), 'utf8');

const page = () => front('pages/JourneysPage.tsx');

describe('data-profile — 꾸미기 컬럼의 출처', () => {
  it('서버가 safeFields로 준다', () => {
    const src = backend('routes/ai.ts');
    const block = src.slice(src.indexOf("router.get('/operator/data-profile'"));
    const body = block.slice(0, block.indexOf('} catch'));
    expect(body).toMatch(/safeFields:/);
    expect(body, '서버가 `fields`라는 평평한 키를 주지 않는다').not.toMatch(/^\s*fields:/m);
  });

  it('화면이 safeFields를 읽는다 (fields를 읽으면 영원히 0이다)', () => {
    const src = page();
    expect(src).toMatch(/data\.safeFields \|\| \[\]/);
    expect(
      src,
      '`data.fields`를 읽으면 꾸미기 칩·변수 넣기가 화면에서 사라진다 — 2026-08-08에 실제로 그랬다',
    ).not.toMatch(/const vars = \(data\.fields/);
  });

  it('conditionalFields는 쓰지 않는다 (채움률이 중간이라 빈 값 고객에게 어색한 문장이 나간다)', () => {
    expect(page()).not.toMatch(/data\.conditionalFields/);
  });
});

describe('나머지 초기 조회 — 화면이 읽는 키가 서버에 있다', () => {
  const CASES: Array<{ name: string; frontKey: RegExp; backendFile: string; backendKey: RegExp }> = [
    { name: '알림톡 발신프로필', frontKey: /data\.profiles \|\| \[\]/, backendFile: 'routes/alimtalk.ts', backendKey: /profiles: rows/ },
    { name: '고객 활성 필드', frontKey: /data\.fields \|\| \[\]/, backendFile: 'routes/customers.ts', backendKey: /fields: \[\]|fields:/ },
    { name: '자사몰 설치 상태', frontKey: /data\.keyIssuedAt/, backendFile: 'routes/cdp.ts', backendKey: /keyIssuedAt,/ },
  ];

  it.each(CASES)('$name', ({ frontKey, backendFile, backendKey }) => {
    expect(page(), '화면이 이 키를 읽는다').toMatch(frontKey);
    expect(backend(backendFile), '서버가 그 키를 준다').toMatch(backendKey);
  });

  it('회신번호 조회의 080 키가 서로 같다', () => {
    expect(page()).toMatch(/cd\.opt080Number/);
    expect(backend('routes/ai.ts')).toMatch(/opt080Number/);
  });
});

/**
 * ★ 2026-08-08 (Harold 접수) — 프리셋 6개만 두면 5일 뒤·2주 뒤를 만들 길이 없었다.
 *   상한은 백엔드와 같은 값이어야 한다 — 화면이 더 크게 받으면 저장에서 조용히 깎인다.
 */
describe('발송 시점 — 직접 입력', () => {
  const studio = () => front('components/journey/JourneyStepStudio.tsx');

  it('직접 입력 자리가 있다', () => {
    const src = studio();
    expect(src).toMatch(/직접 입력/);
    expect(src).toMatch(/customDelay/);
  });

  it('저장된 값이 프리셋에 없으면 직접 입력으로 열린다', () => {
    expect(studio()).toMatch(/!DELAY_PRESETS\.some\(\(p\) => p\.hours === delayHoursNow\)/);
  });

  it('상한이 백엔드와 같다 (365일)', () => {
    expect(studio()).toMatch(/MAX_DELAY_HOURS = 8760/);
    expect(backend('utils/journey-builder.ts')).toMatch(/MAX_STEP_DELAY_HOURS = 8760/);
  });

  // ★ 2026-08-08 정정 (Harold 지시) — 시간·일 셀렉트는 값이 0일 때 `0 × 24 = 0`이라 단위를 바꿔도
  //   아무것도 안 바뀌었다. 단위를 하나(일)로 두면 그 계산 자체가 사라진다.
  it('직접 입력은 일 단위 하나다 — 단위 셀렉트가 없다', () => {
    const src = studio();
    expect(src).toMatch(/days \* 24/);
    expect(src, '단위 셀렉트가 남아 있으면 0에서 안 바뀌는 결함이 되살아난다').not.toMatch(/<option value="hour">/);
  });

  it('일수로 딱 떨어지지 않는 값은 조용히 바꾸지 않고 알린다', () => {
    expect(studio()).toMatch(/delayHasOddHours/);
  });
});

describe('꾸미기 칩 — 이미 쓰인 컬럼은 선택돼 있다 (AI Operator와 같은 규약)', () => {
  const studio = () => front('components/journey/JourneyStepStudio.tsx');

  it('본문·제목의 %변수%를 칩 선택으로 되살린다', () => {
    const src = studio();
    expect(src).toMatch(/matchAll\(\/%\(\[\^%\\n\]\+\)%\/g\)/);
    expect(src).toMatch(/setSelectedVars\(used\)/);
  });

  it('타이핑마다 다시 계산하지 않는다 (체크를 풀어도 되살아나면 못 쓴다)', () => {
    const src = studio();
    const block = src.slice(src.indexOf('setSelectedVars(used)'));
    const deps = block.slice(0, block.indexOf('\n\n'));
    expect(deps).toMatch(/\[index, decorateVars\]/);
    expect(deps, '본문을 의존성에 넣으면 사용자가 푼 선택이 즉시 되살아난다').not.toMatch(/messageTemplate\]/);
  });
});

describe('빈 상태를 화면이 말한다', () => {
  it('꾸미기 컬럼이 0이어도 카드를 숨기지 않는다 (숨기면 원인이 화면에서 안 보인다)', () => {
    const src = front('components/journey/JourneyStepStudio.tsx');
    expect(src).not.toMatch(/\{decorateVars\.length > 0 && \(/);
    expect(src).toMatch(/문안에 넣을 수 있는 고객 데이터 항목이 아직 없습니다/);
  });
});
