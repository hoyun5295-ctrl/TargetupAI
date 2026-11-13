# C133 한줄로 V3 — 설계서

> 1113 Harold 「우리의 강점은 부각시키고, 부족한 부분을 채우는 완벽한 한줄로 3.0 버전으로 올라갈거야」 · 「추천하는 것들은 한번에 설계할거고, 그에 맞는 컨트롤타워까지 고민해야 해」 · 「시작부터 결함없게 설계」 · 「설계서를 만들어 코덱스 리뷰를 닫힐 때까지 돌려, 그리고 구현까지 승인한다」.
> 회의 = 1113 브레인스토밍(COLLAB §1 · 기획 · 프론트엔드 · 디자이너 · 백엔드 · 회의론자 전원 · 1차 의견 → 교차 토론 1라운드 → 회의론자 최종 검증 「이 형태면 납득」). 갈린 지점과 택한 쪽 = §17.
> 재료 = 데이터라이즈 메시지 CRM 페이지(Harold 저장본 1113) · 경쟁사 AI 기능 조사(1113) · [Braze 대조](2026-11-05-braze-gap-check.md) · [ROADMAP](../status/ROADMAP.md) 5순위 · §W.
> 설계 리뷰 = Codex 적대 리뷰 7라운드(1113 · 지적 12 → 6 → 2 → 2 → 2 → 1 → 0 = 25건 전부 수용 · 7R approve). 큰 방향 전환 하나 = F5 회사 매핑을 발송 기록 판정에서 「수신 번호 = 회사」로(§7-3 · §17 · Harold 결정 사항 보고).
> ⛔ 내부 문서(로드맵 노출 금지). 화면 · 팝업 · 제안서에는 이미 켜진 기능만 싣는다.

---

## §0 범위

| 번호 | 기능 | 지금(1113 코드 확인) | V3 에서 바뀌는 것 | 배포 |
|---|---|---|---|---|
| F1 | 기본 여정 한 번에 켜기 | 흐름이 이미 있다 = 여정 지도의 「AI 진단 → 추천대로 초안 만들기 → 켜기 전 점검 → 모두 켜기」(`GapFinderModal` → `JourneyDiagnosisPanel` → `BatchActivateModal`). 여정을 실제로 쓰는 고객사 0곳(1112 Harold) | 입구 하나 더 · 추천 칸 5 → 8 · 켜기 전 **무료 추정**(대상 · 7일 발송 · 비용 · 잔액) · 혜택 질문 하나 · 창 갇힘 결함 수정. 엔진 새 코드 0 | B |
| F2 | 상품 단위 뿌리 + ① 고객별 추천 상품 ② 상품 반응 숫자 ③ 자사몰 행동 분석 + 바로 보내기(로드맵 5순위) | `%추천상품%` 은 이름과 기본값 글자뿐(`dm-variable-resolver.ts:16-25`) · 상품별 집계 0 · 퍼널 4단계만(`cdp-diagnostics.ts`) · `products` 표를 읽는 코드 0 | 뿌리 CT + 일별 집계 표 하나를 셋이 읽는다 | 뿌리 · ② · ③ = A / ① = C |
| F3 | 업계 평균 비교 | CT-66 `performance-benchmark.ts` 는 부르는 곳 0 · 기준이 요금제 · 다른 회사 1곳이면 그 회사 숫자가 그대로 보이는 결함 | 축 = 업종 · 회사 5곳 이상 · 비율만 · 성과 화면 숫자 카드 안 한 줄 + 통신사별 띠 | A |
| F4 | 일회성 캠페인 자동 배분 | 밴딧(CT-31)은 여정 · 자동 마케팅 · 인앱에만 | AI 한줄로 결과 창에서 켠 캠페인만 2단계 배분 | C |
| F5 | 답장 상담 | 답장을 받는 코드 0 | 수신 입구 계약 + 상담함 + 회사 매핑 + AI 답장 | D(Harold 수신 배선 뒤) |
| F6 | 쿠폰 만료 안내 | 쇼핑몰 쿠폰 데이터를 받는 코드 0(`woocommerce-core.ts:183` 은 쿠폰 주제를 일부러 버림 · 카페24 쿠폰 호출 0) | **이번에 코드 0**(받아올 데이터가 없다 · 회의 전원 합의). 같은 자리는 F1 의 포인트 소멸 · 생일이 맡는다 | 없음 |
| F7 | V3 소개 창 | 로그인 직후 `AiOperatorLoginPromo`(AI 기능을 못 쓰는 회사 · 로그인마다 1회 · `Dashboard.tsx:2421`) | 같은 창의 내용 교체(이미지 스튜디오 실샘플 + V3 기능) · 대상 넓힘 · 서버 기록 | A |
| F8 | 강점 부각 | — | 따로 띠를 만들지 않고 숫자 옆 한 줄(§9) | 각 기능과 함께 |

범위 밖(이번에 안 함) = 쇼핑몰 화면 안 AI 상품 검색 · 추천 위젯 / 화면에서 AI 가 먼저 말 걸기 · 먼저 전화 / 외부 AI 연결 / LINE / 쿠폰 데이터 수집.

구현은 이 설계서 하나 · 한 갈래에서 전부 끝낸다. **배포는 A ~ D 넷으로 끊는다**(§14). 새 기능은 전부 켠 회사 · 켠 캠페인에만 닿는다.

---

## §1 미가입 · 직접발송만 쓰는 회사 = 동작 변화 0 증명

| 기능 | 닿는 코드 | 미가입 · 직접발송 회사에서 일어나는 일 | 근거 · 시험 |
|---|---|---|---|
| F1 | 여정 화면 · 진단 · 묶음 켜기 창 · 시뮬레이터 응답 칸 | 여정은 요금제 관문(`journeyGate`) 뒤 → 화면에 못 들어온다. 직접발송 경로 무접촉 | T1-6(직접발송 파일 무변경 = 구문 트리) |
| F2 뿌리 | 새 워커 · 새 표 | 워커는 자사몰 사건 · 구매가 있는 회사만 훑는다. 발송 경로 무접촉 | T2-1 |
| F2 ① | 여정 문안 렌더 · DM 변수 · 이메일 | 후보 목록이 없는 단계 · DM · 메일 = 기존 글자 그대로(새 인자를 넘기지 않으면 옛 동작) | T2-8(후보 없는 입력의 렌더 결과 = 종전 글자 스냅숏) |
| F2 ② ③ | 성과 화면 탭 · 몰 상품 창 | 성과 화면은 요금제 관문 뒤 | — |
| F3 | 성과 화면 카드 · 새 워커(읽기) · 새 표 | 워커는 큐를 `app_etc1 = ?` 로만 읽는다(쓰기 0 · 환불 워커 무접촉). 화면은 관문 뒤 | T3-4(R94 지킴이 통과 글) |
| F4 | AI 한줄로 결과 창 토글 · 새 CT · 새 워커 | 토글을 켠 캠페인에만. 직접발송 화면 · `campaigns.ts` 발송 길 무변경 | T4-7 |
| F5 | 새 입구 · 새 표 · 새 화면(큐 읽기 0 · 발송 경로 무접촉) | 번호가 묶이고 상담을 켠 회사만. 그 밖의 회사에는 화면 · 단추 · 답장 0 | T5-9 |
| F7 | 로그인 직후 소개 창 | **미가입 회사는 지금도 로그인마다 이 창을 본다**(`AiOperatorLoginPromo.tsx:57-66`). 바뀌는 것 = 창 안의 글과 그림 · 노출이 「로그인마다 무한」에서 「최대 3회 + 다시 보지 않기」로 **줄어든다**. 발송 · 과금 · 데이터 0 | T7-3 |

돈 · 발송 경로에 닿는 자리 전부 = §12 영향표.

---

## §2 F7 V3 소개 창

### 2-1 모양(디자이너 수렴안 · 지금 창의 틀을 이어받는다)

- 창 = `components/AiOperatorLoginPromo.tsx` 그대로(파일 · 붙은 자리 `Dashboard.tsx:2421` · 2칸 판 · 포커스 가두기 · Esc · 탭 사이 잠금 · 로그인당 1회 표식). **한 장**(넘겨 보기 없음).
- 왼쪽 = 영상 자리 대신 **이미지 스튜디오가 만든 실샘플 포스터 3장**(세로 쌓기 · 모바일 가로 · `aspect-[3/4]` · 그 아래 한 줄 「이미지 스튜디오로 만든 예시입니다」).
- 오른쪽 = 머리말 「한줄로 V3」 → 제목 「상품 사진 한 장이 행사 포스터가 됩니다」 → 본문 한 줄 「사진을 올리고 문구만 적으면 완성본이 나옵니다. 만든 그림은 문자 · 모바일 DM · 이메일 · 자사몰 팝업에 그대로 씁니다.」 → 칩 줄(§2-3) → 버튼 「이미지 스튜디오 보기」 → 보조 「다음에 볼게요」 → 글자 버튼 「이 소개 다시 보지 않기」.
- 버튼 = `navigate('/image-studio')` 하나. 잠긴 회사는 기존 `PlanGate` 가 기능 안내 창으로 돌린다(갈래를 새로 만들지 않는다).
- 같이 고치는 결함 둘 = ① 바깥을 누르면 닫히는 처리(`:137`) 삭제(교훈 0704) ② 마케팅 진단 초대 창과 동시에 뜰 수 있음(`Dashboard.tsx:267` `loginPromoBlocked` 가 `showDiagnosisInvite` 를 모른다) → `blocked` 에 더한다.
- 기존 승인 목업의 색(violet)과 판 크기는 그대로 둔다(1006 Harold 목업 승인 · 이번 요구는 내용 교체).
- 금지 = 「업계 최고」 「무료」 「N% 상승」 같은 약속 숫자 · 영문 제품명 · 모델명 · 줄표.

### 2-2 대상과 기억

- 대상 = **고객사 사용자 전부**(가입 · 미가입 · 슈퍼관리자와 회사 없는 토큰 제외). Harold 「기존 고객사들도 관심」 「이미지스튜디오 잘 모르는 것 같아」.
- 한 사용자에게 **최대 3회**(로그인당 1회) · 「이 소개 다시 보지 않기」 = 그 계정에 영구(토스트 「이 계정에서는 다시 띄우지 않아요」). 3회 상한은 **서버가 한 문장으로 선점**한다(§2-4 · 두 기기가 동시에 떠도 넘지 않는다).
- 기억 = 서버(사용자 · 소개 판 단위). 새 표 `user_intro_acks`(§10 V3-DDL-1). 기기 저장소 표식(`SEEN_KEY`)은 「이 로그인에서 한 번」 용도로만 남긴다.
- 「모르면 띄우지 않는다」 유지 = 상태 조회 실패 · 표 없음(503) · 실샘플 3장 미만이면 띄우지 않는다.
- 기록 = 기존 `reportPlanFeature('login-promo', 'open' | 'go')` 그대로(구현 정정 1113 · 기능 id 를 바꾸면 슈퍼관리자 화면의 「로그인 안내 창」 줄이 끊긴다 → 옛 id 유지)(슈퍼관리자 「기능 관심 업체」에 보인다 · `utils/feature-interest.ts`).

### 2-3 칩 = 「그 회사가 지금 쓸 수 있는 V3 기능」만

- 서버 CT `utils/v3-intro.ts` 가 정한다. 칩 후보 = 고정 목록(아래) · 후보마다 **그 기능이 실제로 쓰는 판정 함수**를 그대로 부른다(같은 함수 = 약속과 실제가 어긋날 수 없다).

| 칩 | 글 | 보이는 조건 |
|---|---|---|
| 이미지 스튜디오 | 「사진 한 장으로 포스터」 | 늘 |
| 기본 여정 한 번에 | 「가입부터 재구매까지 한 번에 켜기」 | `v3Live('journey-pack', 회사)` |
| 상품 반응 | 「많이 본 상품 · 검색어에서 바로 보내기」 | `v3Live('product-insight', 회사)` |
| 업종 평균 비교 | 「같은 업종 평균과 견주기」 | `v3Live('benchmark', 회사)` |
| 반응 좋은 문안으로 | 「문안 여러 개 중 반응 좋은 쪽으로」 | `v3Live('split', 회사)` |
| 답장 상담 | 「고객 답장에 AI 가 먼저 답합니다」 | `v3Live('inbox', 회사)` |

- 칩은 최대 4개(목록 순서). 이미지 스튜디오 하나뿐이어도 창은 뜬다.
- `v3Live` = 단계 개방 CT `utils/v3-stage.ts`(§11) · ENV `V3_STAGE_<기능>` = 꺼짐(없음) · `all` · 회사 id 목록. 요금제 판정(`plan-guard`)이 **먼저**, ENV 가 뒤(sns_publish 와 같은 순서 · `plan-guard.ts:505-507` 주석의 사고).

### 2-4 서버

| 길 | 일 |
|---|---|
| `POST /api/plans/v3-intro/claim` | 본문 없음 · 로그인 표식은 **서버가 요청의 토큰에서** 만든다(sha256 앞 32자 · 구현 정정 1113 = 화면이 준 값을 믿지 않는다 · 로그인마다 다르다) → 대상이고 포스터 3장이 있을 때만 **한 문장**으로 선점. 성공한 로그인 표식을 행에 **3개까지 모아 둔다**(`login_marks text[]` · 노출 횟수 = 배열 길이): `INSERT (user_id, intro_key, login_marks) VALUES (…, ARRAY[$mark]) ON CONFLICT (user_id, intro_key) DO UPDATE SET login_marks = array_append(a.login_marks, $mark), updated_at = now() WHERE a.dismissed_at IS NULL AND cardinality(a.login_marks) < 3 AND NOT ($mark = ANY(a.login_marks)) RETURNING cardinality(login_marks)`. 행이 돌아온 요청만 `{ show: true, posters, chips }` · 아니면 `{ show: false }`. 같은 로그인의 늦은 · 겹친 요청이 다른 로그인 요청 사이에 끼어도(A → B → A) 다시 세지 않는다 |
| `POST /api/plans/v3-intro/dismiss` | 해제 시각 기록(늘 성공 · 이미 해제면 그대로) |

- 화면 = 기기 표식을 잡은 탭만 claim 을 부르고 `show: true` 일 때만 띄운다(「띄운 뒤 세기」가 아니라 「세고 나서 띄우기」 · 띄우지 못하고 닫히면 한 번이 소진될 뿐 넘지 않는다).
- 라우트는 `routes/plans.ts`(feature-seen 이 사는 곳)에 얇게 · 판정 · SQL 은 CT 에.
- 포스터 = `listTemplatesPublic()` 중 `findTemplateSample(id)` 가 있는 것 · 회사 업종(`resolveCompanyIndustry` → `studioIndustryCategories`)에 맞는 카테고리를 먼저 · 모자라면 나머지에서 채워 3장. 주소 = 기존 공개 실샘플 길 `/api/image-studio/template-sample/:id?v=`.
- 표가 없으면(DDL 전) 세 길 모두 503 `DB_MIGRATION_PENDING` → 화면은 띄우지 않는다.

---

## §3 F1 기본 여정 한 번에 켜기

### 3-0 지금 0곳인 이유(회의 판정)

흐름은 있다. 걸림돌 = ① 입구가 지도 화면 안쪽 ② 예상 대상 · 비용이 **유료 사전 검사를 통과한 뒤에만** 보인다(`BatchActivateModal.tsx:278-280`) ③ 추천 칸이 다섯뿐(장바구니 · 조회 후 미구매 · 생일 없음) ④ 혜택을 말할 자리가 없어 초안이 혜택 없는 글로만 나온다 ⑤ 응답이 안 오면 창이 닫히지 않는다(`disableDismiss={running}` + fetch 시간 제한 없음).

### 3-1 바꾸는 것(엔진 · 켜기 관문 · 차감 = 무변경)

| # | 자리 | 지금 | V3 |
|---|---|---|---|
| 1 | 입구 | 지도 화면 시작 카드 「AI 진단」 | 그대로 + `/ai-journeys` 「오늘의 여정 기회」 카드 머리에 단추 「기본 여정 한 번에 켜기」 → `/ai-journeys/map?open=diagnosis`(지도 화면이 열쇠를 읽어 진단 창을 연다 · 열쇠는 읽은 뒤 주소에서 지운다) |
| 2 | 추천 칸 `buildFlowPlan` | 가입 · 첫 구매 · 재구매 · 휴면 · 복귀 | + 장바구니(`cdp.cart_abandon`) · 조회 후 미구매(`cdp.browse_no_purchase`) · 생일(`customer.birthday_approaching`). 셋 다 추출기가 시간 창으로 대상을 고른다(장바구니 · 조회 = 24시간 띠 `journey-target-extractor.ts:257-258 · 300-301` · 생일 = 놓친 날 보충 최대 `days_before` `:99-108`). 데이터가 없는 회사는 기존 `locked` 사유 그대로(`resolveTriggerAvailability`). 포인트 소멸 임박은 기준 포인트(`points_min`)를 지어낼 수 없어 넣지 않는다(손으로 만드는 길 그대로) |
| 3 | 혜택 | 추천 초안은 혜택 답 없이 설계(`routes/ai.ts:3323-3331` answers 에 `:benefit` 없음) | 진단 창에 선택 칸 하나 「드릴 혜택이 있으면 적어 주세요(없으면 비워 두세요)」 → `answers[reco-<key>:benefit]` 로 넘긴다(인터뷰가 이미 받는 답 `journey-interview.ts:120 · 215`). 비우면 지금처럼 혜택 없는 글. AI 는 적힌 혜택만 쓴다(`journey-interview-ai.ts:51`). 요청 키 `recoRequestId` 에 혜택 글을 넣는다(다른 혜택 = 다른 요청) |
| 4 | 무료 추정 | 검사 통과 뒤에만 7일 예상 · 발송비 | 창을 열 때 · 고를 때 줄마다 `GET /operator/journeys/:id/simulate`(모델 호출 0 · 실발송과 같은 뽑기 함수 `journey-simulator.ts`)를 불러 「지금 대상 n명 · 예상 발송 x건 · 발송비 약 y원」을 **검사 전에** 보인다. 사건형은 「최근 사건 기준 약」(`approximate`) |
| 5 | 켜자마자 멈춤 | 시뮬레이터 경고 문장으로만 | 응답에 판정 칸 `firstRoundCapExceeded: boolean` 을 더하고(같은 `entryCapExceeded`) 참이면 그 줄에 「켜면 바로 멈춰요 · 최대 인원을 n명 이상으로 늘리거나 비워 주세요」 + [모두 켜기] 잠금. 판정은 **지금 칸에 적힌 값**으로 한다: 시뮬레이터에 저장 전 값을 넘기는 선택 인자 `cap`(`?cap=숫자` · `?cap=none` = 비움 · 없으면 저장된 값 = 종전)을 더하고, 칸을 고칠 때마다 다시 묻고(입력 멈춘 뒤) 앞선 응답은 버린다(요청 세대). 저장은 지금처럼 [모두 켜기]가 한다. **최대 인원은 계속 선택 칸이다**(1101 Harold 「고객사가 최대 인원을 안 정하면 안 해도 되잖아」 · 회의의 「필수」 안은 이 결정과 어긋나 폐기) |
| 6 | 아래 줄 | 「n개 켜기 · 처음 켜기 크레딧」 | 「n개 켜기 · 예상 발송 x건 · 발송비 약 y원 · 처음 켜기 z 크레딧」 + 선불 회사는 잔액이 y 보다 적으면 「잔액이 모자라요 · 충전 뒤 켜 주세요」(버튼은 잠그지 않는다 = 켜기 관문 무변경 · 안내만) |
| 7 | 피로도 | 창에 없음(「피로도는 겹침 해소 선택지가 아니다」 주석) | 회사 상한이 꺼져 있으면 안내 한 줄 「한 고객이 받는 광고 문자 상한이 꺼져 있어요」 + 링크 [설정에서 정하기]. 값은 여기서 저장하지 않는다(상수를 지어내지 않음 · 기존 설정 화면) |
| 8 | 갇힘 | fetch 시간 제한 없음 · 진행 중 닫기 잠금 | 구간을 둘로 가른다. **검증 구간**(최대 인원 저장 · 여정별 사전 검사) = `fetchJson` 시간 제한 · 닫기 = 취소(`runId` 세대 올림 · 남은 검증을 더 부르지 않는다) · 「n/N 검증 중」. **켜기 접수 뒤**(`journeys-activate-batch` 요청을 보낸 뒤 = 서버가 여정을 차례로 켜고 차감한다 · 화면이 멈출 수 없다 `journey-activation.ts:332-348`) = 닫기 = **숨김**(「켜는 중이에요. 닫아도 계속 켜져요」) · 응답이 오면 결과 카드 · 응답을 못 받았으면(시간 제한 · 닫았다 다시 엶) 지도를 다시 읽어 여정 상태로 결과를 보인다(되돌리지 않는다 · 다시 누르면 이미 켜진 여정은 「다시 켰어요 0 크레딧」 = 기존 멱등) |

### 3-2 서버 변경

- `utils/journey-opportunities.ts` = `FlowPlanKey` 에 `cart` · `browse` · `birthday` · `buildFlowPlan` 항목 셋(간격은 참고 간격 `measured: false` · 근거 문장은 「시작 사건이 일어난 때 바로」 · 한 칸 `[0]`).
- `routes/ai.ts` `/operator/journeys-reco/design` = `benefit` 본문 칸 받기(문자열 · 200자 · 비면 없음) → answers 와 `recoRequestId` 에.
- `utils/journey-simulator.ts` = 결과 칸 `firstRoundCapExceeded` · `prepaidBalance`(선불 회사만 · `companies.balance`) 추가. 경고 문장은 그대로.
- 새 표 · 새 칸 0.

### 3-3 화면 변경

- `JourneysPage.tsx` 기회 카드 머리 단추 · `JourneyMapPage.tsx` 가 `open=diagnosis` 를 읽음 · `JourneyDiagnosisPanel.tsx` 혜택 칸 + 새 칸 셋(목록은 서버 응답 그대로 그린다 = 화면 수정은 혜택 칸뿐) · `BatchActivateModal.tsx` 표 3-1 의 4 ~ 8.
- 색 = 그 창이 쓰는 violet 그대로. 숫자 칸 = `flex-1 min-w-fit rounded-lg bg-slate-50 tabular-nums`.

---

## §4 F3 업계 평균 비교

### 4-1 판정(CT-66 `utils/performance-benchmark.ts` 를 고친다 · 새 파일 0)

- 축 = `companies.industry_code`(브랜드 학습 창이 15종 허용 목록으로 저장 `brand-basic-info.ts:20 · 26-36` · 판독 `resolveCompanyIndustry`). 비어 있으면 「브랜드 학습 창에서 업종을 고르면 같은 업종과 견줘 드려요」.
- 지표 = **비율만**: 발송 성공률(`campaigns.success_count / sent_count` · 최근 30일 · `status = 'completed'`) · 통신사별 성공률 · 통신사별 스팸 차단율(§4-3). 절댓값(캠페인 수 · 발송 건수 · 활성 고객 수)은 다른 회사 규모가 드러나므로 응답에서 뺀다.
- 최소 회사 수 = **지표마다** 실제로 평균에 든 다른 회사 수 k ≥ 5(자기 회사 제외 · 그 기간 그 지표의 분모 > 0 인 회사만). 모자라면 그 지표는 `{ available: false }`. 화면은 「같은 업종 회사가 아직 적어 평균을 보여 드리지 않아요」(모자란 수 · 정확한 k 는 싣지 않는다 · 보일 때도 「5곳 이상 기준」).
- 평균 = 회사별 비율의 산술 평균(큰 회사 하나가 평균을 끌지 않게).
- 시험 회사 제외 = 합성 데이터 회사 · 사내 회사는 평균에서 뺀다(판정 칸은 구현 직전 `companies` 칸 확인 · 없으면 ENV `BENCHMARK_EXCLUDE_COMPANY_IDS`).
- 계산 시점 = 하루 1회 야간 워커가 **회사마다 그 시점의 업종 · 지표 값**을 새 표 `benchmark_company_daily`(§10 V3-DDL-4)에 쓴다(분모가 0 인 회사 · 업종 빈 회사 · 뺄 회사는 행 없음). 화면 요청은 **가장 최근 날짜의 그 스냅숏만** 읽는다: 내 값 = 내 행 · 평균 = 같은 날 · 같은 업종 · 같은 지표의 **다른 회사 행**의 산술 평균 · k = 그 행 수. 내 행이 없으면(그날 분모 0 · 업종 없음) 비교하지 않는다. 야간 뒤에 결과 · 업종이 바뀌어도 한 스냅숏 안에서 빼고 세므로 어긋나지 않는다(응답에는 평균과 차이만 싣는다 · 다른 회사 행은 서버 밖으로 나가지 않는다).

### 4-2 화면

- `PerformancePage.tsx` 머리 숫자 카드 「성공률」 한 장의 보조 줄 = 「업종 평균 97.1% · 1.2%p 높음」(`HeadlineKpiCard` 에 선택 prop `bench` · 없으면 무변화 · 차이 색은 기존 `diffColor`). 칩 칸 무변경.
- 통신사 띠(§4-3) = 카드 아래 `ZoneStatStrip` 한 줄 「우리 발송망에서 직접 잰 값 · 캠페인 발송 기준」. 통신사마다 「성공률 · 업종 평균」 · 「스팸 검사 차단율 · 업종 평균」. 데이터가 없는 칸은 그리지 않는다.

### 4-3 통신사별 숫자

- 성공률 = 새 워커 `carrier-rollup-worker` 가 `result_final = true` 인 캠페인을 결과 화면과 **같은 함수**(`classifyResultTables` · `smsUnionGroupBy(companyTables, 'mob_company', 'WHERE app_etc1 = ? …')` `routes/results.ts:611-632`)로 묶어 새 표 `campaign_carrier_results`(캠페인 · 통신사 · 성공 · 실패 · 덮어쓰기 · §10 V3-DDL-5)에 쓴다. `campaigns` 표에는 칸을 더하지 않는다(굴린 시각은 새 표의 `rolled_at` · 다시 굴릴 조건 = `campaigns.result_synced_at > rolled_at`). 환불 워커 `campaign-sync-worker` 무접촉. 큐 조회는 `app_etc1 = ?` 좁힘(R94 지킴이 통과).
- 일 단위 · 업종 단위는 읽을 때 합친다(결과가 되돌려져도 다음 굴림이 그 캠페인 행을 덮는다).
- 실패 행에 통신사가 비어 있으면 그 수는 `unknown` 으로 모으고 통신사별 성공률을 내지 않는다(그 통신사 칸 `available: false`). **켜는 순서 = 직원이 결과 화면 3건과 굴린 값을 맞춘 뒤**(원장 C133-A-P2).
- 스팸 차단율 = PG `spam_filter_test_results`(통신사 · 결과 · 이미 있는 표) 최근 30일 회사별 차단 비율.

---

## §5 F2 상품 단위 뿌리 + 셋

### 5-1 뿌리 = CT `utils/product-signal.ts` + 표 `product_signal_daily`

- **상품 식별 = (문, 키)** · 이미 있는 규칙을 그대로 쓴다(`journey-product.ts:36-56` · 자사몰 = `productId` 없으면 `productName` · 매장 원장 = `product_code` 없으면 `product_name` · 「몰 123번 ≠ 매장 123번」). `products` 표는 쓰지 않는다(읽고 쓰는 코드 0).
- 자사몰 조회 · 장바구니 사건의 상품 = `properties.items[]`(SDK 가 GA4 `view_item` · `add_to_cart` 를 `{ product_id, product_name, price, quantity, category }` 로 옮긴다 `sdk-js/src/auto-capture/ecommerce.ts:33-44`) 또는 사건 맨 위의 같은 이름 칸(직접 부르는 `viewProduct(p)`). 키 = `productId` → `product_id` → 이름(`productName` → `product_name`) 순서의 첫 값. **이 한 식을 SQL 조각 + JS 판정 한 벌로 CT 에 둔다**(주문 키 식과 짝 시험).
- 표(§10 V3-DDL-2) = 회사 · 문 · 상품 키 · KST 날짜마다 한 행: `views · carts · orders · revenue · product_name(그날 본 마지막 이름)`.
- 쓰는 곳 = 워커 `product-signal-worker` 하나(하루 1회 야간 · 회사를 하나씩). **회사마다 창 30일 전체를 다시 세어 그 회사의 30일치 행을 한 트랜잭션에서 통째로 바꾼다**(지우고 넣기). 커서 · 「다시 셀 날」 기록을 두지 않는다 = 늦게 들어온 옛 사건 · 구매 정정(매장 구매 적재는 같은 행을 고쳐 쓰고 적재 시각을 바꾸지 않는다 `SCHEMA.md:1360`) · 취소로 바뀐 결제 여부 · 처음 채우기가 모두 같은 한 길로 닫힌다(Codex 설계 2R 지적 둘의 뿌리 = 「무엇이 바뀌었는지」를 따로 추적하려던 것).
  - 조회 · 장바구니 = `cdp_events`(색인 `(company_id, event_name, occurred_at)` · 30일 범위) / 주문(자사몰) = 결제된 구매 사건의 상품 줄(`mallItemsSql` · `mallItemKeySql` · `netPurchaseSql`) / 구매(매장) = 구매 원장(`LEDGER_PURCHASES_SQL` · `ledgerProductKeySql`).
  - 대상 회사 = 최근 30일에 조회 · 장바구니 · 구매가 하나라도 있는 회사 + 표에 행이 남아 있는 회사(창 밖으로 밀린 행을 지우려고).
  - 한 회사의 계산이 실패하거나 시간 제한에 걸리면 그 회사의 옛 행을 그대로 둔다(반쯤 바뀐 상태 0) · 로그 + 다음 밤 다시. 30일 밖 행은 같은 트랜잭션에서 지워진다.
  - 비용 = 밤 한 번 · 회사별 30일 범위 색인 조회. 배포 A 전에 사건이 가장 많은 회사의 30일 사건 수와 실행 계획을 잰다(§15).
- 읽는 곳 = 이 CT 의 함수만(② ③ · 추천 후보 제안 · 추천 고르기). 모든 읽기에 `company_id`.
- 창 = 한 상수 `PRODUCT_SIGNAL_WINDOW_DAYS = 30`(이미 쓰는 퍼널 창 30일과 같은 값 `cdp-diagnostics.ts buildCdpFunnel`). 화면 · 후보 · 고르기가 같은 창.

### 5-2 ③ 자사몰 행동 분석 + 바로 보내기(로드맵 5순위)

- 자리 = **성과리포트 탭 「상품 · 검색어」**(로드맵 5순위 6번 「성과 메뉴에서 보이게」). 자사몰 설정의 분석 창(`CdpAnalyticsPanels`)은 변화 0 · 그 안의 차트 부품(`ChartCard · FunnelBar · StatBox`)을 `components/cdp/cdp-chart-parts.tsx` 로 떼어 두 곳이 같이 쓴다. 깔때기의 영어 이름표(`page_view` · `cart_add` · `:160-163`)는 한국어로.
- 상품 표(정렬 · 빈 상태 · 모바일은 카드 1열) = 상품 · 조회 · 장바구니 · 구매 · 조회 대비 구매 비율 · 지난 30일 대비 차이. 문이 둘이면 문 표시(「자사몰」 「매장」).
- 줄 끝 버튼 = 「보고 안 산 고객 n명에게 보내기」(n = 최근 30일 그 상품을 본 식별 고객 중 그 뒤 그 상품을 두 문 어디서도 안 산 고객 · 수신 동의 · 보는 사람의 매장 범위 안). 누르면 **직접발송 창이 그 고객들로 채워진 채 열린다**(대시보드 `?open=direct-send&from=product-signal` · 대시보드가 서버에서 명단을 다시 받아 `setDirectRecipients` · 창 머리에 「분석 화면 312명 → 지금 305명」). 대상은 조건(상품 · 기간)으로 정해지고 예측은 쓰지 않는다. 수신거부 · 중복 · 회신번호 검사는 직접발송 길이 그대로 한다.
- 검색어 순위 = `search` 사건의 `search_term`(SDK `ecommerce.ts:60-63`) · 최근 30일 · 회사 범위에서 그때그때 세어 위 50개(검색 수 · 검색한 고객 수) · 줄 끝 「이 말을 찾은 고객 n명에게 보내기」(같은 길).
- 자리별 클릭률(인앱 배너 · 팝업) = 이미 있는 인앱 통계 CT 가 메시지별 노출 · 클릭을 주면 그 응답을 그대로 표로(새 집계 0). 주지 않으면 이번 탭에서 뺀다(구현 직전 `inapp-funnel-stats` 확인 · 새 쿼리를 지어 넣지 않는다).
- 사건이 안 들어오는 회사 = 빈 상태 「자사몰 연결 뒤 상품 조회가 들어오면 여기에 보여요」 + 연결 화면 링크.

### 5-3 ② 상품 반응 숫자

- 담당자용 = 몰 상품 고르는 창의 상품마다 「최근 30일 조회 n · 구매 m」(뿌리 표 조회 · 없으면 표시 없음).
- 받는 사람용 = DM 상품 묶음(`product_carousel`) · 이메일 상품 카드에 선택 토글 「반응 숫자 표시」. 켜면 저장하는 순간 서버가 상품마다 **글자를 고정**해 싣는다(예 「최근 30일 1,240명이 봤어요」). 보여 줄 때 다시 세지 않는다(저장 렌더 고정 원칙). 편집기는 나갈 글자를 그대로 보이고 담당자가 상품마다 끌 수 있다. 숫자가 없는 상품은 글자 없음. 문구에 「인기 1위」 같은 순위 · 재고 약속 금지.

### 5-4 ① 고객별 추천 상품 = CT `utils/product-reco.ts`

**한 원칙: 나갈 수 있는 것은 담당자가 본 후보 집합뿐이고, 고르는 규칙은 예측이 아니라 설명 가능한 순서다.**

- 고르기(한 함수 `pickRecoForCustomer(회사, 고객, 후보[])` → 후보 순서):
  1. 고객이 최근 30일에 **봤고** 그 뒤 **안 산** 후보 중 가장 최근에 본 것
  2. 없으면 후보 순서(= 저장 때의 판매 · 조회 순)에서 고객이 **안 산** 첫 후보
  3. 없으면 「없음」(문자는 대체 문장 · DM · 이메일은 저장한 순서 그대로)
  - 「산 것」 = 매장 + 자사몰 두 문(`purchaseFactsSql`) · 같은 (문, 키) 또는 같은 이름(공백 정리). 매장에서 이미 산 상품을 다시 권하지 않는다 = 자사몰만 보는 경쟁사가 못 하는 것(F8).
  - 최근 30일 뿌리 표에 관측이 없는 후보는 건너뛴다(끊긴 상품). 품절 판정은 하지 않는다(`fetchInventory` 는 늘 재고 있음을 돌려주는 껍데기 `connected-content.ts:314-334`) · 재고를 약속하는 문구 금지.
- **DM** = 상품 묶음에 토글 「받는 분마다 관심 상품을 앞에」. 후보 = 담당자가 몰 상품 창에서 고른 그 상품들(그림 · 가격 · 링크는 고른 값 그대로). 보는 순간(`dm-viewer.ts` 가 고객을 아는 때) 순서만 바꾼다. 새 내용이 생기지 않는다. 고객을 모르면 저장 순서.
- **이메일** = 상품 카드 묶음에 같은 토글 · 보내는 순간 순서만 바꾼다.
- **여정 문자 칸** = 본문 안의 추천 자리 하나: `<추천상품: 수분크림 | 선크림 | 세럼 || 요즘 많이 찾는 상품>`(후보 이름들 `|` · `||` 뒤가 대체 문장).
  - **후보를 본문 글자 안에 싣는다 = 새 칸 0.** 판(스냅숏) · 켠 뒤 고친 문안 · 주간 재검사 · 재작성 후보 표는 모두 「본문」을 한 덩어리로 옮기고 검사한다. 후보가 본문 밖 칸에 있으면 그 길마다 따로 복사 · 무효화를 달아야 하고 하나라도 빠지면 「검사한 글 ≠ 나가는 글」이 된다(Codex 설계 1R 지적 둘의 뿌리). 본문 안에 있으면 본문을 옮기는 모든 길이 후보를 함께 옮기고, 후보를 고치는 것 = 본문을 고치는 것이라 기존 무효화 · 재검사 규칙이 그대로 걸린다.
  - 자리 문법은 지금 있는 세 문법(`%변수%` · `{{ }}` `{% %}` · 채울 자리 `[… 직접 …]`)과 겹치지 않는다. 날것으로 보여도 사람이 읽을 수 있다. 본문에 한 번만.
  - 후보 = 창이 시스템 제안(최근 30일 판매 · 조회 위 순)을 **전부 보여 주고** 담당자가 고른다 · 최대 **3개** + **대체 문장 1개**(필수 · 담당자가 쓴다). 이름 · 대체 문장에 `< > | % { } [ ]` 와 줄바꿈은 쓸 수 없다(저장 때 거절).
  - 판정 자리 넷(각자 한 곳):
    1. **렌더** `renderJourneySmsMessage` = 고른 글자가 **변수 · 조건 문법으로 다시 읽히지 않게** 두 걸음으로: 맨 앞에서 자리를 영문 · 숫자로만 된 임시 표식으로 바꿔 두고(본문에 없는 글자열) → 기존 길(글자 정리 · `%변수%` · Liquid · 광고 표기)이 끝난 **뒤에** 표식을 고른 글자로 바꾼다(`pickRecoForCustomer` · 검사용 선택 입력 `recoIndex` = 몇 번째 판으로 강제). 고른 글자는 건너뛰는 것이 변수 · 조건 해석뿐이다: 넣기 전에 본문과 **같은 글자 정리 함수**(`sanitizeUnsendableForSms`)를 거치고, 바이트 · 문자 유형 · 검사는 넣은 뒤의 최종 글로 한다(검사 길의 `cleanSmsTextAll` 도 렌더가 끝난 글에 걸린다). 자리가 없는 본문은 **한 글자도 달라지지 않는다**(T2-8).
    2. **보낼 판 목록** `journey-step-versions.ts` = 검사용 펼침 함수 `expandRecoVersions(판)` 가 자리 있는 판을 후보마다 + 대체 문장으로 펼친다(N + 1 · 각 판에 `recoIndex`). 켜기 검사 · 2시간 전 재검사 · 주간 재검사 · 재작성 후보 검사가 이 함수 하나로 검사 목록을 만든다(네 호출부가 같은 함수를 부르는지 구문 트리 계약 T2-9). 금칙어 · 채울 자리 · 실폰 스팸 검사를 판마다. 바이트 · 문자 유형 = 가장 긴 판(SMS 90 을 넘는 판이 있으면 저장 때 막고 사유 · 상품명을 자르지 않는다).
    3. **보낼 글 판정** CT-J10 `journeyCopyIssue` = 자리 문법이 틀렸거나(후보 0 · 4개 이상 · 대체 문장 없음 · 금지 글자 · 두 번) 쓸 수 없는 칸이면 막는다. **후보 이름 · 대체 문장에 보낼 수 없는 글자(이모지 등 · 본문 글자 판정과 같은 CT)가 있으면 저장 때 막는다**(정리로 사라질 글자를 승인 집합에 두지 않는다 = 담당자가 본 글자 = 나가는 글자). **자리가 다른 문법 안에 끼어 있어도 막는다**(자리를 임시 표식으로 바꾼 글에서 `%…%` 변수 조각이나 `{{ }}` · `{% %}` 안에 그 표식이 들어 있으면 거절 = `%<추천상품: 고객명 || 고객명>%` 처럼 바꾼 뒤 변수가 되는 꼴 · 조건식 안에 넣는 꼴). 맞는 자리는 모르는 변수로 보지 않는다.
    4. **다시 쓰기** `regenerateStepAvoidingSpam` = 본문에 자리가 있으면 다시 쓰지 않는다(null · 2시간 전 · 주간 두 길이 이 생산자 하나를 부른다). 걸린 판이 있으면 그 칸은 보류하고 담당자에게 「추천 후보 ○○ 가 스팸 검사에 걸렸어요. 후보에서 빼 주세요」(후보를 빼는 것은 담당자가 본문을 고치는 일 = 새 판 + 재검사).
  - 쓸 수 없는 칸 = 알림톡 칸(승인 템플릿이 본문) · A/B 변이가 있는 칸과 변이 본문(검사 판 수가 변이 × 후보로 불어난다 → 「문안 A/B 를 쓰는 칸에는 추천 상품을 넣을 수 없어요」) · 제목.
  - AI 문안 수정 길 = 자리가 있는 본문을 AI 가 고친 결과에 자리가 글자 그대로 남아 있지 않으면 그 수정을 받지 않는다(같은 CT-J10 판정이 저장 때 본다).
  - 미리보기 = 「받는 모습」을 세 갈래로(가장 긴 후보 · 가장 짧은 후보 · 대체 문장 = `recoIndex` 로 서버가 렌더) + 「최대 길이 기준 n바이트」. 「대체 문장으로 나가는 인원」은 대상 전원을 세지 않고 「관심 상품이 없는 분은 대체 문장으로 나가요」라고만 적는다(숫자를 지어내지 않는다).
  - 고객 맞추기 = 후보 **이름**으로(본 상품 · 산 상품의 이름을 뿌리 표와 구매 사실에서 읽어 공백 정리 뒤 비교). 이름이 안 맞으면 2번 · 3번 갈래로 내려갈 뿐 후보 밖 글자는 나가지 않는다.
  - 실제 나간 상품은 따로 남기지 않는다(새 칸을 늘리지 않는다 · 큐의 나간 글에 이름이 있다 · §16).
- 쓸 수 있는 회사 = 최근 30일 뿌리 표에 조회 또는 구매가 있는 회사 ∧ `v3Live('reco', 회사)`. 아니면 칩 · 토글이 잠기고 이유 한 줄.
- 이미 있는 다른 길 `{{ cart.* }}`(장바구니 값을 제한 없이 채움 `cdp-events.ts:320-339`)은 이번 축 밖 = BUGS 등재만(META 27).

---

## §6 F4 일회성 캠페인 자동 배분

### 6-1 모양

- 켜는 자리 = AI 한줄로 결과 창(`AiCampaignResultPopup`)의 문안 3안 자리 토글 「문안을 나눠 보내고 반응 좋은 쪽으로」(기본 꺼짐 · `v3Live('split', 회사)` 인 회사만 보인다). 직접발송 창 · 다른 발송 입구에는 없다.
- 켤 수 있는 조건(아니면 토글 잠금 + 이유) = 문자(SMS · LMS)만 · 고른 문안 2 ~ 3개가 **같은 유형** · **모든 문안에 링크**(클릭으로만 반응을 잰다) · 개별 회신번호 미사용.
- 담당자가 정하는 것 둘(기본값 없이 고른다 · 상수를 지어내지 않음) = 먼저 보낼 몫(10 · 20 · 30%) · 기다릴 시간(1 · 3 · 6시간 · 다음 날 같은 시각).
- 확인 창 = 문안 전부 · 문안마다 바이트 · 예상 인원(먼저 보낼 인원 = 문안별 균등 · 나머지 인원) · 나머지가 나갈 시각(21시 ~ 8시에 걸리면 「다음 날 08시에 나가요」) · 비용 합계.
- 흐름: ① 지금(또는 예약 시각) 먼저 보낼 몫을 문안별로 균등하게 발송 ② 기다린 뒤 문안별 클릭률로 승자 ③ 나머지 전원에게 승자 문안 발송 ④ 결과 화면에 「먼저 보낸 결과 · 이긴 문안 · 나머지 발송」.
- 승자 판정 = 문안별 **한 번 이상 누른 받는 사람 수** / 발송 성공 수(반복 클릭 · 링크 여러 개를 사람 한 명으로 센다 · 클릭 합계 `getCampaignClickTotal` 은 쓰지 않는다) · 밴딧 CT 의 신뢰 구간(`computeBetaCredibleInterval`)이 **겹치지 않을 때만** 승자. 겹치거나 · 받는 사람별 클릭을 셀 수 없거나(짧은 링크가 받는 사람마다 만들어지는지 = 구현 직전 `message_short_urls` 칸 확인 · 안 되면 이 기능은 「판정 불가」로만 끝난다) · 시험 묶음 결과가 아직 확정 전이면 **판정 불가** = 첫 문안(담당자가 맨 앞에 둔 것)으로 나가고 「차이가 뚜렷하지 않았어요」. 지어낸 최소 건수 기준은 두지 않는다.

### 6-2 길(절대 보호 파일 `routes/campaigns.ts` 수정 0)

- CT `utils/campaign-split.ts` + 워커 `campaign-split-worker` + 표 둘(§10 V3-DDL-6).
- 대상 = AI 한줄로가 정한 대상 조건을 **캠페인 발송 길과 같은 함수**로 뽑는다(`buildFilterQueryCompat` + `resolveSendConsent` · `buildSendConsent` + `getStoreScope` = `routes/campaigns.ts` `/:id/send` 가 부르는 그 함수들 · 구현 때 호출 순서를 그 라우트와 줄 단위로 맞추고 계약 시험으로 묶는다). 뽑은 번호를 무작위로 「문안 1 ~ k 시험」 · 「나머지」로 나눠 **표에 고정**(`campaign_split_members`)한다. 판정 때 대상을 다시 뽑지 않는다.
- 발송 = 묶음마다 직접발송 코어 `createDirectSendCampaign`(적재 표 `campaign_send_staging` + 차감 + 워커 = 대행발송 워커 · 플래너 실행기가 쓰는 길). 문안 하나 = 일반 캠페인 하나(`send_type` = 이미 있는 값 `operator` = AI 오퍼레이터가 직접발송 배관으로 보낸 것 · 새 값을 만들지 않는다 = 결과 동기화 · 환불 · 청구 집합이 그대로 맡는다 `send-type-axis.ts:52-66` · 대행발송이 새 값을 안 만든 것과 같은 이유).
- 관문 = 플래너 실행기가 거는 것과 같은 순서로(발신번호 규격 · 등록 · 발신 인증 · 링크 자리표시 · 광고 관문 · 수신거부 · 피로도) — 직접발송 코어와 그 앞 CT 가 이미 맡는 것은 다시 만들지 않고 부르기만.
- 차감 = 묶음을 보낼 때마다 코어가 한다(시험 묶음 = 시작 때 문안 순서대로 · 나머지 = 판정 때). 코어 호출은 묶음 하나하나가 따로 차감 · 활성화되므로 **묶음 전체를 한 번에 되돌릴 수는 없다.** 그래서 상태를 숨기지 않는다:
  - 시작할 때 전체 예상 비용과 선불 잔액을 비교해 모자라면 시작을 막는다(대부분을 여기서 거른다).
  - 그래도 시험 묶음 중간에 한 묶음이 실패하면(잔액 · 관문) = 상태 `blocked` · 남은 묶음과 나머지를 **보내지 않는다** · 이미 나간 묶음은 일반 캠페인으로 그대로 · 담당자 알림 「문안 3개 중 1개만 먼저 나갔어요」 + [이어 보내기](못 나간 묶음부터 같은 고정 대상으로) · [여기서 그만](남은 대상에게 보내지 않음).
  - 판정 때 나머지가 실패해도 같다(`blocked` · [나머지 보내기]).
- **같은 묶음이 두 번 나가지 않게**(코어는 캠페인 행을 만들고 `:362` → 차감 `:377` → 발송 가능 전환 `:443` 을 끝낸 뒤에야 id 를 돌려준다 · 그 뒤 우리 행에 id 를 적기 전에 죽으면 다시 부르는 것 = 새 발송): 묶음마다 **적재 묶음 id(staging id)를 먼저 정해 우리 행에 적고**(`groups[i].stagingId` · 상태 `sending`) 그다음 코어를 부른다. 코어 호출에는 대행발송 워커처럼 활성화 조건(`activationGuard` = 「이 시도가 아직 이 나눠 보내기 행을 쥐고 있는가」를 행 잠금으로)을 걸어, 쥔 것을 빼앗긴 시도는 발송 가능 전환이 0행이 된다.
- 워커가 `sending` 인 묶음을 다시 만나면 **코어를 부르지 않고 그 staging id 의 캠페인을 발송 단계까지 대조한다**(플래너 실행기가 결과 모름을 잠그고 사람 확인으로 돌리는 것과 같은 원칙 `planner-executor.ts:574`):

| 그 staging id 의 캠페인 | 뜻 | 처리 |
|---|---|---|
| 없음 | 코어가 행을 만들기 전에 죽었거나 차감 실패로 행을 지웠다(`direct-send-core.ts:424`) = 발송 0 · 차감 0 | 같은 staging id 로 다시 보낸다(적재 행은 고정 대상에서 다시 만든다) |
| `send_phase` = queued · processing · sent | 발송 가능 전환이 됐다 = 나갔거나 나가는 중 | 그 id 를 받아 적고 `sent` |
| `send_phase` = failed(코어가 중화 · 환불 의무 기록 `:405-411`) | 발송 0 · 환불은 코어의 기존 길이 맡는다 | 묶음 `failed` → 나눠 보내기 `blocked` |
| `send_phase` = preparing · 그 밖 · 조회 실패 | **결과 모름**(차감은 됐을 수 있다) | 다시 보내지 않는다 · `blocked` + 운영 경보 + 담당자 화면 「확인 중」(사람이 그 캠페인을 정리한 뒤 [이어 보내기]) |

- 판정 시각이 21:00 ~ 08:00(KST · 광고)에 걸리면 워커는 08:00 에 판정 · 발송한다.
- 취소 = 판정 전에는 「나머지 보내지 않기」(상태 `cancelled` · 이미 나간 시험 묶음은 그대로). 시험 묶음 캠페인의 취소 · 환불은 일반 캠페인 길 그대로.
- 워커 = 1분마다 `status = 'testing' AND decide_at <= now()` 를 한 건씩 집는다(행 잠금 · 집은 표식 · 같은 판정 두 번 0).
- 발송 성공 수 = `campaigns.success_count`(결과 동기화 값) · 누른 사람 수 = 그 캠페인의 짧은 링크 중 클릭이 1 이상인 받는 사람 수.

---

## §7 F5 답장 상담

### 7-1 Harold 가 정한 모양과 우리가 만드는 범위

- 공용 수신 번호 하나(예 0503-…)를 발급받아 그 번호로 온 문자가 게시판처럼 쌓이고, 고객사는 문안에 「이 번호로 문자하면 AI 가 상담해 드려요」를 적는다. **문자가 한줄로로 들어오는 배선은 Harold 가 찾는다.**
- 우리가 만드는 것 = 들어온 한 건을 받는 계약 · 저장 · 회사 매핑 · AI 답장 · 고객사 상담함 · 운영자 미배정함.
- 매핑은 **수신 번호 = 회사**로 한다(§7-3). 번호 하나를 여러 회사가 같이 쓰는 모양은 자동 배정이 안 되고 운영자 배정으로만 돈다 = 회사마다 번호를 하나씩 묶는 것을 권한다(Harold 결정 사항 · 보고).

### 7-2 입구

- `POST /api/inbound-sms/receive` · 머리 열쇠 = ENV `INBOUND_SMS_KEY`(같은 시간 비교 · 없으면 404) · 본문 `{ from, to, text, receivedAt, providerMsgId }` → CT `utils/inbound-sms.ts receiveInbound()` 가 저장만 하고 바로 200(처리는 워커). 같은 `providerMsgId` 두 번 = 한 번만 저장.
- 저장 전에 주민등록번호 · 카드번호 꼴을 가린다(원문을 남기지 않는다).
- 배선이 정해지기 전 시험 = 슈퍼관리자 미배정함의 「직접 등록」(같은 `receiveInbound`).
- 수신 번호 = 표 `inbound_numbers`(번호 → 회사 · 슈퍼관리자가 등록 · §7-3). 등록된 번호가 하나도 없으면 기능 전체가 꺼진 상태(화면 · 칩 · 단추 0). 등록되지 않은 번호로 온 글은 저장만 하고 미배정함에 둔다.

### 7-3 회사 매핑 = 수신 번호가 회사를 정한다(추정 0)

- **번호 하나 = 회사 하나.** 슈퍼관리자가 수신 번호를 회사에 묶어 둔다(표 `inbound_numbers` · 번호가 기본 키라 한 번호가 두 회사에 묶일 수 없다). 문자가 들어오면 받은 번호(`to`)로 그 표를 한 번 찾는다: 있으면 그 회사 · 없으면 미배정. 그 회사가 상담을 꺼 두었으면 저장만 하고 답장 0.
- **번호 값은 한 함수로만 정한다**(`normalizeInboundNumber` · 등록 · 변경 · 수신이 같은 함수 · 기존 전화번호 정규화 CT 위에): 숫자만 남기고 · 맨 앞이 `82` 면 국제 표기로 보고 `82` 를 떼어 낸 뒤 맨 앞에 `0` 이 없으면 붙여 국내 꼴 하나로(`+82 10-1234-5678` · `82 010-1234-5678` · `010-1234-5678` = 모두 `01012345678`) · 국내 번호는 늘 `0` 으로 시작하므로 `82` 로 시작하는 국내 번호와 겹치지 않는다 · 결과가 국내 번호 꼴(0 으로 시작 · 9 ~ 12자리)이 아니면 **잘못된 번호**. 등록 · 변경에서 잘못된 번호는 거절하고, 수신에서 받은 번호가 잘못된 꼴이면 원문 그대로 저장하고 미배정함에 둔다(어느 회사로도 붙이지 않는다). 같은 실번호의 다른 표기는 같은 키가 되므로 두 회사에 따로 묶을 수 없다.
- **한 번 회사에 묶였던 번호는 다른 회사에 묶을 수 없다**(회사 사이 재사용 금지). A사가 고객에게 안내한 번호를 B사로 옮기면 A사 고객이 그 번호로 이어서 보낸 문의가 B사에 보이기 때문이다. 표에 `first_company_id`(처음 묶인 회사 · 한 번 정해지면 바뀌지 않는다)를 두고, 묶기는 `first_company_id` 가 비었거나 같은 회사일 때만 받는다. 할 수 있는 것 = 풀기(회사 → 없음 · 그 뒤 들어온 글은 미배정함) · 같은 회사에 다시 묶기. 다른 회사는 새 번호를 쓴다. **번호 행은 지우지 않는다**(지우는 길을 만들지 않는다 = 지웠다 다시 넣어 처음 묶인 회사를 지우는 우회 0 · CT 와 라우트에 DELETE 문장이 없다는 계약 시험).
- **이미 받은 글의 회사는 바뀌지 않는다**(받을 때 정한 회사를 글 행에 적고 그 뒤 번호 표가 바뀌어도 다시 계산하지 않는다 · 운영자 배정만 미배정 글의 회사를 정한다).
- 고객사 화면의 문안 편집기 단추 「상담 번호 넣기」 = **그 회사에 묶인 번호 글자**를 본문에 넣는다(새 변수 없음 · 발송 경로 무변경). 묶인 번호가 없는 회사에는 단추가 없다.
- 왜 발송 기록으로 판정하지 않는가(설계 리뷰 1 ~ 4라운드에서 같은 부류가 네 번 지적됐다): 번호 하나를 여러 회사가 같이 쓰면 「이 문자가 어느 회사 것인가」를 발송 기록에서 추정해야 하는데, 추정의 재료가 하나라도 빠지면(뒤에 붙은 받는 사람 · 나중에 고친 본문 · 표 목록 · 아직 결과가 안 온 발송) **한 회사의 고객 문의가 다른 회사 상담함에 보인다.** 회사 사이 유출은 「대부분 맞는다」로 둘 수 없다. 수신 번호로 정하면 틀릴 재료가 없다.
- 한 번호를 여러 회사가 같이 쓰게 하려면(공용 번호) = 그 번호를 어느 회사에도 묶지 않는다 → 들어온 글은 전부 운영자 미배정함으로 가고 운영자가 [이 회사로 배정]을 눌러야 그 회사 상담함에 보인다(자동 답장 0). 공용 번호의 자동 판정은 이번 범위 밖(§16 · Harold 결정).
- 운영자 미배정함 = 받은 시각 · 보낸 번호(가림) · 받은 번호 · 글 · [이 회사로 배정](회사 고르기). 받은 번호가 전에 어느 회사에 묶였던 번호면 그 회사 이름을 함께 보이고(「전에 ○○ 에 묶였던 번호」) **그 회사로만** 배정할 수 있다(다른 회사 고르기 잠금). 배정된 글은 그때부터 그 회사 상담함에 「사람 필요」로 보인다(늦게 배정된 글에 AI 가 뒤늦게 자동 답장하지 않는다).

### 7-4 AI 답장

- 회사가 고르는 방식 셋 = **「AI 가 바로 답장」**(기본 · Harold 원문) · 「초안만」 · 「끔」.
- 「바로 답장」 = **회사가 등록한 답변 글을 그대로 보낸다.** AI 는 들어온 문자가 등록 항목 중 **어느 것에 해당하는지 고르기만** 한다(출력 = 항목 번호 또는 「없음」 · 닫힌 목록 검증 · 문자 안의 지시문은 자료일 뿐). 해당 항목이 없으면 사람에게 넘기고 고객에게 고정 문장 한 통 「담당자가 확인 후 연락드리겠습니다」(회사가 고칠 수 있는 글 · 기본 제공).
- 「초안만」 = AI 가 등록 자료를 근거로 답 초안을 쓰고(출구에서 혜택 · 가격 · 재고 · 모델명 낱말 검사 · `help-answer.ts` 꼴) 사람이 [보내기]를 눌러야 나간다.
- 등록 자료 = 상담 답변 항목(제목 · 답변 글 · 켬 끔) 표 `inbound_kb_items`. 항목 글은 저장할 때 발송 가능 글자 · 바이트 · 금칙어를 검사한다(나갈 글 = 저장한 글).
- 자동으로 나가는 조건(전부) = 배정됨 ∧ 방식 = 바로 답장 ∧ 08:00 ~ 21:00(밖이면 08:00 까지 대기) ∧ 같은 번호에 오늘 자동 답장 3통 미만 ∧ 회사 하루 상한 미만 ∧ 「거부」류 낱말 아님. 어긋나면 사람 함.
- 「수신거부 · 거부 · 그만」류 = AI 답 없이 배정 회사의 수신거부로 등록(기존 수신거부 CT). 미배정이면 저장만.
- 보내기 = 직접발송 코어(받는 사람 1명 · `is_ad = false` · `send_type` = 이미 있는 값 `direct` · 캠페인 이름 「상담 답장 …」 · 새 값을 만들지 않는다). **차감 직전에 발신 자격을 다시 본다**(자동 답장 · 야간 대기 뒤 · 사람이 [보내기] 세 길 모두): 캠페인 발송 길이 차감 앞에 부르는 것과 같은 함수 = 발신 인증 `checkSenderAuthGate` · 번호 규격 `checkCallbackSpec` · 등록 `isCallbackRegistered`(`routes/campaigns.ts:858-885` 가 부르는 그 CT 들 · 코어는 이 검증을 호출자 책임으로 둔다 `direct-send-core.ts:4-6`). 하나라도 어긋나면 보내지 않고 사람 함 + 설정 화면에 「답장 발신번호를 다시 골라 주세요」. **같은 답장이 두 번 나가지 않게** F4 와 같은 방식(답장 행에 staging id 를 먼저 적고 `sending` · 다시 만나면 §6-2 대조 표 그대로: 없음 = 다시 보내기 · queued 이후 = `answered` · failed = 사람 함 · preparing · 모름 = 사람 함 + 운영 경보 · 다시 보내지 않는다). 비용 = 배정 회사(선불 차감 · 후불 집계 = 일반 문자와 같은 단가). AI 크레딧은 이번 판에서 받지 않는다(가격은 Harold 결정 사항 · §16).
- **답장 발신번호** = 회사가 설정에서 자기 등록 발신번호 중 하나를 고른다(필수). 그 회사의 상담 번호가 그 회사 발신번호로도 등록돼 있으면(발신번호 사전등록 = Harold 확인 사항) 그것을 고를 수 있고, 그때는 꼬리 줄이 없다. 발신번호가 상담 번호가 아닌 동안 답장 끝에 한 줄 「이어서 문의하실 때는 {상담 번호}로 보내 주세요」가 붙는다(이 줄을 포함해 바이트를 잰다).

### 7-5 화면

- 고객사 = 새 경로 `/inbox` 「상담함」 · 헤더 메뉴에 **상담을 켠 회사에만** 한 칸(「캠페인 대행」 조건부 방식 `DashboardHeader.tsx:137-139` · 안 읽은 수 = 개수만 세는 응답). `ZoneFrame` 두 칸(`lg:grid-cols-[360px_1fr]`): 왼쪽 목록(번호 끝 4자리 · 첫 줄 · 시각 · 상태) · 오른쪽 대화 + 맨 아래 답장 칸(초안이 있으면 채워져 있다 · [보내기]). 위쪽 숫자 4칸(답 기다림 · AI 가 답함 · 사람 필요 · 오늘 받은 문자). 기본 거르기 = 「사람 필요」. AI 가 보낸 답에는 「자동으로 보냄 · 시각」. 모바일 = 목록 → 대화 창.
- 설정 = 상담함 안 「설정」 창: 방식 · 답장 발신번호 · 답변 항목 · 하루 상한 · 사람에게 넘길 때 알릴 번호(선택).
- 새 글 = 화면에 있는 동안 30초마다 + 탭으로 돌아올 때(`serialRunner`). 소켓 없음.
- 운영자 = 슈퍼관리자 「상담 미배정」 탭(목록 + 상세 창 · `AgencyMailIntakePanel` 꼴).

---

## §8 F6 쿠폰 만료 안내 = 이번에 코드 0

받아올 데이터가 없다(`woocommerce-core.ts:183` 은 쿠폰 주제를 일부러 버림 · 카페24 쿠폰 호출 0건). 시작 사건 목록에 넣으면 켜져 있는데 영영 0건인 기능이 된다. 쇼핑몰 쿠폰 발급 · 만료 데이터를 받는 일이 먼저다(§16).

## §9 F8 강점을 드러내는 자리(따로 띠 없음 · 지어낸 숫자 0)

| 강점 | 자리 |
|---|---|
| 매장 데이터 통합 | 추천 상품 설명 「매장에서 이미 산 상품은 권하지 않아요」 · 상품 표의 문 표시(자사몰 · 매장) · 소개 창 본문 |
| 자체 발송망 | 통신사 띠 제목 「우리 발송망에서 직접 잰 값」 |
| 늘어난 매출 증명 | 성과 화면의 대조군 카드(`EffectProofCard`)는 그대로 · F4 결과에 「먼저 보낸 결과로 고른 문안」 |
| 가격 공개 | F1 아래 줄의 원 단위 발송비 · F4 확인 창 비용 합계 |

---

## §10 DDL(전부 칸 · 표 추가 · NULL 허용 · 되돌리기 = 남겨도 무해 · **실행은 그 칸을 쓰는 배포 직전** · `SET lock_timeout = '3s'` · 발송이 적은 시간)

> 배포 원장 id = 이 표의 V3-DDL-n ↔ `C133-DDL-n`(SQL 원문은 원장 한 곳 · status/DEPLOY-LEDGER.md).

| id | 배포 | 내용 |
|---|---|---|
| V3-DDL-1 | A | `user_intro_acks(user_id uuid NOT NULL, intro_key varchar(40) NOT NULL, login_marks text[] NOT NULL DEFAULT '{}', dismissed_at timestamptz NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, intro_key))` |
| V3-DDL-2 | A | `product_signal_daily(company_id uuid NOT NULL, door varchar(8) NOT NULL, product_key varchar(200) NOT NULL, day date NOT NULL, product_name varchar(200) NULL, views int NOT NULL DEFAULT 0, carts int NOT NULL DEFAULT 0, orders int NOT NULL DEFAULT 0, revenue numeric(15,2) NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (company_id, door, product_key, day))` + 색인 `(company_id, day)` |
| V3-DDL-4 | A | `benchmark_company_daily(day date NOT NULL, company_id uuid NOT NULL, industry_code varchar(40) NOT NULL, metric varchar(40) NOT NULL, value double precision NOT NULL, PRIMARY KEY (day, company_id, metric))` + 색인 `(day, industry_code, metric)` · 40일 지난 날짜 삭제 |
| V3-DDL-5 | A | `campaign_carrier_results(campaign_id uuid NOT NULL, company_id uuid NOT NULL, carrier varchar(20) NOT NULL, success int NOT NULL DEFAULT 0, fail int NOT NULL DEFAULT 0, sent_day date NOT NULL, rolled_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (campaign_id, carrier))` + 색인 `(company_id, sent_day)` |
| V3-DDL-6 | C | `campaign_split_tests(id uuid PRIMARY KEY, company_id uuid NOT NULL, user_id uuid NOT NULL, status varchar(12) NOT NULL, test_pct smallint NOT NULL, decide_at timestamptz NOT NULL, variants jsonb NOT NULL, spec jsonb NOT NULL, groups jsonb NOT NULL, winner_index smallint NULL, verdict varchar(20) NULL, claim_token uuid NULL, claimed_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())` + 색인 `(status, decide_at)` / `campaign_split_members(split_id uuid NOT NULL, phone varchar(20) NOT NULL, grp smallint NOT NULL, PRIMARY KEY (split_id, phone))`. status = `testing` · `deciding` · `done` · `blocked` · `cancelled` · groups = 묶음마다 `{ grp, stagingId, state: pending · sending · sent · failed, campaignId }`(grp 0 = 나머지) |
| V3-DDL-7 | D | 아래 네 표 |

V3-DDL-7 표:
- `inbound_numbers(number varchar(20) PRIMARY KEY, company_id uuid NULL, first_company_id uuid NULL, note varchar(100) NULL, created_by uuid NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK (company_id IS NULL OR (first_company_id IS NOT NULL AND company_id = first_company_id)))` + 색인 `(company_id)`. number = `normalizeInboundNumber` 가 낸 국내 꼴 숫자(다른 꼴은 저장하지 않는다) · company_id NULL = 지금 어느 회사에도 묶이지 않은 번호(들어온 글은 미배정함) · first_company_id = 처음 묶인 회사(쓰기 문장이 `COALESCE(first_company_id, 새 회사)` 로만 채운다 · 그 밖에 이 칸을 바꾸는 문장은 없다 = 계약 시험). CHECK 는 「묶인 회사가 있으면 처음 묶인 회사가 반드시 있고 둘이 같다」를 DB 에서 강제한다(처음 묶인 회사가 빈 채로 회사만 묶인 행은 들어갈 수 없다 = NULL 비교가 통과로 읽히는 구멍 0).
- `inbound_messages(id uuid PRIMARY KEY, provider_msg_id varchar(100) NOT NULL UNIQUE, direction varchar(3) NOT NULL, from_phone varchar(20) NOT NULL, to_number varchar(20) NOT NULL, body text NOT NULL, company_id uuid NULL, status varchar(16) NOT NULL, handled_by varchar(8) NULL, kb_item_id uuid NULL, draft text NULL, reply_to uuid NULL, reply_staging_id uuid NULL, reply_campaign_id uuid NULL, assigned_by uuid NULL, claim_token uuid NULL, claimed_at timestamptz NULL, received_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())` + 색인 `(company_id, received_at DESC)` · `(status, received_at)` · `(from_phone, received_at DESC)`. direction = `in` · `out`(보낸 답장도 같은 표 한 행 · provider_msg_id = `out:` + id). status = `new`(막 받음) · `unassigned` · `waiting`(야간 대기) · `human`(사람 필요) · `sending`(답장 접수 중) · `answered` · `optout` · `closed`.
- `inbound_settings(company_id uuid PRIMARY KEY, enabled boolean NOT NULL DEFAULT false, mode varchar(8) NOT NULL DEFAULT 'auto', reply_callback varchar(20) NULL, daily_cap int NULL, notify_phone varchar(20) NULL, handoff_text varchar(200) NULL, updated_by uuid NULL, updated_at timestamptz NOT NULL DEFAULT now())`. mode = `auto` · `draft` · `off`.
- `inbound_kb_items(id uuid PRIMARY KEY, company_id uuid NOT NULL, title varchar(60) NOT NULL, body varchar(600) NOT NULL, enabled boolean NOT NULL DEFAULT true, sort int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())` + 색인 `(company_id, sort)`.

- 새 칸 · 표를 읽는 길은 칸 · 표가 없으면 503 `DB_MIGRATION_PENDING`(화면은 그 기능만 숨김). **여정 표에는 칸을 더하지 않는다**(추천 후보는 본문 안 · §5-4) = 여정 엔진이 읽는 조회는 한 글자도 안 바뀐다. 추천 고르기가 뿌리 표(V3-DDL-2)를 못 읽으면 대체 문장으로 내려간다(발송을 막지 않는다 · 대체 문장도 검사한 판).
- 기존 표의 칸을 코드에 쓰기 전 = 시험 DB(`t_tpl_closed` · 덤프 + 닫힌 DDL)의 `information_schema` 조회로 확인하고 출력을 보고에 붙인다(LESSONS_DB 룰 전문 「덤프 확인」). 분포 · 행 수는 Harold 실행(§15).

## §11 컨트롤타워

| 구분 | 파일 | 책임 | 읽는 곳 |
|---|---|---|---|
| 신설 | `utils/v3-stage.ts` | 기능별 단계 개방 판정 `v3Live(기능, 회사)`(요금제 판정 뒤 ENV) | 모든 V3 입구 · 소개 창 칩 |
| 신설 | `utils/v3-intro.ts` | 소개 창 상태 · 포스터 · 칩 · 노출 기록 | `routes/plans.ts` |
| 신설 | `utils/product-signal.ts` | 상품 반응 표의 유일한 쓰기 · 읽기 · 상품 키 식(조회 · 장바구니) · 명단 뽑기 | 워커 · 성과 탭 · 몰 상품 창 · 추천 |
| 신설 | `utils/product-reco.ts` | 후보 제안 · 후보 검증 · 고객별 고르기 | 여정 렌더 · 검사 · DM 보기 · 이메일 |
| 신설 | `utils/campaign-split.ts` | 나눠 보내기 상태 · 승자 판정 · 묶음 발송 | 라우트 · 워커 |
| 신설 | `utils/inbound-sms.ts` | 받기 · 가림 · 번호 → 회사 · 방식 판정 · 답장 보내기 | 입구 라우트 · 워커 · 상담함 · 슈퍼관리자 번호 · 미배정 화면 |
| 고침 | `utils/performance-benchmark.ts`(CT-66) | 축 = 업종 · 지표별 k ≥ 5 · 비율만 · 스냅숏 | 워커 · 성과 화면 |
| 고침 | `utils/journey-opportunities.ts` | 추천 칸 셋 추가 | 진단 |
| 고침 | `utils/journey-simulator.ts` | 판정 칸 둘 추가 | 묶음 켜기 창 |
| 고침 | `utils/journey-message-render.ts`(자리 바꾸기) · `journey-step-versions.ts`(검사 판 펼침) · `send-placeholder-gate.ts`(CT-J10 자리 판정) · `journey-ai-generator.ts`(다시 쓰기 제외) + 검사 목록을 만드는 네 호출부(`journey-pretest-validator.ts` · `journey-pretest-notifier.ts` 의 2시간 전 · 주간 · 재작성 후보)가 펼침 함수를 부르게 | 추천 자리 | 여정 엔진 |
| 재사용(새로 만들지 않음) | `journey-product.ts`(상품 키) · `two-door-purchase.ts` · `purchase-history-source.ts` · `cdp-order-revenue.ts` · `direct-send-core.ts` · `ad-send-gate.ts` · `bandit-optimizer.ts`(신뢰 구간) · `short-url.ts`(클릭) · `sms-table-split.ts` · `queue-scan-guard.ts` · `unsubscribe-helper` · `help-answer.ts` 꼴 · `feature-interest.ts` · `plan-guard.ts` · `copy-prompt-composer.ts resolveCompanyIndustry` · `unit-price.ts` | | |

워커 넷(`app.ts` 등록 · 각자 켜는 ENV 없이 표 · 단계 판정으로 스스로 쉰다): `product-signal-worker`(하루 1회) · `benchmark-worker`(하루 1회 = 업종 평균 + 통신사 굴림) · `campaign-split-worker`(1분) · `inbound-worker`(1분 = 들어온 글의 답장 · 야간 대기 풀기).

## §12 돈 · 발송 경로 영향표

| 닿는 자리 | 무엇이 | 기존 소비처 | 지키는 것 |
|---|---|---|---|
| `journey-message-render.ts` | 맨 앞 자리 바꾸기 · 선택 입력 `recoIndex` | 미리보기 · 켜기 검사 · 2시간 전 · 주간 재검사 · 실행기 | 자리 없는 본문의 결과 글자 동일(T2-8 스냅숏) |
| `journey-step-versions.ts` + 검사 호출부 넷 | 검사 판 펼침 | 켜기 관문 · 발송 전 · 주간 재검사 · 재작성 후보 | 자리 없는 칸의 검사 목록 = 종전(T2-10) · 네 호출부가 같은 함수(T2-9) |
| `send-placeholder-gate.ts journeyCopyIssue` | 자리 판정 | 켜기 · 켜기 검증 · 칸 저장 · 보내기 전 검사 · 실행기 · 상황판 · 담당자 안내(일곱 호출부) | 자리 없는 본문의 판정 결과 동일(T2-11) |
| `journey-ai-generator.ts regenerateStepAvoidingSpam` | 자리 있는 본문은 다시 쓰지 않음 | 2시간 전 · 주간 재검사 | 자리 없는 본문 = 종전(T2-12) |
| `direct-send-core.ts createDirectSendCampaign` | **수정 0 · 호출만**(F4 · F5) | 직접발송 · DM · 플래너 · 자동 마케팅 · 대행 | 넘기는 칸은 기존 spec 칸뿐 |
| `send-type-axis.ts` | **수정 0** · F4 = 있는 값 `operator` · F5 = 있는 값 `direct` | 발송결과 화면 · 결과 동기화 · 환불 · 청구 집합 | 두 값 모두 이미 「직접발송 배관」 집합(`DIRECT_PIPELINE_SEND_TYPES`)에 있다 · 새 CT 가 다른 값을 싣지 않는지 계약 시험(T4-8 · T5-10) |
| `routes/campaigns.ts` · `spam-filter.ts` · `messageUtils.ts` · `results.ts` · `billing.ts` | **수정 0** | | 구문 트리로 파일 무변경 확인(T0-1) |
| 선불 차감 | F4 묶음마다 · F5 답장마다 = 코어의 기존 차감 | `prepaidDeduct` | 새 차감 코드 0 |
| AI 크레딧 | F1 = 기존(초안 · 처음 켜기) · F5 = 0 | | 새 크레딧 원천 0 |

실측 1건 시나리오(배포 전 보고에 포함): B = 사내 회사에서 추천 여정 한 세트를 만들고 켜서 첫 발송 1건의 차감 · 결과 / C-① = 추천 칸 1개 여정의 실발송 1건이 후보 안의 이름으로 나갔는지 / C-④ = 도달 불가 번호 대상의 나눠 보내기 1건(시험 묶음 차감 · 판정 · 나머지 차감 · 원장 합계) / D = 직접 등록 한 건 → 배정 → 자동 답장 1건 차감.

## §13 시험(설계서의 seam = 이 표 · 변이는 판정 자리마다)

| id | 무엇 |
|---|---|
| T0-1 | 절대 보호 다섯 파일 무변경 · 직접발송 화면 파일 무변경(구문 트리 지문) |
| T1-1 ~ 6 | 추천 칸 여덟(잠김 사유 포함) · 혜택 답이 요청 키와 answers 에 실림 · `firstRoundCapExceeded` = 진입 감시와 같은 판정 · 무료 추정이 사전 검사를 부르지 않음(화면 계약) · 창 닫기 = 취소 · T1-6 직접발송 무변경 |
| T2-1 ~ 7 | 상품 키 식(조회 · 장바구니 · 주문 짝) · 일별 덮어쓰기 멱등(실 PG) · 회사 격리 · 명단 = 본 뒤 안 산 고객(두 문 · 실 PG) · 반응 숫자 저장 고정 · 검색어 집계 · 탭 빈 상태 |
| T2-8 ~ 16 | 자리 없는 본문 렌더 동일 · 검사 호출부 넷이 같은 펼침 함수 · 검사 목록 N + 1 · 자리 없는 본문의 CT-J10 판정 동일 · 자리 있는 본문 다시 쓰기 0 · 고르기 세 갈래(실 PG · 매장에서 산 상품 제외) · 끊긴 후보 건너뜀 · 변이 칸 · 알림톡 칸 · 제목 거절 · 자리 문법 오류 거절(후보 0 · 4개 · 대체 문장 없음 · 금지 글자 · 두 번) · 자리가 `%…%` · Liquid 안에 낀 본문 거절 · 후보 이름이 그 회사 변수 이름과 같아도 고객 값으로 바뀌지 않음 · 보낼 수 없는 글자가 든 후보 거절 · 렌더가 고른 글자에 글자 정리를 걸고 최종 글로 바이트를 잼 · 켠 뒤 본문을 고친 새 판에 자리가 그대로 있고 그 판이 검사 목록에 펼쳐짐 · AI 수정이 자리를 지우면 거절 |
| T3-1 ~ 5 | k < 5 미표시(지표마다) · 절댓값 0 · 자기 회사 제외 · R94 통과 글 · 통신사 `unknown` 이 있으면 그 통신사 미표시 |
| T4-1 ~ 10 | 대상 고정(판정 때 다시 뽑지 않음) · 균등 분할 · 승자 = 누른 사람 수의 신뢰 구간 비겹침만(반복 클릭이 승자를 못 바꿈) · 야간 미룸 · 잔액 부족 = 시작 거절 / 중간 실패 = `blocked` + 남은 묶음 0 · 같은 판정 두 번 0(실 PG · 두 워커) · `sending` 묶음을 다시 만나면 코어를 부르지 않고 staging id 의 캠페인을 발송 단계로 대조(없음 = 다시 보내기 · queued 이후 = 받아 적기 · failed = 막힘 · preparing · 모름 = 막힘 + 다시 보내지 않음 · 네 갈래 실 PG) · 쥔 것을 빼앗긴 시도는 발송 가능 전환 0행 · 고정 뒤 수신거부한 사람은 나머지 발송 때 직접발송 길의 수신거부 거르기가 뺀다 · 토글 꺼짐 = 기존 발송 길 그대로 · 싣는 `send_type` 이 `operator` 뿐 |
| T5-1 ~ 13 | 같은 `providerMsgId` 한 번 · 가림 · 매핑 = 받은 번호로 번호 표 한 번(묶인 회사 = 배정 · 없는 번호 · 안 묶인 번호 = 미배정 · 상담 꺼 둠 = 저장만) · 한 번호를 두 회사에 묶을 수 없음(기본 키 · 실 PG) · 번호 표기 동치(하이픈 · `+82` · `82` 로 시작하는 꼴이 같은 키 · 등록 · 변경 · 수신이 같은 함수 = 구문 트리 계약) · 잘못된 꼴은 등록 거절 · 수신은 미배정 · A사에 묶였던 번호를 B사에 묶기 거절(쓰기 + CHECK 두 겹 · 실 PG) · (회사 A · 처음 묶인 회사 없음) 행의 INSERT · UPDATE 를 CHECK 가 거절(실 PG) · 처음 묶인 회사 칸을 바꾸는 문장이 COALESCE 꼴 하나뿐(구문 트리 계약) · 풀었다가 같은 회사에 다시 묶기 허용 · 번호 행을 지우는 문장 0(구문 트리 계약) · 번호를 푼 뒤 들어온 후속 문의는 미배정 · 번호 표가 바뀌어도 이미 받은 글의 회사는 그대로 · 전에 A사에 묶였던 번호로 온 미배정 글은 운영자도 A사로만 배정 · 매핑이 큐 · 캠페인 · 고객 표를 읽지 않음(구문 트리 계약) · 운영자 배정 글에 자동 답장 0 · 미배정 답장 0 · 차감 직전 발신 자격 재검사(세 길) · `sending` 답장을 다시 만나면 코어를 부르지 않고 발송 단계로 대조(preparing · 중화된 캠페인을 `answered` 로 읽지 않음) · 고르기 출력이 닫힌 목록 밖이면 사람 함 · 거부 낱말 = 수신거부만 · 야간 대기 · 하루 3통 · 꼬리 줄 포함 바이트 · 싣는 `send_type` 이 `direct` 뿐 |
| T7-1 ~ 4 | 대상 판정 · 3회 상한 · 칩 = 그 기능의 판정 함수 그대로 · 표 없음 = 띄우지 않음 |

실 PG 시험은 `npm run test:pg`(원장 블록 = `ledgerBlockSql`) · 단위 전체 · tsc 0 · 0 · 변이 = 파일 복사 방식.

## §14 배포 경계

| 배포 | 내용 | DDL | 스위치 | 닫는 실측 |
|---|---|---|---|---|
| A | F7 · F3 · F2 뿌리 · F2 ② ③ · F1 의 창 결함 수정(8번) | V3-DDL-1 · 2 · 4 · 5 | `V3_STAGE_PRODUCT_INSIGHT` · `V3_STAGE_BENCHMARK`(사내 회사 → 전체) | 소개 창 3회 상한 · 상품 표 한 회사 수치를 SQL 로 대조 · 통신사 굴림 3건을 결과 화면과 대조 |
| B | F1(1 ~ 7번) | 없음 | `V3_STAGE_JOURNEY_PACK` | 사내 회사 여정 세트 1회 실발송 |
| C | F2 ① · F4(코드는 들어가고 스위치는 꺼진 채) | V3-DDL-6 | `V3_STAGE_RECO` · `V3_STAGE_SPLIT` | 스위치 꺼진 판에서 발송 경로 변화 0 → 사내 회사만 켜서 1건씩 |
| D | F5 | V3-DDL-7 | `V3_STAGE_INBOX` + `INBOUND_SMS_KEY` · 번호 등록(슈퍼관리자 화면) | Harold 수신 배선 뒤 직접 등록 1건 → 자동 답장 1건 |

전제 = 서버 전환(.62 → .57) 끝 · 여정 실측 C126-S1 · C129-S1 닫힘(B 앞). 발송 경로를 바꾸는 배포(B · C)는 한 배포에 하나만. 직원 시트는 배포마다 한 장(로드맵 묶음이 끝난 뒤 한 번에 돌린다는 기존 원칙 그대로).

## §15 서버에서 재야 할 사실(전환 뒤 · 읽기 전용 · 하나씩)

1. 자사몰 사건: 최근 30일 `product_view` · `cart_add` · `search` 가 들어오는 회사 수와 `properties` 키 꼴(items 배열 / 맨 위 칸 / 이름만).
2. `companies.industry_code` 분포(업종별 회사 수 · 빈 회사 수).
3. `companies.fatigue_cap_days / fatigue_cap_max` 칸 존재와 설정한 회사 수.
4. 큐 표 실패 행의 `mob_company` 가 채워지는 비율(통신사 띠를 켤 수 있는지).
5. `companies` 에 시험 · 합성 회사를 가르는 칸이 있는지(업종 평균에서 뺄 회사).
8. 자사몰 사건이 가장 많은 회사의 최근 30일 `cdp_events` 건수와 상품별 집계 쿼리의 실행 계획(F2 뿌리 워커의 밤 한 번 비용).
7. 짧은 링크가 받는 사람마다 만들어지는지(`message_short_urls` 의 받는 사람 칸 · F4 판정의 「누른 사람 수」).

## §16 범위 밖 · 추가 과제(기록만)

- 쇼핑몰 쿠폰 발급 · 만료 데이터 수집(F6 의 선행).
- 장바구니 `{{ cart.* }}` 값 무제한 채움(BUGS 등재).
- 여정 잔액 부족 멈춤 안내를 회사 단위 한 통으로 묶기(R45 · 엔진 변경).
- `OpenPromoPopup.tsx`(붙은 곳 0) 삭제.
- 추천 상품의 클릭 귀속(나간 상품 키를 실행 행에 남기기).
- 통신사 띠에 여정 발송 포함.
- F5 의 AI 크레딧 가격 · 상담 번호를 그 회사 발신번호로 등록하는 길(Harold 결정 사항).
- **공용 번호 하나를 여러 회사가 같이 쓰는 자동 배정**(Harold 결정 사항): 하려면 받는 번호로 큐 전 표를 읽어 「나간 글에 그 번호가 든 발송」의 회사가 정확히 1곳임을 증명해야 하고, 증명에는 표 목록 실측(캐시 없이 · 읽는 동안 변함 없음) · 표 전부 읽음 · 결과가 확정된 발송만(대기 중이면 판정 보류) · 회사 식별이 다 있어야 한다(설계 리뷰 1 ~ 4라운드 기록). 하나라도 빠지면 다른 회사에 문의가 보인다.
- 새 기능의 도움말 카탈로그 등재(`feature-catalog.ts`).
- 공용 변수 칩 부품(문안 편집기 9곳의 `insertVar` 통일).

## §17 회의에서 끝까지 갈린 지점과 택한 쪽

| 지점 | 갈린 안 | 택한 쪽 · 근거 |
|---|---|---|
| F2 ③ 자리 | 성과리포트(프론트 2R) / 자사몰 설정 창(기획 · 디자이너 · 회의론자 2R) | 성과리포트 · 로드맵 5순위 6번이 Harold 승인 항목 · 부품 하나라 자리 비용이 작다 |
| F3 꼴 | 숫자 카드 안 한 줄(디자이너 · 프론트 2R) / 칩 + 창(기획 · 회의론자) | 카드 안 한 줄 · 칩이 7장이 되면 3열이 어긋나고 비교가 눌러야 보인다 |
| F3 통신사 띠 시기 | 이번(기획 · 백엔드) / 다음 판(회의론자 1R · 프론트 · 디자이너) | 이번 · 자체 발송망을 증명하는 유일한 숫자 · 단 직원 대조 뒤 켠다(회의론자 최종 조건) |
| F5 기본 방식 | AI 가 바로 답장(Harold 원문) / 초안만(기획 · 회의론자 · 디자이너) | 바로 답장 · 「등록한 글 그대로 보내기」로 지어낸 답 0(회의론자 최종 수용) |
| F7 대상 | 고객사 전부(프론트 · 회의론자) / 가입사는 스튜디오 생성 0건만(기획) / 미가입부터(디자이너) | 전부 · V3 소개이기도 하고 최대 3회 + 다시 보지 않기 |
| F1 최대 인원 | 묶음 켜기에서 필수(회의 전원) | **선택 유지** · 1101 Harold 결정과 어긋나 폐기 · 무료 추정과 「켜면 바로 멈춰요」 판정으로 대신 |
| F2 ① 범위 | DM · 이메일만(기획 1R · 백엔드 2R) / 여정 문자까지(프론트 · 기획 2R · 회의론자 조건부) | 여정 문자까지 · 후보 3 + 대체 문장을 전부 검사 · 배포 C 에서 스위치 꺼진 채 들어간다 |
| F5 회사 매핑 | 회의 = 공용 번호 하나 + 발송 기록으로 판정(원장 또는 큐 조회) | **수신 번호 = 회사**(번호 하나에 회사 하나) · 설계 리뷰에서 발송 기록 판정이 네 라운드 연속 회사 사이 유출 경로를 남겼다 · 추정을 없애면 틀릴 재료가 없다 · 공용 번호 자동 배정은 Harold 결정 사항으로 분리 |

---

## §18 구현하며 바뀐 것(1113 · 본문과 다르면 이 절이 맞다)

> 구현 중 코드와 실물을 읽고 고친 것만 적는다. 범위를 줄인 것이 아니라 자리 · 순서 · 표기를 실물에 맞춘 것이다. 미룬 것은 「미룸」으로 적고 이유를 붙인다.

### 배포 A

| 본문 | 바뀐 것 | 이유 |
|---|---|---|
| §2-2 기록 = `reportPlanFeature('v3-intro', …)` | 기능 id `login-promo` 그대로 | id 를 바꾸면 슈퍼관리자 「기능 관심 업체」의 「로그인 안내 창」 줄이 끊긴다 |
| §2-4 claim 본문 `{ loginMark }` | 본문 없음 · 로그인 표식은 서버가 요청의 토큰으로 만든다(sha256 앞 32자) | 화면이 준 값을 믿지 않는다 |
| §5-1 키 = productId → product_id → 이름 | productId → product_id → **product_code** → 이름 | 직접 부르는 꼴의 조회 사건이 맨 위 칸 `product_code` 를 싣는다(`demo-data.ts` 합성 사건 · 주문은 같은 값을 `productId` 로 싣는다 = 같은 상품이 한 키로 모인다) |
| §5-1 「창 30일 전체를 다시 세어」 | 표에 두는 기간 = **60일**(창 30일의 두 배) · 화면 · 후보 · 고르기 창은 그대로 30일 | §5-2 상품 표의 「지난 30일 대비」 칸에 앞 30일이 필요하다 |
| §5-1 · §10 V3-DDL-2 `revenue` 칸 | 뺐다 | 읽는 화면이 없다(늘 0 인 칸은 다음 사람이 값으로 믿는다) · 쓰는 화면이 생길 때 칸을 더한다 |
| §5-1 대상 회사 = 최근 30일 관측이 있는 회사 | **단계 개방에서 상품 반응 · 추천 중 하나라도 열린 회사만** 계산 · 닫힌 회사의 남은 행은 밤 계산이 지운다 · 기동 뒤 행이 없는 열린 회사는 한 번 채운다 | ENV 명단이 비면 계산 0 = 미가입 · 미개방 회사 부하 0 · 서버에서 사건 규모를 재기 전(§15)이라 여는 만큼만 돈다 |
| §5-2 자리 = 성과리포트 **탭** | 성과리포트 안의 한 **구역**(효과 증명 카드 아래 · 구역 안에서 상품 / 검색어 전환) | 성과리포트 화면에 탭 틀이 없다(구역을 아래로 쌓는 화면) · 자사몰 분석 창의 차트 부품은 이 구역이 쓰지 않아 떼지 않았다(무변경) |
| §5-2 직접발송 주소 `?open=direct-send&from=product-signal` · 창 머리 글 | 주소는 `?open=direct-send` 그대로 · 대상은 화면 메모리로 한 번 넘긴다 · 「분석 화면 312명 → 지금 305명」은 불러온 뒤 알림 글로 · 명단에 **더한다**(R31) | 상품 키 · 검색어를 주소에 싣지 않는다 · 명단을 들여오는 다른 길(주소록 · 알림톡 창)이 알림 글을 쓴다 |
| §5-2 보는 사람의 매장 범위 | 분류코드로 나뉜 담당자에게는 구역 자체를 닫는다 | 상품 조회 수는 회사 전체 값이라 담당자 범위로 나눌 수 없다(「사용자는 자기 것」) |
| §5-2 자리별 클릭률(인앱) | 구역의 세 번째 보기 「인앱 메시지」 = 이미 있는 `buildTopMessages`(`inapp-funnel-stats.ts` · 메시지별 최근 30일 노출 · 클릭 · 클릭률 · 노출 10회 이상)의 응답을 그대로 표로 | 설계 조건대로 새 집계 0 |
| §5-3 받는 사람용 반응 숫자(DM · 이메일) | **배포 C 로 옮김** | DM 상품 묶음 · 이메일 상품 카드를 배포 C(받는 분마다 관심 상품을 앞에)에서도 고친다 = 같은 자리(속성 계약 · 세 구도 · 편집기 · 이메일 렌더)를 한 번에 |
| §5-3 예시 「1,240명이 봤어요」 | 조회 **횟수**로 적는다(「최근 30일 조회 1,240번」) | 표는 날마다의 횟수를 쌓는다 · 사람 수는 날을 넘겨 더할 수 없다(세지 않은 값을 「명」으로 적지 않는다) |
| §4-1 성공률 = `status = 'completed'` | + `result_final = true`(결과가 확정된 캠페인만) | PG 의 성공 수는 확정된 뒤에만 믿는다(D144) |
| §4-1 시험 회사 제외 | 스냅숏에는 모든 회사의 행을 쓰고 **읽을 때** 시연 · 합성 데이터 회사를 평균에서 뺀다(`listDemoCompanyIds` · `SYNTHETIC_DATA_COMPANY_IDS` · 새 ENV 0) | 사내 회사가 자기 값과 실제 회사 평균을 볼 수 있어야 화면을 확인한다 |
| §4-2 「업종 평균 97.1% · 1.2%p 높음」 | 「최근 30일 기준 업종 평균 97.1% · 1.2%p 높음」 | 카드의 큰 숫자는 고른 기간(7 · 30 · 90일) 값이고 비교는 늘 30일이다 |
| §4-3 통신사별 발송 성공률(`carrier-rollup-worker` · V3-DDL-5) | **미룸** · 이번 배포 A 에는 통신사별 **스팸 검사 차단율**만 | 실패 행에 통신사가 남는지(§15)를 재기 전에는 통신사별 성공률이 성립하는지 모른다 · 재고 나서 만든다(V3-DDL-5 도 그때) |
| §3-1 8번 | 사전 검사 시간 제한 5분 · 최대 인원 저장 15초 · 켜기 5분 | 사전 검사는 칸마다 스팸 검사를 최대 30초 기다린다(`journey-pretest-validator.ts`) |

### 구현 리뷰로 바뀐 것(Codex 구현 1R · 2R)

| 본문 | 바뀐 것 | 이유 |
|---|---|---|
| §4 업종 평균 = 단계가 열린 회사 | **회사 관리자에게만** 값을 준다(담당자 = 비교 줄 없음) | 내 값(성공률 · 스팸 검사 차단율)은 회사 전체 값이다 · 담당자는 발송결과 · 스팸 검사에서 자기 것만 본다(1R) |
| §5-3 몰 상품 고르는 창의 숫자 | 숫자가 나가는 관문을 CT 한 곳(`productInsightOpenFor`)으로 · 분류코드로 나뉜 담당자에게는 숫자 없이 목록만 | 성과리포트 구역에서 닫은 담당자에게 같은 회사 전체 숫자가 다른 길로 나갔다(1R) |
| §5-1 야간 정리 | 판정을 열림 · 닫힘 · **모름** 셋으로 · 요금제를 못 읽은 회사의 행은 지우지 않는다 | 일시 장애가 「닫힘」으로 읽혀 60일 집계가 지워질 수 있었다(1R) |
| §3-1 「엔진 · 켜기 관문 = 무변경」 | **켜기 창은 최대 인원을 따로 저장하지 않는다. 켜기 요청 하나가 화면의 값을 여정마다 싣고(`caps`), 서버가 여정을 켜는 그 UPDATE 문장에서 값을 함께 쓴다**(같은 행 · 같은 조건 · 같은 커밋 = 켜지는 값이 곧 화면의 값). 값을 싣지 않는 호출(하나씩 켜기 · 새 모양 켜기)은 종전 그대로 | 옛 구조 = 켜기 전에 최대 인원을 따로 저장 → 저장과 켜기가 따로라 ① 낡은 지도 값으로 저장을 건너뛰거나(1R) ② 저장 응답을 잃거나(2R) ③ 닫아서 끊은 저장이 켜진 뒤에 도착해(3R) 화면과 다른 최대 인원으로 돌 수 있었다(닫기 잠금을 풀기 전에도 ① 은 있던 길). 세 번 같은 계열이라 장치를 덧대지 않고 저장 요청 자체를 없앴다 · AI 존 서버 호출 기준표의 `/journeys/:p/options` 를 6 → 5 로(의도한 삭제) |
| §3-1 8번 응답을 못 받았을 때 | 응답 머리만 오고 본문을 받다 끊긴 것도 「결과 모름」으로 본다(지도를 다시 읽게 한다) | 켜졌을 수 있는 요청이 「켜지 못했어요」로 안내됐다(1R) |

### 배포 B 구현 중 정한 것

| 본문 | 정한 것 | 이유 |
|---|---|---|
| §3-1 2번 순간 칸 셋 · 3번 혜택 칸 · 4 ~ 7번 | 전부 단계 개방 `V3_STAGE_JOURNEY_PACK` 이 열린 회사에만(닫힌 회사 = 진단 응답 · 켜기 창이 종전과 같다) · 화면은 `GET /api/plans/v3-features` 로 입구를 그릴지만 묻는다(권한은 각 길이 다시 판정) | §14 가 배포 B 의 스위치로 적은 것을 코드로 |
| §3-1 3번 요청 키 | 혜택을 비우면 요청 키가 종전과 글자 그대로 같다 | 이미 만든 초안의 「이미 만듦」 판정을 깨지 않는다 |
| §3-1 5번 `?cap=` | 없음 = 저장된 값 · `none` = 비움 · 1 이상 정수 · 그 밖 = 400 · 응답에 판정에 쓴 값 `capUsed` | 화면이 「어느 값으로 판정한 답인지」를 대조한다(늦게 온 옛 답을 버린다) |
| §3-1 7번 피로도 | 시뮬레이터 응답의 `fatigueCap`(켜짐 · 꺼짐 · 모름) · 꺼짐일 때만 안내 | §15 의 칸 확인 = 이미 있는 판독 CT(`fatigue-guard.ts` · 칸 없으면 모름) |

### 배포 경계(§14 를 이렇게 읽는다)

| 배포 | 담는 것 | DDL(원장 id) |
|---|---|---|
| A | F7 · F3(성공률 · 통신사별 스팸 검사 차단율) · F2 뿌리 · F2 ③ · F2 ② 담당자용 · F1 8번 | C133-DDL-1 · C133-DDL-2 · C133-DDL-4 |
| B | F1 1 ~ 7번 | 없음 |
| C | F2 ①(추천) · F2 ② 받는 사람용 · F4 | C133-DDL-6 |
| D | F5 | C133-DDL-7 |
| 실측 뒤 | F3 통신사별 발송 성공률 | C133-DDL-5 |
