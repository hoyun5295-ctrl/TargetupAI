/**
 * utils/cdp-sdk-script.ts — 브라우저 SDK 설치 스크립트 단일 출처 (★2026-08-10 Phase 5-2)
 *
 * 왜 생겼는가
 *   설치 스크립트 한 줄(`.../sdk/<버전>/hanjul.min.js`)이 화면 여섯 군데에 각각 손으로 적혀 있었다 —
 *   메이크샵·아임웹·고도몰의 SDK 설치 절, 자체 호스팅 웹/앱 웹뷰 스니펫 둘, 개발자 전달 안내.
 *   **SDK 버전을 올리면 여섯 곳을 다 고쳐야 하고, 하나를 빠뜨리면 그 몰만 옛 SDK를 설치한다.**
 *   조용히 어긋나는 종류라(설치는 되고 동작만 옛것) 화면으로는 알 수 없다.
 *
 * ⛔ 버전·경로·키 자리표시자를 다른 파일에 다시 쓰지 않는다. 새 몰이 생기면 여기서 만들어 쓴다.
 */

export const CDP_SDK_BASE = 'https://app.hanjul.ai/api/cdp/sdk';

/** 현재 배포 중인 브라우저 SDK 버전. 올릴 때 고치는 곳은 여기 한 줄이다. */
export const CDP_SDK_VERSION = 'v0.3.9';

/** 키가 아직 없을 때 안내문에 넣는 자리표시자 — 가짜 키를 그럴듯하게 만들지 않는다. */
export const CDP_SDK_KEY_PLACEHOLDER = 'hjl_발급받은_공개키';

/** 스크립트 URL(버전 포함). 안내문·캡션이 경로만 필요할 때 쓴다. */
export function buildSdkScriptUrl(version: string = CDP_SDK_VERSION): string {
  return `${CDP_SDK_BASE}/${version}/hanjul.min.js`;
}

/**
 * 설치용 `<script>` 한 줄.
 * @param publicKey 발급된 공개키. 없으면 자리표시자가 들어간다(몰 HTML에 그대로 실리는 공개값 — 비밀 아님).
 * @param opts.platformApp 앱 웹뷰 페이지용 속성(`data-hjl-platform="app"`)을 붙인다.
 */
export function buildSdkScriptTag(
  publicKey: string | null | undefined,
  opts?: { platformApp?: boolean; version?: string },
): string {
  const key = publicKey || CDP_SDK_KEY_PLACEHOLDER;
  const platform = opts?.platformApp ? ' data-hjl-platform="app"' : '';
  return `<script src="${buildSdkScriptUrl(opts?.version)}" data-hjl-key="${key}"${platform} async></script>`;
}
