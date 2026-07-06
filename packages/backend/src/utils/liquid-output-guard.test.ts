// ★ 2026-07-06 문안 생성 출구 가드 검증 — psy5868 오퍼레이터 메인 Liquid 노출 근본수정.
//   1) flattenLiquidToPlainText: 신고 문안 원문(churn_risk 분기)이 평문화되어 {{ }}·{% %} 잔존 0
//   2) stripLiquidLeftovers: 문법 깨진 템플릿도 태그 제거
//   3) formatProfileForAiPrompt percent 모드: Liquid 지시·예시 0 / liquid 모드(기본): 기존 그대로 (여정·인앱 보존)
import { describe, it, expect } from 'vitest';
import { flattenLiquidToPlainText, stripLiquidLeftovers, detectLiquidSyntax } from './liquid-templating';
import { formatProfileForAiPrompt, type CompanyDataProfile } from './company-data-profile';

// 신고 원문 축약판 (2026-07-06 서수란/영업팀장 캡처 — Atelier Nain)
const REPORTED_COPY = `%고객명%님, 안녕하세요.

{% if customer.churn_risk > 0.7 %}
한동안 발걸음이 뜸하셨네요. %등록매장%에서 %고객명%님을 기다리고 있어요.
{% else %}
문득 %고객명%님 생각이 나 안부 전해드려요.

%등록매장%에서 %고객명%님을 편안히 맞이할 준비를 해두었어요.
{% endif %}

공식 홈페이지 www.nain.co.kr`;

describe('flattenLiquidToPlainText — 생성물 평문화 (출구 가드)', () => {
  it('신고 문안: 분기 태그 제거 + else 분기 본문 채택 + %변수% 보존', () => {
    const out = flattenLiquidToPlainText(REPORTED_COPY);
    expect(detectLiquidSyntax(out)).toBe(false);
    expect(out).toContain('문득 %고객명%님 생각이');        // 중립 컨텍스트 → 조건 false → else 분기
    expect(out).not.toContain('한동안 발걸음이');            // if 분기 미채택
    expect(out).toContain('%고객명%');                       // %변수%는 그대로 보존 (발송 치환 대상)
    expect(out).toContain('공식 홈페이지 www.nain.co.kr');   // 일반 본문 보존
  });

  it('{{ x | default }} 는 기본값으로 치환', () => {
    const out = flattenLiquidToPlainText(`{{ customer.name | default: '고객' }}님 반가워요`);
    expect(out).toBe('고객님 반가워요');
  });

  it('Liquid 없는 평문은 무접촉', () => {
    const plain = '%고객명%님, 20% 할인 안내드려요';
    expect(flattenLiquidToPlainText(plain)).toBe(plain);
  });
});

describe('stripLiquidLeftovers — 잔존 태그 제거 (최후 방어)', () => {
  it('문법 깨진 템플릿(미종결 endif 없음)도 태그만 제거하고 본문 보존', () => {
    const broken = `{% if customer.grade == 'VIP' %}VIP 안내 {{ customer.name }}님`;
    const out = stripLiquidLeftovers(broken);
    expect(detectLiquidSyntax(out)).toBe(false);
    expect(out).toContain('VIP 안내');
  });

  it('정상 평문 무접촉', () => {
    expect(stripLiquidLeftovers('그대로')).toBe('그대로');
  });
});

describe('formatProfileForAiPrompt — 변수 세계 분리', () => {
  const profile: CompanyDataProfile = {
    totalCustomers: 1000,
    safeFields: [
      { field: 'name', label: '고객명', liquidVar: 'customer.name', percentVar: '고객명', fillRate: 100, filledCount: 1000, totalCount: 1000, category: 'safe' },
    ],
    conditionalFields: [
      { field: 'grade', label: '등급', liquidVar: 'customer.grade', percentVar: '등급', fillRate: 50, filledCount: 500, totalCount: 1000, category: 'conditional' },
    ],
    blockedFields: [
      { field: 'region', label: '지역', liquidVar: 'customer.region', percentVar: '지역', fillRate: 10, filledCount: 100, totalCount: 1000, category: 'blocked' },
    ],
  } as CompanyDataProfile;

  it("percent 모드: Liquid 문법({{ }}·{% %}) 지시·예시 0 + 금지 문구 포함", () => {
    const out = formatProfileForAiPrompt(profile, { variableStyle: 'percent' });
    expect(out).not.toContain('{%');
    expect(out).not.toContain('{{');
    expect(out).toContain('템플릿 문법');
    expect(out).toContain('%등급%');
  });

  it('liquid 모드(기본값): 기존 Liquid 분기 지시 유지 — 여정·인앱 무변', () => {
    const out = formatProfileForAiPrompt(profile);
    expect(out).toContain('{% if customer.X %}');
    expect(out).toContain('{{ customer.name }}');
  });

  it('cold start percent 모드: Liquid 언급 0', () => {
    const cold = { ...profile, totalCustomers: 0 } as CompanyDataProfile;
    const out = formatProfileForAiPrompt(cold, { variableStyle: 'percent' });
    expect(out).not.toContain('{{');
    expect(out).not.toContain('Liquid');
  });
});
