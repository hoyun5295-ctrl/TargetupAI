# 인앱메시지 디자인 3.0 — 다음 세션 준비 설계도 (2026-07-14)

> 다음 세션 SoT. 이 문서는 **사전 실측 기반 준비 설계**다 — 최종 설계는 세션 초입 §2 전수 파악 후 확정해 Harold 컨펌을 받고 구현한다(현황 파악 → 설계 보고 → 컨펌 → 구현).
> 기준 퀄리티 = 모바일 DM 3.0([[project_2026_0713_dm_design_3]]) · 이메일 3.0([[project_2026_0713_email_design_3]], specs/2026-07-13-email-design-3-product-link-design.md).

---

## §0 목표

인앱은 수신자 브라우저에서 우리 SDK가 직접 그리는 채널 — 이메일에서 "이식 불가"로 제외한 축(모션·글래스·스티키류)까지 전부 가능. 현재 수준 = 디자인 2.0~2.1(0707 — 테마 6·card_style 4·블록 13). 목표 = DM/이메일 3.0 동급 아트디렉션 + 인앱만의 모션 2.0 실수혜.

## §1 현황 실측 지도 (2026-07-14 확인분 — 세션 초입에 심화)

| 축 | 실측 |
|---|---|
| 3면 | 에디터 = `frontend/src/pages/InAppMessagesPage.tsx`(3,154줄 — 인라인 편집+미리보기) / SDK 렌더 = `packages/sdk-js/src/inapp.ts`(1,721) + `inapp-blocks.ts`(870, 13블록) + `inapp-theme.ts`(341, 테마 토큰) / 서빙 = `backend/utils/sdk-serve.ts` |
| 서빙 구조 | SDK = 커밋 정적 파일 `company-frontend/public/sdk/{version}/hanjul.min.js` (CORS 서빙·버전 폴백 — 구버전 스니펫도 최신 수신). 메시지 데이터 = `/api/cdp/inapp/active` JSON. **→ 메시지별 디자인 값 = JSON 동승(번들 무증가), 신규 렌더 능력 = SDK 버전 업 필요** |
| DB (cdp_inapp_messages 37컬럼) | 디자인 축 기존재: `template` 8종(top/bottom_banner·center_modal·full_screen·slide_in·inline_card·toast·floating_button) · `theme` 6종(auto/light/dark/brand/vibrant/minimal) · `accent_color` · `card_style` 4종(classic/bubble/ticket/poster — 카드형만) · `animation` 4종(fade/slide/bounce/pulse) · `badge_text` · `content_blocks` jsonb 13블록(media·eyebrow·headline·body·bullets·benefit·countdown·rating·product·divider·spacer·cta_group·footer — 비면 레거시 단색 렌더) |
| 스타일 방식 | JS 인라인 스타일 객체(z-index 2147483647·딤 2147483646). shadow DOM 아님(1차 grep 기준 — §2에서 확정) |
| 최근 강화 이력 | 0712 인앱 일괄 강화(트리거 임계·스킴 화이트리스트·track 소유·presence 원자 병합·variant 상속·dnd·상품 가격 3면 — [[project_2026_0712_inapp_full_reinforcement]]) · SDK v0.3.8/9 |

## §2 세션 초입 전수 파악 체크리스트 (빈틈 방지 — 이것부터 실행)

1. `inapp.ts` 렌더 전 경로 정독 — 애니메이션 구현 방식(keyframes `<style>` 주입 유무·transition만인지), reduced-motion 현황, 몰 CSS 격리 수준(인라인 스타일의 한계 — 몰 전역 `*{}`/`!important` 간섭 실태), 폰트 상속 현황.
2. `inapp-blocks.ts` 13블록 렌더 + `inapp-theme.ts` 토큰 구조(6테마 값) 정독 — 아트디렉션 리터럴을 꽂을 지점 확정.
3. 에디터 미리보기 ↔ SDK 실렌더 미러 수준 확인(3면 대조 — LESSONS_FRONTEND 07-02(4) "캔버스=발행물" 원칙. 미리보기가 별도 구현이면 어긋난 지점 목록화).
4. **영속화 확정**: content_blocks 블록별 스타일 필드 유무 실측 → 기존 컬럼(theme/card_style/animation/accent_color) 확장 + content_blocks 동승으로 **DDL 0**이 되는지, 아트디렉션 세부(타입스케일/밀도/모티프)를 담을 자리가 없으면 `design` jsonb 1컬럼(이메일 3.0 선례 — information_schema 검증 → Harold ALTER → 쓰기 전 컬럼 선확인·무변경 저장 key 생략 규약 재사용) 중 하나로 확정.
5. SDK 버전 업 절차 실측 — 빌드 명령·public/sdk/{version} 산출·버전 상수 위치(0712 v0.3.8/9 갱신 경로 추적) + hanjul.min.js 실크기(번들 증가 예산 설정).
6. `/api/cdp/inapp/active` 응답 shape — 디자인 값 동승 자리·구 SDK 하위호환(새 필드 무시 확인).
7. 인앱 AI 생성(inapp-ai-generator.ts 717줄) — 디자인 추천 꽂을 지점 + 행사 원문(event_text) 경로의 상품(product 블록) 링크·이미지 매핑 현황(이메일 W0과 같은 유실 있는지).

## §3 구현 축 (설계 보고에 담을 범위)

- **A. DM 3.0 직이식**: 테마 프리셋 1클릭(기존 6종을 DM/이메일 8종 큐레이션과 정렬 — id 체계 통일 검토), 아트디렉션(타입스케일/여백 밀도/모티프/디바이더 — 블록 렌더에 리터럴 주입), 서체 실로딩(Google Fonts `<link>` 몰 페이지 주입 — 중복 주입 가드+성능·폰트 미로딩 폴백 스택), 골든 템플릿(template×card_style×시나리오 완성형), 헤드라인 마커/밑줄, 다크 면 리터럴(#171717) 원칙.
- **B. 모션 2.0 (인앱 실수혜)**: 진입 모션(바텀시트 슬라이드업·모달 스케일인·배너 슬라이드다운), CTA 맥동, 쿠폰 샤인, 카운트다운 초침 팝, 블록 스태거. `prefers-reduced-motion` 가드 의무. 기존 animation 4종(fade/slide/bounce/pulse)과 축 합류(중복 정리 — 기존 값 하위호환 유지).
- **C. 인앱 고유**: template 8×card_style 4별 구도(같은 블록도 형태마다 조판 차등), 배경 딤·블러(글래스 — backdrop-filter+미지원 폴백), 오버레이 채널 특성 강화(그림자/보더/면 대비 — 몰 페이지 위라 체감 큼), 이미지 초점(focal).
- **D. 에디터**: 테마 모달(1클릭·문안 무변)·구도/모션 픽커(소비 타입만 — 죽은 컨트롤 금지)·미리보기=SDK 미러 강화(3면 일치).
- **E. AI**: 생성 시 결정적 디자인 추천(임의 상수 X — 큐레이션 매핑) + product 블록 링크·이미지 자동 매핑(§2-7 확인 결과에 따라 — 공용 엔진 validateProductsAgainstEventText/fetchProductOgImages 재사용).

## §4 재사용 자산 소스 맵

| 자산 | 위치 | 재사용 방식 |
|---|---|---|
| 테마 8종 큐레이션 | frontend `dm-themes.ts` / `email-themes.ts` | 인앱판 재큐레이션(팔레트·아트디렉션 동일, 채널 제약만 반영) |
| 타입스케일/밀도 리터럴 | backend `dm/dm-art-direction.ts` TYPE_SCALE_VARS·DENSITY | SDK 렌더 리터럴 미러(SSOT 주석 동반) |
| 골든 템플릿 방법론 | `dm-template-registry.ts` buildStyledSections / `email-templates.ts` | 블록 배열+스타일 패치+테마 동승 |
| 구도 허용표 fail-closed | 이메일 `EMAIL_TREATMENTS`(email-blocks) | `INAPP_TREATMENTS` 단일 진실 + 미허용=classic |
| 헤드라인 마커 | DM `emphasizeHead` / 이메일 인라인판 | 블록 렌더 span |
| design 저장 규약 | 이메일 3.0 (Codex 4R 교훈) | 값 있음/명시 초기화(null)/무변경(key 생략) 3태 + 쓰기 전 컬럼 선확인(신규 컬럼일 때만) |
| 상품 링크·이미지 엔진 | `event-brief.ts` + `dm-brand-extractor.fetchProductOgImages`(연결 고정+바이트 상한) | product 블록 자동 매핑 |
| 골든 보존 | DM/이메일 공통 | 미설정 = 기존 렌더 동일 — 테스트로 고정(기존 발행 메시지 회귀 0) |

## §5 안전 원칙 (과거 교훈 — 위반 시 사고 재발)

- **3면 대조 의무**: 입력 패널 / 에디터 미리보기 / SDK 실렌더 — 미리보기 상수 목업 금지(카운트다운은 실계산 — 07-07(3) 사고), 속성별 소비처가 형태(template)마다 실재하는지 확인(07-10 교훈).
- **기존 발행물 회귀 0**: theme/card_style/디자인 미설정 = 현행 렌더 그대로(레거시 단색 렌더 경로 포함). 운영 몰에 SDK가 즉시 영향 = 버전 업 후 팝폰 베드 검증 전 릴리즈 금지.
- **디자인만 만진다**: trigger/eligibility/스킴 화이트리스트/track 등 0712 강화분은 무접촉. action_url 검증 유지.
- **모델명·로드맵 노출 금지 / native dialog 금지 / AI 임의 혜택 금지** — 상시 grep.
- SDK는 순수 브라우저 코드 — backend import 금지, 테스트는 sdk-js 기존 스위트(inapp-blocks/guards/enhancements) 확장.

## §6 검증·실측 계획

- sdk-js vitest(블록/테마/모션 가드) + BE/FE tsc 0 + backend vitest + 금지 패턴 grep 0.
- Codex 적대 리뷰(SDK = 운영 몰 직결이라 의무) — 지적은 재현/반증 후 판정.
- 실측(직원·Harold): 팝폰(자체 SDK 베드 — C:\Users\ceo\projects\poppon-workspace) 실접속으로 형태 8종×테마 전환·모바일·reduced-motion·구버전 스니펫 폴백. 이새 등 실몰은 릴리즈 후.

## §7 다음 세션 진입 명령어 (Harold 붙여넣기용)

```
인앱메시지 디자인 3.0 업그레이드 진행해줘. status/STATUS.md 다음 세션 ⓪-B 항목이 SoT고,
specs/2026-07-14-inapp-design-3-prep.md가 준비 설계도야.
모바일 DM 3.0(memory/project_2026_0713_dm_design_3.md)·이메일 3.0(memory/project_2026_0713_email_design_3.md)과
동급 퀄리티로 인앱 에디터·SDK 렌더러를 업그레이드해줘 — 테마 프리셋·아트디렉션·서체 실로딩·골든 템플릿·
헤드라인 마커(공통 자산) + 인앱 고유: 모션 2.0(진입 모션·CTA 맥동·쿠폰 샤인·스태거, reduced-motion 가드)·
template×card_style별 구도·배경 딤/블러. AI 생성 디자인 추천과 product 블록 상품 링크·이미지 자동 매핑
(공용 엔진 재사용)도 포함해.
준비 설계도 §2 전수 파악 체크리스트(SDK 렌더·에디터·미리보기 3면 + CSS 격리/번들 버전 절차/영속화 DDL 0 여부 확정)부터
실행하고 → 설계 보고 → 내 컨펌 후 구현. 기존 발행 메시지 회귀 0(미설정=현행 렌더) 지켜.
```
