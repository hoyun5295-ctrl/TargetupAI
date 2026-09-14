/**
 * utils/woocommerce-guide.ts — 우커머스(워드프레스) 개발자 전달 문안·설치 조각 CT (★2026-09-14 W4)
 *
 * 설계서 = docs/2026-09-14-woocommerce-integration-design.md §3 화면 층
 *
 * 규약은 `cdp-install-guide.ts` 와 같다 — 클립보드 복사(공개 링크 0) · 값 없는 자리를 가짜로 채우지 않는다 ·
 * 웹훅 secret 값은 담지 않는다(담당자가 사적 경로로 따로 전달) · 서버 IP 는 절대 담지 않는다.
 *
 * 우커머스 웹훅 헤더·서명 인코딩은 게이트 ② 실측 전까지 미검증이라, 안내는 "관리자 화면에서 만드는 법"만 적고
 * 헤더 규격은 적지 않는다(우커머스가 스스로 붙인다).
 */

import { buildSdkScriptTag } from './cdp-sdk-script';

/** 우리가 받는 웹훅 주제 4종 — 고객사가 우커머스 관리자에서 이 주제로 웹훅 4개를 만든다. */
export const WOO_WEBHOOK_TOPICS = ['order.created', 'order.updated', 'customer.created', 'customer.updated'] as const;

/** 우커머스 관리자 화면의 주제 표기(영문 표기 그대로 · 한국어 관리자에서는 번역된 라벨이 보일 수 있다) */
export const WOO_TOPIC_LABEL: Record<(typeof WOO_WEBHOOK_TOPICS)[number], string> = {
  'order.created': '주문 생성(Order created)',
  'order.updated': '주문 수정(Order updated)',
  'customer.created': '고객 생성(Customer created)',
  'customer.updated': '고객 수정(Customer updated)',
};

export interface BuildWooDeveloperTextInput {
  mallId: string;
  siteUrl: string;
  webhookUrl: string;
  /** SDK 공개키 — 없으면 스크립트 절을 넣지 않는다 */
  sdkKey?: string | null;
  /** 수신동의 커스텀 필드 메타키 — 고객사가 알려 준 값. 없으면 "확인 요청" 문구 */
  consentMetaKey?: string | null;
  /** REST 키를 아직 못 받았으면 true — 발급 안내 절을 넣는다 */
  needsRestKeys?: boolean;
}

/**
 * 개발자에게 그대로 보낼 수 있는 안내(평문). secret 값은 담지 않는다 — 자리만 알린다.
 */
export function buildWooDeveloperText(input: BuildWooDeveloperTextInput): string {
  const lines: string[] = [];
  lines.push(`[한줄로 연동 설치 안내: 우커머스 · ${input.mallId}]`);
  lines.push('');
  lines.push(`대상 몰: ${input.siteUrl}`);
  lines.push('워드프레스 플러그인 설치는 없습니다. 아래 셋만 해 주시면 됩니다.');
  lines.push('');

  let n = 1;
  if (input.needsRestKeys) {
    lines.push(`${n++}) REST API 읽기 키 발급`);
    lines.push('   우커머스 → 설정 → 고급 → REST API → "키 추가". 권한은 "읽기"로, 설명은 "한줄로"로 해 주세요.');
    lines.push('   Consumer key / Consumer secret 두 값을 요청하신 담당자에게 사적 경로(메신저·전화)로 전달해 주세요. 메일 본문에 그대로 적지 마세요.');
    lines.push('');
  }

  lines.push(`${n++}) 웹훅 ${WOO_WEBHOOK_TOPICS.length}개 만들기`);
  lines.push('   우커머스 → 설정 → 고급 → 웹훅 → "웹훅 추가". 아래 주제마다 하나씩, 같은 설정으로 만들어 주세요.');
  for (const t of WOO_WEBHOOK_TOPICS) lines.push(`   - 주제: ${WOO_TOPIC_LABEL[t]}`);
  lines.push(`   - 전송 URL: ${input.webhookUrl}`);
  lines.push('   - 비밀키(Secret): 담당자가 따로 전달한 값을 그대로 붙여 넣어 주세요(이 안내에 포함하지 않았습니다).');
  lines.push('   - API 버전: WP REST API Integration v3 · 상태: 활성');
  lines.push('');

  if (input.sdkKey) {
    lines.push(`${n++}) 방문·장바구니 수집 스크립트`);
    lines.push('   테마의 <head> 에 아래 한 줄을 넣어 주세요(모든 페이지). 자식 테마 header.php 또는 헤더 스크립트 삽입 기능 어디든 됩니다.');
    lines.push('');
    lines.push(`   ${buildSdkScriptTag(input.sdkKey)}`);
    lines.push('');
  }

  lines.push('확인 사항');
  lines.push(input.consentMetaKey
    ? `   - 마케팅 수신동의 값은 회원·주문의 meta_data 키 "${input.consentMetaKey}" 에서 읽습니다. 다른 키를 쓰시면 담당자에게 알려 주세요.`
    : '   - 마케팅 수신동의 커스텀 필드가 회원·주문 어디에 어떤 키로 저장되는지(예: 관리자 화면 캡처 1장) 담당자에게 알려 주세요.');
  lines.push('   - 웹훅을 저장하면 우커머스가 확인 요청(ping)을 한 번 보냅니다. 그 뒤 첫 주문·회원 변경이 들어오면 연동이 "연결됨"으로 바뀝니다.');
  lines.push('');
  lines.push('궁금한 점은 요청하신 담당자에게 문의해 주세요.');
  return lines.join('\n');
}

/**
 * 워드프레스 회원 식별(선택) — 로그인 회원의 번호·휴대폰·이름을 <body> 속성으로 싣는다.
 * 다른 몰(고도몰)과 같은 data-hjl-* 규약. 테마 <body> 태그 한 줄 수정(미검증 · 게이트 ③ SDK 리허설에서 확인).
 */
export function buildWooBodyAttrsSnippet(): string {
  return [
    '<body <?php body_class(); ?><?php',
    '  if ( is_user_logged_in() ) {',
    '    $hjl_u = wp_get_current_user();',
    "    printf( ' data-hjl-user-id=\"%s\" data-hjl-phone=\"%s\" data-hjl-name=\"%s\"',",
    "      esc_attr( $hjl_u->ID ), esc_attr( get_user_meta( $hjl_u->ID, 'billing_phone', true ) ), esc_attr( $hjl_u->display_name ) );",
    '  }',
    '?>>',
  ].join('\n');
}
