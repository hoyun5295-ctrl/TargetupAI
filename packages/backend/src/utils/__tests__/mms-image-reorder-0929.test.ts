/**
 * MMS 첨부 사진 순서 바꾸기(★2026-09-29 남지현 접수 "여러 장 한번에 첨부 시 순서 임의 변경")
 *
 * 규칙
 *   사진은 칸(1·2·3) 단위로 자리를 바꾼다 — 끌어서 다른 칸에 놓으면 두 사진이 서로 자리를 바꾸고,
 *   ◀ ▶ 버튼은 이웃 칸과 바꾼다. 발송 순서·번호 표시·미리보기는 모두 사진 목록 순서를 그대로 따른다
 *   (`toMmsImagePaths` = 목록 순서 그대로) → 목록 순서만 바꾸면 전부 함께 바뀐다.
 *   순서 바꾸기는 공용 첨부 창의 선택 기능이다 — 접수 화면(직접발송)만 켜고, 넘기지 않는 화면은 지금 그대로다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { swapMmsImages, toMmsImagePaths } from '../../../../frontend/src/utils/mmsImage';

const FE = resolve(__dirname, '../../../../frontend/src');
const read = (p: string) => readFileSync(resolve(FE, p), 'utf-8');
const img = (n: string) => ({ serverPath: `/srv/mms/${n}.jpg`, url: `/api/mms-images/${n}.jpg`, filename: `${n}.jpg`, originalName: `${n}-원본.jpg`, size: 1000 });

describe('swapMmsImages', () => {
  const list = [img('a'), img('b'), img('c')];
  it('두 칸의 사진이 서로 자리를 바꾼다(1 ↔ 3 · 이웃끼리)', () => {
    expect(swapMmsImages(list, 0, 2).map((i) => i.filename)).toEqual(['c.jpg', 'b.jpg', 'a.jpg']);
    expect(swapMmsImages(list, 2, 0).map((i) => i.filename)).toEqual(['c.jpg', 'b.jpg', 'a.jpg']);
    expect(swapMmsImages(list, 0, 1).map((i) => i.filename)).toEqual(['b.jpg', 'a.jpg', 'c.jpg']);
  });
  it('원본 목록을 바꾸지 않고 새 목록을 돌려준다', () => {
    const before = list.map((i) => i.filename);
    swapMmsImages(list, 0, 2);
    expect(list.map((i) => i.filename)).toEqual(before);
  });
  it('같은 칸 · 빈 칸 · 범위 밖이면 순서 그대로(사진이 사라지거나 빈 자리가 생기지 않는다)', () => {
    const two = [img('a'), img('b')];
    for (const [a, b] of [[1, 1], [0, 2], [-1, 0], [0, 5]] as const) {
      const out = swapMmsImages(two, a, b);
      expect(out.map((i) => i.filename)).toEqual(['a.jpg', 'b.jpg']);
      expect(out).toHaveLength(2);
    }
  });
  it('바꾼 순서가 발송 경로 목록에 그대로 실린다', () => {
    expect(toMmsImagePaths(swapMmsImages(list, 0, 2)).map((p) => p.path)).toEqual(['/srv/mms/c.jpg', '/srv/mms/b.jpg', '/srv/mms/a.jpg']);
  });
});

describe('배선', () => {
  it('공용 훅이 순서 바꾸기를 내놓고, 규칙은 CT(swapMmsImages)를 쓴다', () => {
    const hook = read('hooks/useMmsUpload.ts');
    expect(hook).toContain("import { precheckMmsAutoFitFile, swapMmsImages } from '../utils/mmsImage';");
    expect(hook).toContain('setMmsUploadedImages(prev => swapMmsImages(prev, from, to));');
    expect(hook).toMatch(/return \{[\s\S]*handleMmsImageSwap,[\s\S]*\};/);
  });
  it('첨부 창: 넘겨받았을 때만 끌기·◀ ▶ 를 그린다(선택 기능)', () => {
    const modal = read('components/MmsUploadModal.tsx');
    expect(modal).toContain('handleMmsImageSwap?: (from: number, to: number) => void;');
    expect(modal).toContain('const canReorder = !!handleMmsImageSwap && mmsUploadedImages.length > 1 && !mmsUploading;');
    expect(modal).toContain('draggable={canReorder}');
  });
  // ★ 2026-09-29 한줄로 V2 차수 5 — AI 운영자 · 대행발송 2곳도 켰다(0929 범위 밖 기록 → Harold 「추천안으로 전부」). 네 곳 모두 발송은 목록 순서.
  it('직접발송 · AI 운영자 · 대행발송 2곳 = 네 곳 모두 켠다', () => {
    const dash = read('pages/Dashboard.tsx');
    const at = dash.indexOf('<MmsUploadModal');
    expect(dash.slice(at, dash.indexOf('/>', at))).toContain('handleMmsImageSwap={handleMmsImageSwap}');
    const op = read('pages/AiOperatorPage.tsx');
    const opAt = op.indexOf('<MmsUploadModal');
    expect(op.slice(opAt, op.indexOf('/>', opAt))).toContain('handleMmsImageSwap={handleMmsImageSwap}');
    for (const p of ['components/agency/AgencyOneStepModal.tsx', 'components/agency/AgencySendComposer.tsx']) {
      const src = read(p);
      const a = src.indexOf('<MmsUploadModal');
      expect(src.slice(a, src.indexOf('/>', a))).toContain('handleMmsImageSwap={mms.handleMmsImageSwap}');
      expect(src).toContain('mmsImagePaths: mms.mmsUploadedImages.map((i) => i.serverPath)');
    }
  });
});
