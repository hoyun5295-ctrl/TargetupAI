/**
 * ★ CT: 알림톡 템플릿 수정 뒤 PG를 IMC 실제 값으로 맞출 컬럼 계산 (★2026-09-26 한줄로 V2 S1-H05 · 순수)
 *
 * 옛 수정 경로는 PG를 COALESCE로만 갱신해, 사용자가 지운 강조 제목·대표 링크·부가정보가 PG에 남아 발송에 실렸다.
 * IMC 수정 API가 요청에 빠진 키를 지우는지 남기는지 확인할 수 없어(실제 템플릿을 임의로 수정해 볼 수 없다),
 * 어느 쪽이든 맞도록 **수정 직후 IMC에서 다시 읽은 값**을 진실로 삼는다.
 *
 * 응답을 믿는 조건 = 우리가 보낸 값이 응답에 같은 이름·같은 값으로 모두 있다(본문 · 버튼 수 · 강조 제목·보조 문구 ·
 *   대표 링크 모바일 · 부가정보 · 헤더 · 이미지 이름). 하나라도 어긋나면 ok=false → 호출부는 반영하지 않는다(종전 동작).
 * 믿을 수 있으면 발송에 쓰는 항목을 응답 값으로(응답에 없는 항목 = 비움 · 이관 경로와 같은 규약).
 * 역변환은 이관 경로에서 운영 검증된 fromImcButtons · fromImcRepresentLink.
 */
import { fromImcButtons, fromImcRepresentLink } from './alimtalk-api';

export interface TemplateMirrorColumns {
  emphasize_type: string;
  emphasize_title: string | null;
  emphasize_subtitle: string | null;
  image_name: string | null;
  extra_content: string | null;
  template_header: string | null;
  item_highlight: string | null;
  item_list: string | null;
  item_summary: string | null;
  represent_link: string | null;
  preview_message: string | null;
  buttons: string;
}

const str = (v: any): string => (v === null || v === undefined ? '' : String(v));

export function buildTemplateMirrorFromImc(
  sent: any,
  imc: any,
): { ok: true; columns: TemplateMirrorColumns } | { ok: false; reason: string } {
  if (!imc || typeof imc !== 'object') return { ok: false, reason: 'no_data' };
  const s = sent || {};
  if (!s.templateContent || str(imc.templateContent) !== str(s.templateContent)) return { ok: false, reason: 'content_mismatch' };
  const sentButtons = Array.isArray(s.buttonList) ? s.buttonList : [];
  const imcButtons = Array.isArray(imc.buttonList) ? imc.buttonList : null;
  if (sentButtons.length > 0 && (!imcButtons || imcButtons.length !== sentButtons.length)) return { ok: false, reason: 'buttons_mismatch' };
  for (const key of ['templateTitle', 'templateSubtitle', 'templateExtra', 'templateHeader', 'templateImageName']) {
    if (str(s[key]) && str(imc[key]) !== str(s[key])) return { ok: false, reason: `${key}_mismatch` };
  }
  const sentLink = fromImcRepresentLink(s.templateRepresentLink);
  if (sentLink?.urlMobile) {
    const imcLink = fromImcRepresentLink(imc.templateRepresentLink);
    if (!imcLink || imcLink.urlMobile !== sentLink.urlMobile) return { ok: false, reason: 'represent_link_mismatch' };
  }

  const link = fromImcRepresentLink(imc.templateRepresentLink);
  return {
    ok: true,
    columns: {
      emphasize_type: str(imc.templateEmphasizeType) || 'NONE',
      emphasize_title: imc.templateTitle ? String(imc.templateTitle).slice(0, 50) : null,
      emphasize_subtitle: imc.templateSubtitle ? String(imc.templateSubtitle) : null,
      image_name: imc.templateImageName ? String(imc.templateImageName) : null,
      extra_content: imc.templateExtra ? String(imc.templateExtra) : null,
      template_header: imc.templateHeader ? String(imc.templateHeader) : null,
      item_highlight: imc.templateItemHighlight ? JSON.stringify(imc.templateItemHighlight) : null,
      item_list: imc.templateItem?.list ? JSON.stringify(imc.templateItem.list) : null,
      item_summary: imc.templateItem?.summary ? JSON.stringify(imc.templateItem.summary) : null,
      represent_link: link ? JSON.stringify(link) : null,
      preview_message: imc.templatePreviewMessage ? String(imc.templatePreviewMessage) : null,
      buttons: JSON.stringify(fromImcButtons(imcButtons || [])),
    },
  };
}
