// ★ 2026-11-10 직접입력 한 번에 9,999건까지(Harold 「9,999건 이상 넣으면 파일로 올리라고 경고 · 안 올리게」 · SOOBIN02 29,906 붙여넣기 접수)
//   공용 직접입력 창(문자 · 알림톡 · 브랜드) = 상한을 넘는 붙여넣기면 [추가] 잠금 + Ctrl+Enter 도 막힘 + 파일등록 안내
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DIRECT_PASTE_MAX } from '../../../../frontend/src/utils/recipient-paste';
import { stripComments } from './helpers/producer-scan';

const PKG = join(__dirname, '..', '..', '..', '..');   // packages/
const src = (rel: string) => stripComments(readFileSync(join(PKG, rel), 'utf8').replace(/\r\n/g, '\n'));

describe('직접입력 상한', () => {
  it('상한 = 9,999(Harold 지시 숫자)', () => {
    expect(DIRECT_PASTE_MAX).toBe(9999);
  });

  const modal = src('frontend/src/components/direct-send/RecipientDirectInputModal.tsx');
  it('넘으면 = 더하기 함수가 멈춘다(단추 · Ctrl+Enter 둘 다 이 함수를 지난다)', () => {
    expect(modal).toContain('const overLimit = preview.add > DIRECT_PASTE_MAX;');
    expect(modal).toContain('if (preview.add === 0 || overLimit) return;');
    expect(modal).toMatch(/onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter' && \(e\.metaKey \|\| e\.ctrlKey\)\) \{ e\.preventDefault\(\); submitPaste\(\); \} \}\}/);
  });
  it('[추가] 단추 잠금 + 파일등록 안내', () => {
    expect(modal).toContain('disabled={preview.add === 0 || overLimit}');
    expect(modal).toMatch(/\{overLimit && \(\s*<p className="rdi-warn" role="alert">[\s\S]*?\[파일등록\]으로 올려 주세요\./);
  });
  it('세 창 모두 이 창을 쓴다(상한이 채널마다 갈리지 않는다)', () => {
    for (const f of ['DirectSendPanel.tsx', 'AlimtalkSendModal.tsx', 'BrandSendModal.tsx']) {
      expect(src(`frontend/src/components/${f}`)).toContain("from './direct-send/RecipientDirectInputModal'");
    }
  });
});
