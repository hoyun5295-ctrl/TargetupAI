=== 한줄로 (Hanjullo) for WooCommerce ===
Contributors: hanjullo
Tags: woocommerce, marketing, sms, cdp
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

한줄로 AI 마케팅 연동 플러그인.

== 하는 일 ==

1. 방문·장바구니 수집 스크립트를 모든 페이지 head 에 자동으로 넣습니다(한줄로 SDK 공개키 입력 시).
2. 로그인 회원을 자동으로 식별합니다(회원 번호·이메일·휴대폰·이름).
3. 마케팅 수신동의 값(기본 mssms_agreement · email_agreement)을 우커머스 REST 회원·주문 응답에 함께 실어 한줄로가 광고 발송 대상을 정확히 가리게 합니다.

주문·회원 동기화 자체는 이 플러그인이 아니라 한줄로 관리 화면의 "우커머스 연결(관리자 승인)"에서 시작합니다.
승인하면 우커머스가 REST API 키를 한줄로에 전달하고, 한줄로가 웹훅 4개를 자동으로 만듭니다.

== 설치 ==

1. 워드프레스 관리자 → 플러그인 → 새로 추가 → 플러그인 업로드에서 zip 을 올리고 활성화합니다.
2. WooCommerce → 한줄로 에서 SDK 공개키를 넣습니다(선택).
3. 한줄로 관리 → 자사몰 연동 → 우커머스 → 관리자 승인으로 연결.

== 변경 이력 ==

= 1.0.0 =
* 첫 배포.
