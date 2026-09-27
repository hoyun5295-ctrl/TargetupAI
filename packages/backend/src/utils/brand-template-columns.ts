/**
 * CT: 브랜드메시지 템플릿 요청 본문 → brand_message_templates 칸 (★ 2026-09-27 한줄로 V2 R089)
 *
 * 등록 INSERT(routes/alimtalk.ts POST /brand-templates)와 같은 칸·같은 변환이다.
 * 요청에 **있는 칸만** 돌려준다(없는 칸은 건드리지 않는다 · null은 비움). 수정 뒤 PG를 IMC가 받아들인 내용과 맞추는 데 쓴다.
 * 순수 함수라 다른 모듈을 불러오지 않는다(발송 CT brand-message.ts에 두면 테스트가 발송 모듈 전체를 불러와 부하에서 시간 초과).
 */
export interface BrandTemplateColumn {
  column: string;
  value: any;
  cast: string;
}

export function brandTemplateColumnsFromBody(body: any): BrandTemplateColumn[] {
  const b = body || {};
  const out: BrandTemplateColumn[] = [];
  const put = (key: string, column: string, conv: (v: any) => any, cast = '') => {
    if (b[key] !== undefined) out.push({ column, value: conv(b[key]), cast });
  };
  put('customTemplateCode', 'custom_template_code', (v) => v || null);
  put('manageName', 'manage_name', (v) => v);
  put('chatBubbleType', 'chat_bubble_type', (v) => v);
  put('adult', 'adult_yn', (v) => v || 'N');
  put('header', 'header', (v) => v || null);
  put('content', 'content', (v) => v || null);
  put('additionalContent', 'additional_content', (v) => v || null);
  put('attachment', 'attachment', (v) => (v ? JSON.stringify(v) : null), '::jsonb');
  put('carousel', 'carousel', (v) => (v ? JSON.stringify(v) : null), '::jsonb');
  put('buttons', 'buttons', (v) => JSON.stringify(v || []), '::jsonb');
  put('coupon', 'coupon', (v) => (v ? JSON.stringify(v) : null), '::jsonb');
  put('variables', 'variables', (v) => (Array.isArray(v) ? v : []), '::text[]');
  return out;
}
