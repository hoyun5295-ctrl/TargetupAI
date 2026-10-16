# 이미지 스튜디오 개편: 템플릿 고르기 하나로 · 만든 포스터를 채널로 바로 (2026-10-16 설계서)

> 접수 = Harold 1016 「제미나이 남은 걸로 템플릿 더 만들까? 일단 이미지스튜디오 문제점 · 훨씬 편리하게 · 비토 구조체크 + 브레인스토밍으로 압도적 기능강화」.
> 결정 경로 = 비토 구조체크(후보 4) → Harold 「발동 · 1·2번」 → 브레인스토밍 5역할(기획·프론트엔드·백엔드·디자이너·회의론자 · 1차 → 교차 1라운드 → 회의론자 최종 검증 8건) → Harold 「수렴안 확정 · DM 삽입 창 첫 장 자동 선택 폐기 · 설계서 쓰고 구현까지 · Codex 닫힐 때까지」(1016).
> 상설 = [FEATURE-IMAGE-STUDIO.md](FEATURE-IMAGE-STUDIO.md)(불변 원칙·소유표는 그 문서가 소유한다. 여기는 이번 개편의 근거와 순서).

## 0. 문제와 목표

| # | 지금(코드 확인) | 목표 |
|---|---|---|
| ① | 결과에서 DM까지 = 저장(결과 카드 사라짐 `ImageStudioPage` 옛 L344) → 템플릿으로 → 보던 카테고리라 라이브러리 띠 숨음 → 저장 소재 관리에서 방금 소재 찾기 → 발사대 → 모바일 DM | 결과 카드에서 **1클릭**(저장 안 한 다른 포스터가 있을 때만 확인 1번) |
| ② | DM 삽입 창 = 502종 평면 격자 · 첫 장(뷰티 「프리미엄 다크 럭셔리」) 자동 선택 · 업종 무관 1클릭에 2크레딧 | 스튜디오와 같은 고르기 · 자동 선택 폐기(Harold) |
| ③ | 템플릿 찾는 길(트랙·카테고리·세부·검색·쪽)이 스튜디오 화면 안에만 있다 | 공용 부품 하나(`TemplatePicker`) |
| ④ | 회사 업종(`companies.industry_code`)을 스튜디오가 안 읽는다 | 뷰티·의류·요식 회사는 자기 업종 카테고리가 맨 앞 |
| ⑤ | DM 삽입 창 = 문구 위치(행사 기본 위) · 상품 · 장면 힌트 · 워터마크 없음 · 생성 중 닫으면 2크레딧 낸 그림이 사라짐 · 저장 공간 가득이면 토스트로 막힘 | 스튜디오 제작 화면과 같은 부품 · 닫기 = 숨김(결과 보존) |

고객사 업종 = 뷰티·의류·요식업뿐(메모리 1004). 업종 추천은 이 셋만 인정한다.

## 1. 결정

1. **DM 삽입 창 첫 장 자동 선택 폐기**(Harold 1016). 고르기 전에는 만들기 버튼을 그리지 않는다(LESSONS_FRONTEND 「누를 수 없는 버튼은 그리지 마라」). FEATURE §4-1-C 「DM 삽입 창 기본 선택 불변」 문장과 `image-studio-templates.ts` 첫 항목 주석을 함께 고친다.
2. **배포는 한 번**에 1차(후보 2)와 2차(후보 1)를 함께 낸다(Harold 「구현까지 마무리」). 회의에서 2차 착수 조건이던 두 가지의 처리:
   - 업종 분포 실측 = 효과의 크기만 정한다. 업종이 없거나 셋 밖이면 지금 순서 그대로라 정합성 게이트가 아니다 → 배포 뒤 실측(§6).
   - 목업 승인 = Harold 직접 지시로 대체 · 배포 뒤 화면 확인(§6).
3. ~~템플릿 추가는 이 개편 뒤 단계~~ → ★Harold 1016 정정 「애초에 킬러 템플릿 추가가 안건이었다 · 50~80개 · 요식업을 늘려 80종」 → 같은 배포에 **+80(582종)** · 구성·규칙·검증 = [FEATURE-IMAGE-STUDIO §4-1-D](FEATURE-IMAGE-STUDIO.md) · 예시 배치는 배포 뒤 §5.

## 2. 수렴안

### 2-1. 결과 카드에서 채널로 바로 (`pages/ImageStudioPage.tsx`)
- 카드 버튼 = **채널 버튼 목록**(인앱메시지 · 회사 관리자만 / 모바일 DM / 이메일 · 세로 · 발사대와 같은 색) + 보조 줄 [라이브러리에 저장] [AI 수정 1]. 채널 목록은 파일 안 지역 부품 `ChannelButtons` 하나를 발사대 창과 결과 카드가 함께 쓴다(쓰는 곳 둘이 같은 파일 · 새 파일 0 · 인앱 관리자 판정 한 곳).
- 채널 버튼 = 저장(이미 저장된 카드면 생략) → **성공했을 때만** `putStudioDraft` → 이동(맨 주소 `/dm-builder` · `/email-campaigns` · `/inapp-messages` · 딥링크면 받는 쪽이 초안을 건너뛴다).
- 저장해도 카드를 지우지 않는다. 카드에 `saved` 기록 · 「저장됨」은 버튼 줄(포스터 위 X · 0813) · 저장된 카드는 AI 수정 숨김(저장이 temp 를 소비해 `/edit` 404 · 열려 있던 수정 칸도 닫는다).
- 저장 실패(§2-5 공용 처리) = 이동하지 않는다.
  - `STORAGE_FULL` → 카드 안 한 줄(서버 문구) + [저장 소재 정리](기존 관리 창).
  - `ALREADY_SAVED`(저장은 됐는데 응답 유실 · 두 번 누름) → 라이브러리 목록에서 그 tempId 파일을 찾아 `saved` 로 쓰고 그대로 진행. 못 찾으면 「기간이 지나 저장할 수 없어요」 한 줄 + 채널 버튼 숨김.
- 확인 단계는 한 곳: **저장 안 한 다른 포스터가 있을 때만** `ConfirmModal`(기존 altLabel/onAlt).
  - 이유 「저장하지 않은 포스터 N장은 이 화면을 떠나면 다시 볼 수 없어요」 · [모두 저장하고 이동] [이것만 저장하고 이동] [머무르기].
  - 모두 저장 = **누른 카드 먼저**, 그다음 나머지를 **차례로**(병렬 금지 · `/save` 용량 판정에 잠금이 없다 `routes/image-studio.ts` L486-489) · 첫 실패에서 멈추고 이동하지 않는다.
- 결과 머리 문구 · 캡션 정정(채널 버튼이 저장 뒤 편집기를 연다).

### 2-2. 템플릿 고르기 공용 부품 (`components/studio/TemplatePicker.tsx` 신설)
- `ImageStudioPage` 의 갤러리 상태 · 계산 · JSX(옛 L96-107 일부 · L150-155 목록 읽기 · L161-223 · L417-575)를 **로직 수정 없이** 옮긴다.
- props = `onPick(t)` · `rootExtra`(첫 화면에만 · 스튜디오 라이브러리 띠) · `autoOpenIndustry`(창 전용) · `gridClassName`(격자는 화면 폭 기준이라 창이 넓은 화면에서 5열로 카드가 작아진다 → 창은 `grid-cols-2 sm:grid-cols-3`).
- 보던 쪽 유지(Harold 0811 지시 · 옛 L216-223)는 **언마운트하지 않는 방식**: 스튜디오가 `<div hidden={stage !== 'gallery'}>` 로 감싼다. 감싸개에 display 클래스 금지(hidden 무력화). 계약 테스트로 고정.
- 공개 타입 `StudioTemplatePublic` 을 부품 파일이 소유하고 스튜디오·창이 import.

### 2-3. 우리 업종 먼저
- 백엔드 `GET /templates` 응답에 `industryCategories: string[] | null` 한 칸.
  - 업종 조회 = 기존 `resolveCompanyIndustry`(`utils/copy-prompt-composer.ts` · 실패 = null) export 재사용. 같은 SELECT 를 다섯 번째로 쓰지 않는다.
  - 업종 → 카테고리 = AI 영업 표 `INDUSTRY_TEMPLATE_MAP` 의 product 열을 화이트리스트 함수 `studioIndustryCategories(code)` 로 읽는다(beauty → 뷰티 · fashion → 패션 · food → 카페·음료 · 신메뉴·팝 · 외식·메뉴 · 그 밖 12코드·미설정 = null · 리빙 추천 0). 표 고침 = Harold 한 곳.
  - 라벨·내부 코드는 응답에 싣지 않는다(요식 라벨 '식품/F&B' 가 화면 문구로 맞지 않는다). 회사별 값이라 캐시 금지 주석.
- 스튜디오 = 제품 트랙 카테고리 카드에서 업종 카테고리를 맨 앞(표 순서 · 나머지는 지금 순서) + 카드 글자 줄에 「우리 업종」 배지. 자동 진입 없음 · 행사 트랙 · 검색 그대로. 캡션 「브랜드 기본 정보의 업종 기준으로 앞에 놓았어요」.
- 창 = 업종 카테고리가 **하나**(뷰티 · 패션)일 때만 그 카테고리 10장으로 연다. 요식(셋)·미설정이면 카테고리 화면부터(식당에 카페를 고르는 추측 금지).
- 브랜드 기본 정보 업종 칸 이름 「업종 (문안 생성 참조)」 → 「업종 (문안·템플릿 추천 참조)」(이제 사실과 다르다).

### 2-4. DM 삽입 창 = 고르기 → 만들기 → 결과 (`components/dm/build/StudioInsertModal.tsx`)
- 고르기 = `TemplatePicker`. 카드를 누르면 만들기 단계.
- 만들기 = 예시 크게 + **스튜디오 제작 화면과 같은 부품**(`components/studio/StudioMake.tsx` : `useStudioMake` + `StudioMakeFields` + `TemplateExampleCard`) · 문구 3칸 · 행사면 위치(기본 위) · 상품(선택) · 장면 힌트(선택). 필수 입력 0 증가 · 클릭 0 증가.
- 결과 = 미리보기(blob 주소 · 워터마크) · [다시 만들기] [이 그림 넣기]. 창에 AI 수정 없음.
- **닫기 = 숨김(취소 아님)**: 창의 단계 · 생성 중 상태 · 결과는 `ModalBase` 바깥(창 부품 자신)에 있어 닫아도 산다(호출부 4곳이 `open` 으로만 여닫는다). 다시 열면 이어서 보인다 → 2크레딧 낸 그림을 잃지 않고, 생성 중 다시 눌러 409 BUSY 가 나지 않는다. 처음 상태로 여는 것은 「처음 열 때」와 「넣기 성공 뒤의 다음 열기」뿐(`freshRef` · 그때 그 블록의 문구로 시작). 작성 중 · 만드는 중 · 생성 실패 뒤 · 결과 대기는 다시 열어도 그대로다(Codex 1R). 생성 중 한 줄 「만드는 중이에요(약 20~30초). 창을 닫아도 다시 열면 이어서 볼 수 있어요」.
- 요청 시간 제한 = **300초 안전판**(서버 최악 = 대체 판정 30초 + 엔진 120초보다 길게 · 먼저 끊지 않는다 · 응답이 끝내 안 올 때 「만드는 중」에 영영 묶이는 것만 막는다 · LESSONS_FRONTEND 닫기 잠금 = 영구히 갇힘).
- `STORAGE_FULL` = 한 줄 + [저장 소재 정리](공용 소재 창 · z 2000 이 창 위) · 결과 유지 · 정리 뒤 같은 그림 다시 넣기. `ALREADY_SAVED` = §2-5 로 찾아 넣기.
- 겹친 창 Esc: 부모 두 곳에 한 줄씩(`CatalogPageModal` · `BlockEditModal` 비도킹 = 스튜디오 창이 떠 있으면 Esc 무시) · 창 자신은 상품 창·소재 창이 떠 있는 동안 Esc 무시.
- 창 props 불변 → 호출부 4곳(BlockEditModal · CatalogPageModal · DmEditScreen ×2)은 Esc 줄 말고 0.

### 2-5. 공용 요청 · 문구 규칙
- `lib/studio-api.ts` 신설: `studioPost`(인증 · 시간 제한) · `saveStudioTemp(tempId, title)` → `{ ok, asset } | { ok:false, code, error }` · `findSavedStudioAsset(tempId)`(라이브러리 최신 200건에서 파일명이 tempId 인 소재 · `moveTempToPermanent` 파일명 규약 = `${tempId}.${ext}` · 결과 = 찾음 / 없음 / 조회 장애 · 없음만 만료이고 조회 장애는 결과를 남겨 다시 누르게 한다(Codex 1R)). `/save` 를 부르는 두 화면이 같은 함수를 지난다(LESSONS_FRONTEND 「같은 응답 코드를 받는 창 전수」).
- `lib/studio-texts.ts` 신설: 문구 자동 채움 규칙 순수 함수. 템플릿·상품이 바뀌면 **비어 있거나 직전 자동값 그대로인 칸만** 새 자동값으로 바꾼다. 호출부가 준 값(블록 제목)과 사람이 친 값은 덮지 않는다. 지금 스튜디오는 상품을 고르면 친 문구가 지워진다 → 함께 고쳐진다.
- 워터마크 = `components/studio/StudioWatermark.tsx` 로 옮기고 표시 글자는 부품이 로그인 정보로 만든다(props 0). 창 미리보기는 `relative` 감싸개 안에(없으면 `absolute inset-0` 이 창 배경막까지 덮는다).
- 흰 표면 규칙(`dm-build-light-surface.test.ts`): 창 안에 그려지는 공용 부품(TemplatePicker · StudioMake)은 다크 전제 색 0. 만들기·채움 버튼은 부품 밖(스튜디오 = 페이지 버튼 · 창 = ModalButton) · 「연동 몰에서」 는 외곽선 버튼.

## 3. 영향표

| 대상 | 바뀌는 것 | 소비처 · 확인 |
|---|---|---|
| `pages/ImageStudioPage.tsx` | 갤러리 → TemplatePicker(hidden 감싸개) · 제작 → StudioMake · 결과 카드 채널 버튼 · 저장 처리 · 워터마크 import | 라우트 `/image-studio` 하나(App.tsx PlanGate) · 계약 `image-studio-engine-0930`(4K 문자열 없음) 유지 |
| `components/dm/build/StudioInsertModal.tsx` | 3단 · 자동 선택 삭제 · 닫기 = 숨김 · 저장 코드 처리 | 호출부 4곳 props 불변 · 계약 `dm-blocks-contract` 3번 · `dm-build-light-surface` |
| `components/dm/build/BlockEditModal.tsx` · `CatalogPageModal.tsx` | ModalBase `closeOnEsc` 한 줄 | 각자 자기 창만 |
| 신설 `components/studio/{TemplatePicker,StudioMake,StudioWatermark}.tsx` · `lib/{studio-api,studio-texts}.ts` | 공용 부품 · 함수 | 스튜디오 · 창 둘뿐 |
| `components/AiMemory/BrandBasicInfoTab.tsx` | 업종 칸 이름 한 줄 | 화면 문구만 |
| `backend/routes/image-studio.ts` `/templates` | async · `industryCategories` 한 칸 추가(기존 필드 그대로) | 읽는 곳 = 스튜디오 · 창(둘 다 이번에 같이) · 옛 화면은 추가 필드 무시 → 백엔드 선배포 안전 |
| `backend/utils/copy-prompt-composer.ts` | `resolveCompanyIndustry` export(동작 무변경) | 기존 내부 호출 그대로 |
| `backend/utils/sales-outreach-produce.ts` | `studioIndustryCategories` 함수 추가(표 무변경) | AI 영업 경로 무접촉 |
| 손대지 않는 것 | `/generate` · `/save` · `/edit` · 크레딧 · 엔진 · 카탈로그 · `putStudioDraft` · 받는 쪽 3곳 · ModalBase · ConfirmModal · AssetLibraryPickerModal | DB 0 · 발송 · 돈 경로 무접촉 |

## 4. 시험

- 신설: `studio-texts` 자동 채움 규칙(사람 값 보존 · 직전 자동값만 교체 · 토큰 치환) · `studioIndustryCategories`(세 코드만 · 나머지·null = null · 값이 실제 제품 카테고리) · 계약(스튜디오가 TemplatePicker 를 hidden 감싸개로 두고 조건부로 지우지 않는다 · 창에 첫 항목 자동 선택이 없다 · `/save` 를 부르는 두 화면이 `saveStudioTemp` 를 지나고 STORAGE_FULL·ALREADY_SAVED 를 가른다 · 인앱 채널은 관리자만).
- 이사: `dm-blocks-contract` 3번 검사 대상 · `dm-build-light-surface` 파일 목록 · 입력칸 색 검사 대상.
- backend tsc 0 · frontend tsc 0 · backend vitest 전체 · 화면 문구 모델명 · 줄표 grep 0.

## 5. 갈린 지점과 택한 근거

| 쟁점 | 갈림 | 택 | 근거 |
|---|---|---|---|
| 창 만들기 칸 | 같은 제작 부품(기획·프론트·회의론자) / 제목·부제만(디자이너) | 같은 부품 | 두 창이 갈라진 뿌리 = 복사 · 창에서는 상품을 넣을 길이 없다 |
| 생성 중 닫기 | 잠금(회의론자 1차·기획·백엔드) / 열어 둠 | 닫기 = 숨김 | 회의론자 최종안 · 잠금 = 영구히 갇힘 · 취소 = 돈 낸 그림 손실 |
| 시간 제한 | 없음(회의론자 최종) / 90·150초 | 300초 안전판 | 서버 최악보다 길어 먼저 끊지 않으면서 영구 대기만 막는다 |
| 채널 목록 위치 | 공용 상수 파일 / 파일 안 부품 | 파일 안 부품 | 쓰는 곳 둘이 같은 파일 |
| 업종 응답 | 라벨 포함 / 카테고리만 | 카테고리만 | 요식 라벨이 화면 문구로 맞지 않다 |
| 업종 표 | 스튜디오 전용 3줄 / 기존 표 | 기존 표 | 같은 표 두 벌 금지 |
| 저장 공간 가득 | 토스트 / 카드 안 한 줄 | 카드 안 | 그 자리에서 정리 창 1클릭 |

접은 것 = 카테고리 카드 실제 썸네일(근거가 소개 페이지 건이었다) · 업종 선반 · 업종 미설정 안내 줄(실측 뒤) · DmEditScreen 제목 넘기기(넘길 제목이 없다) · 뒤로가기 중복 DM(결과는 React 상태뿐이라 생기지 않는다).

## 6. 미검증 · 배포 뒤 실측

- 업종 분포 `SELECT industry_code, count(*) FROM companies GROUP BY 1` (효과 크기 · 미설정 안내 줄 판단).
- 화면 1440 · 390 · 창 1366×768: 줄 맞춤 · 창 세로 스크롤 하나 · 결과 카드 높이.
- 실측 1건: 스튜디오 생성 → 결과 카드 [모바일 DM 만들기] → DM 편집기에 포스터 · 창에서 행사 템플릿 문구 위치 위.
- 운영 nginx `/api/` 응답 대기 시간(짧으면 생성 응답이 중간에 끊긴다 · BUGS 줄에 함께).

## 7. 범위 밖 (BUGS 등재만)

- `backend/src/app.ts` · `/api/image-studio` 서버 쪽 요금제 검사 없음.
- `routes/image-studio.ts` `/generate` · 화면이 떠나도 성공 뒤 차감(구조체크 후보 3 · 멱등키).
- `CatalogPageModal` 쪽 사진 자리에 문구 포스터를 넣으면 쪽 제목과 글자가 이중.
- 체험 회사가 스튜디오에서 이메일로 넘어가면 저장 때 403(`EmailCampaignsPage` 잠금 처리 없음 · 발사대에 원래 있던 경로).
- `/save` 가 임시 파일을 소비한 뒤 소재를 등재해 등재 실패 시 같은 그림으로 다시 저장할 수 없다(Codex 1R [범위 밖]).
- 등재 = [BUGS B-1016-3](../status/BUGS.md).

## 8. Codex 이력

| 라운드 | 결과 | 처리 |
|---|---|---|
| 1R | needs-attention · medium 3 | 자동 채움 직전값 지역 상수 · 조회 장애 ≠ 만료 · DM 창 다시 열기는 넣기 성공 뒤에만 처음 상태 · 전부 수용 |
| 2R(증분) | **approve** · 지적 0 | 직전값 캡처 · FAILED 결과 보존 · freshRef 다음 열기 반영 확인 |
| 3R(템플릿 +80 데이터 · Harold 추가 지시) | needs-attention · medium 3 | 사은품 단정 문구 → 중립 문구 · 글자를 부르는 소품 무문자 지시 누락 7곳 → 개별 땜질 대신 표준 문장 규칙(제품용 · 영업 장면 필터 단어를 피한 행사용) · 제품 카테고리 일러스트 → 실사 + 생성 스크립트 차단 · 전부 수용 |
| 4R(증분) | **approve** · 지적 0 | 중립 문구 · 표준 문장과 장면 모순 없음 · 출석 체크 실사·여백·글자 금지 확인 |
