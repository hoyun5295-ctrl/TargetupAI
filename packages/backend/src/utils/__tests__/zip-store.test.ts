/**
 * zip-store.test.ts — 저장(무압축) ZIP 작성기(순수 · 의존성 0) — 우커머스 플러그인 zip 배포용(② 플러그인)
 *  ZIP 로컬 헤더 · 중앙 디렉터리 · EOCD 서명과 CRC32 를 고정한다. unzip 이 있으면 실물 검증(-t)까지.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { crc32, buildStoredZip } from '../zip-store';

describe('crc32', () => {
  it('알려진 값: "hello" = 0x3610a686 · 빈 버퍼 = 0', () => {
    expect(crc32(Buffer.from('hello'))).toBe(0x3610a686);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});

describe('buildStoredZip', () => {
  const FIXED = new Date('2026-09-14T00:00:00Z');
  it('로컬 헤더 PK\\x03\\x04 로 시작 · 중앙 디렉터리 PK\\x01\\x02 · EOCD PK\\x05\\x06 에 항목 수 · CRC 가 헤더에 실린다', () => {
    const zip = buildStoredZip([{ name: 'hanjullo/a.txt', data: Buffer.from('hello'), mtime: FIXED }, { name: 'hanjullo/b.php', data: Buffer.from('<?php'), mtime: FIXED }]);
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    // 첫 항목 CRC(offset 14 · LE) · 압축 방식 0(store · offset 8)
    expect(zip.readUInt32LE(14)).toBe(0x3610a686);
    expect(zip.readUInt16LE(8)).toBe(0);
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(eocd).toBeGreaterThan(0);
    expect(zip.readUInt16LE(eocd + 8)).toBe(2);   // 이 디스크 항목 수
    expect(zip.readUInt16LE(eocd + 10)).toBe(2);  // 전체 항목 수
    expect(zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))).toBeGreaterThan(0);
    expect(zip.includes(Buffer.from('hanjullo/b.php'))).toBe(true);
  });
  it('같은 입력·같은 mtime = 같은 바이트(결정적) · 파일명은 슬래시 경로 그대로', () => {
    const a = buildStoredZip([{ name: 'x/y.txt', data: Buffer.from('1'), mtime: FIXED }]);
    const b = buildStoredZip([{ name: 'x/y.txt', data: Buffer.from('1'), mtime: FIXED }]);
    expect(a.equals(b)).toBe(true);
    expect(() => buildStoredZip([{ name: '..\\evil', data: Buffer.alloc(1), mtime: FIXED }])).toThrow();
    expect(() => buildStoredZip([])).toThrow();
  });
  it('unzip 이 있으면 실물 검증(-t) 통과', () => {
    let unzip: string | null = null;
    try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); unzip = 'unzip'; } catch { unzip = null; }
    if (!unzip) return;
    const dir = mkdtempSync(join(tmpdir(), 'hjl-zip-'));
    const file = join(dir, 't.zip');
    writeFileSync(file, buildStoredZip([{ name: 'p/readme.txt', data: Buffer.from('한줄로 플러그인'), mtime: FIXED }, { name: 'p/plugin.php', data: Buffer.from('<?php echo 1;'), mtime: FIXED }]));
    const out = execFileSync(unzip, ['-t', file]).toString();
    expect(out).toMatch(/No errors detected/);
  });
});
