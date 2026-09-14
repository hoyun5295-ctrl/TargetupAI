/**
 * 설정 화면 비밀값 표시 계약 (★2026-09-13(3) 싱크 ⓑ)
 *
 *   설정 편집 화면(--show-config · --edit-config)이 자체 mask로 API Secret·DB 비밀번호 앞 4자를 콘솔에 보였고,
 *   편집 프롬프트는 현재 값 **원문 전체**를 기본값 괄호에 보였다. 설치 마법사 CLI는 키 앞 8자를 보였다.
 *   가리는 모양은 masking.ts 한 곳이 정한다(키 = 앞뒤 4자 · 시크릿·비밀번호 = 전부).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const edit = fs.readFileSync(path.resolve(__dirname, 'edit-config.ts'), 'utf8');
const cli = fs.readFileSync(path.resolve(__dirname, 'cli.ts'), 'utf8');

describe('설정 화면 비밀값 배선', () => {
  it('edit-config는 자체 mask를 두지 않고 masking.ts 함수를 쓰며, 원문 보기 분기가 없다', () => {
    expect(edit).not.toMatch(/function mask\(/);
    expect(edit).not.toMatch(/showSecrets/);
    expect(edit).toMatch(/from '\.\.\/logger\/masking'/);
    expect(edit).toMatch(/maskPassword\(s\.apiSecret\)/);
    expect(edit).toMatch(/maskPassword\(d\.password\)/);
    expect(edit).toMatch(/maskApiKey\(s\.apiKey\)/);
  });

  it('비밀값을 ask 기본값(프롬프트 괄호에 원문 표시)으로 넘기지 않는다', () => {
    expect(edit).not.toMatch(/\bask\([^)]*,\s*config\.server\.(apiKey|apiSecret)\s*\)/);
    expect(edit).not.toMatch(/\bask\([^)]*,\s*d\.password\s*\)/);
    expect(edit).toMatch(/askSecret\('API Secret'/);
    expect(edit).toMatch(/askSecret\('비밀번호'/);
  });

  it('설치 마법사 CLI는 키를 앞 8자로 자르지 않는다', () => {
    expect(cli).not.toMatch(/apiKey\.substring\(0,/);
    expect(cli).toMatch(/maskApiKey\(apiKey\)/);
  });
});

describe('설정 조회 출력', () => {
  afterEach(() => vi.restoreAllMocks());

  it('시크릿·비밀번호는 한 글자도 안 나오고 키는 앞뒤 4자만, 나머지 줄은 그대로다', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')); });
    const { printConfig } = await import('./edit-config');
    printConfig({
      server: { baseUrl: 'https://example.invalid', apiKey: 'tk_abcd00001111wxyz', apiSecret: 'zzzz0000111122223333444455556666' },
      database: { type: 'mysql', host: 'db.local', port: 3306, database: 'shop', username: 'reader', password: 'P@ssw0rd-REAL', queryTimeout: 30000, ssl: false },
      sync: { customerInterval: 60, purchaseInterval: 30, batchSize: 4000, customerTable: 'members', purchaseTable: 'orders', timestampColumn: 'updated_at', fallbackToFullSync: true },
      mapping: { customers: { CUST_HP: 'phone' }, purchases: {}, customFieldLabels: {} },
      agent: { id: null, name: 'agent-a', version: '1.7.1' },
    } as any);
    const out = lines.join('\n');
    for (const bit of ['zzzz', '6666', 'P@ss', 'REAL']) expect(out, bit).not.toContain(bit);
    expect(out).toContain('tk_a****wxyz');
    expect(out).toContain('API Secret:  ********');
    expect(out).toContain('db.local:3306');
    expect(out).toContain('CUST_HP → phone');
  });
});
