# DM 인터랙션 실동작 엔진 설계서 (B) — 2026-06-13

> 모바일 DM 전면 재설계 7개 서브 중 **B**. 순서: B(이 문서) → A(섹션 editor) → C(이미지) → D(빠른시작 12) → E(디자인) → F(크레딧 재설계) → G(AI 캠페인 자동화).

## 배경 (검색 실측)

룰렛·추첨·설문·이메일수집 섹션이 **UI 껍데기**다. `dm-viewer.ts`는 페이지 조회·섹션 클릭을 **추적만** 하고, 참여 제출·당첨 처리·결과 조회 백엔드가 **하나도 없다**. 룰렛 "돌리기" 버튼도 클릭 카운트만 올린다.

- `dm_event_responses`(응답 저장소)는 D216+에 신설됐으나 **사용 코드 0**.
- `dm_pages.event_type`(lucky_draw/roulette), `quick_start_scenario` 컬럼 존재.
- props에 동작 의도가 이미 담겨 있다: `roulette.segments[].probability`(실시간), `lucky_draw.draw_at`+`form_fields`+`consent_text`(마감 추첨), `poll.show_result_after_vote`(실시간 집계).

## 목표

인터랙션 섹션이 실제로 **참여를 받고 → 당첨을 처리하고 → 회사가 결과를 조회·다운로드**한다. DM이 단순 전단이 아니라 **캠페인 자동화급**이 된다. (Harold: 사전 지정/랜덤 둘 다, DB 다운로드, 단축URL 반응도, DM 페이지 내 통합.)

## 전제 (실측 확정)

- `dm_event_responses`: company_id, campaign_id(dm_pages.id), section_id, section_type, customer_id(NULL), anonymous_id, response_data(jsonb), ip_address, user_agent, occurred_at. 인덱스 3종 보유.
- 라우트: 공개 `dmPublicRouter`(`/api/dm/v`, 인증X, helmet 전) + 인증 `/api/dm`.
- `dm-viewer`가 `?p=phone`을 읽는다(`PHONE = URLSearchParams.get('p')`). 발송 시 부착 경로 연결 필요(구현 시 확인).
- 식별 = "둘 다 혼합"(Harold): 발송 고객 = ?p= → customers 매칭 = customer_id, 공유 비회원 = anonymous_id(쿠키) + 폼 입력.

## 1. 데이터 모델

### 1-A. `dm_event_responses` (기존 활용)
참여 1건 = 1행. `response_data` jsonb 스키마(섹션 타입별):
- `poll`: `{ option_ids: string[] }`
- `survey`: `{ answers: { [qid]: string|string[]|number } }`
- `email_capture`: `{ email, consent: bool, consent_at }`
- `lucky_draw`: `{ name, phone, email, consent, consent_at }`
- `roulette`: `{ spin_result: { segment_id, label, won: bool, reward? } }`
- `click_rewards`: `{ count }`

중복 방지: 부분 UNIQUE 인덱스 `(campaign_id, section_id, COALESCE(customer_id::text, anonymous_id))` = 1인 1회(one_per_user 섹션).

### 1-B. `dm_prizes` (신규 — 경품/등급/재고)
```sql
CREATE TABLE dm_prizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES dm_pages(id) ON DELETE CASCADE,
  section_id uuid NOT NULL,                 -- 어느 룰렛/추첨 섹션
  rank integer NOT NULL,                    -- 1~5등 (낮을수록 상위)
  name text NOT NULL,                       -- 경품명
  total_count integer NOT NULL,             -- 당첨 인원
  remaining integer NOT NULL,               -- 잔여 (룰렛 실시간 차감)
  win_method varchar(20) NOT NULL,          -- 'random' | 'preset' | 'roulette'
  roulette_segment_id varchar(10),          -- 룰렛 세그먼트 매핑 (random/preset은 NULL)
  reward_code_pool jsonb,                   -- 선택: 발급할 쿠폰 코드 풀
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dm_prizes_campaign ON dm_prizes(campaign_id, section_id);
```

### 1-C. `dm_winners` (신규 — 당첨자)
```sql
CREATE TABLE dm_winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES dm_pages(id) ON DELETE CASCADE,
  prize_id uuid REFERENCES dm_prizes(id) ON DELETE SET NULL,
  response_id uuid REFERENCES dm_event_responses(id) ON DELETE SET NULL, -- 응모행 (preset은 NULL 가능)
  rank integer,
  win_method varchar(20) NOT NULL,          -- 'random' | 'preset' | 'roulette'
  winner_name text, winner_phone text, winner_email text,
  is_member boolean NOT NULL DEFAULT false,
  reward_code text,                         -- 발급 코드 (선택)
  notified_at timestamptz,                  -- 당첨 통보 시각 (F/G에서 발송 연동)
  drawn_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dm_winners_campaign ON dm_winners(campaign_id, rank);
CREATE UNIQUE INDEX uniq_dm_winners_response ON dm_winners(response_id) WHERE response_id IS NOT NULL;
```

> 신규 3요소(테이블 2 + 부분 UNIQUE 인덱스)는 구현 시 `information_schema`로 재확인(db_column_verify). 이 spec의 DDL은 설계안.

## 2. 참여 수집

### 2-A. 공개 제출 endpoint
`POST /api/dm/v/:code/submit` (dmPublicRouter, 인증X)
- body: `{ section_id, section_type, data, anonymous_id }`
- `?p=phone` → customers 매칭 → customer_id, is_member=true. 없으면 anonymous_id.
- 동의 필수 검증(`consent_required` 섹션은 data.consent=true 강제).
- 중복 검사(부분 UNIQUE) → 이미 참여면 409 + 기존 결과 반환(룰렛은 이전 당첨결과).
- `dm_event_responses` INSERT.
- 룰렛이면 즉시 추첨(3-A) → 결과 동봉.
- 응답: `{ success, already?, result? }`.

### 2-B. 뷰어 JS (dm-viewer 확장)
- 룰렛: 회전 애니메이션 시작 → submit → 서버 당첨 세그먼트로 휠 정지 + 결과 표시.
- 폼(lucky_draw/email_capture): 필드 검증 + 동의 체크 + submit → 접수 확인 화면.
- poll: 옵션 선택 → submit → 실시간 % 막대.
- 제출 결과는 localStorage에도 캐시(재방문 중복 표시).

## 3. 추첨 엔진 3방식

### 3-A. 룰렛 — 실시간 즉시 당첨
submit 시점:
1. 해당 섹션 `dm_prizes`(roulette_segment_id 매핑) 중 `remaining > 0` 세그먼트만 후보.
2. `probability` 가중 랜덤 선택. 재고 소진 세그먼트는 "꽝"으로.
3. 당첨 시 원자적 차감: `UPDATE dm_prizes SET remaining = remaining - 1 WHERE id = $1 AND remaining > 0 RETURNING id` — 0행이면 동시성으로 소진 → 꽝 재판정.
4. `dm_winners` INSERT + `response_data.spin_result` 기록.

순수 함수: `pickRouletteSegment(segments, prizesRemaining, rng)` → TDD(가중 랜덤, 재고 반영, 전부 소진=꽝).

### 3-B. 자동 랜덤 추첨 — 마감 후
- `dm_pages.event_type='lucky_draw'` + `draw_at`.
- 신규 워커 `dm-draw-worker`(1분 cron): `draw_at <= NOW` + 미추첨 캠페인 → 응모자(`dm_event_responses`) 풀에서 등급별 인원 랜덤 추첨(상위 등급부터, 중복 당첨 제외) → `dm_winners`.
- 추첨 시드 기록(감사·재현). 동시 실행 방지(claim 패턴).

순수 함수: `drawWinners(entries, prizesByRank, seed)` → TDD(등급별 인원, 중복 제외, 응모자<인원 시 가능분만).

### 3-C. 사전 지정 — 엑셀 업로드
- `POST /api/dm/:id/winners/import` (인증) — xlsx 파싱(이름/전화/이메일/등급) → `dm_winners` INSERT(win_method='preset').
- 기존 응모자와 phone 매칭 시 response_id 연결, 없으면 NULL(외부 지정).

순수 함수: `parseWinnerRows(rows)` → TDD(필수 컬럼, 등급 검증, 행 오류 수집).

## 4. 결과 조회 + 다운로드 (회사 admin)

- `GET /api/dm/:id/responses` — 응모자 명단(페이지네이션, 회원/비회원 구분).
- `GET /api/dm/:id/winners` — 당첨자 명단.
- `GET /api/dm/:id/stats` — 단축URL 반응도(`dm_views`: 열람·체류·섹션반응) + 응모율·당첨률·전환.
- `GET /api/dm/:id/responses/export` — **xlsx 다운로드**(이름·전화·이메일·회원여부·참여시각·당첨여부·당첨등급). xlsx 패키지 기존 사용(`xlsx`).

## 5. 개인정보·법적

- 폼 동의(`consent_text`) 필수 + `consent_at` 기록. 마케팅 동의는 별도 체크.
- 수집 항목·목적 뷰어 폼 하단 명시.
- 보관기간(회사 설정, 기본 6개월) + 파기 워커(만료 응답 익명화/삭제).
- 다운로드·조회 = 회사 admin(req.user.companyId 격리) 권한만.
- 정보통신망법·개인정보보호법 — 이벤트 응모 개인정보 동의·파기 의무.

## 6. DM 내 통합 흐름

응모 폼 → 제출 → (룰렛) 즉시 결과 / (추첨) 접수완료 → 마감 후 `?p=` 재방문 시 당첨 여부 표시. 모두 DM 뷰어 안에서 완결.

## 컴포넌트 분리

- `dm-interaction-core.ts`(신규, 순수): `pickRouletteSegment` / `drawWinners` / `parseWinnerRows` — DB-free TDD.
- `dm-interaction.ts`(신규, CT): 제출·집계·추첨·다운로드 DB 로직.
- `dm-draw-worker.ts`(신규): 마감 추첨 cron.
- dm-viewer.ts 확장: 인터랙션 JS(룰렛/폼/투표 제출).

## 의존 (다음 서브)

- **A(섹션 editor)**: `dm_prizes` 설정 UI(룰렛 세그먼트·확률·경품, 추첨 등급·인원) = 룰렛/추첨 editor.
- **F(크레딧 재설계)**: 인터랙션 캠페인 과금(응모·당첨·통보 발송 크레딧).
- **G(AI 자동화)**: 경품 설정·당첨 통보 문안·캠페인 생성 AI.

## 검증

- backend tsc 0. 순수 추첨 코어(`pickRouletteSegment`·`drawWinners`·`parseWinnerRows`) ts-node TDD GREEN.
- 신규 테이블·인덱스 = 구현 시 `information_schema` 검증(db_column_verify).
- 발송·돈 경로 무관(B는 수집·추첨·조회. 당첨 통보 발송은 F/G). 자가 grep: 박-단어·모델명·native dialog 0.

## 배포

`tp-push` → backend는 **ts-node라 `pm2 restart all`만**(build:safe 무관) → frontend `build:safe`. 신규 3 테이블 ALTER(Harold 직접).
