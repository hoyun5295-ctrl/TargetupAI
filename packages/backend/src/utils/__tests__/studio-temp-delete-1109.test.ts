/**
 * 저장하지 않은 결과 그림 지우기 계약(★ 2026-11-09 Harold 「라이브러리에 저장 안 해도 삭제할 수 있도록」 · A = 서버 임시 그림까지)
 *
 * 못 박는 것
 *   1. 판정 한 곳(tempDeleteVerdict) — 지우는 것 = 아직 라이브러리에 가지 않은 포스터 임시 그림뿐 · 저장된 그림은 지우지 않는다.
 *   2. 라우트 = 회사 폴더 안 · 같은 그림의 저장과 같은 줄(studio-save 키) · 판정 결과대로 409 · 400 · 지움.
 *   3. 화면 = 저장 전 카드(만료 카드 포함)에만 「삭제」 · 확인 창 · 서버가 지운 뒤에만 카드를 뺀다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tempDeleteVerdict, type TempMeta } from '../image-studio';

const meta = (over: Partial<TempMeta> = {}): TempMeta => ({ companyId: 'c', kind: 'poster', ext: 'png', mime: 'image/png', createdAt: '2026-11-09T00:00:00Z', ...over });
const ROOT = join(__dirname, '..', '..', '..', '..', '..');   // 저장소 뿌리(packages/backend/src/utils/__tests__ 에서 다섯 단)
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('1. 판정 한 곳', () => {
  it('저장 전 포스터 = 지운다', () => {
    expect(tempDeleteVerdict(meta(), false)).toBe('delete');
  });
  it('저장이 이미 옮긴 그림(영구 파일 · 등재 확인 대기 · MMS 저장 주소) = 지우지 않는다', () => {
    expect(tempDeleteVerdict(meta(), true)).toBe('saved');
    expect(tempDeleteVerdict(null, true)).toBe('saved');
    expect(tempDeleteVerdict(meta({ pendingAsset: { url: 'u', filename: 'f.png', bytes: 1, displayName: 'd', channelSpec: null } }), false)).toBe('saved');
    expect(tempDeleteVerdict(meta({ savedAs: { url: 'u', bytes: 1 } }), false)).toBe('saved');
  });
  it('사이드카 없음(정리기 · 이미 지움) = 지운 것으로 본다', () => {
    expect(tempDeleteVerdict(null, false)).toBe('gone');
  });
  it('포스터가 아닌 임시(제품 사진 · 누끼 · 로고 후보 · 합성) = 이 주소로 지우지 않는다', () => {
    for (const kind of ['source', 'cutout', 'logo', 'composite', 'background'] as const) {
      expect(tempDeleteVerdict(meta({ kind }), false), kind).toBe('not_poster');
    }
  });
});

describe('2. 라우트 배선', () => {
  const r = read('packages/backend/src/routes/image-studio.ts');
  const body = r.slice(r.indexOf("imageStudioRouter.delete('/temp/:tempId'"), r.indexOf("imageStudioRouter.get('/temp/:tempId'"));
  it('회사 · 임시 id 검사 → 저장과 같은 줄 → 판정 한 곳 → 결과대로', () => {
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain("if (!companyId) return res.status(403)");
    expect(body).toContain('if (!isValidTempId(tempId)) return res.status(400)');
    expect(body).toContain('await runSerial(`studio-save:${companyId}:${tempId}`, async () => {');
    expect(body).toContain('const verdict = tempDeleteVerdict(readTempMeta(companyId, tempId), !!findPermanentByTempId(companyId, tempId));');
    expect(body).toContain("if (verdict === 'saved') return res.status(409)");
    expect(body).toContain("if (verdict === 'not_poster') return res.status(400)");
    expect(body).toContain('try { discardTemp(companyId, tempId); }');
    // 저장 라우트가 같은 줄 키를 쓴다(다르면 저장 도중에 지우기가 끼어든다)
    expect(r).toContain('await runSerial(`studio-save:${companyId}:${tempId}`, async () => {\n  // ★ 2026-11-07 C112');
  });
});

describe('3. 화면', () => {
  const page = read('packages/frontend/src/pages/ImageStudioPage.tsx');
  it('지우기 = 확인 창 → DELETE → 성공 뒤에만 카드 빼기', () => {
    const fn = page.slice(page.indexOf('const deleteCandidate = (c: Candidate) => {'), page.indexOf('// ★ 2026-07-21 다운로드 제거'));
    expect(fn).toContain("mode: 'danger',");
    expect(fn).toContain("await studioFetch(`/api/image-studio/temp/${c.tempId}`, { method: 'DELETE' });");
    expect(fn.indexOf('if (!ok) {')).toBeLessThan(fn.indexOf('setCandidates((prev) => prev.filter((x) => x.tempId !== c.tempId));'));
  });
  it('「삭제」 버튼 = 저장 전 카드 · 만료 카드에만(저장된 카드 = 라이브러리에서)', () => {
    expect(page.match(/onClick=\{\(\) => deleteCandidate\(c\)\}/g)?.length).toBe(2);
    const saved = page.slice(page.indexOf('{c.saved ? ('), page.indexOf(') : (', page.indexOf('{c.saved ? (')));
    expect(saved).not.toContain('deleteCandidate');
  });
});
