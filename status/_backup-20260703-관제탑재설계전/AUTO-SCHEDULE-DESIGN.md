# 자동 스케줄링 발송 기능 — 기초 설계안 (D69)

> **작성일:** 2026-03-12
> **상태:** Harold님 검토 대기
> **요청 배경:** 메트로시티 — 생일자 자동발송, 반복 스케줄 설정 기능 요청
> **적용 요금제:** 프로(100만원) 이상

---

## 1. 기능 개요

"자동발송"은 한 번 설정해두면 매월/매주/매일 **반복적으로 자동 발송**되는 캠페인 기능입니다.

**핵심 시나리오:**
- "매월 1일, 이번 달 생일 고객에게 축하 SMS 자동발송"
- "매주 월요일, VIP 고객에게 주간 프로모션 LMS 발송"
- "매일 오전 10시, 어제 구매 고객에게 감사 SMS 발송"

**기존 예약발송과 차이:**
| 구분 | 예약발송 (기존) | 자동발송 (신규) |
|------|----------------|-------------------|
| 실행 | 1회성 | 반복 (매월/매주/매일) |
| 타겟 | 발송 시점에 확정 | 매 실행마다 동적 필터링 |
| 메시지 | 고정 | 고정 + 변수 치환 (%고객명% 등) |
| 관리 | campaigns 테이블 | auto_campaigns 별도 테이블 |
| 요금제 | 제한 없음 | 프로 이상 |

---

## 2. DB 스키마 설계

### 2-1. plans 테이블 확장

```sql
ALTER TABLE plans ADD COLUMN auto_campaign_enabled boolean DEFAULT false;

-- 프로 이상만 true로 설정
UPDATE plans SET auto_campaign_enabled = true WHERE plan_code IN ('PRO', 'BUSINESS', 'ENTERPRISE');
```

### 2-2. auto_campaigns 테이블 (신규)

```sql
CREATE TABLE auto_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  user_id         uuid NOT NULL REFERENCES users(id),        -- 생성자 (발송 주체)

  -- 기본 정보
  campaign_name   varchar(200) NOT NULL,                      -- "3월 생일 축하 발송" 등
  description     text,                                       -- 설명/메모

  -- 스케줄 설정
  schedule_type   varchar(20) NOT NULL,                       -- 'monthly' | 'weekly' | 'daily'
  schedule_day    integer CHECK (schedule_day BETWEEN 1 AND 28), -- monthly: 1~28 (28일 max), weekly: 0~6 (일~토)
  schedule_time   time NOT NULL,                              -- 발송 시각 (예: '10:00')
  timezone        varchar(50) DEFAULT 'Asia/Seoul',

  -- 타겟 필터 (매 실행마다 동적 적용)
  target_filter   jsonb NOT NULL,                             -- customer-filter.ts 호환 필터 JSON
  store_code      varchar(50),                                -- 브랜드 격리 (NULL = 전체)

  -- 메시지 설정
  message_type    varchar(10) NOT NULL DEFAULT 'SMS',         -- SMS / LMS / MMS
  message_content text NOT NULL,                              -- 메시지 본문 (%고객명% 등 변수 포함)
  message_subject varchar(200),                               -- LMS/MMS 제목
  callback_number varchar(20) NOT NULL,                       -- 발신번호
  sender_number_id uuid REFERENCES sender_numbers(id),
  is_ad           boolean DEFAULT false,                      -- 광고 여부 (080 수신거부 포함)

  -- D-1 사전 알림 설정
  pre_notify       boolean DEFAULT true,                      -- D-1 사전 알림 ON/OFF
  notify_phones    text[],                                    -- 알림 수신 전화번호 (NULL이면 user_alarm_phones 사용)

  -- 상태/통계
  status          varchar(20) DEFAULT 'active',               -- active / paused / deleted
  last_run_at     timestamptz,                                -- 마지막 실행 일시
  next_run_at     timestamptz,                                -- 다음 예정 실행 일시
  total_runs      integer DEFAULT 0,                          -- 누적 실행 횟수
  total_sent      integer DEFAULT 0,                          -- 누적 발송 건수

  -- 감사
  created_at      timestamptz DEFAULT NOW(),
  updated_at      timestamptz DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_auto_campaigns_company ON auto_campaigns(company_id);
CREATE INDEX idx_auto_campaigns_next_run ON auto_campaigns(next_run_at) WHERE status = 'active';
CREATE INDEX idx_auto_campaigns_status ON auto_campaigns(status);
```

### 2-3. auto_campaign_runs 테이블 (실행 이력)

```sql
CREATE TABLE auto_campaign_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auto_campaign_id  uuid NOT NULL REFERENCES auto_campaigns(id),
  campaign_id       uuid REFERENCES campaigns(id),            -- 실제 생성된 campaigns 레코드 (연결)

  run_number        integer NOT NULL,                         -- 회차 (1, 2, 3, ...)

  -- 실행 결과
  target_count      integer,                                  -- 필터링된 타겟 수
  sent_count        integer DEFAULT 0,
  success_count     integer DEFAULT 0,
  fail_count        integer DEFAULT 0,

  -- 상태
  status            varchar(20) DEFAULT 'pending',            -- pending / notified / sending / completed / cancelled / failed

  -- D-1 사전 알림
  notified_at       timestamptz,                              -- 사전 알림 발송 시각
  notify_message    text,                                     -- 사전 알림 내용

  -- 타임스탬프
  scheduled_at      timestamptz NOT NULL,                     -- 예정 발송 시각
  started_at        timestamptz,
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,

  created_at        timestamptz DEFAULT NOW()
);

CREATE INDEX idx_auto_runs_auto_campaign ON auto_campaign_runs(auto_campaign_id);
CREATE INDEX idx_auto_runs_status ON auto_campaign_runs(status);
CREATE INDEX idx_auto_runs_scheduled ON auto_campaign_runs(scheduled_at);
```

---

## 3. 백엔드 아키텍처

### 3-1. 라우트 구조

```
routes/auto-campaigns.ts        — CRUD + 활성화/일시정지/삭제 API
utils/auto-campaign-worker.ts   — PM2 워커 (스케줄 실행 엔진)
utils/auto-campaign-notify.ts   — D-1 사전 알림 로직
```

**마운트:** `/api/auto-campaigns`

### 3-2. API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/` | 자동캠페인 목록 조회 |
| GET | `/:id` | 자동캠페인 상세 (+ 실행 이력) |
| POST | `/` | 자동캠페인 생성 |
| PUT | `/:id` | 자동캠페인 수정 (메시지/필터/스케줄) |
| POST | `/:id/pause` | 일시정지 |
| POST | `/:id/resume` | 재개 |
| DELETE | `/:id` | 삭제 (soft delete → status='deleted') |
| POST | `/:id/preview` | 미리보기 (현재 필터 기준 타겟 수 + 샘플 메시지) |
| POST | `/:id/cancel-next` | 다음 실행 취소 (D-1 알림 후 30분 전까지) |

### 3-3. PM2 워커 — auto-campaign-worker.ts

```
[ PM2 cron: 매 시간 정각 (0 * * * *) ]
    ↓
1. auto_campaigns에서 status='active' AND next_run_at <= NOW() 조회
    ↓
2. 각 건에 대해:
   a. target_filter로 고객 동적 필터링 (customer-filter.ts 재활용)
   b. 수신거부 필터링 (unsubscribe-helper.ts 재활용)
   c. campaigns 테이블에 레코드 생성 (send_type='auto')
   d. MySQL 큐에 INSERT (sms-queue.ts 재활용 — 기존 5경로와 동일 파이프라인)
   e. auto_campaign_runs에 실행 이력 기록
   f. next_run_at 갱신 (다음 스케줄 계산)
   g. total_runs, total_sent, last_run_at 갱신
    ↓
3. 선불 고객사 → prepaid.ts 차감 (현재는 해당 없지만 확장성)
```

**기존 파이프라인 100% 재활용:**
- `customer-filter.ts` → 타겟 필터링
- `unsubscribe-helper.ts` → 수신거부 제외
- `sms-queue.ts` → MySQL 큐 INSERT
- `messageUtils.ts` → 변수 치환 (%고객명%, %매장명% 등)
- `prepaid.ts` → 선불 차감 (미래 대비)
- `campaign-lifecycle.ts` → 취소/결과동기화

### 3-4. D-1 사전 알림 플로우

```
[ PM2 cron: 매일 오전 10시 (0 10 * * *) ]
    ↓
1. auto_campaigns에서 내일 실행 예정 건 조회
   (next_run_at BETWEEN 내일 00:00 AND 내일 23:59)
    ↓
2. 각 건에 대해:
   a. target_filter로 타겟 수 미리 카운트
   b. 담당자 전화번호 조회 (notify_phones || user_alarm_phones)
   c. 테스트발송처럼 메시지 샘플 발송 (1건)
   d. 알림 SMS 발송:
      "내일 {schedule_time}시 {target_count}명에게 자동발송 예정입니다.
       취소를 원하시면 발송 30분 전까지 취소해주세요."
   e. auto_campaign_runs 레코드 생성 (status='notified')
    ↓
3. 담당자는 알림 수신 후:
   - 웹에서 "다음 실행 취소" 가능 (30분 전까지)
   - 또는 자동발송 "일시정지"로 향후 전체 중단 가능
```

### 3-5. 캘린더 연동

기존 CalendarPage에 자동발송 실행 예정/이력을 표시:
- `next_run_at` 기준으로 캘린더에 "🔄 자동발송" 이벤트 표시
- 클릭 시 상세 모달 (자동캠페인 정보 + 실행 이력)

---

## 4. 프론트엔드 구조

### 4-1. 상단 메뉴 추가 (DashboardHeader.tsx)

기존 menuItems 배열에 "자동발송" 항목 추가:

```typescript
// '캘린더'와 '발송결과' 사이에 삽입
{
  label: '자동발송',
  onClick: () => navigate('/auto-send'),   // ★ 요금제 관계없이 항상 이동
  color: 'gold',
  emphasized: true,
}
```

**핵심:** 메뉴에서 잠금 표시 안 함. **누구나 클릭 → 페이지 진입 가능.**
게이팅은 페이지 내부에서 처리 (AnalysisModal 블러 패턴).

### 4-2. 새 페이지: AutoSendPage.tsx — 게이팅 UX (AnalysisModal 블러 패턴 적용)

**URL:** `/auto-send`
**접근:** company_admin + company_user (모든 요금제)

#### A. 프로 미만 요금제 — 프리뷰 + 블러 + CTA

```
┌─────────────────────────────────────────────────────────────┐
│ ⏰ 자동발송                                          [← 닫기] │
│ 반복 발송 스케줄을 설정하면 자동으로 메시지가 발송됩니다.          │
│ 생일 축하, VIP 프로모션 등을 한 번 설정으로 매월 자동 처리!       │
│                                                             │
│ ── 이런 자동발송을 설정할 수 있어요 ──                          │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │  🎂 생일 축하 발송 · 매월 1일 · SMS                       │ │
│ │  📢 VIP 주간 프로모션 · 매주 월요일 · LMS                  │ │
│ │  🎁 신규 고객 웰컴 · 매일 · SMS                           │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ── 자동발송 관리 화면 미리보기 ──                               │
│ ┌───────────────────────────────────────── (블러 6px) ─────┐ │
│ │ ░░░░ 블러 처리된 자동발송 목록 카드 ░░░░░░                 │ │
│ │ ░░░░ 생일 축하 · 매월 1일 · 1,628명 ░░░░                 │ │
│ │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                  │ │
│ │           ┌────────────────────────┐                     │ │
│ │           │ 🔒 프로 요금제 이상      │                     │ │
│ │           │    사용 가능합니다       │                     │ │
│ │           └────────────────────────┘                     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─ CTA ─────────────────────────────────────────────────┐   │
│ │  👑 프로 요금제로 업그레이드                              │   │
│ │  월 100만원으로 자동발송, AI 분석까지 모두 사용하세요       │   │
│ │  [요금제 안내 보기]  [업그레이드 신청]                     │   │
│ └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**블러 구현 패턴 (AnalysisModal과 동일):**
```tsx
{/* 블러 오버레이 */}
<div className="relative rounded-xl border border-gray-200 bg-gray-50/50 p-5 overflow-hidden">
  <div className="absolute inset-0 bg-white/40 backdrop-blur-sm z-10 flex items-center justify-center">
    <div className="bg-white/90 rounded-xl px-5 py-3 shadow-lg flex items-center gap-2 border border-amber-200">
      <Lock size={14} className="text-amber-600" />
      <span className="text-sm font-medium text-gray-700">프로 요금제 이상 사용 가능</span>
    </div>
  </div>
  <div className="select-none" style={{ filter: 'blur(6px)' }}>
    {/* 더미 자동발송 카드들 */}
  </div>
</div>
```

#### B. 프로 이상 요금제 — 실제 기능 화면

```
┌─────────────────────────────────────────────────────────────┐
│ ⏰ 자동발송                                          [← 닫기] │
│ 반복 발송 스케줄을 설정하면 자동으로 메시지가 발송됩니다.          │
│                                                             │
│ [+ 새 자동발송 만들기]                                        │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🎂 3월 생일 축하 발송                        ● 활성       │ │
│ │ 매월 1일 10:00 · SMS · 타겟: 생일 고객                   │ │
│ │ 최근: 2026-03-01 · 1,628건 발송 · 성공 1,612건          │ │
│ │ 다음: 2026-04-01 10:00                                  │ │
│ │                          [수정] [일시정지] [삭제]          │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 📢 VIP 주간 프로모션                         ○ 일시정지   │ │
│ │ 매주 월요일 09:00 · LMS · 타겟: VIP 등급                 │ │
│ │ 최근: 2026-03-10 · 342건 발송 · 성공 338건              │ │
│ │ 다음: -                                                 │ │
│ │                              [수정] [재개] [삭제]         │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 4-3. 자동발송 생성/수정 모달: AutoSendFormModal.tsx

**설정 단계:**

1. **기본 정보** — 캠페인명, 설명
2. **스케줄 설정** — 유형(매월/매주/매일) + 발송일/요일 + 시각
   - 매월 선택 시: 1~28일 드롭다운 + 안내 문구: "📌 2월은 28일까지이므로 발송일은 최대 28일까지 선택 가능합니다"
3. **타겟 설정** — 기존 DirectTargetFilterModal 재활용 (성별/연령/등급/지역/생일월/커스텀 등)
4. **메시지 작성** — SMS/LMS 선택 + 본문 작성 (변수 삽입 버튼 포함)
5. **발신번호** — 기존 callback_numbers 선택
6. **사전 알림** — D-1 알림 ON/OFF + 수신 전화번호
7. **미리보기** — 현재 필터 기준 타겟 수 + 샘플 메시지 확인

### 4-4. App.tsx 라우트 추가

```typescript
<Route
  path="/auto-send"
  element={
    <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
      <AutoSendPage />
    </PrivateRoute>
  }
/>
```

---

## 5. 보안/격리 설계

### 5-1. 멀티테넌트 격리
- auto_campaigns 테이블에 `company_id` 필수
- 모든 API에서 JWT의 company_id 기준 필터링
- store_code 기반 브랜드 격리 (store-scope.ts 재활용)

### 5-2. 권한
- **생성/수정/삭제:** company_admin + company_user 모두 가능
  - company_admin: 전사 범위
  - company_user(브랜드담당자): 본인 store_code 범위 내에서만 (store-scope.ts 재활용)
- **조회:** 본인이 생성했거나 본인 store_code 범위의 자동발송만 표시
- **슈퍼관리자:** 전체 회사 자동캠페인 모니터링 (admin 대시보드에 추가)

### 5-3. 안전장치
- **발송 시간대 제한:** companies.send_start_hour ~ send_end_hour 준수
- **일일 발송 한도:** companies.daily_limit 적용
- **수신거부 필터링:** 기존 unsubscribe-helper.ts 100% 재활용
- **워커 중복 방지:** auto_campaign_runs.status로 이중 실행 방지 (pending→sending 원자적 전환)

---

## 6. 구현 우선순위 (단계별)

### Phase 1 — 핵심 (MVP)
1. DB 마이그레이션 (plans 확장 + auto_campaigns + auto_campaign_runs)
2. 백엔드 CRUD API (routes/auto-campaigns.ts)
3. PM2 워커 (auto-campaign-worker.ts)
4. 프론트엔드 페이지 + 메뉴 추가
5. 생성/수정 모달

### Phase 2 — 알림 + 캘린더
6. D-1 사전 알림 (auto-campaign-notify.ts)
7. 캘린더 연동 (CalendarPage에 자동발송 이벤트 표시)
8. 슈퍼관리자 모니터링 (admin 대시보드)

### Phase 3 — 고도화
9. AI 메시지 자동 생성 연동 (매 실행마다 AI가 시즌별 메시지 생성)
10. 실행 결과 리포트 (월간 자동발송 성과 대시보드)
11. 카카오톡 채널 자동발송 지원

---

## 7. 영향 범위 점검

| 파일 | 변경 내용 |
|------|----------|
| `plans` 테이블 | auto_campaign_enabled 컬럼 추가 |
| `routes/auto-campaigns.ts` | 신규 파일 — CRUD API |
| `utils/auto-campaign-worker.ts` | 신규 파일 — PM2 워커 |
| `utils/auto-campaign-notify.ts` | 신규 파일 — D-1 알림 |
| `DashboardHeader.tsx` | "자동발송" 메뉴 항목 추가 (잠금 없이 항상 클릭 가능) |
| `App.tsx` | /auto-send 라우트 추가 |
| `AutoSendPage.tsx` | 신규 페이지 (프로 미만 = 블러 프리뷰 + CTA, 프로 이상 = 실제 기능) |
| `AutoSendFormModal.tsx` | 신규 모달 (자동발송 생성/수정) |
| `CalendarPage.tsx` | 자동발송 이벤트 표시 (Phase 2) |
| `SCHEMA.md` | 새 테이블 문서화 |
| `STATUS.md` | D69 기록 |

**기간계 영향:** 없음 — 기존 MySQL 큐 INSERT 파이프라인을 그대로 재활용. 새로운 발송 경로가 아닌, 기존 campaigns.ts의 발송 로직을 호출하는 형태.

---

## 8. 결정 필요 사항

Harold님 검토 후 결정이 필요한 항목들:

1. ~~schedule_day 범위~~ → **해결: 28일 max, 모달에 안내 문구 표시**
2. ~~company_user 권한~~ → **해결: 브랜드담당자도 생성/수정/삭제 가능 (본인 store_code 범위)**
3. **동시 활성 자동캠페인 수 제한?** 프로 요금제: 최대 5개, 비즈니스: 10개, 엔터프라이즈: 무제한 등.
4. **실행 실패 시 재시도?** 워커 실행 중 오류 발생 시 — 즉시 재시도? 다음 스케줄까지 스킵?
5. **AI 메시지 자동 생성 (Phase 3):** 매 실행마다 AI가 시즌에 맞는 메시지를 자동 생성하는 옵션 — 우선순위는?
