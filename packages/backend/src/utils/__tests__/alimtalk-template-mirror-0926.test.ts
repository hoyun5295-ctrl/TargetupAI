/**
 * 알림톡 템플릿 수정 뒤 PG = IMC가 실제로 가진 값 (★2026-09-26 한줄로 V2 S1-H05)
 *
 * 옛: 수정 경로가 PG를 COALESCE로만 갱신 → 사용자가 지운 강조 제목·대표 링크·부가정보가 PG에 남아 발송에 실렸다.
 *   IMC가 빠진 키를 지우는지 남기는지에 따라 맞는 코드가 반대라, 추측으로 한쪽을 고르지 않는다.
 * 처방: 수정 성공 직후 IMC에서 그 템플릿을 다시 읽어 **발송에 쓰는 항목을 IMC 값으로** 맞춘다(어느 쪽 동작이든 맞다).
 *   응답을 믿는 조건 = 우리가 보낸 값(본문·버튼 수·강조 제목·보조 문구·대표 링크 모바일·부가정보·헤더·이미지)이
 *   응답에 같은 이름·같은 값으로 모두 있을 때. 하나라도 어긋나면 반영하지 않는다(종전 동작 유지 · 로그).
 *   역변환은 이관 경로에서 운영 검증된 fromImcButtons · fromImcRepresentLink 재사용.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildTemplateMirrorFromImc } from '../alimtalk-template-mirror';

const sentText = {
  templateContent: '안녕하세요 #{이름}님',
  templateEmphasizeType: 'TEXT',
  templateTitle: '제목',
  templateSubtitle: '보조',
  buttonList: [{ name: '보기', type: 'WL', urlMobile: 'https://example.com/m' }],
};

describe('buildTemplateMirrorFromImc', () => {
  it('보낸 값이 응답에 모두 있으면 IMC 값으로 맞춘다(빠진 항목 = 비움)', () => {
    const imc = {
      templateContent: '안녕하세요 #{이름}님', templateEmphasizeType: 'TEXT', templateTitle: '제목', templateSubtitle: '보조',
      buttonList: [{ name: '보기', type: 'WL', url_mobile: 'https://example.com/m' }],
    };
    const r = buildTemplateMirrorFromImc(sentText, imc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.columns.emphasize_title).toBe('제목');
      expect(r.columns.represent_link).toBeNull();
      expect(r.columns.extra_content).toBeNull();
      expect(JSON.parse(r.columns.buttons as string)[0].urlMobile).toBe('https://example.com/m');
    }
  });

  it('사용자가 지웠는데 IMC가 남겨 두었으면 IMC 값(남은 값)으로 — 발송이 템플릿과 어긋나지 않게', () => {
    const sent = { templateContent: '본문', templateEmphasizeType: 'NONE', buttonList: [] };
    const imc = { templateContent: '본문', templateEmphasizeType: 'NONE', buttonList: [], templateRepresentLink: { url_mobile: 'https://example.com/r' } };
    const r = buildTemplateMirrorFromImc(sent, imc);
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.columns.represent_link as string)).toEqual({ urlMobile: 'https://example.com/r' });
  });

  it('보낸 값이 응답과 다르거나 없으면 반영하지 않는다', () => {
    expect(buildTemplateMirrorFromImc(sentText, { ...sentText, templateContent: '다른 본문' }).ok).toBe(false);
    expect(buildTemplateMirrorFromImc(sentText, { templateContent: sentText.templateContent, templateEmphasizeType: 'TEXT', templateSubtitle: '보조', buttonList: sentText.buttonList }).ok).toBe(false);
    expect(buildTemplateMirrorFromImc(sentText, { ...sentText, buttonList: [] }).ok).toBe(false);
    expect(buildTemplateMirrorFromImc(sentText, null).ok).toBe(false);
  });
});

describe('배선', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'routes', 'alimtalk.ts'), 'utf8');
  const put = src.slice(src.indexOf("  '/templates/:templateCode',\n  async (req: Request, res: Response) => {\n    try {\n      const ctx = await requireTemplateAccess(req, res);"));
  it('수정 성공 뒤 IMC를 다시 읽어 맞춘다', () => {
    expect(put).toContain('const mirror = buildTemplateMirrorFromImc(body, reread?.code === \'0000\' ? reread.data : null);');
  });
});
