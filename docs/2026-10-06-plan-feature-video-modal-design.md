# 기능 안내 창 · 예시 영상 + 상세 설명 (2026-10-06)

> Harold 지시(10-06): 요금제 미가입 회사가 AI Operator에서 기능을 누르면 뜨는 안내 창을 **왼쪽 예시 영상 · 오른쪽 기능 상세 설명**으로 올린다.
> 「영상은 예시니까 우측에 설명을 제대로 해 줘야 한다 · 자동마케팅도 원하는 시간 · 예산 등 자유롭게 설정 가능하잖아」.
> 목업 승인 = 같은 날 「너무 맘에 든다 · 추천대로 구현 설계서 쓰고 구현까지」.
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

## 8. 배포 전 확인 1건

- 플래너 「재료를 넣으면 AI가 완성본을 만듭니다」는 회사 스위치 `AI_AUTO_BUILD_COMPANY_IDS` 가 `*` 일 때만 모든 회사에 참이다. **운영 값 = `*` 확인(10-06 · Harold 실측)** — 백엔드 프로세스 cwd 에서 `dotenv` 로 읽은 값. ⚠ `/proc/<pid>/environ` 은 비어 나온다(앱이 시작 뒤 `.env` 를 프로세스 안에서 읽는다 · `app.ts` 첫 줄) — 그 출력은 「꺼짐」의 증거가 아니다.
- 배포 = 프런트만(`git pull` → `npm run build:safe` · 원자 교체라 끊김 없음) · 백엔드 재시작 없음.
