/**
 * dm-validate.ts — DM 발행 전 10영역 자동 검수 엔진
 *
 * 영역 (설계서 §10):
 *   link / personalization / coupon / countdown / layout / style
 *   / content / required_info / data / operation
 *
 * 치명(fatal)이 1건이라도 있으면 can_publish=false.
 * 권장(recommend), 성과개선(improve)은 발행 차단 X.
 */
import type { Section } from './dm-section-registry';
import type { DmBrandKit } from './dm-tokens';
import { getContrastRatio } from './dm-tokens';
import { extractVariables } from './dm-variable-resolver';

// ────────────── 타입 ──────────────

export type Severity = 'fatal' | 'recommend' | 'improve';
export type ValidationArea =
  | 'link' | 'personalization' | 'coupon' | 'countdown' | 'layout'
  | 'style' | 'content' | 'required_info' | 'data' | 'operation';

export type ValidationItem = {
  area: ValidationArea;
  severity: Severity;
  section_id?: string;
  message: string;
  fix_suggestion?: string;
};

export type ValidationResult = {
  level: 'pass' | 'warning' | 'error';
  items: ValidationItem[];
  can_publish: boolean;
  checked_at: string;
  stats: {
    fatal: number;
    recommend: number;
    improve: number;
  };
};

// ────────────── 상수 ──────────────

const SAFE_URL_REGEX = /^(https?:\/\/[^\s"'<>]+|tel:\+?[\d\-]+|mailto:[\w._-]+@[\w.-]+\.[a-z]{2,})$/i;
const FORBIDDEN_WORDS = ['반드시 성공', '무조건', '100% 보장', '절대 실패', '완벽한 효과'];
const KISA_REQUIRED_HINT = /(고객센터|CS|문의|연락처|수신거부)/;
const MAX_TEXT_LEN_PER_SECTION = 500;
const MAX_IMAGES_PER_SECTION = 3;

// ────────────── 유틸 ──────────────

function isSafeUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false;
  return SAFE_URL_REGEX.test(url.trim());
}

function countTextLen(props: any): number {
  let len = 0;
  for (const v of Object.values(props || {})) {
    if (typeof v === 'string') len += v.length;
  }
  return len;
}

function countImages(props: any): number {
  const keys = ['image_url', 'banner_image_url', 'logo_url', 'thumbnail_url'];
  return keys.reduce((acc, k) => acc + (props?.[k] ? 1 : 0), 0);
}

// ────────────── 영역별 검증 ──────────────

export function validateLinks(sections: Section[]): ValidationItem[] {
  const out: ValidationItem[] = [];
  for (const s of sections) {
    if (!s.visible) continue;
    const p: any = s.props;

    // CTA buttons
    if (s.type === 'cta' && Array.isArray(p.buttons)) {
      p.buttons.forEach((b: any, i: number) => {
        if (!b.url || !b.url.trim()) {
          out.push({ area: 'link', severity: 'fatal', section_id: s.id, message: `CTA 버튼 ${i + 1}번의 URL이 비어있어요.`, fix_suggestion: '연결할 페이지 URL을 입력해 주세요.' });
        } else if (!isSafeUrl(b.url)) {
          out.push({ area: 'link', severity: 'recommend', section_id: s.id, message: `CTA 버튼 ${i + 1}번 URL(${b.url}) 형식이 유효하지 않아요.`, fix_suggestion: 'http:// 또는 https://로 시작하는 URL을 사용해 주세요.' });
        }
      });
    }

    // Coupon / PromoCode cta_url
    if (['coupon', 'promo_code', 'store_info'].includes(s.type)) {
      if (p.cta_url && !isSafeUrl(p.cta_url)) {
        out.push({ area: 'link', severity: 'recommend', section_id: s.id, message: `연결 URL(${p.cta_url}) 형식이 유효하지 않아요.` });
      }
      if (p.map_url && !isSafeUrl(p.map_url)) {
        out.push({ area: 'link', severity: 'recommend', section_id: s.id, message: '지도 링크 형식이 유효하지 않아요.' });
      }
      if (p.website && !isSafeUrl(p.website)) {
        out.push({ area: 'link', severity: 'recommend', section_id: s.id, message: '홈페이지 URL 형식이 유효하지 않아요.' });
      }
    }

    // SNS
    if (s.type === 'sns' && Array.isArray(p.channels)) {
      p.channels.forEach((ch: any, i: number) => {
        if (!ch.url || !isSafeUrl(ch.url)) {
          out.push({ area: 'link', severity: 'recommend', section_id: s.id, message: `SNS 채널 ${i + 1}(${ch.type}) URL이 비어있거나 유효하지 않아요.` });
        }
      });
    }
  }
  return out;
}

export function validatePersonalization(sections: Section[]): ValidationItem[] {
  const out: ValidationItem[] = [];
  for (const s of sections) {
    if (!s.visible) continue;
    const texts: string[] = [];
    for (const v of Object.values(s.props || {})) {
      if (typeof v === 'string') texts.push(v);
    }
    const vars = extractVariables(texts.join('\n'));
    if (vars.length === 0) continue;

    const bindings = (s.variable_fallbacks || []).map((b) => b.variable);
    for (const v of vars) {
      if (!bindings.includes(v)) {
        out.push({
          area: 'personalization',
          severity: 'fatal',
          section_id: s.id,
          message: `변수 ${v}에 fallback이 설정되지 않았어요.`,
          fix_suggestion: '우측 패널 > 변수 fallback에서 기본값을 설정해 주세요.',
        });
      }
    }
  }
  return out;
}

export function validateCoupons(sections: Section[]): ValidationItem[] {
  const out: ValidationItem[] = [];
  for (const s of sections.filter((x) => x.type === 'coupon' && x.visible)) {
    const p: any = s.props;
    if (!p.discount_label) {
      out.push({ area: 'coupon', severity: 'fatal', section_id: s.id, message: '할인 라벨이 비어있어요.' });
    }
    if (p.coupon_code && !p.expire_date) {
      out.push({ area: 'coupon', severity: 'recommend', section_id: s.id, message: '쿠폰 코드가 있는데 유효기간이 설정되지 않았어요.', fix_suggestion: '쿠폰 유효기간 종료일을 지정해 주세요.' });
    }
    if (!p.usage_condition) {
      out.push({ area: 'coupon', severity: 'improve', section_id: s.id, message: '사용 조건을 명시하면 전환율이 올라가요.' });
    }
  }
  return out;
}

export function validateCountdown(sections: Section[]): ValidationItem[] {
  const out: ValidationItem[] = [];
  const now = Date.now();
  for (const s of sections.filter((x) => x.type === 'countdown' && x.visible)) {
    const p: any = s.props;
    if (!p.end_datetime) {
      out.push({ area: 'countdown', severity: 'fatal', section_id: s.id, message: '카운트다운 종료 일시가 설정되지 않았어요.' });
      continue;
    }
    const end = new Date(p.end_datetime).getTime();
    if (!isFinite(end)) {
      out.push({ area: 'countdown', severity: 'fatal', section_id: s.id, message: '카운트다운 종료 일시 형식이 잘못됐어요.' });
      continue;
    }
    if (end < now) {
      out.push({ area: 'countdown', severity: 'fatal', section_id: s.id, message: '카운트다운 종료 일시가 이미 지나갔어요.', fix_suggestion: '미래 시점으로 다시 설정해 주세요.' });
    }
    // 카운트다운 헤더도 동일 체크
  }
  // Header variant=countdown도 체크
  for (const s of sections.filter((x) => x.type === 'header' && x.visible)) {
    const p: any = s.props;
    if (p.variant === 'countdown' && p.event_date) {
      const t = new Date(p.event_date).getTime();
      if (isFinite(t) && t < now) {
        out.push({ area: 'countdown', severity: 'recommend', section_id: s.id, message: '헤더 카운트다운의 이벤트 일시가 이미 지나갔어요.' });
      }
    }
  }
  return out;
}

export function validateLayout(sections: Section[]): ValidationItem[] {
  const out: ValidationItem[] = [];
  if (sections.length === 0) {
    out.push({ area: 'layout', severity: 'fatal', message: '섹션이 하나도 없어요. 최소 1개 이상 추가해 주세요.' });
    return out;
  }
  for (const s of sections) {
    if (!s.visible) continue;
    const len = countTextLen(s.props);
    if (len > MAX_TEXT_LEN_PER_SECTION) {
      out.push({ area: 'layout', severity: 'recommend', section_id: s.id, message: `섹션 텍스트가 너무 길어요 (${len}자, 권장 ${MAX_TEXT_LEN_PER_SECTION}자 이내).`, fix_suggestion: 'AI 개선으로 문구를 축약할 수 있어요.' });
    }
    const imgs = countImages(s.props);
    if (imgs > MAX_IMAGES_PER_SECTION) {
      out.push({ area: 'layout', severity: 'improve', section_id: s.id, message: `이미지가 ${imgs}개예요. 권장 ${MAX_IMAGES_PER_SECTION}개 이내로 조정해 주세요.` });
    }
  }
  return out;
}

export function validateStyle(sections: Section[], brandKit?: DmBrandKit): ValidationItem[] {
  const out: ValidationItem[] = [];
  const primary = brandKit?.primary_color;
  if (primary && /^#[0-9a-fA-F]{6}$/.test(primary)) {
    const ratio = getContrastRatio(primary, '#ffffff');
    if (ratio < 4.5) {
      out.push({
        area: 'style',
        severity: 'recommend',
        message: `브랜드 primary 색(${primary})과 흰 배경 간 대비가 낮아요 (WCAG AA 미달, ${ratio.toFixed(2)}:1).`,
        fix_suggestion: '더 진한 브랜드 컬러로 조정하거나, CTA는 어두운 배경 위에 사용해 주세요.',
      });
    }
  }
  // CTA 버튼 최소 크기 보장은 CSS에서 처리하므로 스킵.
  return out;
}

export function validateContent(sections: Section[]): ValidationItem[] {
  const out: ValidationItem[] = [];
  for (const s of sections) {
    if (!s.visible) continue;
    const text = Object.values(s.props || {})
      .filter((v) => typeof v === 'string')
      .join(' ');
    for (const banned of FORBIDDEN_WORDS) {
      if (text.includes(banned)) {
        out.push({
          area: 'content',
          severity: 'fatal',
          section_id: s.id,
          message: `금지 표현("${banned}")이 포함되어 있어요.`,
          fix_suggestion: '과장된 성과 약속 대신 사실 기반 표현을 사용해 주세요.',
        });
      }
    }
  }
  return out;
}

export function validateRequiredInfo(sections: Section[]): ValidationItem[] {
  const out: ValidationItem[] = [];
  const footer = sections.find((s) => s.type === 'footer' && s.visible);
  const storeInfo = sections.find((s) => s.type === 'store_info' && s.visible);

  if (!footer) {
    out.push({ area: 'required_info', severity: 'fatal', message: 'Footer 섹션이 없어요. 고객센터/수신거부 정보 노출 의무를 위해 필수예요.' });
  } else {
    const p: any = footer.props;
    const hasCs = !!(p.cs_phone || p.cs_hours);
    if (!hasCs && !storeInfo) {
      out.push({ area: 'required_info', severity: 'fatal', section_id: footer.id, message: '고객센터 정보가 없어요 (KISA 발송 가이드).', fix_suggestion: 'Footer의 고객센터 전화 또는 Store Info 섹션을 추가해 주세요.' });
    }
    if (p.show_unsubscribe_link === false) {
      out.push({ area: 'required_info', severity: 'fatal', section_id: footer.id, message: '수신거부 링크가 숨김 상태예요. 광고성 메시지는 수신거부 링크 노출이 의무예요.' });
    }
    if (!p.notes && !p.legal_text) {
      out.push({ area: 'required_info', severity: 'improve', section_id: footer.id, message: '유의사항/법정 안내 문구를 1줄 이상 권장해요.' });
    }
  }

  // 전체 DM 문구에 고객센터 연락처 힌트가 전혀 없으면 경고
  const allText = sections.map((s) => Object.values(s.props || {}).filter((v) => typeof v === 'string').join(' ')).join(' ');
  if (!KISA_REQUIRED_HINT.test(allText)) {
    out.push({ area: 'required_info', severity: 'recommend', message: '메시지 전체에 고객센터/문의처 정보가 없어요. KISA 가이드 준수를 권장해요.' });
  }

  return out;
}

export function validateData(
  sections: Section[],
  sampleCustomers: Array<{ key: string; data: Record<string, any> | null }>,
): ValidationItem[] {
  const out: ValidationItem[] = [];
  // 각 섹션의 모든 %변수%가 샘플 A(VIP)에서 빈 값이면 data 문제로 간주
  const vipSample = sampleCustomers.find((s) => s.key === 'vip');
  if (!vipSample?.data) return out;

  for (const s of sections) {
    if (!s.visible) continue;
    const texts: string[] = Object.values(s.props || {}).filter((v) => typeof v === 'string') as string[];
    const vars = extractVariables(texts.join('\n'));
    for (const v of vars) {
      const key = v.replace(/^%|%$/g, '');
      const value = vipSample.data[key];
      if (value === undefined || value === null || value === '') {
        out.push({
          area: 'data',
          severity: 'recommend',
          section_id: s.id,
          message: `변수 ${v}가 샘플 고객(VIP)에서 빈 값이에요. fallback이 필요해요.`,
        });
      }
    }
  }
  return out;
}

export function validateOperation(dm: {
  sections?: Section[] | null;
  scheduled_at?: string | null;
  publish_mode?: 'now' | 'scheduled' | 'approval_required' | null;
}): ValidationItem[] {
  const out: ValidationItem[] = [];
  if (dm.publish_mode === 'scheduled' && !dm.scheduled_at) {
    out.push({ area: 'operation', severity: 'fatal', message: '예약 발행 모드인데 예약 일시가 비어있어요.' });
  }
  if (dm.scheduled_at) {
    const t = new Date(dm.scheduled_at).getTime();
    if (!isFinite(t)) {
      out.push({ area: 'operation', severity: 'fatal', message: '예약 일시 형식이 잘못됐어요.' });
    } else if (t < Date.now()) {
      out.push({ area: 'operation', severity: 'fatal', message: '예약 일시가 이미 지나갔어요.' });
    }
  }
  return out;
}

// ────────────── 통합 진입점 ──────────────

export async function validateDm(
  dm: {
    sections?: Section[] | string | null;
    brand_kit?: DmBrandKit | string | null;
    scheduled_at?: string | null;
    publish_mode?: 'now' | 'scheduled' | 'approval_required' | null;
  },
  opts?: {
    sampleCustomers?: Array<{ key: string; data: Record<string, any> | null }>;
  },
): Promise<ValidationResult> {
  const sections: Section[] = typeof dm.sections === 'string'
    ? (() => { try { return JSON.parse(dm.sections as string); } catch { return []; } })()
    : Array.isArray(dm.sections) ? dm.sections : [];

  const brandKit: DmBrandKit | undefined = typeof dm.brand_kit === 'string'
    ? (() => { try { return JSON.parse(dm.brand_kit as string); } catch { return undefined; } })()
    : (dm.brand_kit as DmBrandKit | undefined) || undefined;

  const items: ValidationItem[] = [
    ...validateLinks(sections),
    ...validatePersonalization(sections),
    ...validateCoupons(sections),
    ...validateCountdown(sections),
    ...validateLayout(sections),
    ...validateStyle(sections, brandKit),
    ...validateContent(sections),
    ...validateRequiredInfo(sections),
    ...(opts?.sampleCustomers ? validateData(sections, opts.sampleCustomers) : []),
    ...validateOperation({ sections, scheduled_at: dm.scheduled_at, publish_mode: dm.publish_mode }),
  ];

  const stats = {
    fatal:     items.filter((i) => i.severity === 'fatal').length,
    recommend: items.filter((i) => i.severity === 'recommend').length,
    improve:   items.filter((i) => i.severity === 'improve').length,
  };

  const level: ValidationResult['level'] = stats.fatal > 0 ? 'error' : stats.recommend > 0 ? 'warning' : 'pass';

  return {
    level,
    items,
    can_publish: stats.fatal === 0 && sections.length > 0,
    checked_at: new Date().toISOString(),
    stats,
  };
}
