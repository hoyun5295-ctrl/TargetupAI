// ★ 2026-11-10 여정 문안 = %변수% 한 가지(그룹웨어 접수 「여정 - 엑셀로 업로드한 DB - 생일자 타겟 머지 표시」 · Harold 「통일성 · 왜 왔다갔다」)
//   1) liquidCopyToPercent: 접수 원문({{ customer.name | default }} + 등급 분기) → %고객명% · 분기 = else 한 갈래 · 장바구니 변수 보존
//   2) 여정 생성 출구 넷 = 같은 함수 · 매트릭스 = percent(소스 계약)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { liquidCopyToPercent, detectLiquidSyntax, flattenLiquidToPlainText } from '../liquid-templating';
import { CUSTOMER_LIQUID_TO_PERCENT } from '../standard-field-map';

// 접수 캡처(인비토 · 생일 여정 1번째 칸) 원문 축약
const REPORTED = `[인비토]
{{ customer.name | default: '고객' }}님, 안녕하세요.

곧 다가올 {{ customer.name | default: '고객' }}님의 생일을 떠올리며 조금 이른 축하 인사를 먼저 건네고 싶었어요.

{% if customer.grade == 'VIP' %}
VIP 회원님으로 오랜 시간 한결같은 신뢰를 보내주신 {{ customer.name | default: '고객' }}님.
{% elsif customer.purchase_count > 3 %}
{{ customer.purchase_count | default: '' }}번의 만남을 함께해주신 {{ customer.name | default: '고객' }}님.
{% else %}
누군가에게 축하받는 하루는 생각보다 오래 마음에 남는 법이죠.
{% endif %}

자세히 → [URL 입력]`;

describe('CUSTOMER_LIQUID_TO_PERCENT — 발송 사전 키(FIELD_MAP displayName)', () => {
  it('고객명 · 고객등급 · 휴대폰과 수신 동의는 변수가 아니다', () => {
    expect(CUSTOMER_LIQUID_TO_PERCENT.name).toBe('고객명');
    expect(CUSTOMER_LIQUID_TO_PERCENT.grade).toBe('고객등급');
    expect(CUSTOMER_LIQUID_TO_PERCENT.phone).toBeUndefined();
    expect(CUSTOMER_LIQUID_TO_PERCENT.sms_opt_in).toBeUndefined();
  });
});

describe('liquidCopyToPercent — 여정 생성물 출구', () => {
  it('접수 원문: 이름 = %고객명% · 분기 코드 0 · else 갈래만 · 나머지 본문 그대로', () => {
    const out = liquidCopyToPercent(REPORTED, CUSTOMER_LIQUID_TO_PERCENT);
    expect(detectLiquidSyntax(out)).toBe(false);
    expect(out).toContain('%고객명%님, 안녕하세요.');
    expect(out).toContain('곧 다가올 %고객명%님의 생일을');
    expect(out).toContain('누군가에게 축하받는 하루는');
    expect(out).not.toContain('VIP 회원님으로');
    expect(out).not.toContain('번의 만남을');
    expect(out).toContain('[인비토]');
    expect(out).toContain('자세히 → [URL 입력]');
  });

  it('필터 붙은 아는 칸 = 그 %변수% (default 는 버린다)', () => {
    expect(liquidCopyToPercent("{{ customer.grade | default: '' }} 회원님", CUSTOMER_LIQUID_TO_PERCENT)).toBe('%고객등급% 회원님');
    expect(liquidCopyToPercent('{{customer.name}}님', CUSTOMER_LIQUID_TO_PERCENT)).toBe('%고객명%님');
  });

  it('모르는 칸 = default 값 · 문법 0', () => {
    const out = liquidCopyToPercent("{{ customer.click_score | default: '친구' }}님", CUSTOMER_LIQUID_TO_PERCENT);
    expect(out).toBe('친구님');
  });

  it('장바구니 문법이 든 글 = 고객 칸 이름만 바꾸고 나머지는 그대로(장바구니 여정 = Liquid 렌더로 나간다)', () => {
    const out = liquidCopyToPercent("{{ customer.name | default: '고객' }}님, {{ cart.product_name }} 상품이 기다려요.{% if customer.grade == 'VIP' %} VIP 전용{% endif %}", CUSTOMER_LIQUID_TO_PERCENT);
    expect(out).toBe("%고객명%님, {{ cart.product_name }} 상품이 기다려요.{% if customer.grade == 'VIP' %} VIP 전용{% endif %}");
  });

  it('조건식을 계산하지 않는다 — 빈 값에서 참이 되는 != 조건이어도 else 갈래(Codex 1R)', () => {
    const t = "{% if customer.grade != '일반' %}우수회원 전용 안내{% else %}일반 안내{% endif %}";
    expect(liquidCopyToPercent(t, CUSTOMER_LIQUID_TO_PERCENT)).toBe('일반 안내');
    expect(flattenLiquidToPlainText(t)).toBe('일반 안내');   // 캠페인 생성 출구도 같은 규칙
  });

  it('case · 겹친 if · for = else 갈래만 · else 없으면 덩어리째 없음 · 렌더 파서가 못 읽는 unless = 첫 태그 앞만', () => {
    const m = CUSTOMER_LIQUID_TO_PERCENT;
    expect(liquidCopyToPercent('앞 {% unless customer.vip %}A{% else %}B{% endunless %}', m)).toBe('앞');
    expect(liquidCopyToPercent("{% case customer.grade %}{% when 'VIP' %}V{% when 'GOLD' %}G{% else %}기본{% endcase %}", m)).toBe('기본');
    expect(liquidCopyToPercent('{% if a %}X{% else %}{% if b %}Y{% else %}Z{% endif %}{% endif %}', m)).toBe('Z');
    expect(liquidCopyToPercent('앞{% if a %}X{% endif %}뒤', m)).toBe('앞뒤');
    expect(liquidCopyToPercent('앞 {% for i in customer.tags %}{{ i }}{% endfor %}뒤', m)).toBe('앞 뒤');
  });

  it('주석 안 태그는 바깥 덩어리를 바꾸지 못한다 · 렌더 파서가 못 읽는 글(raw · 엇나간 닫는 태그 · 미종결) = 첫 {% 앞만(Codex 2R ~ 4R)', () => {
    const m = CUSTOMER_LIQUID_TO_PERCENT;
    expect(liquidCopyToPercent('{% if customer.vip %}{% comment %}종료 예: {% endif %}{% endcomment %}VIP 전용{% else %}일반{% endif %}', m)).toBe('일반');
    expect(liquidCopyToPercent('앞 {% comment %}{% if x %}{% endcomment %}뒤', m)).toBe('앞 뒤');
    expect(liquidCopyToPercent('머리 {% raw %}{% if %}{% endraw %}본문', m)).toBe('머리');
    expect(liquidCopyToPercent('본문{% endfor %} 끝', m)).toBe('본문');
    expect(liquidCopyToPercent('{% if a %}A{% endfor %}B{% else %}C{% endif %}', m)).toBe('');
    // 닫히지 않은 주석 = 첫 {% 앞만(조건부 글이 새지 않는 쪽)
    expect(liquidCopyToPercent('본문{% comment %}{% if customer.vip %}VIP', m)).toBe('본문');
    // Codex 4R — raw 안 주석 표식이 실제 고객 조건을 지워 VIP 가 새던 꼴
    const r4 = liquidCopyToPercent('{% raw %}{% comment %}{% endraw %}{% if customer.vip %}{% raw %}{% endcomment %}{% endraw %}VIP{% else %}일반{% endif %}', m);
    expect(r4).not.toContain('VIP');
    expect(detectLiquidSyntax(r4)).toBe(false);
    // 캠페인 출구도 같은 규칙
    expect(flattenLiquidToPlainText('{% if customer.vip %}{% comment %}{% endif %}{% endcomment %}VIP{% else %}일반{% endif %}')).toBe('일반');
  });

  it('장바구니 판정 = 파서 구조의 실제 참조(Codex 5R) · 주석 속 cart 는 장바구니 아님 · assign 별칭은 장바구니', () => {
    const m = CUSTOMER_LIQUID_TO_PERCENT;
    expect(liquidCopyToPercent('{% comment %}{{ cart.product_name }}{% endcomment %}{% if customer.vip %}VIP{% else %}일반{% endif %}', m)).toBe('일반');
    const alias = '{% assign c = cart %}{% for i in c.items %}{{ i.name }}{% endfor %}';
    expect(liquidCopyToPercent(alias, m)).toBe(alias);
    expect(liquidCopyToPercent("앞 {% if note == 'cart.x' %}A{% else %}B{% endif %}", m)).toBe('앞 B');   // 따옴표 안 글자는 참조가 아니다
  });

  it('장바구니 덩어리 = 글자 그대로(여정) · 캠페인 평문화는 지운다', () => {
    const t = '담으신 상품: {% for i in cart.items %}{{ i.name }} {% endfor %}확인해 보세요';
    expect(liquidCopyToPercent(t, CUSTOMER_LIQUID_TO_PERCENT)).toBe(t);
    expect(flattenLiquidToPlainText(t)).toBe('담으신 상품: 확인해 보세요');
  });

  it('Liquid 없는 글 = 글자 하나 안 바뀜', () => {
    const plain = '%고객명%님, 안녕하세요.\n\n[혜택 안내: 직접 수정해주세요]';
    expect(liquidCopyToPercent(plain, CUSTOMER_LIQUID_TO_PERCENT)).toBe(plain);
  });
});

describe('소스 계약 — 여정 생성 출구 넷 · 지시 = %변수% 세계', () => {
  const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
  it('여정 만들기 · 기념일 칸 = 본문 · 제목 출구에 가드', () => {
    const g = src('journey-ai-generator.ts');
    // ★ 2026-11-11 C126 — 생산자는 변수 꼴 CT(journey-ai-copy journeyNewCopy = liquidCopyToPercent + 고객 칸 표)를 부른다
    expect(g).toContain('const rawMessage = journeyNewCopy(aiStr(s.messageTemplate))');
    expect(g).toContain('journeyNewCopy(aiStr(s.subject))');
    expect(g).toContain('journeyNewCopy(aiStr(parsed.subject))');
    expect(g).toContain('journeyNewCopy(aiStr(parsed.message))');
    expect(src('journey-ai-copy.ts')).toContain('return liquidCopyToPercent(aiText, CUSTOMER_LIQUID_TO_PERCENT);');
    expect(g).toContain("formatProfileForAiPrompt(dataProfile, { variableStyle: 'percent' })");
    expect(g).not.toMatch(/formatProfileForAiPrompt\(dataProfile\)/);
    // 지시문에 분기 예시 · 고객 변수 출력 꼴이 남지 않는다(금지 문장의 꼴 설명만 남는다)
    expect(g).not.toContain('{% if customer.');
    expect(g).not.toContain('{% elsif customer.');
    expect(g).not.toContain("{{ customer.name | default: '고객' }}님,");   // 예시 문안 첫 줄 꼴(옛 신규 가입 · 휴면 · 등급 예시)
  });
  it('여정 빌더 · 다음 칸 추천 = 같은 가드', () => {
    const b = src('journey-builder.ts');
    expect(b).toContain('journeyNewCopy(aiStr(s.messageTemplate))');
    expect(b).toContain("formatProfileForAiPrompt(dataProfile, { variableStyle: 'percent' })");
    const d = src('journey-step-diagnosis.ts');
    expect(d).toContain('journeyNewCopy(s.messageTemplate)');
    expect(d).toContain('journeyNewCopy(s.subject)');
  });
});
