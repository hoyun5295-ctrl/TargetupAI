/**
 * 배포 원장 읽기(★ 2026-10-27 설계서 §3-3 · DB 없음) + 실제 원장 파일이 읽히는가
 * 꼴이 틀린 줄은 조용히 건너뛰지 않고 실패한다(건너뛰면 열린 항목 · 카드가 계산에서 사라진다 · Codex 구현 R1 #6).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLedger, statementCount } from '../../../scripts/deploy-ledger-lib.mjs';

const CARDS = '| 카드 | 커밋 |\n|---|---|\n| C1 | abc1234 · def5678 |\n| C2 | 미커밋 |';
const L = (body: string, cards = CARDS): string => `# 배포 원장\n\n## 머리\n\n- pulled_head: abc1234 · 2026-10-27\n- deployed_head: abc1234 · 2026-10-27\n\n## §0 카드\n\n${cards}\n\n${body}`;
const F = '```';
const ITEM = '### X-1 · a\n- 카드: C1\n';

describe('원장 읽기', () => {
  it('머리 · 카드 · 항목 · 블록(§1 · §2)', () => {
    const l = parseLedger(L(`## §1 대기\n\n${ITEM}- 단계: 코드 배포 뒤\n\n${F}sql ddl:X-1\nALTER TABLE a ADD COLUMN b int;\n${F}\n\n### X-2 · 채움\n- 카드: C1\n\n${F}sql dml:X-2\nUPDATE a SET b = 1;\n${F}\n\n## §2 덤프 뒤 적용분\n\n${F}sql ddl:OLD-1\nALTER TABLE c ADD COLUMN d int;\n${F}\n`));
    expect(l.head['pulled_head']).toBe('abc1234 · 2026-10-27');
    expect(l.cards).toEqual([{ card: 'C1', commits: ['abc1234', 'def5678'] }, { card: 'C2', commits: [] }]);
    expect(l.items.map((i: any) => [i.id, i.fields['카드'], i.fields['단계']])).toEqual([['X-1', 'C1', '코드 배포 뒤'], ['X-2', 'C1', undefined]]);
    expect(l.blocks.map((b: any) => [b.section, b.kind, b.id])).toEqual([['pending', 'ddl', 'X-1'], ['pending', 'dml', 'X-2'], ['applied', 'ddl', 'OLD-1']]);
    expect(l.blocks[0].sql).toBe('ALTER TABLE a ADD COLUMN b int;');
  });
  it.each([
    ['닫는 펜스 없음', `## §1 대기\n\n${ITEM}${F}sql ddl:X-1\nSELECT 1;\n`, /닫히지 않았다/],
    ['같은 항목 id 두 번', `## §1 대기\n\n${ITEM}\n${ITEM}`, /항목 id 두 번/],
    ['같은 블록 id 두 번', `## §1 대기\n\n${ITEM}${F}sql ddl:X-1\nSELECT 1;\n${F}\n## §2 덤프 뒤 적용분\n${F}sql ddl:X-1\nSELECT 1;\n${F}\n`, /블록 id 두 번/],
    ['종류 밖 꼬리표', `## §1 대기\n\n${ITEM}${F}sql dcl:X-1\nSELECT 1;\n${F}\n`, /블록 머리/],
    ['블록 머리 꼴 틀림', `## §1 대기\n\n${ITEM}${F}sql ddl X-1\nSELECT 1;\n${F}\n`, /블록 머리/],
    ['§1 블록 id ≠ 항목 id', `## §1 대기\n\n${ITEM}${F}sql ddl:Y-9\nSELECT 1;\n${F}\n`, /항목 id/],
    ['모르는 절', `## §9 메모\n`, /모르는 절/],
    ['CONCURRENTLY 가 다른 문장과 한 블록', `## §1 대기\n\n${ITEM}${F}sql ddl:X-1\nSET lock_timeout = '3s';\nCREATE INDEX CONCURRENTLY i ON a (b);\n${F}\n`, /CONCURRENTLY/],
    ['CONCURRENTLY 가 dml', `## §1 대기\n\n${ITEM}${F}sql dml:X-1\nCREATE INDEX CONCURRENTLY i ON a (b);\n${F}\n`, /dml/],
    ['항목 머리 꼴 틀림(가운뎃점 대신 줄표)', `## §1 대기\n\n### X-1 - pending\n- 카드: C1\n`, /§1 대기 에 둘 수 없는 줄/],
    ['항목 머리 없이 칸', `## §1 대기\n\n- 카드: C1\n`, /항목 머리 없이/],
    ['같은 칸 두 번', `## §1 대기\n\n${ITEM}- 카드: C2\n`, /두 번/],
    ['카드 칸 없음', `## §1 대기\n\n### X-1 · a\n- 단계: 사전\n`, /카드」 칸이 없다/],
    ['§0 에 없는 카드', `## §1 대기\n\n### X-1 · a\n- 카드: C9\n`, /§0 에 없는 카드/],
    ['§1 에 꼴 밖 글', `## §1 대기\n\n${ITEM}아무 글\n`, /§1 대기 에 둘 수 없는 줄/],
    ['§2 에 블록 밖 글', `## §2 덤프 뒤 적용분\n\n아무 글\n`, /§2 덤프 뒤 적용분 에 둘 수 없는 줄/],
    ['항목 머리 앞 공백', `## §1 대기\n\n  ### X-1 · a\n- 카드: C1\n`, /§1 대기 에 둘 수 없는 줄/],
  ])('%s = 실패', (_n, body, re) => {
    expect(() => parseLedger(L(body as string))).toThrow(re as RegExp);
  });
  it.each([
    ['카드 줄 꼴 틀림(소문자)', `${CARDS}\n| c70 | abc1234 |`, /§0 카드 에 둘 수 없는 줄/],
    ['카드 줄 앞 공백', `${CARDS}\n | C70 | db9f8c36 |`, /§0 카드 에 둘 수 없는 줄/],
    ['카드 줄 첫 | 빠짐', `${CARDS}\nC70 | db9f8c36 |`, /§0 카드 에 둘 수 없는 줄/],
    ['커밋 칸 비움', `${CARDS}\n| C3 |  |`, /커밋 칸이 비었다/],
    ['해시 아닌 커밋', `${CARDS}\n| C3 | 배포됨 |`, /해시 또는/],
    ['같은 카드 두 번', `${CARDS}\n| C1 | abc1234 |`, /카드 두 번/],
  ])('§0 %s = 실패', (_n, cards, re) => {
    expect(() => parseLedger(L('', cards as string))).toThrow(re as RegExp);
  });
  it('문장 수는 주석 · 문자열 · $$ 본문 안 세미콜론을 세지 않는다', () => {
    expect(statementCount("SELECT ';'; -- a; b;\nSELECT 2;")).toBe(2);
    expect(statementCount('DO $$ BEGIN PERFORM 1; PERFORM 2; END $$;')).toBe(1);
  });
  it('실제 원장 파일(status/DEPLOY-LEDGER.md)이 읽히고 §1 블록마다 항목이 있다', () => {
    const text = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'status', 'DEPLOY-LEDGER.md'), 'utf8');
    const l = parseLedger(text);
    expect(l.head['pulled_head']).toMatch(/^[0-9a-f]{7,40}\b/);
    expect(l.head['deployed_head']).toMatch(/^[0-9a-f]{7,40}\b/);
    for (const b of l.blocks.filter((x: any) => x.section === 'pending')) expect(l.items.some((i: any) => i.id === b.id)).toBe(true);
  });
});
