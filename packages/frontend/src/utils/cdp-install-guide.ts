/**
 * utils/cdp-install-guide.ts — 개발자 전달용 설치 안내 조립 CT (★2026-08-10 Phase 4)
 *
 * 설계서 = docs/2026-08-09-cdp-integration-redesign-design.md §5-3
 *
 * ★ 방향 정정(0810 Harold 지적 수용): 공개 링크를 만들지 않는다.
 *   링크는 문제를 반만 푼다 — 자체호스팅 웹훅은 규격과 **시크릿**이 함께 가야 하는데 시크릿은 링크에
 *   못 담는다. 담당자가 어차피 시크릿을 사적 경로로 넘겨야 하니, 그 경로로 규격도 같이 보내면 된다.
 *   링크를 만들면 웹훅 규격만 새로 공개되고(엔드포인트·헤더·서명 방식 = 정찰 가치) 얻는 게 없다.
 *
 * 그래서 **클립보드 복사**로 간다 — 공개 엔드포인트 0 · 토큰 0 · 만료 관리 0 · DDL 0.
 * 담당자가 자기 채널(메일·메신저·이슈트래커)로 붙여 넣고, 무엇을 어디로 보낼지 직접 통제한다.
 *
 * ⛔ 비밀 등급:
 *   - 기본 포함: SDK 공개키(몰 HTML에 그대로 실려 본래 공개) · 설치 위치 · 확인 방법
 *   - **기본 제외**: `webhook_secret` — 담을지는 호출부가 명시적으로 정하고 경고를 함께 띄운다
 *   - **절대 제외**: 서버 egress IP(공개 시 전 고객사가 우리 IP를 알게 됨 = 공격 표면)
 */

export interface BuildInstallGuideInput {
  providerName: string;
  /** SDK 공개키 — 없으면 스크립트 절을 넣지 않는다(빈 자리에 가짜 값을 넣지 않는다). */
  sdkKey?: string | null;
  sdkVersion?: string | null;
  /** 자체호스팅 webhook 수신 주소 */
  webhookUrl?: string | null;
  /** 수집 허용 도메인 — 등록돼 있어야 브라우저 수집이 열린다 */
  allowedOrigins?: string[];
  /** true일 때만 시크릿 자리를 안내한다. 값 자체는 담지 않는다. */
  includeSecretNotice?: boolean;
}

// ★ 2026-08-10 Phase 5-2 — 스크립트 경로·버전은 `cdp-sdk-script` CT가 소유한다(여섯 곳에 흩어져 있던 것).
import { CDP_SDK_VERSION, buildSdkScriptUrl } from './cdp-sdk-script';

/**
 * 개발자에게 그대로 보낼 수 있는 설치 안내(평문). 마크다운 기호를 최소로 써서
 * 메일·메신저 어디에 붙여도 읽히게 한다.
 */
export function buildInstallGuideText(input: BuildInstallGuideInput): string {
  const {
    providerName, sdkKey, sdkVersion, webhookUrl, allowedOrigins, includeSecretNotice,
  } = input;
  const ver = sdkVersion || CDP_SDK_VERSION;
  const lines: string[] = [];

  lines.push(`[한줄로 연동 설치 안내 — ${providerName}]`);
  lines.push('');
  lines.push('아래 순서대로 진행해 주세요. 궁금한 점은 요청하신 담당자에게 문의해 주세요.');
  lines.push('');

  if (sdkKey) {
    lines.push('1) 수집 스크립트 설치');
    lines.push('   쇼핑몰 모든 페이지의 <head> 안에 아래 한 줄을 넣어주세요.');
    lines.push('');
    lines.push(`   <script src="${buildSdkScriptUrl(ver)}" data-hjl-key="${sdkKey}" async></script>`);
    lines.push('');
    lines.push('   앱 웹뷰 페이지에는 data-hjl-platform="app" 를 한 줄 더 붙여주세요.');
    lines.push('');
  }

  if (allowedOrigins && allowedOrigins.length > 0) {
    lines.push('2) 수집 허용 도메인');
    lines.push('   아래 도메인에서만 수집이 열립니다. 실제 서비스 도메인과 다르면 담당자에게 알려주세요.');
    for (const o of allowedOrigins) lines.push(`   - ${o}`);
    lines.push('');
  }

  if (webhookUrl) {
    lines.push('3) 주문·회원 webhook 전송');
    lines.push(`   수신 주소: ${webhookUrl}`);
    lines.push('   요청 헤더: X-Hanjullo-Company-Id / X-Hanjullo-Event / X-Hanjullo-Signature');
    lines.push('   본문 형식: { "event": "order.created", "resource": { ... } }');
    lines.push('   서명: 본문 전체를 발급받은 시크릿으로 HMAC-SHA256 서명해 헤더에 넣어주세요.');
    lines.push('');
    if (includeSecretNotice) {
      lines.push('   ※ 서명 시크릿은 보안상 이 안내에 포함하지 않았습니다. 담당자에게 별도로 받아주세요.');
      lines.push('');
    }
  }

  lines.push('설치 후 확인');
  lines.push('   설치한 페이지를 한 번 열어보시면 한줄로 화면의 "첫 데이터 확인" 단계가 자동으로 켜집니다.');
  lines.push('   5분이 지나도 안 켜지면 스크립트가 모든 페이지에 들어갔는지, 도메인이 위 목록과 같은지 확인해 주세요.');

  return lines.join('\n');
}
