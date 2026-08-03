import { describe, it, expect } from 'vitest';
import {
  buildKeysetPredicate,
  escapeKeyPart,
  serializeSourceRowKey,
  cursorKeysValid,
  extractRowCursorMeta,
  MAX_SOURCE_ROW_KEY_LEN,
} from './keyset';

describe('buildKeysetPredicate — (ts, pk...) 전개형', () => {
  const wrap = (t: string) => `CAST(${t})`;

  it('단일 PK: ts 두 번, 키 한 번', () => {
    const calls: string[] = [];
    const bind = (name: string) => { calls.push(name); return `:${name}`; };
    const sql = buildKeysetPredicate('"TS"', wrap, bind, ['"ID"']);
    expect(sql).toBe('("TS" > CAST(:ts) OR ("TS" = CAST(:ts) AND ("ID" > :k0)))');
    expect(calls).toEqual(['ts', 'ts', 'k0']);
  });

  it('복합 PK: 마지막 키 이전은 >·= 두 번 등장', () => {
    const calls: string[] = [];
    const bind = (name: string) => { calls.push(name); return '?'; };
    const sql = buildKeysetPredicate('`ts`', (t) => t, bind, ['`a`', '`b`']);
    expect(sql).toBe('(`ts` > ? OR (`ts` = ? AND (`a` > ? OR (`a` = ? AND (`b` > ?)))))');
    // 위치 기반 dialect의 push 순서가 SQL 텍스트 순서와 같아야 한다
    expect(calls).toEqual(['ts', 'ts', 'k0', 'k0', 'k1']);
  });

  it('PK 없음(방어): ts 단독 비교', () => {
    const sql = buildKeysetPredicate('"TS"', (t) => t, () => ':cts', []);
    expect(sql).toBe('"TS" > :cts');
  });
});

describe('serializeSourceRowKey — 결정적, 자르지 않는다', () => {
  it('복합 키를 |로 잇고 값 안의 |·\\는 이스케이프한다', () => {
    expect(serializeSourceRowKey(['SP59', 20260803, 'A|B'])).toBe('SP59|20260803|A\\|B');
    expect(escapeKeyPart('a\\b|c')).toBe('a\\\\b\\|c');
  });

  it('NULL·비스칼라(Date 등)는 null — 키 없이 legacy 적재로 보낸다', () => {
    expect(serializeSourceRowKey(['A', null])).toBeNull();
    expect(serializeSourceRowKey([new Date()])).toBeNull();
    expect(serializeSourceRowKey([])).toBeNull();
    expect(serializeSourceRowKey([NaN])).toBeNull();
  });

  it('상한 초과는 자르지 않고 null — 자르면 다른 행이 같은 키가 된다', () => {
    expect(serializeSourceRowKey(['A'.repeat(MAX_SOURCE_ROW_KEY_LEN + 1)])).toBeNull();
    expect(serializeSourceRowKey(['A'.repeat(MAX_SOURCE_ROW_KEY_LEN)])).toBe('A'.repeat(MAX_SOURCE_ROW_KEY_LEN));
  });

  it('bigint는 문자열로', () => {
    expect(serializeSourceRowKey([BigInt('9007199254740993')])).toBe('9007199254740993');
  });
});

describe('cursorKeysValid', () => {
  it('string·number만 통과', () => {
    expect(cursorKeysValid(['a', 1])).toBe(true);
    expect(cursorKeysValid([new Date()])).toBe(false);
    expect(cursorKeysValid([Infinity])).toBe(false);
    expect(cursorKeysValid([null])).toBe(false);
  });
});

describe('extractRowCursorMeta', () => {
  it('원문 별칭을 분리하고 rows[i]와 meta[i]가 1:1', () => {
    const { cleanRows, meta } = extractRowCursorMeta(
      [
        { ID: 1, NAME: 'a', __RAW__: '2026-08-03 00:00:00' },
        { ID: 2, NAME: 'b', __RAW__: '2026-08-03 00:00:01' },
      ],
      '__RAW__',
      ['ID'],
    );
    expect(cleanRows).toEqual([{ ID: 1, NAME: 'a' }, { ID: 2, NAME: 'b' }]);
    expect(meta).toEqual([
      { tsRaw: '2026-08-03 00:00:00', keys: [1] },
      { tsRaw: '2026-08-03 00:00:01', keys: [2] },
    ]);
  });
});
