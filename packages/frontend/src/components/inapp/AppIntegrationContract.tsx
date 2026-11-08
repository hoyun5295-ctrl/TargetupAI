/**
 * ★ 2026-07-17 인앱 메시지 앱(네이티브) 통합 계약 — 단일 소스.
 * 소비처: CdpSettingsPage(자사몰 연동 앱 탭 — 개발자 관점) + InAppMessagesPage(편집기 앱 채널 — 마케터 관점).
 * 배경(Harold 지시): 고객사는 자기 네이티브 앱을 우리가 못 고친다. 인앱을 제대로 쓰려면
 * "앱이 무엇을 구현해야 하는지"를 계약으로 명확히 제시해야 한다. 항목·필드명은 전부 실제
 * 서빙 응답(inapp-message.ts mapRowToMessageDetail)과 SDK 트래킹 페이로드에서 가져온 실측값 —
 * 여기 항목을 바꾸면 서버 계약과 함께 바꿔야 한다(드리프트 금지).
 * 함정 목록은 팝폰 앱에서 실제 발생한 사고 기반(세션 영속·그라데이션 크래시·정렬 미소비).
 */
import { X, Smartphone, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';
// ★ 2026-11-05 계약 v4 — 판 낱말 · 깔끔 규칙 값 = 그리는 부품 상수(SDK 원본의 글자 같은 사본 · 계약 시험 CT-IA1 · CT-IA4)
import { POSTER_FRAME_RULES as RULES } from './generated/poster-frame';
// ★ C116-B D5 옛 연동 앱 그림 규칙 = 서버 규격과 같은 상수(손 글 숫자 0 · 계약 시험이 서버 ASPECT_RATIOS.inapp 과 대조)
import { LEGACY_BAKE_SAFE } from './legacy-app-view';
const LEGACY_PCT = Math.round(LEGACY_BAKE_SAFE.w * 100);

/** 앱이 /inapp/active?caps= 로 알리는 낱말(서버 INAPP_CLIENT_CAPS · SDK INAPP_SDK_CAPS 와 같은 값) */
export const APP_CONTRACT_CAPS = ['poster_baked', 'frame_card', 'strip_coupon', 'strip_countdown'] as const;

export interface ContractItem {
  title: string;
  desc: string;
  code?: string;
}

export interface ContractSection {
  key: string;
  heading: string;
  items: ContractItem[];
}

export const APP_INAPP_CONTRACT_SECTIONS: ContractSection[] = [
  {
    // ★ 2026-11-08 C114 계약 v5 — 웹뷰 호스트(설계서 docs/2026-11-08-c114-roadmap-v2-design.md §3 I-1 · Harold 「업체 앱에 판을 올리라고 할 수 없다」)
    key: 'webview',
    heading: '0. 웹뷰로 붙이기 (권장, 계약 v5, 한 번 붙이면 모양이 늘어도 앱을 다시 고치지 않습니다)',
    items: [
      {
        title: '조회 = caps=webview 하나',
        desc: '아래 1번 조회 주소에 caps=webview 를 붙입니다. 서버는 이 앱을 웹 SDK 와 같은 판으로 보고 모든 모양(통짜, 카드, 쿠폰 띠, 남은 시간, 여러 장)을 그대로 보냅니다. 빈도(얼마나 자주 보일지) 판단은 지금처럼 앱이 합니다.',
        code: `GET https://app.hanjul.ai/api/cdp/inapp/active?channel=app&anonymous_id=DEVICE_UUID&caps=webview`,
      },
      {
        title: '그리기 = 투명 전체 화면 웹뷰 한 장',
        desc: '보일 메시지를 고르면 투명한 전체 화면 웹뷰로 아래 페이지를 열고 그 메시지를 넣습니다. 웹뷰는 준비하는 동안에도 실제 크기 그대로 두고 투명(opacity 0)으로만 가립니다(크기 0, 숨김, 화면 밖 배치 금지 = 그림이 안 들어옵니다). ready 사건이 오면 보이고 그때 impression 을 한 번 기록합니다. failed 가 오면 보이지 않고 닫습니다(기록 0).',
        code: `페이지: https://app.hanjul.ai/api/cdp/inapp/webview
넣는 값: { "message": <조회 응답 messages 의 한 개>, "serverNow": <조회 응답 serverNow>, "customer": <있으면> }
React Native: injectedJavaScriptBeforeContentLoaded = "window.__HJL_INAPP__ = " + JSON.stringify(값) + "; true;"
iOS, 안드로이드: 페이지 로드 뒤 evaluateJavaScript("HanjulInApp.render(" + JSON 문자열 + ")")`,
      },
      {
        title: '다리 사건 = 앱이 받아 처리',
        desc: '페이지는 API 를 부르지 않습니다. 기록, 이동, 닫기, 복사는 모두 아래 사건으로 앱에 넘어옵니다. track 사건은 그대로 /inapp/track 에 보냅니다(event = event_type, buttonId = button_id). navigate 는 앱의 지금 이동 규칙(앱 안 경로, 딥링크, 외부 브라우저)으로 엽니다.',
        code: `ready { messageId }                 → 웹뷰를 보이고 impression 기록
failed { messageId }                → 보이지 않고 닫기
track { messageId, event, buttonId } → /inapp/track (click, dismiss, opt_out)
navigate { url }                    → 앱 이동 규칙으로 열기
optout, snooze { messageId }        → 앱 저장소에 다시 보지 않기, 오늘 하루 보지 않기
copy { messageId, text }            → 클립보드에 복사
close { messageId }                 → 웹뷰 닫기
받는 이름: React Native = onMessage(JSON 문자열), iOS = webkit.messageHandlers.hanjulInApp, 안드로이드 = addJavascriptInterface(…, "HanjulInAppAndroid")`,
      },
    ],
  },
  {
    key: 'fetch',
    heading: '1. 메시지 조회',
    items: [
      {
        title: '활성 메시지 조회 (공개키 + 앱 번들ID 등록 선행)',
        desc: '앱 실행(홈 진입) 시 조회해 응답의 messages 배열을 그립니다. 번들ID는 자사몰 연동 → 앱 탭에서 등록합니다.',
        code: `GET https://app.hanjul.ai/api/cdp/inapp/active?channel=app&anonymous_id=DEVICE_UUID
Header: X-Hanjullo-Key: hjl_...
(로그인 회원은 &external_id=회원ID 동봉, 개인화 변수 치환용 customer 동봉됨)`,
      },
      {
        // ★ 2026-11-05 계약 v4 — 서빙 관문(설계서 docs/2026-11-05-inapp-poster-function-redesign-design.md §3-2)
        title: '그릴 수 있는 것 알리기 (caps · 계약 v4)',
        // ★ 2026-11-08 C116-B D5 = 서버 동작 그대로(설계서 docs/2026-11-08-c116b-inapp-universal-output-design.md · 계약 시험 VB9)
        desc: `아래 v4 모양을 네이티브로 직접 구현한 앱은 조회 주소에 caps 를 붙입니다(웹뷰로 붙인 앱은 0번 caps=webview 하나면 됩니다). caps 가 없는 앱(구버전)도 앱을 고치지 않고 모든 모양을 받습니다: 떠 있는 카드 · 통짜 포스터 · 쿠폰 코드 띠 · 남은 시간 띠 · 여러 장을 서버가 완성된 정사각 그림으로 구워 장마다 image_url 에(한 장 · 장 없는 메시지는 imageUrl 에도) 넣고, 글 칸(title · body · badgeText · 장 글)은 비워 보냅니다. 장 버튼(cta) · 그림 링크(link_url) · 메시지 버튼은 그대로 오니 앱 버튼으로 그리세요. 그림 안 내용은 가운데 ${LEGACY_PCT}% × ${LEGACY_PCT}% 안에 있고 남는 자리는 디자인 바탕색입니다. 그래서 그림을 원본 비율이나 contain 으로 그리면 통째로 보이고, 가운데 맞춤 cover(각 플랫폼 기본값)로 그려도 칸의 가로:세로가 5:4 ~ 4:5 안이면 내용이 잘리지 않습니다. 굽기 전이거나 굽지 않는 메시지(개인화 글 등)는 같은 정사각 규칙으로 맞춘 사진과 글 칸이 옵니다(쿠폰 코드 · 마감 시각은 본문 한 줄 · 지금처럼 글을 얹어 그리세요). 우리 서버가 아닌 바깥 주소 그림은 원본 그대로 옵니다. 그림 규칙이 바뀌면 주소(fr)가 달라지니 주소 단위로 캐시하세요. 이벤트 카드 · 배너 시트는 아래 레이아웃 규칙 그대로입니다. 구현한 낱말만 넣으세요(${APP_CONTRACT_CAPS.join(' · ')}). 응답의 serverNow(서버 시각 · ISO)는 남은 시간 띠의 기준 시각입니다.`,
        code: `GET .../api/cdp/inapp/active?channel=app&anonymous_id=DEVICE_UUID&caps=${APP_CONTRACT_CAPS.join(',')}`,
      },
    ],
  },
  {
    key: 'render',
    heading: '2. 그려야 하는 필드 (앱 채널 보장 계약)',
    items: [
      {
        title: '텍스트·이미지·버튼',
        desc: 'title(제목) · body(본문) · imageUrl(이미지, 없으면 생략) · badgeText(배지) · buttons({id, label, action_url, background_color, text_color} 배열: 3개까지만 그리고 색 필드를 반드시 소비하세요. 웹 SDK도 3개까지만 렌더합니다). 앱 채널은 서버가 블록 콘텐츠를 이 평면 필드로 합성해 보장합니다.',
      },
      {
        // ★ 2026-07-18 포스터형 v2 — 앱 채널 계약 (웹 renderPoster와 동일 규격)
        title: '포스터형 (template = "full_image")',
        desc: '가로 꽉 찬 하단 시트입니다. 좌우 마진 0, 상단 모서리만 라운드, 카드 바닥 흰색 고정. imageUrl 필수(원본 비율 유지), 제목/본문/배지는 이미지 하단 어두운 그라데이션 위 오버레이(본문은 잘림 없이 전 줄). 스타일 필드: design.poster_title_color/poster_body_color(제목·본문 색, 폴백 poster_text_color→흰색) · design.poster_title_size(14~32, 기본 20)/poster_body_size(10~22, 기본 14) · 제목 서체 = design.font_display(로드 불가 환경은 기본 서체). 흰 바닥에 buttons[0] 1개만(배경/글자색 소비) + "다시 보지 않기·닫기". 이 값을 모르는 구버전 앱은 기본형(바텀 시트)으로 안전 표시하면 됩니다.',
      },
      {
        // ★ 2026-07-21 포스터형 캐러셀 — 좌우 스와이프(스타벅스형). posterSlides가 있으면 여러 장을 넘겨봅니다.
        title: '포스터형 캐러셀 (posterSlides 배열, 2장 이상)',
        desc: 'posterSlides 배열이 오면(2장 이상) 포스터를 한 장이 아니라 좌우로 스와이프하는 카드로 그립니다. 각 슬라이드 = { image_url(필수), title, body, cta:{label, action_url, background_color, text_color}, title_color/body_color(hex), title_size(14~32)/body_size(10~22) }. 각 장은 자기 이미지(cover, 슬라이드 높이 통일)·오버레이 문구·CTA 1개를 가지며, 하단 CTA는 현재 보이는 슬라이드의 cta로 바뀝니다. 하단 점(1/N) 인디케이터 + "다시 보지 않기"는 공용. 슬라이드별 색·크기 미지정 시 design.poster_* 폴백. posterSlides[0]은 flat 필드(imageUrl/title/body/buttons[0])와 동일하므로, 캐러셀을 모르는 구버전 앱은 자동으로 "첫 장"만 단일 포스터로 안전 표시합니다.',
      },
      {
        // ★ 2026-07-31 이미지 클릭 랜딩 — 이미지 자체가 링크(선택)
        title: '이미지 클릭 랜딩 (imageLinkUrl · 슬라이드 link_url)',
        desc: '메시지에 imageLinkUrl이 오면(선택) 이미지 자체를 눌렀을 때 그 주소로 이동합니다. 버튼과 동일 계약(트래킹 → 이번 세션 재표시 억제 → 시트 닫기 → 이동). 트래킹 button_id = "image". 캐러셀은 슬라이드별 link_url(선택)을 쓰고 button_id = "slide_{index}_image"(0부터)로 보냅니다. 링크가 없으면 지금처럼 아무 동작 없음. 이 필드를 모르는 구버전 앱도 그대로 무동작이라 안전합니다. http/https만 오며(서버 무해화), 상대경로·커스텀 스킴은 오지 않습니다.',
      },
      {
        // ★ 2026-09-29 계약 v3 — 인앱 만들기 개편(설계서 docs/2026-09-29-inapp-editor-redesign-design.md §1)
        title: '포스터 새 레이아웃 (design.poster_layout = "event_card" | "banner_sheet")',
        desc: 'full_image 메시지의 design.poster_layout 이 오면 레이아웃대로 그립니다. 새 레이아웃은 posterSlides 가 1장이어도 레이아웃으로 그립니다(좌우 넘기기는 2장부터). event_card = 위 글 칸(바탕 = slide.bg_color · eyebrow 작은 라벨 · title · body) + 아래 사진(그림 원본 비율 · 들어오기 전 4:3 자리 · image_fit, 기본 contain = 잘림 0 · ★1108) + 여러 장이면 오른쪽 아래 "N / M" 쪽 번호. banner_sheet = 면 색(bg_color) · 좌상단 탭 칩(eyebrow) · 우상단 X · 왼쪽 글(subtitle 윗줄 · title 큰 제목 · body 아랫줄 · cta 알약 버튼) · 오른쪽 사진(image_fit, 기본 contain · 아래 정렬). 바닥은 두 레이아웃 모두 글자 버튼 둘(왼쪽 = 닫기 방식 라벨 · 오른쪽 "닫기"). 장 전체(글 + 사진)가 좌우로 넘어갑니다. 슬라이드 새 키: eyebrow · subtitle · bg_color(hex) · image_fit("cover"|"contain"). 값이 빠지면 기본값: event_card 바탕 #f7f1e3 · 제목 #8a3b1f(26) · 본문 #57534e(14) / banner_sheet 면 #db2777 · 제목 #fde047(26) · 본문 #ffffff(19). 사진 누름 = link_url(event_card 는 없으면 cta.action_url), 트래킹 button_id = "slide_{index}_image". poster_layout 이 없거나 모르는 값이면 지금 포스터(overlay)로 그리세요. 이 값을 모르는 구버전 앱은 같은 내용을 지금 포스터 모양으로 안전하게 보여 줍니다(flat 필드 = 첫 장).',
      },
      {
        // ★ 2026-11-05 계약 v4
        title: '통짜 포스터 (design.poster_text = "baked" · caps poster_baked)',
        desc: `글이 그림에 구워진 포스터입니다. 서버가 글 칸을 비워 보냅니다(title · body = 빈 값 · badgeText = null · 장마다 title · body · eyebrow · subtitle 없음). 글을 그리지 말고 그림만 원본 비율 그대로(자름 0 · contain) 그리세요. 그림 대체 글(접근성) = slide.alt. 여러 장이면 ${RULES.multiAspect === 0.75 ? '3:4' : RULES.multiAspect} 상자에 contain(남는 자리 = slide.bg_color 또는 ${RULES.multiFill}). 장 버튼(cta)은 그림 아래 흰 칸에 가로 꽉 찬 ${RULES.ctaHeight}px 버튼으로(그림 위에 얹지 않음).`,
      },
      {
        title: '떠 있는 카드 (design.poster_frame = "card" · caps frame_card)',
        desc: `화면 가운데 카드입니다. 좌우 여백 ${RULES.card.sideMargin}px · 태블릿 · 큰 화면 최대 ${RULES.card.maxWidth}px · 네 모서리 ${RULES.card.radius}. 닫기 줄은 카드 위 어둠 위 한 줄(높이 ${RULES.card.closeRowHeight}px · 왼쪽 「오늘 하루 보지 않기」(dismiss_mode 라벨 규칙 그대로) 흰 글 · 오른쪽 X · 누름 자리 ${RULES.closeHit}px). 바닥 시트(지금 틀)는 최대 ${RULES.sheet.maxWidth}px · 위 모서리 ${RULES.sheet.radius.split(' ')[0]} · 바닥 줄 ${RULES.sheet.footHeight}px. 두 틀 모두 그림 + 띠 + 버튼 + 닫기 줄 전체 높이가 화면의 ${Math.round(RULES.maxHeightRatio * 100)}% 를 넘으면 폭을 줄여 비율을 지킵니다. 쪽 번호(N / M)는 그림 안 오른쪽 아래 ${RULES.pagerInset}px 알약 하나만(그림 위 다른 요소 0).`,
      },
      {
        title: '기능 띠 · 쿠폰 코드 복사 (design.poster_strip.type = "coupon" · caps strip_coupon)',
        desc: `그림과 버튼 사이 ${RULES.stripHeight}px 한 줄: 왼쪽 poster_strip.label(없으면 「쿠폰 코드」) · 코드(poster_strip.code · 강조색) · 오른쪽 [복사]. 누르면 클립보드에 코드를 넣고 버튼 글을 2초 동안 「복사했어요」로 바꿉니다. 메시지는 닫지 않습니다. 트래킹 = event_type 'click' + button_id 'copy_code'. 강조색 = accentColor 하나(없으면 ${RULES.defaultAccent} · 띠 · 버튼 공통).`,
      },
      {
        title: '기능 띠 · 남은 시간 (design.poster_strip.type = "countdown" · caps strip_countdown)',
        desc: `같은 자리 한 줄: 왼쪽 label(없으면 「마감까지」) · 오른쪽 남은 시간 「N일 HH:MM:SS」 또는 「HH:MM:SS」. 마감 = 메시지 endAt. 1초마다 (endAt − 서버 시각)으로 다시 셉니다(서버 시각 = 응답 serverNow 를 받은 순간의 차이로 기기 시계를 보정). 0 이하 = 「마감됐어요」. 화면에서 사라지면 시계를 멈춥니다. 트래킹 없음.`,
      },
      {
        title: '장마다 라벨 (poster slides eyebrow · overlay 포스터)',
        desc: '지금 포스터(overlay) 캐러셀도 slide.eyebrow 가 있으면 그 장의 배지 자리에 그 값을 보여 주고, 없으면 메시지 badgeText 를 씁니다. badgeText 는 모든 장 라벨이 같을 때만 값이 오고 다르면 빈 값입니다(장마다 다른 라벨을 한 장의 값으로 퍼뜨리지 않게).',
      },
      {
        title: '캐러셀 클릭 트래킹 + 그라데이션(네이티브 주의)',
        desc: '슬라이드 CTA 클릭은 button_id = "slide_{index}"(0부터)로 트래킹을 보내면 슬라이드별 성과가 집계됩니다. 스크림(이미지 하단 어두운 그라데이션)은 반투명 View를 여러 장 쌓지 말고 단일 요소(LinearGradient 또는 코드 내장 base64 PNG 알파 램프 1장을 늘려서)로 그리세요. 반투명 뷰 쌓기는 Android에서 이음새마다 가로줄이 생깁니다(실사고). 좌우 스와이프는 RN 기본 가로 페이징(FlatList/ScrollView pagingEnabled)으로 충분해 네이티브 모듈 추가가 필요 없습니다(OTA 가능).',
      },
      {
        title: '색상: 단색 hex만 옵니다',
        desc: 'backgroundColor · textColor는 앱 채널 응답에서 단색 hex(#RGB~#RRGGBBAA, 3~8자리)로 보정돼 옵니다(그라데이션 문자열 없음). 그래도 색 파싱 실패 시 앱이 죽지 않게 기본색 폴백을 두세요.',
      },
      {
        title: '텍스트 정렬',
        desc: "design.text_align('left' | 'center' | 'right')을 제목·본문 정렬에 적용하세요. 미지정 = 왼쪽. 이 필드를 소비하지 않으면 편집기의 정렬 설정이 앱에서 무시됩니다.",
      },
      {
        // ★ 2026-07-18 정정2 — 앱 = 기본형 2위치 + 포스터형
        title: '표시 형태',
        desc: "template: 앱 채널은 'center_modal'(기본형·중앙 모달) · 'bottom_banner'(기본형·바텀 시트) · 'full_image'(포스터형·전면 이미지) 3값을 받습니다. 모르는 값이 와도 기본형(바텀 시트)으로 폴백하세요.",
      },
    ],
  },
  {
    key: 'behavior',
    heading: '3. 동작 계약 (닫기·빈도·다시 보지 않기)',
    items: [
      {
        title: '닫기(X) = 이번 세션만',
        desc: '닫기는 이번 앱 실행 동안만 억제하고, 다음 실행에는 displayFrequency 규칙대로 다시 표시합니다. 닫기 상태를 영구 저장소에 쓰면 안 됩니다.',
      },
      {
        title: '"다시 보지 않기" = 영구 (opt_out)',
        desc: "명시 거부 버튼을 제공하는 경우에만 영구 억제합니다. event_type 'opt_out'으로 트래킹을 보내면 서버가 기록하고 이후 조회 응답에서 제외됩니다.",
      },
      {
        // ★ 2026-09-29 계약 v3
        title: '"오늘 하루 보지 않기" = 24시간 (design.dismiss_mode = "snooze_day")',
        desc: "design.dismiss_mode 가 'snooze_day' 이면 명시 거부 버튼 자리에 「오늘 하루 보지 않기」를 그리고, 누르면 event_type 'dismiss' + button_id 'snooze_day' 로 트래킹을 보낸 뒤 24시간 동안 표시하지 않습니다(영구 저장소에 만료 시각 기록 · A/B 변형이면 parentMessageId 도 함께). 서버도 같은 기록으로 24시간 동안 응답에서 제외합니다. 라벨은 앱이 직접 그립니다. 이 값을 모르는 구버전 앱은 지금처럼 「다시 보지 않기」(opt_out)로 동작합니다.",
      },
      {
        title: 'displayFrequency 의미',
        desc: "once_per_session = 세션당 1회(앱은 앱 실행 1회, 웹은 브라우저 방문 1회) · once_per_day = 하루 1회 · always = 매번 표시(닫기 전 중복 표시는 금지).",
      },
      {
        title: '버튼 이동',
        // ★ 2026-07-18 정정(Codex D2) — 서버 sanitize 실동작 기준: http/https만 통과, 그 외 스킴은 저장 시 제거
        desc: 'buttons[].action_url(또는 actionUrl)을 엽니다. 서버가 https:// 프로토콜을 보정해 내려주며, http/https URL만 전달됩니다(그 외 스킴은 저장 시 제거).',
      },
      {
        // ★ 2026-07-18 P2 — CTA 자동 연결 규칙: 몰마다 제각각인 앱 내 경로 문제 종결 (0718 팝폰 m/xxx 무반응 실사고 근거)
        title: 'CTA URL 처리 규칙 (웹 URL 기준)',
        desc: 'CTA에는 연동 몰의 웹 URL(https://…)이 옵니다. 앱은 자체 라우팅 규칙으로 앱 내 화면에 매핑하고, 매핑할 수 없으면 반드시 인앱 브라우저(또는 외부 브라우저)로 여세요. 스킴 없는 상대경로를 openURL에 그대로 넘기면 조용히 무반응이 됩니다. 무반응 CTA는 계약 위반입니다.',
      },
    ],
  },
  {
    key: 'track',
    heading: '4. 트래킹 (성과 집계·빈도 판정의 근거)',
    items: [
      {
        title: '표시·클릭·닫기·거부 이벤트 전송',
        desc: 'impression(표시 직후) · click(버튼, button_id 동봉) · dismiss(닫기) · opt_out(다시 보지 않기)을 보냅니다. 이걸 안 보내면 통계가 0으로 잡히고 빈도·거부 판정도 서버에서 못 합니다.',
        code: `POST https://app.hanjul.ai/api/cdp/inapp/track
Header: X-Hanjullo-Key: hjl_...
Body: { "message_id": "...", "event_type": "impression|click|dismiss|opt_out",
        "anonymous_id": "DEVICE_UUID", "external_id": "회원ID(선택)",
        "button_id": "클릭 시", "dwell_seconds": 12 }`,
      },
    ],
  },
  {
    key: 'pitfalls',
    heading: '5. 흔한 함정 (실사고 기반 체크리스트)',
    items: [
      {
        title: '세션 억제를 영구 저장하지 마세요',
        desc: '닫기·세션 표시 이력을 디스크(영구 저장소)에 쓰면 "다시 접속해도 안 뜨는" 결함이 됩니다. 세션 상태는 메모리(앱 실행 단위)에만 두세요.',
      },
      {
        title: '모르는 필드에 죽지 마세요',
        desc: '응답에 새 필드가 추가될 수 있습니다. 모르는 필드는 무시하고, 필수 필드 부재·파싱 실패 시 해당 메시지만 건너뛰세요(앱 크래시 금지).',
      },
      {
        title: '표시 직전 재검증',
        desc: '스플래시/로딩 직후 바로 띄우면 사용자가 못 봅니다. 홈 화면이 상호작용 가능해진 뒤 표시하세요.',
      },
    ],
  },
];

/** 인앱 앱(네이티브) 통합 계약 모달 — CDP 설정·인앱 편집기 공용. ESC/X/확인으로만 닫힘(백드롭 클릭 닫힘 금지 룰). */
export function AppInAppContractModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <Smartphone className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-base font-bold text-slate-900">앱(네이티브) 인앱 메시지 통합 계약</div>
              <div className="text-xs text-slate-500">앱이 이 계약을 구현해야 편집기의 설정이 앱에서 그대로 동작합니다</div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-white" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-4 overflow-y-auto space-y-5">
          {APP_INAPP_CONTRACT_SECTIONS.map((sec) => (
            <div key={sec.key}>
              <div className="text-sm font-bold text-slate-900 mb-2">{sec.heading}</div>
              <div className="space-y-2.5">
                {sec.items.map((it, i) => (
                  <div key={i} className="bg-white border border-slate-200 rounded-xl p-3">
                    <div className="flex items-start gap-2">
                      {sec.key === 'pitfalls'
                        ? <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
                        : <CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 flex-shrink-0" />}
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800">{it.title}</div>
                        <div className="text-xs text-slate-500 leading-relaxed mt-0.5">{it.desc}</div>
                        {it.code && (
                          <pre className="mt-2 bg-slate-100 border border-slate-200 rounded-lg p-2.5 text-[11px] text-cyan-800 overflow-x-auto whitespace-pre">{it.code}</pre>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="px-6 py-3 border-t border-slate-200 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-sm font-semibold text-white">확인</button>
        </div>
      </div>
    </div>
  );
}
