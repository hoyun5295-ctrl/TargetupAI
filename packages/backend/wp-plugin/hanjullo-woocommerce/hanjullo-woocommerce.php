<?php
/**
 * Plugin Name: 한줄로 (Hanjullo) for WooCommerce
 * Plugin URI: https://hanjul.ai
 * Description: 한줄로 AI 마케팅 연동. 방문·장바구니 수집 스크립트 자동 삽입, 로그인 회원 식별, 마케팅 수신동의 값의 REST 응답 노출. 주문·회원 동기화는 한줄로 관리 화면의 "우커머스 연결(관리자 승인)" 버튼으로 시작합니다.
 * Version: 1.0.3
 * Author: 한줄로
 * Author URI: https://hanjul.ai
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * WC requires at least: 6.0
 * Text Domain: hanjullo-woocommerce
 * License: GPLv2 or later
 */

defined( 'ABSPATH' ) || exit;

define( 'HANJULLO_WC_VERSION', '1.0.3' );
// SDK 경로·버전 = 한줄로 화면(cdp-sdk-script)이 안내하는 값과 같아야 한다. 올릴 때 두 곳을 함께 고친다.
define( 'HANJULLO_SDK_URL', 'https://app.hanjul.ai/api/cdp/sdk/v0.3.9/hanjul.min.js' );
define( 'HANJULLO_OPTION_SDK_KEY', 'hanjullo_sdk_key' );
define( 'HANJULLO_OPTION_CONSENT_KEYS', 'hanjullo_consent_keys' );
// 1.0.3(2026-10-28): 로그인 회원 식별 = 플러그인 키(이 몰 하나 · 회원 토큰 발급만). 회사 전권 CDP 비밀키는 더 이상 받지 않는다
//   (워드프레스 한 곳이 털려도 회원 쓰기 · 주문 쓰기 · 다른 몰 회원 토큰은 안 된다). 키는 이 서버 설정에만 저장 · 페이지에 실리지 않는다.
define( 'HANJULLO_OPTION_PLUGIN_KEY', 'hanjullo_plugin_key' );
define( 'HANJULLO_API_BASE', 'https://app.hanjul.ai/api/cdp' );
// 1.0.1(2026-10-01): 코드엠샵 수신동의 값이 든 키는 *_label(YES/NO). mssms_agreement 는 on/빈 값이라 안 쓰는 필드다(고객사 확인).
define( 'HANJULLO_DEFAULT_CONSENT_KEYS', 'mssms_agreement_label,email_agreement_label' );

/**
 * 설정된 수신동의 메타키 목록(콤마 구분 · 공백 제거 · 빈 값 제거).
 *
 * @return string[]
 */
function hanjullo_consent_keys() {
	$raw  = (string) get_option( HANJULLO_OPTION_CONSENT_KEYS, HANJULLO_DEFAULT_CONSENT_KEYS );
	$keys = array_filter( array_map( 'trim', explode( ',', $raw ) ) );
	return array_values( array_unique( array_map( 'sanitize_key', $keys ) ) );
}

/**
 * 수신동의 값을 REST 응답 meta_data 에 보장한다(없을 때만 추가 · 있으면 그대로).
 *
 * @param array    $data     REST 응답 데이터.
 * @param int      $user_id  워드프레스 회원 번호(0 이면 비회원).
 * @param WC_Order $order    주문(있으면 주문 메타도 본다).
 * @return array
 */
function hanjullo_append_consent_meta( $data, $user_id, $order = null ) {
	if ( ! is_array( $data ) ) {
		return $data;
	}
	if ( ! isset( $data['meta_data'] ) || ! is_array( $data['meta_data'] ) ) {
		$data['meta_data'] = array();
	}
	$present = array();
	foreach ( $data['meta_data'] as $m ) {
		if ( is_array( $m ) && isset( $m['key'] ) ) {
			$present[ (string) $m['key'] ] = true;
		} elseif ( is_object( $m ) && isset( $m->key ) ) {
			$present[ (string) $m->key ] = true;
		}
	}
	foreach ( hanjullo_consent_keys() as $key ) {
		if ( isset( $present[ $key ] ) ) {
			continue;
		}
		$value = '';
		if ( $order instanceof WC_Order ) {
			$value = (string) $order->get_meta( $key, true );
			if ( '' === $value ) {
				$value = (string) $order->get_meta( '_' . $key, true );
			}
		}
		if ( '' === $value && $user_id > 0 ) {
			$value = (string) get_user_meta( $user_id, $key, true );
		}
		if ( '' === $value ) {
			continue;
		}
		$data['meta_data'][] = array(
			'id'    => 0,
			'key'   => $key,
			'value' => $value,
		);
	}
	return $data;
}

// ─────────────────────────────────────────────────────────────
// REST 응답 필터 — 한줄로가 회원·주문을 읽을 때 수신동의가 함께 온다
// ─────────────────────────────────────────────────────────────

add_filter( 'woocommerce_rest_prepare_customer', function ( $response, $user_data, $request ) {
	if ( ! ( $response instanceof WP_REST_Response ) ) {
		return $response;
	}
	$user_id = ( $user_data instanceof WP_User ) ? (int) $user_data->ID : 0;
	$response->set_data( hanjullo_append_consent_meta( $response->get_data(), $user_id ) );
	return $response;
}, 10, 3 );

add_filter( 'woocommerce_rest_prepare_shop_order_object', function ( $response, $order, $request ) {
	if ( ! ( $response instanceof WP_REST_Response ) || ! ( $order instanceof WC_Order ) ) {
		return $response;
	}
	$response->set_data( hanjullo_append_consent_meta( $response->get_data(), (int) $order->get_customer_id(), $order ) );
	return $response;
}, 10, 3 );

// ─────────────────────────────────────────────────────────────
// 수집 스크립트(모든 페이지 head) + 로그인 회원 식별(footer)
// ─────────────────────────────────────────────────────────────

add_action( 'wp_head', function () {
	if ( is_admin() ) {
		return;
	}
	$key = trim( (string) get_option( HANJULLO_OPTION_SDK_KEY, '' ) );
	if ( '' === $key ) {
		return;
	}
	echo '<script src="' . esc_url( HANJULLO_SDK_URL ) . '" data-hjl-key="' . esc_attr( $key ) . '" async></script>' . "\n";
}, 5 );

/**
 * 이 몰 주소의 호스트(www 제외 · 소문자) — 한줄로가 이 몰 행이 인정하는 주소인지 본다(도메인을 옮긴 몰도 같은 회원 연결로 잇는다).
 *
 * @return string
 */
function hanjullo_site_host() {
	$host = strtolower( (string) wp_parse_url( home_url(), PHP_URL_HOST ) );
	return preg_replace( '/^www\./', '', $host );
}

/**
 * 로그인 회원의 한줄로 식별(회원 연결 번호 + 회원 토큰 · 1시간 유효 · 50분 캐시).
 * 1.0.3: 페이지를 붙잡지 않는다 — 캐시에 있으면 바로 돌려주고, 없으면 응답을 보낸 뒤(shutdown) 받아 두고 이 페이지는 익명으로 둔다.
 * 회원 번호는 한줄로 서버가 이 몰의 고정 식별자로 만든 값(external_id)을 그대로 쓴다.
 *
 * @param int $user_id 워드프레스 회원 번호.
 * @return array|null { id: string, token: string } 또는 null.
 */
function hanjullo_member_identity( $user_id ) {
	$user_id = (int) $user_id;
	$key     = trim( (string) get_option( HANJULLO_OPTION_PLUGIN_KEY, '' ) );
	if ( $user_id <= 0 || '' === $key ) {
		return null;
	}
	$cache_key = 'hanjullo_mi_' . md5( $user_id . '|' . $key . '|' . hanjullo_site_host() );
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) && ! empty( $cached['id'] ) && ! empty( $cached['token'] ) ) {
		return $cached;
	}
	hanjullo_schedule_identity_fetch( $user_id, $key, $cache_key );
	return null;
}

/**
 * 응답을 보낸 뒤 토큰을 받아 캐시에 둔다(한 요청에 한 번 · 실패하면 5분 동안 다시 묻지 않는다).
 *
 * @param int    $user_id   워드프레스 회원 번호.
 * @param string $key       플러그인 키.
 * @param string $cache_key 캐시 키.
 */
function hanjullo_schedule_identity_fetch( $user_id, $key, $cache_key ) {
	static $scheduled = false;
	if ( $scheduled || get_transient( $cache_key . '_wait' ) ) {
		return;
	}
	$scheduled = true;
	set_transient( $cache_key . '_wait', 1, 5 * MINUTE_IN_SECONDS );
	add_action(
		'shutdown',
		function () use ( $user_id, $key, $cache_key ) {
			if ( function_exists( 'fastcgi_finish_request' ) ) {
				fastcgi_finish_request();
			}
			$res = wp_remote_post(
				HANJULLO_API_BASE . '/plugin/member-token',
				array(
					'timeout' => 5,
					'headers' => array(
						'Content-Type'          => 'application/json',
						'X-Hanjullo-Plugin-Key' => $key,
					),
					'body'    => wp_json_encode( array( 'host' => hanjullo_site_host(), 'user_id' => (string) $user_id, 'ttl_seconds' => 3600 ) ),
				)
			);
			if ( is_wp_error( $res ) || 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
				return;
			}
			$body = json_decode( (string) wp_remote_retrieve_body( $res ), true );
			if ( is_array( $body ) && ! empty( $body['member_token'] ) && ! empty( $body['external_id'] ) ) {
				set_transient( $cache_key, array( 'id' => (string) $body['external_id'], 'token' => (string) $body['member_token'] ), 50 * MINUTE_IN_SECONDS );
				delete_transient( $cache_key . '_wait' );
			}
		},
		99
	);
}

add_action( 'wp_footer', function () {
	if ( is_admin() || ! is_user_logged_in() ) {
		return;
	}
	if ( '' === trim( (string) get_option( HANJULLO_OPTION_SDK_KEY, '' ) ) ) {
		return;
	}
	$who = hanjullo_member_identity( get_current_user_id() );
	if ( null === $who ) {
		return;   // 토큰을 받는 중(다음 페이지부터 식별) · 키 없음 = 익명 수집
	}
	// 1.0.3: 회원 번호 + 토큰만 보낸다(한줄로는 브라우저가 보낸 이메일 · 전화 · 이름을 쓰지 않는다 · 페이지에 개인정보를 싣지 않는다).
	// SDK 는 비동기 로드라 준비될 때까지 짧게 기다린다(최대 40회 × 250ms). 값은 JSON 이스케이프 · 스크립트 문맥 안전.
	echo '<script>(function(){var d=' . wp_json_encode( $who, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ) . ',n=0;function go(){if(window.hjl&&window.hjl.identify){try{window.hjl.identify(d.id,{member_token:d.token});}catch(e){}return;}if(n++<40){setTimeout(go,250);}}go();})();</script>' . "\n";
}, 99 );

// ─────────────────────────────────────────────────────────────
// 설정 화면 — WooCommerce 메뉴 → 한줄로
// ─────────────────────────────────────────────────────────────

add_action( 'admin_init', function () {
	register_setting( 'hanjullo', HANJULLO_OPTION_SDK_KEY, array( 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field', 'default' => '' ) );
	register_setting( 'hanjullo', HANJULLO_OPTION_CONSENT_KEYS, array( 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field', 'default' => HANJULLO_DEFAULT_CONSENT_KEYS ) );
	// 플러그인 키 칸은 저장된 값을 화면에 다시 그리지 않는다 — 빈 칸으로 저장하면 기존 값을 그대로 둔다(지우려면 '-' 입력).
	register_setting(
		'hanjullo',
		HANJULLO_OPTION_PLUGIN_KEY,
		array(
			'type'              => 'string',
			'default'           => '',
			'sanitize_callback' => function ( $value ) {
				$value = trim( (string) $value );
				if ( '-' === $value ) {
					return '';
				}
				if ( '' === $value || 0 !== strpos( $value, 'pk_v1.' ) ) {
					return (string) get_option( HANJULLO_OPTION_PLUGIN_KEY, '' );
				}
				return sanitize_text_field( $value );
			},
		)
	);
} );

add_action( 'admin_menu', function () {
	add_submenu_page( 'woocommerce', '한줄로 연동', '한줄로', 'manage_woocommerce', 'hanjullo', 'hanjullo_render_settings_page' );
} );

/**
 * 한줄로 웹훅(delivery_url 이 hanjul.ai)이 몇 개 있는지 — "연결됨" 판정 근거는 우리 서버가 만든 웹훅의 실존이다.
 *
 * @return int
 */
function hanjullo_count_webhooks() {
	if ( ! function_exists( 'wc_get_webhook_statuses' ) || ! class_exists( 'WC_Data_Store' ) ) {
		return 0;
	}
	try {
		$store = WC_Data_Store::load( 'webhook' );
		$ids   = $store->search_webhooks( array( 'status' => 'active', 'limit' => 100 ) );
	} catch ( Exception $e ) {
		return 0;
	}
	$n = 0;
	foreach ( (array) $ids as $id ) {
		$wh = wc_get_webhook( (int) $id );
		if ( $wh && false !== strpos( (string) $wh->get_delivery_url(), 'hanjul.ai' ) ) {
			$n++;
		}
	}
	return $n;
}

/**
 * 설정 화면 출력.
 */
function hanjullo_render_settings_page() {
	if ( ! current_user_can( 'manage_woocommerce' ) ) {
		return;
	}
	$webhooks = hanjullo_count_webhooks();
	$keys     = implode( ', ', hanjullo_consent_keys() );
	?>
	<div class="wrap">
		<h1>한줄로 연동</h1>
		<h2 class="title">1. 주문·회원 동기화</h2>
		<?php if ( $webhooks > 0 ) : ?>
			<p><strong>연결됨</strong> · 한줄로 웹훅 <?php echo esc_html( (string) $webhooks ); ?>개가 활성입니다. 새 주문·회원 변경이 실시간으로 전달됩니다.</p>
		<?php else : ?>
			<p><strong>아직 연결 전</strong> · 한줄로 관리 → 자사몰 연동 → 우커머스 → <em>관리자 승인으로 연결</em>을 누르면 이 몰의 승인 화면이 열립니다. 승인하면 웹훅과 API 키가 자동으로 만들어집니다.</p>
			<p><a class="button button-primary" href="<?php echo esc_url( 'https://hanjul.ai/' ); ?>" target="_blank" rel="noopener">한줄로 관리 열기</a></p>
		<?php endif; ?>

		<form method="post" action="options.php">
			<?php settings_fields( 'hanjullo' ); ?>
			<h2 class="title">2. 방문·장바구니 수집(선택)</h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="hanjullo_sdk_key">한줄로 SDK 공개키</label></th>
					<td>
						<input type="text" class="regular-text" id="hanjullo_sdk_key" name="<?php echo esc_attr( HANJULLO_OPTION_SDK_KEY ); ?>" value="<?php echo esc_attr( get_option( HANJULLO_OPTION_SDK_KEY, '' ) ); ?>" placeholder="hjl_ 로 시작하는 공개키">
						<p class="description">한줄로 관리 → 자사몰 연동 → CDP 키에서 발급한 <strong>공개키</strong>입니다(몰 HTML 에 그대로 실리는 값 · 비밀 아님). 넣으면 모든 페이지 head 에 수집 스크립트가 들어가고, 로그인 회원은 자동으로 식별됩니다.</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="hanjullo_plugin_key">한줄로 플러그인 키</label></th>
					<td>
						<input type="password" class="regular-text" id="hanjullo_plugin_key" name="<?php echo esc_attr( HANJULLO_OPTION_PLUGIN_KEY ); ?>" value="" autocomplete="new-password" placeholder="<?php echo esc_attr( '' !== (string) get_option( HANJULLO_OPTION_PLUGIN_KEY, '' ) ? '저장됨 · 바꿀 때만 입력' : 'pk_v1. 로 시작하는 키' ); ?>">
						<p class="description">로그인 회원을 한줄로 고객과 잇는 데 씁니다. 한줄로 관리 → 자사몰 연동 → 우커머스 → 이 몰 줄의 <strong>플러그인 키 복사</strong>로 받습니다. 이 몰 회원의 토큰을 받는 일만 할 수 있는 키이고, 이 서버 설정에만 저장되며 페이지에는 실리지 않습니다. 없으면 방문·장바구니는 익명으로만 수집됩니다. 지우려면 <code>-</code> 를 입력하고 저장하세요.</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="hanjullo_consent_keys">마케팅 수신동의 메타키</label></th>
					<td>
						<input type="text" class="regular-text" id="hanjullo_consent_keys" name="<?php echo esc_attr( HANJULLO_OPTION_CONSENT_KEYS ); ?>" value="<?php echo esc_attr( get_option( HANJULLO_OPTION_CONSENT_KEYS, HANJULLO_DEFAULT_CONSENT_KEYS ) ); ?>">
						<p class="description">회원·주문에 저장되는 수신동의 필드의 메타키(콤마 구분). 기본값은 코드엠샵 회원가입 폼의 문자·이메일 동의 필드입니다. 현재 적용: <code><?php echo esc_html( $keys ); ?></code></p>
					</td>
				</tr>
			</table>
			<?php submit_button( '저장' ); ?>
		</form>
		<p class="description">플러그인 버전 <?php echo esc_html( HANJULLO_WC_VERSION ); ?> · 문의: 한줄로 담당자</p>
	</div>
	<?php
}
