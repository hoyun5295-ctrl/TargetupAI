# 기능 안내 창 · 예시 영상 + 상세 설명 (2026-10-06)

> Harold 지시(10-06): 요금제 미가입 회사가 AI Operator에서 기능을 누르면 뜨는 안내 창을 **왼쪽 예시 영상 · 오른쪽 기능 상세 설명**으로 올린다.
> 「영상은 예시니까 우측에 설명을 제대로 해 줘야 한다 · 자동마케팅도 원하는 시간 · 예산 등 자유롭게 설정 가능하잖아」.
> 목업 승인 = 같은 날 「너무 맘에 든다 · 추천대로 구현 설계서 쓰고 구현까지」. **배포완료(1006 · 허브 카드 12개 · 영상 12편 · Harold).**
> 원 창 = `PlanFeatureModal`(2026-09-15 · 결정 D90) · 문안 원장 = `frontend/src/constants/plan-feature-intros.ts` · 계약 = `backend/src/utils/__tests__/plan-feature-modal-contract.test.ts`.

---

## 1. 무엇이 바뀌나

| | 지금 | 바뀐 뒤 |
|---|---|---|
| 영상 있는 기능(4) | 한 단 · 설명 · 3단계 · 크레딧 칩 | **두 단**: 왼쪽 예시 영상(세로) · 오른쪽 이렇게 씁니다 · 직접 정할 수 있는 것 · 알아서 지켜 주는 것 · 드는 크레딧(표) · 아래 고정 요금제 안내 + 버튼 |
| 영상 없는 기능(18) | 그대로 | 그대로(마크업 무변경) |
| 휴대폰 폭 | 아래에서 올라오는 창 | 같음 · 영상은 위쪽 작은 칸(가로로 설명 문구와 나란히) · 설명은 아래 스크롤 |

영상 있는 기능 = 자동 마케팅(`auto-marketing`) · 여정 자동화(`journeys`) · 마케팅 플래너(`marketing-planner`) · 이미지 스튜디오(`image-studio`).
나머지는 영상이 생기는 대로 원장에 `video`·`options`·`safeguards`만 채우면 같은 두 단 창이 된다(창 코드 수정 0).

## 2. 원장 칸 (plan-feature-intros.ts)

- `video?: { src; poster }` — 있으면 두 단. 경로 = `/videos/plan-feature/<id>.mp4` · `.jpg`(프런트 `public/` · `build:safe` 원자 배포에 함께 실린다).
- `options?: { title; text; chips?; wide? }[]` — **설정 화면에 실제로 있는 항목만**.
- `safeguards?: { title; text }[]` — **코드에 있는 안전장치만**.
- `costs` — 기존 규약 그대로(숫자 = 백엔드 `CREDIT_COST_MAP[source]` · 계약 테스트가 막는다) · 두 단 창에서는 표로 그리고 `costNote`를 표 아래에 함께 보인다.

## 3. 문안 근거 (코드 확인 · 10-06)

| 기능 | 문장 | 근거 |
|---|---|---|
| 자동 마케팅 | 시나리오 9 · 발송 대상 11 · 주기 4 · 08:00~20:59 또는 AI 시각 · SMS/LMS/MMS(이미지 3) · 문안 느낌 4 · 문안 직접 쓰기 · 혜택 · 예산(월 · 하루 · 알림 80%) · 리마인드 1~30일 · 담당자 3 + 백업 · 준비 시간 기본 120분 | `OperatorSetupModal.tsx` · `ScenarioStart.tsx` · `automarketing-segment.ts` · `autosend-policy.ts`(COPY_STYLES · SendTimeMode · resolveAutoSendLeadMinutes) · `validateOperatorInput` |
| | 승인 기간 = 다음 회차부터 7일 · 끝나기 하루 전 요약 | `computeApprovalWindow` · `buildRenewalNoticeBody` |
| | 3사 스팸 검사 · 3안 차례 · 실패 시 정지 · 화면 재검사 5회 무료 · 발송 전 담당자 문자 · 대상 없는 날 미발송 · 미차감 · 야간 금지 · 080 | `continuous-operator.ts`(회차 검사 · 정지 · `sendAutoSendPrepNotice` · Zero-Count) · `PROPOSAL_SPAM_RETEST_LIMIT` · `SEND_HOURS` |
| 여정 | 시작 사건 12 · 세부 조건 · 단계별 SMS/LMS/MMS · 목표 달성 종료 · 상한 · 월 예산 · 단계당 한도 · 재진입 대기 · 대조군 0~30% · 발송 시각 개인화(90일) | `FEATURE-JOURNEY.md §4` · `JourneyOptionsEditor.tsx` · `JourneyStepStudio.tsx` |
| | 2시간 전 스팸 검사 · 재작성 1회 · 실패 시 정지 · 과거분 소급 금지 · 재개 무료 | `journey-pretest-notifier.ts` · `FEATURE-JOURNEY.md §2` · `journey-activate` 주석 |
| 마케팅 플래너 | 행사 · 채널 · 재료 · 3일 전 확인 링크 · 행사별 승인 · 예정일 08시부터 · 지문 대조 · 미승인 미차감 · 소진 보류 · 취소 환불 | `planner-review.ts`(PLANNER_LINK_LEAD_DAYS) · `planner-executor.ts`(SEND_HOURS) · `2026-10-04-planner-material-approval-design.md §4 · §7` |
| | ⚠ 재료로 완성본 만들기 = 회사 스위치 `AI_AUTO_BUILD_COMPANY_IDS`(`*` = 전 회사). 운영 값 = **배포 전 확인**(기록상 `*`) | `ai-auto-build-materials.ts` |
| 이미지 스튜디오 | 템플릿 502(제품 329 · 행사 173 · 16 분류) · 세부 분류 · 검색 · 제품/행사 · 사진 올리기 · 몰 상품 · 배경 자동 제거 · 문구 위치 · AI 수정 · 채널 발사대 · MMS 자동 변환 · 인앱 = 회사 관리자 | `image-studio-templates.ts`(listTemplatesPublic 실측) · `ImageStudioPage.tsx` · `FEATURE-IMAGE-STUDIO.md §2 · §3 · §6` |
| | 생성 = 포스터 1장 2크레딧(옛 원장 「후보 2장」은 틀렸다 · 2026-07-30 단일 생성) | `ImageStudioPage.tsx` 「2크레딧·1장」 · `CREDIT_COST_MAP` |

영상 속 문구 중 확인하지 못한 것(예: 「30초 만에」)과 실제와 다른 장면(AI가 할인율을 지어낸 문안)은 **창 문장에 쓰지 않는다**. 영상 수정은 별도(만든 세션).

## 4. 영상 자산

- 원본 = Harold 다운로드 폴더 `한줄로-자동마케팅 · 여정설계 · 마케팅플래너 · 이미지스튜디오-릴스.mp4`(1080×1920 · 15초/25초 · 음악 트랙).
- 가공 = 끝 장면(hanjul.ai 안내) 잘라 반복 · 720×1280 · H.264 · 무음 · faststart → 0.5~1.8MB. 포스터 = 4초 장면 JPG.
- 재생 = 창이 열릴 때만(`preload="metadata"`) · 무음 자동 반복 · `playsInline` · 창을 닫으면 요소가 사라져 멈춘다 · **움직임 줄이기 설정이면 자동재생 대신 재생 버튼**.

## 5. 영향표

| 소비처 | 영향 |
|---|---|
| `Dashboard.tsx` · `AiOperatorPage.tsx` · `DirectSendPanel.tsx` · `BrandSendModal.tsx` · `PlanGate.tsx`(같은 창) | 영상 있는 4기능을 열 때만 두 단 · 그 밖 무변경 |
| `plan-feature-intros.ts` 다른 18항목 | 무변경 |
| 판정(열어 줄지) | 무변경(호출부 · 서버 `isAiOperatorAllowed`) |
| 서버 | 무변경(배포 = 프런트 `build:safe`만 · 백엔드 재시작 없음) |

## 6. 검증

- 계약 테스트에 추가: 영상 4기능의 파일 실존 · 영상 칸이 있으면 설정 · 안전장치 칸도 있음 · 창이 무음 · 반복 · `playsInline` · 움직임 줄이기 분기 · 영상 없는 기능은 한 단 · 기존 금칙어(줄표 · 모델명 · 문장 속 크레딧 숫자) 그대로 전 문장.
- tsc 0 · 백엔드 vitest 579파일 8,199건 · 결함 주입 2종(재생 버튼 분기 제거 · 포스터 파일 삭제) 잡힘.

## 7. Codex 적대 검토 (Harold 「닫힐 때까지」 · `--model gpt-6-astra`)

- **1R medium 5 = 적용 조건을 빼고 약속한 문장 4 + 짧은 화면 1** → 전부 수용.
  ① 플래너 환불 = **발송 처리가 시작되기 전** 취소만(`planner-touchpoint.ts` 실적 = producing · scheduled · 발송 시작 포함 · `planner-execution.ts` 실적 있으면 환불 없음)
  ② 자동 마케팅 직접 쓴 문안 = 같은 문안(발신번호 · 제목 · 본문 지문)이 통과했으면 결과 재사용 · 바뀌면 재검사(`continuous-operator.ts` `cachedPass`)
  ③ 여정 = 검사는 모든 단계 · **통과 알림만** 단계별 설정(기본 첫 · 마지막 · `journey-pretest-scan.ts` `resolveNotify`)
  ④ 스튜디오 문구 위치 = **행사 포스터만**(`ImageStudioPage.tsx` 제품 템플릿은 `textPosition: null`)
  ⑤ 320×568 휴대폰에서 설명이 사라짐 → 휴대폰 = 영상 · 머리 · 설명 한 스크롤 묶음 + 버튼 고정 · PC = 그 묶음 `sm:contents` 로 격자 2열 3행.
- **2R approve(지적 0) = 닫힘.** 1R 에서 훅 순서 · 참조값 초기화 · 영상 없는 한 단 창은 문제 없음.
- 교훈: 영상은 예시라도 오른쪽 문장은 약속이다 → **장치를 적을 때 적용 조건(언제 · 누구에게 · 무엇이 바뀌면)까지 함께 적는다.**

## 7-2. 허브 카드 12개 전부 상세 설명 (Harold 10-06 「영상 오늘 다 만들 테니 전체 먼저 · 영상 오면 매칭해 한 번에 배포」)

- 나머지 8기능(모바일 DM · 이메일 마케팅 · 인앱메시지 · 만들기 · SNS 채널 · 자사몰 연동 · 성과리포트 · AI 메모리)의 `options` · `safeguards` · 비용 · 설명을 코드 기준으로 씀. **영상 줄(`video`)은 파일이 올 때 붙인다** — 그 전에는 지금 한 단 창 그대로(새 칸은 영상 창에서만 그린다).
- 같이 바로잡은 옛 원장: 자사몰 연동 「연동하면 매일 분석 크레딧」(틀림 · 매일 분석은 연동과 무관하게 요금제 + 고객 데이터 보유 회사 전부 · `predictive-worker.ts`) → 「연동 자체에는 크레딧이 들지 않습니다」 · 이메일 창 제목 「Email 캠페인」 → 허브 카드와 같은 「이메일 마케팅」.
- Codex: 1R medium 8(전부 적용 조건 누락 · 같은 부류) — DM 발행 = 처음 발행(링크만 받기 포함) · 질문 몇 개 = 오토설계 50 별도 · 이메일 완성 = 처음 완성(보내지 않고 완성 포함) · 만들기 몰 재조회 실패 시 담아 둔 정보 · 인앱 웹/앱 형태 · 트리거 구분과 앱 연동 코드 · 인앱 혜택은 게시에서 막힘(초안 저장은 됨) · SNS 회사에 열린 채널만 · 자체 몰 = 한줄로 키 + 개발 · 성과 매출은 구매 데이터가 있을 때 → 2R medium 1(앱 「아래 배너」 → 실제 라벨 「바텀 시트」) → **3R approve = 닫힘**.
- 계약: 허브 카드 12개 모두 `options` · `safeguards` 보유 · 옛 문구 재발 차단.

## 7-3. 영상 12편 붙임 (Harold 10-06 「전부 다 만들었다 · 알아서 복사해 푸시에 같이」)

- 원본 = 다운로드 폴더 `한줄로-<기능>-릴스.mp4`(10-06 15:27~15:50 · 1080×1920 · 15초). 여정 · 플래너는 **새 판으로 교체**(여정 = 「다음 여정으로 이어져요」 · 플래너 = 「발송 3일 전 휴대폰으로 실물 보고 승인」 — 지금 동작과 더 맞음). 자동 마케팅 · 이미지 스튜디오는 앞의 판 그대로.
- 가공 = 10.9초에서 자름(11.0초부터 끝 장면 전환 점 · 끝 프레임 12장 육안 확인) · 720p · 무음 · 포스터 = 5초 장면. 12편 합 7.5MB.
- 계약 = 영상 기능 = 허브 카드 12개와 같은 집합 · 파일 24개 실존 · 결함 주입(영상 하나 제거) 잡힘. 테스트의 항목 나누기 정규식이 `id` 앞 주석 줄이 있는 항목(만들기)을 앞 항목과 섞던 결함을 같이 고침.
- Codex = approve(지적 0).

## 8. 배포 전 확인 1건

- 플래너 「재료를 넣으면 AI가 완성본을 만듭니다」는 회사 스위치 `AI_AUTO_BUILD_COMPANY_IDS` 가 `*` 일 때만 모든 회사에 참이다. **운영 값 = `*` 확인(10-06 · Harold 실측)** — 백엔드 프로세스 cwd 에서 `dotenv` 로 읽은 값. ⚠ `/proc/<pid>/environ` 은 비어 나온다(앱이 시작 뒤 `.env` 를 프로세스 안에서 읽는다 · `app.ts` 첫 줄) — 그 출력은 「꺼짐」의 증거가 아니다.
- 배포 = 프런트만(`git pull` → `npm run build:safe` · 원자 교체라 끊김 없음) · 백엔드 재시작 없음.

## 9. 남은 것 (착수 판단 = Harold님)

- 허브 카드 아래 한 줄 설명 일부가 지금 동작과 다르다(`ai-operator-modules.ts` · 자동 마케팅 「매일 AI 캠페인 자동 제안」 · 마케팅 플래너 「월간 행사 계획 → AI 대행」 · 여정 「AI 여정 7종」 · 이미지 스튜디오 「상품→AI 배경 소재 완성」).
- SNS = 회사 단위 개방(`SNS_COMPANY_IDS` = 테스트 계정 1곳 · 1006 실측). 그 전까지 요금제 사용자도 같은 안내 창(가이드)을 본다(Harold 1006 「가이드만 넣어 두고 실제 기능은 그다음」). 개방 = Meta 심사 · 게시 실측 뒤 `*` + 백엔드 재시작([FEATURE-SNS-CHANNEL §7](FEATURE-SNS-CHANNEL.md)).
- 도움말 카탈로그(`content/feature-catalog.ts`) 자동 마케팅 항목에 화면 스팸 검사 단계가 없다.

## 10. 기능 관심 업체 (Harold 10-06 「클릭한 업체가 누군지 · 슈퍼관리자에 나만 볼 수 있는 메뉴로」)

- 기록 = 안내 창 한 곳(`PlanFeatureModal`): 창이 열릴 때 1건 · 「요금제 보기」 1건 → `POST /api/plans/feature-seen`(로그인 필수 · 사용자당 1분 30회 · 응답을 기다리지 않음). 서버는 **고객사 사용자만** 기록(슈퍼관리자 · 회사 없는 토큰 제외 · 회사 = 토큰 값).
- 저장 = 기존 `audit_logs` + `recordAuditLog`(새 테이블 · DDL 0) · action `plan_feature_open` · `plan_feature_pricing` · target_type `plan_feature` · details `{ featureId, companyId }`. 감사 로그 목록에도 함께 보인다(행동 필터로 거름 · 로그인 차단 · 요금 방식 이력은 action 으로 걸러 영향 없음 = Codex 1R 확인).
- 열람 = 슈퍼관리자 「AI · 콘텐츠 → 기능 관심 업체」 · `FEATURE_INTEREST_VIEWER_IDS`(기본 `ceo`) AND 등급표 `featureInterest`(대표 조회만) · 다른 계정은 메뉴 자체가 없다. 집계 CT = `utils/feature-interest.ts`(SQL 묶음으로 전부 셈 · 시간순 기록만 회사당 30건) · 화면 = `FeatureInterestTab.tsx`.
- Codex 적대: 1R medium 2(기록 호출 상한 없음 · 30건 밖 클릭이 기능별에서 빠짐 → 원장 행을 JS 로 묶던 구조를 SQL 묶음으로 바꿔 2만 건 상한도 제거) → **2R approve**.
- 기록은 배포 시점부터(그 전 기록 없음).
- ★1007 업체별 표 개편(Harold 「회사명부터 다 깨진다 · 클릭하면 모달」 · 목업 2안 승인) — 원인 = 「본 기능」 칩이 표 폭을 거의 다 가져가고 줄바꿈 막는 설정이 없어 회사 · 요금제 · 사람 칸이 세로로 쪼개짐.
  표 = 줄마다 한 줄(회사 · 요금제 · 본 기능 · 열람 · 요금제 보기 · 바로가기 · 마지막 · 본 사람 수) · 회사명 · 본 기능은 칸 안 상자가 말줄임 · 본 기능은 마우스를 올리면 전체 목록 말풍선(화면 기준 자리 · 스크롤하면 닫힘) · 줄을 누르면(Enter · Space 도) 상세 창(숫자 4칸 · 기능별 열람 · 본 사람 전체 · 시간순 최근 30건). 상세 창 닫기 = X · [닫기] · ESC 만. 화면 파일 하나 · 서버 변경 0 · 계약 = `feature-interest-1006.test.ts` 「업체별 표」 4건(결함 주입 2종 잡힘).

## 11. 로그인 안내 창 (Harold 10-06 「로그인하면 지금 바로 한줄로 AI Operator 기능을 살펴보세요 · 영상과 함께 · 지금 바로가기」)

- 대상 = 허브와 같은 서버 판정 `fetchAiOperatorAccess()` 가 **false** 인 회사(요금제 미가입 · 잠김). 모름(오류 · 응답 없음)은 띄우지 않는다.
- 빈도 = **로그인 1회마다 1번**. 표식 = 토큰 끝 24자(`localStorage['ai-op-login-promo-seen']`) · 토큰은 로그인할 때만 바뀐다(authStore).
- 화면 = 대시보드(`<AiOperatorLoginPromo blocked={loginPromoBlocked} />`) · 영상 = `auto-marketing.mp4`(무음 · 동작 줄이기 설정이면 정지) · 칩 5줄(원장 `plan-feature-intros.ts` 와 같은 사실만) · 「지금 바로가기」 → `/ai-operator` · 「다음에 볼게요」.
- 기록 = §10 과 같은 원천(`audit_logs`) · featureId `login-promo` · 뜬 것 = `plan_feature_open` · 바로가기 = `plan_feature_go`(새 action). 「기능 관심 업체」 기능 선택에 「로그인 안내 창」 · 회사 표에 「바로가기 N회」.
- 겹침 = 요금제 변경 알림(최초 1회 자동)이 정해지기 전 · 열려 있는 동안은 기다린다(렌더 때 아는 값 `loginPromoBlocked`).
- 한 번 보장 = 탭 사이 잠금(`navigator.locks`) 안에서 표식을 다시 보고 **저장에 성공한 탭만** 띄우고 기록한다. 잠금이 없는 브라우저 · 표식 저장 실패 = 띄우지 않는다(중복 노출보다 안 뜨는 쪽). 한 화면에서 한 번 띄우면 다시 띄우지 않는다(`shownRef`).
- 접근성 = Esc 닫기 · Tab 은 창 안에서만 · 닫으면 포커스 복귀 · 뒤 화면 스크롤 잠금.
- Codex 적대: 1R(탭 두 개 중복 · 요금제 변경 알림과 겹침 · 포커스 이탈) → 2R medium 2(잠금 없는 브라우저 중복 · 표식 저장 실패 시 재표시) → **3R 지적 없음**.
