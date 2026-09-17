# SNS 게시 설계서 · 착수 원장 (2026-09-17)

> **이 문서가 소유하는 것** = "SNS 게시"(고객사가 자기 SNS 계정을 연결하고 사진·영상을 올려 AI가 캡션·태그를 채우면 채널을 골라 게시·예약하는 기능)의 설계안 · 불변 원칙 · 계약 · 예정 DDL · 1차/2차 단계 · 실측 게이트 · 미검증 목록 · 회의록. 구현 종결 뒤 기능 상설 문서 `FEATURE-SNS-PUBLISH.md`를 만들고 이 문서는 시점 근거로 남긴다.
> **발동** = Harold "SNS 자동화 기능 · 재료 넣고 AI 제작 누르면 채널별 규격 맞춰 자동 업로드" → "대행사에 SNS 바이럴까지 맡기는 회사가 많다 · 크레딧으로 고가 요금제 유도" → "당장은 한줄로 자사 SNS 활동(피드부터) · 영상은 밖에서 만들어 올린다 · 외부 영상 도구 API 연동 0 · 태그 자동 부여 + AI 살짝" → **"처음부터 고객사가 자사몰 연동처럼 자기 계정을 연결하는 구조 · 브레인스토밍 전원합의체 · 명칭부터 1·2차 설계 · 회의 뒤 설계서까지"**.
> **회의** = 2026-09-17 전원합의체(기획·백엔드·프론트엔드·디자이너·회의론자 · 읽기 전용) 1차 의견 → 교차 토론 1라운드 → 회의론자 최종 검증(9개 정정) → 주재자 수렴. 회의록 = §8.
> **상태** = 설계안 · Harold 검토 대기. 코드 0 · DDL 0 실행.
> 관련 상설 = [FEATURE-CDP-INTEGRATION.md](FEATURE-CDP-INTEGRATION.md)(자매 화면 · OAuth 배관) · [FEATURE-AI-AUTO-BUILD.md](FEATURE-AI-AUTO-BUILD.md)(2차 합류 · 돈 단위) · [FEATURE-MARKETING-PLANNER.md](FEATURE-MARKETING-PLANNER.md)(2차 합류) · [FEATURE-IMAGE-STUDIO.md](FEATURE-IMAGE-STUDIO.md)(비율 변환 원칙) · [2026-09-01 AI 이미지 표시](2026-09-01-ai-image-notice-design.md)(표시 CT 계약) · [2026-09-14 우커머스](2026-09-14-woocommerce-integration-design.md)(state·콜백 선례).

---

## 0. 한 줄

**메뉴 "SNS 게시"** = 회사가 자기 SNS 계정을 OAuth로 연결하고(비밀번호 저장 0), 완성된 사진·영상을 올리면 AI가 캡션을 다듬고 회사 고정 태그 세트에서 태그를 골라 켜 주고, 채널을 골라 지금 게시하거나 예약한다. **성공은 플랫폼 재조회로만 확정한다.** 한줄로 회사가 첫 사용자이지만 코드·테이블·과금·화면 어디에도 자사 전용 분기는 없다. 개방 범위는 ENV 다이얼 하나(`SNS_COMPANY_IDS` · 비면 미노출 · `*` = 전 회사)로 움직인다.

1차-A = 인스타그램 피드·캐러셀 + Threads(이미지) → 실측 1건 → 1차-B = 인스타 릴스(MP4 경로 신설) + 페이스북 페이지 + X(실비 채널) → 2차 = 고객 개방(Meta 심사) · AI 자동제작 합류 · 플래너 합류 · 스토리·틱톡·유튜브 · 인사이트·댓글 · 영상 자동 제작 · 크레딧 값.

---

## 1. 출발점 (실측 · 2026-09-17)

### 1-1. 플랫폼 사실 (공식 문서 직접 열람 · 2차 출처는 표기)

| 플랫폼 | 확인 사실 |
|---|---|
| 인스타그램 (Instagram API with Instagram Login) | 페이스북 페이지 불필요 · 프로페셔널(비즈니스·크리에이터) 계정만 · **본인 소유·관리 계정 = Standard Access(심사 0) / 타사 계정 = Advanced Access(앱 심사 + 사업자 인증 · 2~6주는 2차 출처)** · 게시 한도 24시간 100건(컨테이너 400건 · 한도 조회 endpoint 있음) · 미디어는 공개 URL에서 Meta가 가져감 · 이미지 JPEG만 · 비율 4:5~1.91:1 · 폭 320~1440 · 8MB · 릴스 MP4/MOV 9:16 권장 3초~15분 300MB · 스토리 60초 · 캐러셀 10장 · 장기 토큰 60일(24시간 지나야 갱신 가능 · 60일 미갱신 만료) · 게시 = 컨테이너 생성 → 처리 완료 폴링(분당 1회 · 5분) → 게시 · 컨테이너 24시간 만료 · API 예약 게시 없음(앱이 스케줄링) · 같은 권한 묶음에 댓글·메시지·인사이트 |
| Threads | **별도 앱 유스케이스 + 별도 권한**(`threads_basic`·`threads_content_publish`) · 24시간 250건 · 텍스트 500자 · 이미지·영상·캐러셀 2~20장 · 토큰 1시간 → 장기 60일(갱신 endpoint) |
| 페이스북 페이지 | Facebook Login · `pages_manage_posts` 계열 + 영상 `publish_video` · 페이지 토큰 · 사진 `/page_id/photos` · 영상은 Video API |
| 틱톡 | **미감사 앱 = 자사 계정이어도 비공개(SELF_ONLY)** · 24시간 5명 · 공개범위 기본값 금지(사용자가 직접 선택) · 업로드 화면에 닉네임 표시 · 명시 동의 뒤 전송 · 앱이 로고·워터마크·홍보 문구·**링크** 덧붙이기 금지 · `is_aigc` 라벨 · PULL_FROM_URL은 도메인 소유 인증 · 토큰당 분당 6요청 |
| 유튜브 | 미검증 프로젝트 업로드 = 비공개 · 기본 할당 `videos.insert` 하루 100회(프로젝트 전체) · 확장 = 감사 뒤 |
| X | 2026-02-06부터 무료 구간 0 · 종량제(게시 1건 약 $0.015 · URL 포함 약 $0.20 · **2차 출처**) · `POST /2/tweets`(scope `tweet.write`·`tweet.read`·`users.read`) · 미디어는 `POST /2/media/upload`(`media.write`) 뒤 `media_ids` · 영상은 `processing_info` 폴링 |
| 네이버 블로그 | 글쓰기 API 2020-05-06 종료 |
| 한국 AI 기본법 | 2026-01-22 시행 · 생성물 표시 의무 · 계도 최소 1년 · 과태료 최대 3천만원. **카카오 브랜드 메시지 심사 기준과 다른 축**(선례 문서 §1-2) |

### 1-2. 우리 코드 실측 (주재자 직접 확인)

| 사실 | 근거 |
|---|---|
| `company_integrations`를 **provider 조건 없이** 읽는 곳 2 = 인앱 표시 가능성 판정(미지 provider = `manual` 보수적 허용 → SNS 행 하나로 인앱 생성·게시 게이트 개방) · 성과 데이터 가용성(`access_token IS NOT NULL` 카운트 → "쇼핑몰 연동됨" 거짓) | `utils/inapp-display-eligibility.ts:70~83` · `utils/performance-data-availability.ts:65~68` |
| `company_integrations` 컬럼 = `provider varchar(20)` · `mall_id varchar(100)` · `access_token text`(평문) · `UNIQUE(company_id, provider, mall_id)` · `mall_id`는 몰 식별자 계약 | `status/SCHEMA.md` 2252행 절 · `utils/woocommerce-core.ts:10` · `utils/godo-client.ts:27` |
| OAuth 재사용 자산 = 어댑터 사상 `IProviderAdapter`(connectMethod·available 직접 선언 · UI 추론 0) · 자격 해석 순수 함수(회사 자체 앱 자격 우선 → 한줄로 env) · state 서명·1회용·TTL 30분 · 콜백 동기 구간 최소 + 응답 뒤 `void async` · 복귀 HTML `postMessage`(현재 대상 `'*'`) + 성공 시 1.5초 뒤 닫힘 | `utils/provider-registry.ts:62~168` · `utils/provider-credentials.ts:53` · `utils/woocommerce-auth-state.ts` · `routes/woocommerce.ts:148~262` |
| 이미지 처리 = sharp · 서빙 시 변환·캐시 CT(`fitToCanvas` pad/crop · 실패 시 원본 관용 · PNG 무손실 유지) · `ASPECT_RATIOS`에 `1x1` 하나뿐 · MMS 규격 맞춤 CT에 ISO-BMFF `ftyp` 파서 선례 · **MP4 업로드·서빙·ffmpeg 전부 0** | `utils/image-serve.ts` · `utils/image-fit-spec.ts:13` · `utils/mms-image-fit.ts:41~49` · grep `mp4|ffmpeg` 실사용 0 |
| 비율 변환에 생성 모델 금지(0721 실측 · 크롭·패딩만) · 생성은 3:4 포스터 1장 | `docs/FEATURE-IMAGE-STUDIO.md` §2 |
| 브랜드 킷에 공식 SNS URL 4칸(인스타·유튜브·네이버·페이스북) = `companies.brand_kit.sns` · 로드 실패 시 빈값 덮어쓰기 방지 처리 있음 | `frontend/components/AiMemory/BrandBasicInfoTab.tsx:16·46·122~125` |
| AI 자동제작 `BuildChannel = 'dm' \| 'email' \| 'catalog'` · 회사 게이트 `aiAutoBuildEnabled(ENV AI_AUTO_BUILD_COMPANY_IDS · 비면 0 · '*' 전 회사)` · 멱등키 `quick:{company}:{channel}:{token}:{billing16}` 102자 · 과금 지문은 정규화 입력 전체(토큰 제외) · 자동제작 엔드포인트는 `dmRouter` 뒤 = `requirePlanFeature('mobile_dm')` | `utils/ai-auto-build-materials.ts:53·112·391·400~411` · `routes/dm.ts:347·971` |
| 크레딧 CT = `checkCredit`(크레딧제 미적용 회사 통과) · `deductCreditOutcome`(cost 0 → `not_required` 즉시 반환 · 원장 미접촉) · `CREDIT_COST_MAP` 미등록 source = 0 · `idempotency_key varchar(150) UNIQUE` · 20크레딧↑ 확인 모달 의무 · 프론트 단가표 1:1 계약 | `utils/ai-credit.ts:85~92·185~192` · `utils/ai-credit-calc.ts:78~86·205~208` · `SCHEMA.md:1862` |
| 요금제 기능 축 = `FeatureKey` 12종 · `requirePlanFeature` 미들웨어 · 종량제 전환 뒤 AI 기능은 FREE(미가입)만 차단 | `utils/plan-guard.ts:41~52·360~445·499` |
| 허브 카드 원장 정적 배열 12장(NEW 3장) · 소비처 = 허브 그리드(`adminOnly` 필터만) · 워크스루 모달(필터 0) · 요금제 안내 원장(`plan-feature-intros.ts` · 카드마다 항목 의무 · 계약 테스트 = 백엔드가 프론트 소스를 읽음) · **프론트 테스트 파일 0** | `frontend/constants/ai-operator-modules.ts:44~57` · `pages/AiOperatorPage.tsx:1872` · `components/AiOperatorWalkthroughModal.tsx:161` · `backend/utils/__tests__/plan-feature-modal-contract.test.ts` |
| 허브 접근 판정 = `GET /api/ai/operator/access` 1축(기능별 축 0) · `PlanGate`는 안내 통일용(막는 힘은 서버) | `routes/ai.ts:1096` · `components/PlanGate.tsx` |
| 워커 등록 관례 = `app.ts` `start*Worker()` · 부팅 1분 첫 실행 · 42P01 조용히 · ENV 비면 미시작 · DB 선점 선례 `FOR UPDATE SKIP LOCKED` + `lock_token`(선점 토큰 = 소유권 · 단계마다 재확인) · 메모리 잠금은 프로세스 1개 전제·재시작 해제 | `app.ts:559~668` · `utils/agency-send-worker.ts:440~460` · `utils/inflight-lock.ts:1~6` |
| 대조 워커 회귀 선례 = 새 상태값 신설 시 되맞춤 조건에 걸려 매 tick 되돌림 → 조회·UPDATE 양쪽 제외 | `status/BUGS.md:818` |
| AI 표시 CT = `BRAND_AI_IMAGE_NOTICE` · 대상 `cdp_assets.kind='generated'`뿐(**uploaded에 붙이면 거짓 표시**) · 부착 실패 = 발송 거절 · 판정·부착은 조립·차감보다 앞 | `utils/brand-message.ts:1455~1465·1554~1560·1631` |
| 혜택 차단기 = `detectBenefits` · `stripUnauthorizedBenefits(text, original)`(원본도 같은 파서로 자리 대조 · 부정 문맥 못 가림) · 키워드 목록에 `할인` 있음(주석 불일치 기록) | `utils/copy-benefit-detector.ts:16~19·137~170` · `FEATURE-AI-AUTO-BUILD.md:103` |
| 지금 코드의 "SNS 섹션"(DM·이메일 하단 링크 칩)은 게시 기능과 무관 | `components/dm/canvas/SnsSection.tsx` |

### 1-3. Harold 요구 원문 요지

1. 재료를 넣고 AI 제작을 누르면 채널별 규격에 맞춰 자동 제작·업로드 → 2차(AI 자동제작 합류).
2. 대행사에 SNS를 맡기는 회사가 많다 · 크레딧으로 고가 요금제 유도 → 크레딧 자리(§3-6) · 값은 2차.
3. 대행사가 피드·릴스·쇼츠를 다 하면 얄팍한 서비스로는 힘들다 → 릴스는 1차 안(1차-B).
4. 당장 = 한줄로 자사 SNS 활동(피드부터) · 영상은 밖에서 만들어 올린다 · **외부 영상 도구 API 연동 0** · 태그 자동 부여 + 추가 가능 + AI 살짝 → 1차-A.
5. 처음부터 고객사가 자사몰 연동처럼 자기 계정을 연결하고 직접 게시하거나 AI를 쓰는 구조 · 한줄로는 첫 사용자 → §2-1.
6. 명칭부터 1·2차 완벽 설계 → §4-5 · §5.

---

## 2. 불변 원칙 (어길 수 없는 것)

1. **자사 전용 분기 0.** 코드·테이블·과금·화면·문구 어디에도 "우리 회사"·"자사" 분기와 낱말이 없다. 한줄로 회사는 `companies` 행 하나로 다른 고객사와 같은 경로를 지난다. 개방 범위만 ENV `SNS_COMPANY_IDS`가 정한다(`aiAutoBuildEnabled` 미러 · 비면 미노출 · `*` = 전 회사). 자사 0원은 그 회사가 크레딧제 미적용이라 원장이 안 움직이는 성질로 얻는다(`ai-credit.ts:88~89`).
2. **계정 연결은 OAuth만.** 아이디·비밀번호 저장 경로 0. state는 서명·1회용·TTL 30분 셋 다. 콜백 경로에 platform을 박고 state의 platform과 다르면 거부.
3. **저장 ≠ 연결.** 토큰 저장 = `pending`. 계정 재조회 1콜(프로페셔널 여부 · 프로필) 성공 시에만 `active` + `connected_at`. 실패 = `ineligible` + 사유. `pending`·`ineligible`에 초록 0.
4. **신규 테이블 5개. `company_integrations` 재사용 금지.** 근거 = §1-2 첫 행(provider 조건 없는 조회 2곳). `sns_accounts`를 읽는 함수는 `company_integrations`를 import하지 않는다(정적 계약).
5. **전 조회에 `company_id` 조건을 직접 부여한다.** `(platform, external_account_id)`만으로 회사를 정하는 함수를 만들지 않는다. 계정 id만 들고 오는 콜백(deauthorize)은 회사별 후보 행을 전부 꺼내 서명으로 가려낸다. 요청 body의 `account_id`는 `company_id` 조건으로 재조회해 소유를 확인한 뒤에만 쓴다.
6. **성공은 플랫폼 재조회로만.** API 200은 `submitted`까지. `published` ⇔ `verified_at` 있음. 화면 초록은 `verified_at` 뒤에만. 진실이 두 곳(우리 원장 ↔ 플랫폼)이므로 대조 워커 동반.
7. **target 상태값 7개 고정**(`draft` `scheduled` `claimed` `submitted` `published` `failed` `cancelled`). 늘리지 않는다. 단계·증거는 컬럼으로. `stage`는 기록 전용이며 어떤 분기도 읽지 않는다. `failed → scheduled` 전이 없음(사용자 재시도 = 새 target 행).
8. **이중 게시 0 = 3겹.** `UNIQUE(company_id, idempotency_key)` + `FOR UPDATE SKIP LOCKED` 선점 · `lock_token` CAS(단계마다 · 게시 호출 직전 재확인) + 재시도 전 증거 우선(컨테이너 id 있으면 재사용 · 응답 유실 행은 3조건 AND 아니면 자동 확정 0 → 사람 확인 1줄). 메모리 잠금 금지.
9. **캡션 규칙은 CT 하나**(`sns-caption-rules.ts` 순수). 미리보기·저장·예약·워커 전 경로가 같은 CT를 지나고, target 행에 **확정본**을 저장하며 워커는 그 컬럼만 읽는다. 화면 규격표(`GET /api/sns/specs`)는 그 CT 상수를 그대로 직렬화한다(값이 두 곳에 적히면 계약 테스트 실패).
10. **AI는 태그 생성기가 아니라 선택기.** 게시 화면의 태그 출처 = 회사 고정 세트 · AI가 그 세트에서 골라 켠 것 · 사용자 직접 입력. 서버 강제 = `tags ⊆ fixedSet ∪ userTyped`. 새 태그가 태어나는 유일한 입구 = 세트 편집(AI 후보 → 사람 승인). 플랫폼 거부 시 태그 자동 제거 후 재시도 0.
11. **캡션은 다듬기만.** 없는 혜택·가격·기간·수치·링크 생성 0. URL·금액·혜택은 토큰 치환 후 복원(토큰을 잃은 후보는 폐기) + 출구 `stripUnauthorizedBenefits(text, 사용자 원문)`. 면허 = 사용자가 캡션 칸에 쓴 원문 하나(태그·상품명·브랜드 킷은 재료이지 면허가 아니다).
12. **AI 표시는 끌 수 없다.** 우리 생성 자산(`cdp_assets.kind='generated'` · 라이브러리 경유분만 판정 가능) = 자동 부착 · 못 끔 · 부착 실패 = 게시 차단. 직접 올린 파일 = 사용자 선언 체크(`AI로 만든 영상·이미지예요` · 기본 꺼짐)가 유일한 근거. 라벨 필드가 있는 채널은 필드로, 없는 채널은 캡션 끝 문장으로. SNS 미디어는 `cdp_assets`에 등재하지 않는다.
13. **비율 변환에 생성 모델 0.** 크롭·패딩만. 게시본은 게시 직전 파일로 확정하고 **그 파일의 실제 형식을 다시 읽어** JPEG가 아니면 게시를 시작하지 않는다(서빙 CT의 관용은 SNS에서 독). MP4는 변환 0·원본 전달.
14. **미디어 URL은 둘.** 화면 미리보기 = 인증 라우트(회사 조건 · 영구). 플랫폼 fetch = 서명 경로(`target_id`·`media_id`·`company_id`·`salt` · 경로 세그먼트 · target·미디어당 1개 고정 · **1회용 아님** · 유효 = target 상태 결박 + 절대 상한 36시간 · `verified_at`·`failed`·`cancelled` 즉시 만료 · `Cache-Control: no-store`). 화면은 서명 경로를 한 번도 쓰지 않는다. 로컬 초안에는 미디어 id만 저장한다.
15. **소급 게시 0.** 예약 시각이 24시간(인스타 컨테이너 만료값) 넘게 지난 행은 워커가 게시하지 않고 `failed(시각 경과)`로 닫되 `[지금 올리기]`로 사람이 되살린다. 워커 첫 가동 tick은 `scheduled` 행 수를 stdout에 남기고 게시하지 않는다. 이 가드가 워커보다 먼저 들어간다.
16. **게이트 순서 = 요금제 먼저, ENV 나중.** `requirePlanFeature('sns_publish')`(FREE만 차단 · 새 컬럼 0) → ENV 판정. ENV 미개방 유료 회사는 403 빈 화면이 아니라 `준비 중` 화면 1장. 화면은 서버 플래그 하나만 보고 ENV를 다시 계산하지 않는다.
17. **1클릭.** `AI로 캡션 쓰기` 1클릭 → 즉시 캡션·태그가 채워진 편집 모드. 중간 입력 0. 세트가 비어도 버튼은 남고 사유 한 줄(`태그 세트가 비어 있어 태그는 못 골랐어요`). 게시 직전 확인 창 1회는 1클릭 원칙 밖(되돌릴 수 없는 클릭).
18. **문구 계약.** 성과 약속어(바이럴·확산·도달·노출 증가·팔로워·인기) 영구 금지. `자동` 계열은 그 문장이 가리키는 일을 도는 워커가 실존할 때만(예약 게시 = `startSnsPublishWorker` 실존 → 허용). `자사`·`우리 회사` 0. 모델명·줄표·내부 코드명 0.
19. **플랫폼 응답 필드명은 실측 raw로만 확정한다.** 이 문서의 필드명·상태값(`status_code` 등)은 전부 미검증이며, 어댑터 코드 이전에 채널별 raw 1건(curl)을 확보한다(§6 게이트 ①).
20. **신규 컬럼·테이블은 코드 직전 `information_schema` 확인.** 이 문서의 DDL은 "예정"이다. DDL 묶음 앞에 `SET lock_timeout = '3s'`.

---

## 3. 구조

### 3-1. 테이블 5 (예정 DDL · 미검증 · 코드 직전 `information_schema` 확인)

```
sns_accounts        회사가 연결한 SNS 계정 1행
  id uuid PK · company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE
  platform varchar(32) NOT NULL          -- instagram / threads / facebook_page / x  (값 목록 = CT 상수 + 계약 테스트)
  external_account_id varchar(100) NOT NULL · username varchar(100) · display_name varchar(200) · avatar_url text
  access_token text · refresh_token text · token_expires_at timestamptz · token_refreshed_at timestamptz
  scope text · meta jsonb NOT NULL DEFAULT '{}'
  status varchar(20) NOT NULL DEFAULT 'pending'   -- pending / active / ineligible / token_expired / reauth_required / revoked / error
  status_reason text · is_default boolean NOT NULL DEFAULT false · connected_by uuid(FK 없음)
  connected_at · last_verified_at · created_at · updated_at timestamptz
  UNIQUE(company_id, platform, external_account_id) · INDEX(company_id, status) · INDEX(token_expires_at) WHERE status='active'

sns_oauth_states    승인 창 왕복 1회용
  state_nonce varchar(64) PK · company_id uuid NOT NULL · platform varchar(32) NOT NULL · created_by uuid
  payload jsonb NOT NULL DEFAULT '{}' · expires_at timestamptz NOT NULL · INDEX(expires_at)
  (1회용 = DELETE ... WHERE state_nonce=$1 AND company_id=$2 AND expires_at > NOW() RETURNING · 0행 = 400)

sns_media           업로드 파일 원장 (작성 중에는 post 행이 없으므로 미디어가 먼저 존재한다)
  id uuid PK · company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE · created_by uuid
  kind varchar(10) NOT NULL              -- image / video
  path text NOT NULL · format varchar(10) · bytes bigint · width int · height int · duration_ms int
  asset_id uuid NULL                     -- 소재 라이브러리 경유분만(AI 표시 자동 판정의 유일한 근거)
  ai_declared boolean NOT NULL DEFAULT false   -- 직접 올린 파일의 사용자 선언
  created_at timestamptz · INDEX(company_id, created_at DESC)

sns_posts           사용자가 만든 게시물 1건 (상태는 자식 집계 파생)
  id uuid PK · company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE
  title varchar(200) · body text NOT NULL(사용자 원문) · body_ai_refined boolean NOT NULL DEFAULT false
  tags text[] NOT NULL DEFAULT '{}' · media_ids uuid[] NOT NULL DEFAULT '{}'(순서)
  status varchar(24) NOT NULL DEFAULT 'draft'   -- draft / scheduled / publishing / published / partial_failed / failed / cancelled
  scheduled_at timestamptz · created_by uuid · created_at · updated_at
  INDEX(company_id, created_at DESC)

sns_post_targets    채널별 행 = 상태 머신 소유자
  id uuid PK · post_id uuid NOT NULL REFERENCES sns_posts(id) ON DELETE CASCADE
  company_id uuid NOT NULL(격리 조건 직접) · account_id uuid NOT NULL REFERENCES sns_accounts(id)
  platform varchar(32) NOT NULL · format varchar(20) NOT NULL   -- feed / carousel / reels / story / text
  caption text NOT NULL                  -- 규칙 CT 통과 확정본 · 워커는 이 컬럼만
  status varchar(20) NOT NULL DEFAULT 'draft'   -- §3-5 7개 · CHECK
  stage varchar(24)                      -- container_created / container_processing / publish_called · 기록 전용
  scheduled_at timestamptz
  idempotency_key varchar(150) NOT NULL  -- 1차부터 실제 키 기록(값 0이어도)
  container_id varchar(100) · container_status varchar(20) · container_created_at timestamptz
  platform_post_id varchar(100) · permalink text
  verified_at timestamptz · verify_attempt_count int NOT NULL DEFAULT 0 · last_verify_error text · verify_gave_up_at timestamptz
  deleted_on_platform_at timestamptz
  lock_token uuid · claimed_at timestamptz · attempt_count int NOT NULL DEFAULT 0 · next_attempt_at timestamptz
  last_error_code varchar(40) · last_error text · created_at · updated_at
  UNIQUE(company_id, idempotency_key) · INDEX(status, next_attempt_at) · INDEX(company_id, created_at DESC) · INDEX(account_id, verified_at DESC)
```

- 해제·삭제: 계정 행 DELETE 0(`revoked` + 토큰 NULL · 게시 이력이 참조). 미디어 파일 삭제 = `verified_at` 이후 + 보관 기간 · 회사 삭제 CASCADE와 파일 삭제 경로를 같은 커밋에.
- 2차 확장 자리(컬럼 추가 없이): 스토리는 `format='story'` + 어댑터 `ephemeral`로 대조 제외 · 틱톡 공개범위는 `sns_post_targets.meta`가 아니라 요청 시점 검증만(저장 안 함 · 기본값 0).

### 3-2. 라우터 · 엔드포인트

`routes/sns.ts`(인증 → `requirePlanFeature('sns_publish')` → ENV 판정) + `snsPublicRouter`(helmet 앞 마운트 · `app.ts:204` 선례 · 서명 미디어 · deauthorize 콜백 · 승인 복귀 HTML).

| 메서드 · 경로 | 역할 |
|---|---|
| `GET /api/sns/overview` | `enabled`(ENV) · 계정 목록·상태 · 미확정 행 수 · 최근 이력 5 · 태그 세트 요약. 화면 1콜 |
| `GET /api/sns/specs` | 어댑터 `capabilities` 직렬화(추론 0 · 캡션 규칙 CT 상수와 계약 테스트) |
| `POST /api/sns/auth/start/:platform` | state 발급 + authorize URL(자격 = `resolveProviderOAuthCredentials` platform 단위) |
| `GET /api/sns/auth/callback/:platform`(공개) | state 검증·소비 → 토큰 교환 → `pending` 저장 → 복귀 HTML(§3-10). 프로필·자격 재조회는 응답 뒤 |
| `POST /api/sns/accounts/:id/disconnect` · `POST .../reconnect` | `revoked` / 재승인 시작 |
| `POST /api/sns/deauthorize/:platform`(공개) | 플랫폼 권한 회수 콜백 · 서명 검증 → 회사별 후보 전수 → `reauth_required` + 예약 행 `blocked`(= `failed` + `last_error_code='REAUTH_REQUIRED'`) → 즉시 200 |
| `POST /api/sns/media`(multer · 이미지 8MB · MP4 300MB · 진행률은 프론트) | `sns_media` 행 + 헤더 검증 결과. 형식 밖·비율 밖은 그 자리에서 사유 |
| `GET /api/sns/media/:mediaId`(인증) | 화면 미리보기·썸네일. 회사 조건 |
| `GET /api/sns/m/:token`(공개 · 서명) | 플랫폼 fetch. Range 206 · CORP cross-origin · no-store |
| `GET /api/sns/tag-set` · `PUT /api/sns/tag-set` | 고정 세트. 비어 있으면 회사당 1회 지연 후보 생성(브랜드 킷·업종·회사명 → 후보 상태 · 저장 아님) |
| `POST /api/sns/caption` | `AI로 캡션 쓰기`. 다듬기 + 세트에서 태그 고르기. 크레딧 키 `sns-caption-generate`(1차 값 0) |
| `POST /api/sns/posts` · `PUT /api/sns/posts/:id` | 저장. 채널별 최종 캡션 배열 → 규칙 CT → target 행 확정본 |
| `POST /api/sns/posts/:id/publish` | 확인 창 값 재검증(계정 소유 · 규칙 CT 재적용 · 계정 상태 바뀌면 `ACCOUNT_STATE_CHANGED` · 이력 행 0) → `scheduled`(지금이면 `scheduled_at=NOW()`) |
| `POST /api/sns/posts/:id/cancel` | `scheduled`만 `cancelled`. `claimed` 이후 409 |
| `POST /api/sns/targets/:id/retry` | **새 target 행**(같은 post · 같은 캡션 · 새 키). `failed`만 |
| `GET /api/sns/posts` · `GET /api/sns/posts/:id` | 목록(회사 조건) · 상세(모달) |
| `POST /api/sns/build`(2차) | AI 자동제작 계약(BuildMaterials v1 · channel `sns`) |

### 3-3. 어댑터 계약 `ISnsAdapter`

`IProviderAdapter` 사상 미러(`provider-registry.ts:62~168`). 어댑터가 직접 선언하고 UI는 추론 0. 채널 1개 = 파일 1개.

```
capabilities: {
  publishImage · publishVideo · publishCarousel · publishStory: boolean
  asyncContainer: boolean            -- 인스타 릴스 3단계
  maxCaptionChars · maxTags · dailyLimit: number
  requiresExplicitConsent: boolean   -- 틱톡(2차)
  metered: boolean                   -- X(실비 · 월 상한 · 조회 재시도 기본 제외)
  verify: 'immediate' | 'deferred' | 'none'   -- 게시 직후 건별 / 일 1회 타임라인 대조 / 수단 없음(submitted가 종착지 · 화면이 처음부터 말함)
  ephemeral: boolean                 -- 스토리(2차) · 대조 제외
  mediaTransfer: 'pull_url' | 'upload' -- Meta = pull_url / X = upload
}
buildAuthorizeUrl(creds, state) · exchangeToken · fetchAccount(프로페셔널 판정) · refreshToken
createPost(target, media) · pollContainer · publish · fetchPost(verify) · deletePost(실측 시나리오용)
```

1차 어댑터 = `instagram`(Instagram Login) · `threads` · 1차-B `facebook_page` · `x`. 2차 = `tiktok`·`youtube` 스켈레톤(`available:false` → 채널 칩 `준비 중`).

### 3-4. 워커 3 · 선점 · 회수

| 워커 | 주기 | 하는 일 |
|---|---|---|
| `startSnsPublishWorker` | 30초 | ①`scheduled` due 선점(`FOR UPDATE SKIP LOCKED` + `lock_token` 발급 → `claimed`) ②미디어 게시본 확정(§3-7) ③어댑터 createPost → `submitted` + `stage` ④`asyncContainer`면 컨테이너 폴링(플랫폼 권고 = 분당 1회 · 5분 상한 · 넘기면 `next_attempt_at` 연기 · ERROR/EXPIRED = 폐기 후 재생성 · 키 불변) ⑤publish 직전 `lock_token` 재확인 → 호출 → `platform_post_id` ⑥`verify:'immediate'`면 재조회 → `verified_at` → `published`. 레이트리밋은 우리 원장 24h 카운트 · 상한·429 = `next_attempt_at` 연기. **예약 워커와 발행 워커를 나누지 않는다** |
| `startSnsReconcileWorker` | 30분 | 대상 = `claimed` 10분 정체(회수: `lock_token` 비우고 `scheduled`로 · 단 `stage='publish_called'`는 `submitted`로 올려 증거 조회로) · `submitted`(재조회 → `verified_at` 또는 `verify_attempt_count`++ · `submitted + 24h` 지나면 `verify_gave_up_at` 찍고 조회·UPDATE 양쪽 제외) · `verify:'deferred'` 채널은 계정 단위 일 1회 타임라인 대조 · 플랫폼에서 사라진 `published`는 `deleted_on_platform_at`. **종결(`failed`·`cancelled`)과 확정(`published`)은 조회·UPDATE 양쪽 제외.** "대조 워커가 보는 상태 목록" = 계약 테스트 |
| `startSnsTokenWorker` | 6시간 | 만료 14일 전 갱신(인스타는 `token_refreshed_at` 24h 이전만) · 실패는 `status` 미변경 + `meta.refresh_error` · 만료·회수 감지 = `token_expired`/`reauth_required` + 그 계정 예약 행 `failed(REAUTH_REQUIRED)` · 예약 시각이 토큰 만료 이후면 예약 시점에 경고 |

공통 = `app.ts` 등록 관례(부팅 1분 첫 실행 · 시작 로그 1줄 · 42P01 조용히 · ENV 비면 미시작). 첫 가동 tick = `scheduled` 행 수 stdout + 게시 0(§2-15).

### 3-5. 상태 머신

**target 상태 7(CHECK · CT 상수)** · 전이 = `draft → scheduled → claimed → submitted → published` · 어느 단계에서든 `failed` · `scheduled`에서만 `cancelled`. **`failed → scheduled` 없음.**

| target.status | stage(기록 전용) | 뜻 | 대조 워커 |
|---|---|---|---|
| `draft` | | 예약 전 | 안 봄 |
| `scheduled` | | 예약 시각 대기 | 안 봄(발행 워커만) |
| `claimed` | | 선점(lock_token) | 10분 정체 회수 |
| `submitted` | `container_created` / `container_processing` / `publish_called` | 플랫폼 접수. **API 200은 여기까지** | 봄(`verify_gave_up_at` 없는 것만) |
| `published` | | `verified_at` 있음(재조회 확인) | 안 봄(`deleted_on_platform_at`만 별도 표본) |
| `failed` | | 종결 · 사유 보존 | 안 봄 |
| `cancelled` | | 종결 | 안 봄 |

**post 상태 = 자식 집계 파생**(같은 트랜잭션 · 함수 하나): 전 `draft` → `draft` / `scheduled` 있고 진행 0 → `scheduled` / `claimed`·`submitted` 있음 → `publishing` / 전 `published` → `published` / `published`·`failed` 혼재 → `partial_failed` / 진행 0·`published` 0·`failed` 있음 → `failed` / 전 `cancelled` → `cancelled`.

**화면 배지 = 상수 사전 1파일 소유(문구·색·설명) · 훅 = 판정 · 컴포넌트 = 픽셀 · 사전에 없는 값은 안 그림**(`constants/planner-dm.ts` 방식).

| 축 | 배지 | 조건 | 색 |
|---|---|---|---|
| 묶음 | 초안 / 예약됨 / 올리는 중 / 게시됨 / **일부 실패** / 실패 | post 상태 | 무채 / sky / violet+회전 / emerald / **amber** / rose |
| 채널 줄 | 올리는 중 | `claimed`·`submitted` + `platform_post_id` 없음 | violet + 회전 |
| 채널 줄 | **올렸고 확인 중** | `submitted` + `platform_post_id` 있음 + `verified_at` 없음 · **다시 올리기 잠금** · `채널에서 확인되면 자동으로 바뀝니다` | violet 옅게 · 정지 |
| 채널 줄 | **올렸고 확인 못함** | 위 + `verify_gave_up_at` 있음 · permalink 노출(사람이 직접 확인) · 잠금 유지 | 무채 |
| 채널 줄 | 올림 · 채널에서 확인 | `verify:'none'` 채널의 `submitted` + `platform_post_id` | 무채 |
| 채널 줄 | 게시됨 | `published` · `게시물 보기` 링크 | emerald |
| 채널 줄 | 실패 | `failed` · 사유 1문장(사전 함수) + `다시 시도`(새 행) | rose |
| 채널 줄 | 계정 확인 필요 | `failed` + `REAUTH_REQUIRED` · 그 자리에서 재연결 | amber |
| 채널 줄 | 게시물 없음 | `deleted_on_platform_at` 있음 · `채널에서 삭제된 것으로 확인됐어요` | 무채 |
| 계정 카드(다른 사전) | 연결 안 됨 / 연결됨 / 다시 연결 필요 / 해제됨 / **계정 확인 필요**(`ineligible`) / 준비 중 | 계정 상태 · 2차 채널 | |

### 3-6. 멱등키 · 크레딧 자리

- 멱등키 = `sns:{company36}:{targetId36}:{billingHash16}` **94자**(`varchar(150)` 여유 56) + 키 생성 CT에 길이 단언 테스트. `billingHash` 재료 = caption 확정본 · 미디어 id와 순서 · format · 태그(정규화). `attemptToken`은 키·해시 모두 제외(넣으면 재시도마다 새 키 = 이중 차감). 랜덤 키 0. **1차부터 `sns_post_targets.idempotency_key`에 실제 키를 쓴다**(값 0이라 원장은 안 움직여도 UNIQUE가 키 안정성을 실증한다).
- 크레딧 키 2개 자리 = `sns-caption-generate`(캡션 1회 · 생성 성공 시) · `sns-publish`(채널 행 1건 · **접수 성공 = `platform_post_id` 수령 시점 1회** · 컨테이너 단계는 과금 전이라 그 실패는 0 · 실패 0 · 환불 경로 0 · 같은 행 워커 재시도는 같은 키 duplicate 무료). **1차 `CREDIT_COST_MAP` 미등재 = 0.** `deductCreditOutcome` 호출은 1차부터 자리에 둔다(cost 0 → `not_required`). 2차에 값을 넣는 날 프론트 단가표 1:1 · 20크레딧↑ 확인 모달 · 요금제 안내 항목 비용 칩이 계약 테스트로 함께 걸린다. `OPERATION_SOURCES` 미등재(잔액 0이어도 게시는 된다). **값 = 2차 Harold 결정**(회의에서 게시 과금 자체에 대한 프론트 반대 기록 · §8).
- 자사 0원 = 한줄로 회사 `creditEnabled=false` 성질. 과금 코드에 회사 분기 0.

### 3-7. 미디어

- 저장 = `uploads/sns-media/{companyId}/{uuid}.{ext}`(경로 조작 차단 `routes/dm.ts:156~157` 그대로). `cdp_assets` 미등재(URL 조립 하드코딩이 다르고 요금제 저장 한도 합산 대상이라 릴스 1개가 소재 라이브러리를 잠근다). 소재 라이브러리에서 고른 경우만 `sns_media.asset_id` 보유.
- 업로드 검증 = 이미지: 형식 허용 목록 · 8MB · 비트맵 폭·높이 / MP4: 300MB · ISO-BMFF `ftyp` 브랜드 · `mvhd` duration → 길이 · `tkhd` 폭·높이·회전 → 비율. **코덱·오디오·비트레이트는 미검증** → 통과시킨 뒤 플랫폼 거부 사유 원문을 `last_error`와 화면에. 릴스 파일은 고르는 즉시 브라우저 `videoWidth/Height/duration`으로 판정해 안 맞으면 전송 자체를 시작하지 않는다(300MB 올리고 거부 0).
- 게시본 확정(워커 ②) = 채널 비율(`ASPECT_RATIOS`에 `4x5`·`191x100`·`9x16` 추가 · pad/crop은 사용자 선택 · 기본 = 잘림 표시 뒤 선택) · JPEG · 폭 ≤1440 · 투명 → 흰색 · `.opt` 캐시 미사용(별도 파일 · `verified_at` 뒤 보관 기간으로 삭제). **변환 함수가 결과 파일의 실제 형식을 다시 읽어** JPEG가 아니면 `failed(MEDIA_FORMAT)`. MP4 = 변환 0.
- 서명 경로 `/api/sns/m/:token` = payload `{target_id, media_id, company_id, salt}` + HMAC(경로 세그먼트 · Range 헤더와 간섭 0). target·미디어당 1개 고정 발급(URL 안정 = 플랫폼 캐시 생존). 유효 = 서명 통과 AND target `claimed`·`submitted` AND (`container_created_at + 26h` 이내 OR 접수 중) AND 절대 상한 36h · `verified_at`·`failed`·`cancelled` 즉시 만료 · payload `media_id` ≠ 현재 행 미디어 → 404(사진 교체 시 옛 URL 자동 무효). `Cache-Control: no-store` · `Cross-Origin-Resource-Policy: cross-origin` · `res.sendFile` Range 206. **`salt`는 추측 방지용이며 1회용이 아니다**(OAuth state와 정반대 · 같은 URL 다회 요청이 정상).
- 화면 = `/api/sns/media/:mediaId`(인증 · 회사 조건 · 영구). 로컬 초안 = 미디어 id. 이미지 로드 실패 시 그 행만 1회 재조회. 보관 기간 뒤 썸네일 자리 = `보관 기간이 지난 파일이에요`.

### 3-8. AI 캡션 · 태그

- 진입 = `callAIWithFallback`(`services/ai.ts:73` · `withCopyRules` 관문 · source `sns-caption-generate`) · 시스템 프롬프트는 `refineDirectMessage`(`:3350`) 계약 미러("없는 걸 지어내지 X · 항목에 없는 사실 추가 X").
- 가격·링크 AI 미경유 = 원문의 URL·금액·혜택 문구를 `{{link1}}`·`{{price1}}` 토큰으로 치환해 모델에 넘기고 결과에서 복원. 토큰을 잃은 후보 폐기. 출구 = `stripUnauthorizedBenefits(text, 사용자 원문)`(부정 문맥 한계 = §7 ⑪).
- 태그 = AI 출력은 **고정 세트의 부분집합**(프롬프트에 세트를 주고 "이 글에 맞는 것을 고르라") · 서버 강제 `tags ⊆ fixedSet ∪ userTyped` · 직접 입력 태그는 형식 검사 + `detectBenefits`(혜택 낱말) · 채널 상한(인스타 30 · 캡션 2200 · X 280 · Threads 500)은 규칙 CT가 자르고 화면은 카운터. 세트 비면 캡션만 다듬고 사유 1줄. 세트 씨앗 = `GET /api/sns/tag-set` 지연 생성(회사당 1회 · 생성 시각 기록 · 후보 상태 · 화면 `전부 넣기` 1버튼). 게시 화면에 새 태그 입구 0(세트 편집 절만).
- 확정본 = 규칙 CT 통과 문자열을 target 행 `caption`에 저장. 워커는 그 컬럼만. `claimed` 이후 수정 409.

### 3-9. AI 표시

- 우리 생성 자산(`sns_media.asset_id` → `cdp_assets.kind='generated'`) = 자동 부착 · 못 끔. 직접 올린 파일 = 업로드 칸 체크 `AI로 만든 영상·이미지예요`(기본 꺼짐 · `sns_media.ai_declared`). 켜지면 채널 라벨 필드(2차 틱톡 `is_aigc` · Meta 라벨 필드는 미검증)가 있으면 필드로, 없으면 캡션 끝 문장(기존 CT 문구 계열 · 채널별 문장은 규칙 CT 소유). 부착 실패(글자 수 초과 등) = 게시 차단 + 그 자리에서 `본문을 N자 줄여 주세요`(`brand-message.ts:1554~1560` 선례). 순서 = 표시 부착 → 규칙 CT → 확정본 저장 → 접수 → 차감.
- 화면 = 토글 0. 캡션 아래 고정 안내 줄 + 미리보기 프레임 안 캡션 끝에 실제 문장을 회색으로 렌더 + 글자수 게이지가 문장 몫을 미리 예약.
- 캡션 텍스트(AI가 다듬은 글) 자체가 표시 대상인지 = **미검증 · Harold 결재**(§7 ④). 1차는 `sns_posts.body_ai_refined` 기록만.

### 3-10. OAuth 연결 · 콜백 · 해제 · 회수 · 갱신

- 시작 = 카드 `연결` 1클릭 → `POST /auth/start/:platform` → state(`woocommerce-auth-state.ts` 형식 복제 · payload에 `company_id`·`platform`·`stateNonce`) → 새 창. 자격 = `resolveProviderOAuthCredentials`(회사 자체 앱 자격 우선 → 한줄로 env · 2차 Advanced Access를 회사 앱으로 우회하는 길이 이 함수).
- 콜백 동기 구간 = state 검증(경로 platform = state platform) → 1회용 소비 → 토큰 교환 → 계정 행 `pending` → 복귀 HTML. 프로필·프로페셔널 판정은 응답 뒤 `void async` → `active`(성공) / `ineligible` + 사유(실패). 실패 사유 사전 예 = `이 계정은 프로페셔널(비즈니스·크리에이터) 계정이 아니에요. 인스타그램 앱에서 계정 종류를 바꾼 뒤 다시 연결해 주세요.` 같은 사유 3회 연속이면 칩 위에 고정.
- 복귀 HTML = `renderWooReturnHtml` 복제(성공 1.5초 뒤 닫힘 · 실패는 안 닫음 · `esc`) + **`postMessage` 대상 = 우리 origin 명시**(`'*'` 금지) + payload `{type:'hanjullo:sns', platform, accountId, stateNonce}` (**`success` 필드 없음** · 부모는 상태를 다시 읽고 그 결과로만 말한다).
- 프론트(우커머스식 유일 · 카페24식 새로고침 토스트 금지) = 수신 origin 검사 · 자기가 연 팝업의 `stateNonce`와 일치할 때만 처리 · 메시지는 "다시 읽어라" 신호일 뿐 · 창 닫힘 감시(사용자가 그냥 닫아도 1회 재조회) · 팝업 차단 시 `새 창이 열리지 않았습니다` + 링크 버튼 · 그 카드만 갱신 · 리스너 의존성 = 재조회 함수 하나 · 작성 중 내용은 로컬 초안(미디어 id)으로 생존.
- 해제 = `ConfirmModal` danger 1회 → `revoked` + 토큰 NULL(DELETE 0). 권한 회수 = 갱신·게시에서 OAuth 오류 또는 deauthorize 콜백 → `reauth_required` + 그 계정 예약 행 `failed(REAUTH_REQUIRED)`(조용히 실패 0). 갱신 = §3-4 토큰 워커.
- 브랜드 킷 SNS 칸 = 연결되면 자동 채움 + 읽기 전용 + `SNS 게시에서 연결됨` 한 줄(기존 로드 실패 보호 코드 무접촉).

### 3-11. 게이트 2겹 · 허브 타일

- 요금제 = `FeatureKey`에 `'sns_publish'` 추가 · `canUseFeature` case = FREE(미가입)만 차단 · 유료 전 개방(D90 · 새 플랜 컬럼 0). `routes/sns.ts` 전 라우트 · `PlanGate featureId="sns"` · `plan-feature-intros.ts` 항목 1건(**비용 칸 비움** · 안내 1줄 · 자사몰 항목 형태 · 계약 테스트 규칙 1·2·7).
- ENV = `SNS_COMPANY_IDS`(`aiAutoBuildEnabled` 미러). 서버가 `overview.enabled`와 허브 접근 응답(`GET /api/ai/operator/access`에 `features.sns` 추가)에 실어 준다. **순서 = 요금제 먼저 → ENV.** ENV 미개방 유료 회사 = `준비 중` 화면 1장(403 빈 화면 0). 플래그 endpoint가 타일보다 먼저 배포.
- 허브 타일 = 1차부터 1장 · 2행(발송 채널) · 카드 정의에 `flag?: 'sns'` 필드 → **필터 대상 2곳**(허브 그리드 `AiOperatorPage.tsx:1872` · 워크스루 `AiOperatorWalkthroughModal.tsx:161`) / **등재 대상 1곳**(`plan-feature-intros.ts` · 필터 금지). NEW 배지 = Harold 결정(붙이면 만료 NEW 2장 제거를 같은 배포에 · 아니면 NEW 없이 · 넷을 동시에 켜지 않는다).
- 프론트 계약 테스트 = 프론트에 테스트 파일이 0이므로 **백엔드 소스 스캔 테스트**(`plan-feature-modal-contract.test.ts` 방식)에 항목을 더한다: 타일 필터 2곳 · 안내 항목 · `PlanGate` · 금지어 · 배지 사전 완전성 · `stage` 조건문 0건 · 상태 목록 · specs = CT 상수.

---

## 4. 화면

### 4-1. 골격 (`/sns` · `OUI_` 계열 · `bg-slate-950` · 뒤로가기 `goBackOr(navigate, '/ai-operator')`)

```
헤더 sticky · 타일 · 제목 "SNS 게시" · 부제 "계정을 연결하고 사진과 글을 올리면 채널 규격에 맞춰 게시합니다"

계정 0 (또는 active 0)
  ├ 한 줄 진행 표시  ①연결 → ②첫 계정 확인(active 1건 · 채널 수 무관) → ③첫 게시 확인(verified_at 1건)   ※ 실측값 판정 · 셋이 차면 사라짐
  ├ 연결 구역 = 미리보기 프레임 3장("올리면 채널마다 이렇게 보여요" · 브랜드 킷 값 · 비면 회사명) + 채널 카드 그리드(카드 4줄 · 버튼 1 · 카드 안 계정 줄 N + [계정 추가])
  └ 작성 구역 접힘·잠김

계정 1+ · 평시                        미확정 행(진행 중 + 확인 못함 + 실패) > 0
  ① 작성                              ① 예약·이력   ← 올라온다(실측값 판정)
  ② 예약·이력(최근 5 + 전체 모달)      ② 작성
  ③ 계정 + 태그 세트 + 규격 안내       ③ 계정 …
     (채널 카드 기본 접힘 · 펼친 카드는 하나 · 접힘 절 2 = 고정 태그 세트 / 채널별 규격 안내)
하단 sticky 게시 바 = 작성 구역이 뷰포트를 벗어나면 "작성 중 · 사진 2장" 축소 바(누르면 스크롤) · 게시 버튼은 축소 바에 없음
이력 상세 = 자기 모달(createPortal · bg-slate-900) · 2차 인사이트는 이 모달 안
탭 0 (OUI_TAB 토큰 실사용 0 · 검증 안 된 패턴을 외부에 글이 나가는 화면에서 처음 쓰지 않는다)
```

### 4-2. 작성 구역 (4단 위계 · `OUI_WRAP_NARROW`)

1. **미디어 무대**(가장 큰 면 · `aspect-[4/5]` · 릴스 켜지면 `9/16`) · 드롭 + 즉시 업로드(id만 상태에) + 드래그 정렬 + `소재 라이브러리` 픽커 · MP4는 진행률 바(실제 바이트) + 진행 중 이탈 확인 · **조건부 접힘** = 선택 채널 `capabilities`가 전부 텍스트면 72px 첨부 바(미디어 있으면 안 접고 amber 한 줄 `고른 채널에는 사진이 올라가지 않아요`) · 비율 경고 = 잘릴 영역 `bg-slate-950/60` 마스크 + amber 한 줄 + `[가운데 맞춤] [여백 채우기]` · MP4 판정 캡션 `Data source: 올린 파일에서 읽은 값 · 게시 전 서버에서 다시 확인합니다` · AI 선언 체크 1줄.
2. **채널 칩 줄**(다중 선택 · 브랜드색 점 7px + 이름 + 핸들 · `flex-wrap`) · 상태 6 = 연결 안 됨(회색 + 자물쇠 + **칩 아래 사유 글자** + 누르면 연결 구역 스크롤) / 연결됨·선택(`bg-violet-600`) / 연결됨·미선택 / 다시 연결 필요 / 계정 확인 필요 / 준비 중(2차). 다계정이면 칩 + 계정 드롭다운.
3. **캡션·태그 카드**(`OUI_CARD`) · 헤더 우측 `AI로 캡션 쓰기`(`OUI_BTN_OUTLINE` + Sparkles · 3상태 · 완료 후 `AI가 채운 문구입니다. 자유롭게 고쳐 주세요.` 줄 · 한 글자라도 고치면 사라짐 · `다시 쓰기`) · 태그 칩 3종(항상 붙음 `bg-white/10`+Lock / 골라 켜짐 `bg-violet-500/15`+Sparkles / 직접 `bg-white/5`+x) + 후보 줄(세트 중 안 켜진 것 · 누르면 올라감) + 입력칸 · 세트 비면 `태그 세트 만들기` 링크 + 사유 · 카운터 `12 / 30`(서버 값) · **글자수 게이지 1개 + 기준 채널 이름** + 초과 시 그 채널 칩에 표시 + `이 채널만 다르게`가 그 자리에(켜면 공통 문구 복사본 · `이 채널은 따로 쓴 문구를 씁니다` · `이 채널에도 적용`) · 표시 문장 예약 회색 구간 · 캡션 아래 고정 안내 줄 · 상품 링크 입력칸 1줄(AI 미경유).
4. **하단 sticky 바** = 예약 시각 + `게시하기`(**`OUI_BTN_SEND` = violet 단색 · 값 `operator-ui:55`**). `OUI_BTN_AI`(그라데이션 · 값 `QuickCampaignPage:450`) = 만드는 일. 토큰 주석 = "그라데이션 = 우리 안에서 만드는 일 / 단색 = 밖으로 나가는 일". 기존 발송 버튼 4벌 통일은 별건(§9).

미리보기 = 채널별 실물 프레임(비율 상자 + 계정 이름 한 줄 · 플랫폼 UI 모사 0 · 브랜드색은 점·아이콘까지 · 라벨 `채널 규격 틀`) · 여러 채널이면 가로 스크롤 · 비율은 `GET /api/sns/specs` 값.

### 4-3. 예약·이력

목록 1행 = 게시물 묶음(배지 사전 §3-5) + 채널 줄 N(배지 · 실패 사유 1문장 + `다시 시도` · `게시물 보기` ExternalLink · URL 원문 비노출) · 진행 중 행 있을 때만 폴링 + `visibilitychange` 복귀 1회 · 시각 표기 = 예약 시각·게시 확인 시각 · `Data source: 우리 기록과 채널에서 다시 확인한 결과`. 상세 모달 = 채널별 최종 캡션 · 미디어 · 상태 이력.

### 4-4. 확인 창 (게시 직전 1회)

채널별 최종 캡션·태그 전문(접이식) · 나가는 계정 칩 + 미리보기 축소본 1장 · 예약 시각 · (X) 링크 포함 시 실비 채널 고지 1줄(금액 0) · (2차 틱톡) 닉네임 + 공개범위 선택(기본값 0 · 미선택 = 게시 비활성) + 상업 콘텐츠 표시 줄 · 실행 함수는 **확인 창 state만** 읽음 · 서버 재검증 실패 `ACCOUNT_STATE_CHANGED` → 창 닫고 계정 구역 재조회 + 사유(이력 행 0) · 재시도 창 문장 `같은 글을 한 번만 올립니다`.

### 4-5. 문구 계약

- 메뉴 라벨 `SNS 게시` · 허브 카드 설명 `계정 연결 후 바로 게시`(11자) · 구역 제목 `SNS 계정 연결` · 버튼 `계정 연결` `게시물 만들기` `AI로 캡션 쓰기` `예약` `게시하기` `다시 시도` `연결 해제` `다시 연결`.
- 금지어 2층(§2-18). "실험실" 라벨 0(외부에 흔적을 남기는 기능에 품질 미보증 라벨은 성립하지 않는다). 모델명·줄표·내부 코드명 0. 사유 문장은 사전 함수 하나가 소유.

---

## 5. 단계 · 착수 원장

| 단계 | 범위 | 게이트 |
|---|---|---|
| **S0 준비**(코드 0) | Meta 개발자 앱(Instagram API with Instagram Login 유스케이스 + Threads 유스케이스) · 한줄로 인스타·Threads 계정 프로페셔널 전환 · 자사 계정 토큰 손으로 1개 → **curl로 게시·재조회·삭제 raw 1건**(채널별) · X 개발자 계정·결제(Harold) · 페이스북 페이지 · `information_schema` 5테이블 부재 확인 | raw 없이는 어댑터 코드 시작 0 |
| **S1 원장·연결** | DDL 5(`lock_timeout 3s`) · `routes/sns.ts` + 공개 라우터 · `ISnsAdapter` + instagram·threads 어댑터(raw 기준) · OAuth 시작·콜백·복귀 HTML·deauthorize · 토큰 워커 · 계정 카드·연결 구역·한 줄 진행 표시 · 요금제 축 `sns_publish` + ENV + 허브 플래그 endpoint(**타일보다 먼저**) | 자사 계정 `active` 1건 화면 확인 |
| **S2 미디어·캡션** | `sns_media` 업로드(이미지) · 미리보기 인증 라우트 · 서명 경로 · 게시본 확정 함수(JPEG 재판독) · `ASPECT_RATIOS` 3키 · 캡션 규칙 CT + `specs` · `POST /caption`(토큰 치환 · 세트 부분집합 · 출구 차단기) · 태그 세트 조회·지연 씨앗·편집 절 · 작성 구역 4단 · 확인 창 | 규칙 CT 계약 테스트(specs = 상수 · 상한) |
| **S3 게시·워커** | `sns_posts`·`sns_post_targets` · 저장·예약·게시·취소·재시도(새 행) · 발행 워커(선점·lock_token·컨테이너 폴링·재조회) · 대조 워커(회수·포기 24h·삭제 감지) · 소급 가드 + 첫 tick 무게시 · 멱등키(1차 실제 기록) · 크레딧 키 2개 호출 자리(값 0) · 이력 목록·배지 사전·상세 모달 · 허브 타일 + 필터 2곳 + 안내 항목 | **실측 1건** = 자사 인스타 피드 1건 → 30초 워커 → `verified_at` → 화면 `게시됨` + permalink → 삭제 → 대조 워커가 `게시물 없음` |
| **1차-A 배포** | 위 S1~S3 · ENV = 한줄로 회사 1개 | Codex 리뷰(돈 경로 자리·DDL 포함 = 대상) · tsc 0 · vitest 전체 |
| **1차-B** | MP4 업로드·Range 서빙·ISO-BMFF 파서(3파일) · instagram 릴스(asyncContainer) · facebook_page 어댑터(Facebook Login · 사진·영상) · x 어댑터(`metered` · `upload` · `verify:'deferred'` · 월 상한 fail-closed · 링크 고지) | 실측 = 릴스 1건 + X 1건(Harold 계정) |
| **2차** | 고객 개방(Advanced Access 심사 + 사업자 인증 · 심사 요구 화면 요소는 1차 화면에 이미 있음) · ENV `*` · 크레딧 값(Harold) + 요금제 안내 비용 칩 · `POST /api/sns/build`(BuildMaterials v1 · `buildBillingHash` payload 확장 · **RED 테스트 먼저**: SNS 재료만 다른 두 요청의 해시가 다른가) + SNS 화면 `재료로 만들기` 입구(QuickCampaignPage 탭 0) · 플래너 6번째 채널(수신자 없는 채널 축 = 별도 설계 · `PLANNER_CHANNELS` 미리 넣기 0 = exhaustive switch가 안전장치) · 스토리(`ephemeral`) · 틱톡(감사 · `requiresExplicitConsent` · `is_aigc`) · 유튜브(검증) · 인사이트·댓글·DM 응대 · 영상 자동 제작(ffmpeg · 쪽 이미지 → 슬라이드 MP4) · 만료 NEW 정리 | 각각 별도 착수 승인 |

---

## 6. 실측 게이트 · 시나리오

1. **어댑터 이전 raw 1건**(S0) = 자사 토큰 + curl: 컨테이너 생성 → 상태 조회 → 게시 → 게시물 조회 → 삭제. 응답 전문을 stdout으로 남기고 필드명·상태값을 어댑터 상수로 옮긴다(`console.log` · D217+ 규율).
2. **배포 전 1건**(S3) = 위 표. 추가 확인 = 같은 게시물 [다시 시도]가 새 target 행인가 · `claimed` 행 강제 종료 후 대조 워커 회수 · 예약 시각 25시간 전 행이 `failed(시각 경과)` + `[지금 올리기]` · ENV 꺼진 유료 회사가 `준비 중` 화면 · FREE 회사가 요금제 안내 창 · 서명 URL이 `verified_at` 뒤 404 · 화면 미리보기는 살아 있음.
3. **테스트 데이터** = 도달 가능한 값 생성 0(실 게시는 자사 계정 1건 · 즉시 삭제).

---

## 7. 미검증 목록 (설계에 그대로 싣는다 · 착수 전 확인 순서 = 번호)

① 플랫폼 응답 필드명·오류 코드·재조회 endpoint(저장소 호출 0 · S0 raw로 확정) ② Meta가 컨테이너 처리 중 미디어를 다시 가져가는지(TTL은 상태 결박으로 회피) ③ X 조회 과금 여부·단가(2차 출처 · `deferred`로 건수 비례 회피) ④ 플랫폼 AI 라벨 필드가 국내 표시 의무를 만족하는지 · 캡션 텍스트가 표시 대상인지(**Harold 결재**) ⑤ MP4 헤더 파싱 사전 판정 범위(코덱·오디오 불가) ⑥ 운영 DB `sns_*` 존재 여부 ⑦ Meta Advanced Access 심사 기간 ⑧ Threads 인증 창 주소가 Instagram Login과 다른지(별도 유스케이스는 확인) ⑨ 서명 쿼리스트링이 Range 재요청에서 떨어지는지(경로 세그먼트로 회피) ⑩ 플랫폼이 서명 URL을 캐시하는지(우리 쪽 `no-store`만) ⑪ `stripUnauthorizedBenefits` 부정 문맥 한계가 공개 게시물에서 어느 정도 위험인지.

---

## 8. 회의록 (2026-09-17 전원합의체)

### 8-1. 갈린 지점 15 · 결과

| # | 지점 | 1차 | 2라운드 | 결정 · 이유 |
|---|---|---|---|---|
| 1 | 명칭 | 기획 `SNS 운영` / 디·프 `SNS 게시` / 회 `소셜 게시` | 기획·프·백·회 `SNS 게시` / **디 `SNS 운영`**(자리 교차) | **`SNS 게시`** 4:1. 이름이 1차 실물보다 앞서면 안 된다(기획 스스로 "가장 약한 지점") · "SNS"는 화면에 이미 있는 낱말 · 2차 인사이트는 같은 화면 안. 디자이너 우려(2차에 좁아짐) 기록 = 댓글·응대 실물이 생기면 라벨 승격 여부 그때 Harold 결정(경로·코드 축 불변) |
| 2 | 계정 저장 | 기획 재사용 / 백·회 신규 | 전원 신규 | 신규 5테이블. 근거 = provider 조건 없는 조회 2곳(주재자 실코드 확인) |
| 3 | 화면 골격 | 기획 3층+탭4 / 디 탭3 / 프 스택 / 회 3층 형태만 | **기획·프 탭3 / 디·회 스택**(자리 교차) | **스택** 2:2 주재자 결정. `OUI_TAB` 실사용 0 · 자매 화면이 스택 · "작성이 첫 화면"은 스택 첫 구역으로 충족 · 회의론자 정정(미확정 행 있으면 이력이 위로 · 축소 바) 반영 |
| 4 | 1차 허브 타일 | 기획 없음 / 디·프 있음 | 전원 있음 | 타일 1장 + 서버 플래그 필터 2곳 + 등재 1곳 |
| 5 | 1차 채널 | 기획 A인스타+Threads·B릴스·X제외 / 회 전부 / 백 A·B·X제외 | 기획 릴스·X 1차 / 프 이미지 먼저·릴스 칩만 / 백 A·B / 회 X `metered` | **1차-A 이미지(인스타·Threads) → 1차-B 릴스·페북·X.** 영상은 Harold 요구 핵심이라 1차 안. 스토리는 `ephemeral` 계약 별도 → 2차 |
| 6 | AI 태그 | 기·프·디 AI 제안 / 회 AI 생성 금지 | 회 "면허 축"으로 후퇴 / 나머지 선택기 | **선택기**(부분집합 검사 · 오탐 0). 면허 축은 고유명사 판별기가 없어 강제 불가. Harold 원문은 켜진 채로 올라오는 칩 + 직접 입력으로 충족. 회의론자 최종 = 빈 세트 지연 씨앗 + 버튼 존치 |
| 7 | 크레딧 | 기획 제작만 / 회 캡션+게시 / 백 미등재 | 전원 "자리 예고 · 1차 0 · 경로 실행" | 키 2개 · 94자 키 · 1차 실제 키 기록. 값 = 2차 Harold. 프론트 "게시 과금 반대(분쟁)" 기록 |
| 8 | 상태값 | 백 6+`published_unverified` / 회 `submitted` | 백 7 고정 + stage / 회 증거 컬럼 | **7 + stage(기록 전용) + 증거 컬럼 · `published`⇔`verified_at` · 24h 포기 · `verify:'none'`** |
| 9 | 미디어 URL | 백 uuid / 회 서명+TTL | 백 서명 수용·TTL 반대 / 회 상태 결박 | **두 경로 분리 + 서명 = 상태 결박 + 36h 상한 + `media_id` + `salt`(1회용 아님)** |
| 10 | JPEG | 백 `force:'jpeg'` | 백 게시 직전 파일 확정 | 확정 파일 실제 형식 재판독(변환 함수 소유) |
| 11 | 자동제작 합류 | 기획 탭 추가 / 프 SNS 화면 입구 | 전원 프론트 안 | 서버 계약 하나 · 탭 0(DM 게이트 뒤) · RED 테스트 먼저 |
| 12 | 플래너 | 기획 ③ / 백 별도 설계 | 전원 별도 설계 | 1차 배열 0 |
| 13 | OAuth | 프 우커머스식 / 백 동기 구간 | 전원 + 백 origin·payload | + 회의론자 최종: `success` 제거 · `ineligible` · `stateNonce` 매칭 · 경로 platform |
| 14 | AI 표시 | 디 토글 기본 켜짐 / 회 차단 / 백 필드 | 디 토글 철회 / 회 "정면 충돌" 정정 / 백 `uploaded` 계약 | 끄는 토글 0 · 생성 자산 자동 · 업로드본 선언 체크 · 라이브러리 경유분만 판정 |
| 15 | 확인 창 | 전원 1회 | 전원 | + 계정 칩·축소본 · `ACCOUNT_STATE_CHANGED` |

### 8-2. 접은 것(역할별)

기획 = `SNS 운영` · 재사용 · 타일 보류 · 3층 스테퍼 · X 제외 · 릴스 1차-B · 탭 추가 · 플래너 ③ / 프론트 = 세로 스택(→탭 · 최종은 스택) · `/sns-posts` · 칩 3종(→유지) · 초안 url(→id) · 요약 타일 상단 / 백엔드 = 상태 4개 증식 · lease 시간 · uuid 공개 경로 · 멱등키 platform·account · 플랫폼 필드명 확정 표기 / 디자이너 = 탭 3 · 4번째 탭 인사이트 · 잠금 툴팁 · AI 표시 토글 · "AI가 만든 태그" · `SNS 게시`(→`SNS 운영` · 최종 결정에서 소수) / 회의론자 = AI 태그 금지 · `소셜 게시` · 1차 게시 차감 · 조회 재시도 전 채널 공통 · 짧은 TTL · "정면 충돌".

### 8-3. 회의론자 최종 검증 9개(전부 수용 · 본문 반영 위치)

① `sns_media` 신설(§3-1) ② 재조회 포기 24h · `verify:'none'`(§3-4·§3-5) ③ `failed→scheduled` 금지 · 재시도 = 새 행(§2-7·§3-2) ④ 빈 세트 지연 씨앗 + 버튼 존치(§3-8) ⑤ `ineligible` + `postMessage` `success` 제거(§3-10) ⑥ "연결 화면 1벌" 삭제 · 진행 표시 ② = active 1건 · 콜백 platform · `stateNonce`(§4-1·§3-10) ⑦ 소급 가드 24h + `[지금 올리기]` + 첫 tick 무게시(§2-15) ⑧ `cdp_assets` 미등재 · 자동 부착 범위(§2-12·§3-7) ⑨ `salt`·`stage` 기록 전용·`no-store`·`media_id`(§3-7). 추가 수용 = 금지어 2층 · 게이트 순서 · `준비 중` 화면 · lease 회수 주체 · specs = CT 상수 · 면허 = 원문 하나 · raw curl 게이트 앞당김 · 프론트 계약은 백엔드 스캔 · 1차 실제 멱등키 · 이중 차감 경로(재시도 새 행) · `ACCOUNT_STATE_CHANGED`.

---

## 9. 범위 밖 · 별건 (기록만 · 착수 판단 = Harold)

- `company_integrations` provider 조건 없는 조회 2곳의 fail-open 성질(`|| 'manual'`)은 SNS와 무관하게 다음 provider에서 같은 사고를 낸다.
- 허브 카드 만료 NEW 2장(이미지 스튜디오 07-19 · 플래너 08-12) · NEW 만료 장치 부재.
- 발송 버튼 색 4벌(DM 발행 · 이메일 발송 · 알림톡 · 자동제작) 통일.
- `OUI_TAB_ON/OFF` 미사용 토큰 정리.
- 혜택 차단기 목록·주석 불일치(`할인`).
- 시댄스 홍보 영상 프롬프트 연구 = 코드 밖 별도 작업.

## 10. 관련 문서

[FEATURE-CDP-INTEGRATION.md](FEATURE-CDP-INTEGRATION.md) · [2026-09-14 우커머스 설계서](2026-09-14-woocommerce-integration-design.md) · [FEATURE-AI-AUTO-BUILD.md](FEATURE-AI-AUTO-BUILD.md) · [FEATURE-MARKETING-PLANNER.md](FEATURE-MARKETING-PLANNER.md) · [FEATURE-IMAGE-STUDIO.md](FEATURE-IMAGE-STUDIO.md) · [2026-09-01 AI 이미지 표시](2026-09-01-ai-image-notice-design.md) · [2026-08-21 오퍼레이터 표면 단계](2026-08-21-operator-surface-tier-design.md) · [DECISIONS D90](../status/DECISIONS.md) · [LESSONS_BACKEND](../status/lessons/LESSONS_BACKEND.md) · [BUGS B-0904-5 · 818행 대조 회귀](../status/BUGS.md) · 회의 원문 = 세션 scratchpad(`sns-brainstorm-brief.md` · `round1.md` · `converged.md`).
