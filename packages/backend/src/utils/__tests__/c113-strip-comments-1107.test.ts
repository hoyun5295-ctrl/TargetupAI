/**
 * C113 K19 · D19 · R82 — 계약 시험 공용 주석 지우기(글자 단위) · 옛 정규식 판이 줄 주석 안 `/*` 를 블록 시작으로 읽어 진짜 코드를 지운 결함.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from './helpers/producer-scan';

const nl = (s: string) => (s.match(/\n/g) || []).length;

describe('stripComments — 글자 단위', () => {
  it('줄 주석 안 /* 가 뒤 코드를 지우지 않는다(C112 image/* 재현)', () => {
    const src = "const a = 1; // accept image/*\nconst b = 2;\nconst c = 3; /* x */ const d = 4;\n";
    const out = stripComments(src);
    expect(out).toContain('const b = 2;');
    expect(out).toContain('const c = 3;');
    expect(out).toContain('const d = 4;');
    expect(out).not.toContain('image/*');
    expect(out).not.toContain(' x ');
  });
  it('문자열 안 // 와 /* 는 그대로 · 뒤 줄 주석만 지운다', () => {
    const out = stripComments(`const u = "https://shop.example.com/a"; const g = 'a /* b'; // tail\n`);
    expect(out).toContain('"https://shop.example.com/a"');
    expect(out).toContain("'a /* b'");
    expect(out).not.toContain('tail');
  });
  it('정규식 글자 안 /* · // 는 그대로', () => {
    const out = stripComments("const r = s.replace(/\\/\\*[^*]*\\*\\//g, '').replace(/\\/\\//, ''); // done\n");
    expect(out).toContain('/\\/\\*[^*]*\\*\\//g');
    expect(out).toContain('/\\/\\//');
    expect(out).not.toContain('done');
  });
  it('나눗셈은 정규식으로 읽지 않는다', () => {
    const out = stripComments('const half = total / 2; const q = a / b / c; // note\n');
    expect(out).toContain('const half = total / 2;');
    expect(out).toContain('const q = a / b / c;');
    expect(out).not.toContain('note');
  });
  it('JSX 주석은 중괄호째 지운다 · JSX 글의 홑따옴표가 뒤 주석을 감싸지 않는다', () => {
    expect(stripComments('<div>{/* note */}<p>hi</p></div>')).toBe('<div><p>hi</p></div>');
    expect(stripComments('try { a(); } catch { /* noop */ }')).toBe('try { a(); } catch {  }');
    expect(stripComments("<p>Don't stop</p> {/* gone */}<b />")).toBe("<p>Don't stop</p> <b />");
  });
  it('템플릿 ${} 중첩 · 그 안 주석', () => {
    const src = "const t = `a ${x /* y */ ? `b // keep` : 'c'} d`; // tail\n";
    const out = stripComments(src);
    expect(out).toContain('`b // keep`');
    expect(out).toContain("'c'} d`");
    expect(out).not.toContain('/* y */');
    expect(out).not.toContain('tail');
  });
  it('지운 자리는 줄바꿈만 남겨 줄 번호를 지킨다', () => {
    const src = 'a();\n/* one\n two\n three */\nb(); // c\n{/* jsx\n x */}\nd();\n';
    const out = stripComments(src);
    expect(nl(out)).toBe(nl(src));
    expect(out.split('\n')[4]).toBe('b(); ');
  });
  it('C112 의 실제 자리(image-studio.ts /logo/read) 뒤 라우트 덩어리가 남는다', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'routes', 'image-studio.ts'), 'utf8');
    const out = stripComments(src);
    expect(out).toContain("'/logo/read'");
    expect(nl(out)).toBe(nl(src));
  });
});
