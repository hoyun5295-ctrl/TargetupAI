# 알림톡 + 브랜드메시지 (카카오 비즈메시지) 휴머스온 IMC 연동 설계서 v1.0

> **작성일:** 2026-04-17 (D130 예비 세션)
> **구현 착수 예정:** 다음 세션
> **작성 전제:** IMC Developer Portal 문서 50개 전수 수집 + 한줄로 기존 코드 전수 조사 완료
> **중요:** Harold님 = **QTmsg Agent 소유자** → Agent 쪽 수정도 필요시 가능 (유연성 ↑)

---

## 📜 문서 맵

| 섹션 | 내용 | 대상 |
|------|------|------|
| [1](#1-개요) | 개요 + 핵심 원칙 | 전체 |
| [2](#2-아키텍처) | 2갈래 아키텍처 | 설계자 |
| [3](#3-전체-api-목록-50개) | IMC API 50개 전수 카탈로그 | 백엔드 |
| [4](#4-db-스키마-ddl-완전본) | DDL 실행본 (ALTER/CREATE/INDEX) | DB |
| [5](#5-백엔드-설계) | CT-16/17/18 + 라우트 | 백엔드 |
| [6](#6-프론트-설계) | 화면 3종 + 탭 통합 | 프론트 |
| [7](#7-상태-머신) | 발신프로필 · 알림톡 · 브랜드 | 설계자 |
| [8](#8-웹훅-처리) | 수신 로직 + idempotency | 백엔드 |
| [9](#9-에러-처리) | IMC 코드 → 우리 상태 매핑 | 백엔드 |
| [10](#10-phase별-체크리스트) | Phase 1~4 태스크 40개 | PM |
| [11](#11-테스트-시나리오) | 샌드박스 curl + E2E | QA |
| [12](#12-리스크--이슈) | 오픈 이슈 | 전체 |
| [13](#13-다음-세션-착수-가이드) | Quick Start | 다음 세션 AI |

---

## 1. 개요

### 1-1. 두 메시지 유형의 근본적 차이

| 구분 | **알림톡 (AT)** | **브랜드메시지 (BM)** |
|------|----------------|--------------------|
| 성격 | 정보성 (예: 주문/회원가입) | 광고성 (브랜드 프로모션) |
| 발송 대상 | 전화번호 보유자 누구나 | 채널 친구 (광고수신 동의자) |
| 검수 프로세스 | **있음** (대기→검수중→승인/반려) | **없음** (등록 즉시 사용) |
| 광고 표기 의무 | 없음 (정보성) | 080 수신거부 등 광고 표기 필수 |
| 발송 템플릿 타입 | BA/EX/AD/MI × NONE/TEXT/IMAGE/ITEM_LIST | TEXT/IMAGE/WIDE/WIDE_ITEM_LIST/PREMIUM_VIDEO/COMMERCE/CAROUSEL_FEED/CAROUSEL_COMMERCE (8종) |
| 본문 글자수 | 1,000자 (일부 400자) | 1,300자 (IMAGE 400, WIDE 76 등) |
| 변수 | `#{변수명}` | `#{변수명}` (최대 20개) |
| 부달(대체발송) | 지원 (`resend`) | 미지원 |

**→ 이 차이가 UI/DB/상태머신에 결정적 영향을 줍니다.**

### 1-2. 핵심 원칙

1. **컨트롤타워 우선 (CLAUDE.md 0번)** — 기존 `CT-12 brand-message.ts` + `sms-queue.ts`의 `insertAlimtalkQueue`/`insertKakaoQueue` **재사용**. IMC 관리 API 호출만 새로 추가(CT-16).
2. **관리 API는 한줄로 백엔드가 직접 호출 / 발송 API는 QTmsg Agent 경유 유지** — 기존 구조 파괴 금지.
3. **기간계 무접촉** — 발송 INSERT 로직 수정 금지. 스키마 ALTER는 nullable 컬럼 추가만.
4. **CLAUDE.md 4-8 꼼꼼체크 5경로 매트릭스 준수** — 한줄로AI/맞춤한줄/직접발송/직접타겟발송/자동발송 × 알림톡/브랜드메시지 교차 점검.

### 1-3. QTmsg Agent 활용 정책 (Harold님 소유)

Harold님이 QTmsg Agent 소스 제어 가능하므로 **경계가 유동적**:
- **기본:** Agent = 발송 실행만 담당 (관리 API는 한줄로가 직접)
- **필요시:** Agent에 관리 API 일부 위임 가능 (예: 대량 이미지 업로드, 재시도 로직 등)
- 이 설계서는 "기본" 경로를 전제로 작성. 구현 중 Agent에 이관할 부분 나오면 별도 협의.

---

## 2. 아키텍처

### 2-1. 2갈래 구조 다이어그램

```
                    ┌──────────────────────────────┐
                    │   한줄로 프론트엔드            │
                    │  (app.hanjul.ai / sys.hanjullo.com) │
                    └────────────┬─────────────────┘
                                 │ HTTPS
                    ┌────────────▼─────────────────┐
                    │   한줄로 백엔드 (Node/Express)  │
                    │                              │
                    │ ┌─ routes/alimtalk.ts ─────┐ │
                    │ │  /alimtalk/senders       │ │
                    │ │  /alimtalk/templates     │ │ ── 발신프로필/템플릿 CRUD
                    │ │  /alimtalk/brand/templates│ │
                    │ │  /alimtalk/images/*      │ │
                    │ │  /alimtalk/alarm-users   │ │
                    │ │  /alimtalk/webhook  ◄────┼─┼────── 휴머스온에서 수신
                    │ └──────────────────────────┘ │
                    │                              │
                    │ ┌─ utils/alimtalk-api.ts(CT-16)┐
                    │ │ requestSenderToken()       │ │
                    │ │ createSender()             │ │
                    │ │ createAlimtalkTemplate()   │ │
                    │ │ requestInspection()        │ │
                    │ │ uploadImage*()             │ │
                    │ │ ...                        │ │
                    │ └─────────────┬──────────────┘ │
                    │               │                │
                    │ ┌─ utils/alimtalk-webhook.ts ─┐│
                    │ │ (CT-18)                     ││
                    │ │ processKakaoWebhook()       ││
                    │ └─────────────────────────────┘│
                    │                              │
                    │ ┌─ utils/sms-queue.ts ──────┐ │
                    │ │ insertAlimtalkQueue()     │ │── 발송은 MySQL 큐 INSERT
                    │ │ insertKakaoQueue()        │ │
                    │ │ insertKakaoBasicQueue()   │ │
                    │ └─────────────┬─────────────┘ │
                    └───────────────┼──────────────┘
                                    │
                       [관리 API]   │   [발송 API]
                          직접      │   큐 경유
                                    │
                   ┌────────────────┼─────────────────┐
                   │                │                 │
         ┌─────────▼──────┐   ┌─────▼──────┐  ┌───────▼─────┐
         │ 휴머스온 IMC    │   │  MySQL 큐   │  │ QTmsg Agent │
         │ Management API │   │IMC_BM_FREE  │  │ (Harold 소유) │
         │                │   │IMC_BM_BASIC │  └──────┬──────┘
         └────────────────┘   │SMSQ_SEND(K) │         │
                              └─────────────┘         │
                                                      ▼
                              ┌─────────────────────────┐
                              │ 휴머스온 IMC 발송 API     │
                              │ /alimtalk/send         │
                              │ /brand/send/basic      │
                              │ /brand/send/free       │
                              └──────────┬──────────────┘
                                         │ 결과
                                         ▼
                              ┌─────────────────┐
                              │  카카오톡       │
                              └──────┬──────────┘
                                     │ 리포트 웹훅
                                     ▼
                              ┌─────────────────┐
                              │ 한줄로 /webhook  │
                              └─────────────────┘
```

### 2-2. 환경 분리

| 환경 | 샌드박스 | 운영 |
|------|---------|------|
| Base URL | `http://10.147.1.109:28000/` | `https://{host}/` (발급받을 실서버) |
| API KEY 헤더 | `x-imc-api-key: APIKEY-HUMUSON-0001` | `x-imc-api-key: imc_XXX...` |
| 키 포맷 | 고정 | `imc_` + 난수 토큰 |
| 네트워크 | 내부망 (VPN 필요할 수도) | 공인망 |

---

## 3. 전체 API 목록 (50개)

### 3-1. 일반 문서 (3개)
| URL | 용도 |
|-----|------|
| `/docs/getting-started` | 시작하기 (인증/Base URL) |
| `/docs/webhooks` | 웹훅 Payload 스펙 |
| `/docs/response-codes` | 응답 코드 전체 (카카오 4000~9999, 문자 8000~, RCS 41xxx~77xxx) |

### 3-2. 발송 API (3개)
| 메서드 | URL | 엔드포인트 | 한줄로 연결 |
|-------|-----|----------|-----------|
| POST | `/kakao-message/api/v1/alimtalk/send` | 알림톡 완성형 발송 | ⚠️ 현재 QTmsg Agent 담당 → 유지 |
| POST | `/kakao-message/api/v1/brand/send/basic` | 브랜드메시지 기본형 발송 | ⚠️ 현재 QTmsg Agent 담당 → 유지 |
| POST | `/kakao-message/api/v1/brand/send/free` | 브랜드메시지 자유형 발송 | ⚠️ 현재 QTmsg Agent 담당 → 유지 |

### 3-3. 발신프로필 관리 API (11개)
| 메서드 | URL | 용도 | CT-16 함수 |
|-------|-----|------|-----------|
| GET | `/kakao-management/api/v1/sender` | 목록 조회 | `listSenders(params)` |
| GET | `/kakao-management/api/v1/sender/{senderKey}` | 단건 조회 | `getSender(senderKey)` |
| POST | `/kakao-management/api/v1/sender` | 등록 (토큰+인증번호) | `createSender(body)` |
| POST | `/kakao-management/api/v1/sender/token` | 인증번호 요청 (카톡) | `requestSenderToken(body)` |
| PUT | `/kakao-management/api/v1/sender/{senderKey}/custom-sender-key` | 고객사 키 수정 | `updateCustomSenderKey(k, code)` |
| PUT | `/kakao-management/api/v1/sender/{senderKey}/unsubscribe` | 080 무료수신거부 설정 | `updateSenderUnsubscribe(k, body)` |
| PUT | `/kakao-management/api/v1/sender/{senderKey}/release` | 휴면 해제 | `releaseSenderDormant(k)` |
| GET | `/kakao-management/api/v1/sender/category` | 카테고리 전체 (3단) | `listSenderCategories()` |
| GET | `/kakao-management/api/v1/sender/category/{categoryCode}` | 카테고리 단건 | `getSenderCategory(code)` |
| GET | `/kakao-management/api/v1/sender/{senderKey}/brand-message/check` | 브랜드 타겟팅 M/N 사용 가능 확인 | `checkBrandTargeting(k)` |
| POST | `/kakao-management/api/v1/sender/{senderKey}/brand-message` | 브랜드 타겟팅 M/N 신청 | `applyBrandTargeting(k, body)` |

### 3-4. 알림톡 템플릿 관리 API (13개)
| 메서드 | URL | 용도 | CT-16 함수 |
|-------|-----|------|-----------|
| GET | `/kakao-management/api/v1/alimtalk/template/list` | 목록 | `listAlimtalkTemplates(params)` |
| GET | `/kakao-management/api/v1/alimtalk/template/last-modified` | 최근 변경 | `getRecentlyModified(params)` |
| GET | `/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateCode}` | 단건 | `getAlimtalkTemplate(k, tc)` |
| POST | `/kakao-management/api/v1/sender/{senderKey}/alimtalk/template` | 등록 | `createAlimtalkTemplate(k, body)` |
| PUT | `/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateCode}` | 수정 | `updateAlimtalkTemplate(k,tc,body)` |
| DELETE | `/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateCode}` | 삭제 | `deleteAlimtalkTemplate(k,tc)` |
| POST | `/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateCode}/comment` | 검수요청 | `requestInspection(k,tc,comment?)` |
| POST | `/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateCode}/comment-with-file` | 검수요청(첨부포함) | `requestInspectionWithFile(k,tc,body)` |
| PUT | `/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateCode}/comment-cancel` | 검수요청 취소 | `cancelInspection(k,tc)` |
| PUT | `/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateCode}/release` | 휴면 해제 | `releaseTemplateDormant(k,tc)` |
| PATCH | `/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateCode}/custom-code` | 고객사 관리코드 수정 | `updateCustomCode(k,tc,code)` |
| PATCH | `/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateCode}/exposure` | 노출 여부 수정 | `updateExposure(k,tc,yn)` |
| PATCH | `/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateCode}/service-mode` | 서비스 유형 수정 | `updateServiceMode(k,tc,mode)` |

### 3-5. 알림톡 검수 알림 수신자 API (4개)
| 메서드 | URL | 용도 |
|-------|-----|------|
| GET | `/kakao-management/api/v1/alimtalk/template/alarm-users` | 목록 |
| POST | `/kakao-management/api/v1/alimtalk/template/alarm-users` | 등록 |
| PUT | `/kakao-management/api/v1/alimtalk/template/alarm-users/{alarmUserId}` | 수정 |
| DELETE | `/kakao-management/api/v1/alimtalk/template/alarm-users/{alarmUserId}` | 삭제 |

### 3-6. 브랜드메시지 템플릿 관리 API (5개)
| 메서드 | URL | 용도 |
|-------|-----|------|
| GET | `/kakao-management/api/v1/brand-message/template/list` | 목록 |
| GET | `/kakao-management/api/v1/sender/{senderKey}/brand-message/template/{templateKey}` | 단건 |
| POST | `/kakao-management/api/v1/sender/{senderKey}/brand-message/template` | 등록 |
| PUT | `/kakao-management/api/v1/sender/{senderKey}/brand-message/template` | 기본형 수정 |
| DELETE | `/kakao-management/api/v1/sender/{senderKey}/brand-message/template/{templateKey}` | 삭제 |

### 3-7. 이미지 업로드 API (9개) — 규격 완전본

| # | 메서드 | URL | 용도 | 권장/제한 사이즈 | 비율 | 형식·크기 | 업로드 형식 |
|---|-------|-----|------|----------------|------|----------|-----------|
| 1 | POST | `/attach/alimtalk/template` | 알림톡 본문 이미지 (IMAGE/ITEM_LIST) | 800×400 권장, 500px+ | 세로/가로 = 0.5 (고정) | jpg,png / **500KB** | 단일 `image` |
| 2 | POST | `/attach/alimtalk/item-highlight` | 알림톡 하이라이트 썸네일 | 108×108 이상 | 1:1 (고정) | jpg,png / **500KB** | 단일 `image` |
| 3 | POST | `/attach/brand-message/default` | 브랜드 IMAGE/COMMERCE/PREMIUM_VIDEO | 800×400 권장, 500px+ | 0.5 ≤ 비율 ≤ 1.333 | jpg,png / **5MB** | 단일 `image` |
| 4 | POST | `/attach/brand-message/wide` | 브랜드 WIDE | 800×600 권장, 500px+ | 0.5 ≤ 비율 ≤ 1 | jpg,png / 5MB | 단일 `image` |
| 5 | POST | `/attach/brand-message/wide-list/first` | 브랜드 WIDE_ITEM_LIST 1번째 | 가로 500px+ | 비율 = 0.5 (고정) | jpg,png / 5MB | 단일 `image` |
| 6 | POST | `/attach/brand-message/wide-list` | 브랜드 WIDE_ITEM_LIST 2~4번째 | 가로 500px+ | 1:1 (고정) | jpg,png / 5MB | 배열 `images` (1~3개) |
| 7 | POST | `/attach/brand-message/carousel-feed` | 브랜드 CAROUSEL_FEED | 800×600/400 권장 | 0.5 ≤ 비율 ≤ 1.333 | jpg,png / 5MB | 배열 `images` (1~10개) |
| 8 | POST | `/attach/brand-message/carousel-commerce` | 브랜드 CAROUSEL_COMMERCE | 800×600/400 권장 | 0.5 ≤ 비율 ≤ 1.333 (**전체 동일 비율**) | jpg,png / 5MB | 배열 `images` (1~11개) |
| 9 | POST | `/attach/marketing-agree/{senderKey}` | 광고성 수신동의 증적자료 | - | - | 별도 문서 | 단일 `image`, **톡채널 단위 공유** |

### 3-8. 템플릿 카테고리 조회 API (2개)
| 메서드 | URL | 용도 |
|-------|-----|------|
| GET | `/kakao-management/api/v1/template/category` | 전체 조회 |
| GET | `/kakao-management/api/v1/template/category/{categoryCode}` | 단건 조회 |

---

## 4. DB 스키마 (DDL 완전본)

> **⚠️ 실행 지침 (CLAUDE.md 4-3 기간계 무접촉):**
> - 모든 ALTER는 **nullable 컬럼 추가만** → 기존 데이터/로직 영향 0
> - 신규 테이블 CREATE 시 기존 제약 조건 건드리지 않음
> - 한줄로 SCHEMA.md의 `kakao_sender_profiles`, `kakao_templates`, `kakao_friendtalk_images` 기반 확장

### 4-1. 기존 테이블 ALTER

```sql
-- ════════════════════════════════════════════════════════════
-- 4-1-A. kakao_sender_profiles 확장 (발신프로필)
-- ════════════════════════════════════════════════════════════
ALTER TABLE kakao_sender_profiles
  ADD COLUMN IF NOT EXISTS yellow_id            varchar(50),
  ADD COLUMN IF NOT EXISTS admin_phone_number   varchar(20),
  ADD COLUMN IF NOT EXISTS category_code        varchar(11),        -- 11자리 (대+중+소)
  ADD COLUMN IF NOT EXISTS category_name_cache  varchar(255),       -- 1차/2차/3차 합친 표시명
  ADD COLUMN IF NOT EXISTS top_sender_yn        char(1) DEFAULT 'N',
  ADD COLUMN IF NOT EXISTS custom_sender_key    varchar(40),
  ADD COLUMN IF NOT EXISTS status               varchar(20) DEFAULT 'PENDING',  -- PENDING/NORMAL/BLOCKED/DELETED/DORMANT
  ADD COLUMN IF NOT EXISTS unsubscribe_phone    varchar(15),         -- 080 무료수신거부
  ADD COLUMN IF NOT EXISTS unsubscribe_auth     varchar(10),
  ADD COLUMN IF NOT EXISTS marketing_agree_file_key varchar(100),    -- 광고동의 증적자료 파일 키 (톡채널 공유)
  ADD COLUMN IF NOT EXISTS brand_targeting_yn   char(1) DEFAULT 'N', -- M/N 타겟팅 사용 여부
  ADD COLUMN IF NOT EXISTS registered_at        timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_ksp_company_status ON kakao_sender_profiles(company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ksp_yellow_id ON kakao_sender_profiles(company_id, yellow_id) WHERE yellow_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════
-- 4-1-B. kakao_templates 확장 (알림톡 템플릿)
-- ════════════════════════════════════════════════════════════
ALTER TABLE kakao_templates
  ADD COLUMN IF NOT EXISTS template_key           varchar(128),      -- 우리 내부 고유키 (IMC templateKey)
  ADD COLUMN IF NOT EXISTS custom_template_code   varchar(30),
  ADD COLUMN IF NOT EXISTS emphasize_subtitle     varchar(50),       -- TEXT 유형용 (기존 emphasize_title 보완)
  ADD COLUMN IF NOT EXISTS template_header        varchar(16),       -- ITEM_LIST 헤더
  ADD COLUMN IF NOT EXISTS item_highlight         jsonb,             -- {title, description, imageUrl}
  ADD COLUMN IF NOT EXISTS item_list              jsonb,             -- [{title, description}, ...]
  ADD COLUMN IF NOT EXISTS item_summary           jsonb,             -- {title, description}
  ADD COLUMN IF NOT EXISTS represent_link         jsonb,             -- {urlMobile, urlPc, schemeAndroid, schemeIos}
  ADD COLUMN IF NOT EXISTS preview_message        varchar(40),
  ADD COLUMN IF NOT EXISTS alarm_phone_numbers    text,              -- 콤마 구분, 최대 10개
  ADD COLUMN IF NOT EXISTS service_mode           varchar(3) DEFAULT 'PRD',  -- PRD/STG
  ADD COLUMN IF NOT EXISTS image_name             varchar(50),       -- 업로드된 이미지 파일명
  ADD COLUMN IF NOT EXISTS highlight_image_name   varchar(50),
  ADD COLUMN IF NOT EXISTS last_synced_at         timestamptz;       -- IMC 상태 동기화 마지막 시각

CREATE UNIQUE INDEX IF NOT EXISTS idx_kt_company_template_key ON kakao_templates(company_id, template_key) WHERE template_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kt_status ON kakao_templates(status);
CREATE INDEX IF NOT EXISTS idx_kt_profile_id ON kakao_templates(profile_id);
```

### 4-2. 신규 테이블 CREATE

```sql
-- ════════════════════════════════════════════════════════════
-- 4-2-A. 브랜드메시지 템플릿 (검수 프로세스 없음 → kakao_templates와 분리)
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS brand_message_templates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  profile_id           uuid NOT NULL REFERENCES kakao_sender_profiles(id) ON DELETE CASCADE,

  -- IMC 키
  template_key         varchar(128) NOT NULL,                  -- 우리 생성 (IMC templateKey)
  custom_template_code varchar(30),                            -- 고객사 관리 코드

  -- 관리 정보
  manage_name          varchar(30) NOT NULL,                   -- 관리용 이름
  chat_bubble_type     varchar(20) NOT NULL,                   -- TEXT/IMAGE/WIDE/WIDE_ITEM_LIST/CAROUSEL_FEED/PREMIUM_VIDEO/COMMERCE/CAROUSEL_COMMERCE
  adult_yn             char(1) DEFAULT 'N',                    -- 성인용 여부

  -- 본문
  header               varchar(20),                            -- WIDE_ITEM_LIST 필수, PREMIUM_VIDEO 선택
  content              text,                                   -- 타입별 글자수 상이 (1300/400/76)
  additional_content   varchar(34),                            -- COMMERCE만
  
  -- 첨부
  attachment           jsonb,                                  -- {image: {...}, video: {...}, commerce: {...}, item: {...}}
  carousel             jsonb,                                  -- {head, list: [...], tail}
  buttons              jsonb DEFAULT '[]',
  coupon               jsonb,

  -- 변수
  variables            text[] DEFAULT ARRAY[]::text[],         -- 최대 20개

  -- 상태 (검수 없음 → 단순)
  status               varchar(20) DEFAULT 'ACTIVE',           -- ACTIVE/DELETED
  
  -- 메타
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now(),
  deleted_at           timestamptz
);

CREATE UNIQUE INDEX idx_bmt_company_template_key ON brand_message_templates(company_id, template_key);
CREATE INDEX idx_bmt_company_status ON brand_message_templates(company_id, status);
CREATE INDEX idx_bmt_profile_id ON brand_message_templates(profile_id);

-- ════════════════════════════════════════════════════════════
-- 4-2-B. 검수 알림 수신자
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS kakao_alarm_users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name               varchar(30),
  phone_number       varchar(20) NOT NULL,
  active_yn          char(1) DEFAULT 'Y',
  imc_alarm_user_id  varchar(50),                 -- IMC alarmUserId
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE INDEX idx_kau_company_active ON kakao_alarm_users(company_id, active_yn);
CREATE UNIQUE INDEX idx_kau_company_phone ON kakao_alarm_users(company_id, phone_number);

-- ════════════════════════════════════════════════════════════
-- 4-2-C. 카테고리 캐시 (하루 1회 IMC 동기화)
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS kakao_sender_categories (
  category_code  varchar(11) PRIMARY KEY,         -- 11자리 (대+중+소 각 3자리 + 중간 2자리?)
  parent_code    varchar(11),
  level          smallint,                        -- 1(대)/2(중)/3(소)
  name           varchar(100),
  active_yn      char(1) DEFAULT 'Y',
  synced_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_ksc_parent ON kakao_sender_categories(parent_code, level);

CREATE TABLE IF NOT EXISTS kakao_template_categories (
  category_code  varchar(6) PRIMARY KEY,          -- 템플릿은 6자리
  name           varchar(100),
  active_yn      char(1) DEFAULT 'Y',
  synced_at      timestamptz DEFAULT now()
);

-- ════════════════════════════════════════════════════════════
-- 4-2-D. 웹훅 이벤트 (idempotency)
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS kakao_webhook_events (
  event_id       uuid PRIMARY KEY,                 -- IMC eventId (중복 차단)
  batch_id       uuid,
  server_key     varchar(100),
  message_key    varchar(128),
  report_type    varchar(10),                      -- SM/AT/FT/RCS
  report_code    varchar(10),
  resend         boolean DEFAULT false,
  received_at    timestamptz,                      -- IMC에서 표기한 시각 (문자열 → ts 변환)
  net_info       varchar(20),
  processed_at   timestamptz DEFAULT now(),
  process_status varchar(20) DEFAULT 'PENDING',    -- PENDING/OK/FAILED
  error_message  text,
  raw_payload    jsonb NOT NULL
);
CREATE INDEX idx_kwe_message_key ON kakao_webhook_events(message_key);
CREATE INDEX idx_kwe_batch_id ON kakao_webhook_events(batch_id);
CREATE INDEX idx_kwe_status ON kakao_webhook_events(process_status) WHERE process_status != 'OK';

-- ════════════════════════════════════════════════════════════
-- 4-2-E. IMC 이미지 파일 캐시 (업로드 결과 재사용)
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS kakao_image_uploads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid REFERENCES companies(id),
  user_id          uuid REFERENCES users(id),
  upload_type      varchar(30) NOT NULL,           -- alimtalk_template/alimtalk_highlight/brand_default/brand_wide/...
  image_name       varchar(100) NOT NULL,          -- IMC가 반환한 파일명
  image_url        varchar(500) NOT NULL,          -- IMC가 반환한 URL
  original_filename varchar(200),
  file_size        integer,
  width            integer,
  height           integer,
  ratio            numeric(6,4),                   -- 세로/가로
  created_at       timestamptz DEFAULT now(),
  expired_at       timestamptz                     -- IMC에서 만료 시점 제공 시
);
CREATE INDEX idx_kiu_company_type ON kakao_image_uploads(company_id, upload_type);
```

### 4-3. 초기 데이터 / 마이그레이션 배치

```sql
-- 카테고리 초기 동기화 (배포 후 1회 실행)
-- 실제로는 CT-16의 listSenderCategories() / listTemplateCategories() 호출 후 INSERT
-- → 자동 배치(scheduled-task.ts alimtalkCategorySyncJob) 매일 03:00 실행
```

---

## 5. 백엔드 설계

### 5-1. 환경변수 (.env 추가)

```bash
# IMC 공통
IMC_API_KEY=imc_UhQZcs33OsTncarP      # 운영 키 (cs_imc@humuson.com 발급)
IMC_API_KEY_SANDBOX=APIKEY-HUMUSON-0001

# 환경별 Base URL
IMC_BASE_URL_PRD=https://imc-api.humuson.com   # 실제 운영 URL (확인 필요)
IMC_BASE_URL_STG=http://10.147.1.109:28000     # 샌드박스 (내부망)
IMC_ENV=STG                                    # STG/PRD

# 웹훅
IMC_WEBHOOK_ALLOWED_IPS=xxx.xxx.xxx.xxx,yyy.yyy.yyy.yyy  # 휴머스온 송신 IP (확인 필요)
IMC_WEBHOOK_HMAC_SECRET=xxx                    # HMAC 검증용 (시작하기 문서에 언급)

# 업로드 임시 디렉터리 (IMC 업로드 전 버퍼)
IMC_UPLOAD_TMP_DIR=/tmp/imc-uploads
```

### 5-2. CT-16: `utils/alimtalk-api.ts` (신규)

**역할:** 휴머스온 IMC 관리 API 호출 유일 진입점

```typescript
// packages/backend/src/utils/alimtalk-api.ts

import axios, { AxiosInstance, AxiosError } from 'axios';
import FormData from 'form-data';
import { Readable } from 'stream';

// ════════════════════════════════════════════════════════════
// 공통 타입
// ════════════════════════════════════════════════════════════
export interface ImcResponse<T = any> {
  code: string;         // '0000' 성공
  message: string;
  data?: T;
}

export class ImcApiError extends Error {
  constructor(
    public code: string,
    public httpStatus: number,
    public responseBody: any,
    message: string
  ) {
    super(`[IMC ${code}] ${message}`);
  }
}

// ════════════════════════════════════════════════════════════
// 클라이언트 (환경별)
// ════════════════════════════════════════════════════════════
const baseURL = process.env.IMC_ENV === 'PRD'
  ? process.env.IMC_BASE_URL_PRD!
  : process.env.IMC_BASE_URL_STG!;

const apiKey = process.env.IMC_ENV === 'PRD'
  ? process.env.IMC_API_KEY!
  : process.env.IMC_API_KEY_SANDBOX!;

const client: AxiosInstance = axios.create({
  baseURL,
  headers: {
    'x-imc-api-key': apiKey,
    'Content-Type': 'application/json',
  },
  timeout: 30_000,
});

// 에러 래핑
client.interceptors.response.use(
  (res) => res,
  (err: AxiosError<any>) => {
    const code = err.response?.data?.code || 'UNKNOWN';
    throw new ImcApiError(code, err.response?.status || 500, err.response?.data, err.message);
  }
);

// ════════════════════════════════════════════════════════════
// 발신프로필 (Sender)
// ════════════════════════════════════════════════════════════
export interface SenderTokenRequest {
  yellowId: string;           // @humuson
  phoneNumber: string;        // 01000000000
}

export interface SenderCreateRequest {
  token: string;              // 6자리 카톡 인증번호
  yellowId: string;
  phoneNumber: string;
  categoryCode: string;       // 11자리
  topSenderKeyYn?: 'Y' | 'N';
  customSenderKey?: string;
}

export interface SenderData {
  senderKey: string;
  yellowId: string;
  status: string;             // NORMAL/DORMANT/BLOCKED/DELETED
  // ... (응답 스키마 세부는 단건 조회 응답 참조)
}

export async function requestSenderToken(body: SenderTokenRequest): Promise<ImcResponse> {
  const res = await client.post('/kakao-management/api/v1/sender/token', body);
  return res.data;
}

export async function createSender(body: SenderCreateRequest): Promise<ImcResponse<SenderData>> {
  const res = await client.post('/kakao-management/api/v1/sender', body);
  return res.data;
}

export async function listSenders(params: { page?: number; count?: number } = {}): Promise<ImcResponse<{ list: SenderData[]; total: number }>> {
  const res = await client.get('/kakao-management/api/v1/sender', { params });
  return res.data;
}

export async function getSender(senderKey: string): Promise<ImcResponse<SenderData>> {
  const res = await client.get(`/kakao-management/api/v1/sender/${senderKey}`);
  return res.data;
}

export async function updateSenderUnsubscribe(senderKey: string, body: { unsubscribePhoneNumber: string; unsubscribeAuthNumber: string }): Promise<ImcResponse> {
  const res = await client.put(`/kakao-management/api/v1/sender/${senderKey}/unsubscribe`, body);
  return res.data;
}

export async function updateCustomSenderKey(senderKey: string, customSenderKey: string): Promise<ImcResponse> {
  const res = await client.put(`/kakao-management/api/v1/sender/${senderKey}/custom-sender-key`, { customSenderKey });
  return res.data;
}

export async function releaseSenderDormant(senderKey: string): Promise<ImcResponse> {
  const res = await client.put(`/kakao-management/api/v1/sender/${senderKey}/release`);
  return res.data;
}

export async function checkBrandTargeting(senderKey: string): Promise<ImcResponse<{ available: boolean }>> {
  const res = await client.get(`/kakao-management/api/v1/sender/${senderKey}/brand-message/check`);
  return res.data;
}

export async function applyBrandTargeting(senderKey: string, body: any): Promise<ImcResponse> {
  const res = await client.post(`/kakao-management/api/v1/sender/${senderKey}/brand-message`, body);
  return res.data;
}

// ════════════════════════════════════════════════════════════
// 발신프로필 카테고리
// ════════════════════════════════════════════════════════════
export interface CategoryNode {
  code: string;
  parentCode?: string;
  level: 1 | 2 | 3;
  name: string;
}

export async function listSenderCategories(): Promise<ImcResponse<CategoryNode[]>> {
  const res = await client.get('/kakao-management/api/v1/sender/category');
  return res.data;
}

export async function getSenderCategory(categoryCode: string): Promise<ImcResponse<CategoryNode>> {
  const res = await client.get(`/kakao-management/api/v1/sender/category/${categoryCode}`);
  return res.data;
}

// ════════════════════════════════════════════════════════════
// 알림톡 템플릿
// ════════════════════════════════════════════════════════════
export type AlimtalkMessageType = 'BA' | 'EX' | 'AD' | 'MI';
export type AlimtalkEmphasizeType = 'NONE' | 'TEXT' | 'IMAGE' | 'ITEM_LIST';

export interface AlimtalkTemplateCreateRequest {
  templateKey: string;                         // 0~128, 우리 생성
  manageName: string;                          // 0~30
  customTemplateCode?: string;                 // 0~30
  serviceMode?: 'PRD' | 'STG';
  templateMessageType: AlimtalkMessageType;
  templateEmphasizeType: AlimtalkEmphasizeType;
  templateContent: string;                     // 0~1000
  templatePreviewMessage?: string;             // 0~40
  templateExtra?: string;                      // EX/MI 필수, 0~500
  templateImageName?: string;                  // IMAGE 필수
  templateImageUrl?: string;                   // IMAGE 필수, 0~100
  templateTitle?: string;                      // TEXT 필수, 0~50
  templateSubtitle?: string;                   // TEXT 필수, 0~50
  templateHeader?: string;                     // ITEM_LIST 선택, 0~16
  templateItemHighlight?: {
    title: string;
    description: string;
    imageUrl?: string;
  };
  templateItem?: {
    list: { title: string; description: string }[];
    summary?: { title: string; description: string };
  };
  templateRepresentLink?: {
    urlMobile?: string;
    urlPc?: string;
    schemeAndroid?: string;
    schemeIos?: string;
  };
  categoryCode: string;                        // 0~6, 숫자만
  securityFlag?: boolean;
  buttonList?: AlimtalkButton[];               // 0~5
  quickReplyList?: AlimtalkQuickReply[];       // 0~10
  alarmPhoneNumber?: string;                   // 콤마 구분, 최대 10개
}

export interface AlimtalkButton {
  name: string;
  type: 'WL' | 'AL' | 'DS' | 'BK' | 'MD' | 'BF' | 'BC' | 'AC' | 'PD';
  urlMobile?: string;
  urlPc?: string;
  schemeAndroid?: string;
  schemeIos?: string;
  target?: 'out' | 'in';
  chatExtra?: string;
  chatEvent?: string;
  bizFormId?: number;
  pluginId?: string;
  relayId?: string;
  oneclickId?: string;
  productId?: string;
  telNumber?: string;
  mapAddress?: string;
  mapCoordinates?: string;
}

export interface AlimtalkQuickReply {
  name: string;
  type: 'WL' | 'AL' | 'BK' | 'MD' | 'BF';
  // ... (버튼과 유사, 일부 필드 제외)
}

export async function createAlimtalkTemplate(senderKey: string, body: AlimtalkTemplateCreateRequest): Promise<ImcResponse<{ templateCode: string }>> {
  const res = await client.post(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template`, body);
  return res.data;
}

export async function updateAlimtalkTemplate(senderKey: string, templateCode: string, body: Partial<AlimtalkTemplateCreateRequest>): Promise<ImcResponse> {
  const res = await client.put(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}`, body);
  return res.data;
}

export async function getAlimtalkTemplate(senderKey: string, templateCode: string): Promise<ImcResponse<any>> {
  const res = await client.get(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}`);
  return res.data;
}

export async function listAlimtalkTemplates(params: { page?: number; count?: number; templateName?: string; status?: string } = {}): Promise<ImcResponse<{ list: any[] }>> {
  const res = await client.get('/kakao-management/api/v1/alimtalk/template/list', { params });
  return res.data;
}

export async function deleteAlimtalkTemplate(senderKey: string, templateCode: string): Promise<ImcResponse> {
  const res = await client.delete(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}`);
  return res.data;
}

export async function requestInspection(senderKey: string, templateCode: string, comment?: string): Promise<ImcResponse> {
  const res = await client.post(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/comment`, { comment });
  return res.data;
}

export async function requestInspectionWithFile(senderKey: string, templateCode: string, comment: string, fileBuffer: Buffer, fileName: string): Promise<ImcResponse> {
  const form = new FormData();
  form.append('comment', comment);
  form.append('file', fileBuffer, fileName);
  const res = await client.post(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/comment-with-file`,
    form,
    { headers: { ...form.getHeaders(), 'x-imc-api-key': apiKey } }
  );
  return res.data;
}

export async function cancelInspection(senderKey: string, templateCode: string): Promise<ImcResponse> {
  const res = await client.put(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/comment-cancel`);
  return res.data;
}

export async function releaseTemplateDormant(senderKey: string, templateCode: string): Promise<ImcResponse> {
  const res = await client.put(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/release`);
  return res.data;
}

export async function updateCustomCode(senderKey: string, templateCode: string, customTemplateCode: string): Promise<ImcResponse> {
  const res = await client.patch(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/custom-code`, { customTemplateCode });
  return res.data;
}

export async function updateExposure(senderKey: string, templateCode: string, exposureYn: 'Y' | 'N'): Promise<ImcResponse> {
  const res = await client.patch(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/exposure`, { exposureYn });
  return res.data;
}

export async function updateServiceMode(senderKey: string, templateCode: string, mode: 'PRD' | 'STG'): Promise<ImcResponse> {
  const res = await client.patch(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/service-mode`, { serviceMode: mode });
  return res.data;
}

// ════════════════════════════════════════════════════════════
// 알림톡 검수 알림 수신자
// ════════════════════════════════════════════════════════════
export interface AlarmUser {
  alarmUserId?: string;
  name: string;
  phoneNumber: string;
  activeYn: 'Y' | 'N';
}

export async function listAlarmUsers(params: { name?: string; phoneNumber?: string; activeYn?: 'Y'|'N'; page?: number; count?: number } = {}): Promise<ImcResponse<{ list: AlarmUser[] }>> {
  const res = await client.get('/kakao-management/api/v1/alimtalk/template/alarm-users', { params });
  return res.data;
}

export async function createAlarmUser(body: Omit<AlarmUser, 'alarmUserId'>): Promise<ImcResponse<{ alarmUserId: string }>> {
  const res = await client.post('/kakao-management/api/v1/alimtalk/template/alarm-users', body);
  return res.data;
}

export async function updateAlarmUser(alarmUserId: string, body: Partial<AlarmUser>): Promise<ImcResponse> {
  const res = await client.put(`/kakao-management/api/v1/alimtalk/template/alarm-users/${alarmUserId}`, body);
  return res.data;
}

export async function deleteAlarmUser(alarmUserId: string): Promise<ImcResponse> {
  const res = await client.delete(`/kakao-management/api/v1/alimtalk/template/alarm-users/${alarmUserId}`);
  return res.data;
}

// ════════════════════════════════════════════════════════════
// 브랜드메시지 템플릿 (검수 없음!)
// ════════════════════════════════════════════════════════════
export type ChatBubbleType =
  | 'TEXT' | 'IMAGE' | 'WIDE' | 'WIDE_ITEM_LIST'
  | 'CAROUSEL_FEED' | 'PREMIUM_VIDEO' | 'COMMERCE' | 'CAROUSEL_COMMERCE';

export interface BrandMessageTemplateRequest {
  templateKey: string;
  customTemplateCode?: string;
  manageName: string;
  chatBubbleType: ChatBubbleType;
  adult?: 'Y' | 'N';
  header?: string;
  content?: string;
  additionalContent?: string;
  attachment?: {
    image?: { imgUrl: string; imgLink?: string };
    video?: { videoUrl: string; thumbnailUrl?: string };
    commerce?: { title: string; regularPrice?: string; discountRate?: string; discountPrice?: string; /* 등 */ };
    item?: { list: { title: string; description?: string; imageUrl?: string }[] };
  };
  carousel?: {
    head?: any;
    list: { title: string; description?: string; imageUrl?: string; /* 등 */ }[];
    tail?: any;
  };
  buttons?: AlimtalkButton[];
  coupon?: any;
}

export async function createBrandTemplate(senderKey: string, body: BrandMessageTemplateRequest): Promise<ImcResponse<{ templateKey: string }>> {
  const res = await client.post(`/kakao-management/api/v1/sender/${senderKey}/brand-message/template`, body);
  return res.data;
}

export async function updateBrandBasicTemplate(senderKey: string, body: Partial<BrandMessageTemplateRequest>): Promise<ImcResponse> {
  const res = await client.put(`/kakao-management/api/v1/sender/${senderKey}/brand-message/template`, body);
  return res.data;
}

export async function getBrandTemplate(senderKey: string, templateKey: string): Promise<ImcResponse<any>> {
  const res = await client.get(`/kakao-management/api/v1/sender/${senderKey}/brand-message/template/${templateKey}`);
  return res.data;
}

export async function listBrandTemplates(params: { senderKey?: string; page?: number; count?: number } = {}): Promise<ImcResponse<{ list: any[] }>> {
  const res = await client.get('/kakao-management/api/v1/brand-message/template/list', { params });
  return res.data;
}

export async function deleteBrandTemplate(senderKey: string, templateKey: string): Promise<ImcResponse> {
  const res = await client.delete(`/kakao-management/api/v1/sender/${senderKey}/brand-message/template/${templateKey}`);
  return res.data;
}

// ════════════════════════════════════════════════════════════
// 이미지 업로드 (9개)
// ════════════════════════════════════════════════════════════
export interface ImageUploadResult {
  imageName: string;        // IMC 반환 파일명
  imageUrl: string;         // IMC 반환 URL
}

async function uploadSingleImage(endpoint: string, fileBuffer: Buffer, fileName: string): Promise<ImcResponse<ImageUploadResult>> {
  const form = new FormData();
  form.append('image', fileBuffer, fileName);
  const res = await client.post(endpoint, form, { headers: { ...form.getHeaders(), 'x-imc-api-key': apiKey } });
  return res.data;
}

async function uploadMultipleImages(endpoint: string, files: { buffer: Buffer; name: string }[]): Promise<ImcResponse<{ list: ImageUploadResult[] }>> {
  const form = new FormData();
  for (const f of files) form.append('images', f.buffer, f.name);
  const res = await client.post(endpoint, form, { headers: { ...form.getHeaders(), 'x-imc-api-key': apiKey } });
  return res.data;
}

// 알림톡용
export const uploadAlimtalkTemplateImage = (buf: Buffer, name: string) =>
  uploadSingleImage('/kakao-management/api/v1/attach/alimtalk/template', buf, name);

export const uploadAlimtalkHighlightImage = (buf: Buffer, name: string) =>
  uploadSingleImage('/kakao-management/api/v1/attach/alimtalk/item-highlight', buf, name);

// 브랜드메시지용
export const uploadBrandDefaultImage = (buf: Buffer, name: string) =>
  uploadSingleImage('/kakao-management/api/v1/attach/brand-message/default', buf, name);

export const uploadBrandWideImage = (buf: Buffer, name: string) =>
  uploadSingleImage('/kakao-management/api/v1/attach/brand-message/wide', buf, name);

export const uploadBrandWideListFirstImage = (buf: Buffer, name: string) =>
  uploadSingleImage('/kakao-management/api/v1/attach/brand-message/wide-list/first', buf, name);

export const uploadBrandWideListImages = (files: { buffer: Buffer; name: string }[]) =>
  uploadMultipleImages('/kakao-management/api/v1/attach/brand-message/wide-list', files);

export const uploadBrandCarouselFeedImages = (files: { buffer: Buffer; name: string }[]) =>
  uploadMultipleImages('/kakao-management/api/v1/attach/brand-message/carousel-feed', files);

export const uploadBrandCarouselCommerceImages = (files: { buffer: Buffer; name: string }[]) =>
  uploadMultipleImages('/kakao-management/api/v1/attach/brand-message/carousel-commerce', files);

export const uploadMarketingAgreeFile = (senderKey: string, buf: Buffer, name: string) =>
  uploadSingleImage(`/kakao-management/api/v1/attach/marketing-agree/${senderKey}`, buf, name);

// ════════════════════════════════════════════════════════════
// 템플릿 카테고리
// ════════════════════════════════════════════════════════════
export async function listTemplateCategories(): Promise<ImcResponse<{ code: string; name: string }[]>> {
  const res = await client.get('/kakao-management/api/v1/template/category');
  return res.data;
}

export async function getTemplateCategory(categoryCode: string): Promise<ImcResponse<{ code: string; name: string }>> {
  const res = await client.get(`/kakao-management/api/v1/template/category/${categoryCode}`);
  return res.data;
}
```

### 5-3. CT-17: `utils/alimtalk-result-map.ts` (신규)

```typescript
// packages/backend/src/utils/alimtalk-result-map.ts

export interface ImcCodeMapping {
  kind: 'success' | 'user_error' | 'system_error' | 'inspect' | 'retryable';
  userMessage?: string;       // 화면 표시용
  logLevel: 'info' | 'warn' | 'error';
  retry?: boolean;
}

export const IMC_RESULT_CODE_MAP: Record<string, ImcCodeMapping> = {
  // 성공
  '0000': { kind: 'success', logLevel: 'info' },

  // 검증 실패 (4000대)
  '4000': { kind: 'user_error', userMessage: '요청값이 잘못되었습니다', logLevel: 'warn' },
  '4001': { kind: 'system_error', userMessage: '인증에 실패했습니다', logLevel: 'error' },

  // 발신프로필 (4010~4012, 4039)
  '4010': { kind: 'user_error', userMessage: '발신프로필 키가 이미 존재합니다', logLevel: 'warn' },
  '4011': { kind: 'user_error', userMessage: '발신프로필을 찾을 수 없습니다', logLevel: 'warn' },
  '4012': { kind: 'user_error', userMessage: '발신프로필 카테고리를 찾을 수 없습니다', logLevel: 'warn' },
  '4039': { kind: 'user_error', userMessage: '고객사 발신프로필 키가 이미 사용 중입니다', logLevel: 'warn' },

  // 템플릿
  '4013': { kind: 'user_error', userMessage: '알림톡 템플릿 코드를 찾을 수 없습니다', logLevel: 'warn' },
  '4014': { kind: 'user_error', userMessage: '알림톡 템플릿 키가 중복됩니다', logLevel: 'warn' },
  '4015': { kind: 'inspect', userMessage: '검수요청 가능한 상태가 아닙니다', logLevel: 'warn' },
  '4016': { kind: 'inspect', userMessage: '검수요청 취소 가능한 상태가 아닙니다', logLevel: 'warn' },
  '4017': { kind: 'user_error', userMessage: '수정 가능한 상태가 아닙니다', logLevel: 'warn' },
  '4018': { kind: 'user_error', userMessage: '템플릿 카테고리를 찾을 수 없습니다', logLevel: 'warn' },
  '4019': { kind: 'user_error', userMessage: '브랜드메시지 템플릿 코드를 찾을 수 없습니다', logLevel: 'warn' },
  '4020': { kind: 'user_error', userMessage: '브랜드메시지 템플릿 키를 찾을 수 없습니다', logLevel: 'warn' },
  '4021': { kind: 'user_error', userMessage: '삭제된 알림톡 템플릿입니다', logLevel: 'warn' },
  '4022': { kind: 'user_error', userMessage: '삭제된 친구톡 템플릿입니다', logLevel: 'warn' },
  '4023': { kind: 'user_error', userMessage: '삭제 가능한 상태가 아닙니다', logLevel: 'warn' },
  '4024': { kind: 'user_error', userMessage: '중지 가능한 상태가 아닙니다', logLevel: 'warn' },
  '4025': { kind: 'user_error', userMessage: '중지해제 가능한 상태가 아닙니다', logLevel: 'warn' },
  '4026': { kind: 'user_error', userMessage: '승인 취소 가능한 상태가 아닙니다', logLevel: 'warn' },
  '4027': { kind: 'user_error', userMessage: '고객사 관리 코드가 이미 사용 중입니다', logLevel: 'warn' },
  '4030': { kind: 'user_error', userMessage: '템플릿 승인(APR)이 필요합니다', logLevel: 'warn' },
  '4031': { kind: 'user_error', userMessage: '템플릿 발송 가능 상태가 아닙니다', logLevel: 'warn' },

  // 알림 수신자
  '4032': { kind: 'user_error', userMessage: '알림 수신자 기능 사용 권한이 없습니다', logLevel: 'warn' },
  '4033': { kind: 'user_error', userMessage: '알림 수신자를 찾을 수 없습니다', logLevel: 'warn' },
  '4034': { kind: 'user_error', userMessage: '알림 수신자 전화번호가 중복됩니다', logLevel: 'warn' },
  '4035': { kind: 'user_error', userMessage: '알림 수신자 키가 중복됩니다', logLevel: 'warn' },
  '4036': { kind: 'user_error', userMessage: '활성 알림 수신자 최대 인원(10명) 초과', logLevel: 'warn' },
  '4038': { kind: 'user_error', userMessage: '지정한 전화번호가 활성 수신자에 없습니다', logLevel: 'warn' },

  // 파일
  '4100': { kind: 'user_error', userMessage: '첨부파일이 존재하지 않습니다', logLevel: 'warn' },
  '4101': { kind: 'retryable', userMessage: '파일 저장 실패 (재시도)', logLevel: 'warn', retry: true },
  '4102': { kind: 'user_error', userMessage: '이미지 파일 키를 찾을 수 없습니다', logLevel: 'warn' },
  '4103': { kind: 'user_error', userMessage: '파일 최대 크기를 초과했습니다', logLevel: 'warn' },

  // 메시지 키 중복 (재생성 필요)
  '5000': { kind: 'retryable', userMessage: '메시지 키 중복 (재생성 필요)', logLevel: 'warn', retry: true },

  // 내부 시스템 에러 (재시도 가능)
  '6000': { kind: 'retryable', logLevel: 'error', retry: true },   // Kafka
  '6001': { kind: 'retryable', logLevel: 'error', retry: true },   // Redis
  '6002': { kind: 'system_error', logLevel: 'error' },             // Gzip
  '6005': { kind: 'retryable', logLevel: 'error', retry: true },   // Internal

  // 카카오 장애
  '9998': { kind: 'retryable', userMessage: '카카오 서버 오류 (재시도)', logLevel: 'error', retry: true },
  '9999': { kind: 'retryable', userMessage: '카카오 서버 오류 (재시도)', logLevel: 'error', retry: true },
};

export function resolveImcCode(code: string): ImcCodeMapping {
  return IMC_RESULT_CODE_MAP[code] || { kind: 'system_error', userMessage: `알 수 없는 오류 (${code})`, logLevel: 'error' };
}

// 리포트 코드는 별도 (웹훅에서 수신)
// 0000 성공, 508 NOT_FOUND_DATA, 811 NO_PERMISSION, 1003 INVALID_SENDER_KEY, 1006 DELETED_SENDER, 1007 STOPED_SENDER 등
export const IMC_REPORT_CODE_MAP: Record<string, { kind: 'delivered' | 'failed' | 'unknown'; userMessage: string }> = {
  '0000': { kind: 'delivered', userMessage: '전송 성공' },
  '508':  { kind: 'unknown', userMessage: '데이터 없음' },
  '1003': { kind: 'failed', userMessage: '발신프로필 오류' },
  '1006': { kind: 'failed', userMessage: '삭제된 발신프로필' },
  '1007': { kind: 'failed', userMessage: '중지된 발신프로필' },
  '1013': { kind: 'failed', userMessage: '유효하지 않은 앱링크' },
  // ... (전체 리포트 코드는 응답 코드 문서 참조)
};
```

### 5-4. CT-18: `utils/alimtalk-webhook-handler.ts` (신규)

```typescript
// packages/backend/src/utils/alimtalk-webhook-handler.ts

import { query } from '../db';
import { IMC_REPORT_CODE_MAP } from './alimtalk-result-map';

export interface WebhookEvent {
  eventId: string;
  payload: {
    serverKey: string;
    messageKey: string;
    reportType: string;     // SM/AT/FT
    reportCode: string;
    resend: boolean;
    receivedAt: string;     // "2026-03-05 19:49:43"
    netInfo: string;
  };
}

export interface WebhookPayload {
  events: WebhookEvent[];
  batchId: string;
  timestamp: number;        // epoch second
}

export async function processKakaoWebhook(payload: WebhookPayload): Promise<{ processed: number; skipped: number; failed: number }> {
  let processed = 0, skipped = 0, failed = 0;

  // 배치 단위 트랜잭션
  for (const ev of payload.events) {
    try {
      // 1) Idempotency 체크 (event_id unique 제약)
      const dup = await query('SELECT event_id FROM kakao_webhook_events WHERE event_id = $1', [ev.eventId]);
      if (dup.rows.length > 0) { skipped++; continue; }

      // 2) INSERT (raw payload 보존)
      await query(
        `INSERT INTO kakao_webhook_events (event_id, batch_id, server_key, message_key, report_type, report_code, resend, received_at, net_info, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10)`,
        [ev.eventId, payload.batchId, ev.payload.serverKey, ev.payload.messageKey, ev.payload.reportType,
         ev.payload.reportCode, ev.payload.resend, ev.payload.receivedAt, ev.payload.netInfo, JSON.stringify(ev.payload)]
      );

      // 3) messageKey로 campaign_runs 또는 auto_campaign_runs 매핑 업데이트
      const mapping = IMC_REPORT_CODE_MAP[ev.payload.reportCode] || { kind: 'unknown', userMessage: '' };
      const statusCode = mapping.kind === 'delivered' ? 'success' : mapping.kind === 'failed' ? 'failed' : 'unknown';

      // campaign_runs: message_key 포맷으로 매핑 (예: "CR_<campaign_run_id>_<idx>")
      // auto_campaign_runs: 동일 패턴
      // → 실제 매핑 키 체계는 발송 INSERT 로직(CT-04 sms-queue)에서 결정하는 것 따라감

      await query(
        `UPDATE messages
           SET final_status = $1, final_report_code = $2, final_received_at = $3::timestamptz, resend_used = $4
         WHERE message_key = $5`,
        [statusCode, ev.payload.reportCode, ev.payload.receivedAt, ev.payload.resend, ev.payload.messageKey]
      );

      await query(
        `UPDATE kakao_webhook_events SET process_status = 'OK' WHERE event_id = $1`,
        [ev.eventId]
      );
      processed++;
    } catch (err: any) {
      failed++;
      console.error('[webhook] event 처리 실패', ev.eventId, err);
      await query(
        `UPDATE kakao_webhook_events SET process_status = 'FAILED', error_message = $2 WHERE event_id = $1`,
        [ev.eventId, err.message]
      ).catch(() => {});
    }
  }

  return { processed, skipped, failed };
}

// HMAC 서명 검증 (시작하기 문서에 언급)
export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  const crypto = require('crypto');
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

### 5-5. 라우트 설계

**`routes/alimtalk.ts` (신규)** — 전체 경로 카탈로그

```typescript
// packages/backend/src/routes/alimtalk.ts
import { Router } from 'express';
import multer from 'multer';
import * as imc from '../utils/alimtalk-api';
import { processKakaoWebhook, verifyWebhookSignature } from '../utils/alimtalk-webhook-handler';
import { resolveImcCode } from '../utils/alimtalk-result-map';
import { query } from '../db';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ════════════════════════════════════════════════════════════
// 공개 엔드포인트 (인증 없이 IMC가 호출)
// ════════════════════════════════════════════════════════════
// POST /api/alimtalk/webhook — 휴머스온 리포트 수신
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // IP 화이트리스트 체크
  const clientIp = req.ip;
  const allowed = process.env.IMC_WEBHOOK_ALLOWED_IPS?.split(',') || [];
  if (allowed.length && !allowed.includes(clientIp)) {
    console.warn('[webhook] unauthorized IP:', clientIp);
    return res.sendStatus(403);
  }

  // HMAC 서명 검증
  const signature = req.headers['x-imc-signature'] as string;
  if (!verifyWebhookSignature(req.body.toString(), signature, process.env.IMC_WEBHOOK_HMAC_SECRET!)) {
    return res.sendStatus(401);
  }

  const payload = JSON.parse(req.body.toString());
  const result = await processKakaoWebhook(payload);
  return res.json({ code: '0000', ...result });
});

// ════════════════════════════════════════════════════════════
// 인증 필요 (모두)
// ════════════════════════════════════════════════════════════
router.use(authenticate);

// ── 발신프로필 (슈퍼관리자) ───────────────────────────
router.post('/senders/token', async (req, res) => { /* imc.requestSenderToken */ });
router.post('/senders', async (req, res) => { /* imc.createSender + DB INSERT */ });
router.get('/senders', async (req, res) => { /* company_id 필터 DB 조회 + IMC sync 옵션 */ });
router.get('/senders/:id', async (req, res) => { /* DB + IMC getSender 동기화 */ });
router.put('/senders/:id/unsubscribe', async (req, res) => { /* imc.updateSenderUnsubscribe */ });
router.put('/senders/:id/custom-key', async (req, res) => { /* imc.updateCustomSenderKey */ });
router.put('/senders/:id/release', async (req, res) => { /* imc.releaseSenderDormant */ });
router.post('/senders/:id/brand-targeting', async (req, res) => { /* imc.applyBrandTargeting */ });
router.get('/senders/:id/brand-targeting-check', async (req, res) => { /* imc.checkBrandTargeting */ });

// ── 카테고리 (캐시) ──────────────────────────────────
router.get('/categories/sender', async (req, res) => { /* PG kakao_sender_categories 조회 */ });
router.get('/categories/template', async (req, res) => { /* PG kakao_template_categories 조회 */ });
router.post('/categories/sync', async (req, res) => { /* 슈퍼관리자만: IMC → PG 재동기화 */ });

// ── 알림톡 템플릿 (고객사) ──────────────────────────
router.get('/templates', async (req, res) => { /* DB 조회, company_id 필터 */ });
router.post('/templates', async (req, res) => { /* imc.createAlimtalkTemplate + DB INSERT */ });
router.get('/templates/:templateCode', async (req, res) => { /* DB + IMC sync */ });
router.put('/templates/:templateCode', async (req, res) => { /* imc.updateAlimtalkTemplate */ });
router.delete('/templates/:templateCode', async (req, res) => { /* imc.deleteAlimtalkTemplate */ });
router.post('/templates/:templateCode/inspect', async (req, res) => { /* imc.requestInspection */ });
router.post('/templates/:templateCode/inspect-with-file', upload.single('file'), async (req, res) => { /* imc.requestInspectionWithFile */ });
router.put('/templates/:templateCode/cancel-inspect', async (req, res) => { /* imc.cancelInspection */ });
router.put('/templates/:templateCode/release', async (req, res) => { /* imc.releaseTemplateDormant */ });
router.patch('/templates/:templateCode/custom-code', async (req, res) => { /* imc.updateCustomCode */ });
router.patch('/templates/:templateCode/exposure', async (req, res) => { /* imc.updateExposure */ });
router.patch('/templates/:templateCode/service-mode', async (req, res) => { /* imc.updateServiceMode */ });

// ── 브랜드메시지 템플릿 ──────────────────────────────
router.get('/brand-templates', async (req, res) => { /* DB brand_message_templates */ });
router.post('/brand-templates', async (req, res) => { /* imc.createBrandTemplate + DB INSERT (검수 없음 → 즉시 ACTIVE) */ });
router.get('/brand-templates/:templateKey', async (req, res) => { /* DB + IMC sync */ });
router.put('/brand-templates/:templateKey', async (req, res) => { /* imc.updateBrandBasicTemplate */ });
router.delete('/brand-templates/:templateKey', async (req, res) => { /* imc.deleteBrandTemplate */ });

// ── 이미지 업로드 ────────────────────────────────────
router.post('/images/alimtalk/template', upload.single('image'), async (req, res) => { /* imc.uploadAlimtalkTemplateImage + DB INSERT */ });
router.post('/images/alimtalk/highlight', upload.single('image'), async (req, res) => { /* imc.uploadAlimtalkHighlightImage */ });
router.post('/images/brand/default', upload.single('image'), async (req, res) => { /* imc.uploadBrandDefaultImage */ });
router.post('/images/brand/wide', upload.single('image'), async (req, res) => { /* imc.uploadBrandWideImage */ });
router.post('/images/brand/wide-list/first', upload.single('image'), async (req, res) => { /* imc.uploadBrandWideListFirstImage */ });
router.post('/images/brand/wide-list', upload.array('images', 3), async (req, res) => { /* imc.uploadBrandWideListImages */ });
router.post('/images/brand/carousel-feed', upload.array('images', 10), async (req, res) => { /* imc.uploadBrandCarouselFeedImages */ });
router.post('/images/brand/carousel-commerce', upload.array('images', 11), async (req, res) => { /* imc.uploadBrandCarouselCommerceImages */ });
router.post('/images/marketing-agree/:senderId', upload.single('image'), async (req, res) => { /* imc.uploadMarketingAgreeFile */ });

// ── 검수 알림 수신자 ────────────────────────────────
router.get('/alarm-users', async (req, res) => { /* imc.listAlarmUsers */ });
router.post('/alarm-users', async (req, res) => { /* imc.createAlarmUser + DB INSERT */ });
router.put('/alarm-users/:id', async (req, res) => { /* imc.updateAlarmUser */ });
router.delete('/alarm-users/:id', async (req, res) => { /* imc.deleteAlarmUser */ });

export default router;
```

### 5-6. `campaigns.ts` 확장 포인트 (기존 5경로에 알림톡 통합)

기존 5경로(AI생성/AI발송/직접발송/테스트발송/예약발송) 각각에 **`channel: 'alimtalk' | 'brand_basic' | 'brand_free'`** 분기 추가:

```typescript
// 기존 sms/lms/mms 분기에 추가
if (channel === 'alimtalk') {
  // 템플릿 승인 상태 체크
  const tpl = await query('SELECT * FROM kakao_templates WHERE id = $1 AND status IN (\'APR\',\'A\')', [templateId]);
  if (!tpl.rows[0]) throw new Error('승인된 알림톡 템플릿만 발송 가능합니다');

  // 변수 치환 (messageUtils.replaceVariables 재사용)
  const message = replaceVariables(tpl.rows[0].content, customer, fieldMappings);

  // 부달문자(resend) 옵션 처리
  const resend = body.resendEnabled ? {
    mtCallback: callback,
    mtMessage: fallbackText,
    mtType: 'LM',
    mtTitle: fallbackTitle,
  } : undefined;

  // MySQL 큐 INSERT (기존 sms-queue의 insertAlimtalkQueue)
  await insertAlimtalkQueue({
    messageKey,
    senderKey: profile.profile_key,
    templateCode: tpl.rows[0].template_code,
    message,
    phoneNumber: customer.phone,
    resend,
    // ...
  });
}
```

### 5-7. 배치 스케줄러

**`utils/alimtalk-jobs.ts`** (신규)

```typescript
// 카테고리 일일 동기화
export async function syncCategoriesJob() {
  const senderCats = await imc.listSenderCategories();
  const tmplCats = await imc.listTemplateCategories();
  // UPSERT
}

// 템플릿 심사 상태 동기화 (웹훅 놓친 경우 fallback, 5분 주기)
export async function syncPendingTemplatesJob() {
  const pending = await query(`SELECT * FROM kakao_templates WHERE status IN ('REQ','REV') AND last_synced_at < now() - INTERVAL '5 minutes'`);
  for (const t of pending.rows) {
    try {
      const res = await imc.getAlimtalkTemplate(t.profile_key, t.template_code);
      // status 갱신
    } catch (err) { /* log */ }
  }
}

// 발신프로필 상태 확인 (1시간)
export async function syncSenderStatusJob() {
  // 비슷한 방식
}
```

`scheduled-tasks.ts`에 등록:
- `alimtalk.categorySync` — 매일 03:00 KST
- `alimtalk.pendingTemplateSync` — 5분마다
- `alimtalk.senderStatusSync` — 1시간마다

---

## 6. 프론트 설계

### 6-1. 화면 위치 최종 결정 (**A안 채택**)

| 화면 | 위치 | 대상 사용자 |
|------|------|-----------|
| 발신프로필 관리 | **슈퍼관리자** (sys.hanjullo.com) | 한줄로 운영팀 |
| 알림톡 템플릿 관리 | **고객사 대시보드** (app.hanjul.ai) | 고객사 관리자 |
| 브랜드메시지 템플릿 관리 | **고객사 대시보드** | 고객사 관리자 |
| 검수 알림 수신자 | **고객사 대시보드** | 고객사 관리자 |
| 직접발송/AI/자동발송 탭 통합 | **고객사 대시보드** (기존 화면 확장) | 고객사 담당자 |

**이유:** 발신프로필은 080 번호 할당/비즈인증 등 운영 개입이 많고 고객사당 소수 생성 → 슈퍼관리자에서 관리. 템플릿은 고객사마다 수십~수백 개 만들고 자주 수정 → 고객사가 직접.

### 6-2. 프론트 컴포넌트 트리

```
packages/frontend/src/
├── pages/
│   ├── AlimtalkTemplatesPage.tsx          [신규] 고객사: 알림톡 템플릿 목록+관리
│   ├── BrandTemplatesPage.tsx             [신규] 고객사: 브랜드메시지 템플릿 목록+관리
│   └── Dashboard.tsx                       [확장] 발송 채널에 알림톡/브랜드 추가
├── components/
│   ├── AlimtalkTemplateFormModal.tsx      [확장] 16조합 동적 UI + 실시간 미리보기
│   ├── BrandTemplateFormModal.tsx          [신규] 8종 chatBubbleType 동적 UI
│   ├── BrandMessageEditor.tsx              [재사용] 브랜드메시지 8종 편집
│   ├── BrandMessagePreview.tsx             [재사용] 미리보기
│   ├── AlimtalkPreview.tsx                 [신규] 알림톡 4강조유형 미리보기
│   ├── KakaoChannelImageUpload.tsx         [신규] 이미지 업로드 공통 (9개 엔드포인트 래퍼)
│   ├── AlarmUserManager.tsx                [신규] 검수 알림 수신자 CRUD
│   ├── TemplateInspectBadge.tsx            [신규] 검수 상태 컬러 배지
│   └── alimtalk/
│       ├── MessageTypeSelector.tsx         [신규] BA/EX/AD/MI 라디오
│       ├── EmphasizeTypeSelector.tsx       [신규] NONE/TEXT/IMAGE/ITEM_LIST 라디오
│       ├── ButtonEditor.tsx                [신규] 버튼 최대 5개 CRUD
│       ├── QuickReplyEditor.tsx            [신규] 바로연결 최대 10개 CRUD
│       ├── ItemListEditor.tsx              [신규] 아이템 리스트 최대 6개
│       └── CategoryDropdown.tsx            [신규] 템플릿 카테고리
packages/superadmin-frontend/src/     (또는 기존 관리자 UI)
├── pages/
│   └── AlimtalkSendersPage.tsx            [신규] 슈퍼관리자: 발신프로필 관리
└── components/
    ├── SenderRegistrationWizard.tsx       [신규] 3스텝 (정보/인증/확인)
    ├── SenderCategoryDropdown.tsx         [신규] 3단 드롭다운
    └── UnsubscribeSettingModal.tsx        [신규] 080 설정
```

### 6-3. 주요 화면 UX 설계

#### 6-3-A. 슈퍼관리자: 발신프로필 등록 마법사 (3 Step)

```
[Step 1: 기본 정보]
 ├ 카카오 채널 ID (@입력)         ← @로 시작 검증
 ├ 관리자 휴대폰                 ← 하이픈 자동 제거
 └ 업종 카테고리 (3단 드롭다운)    ← 대 > 중 > 소
                                     ↓
                              [인증번호 요청]
                                     ↓
                          imc.requestSenderToken()
                                     ↓
[Step 2: 본인 인증]
 ├ 인증번호 6자리 입력           ← 카톡 수신 안내 메시지
 ├ 대표 발신프로필 여부 (Y/N)
 └ 고객사 키 (선택)
                                     ↓
                                 [등록]
                                     ↓
                          imc.createSender()
                                     ↓
[Step 3: 완료]
 ├ senderKey 표시
 ├ 080 무료수신거부 설정 (선택)
 └ 브랜드메시지 타겟팅 M/N 신청 (선택)
```

#### 6-3-B. 고객사: 알림톡 템플릿 등록 모달 (동적)

```
┌──────────────────────────────────────────────────────────┐
│ 알림톡 템플릿 등록                        ✕             │
├──────────────────────────────────────────────────────────┤
│ 좌측(에디터)                    │ 우측(실시간 미리보기)    │
│ ───────────────────────────────  │ ────────────────────── │
│ [기본 정보]                      │  ┌────────────────┐    │
│ 관리명: [__________]             │  │ 카카오톡 UI       │    │
│ 카테고리: [▼ 회원 > 가입 > 완료]  │  │                │    │
│ 보안 템플릿: [ ] 체크             │  │ (동적 렌더링)     │    │
│                                  │  │                │    │
│ [메시지 유형]                    │  └────────────────┘    │
│ ◉ 기본형 (BA)                    │                        │
│ ○ 부가정보형 (EX) → 부가정보 입력 │  변수 목록:            │
│ ○ 채널추가형 (AD) → 1번 버튼 고정 │  · #{name}            │
│ ○ 복합형 (MI) → 위 둘 동시        │  · #{orderNo}         │
│                                  │                        │
│ [강조 유형]                      │                        │
│ ○ 사용안함 (NONE)                │                        │
│ ○ 강조표기형 (TEXT)              │                        │
│   → 타이틀 [__] 보조문구 [__]    │                        │
│ ○ 이미지형 (IMAGE)               │                        │
│   → 이미지 업로드 [파일선택]      │                        │
│ ○ 아이템리스트형 (ITEM_LIST)     │                        │
│   → [이미지/헤더/하이라이트]      │                        │
│   → 리스트 [+ 추가] (최대 6)     │                        │
│                                  │                        │
│ [본문]                           │                        │
│ [__________________________]     │                        │
│ 0/1000자     #{변수} 가이드       │                        │
│                                  │                        │
│ [대표링크] [버튼 추가] [바로연결]  │                        │
│                                  │                        │
├──────────────────────────────────────────────────────────┤
│ [저장(임시)] [저장 후 검수요청]                 [취소]     │
└──────────────────────────────────────────────────────────┘
```

#### 6-3-C. 고객사: 브랜드메시지 템플릿 등록 모달

알림톡 모달과 유사하되:
- **검수 상태 없음** (저장 즉시 `ACTIVE`)
- **chatBubbleType 8종 선택 탭** 상단 배치
- 각 탭별 필수 필드 동적 표시
- 이미지 업로드 UI가 각 type마다 다름 (단일/배열, 개수 제한)

#### 6-3-D. 직접발송/AI발송/자동발송 탭 통합

기존 발송 모달 상단에 **채널 탭** 추가:
```
[ SMS ]  [ LMS ]  [ MMS ]  [ 알림톡 ]  [ 브랜드메시지 ]
                                ↑ 탭 클릭
                                ↓
┌──────────────────────────────────────┐
│ 발신프로필: [▼ @mystore]             │
│ 템플릿: [▼ 회원가입 안내 (승인됨)]     │  ← status='APR'만 노출
│                                      │
│ 변수 매핑 (자동 치환):                │
│ · #{name}   ← 고객명                │
│ · #{orderNo} ← 주문번호              │
│                                      │
│ 부달 발송: [✓] 실패 시 LMS로 재발송   │
│   └ 대체 문구: [______________]       │
│                                      │
│ 단가: 15원/건 (승인 가격)              │
└──────────────────────────────────────┘
```

---

## 7. 상태 머신

### 7-1. 발신프로필 상태

```
         [토큰 요청]
              │
              ▼
           PENDING ──────(인증번호 실패)──→ 삭제
              │
              │ (createSender 성공)
              ▼
           NORMAL ◄────────────┐
              │                │
              │                │ (휴면 해제)
              │                │
         (휴면 조건)            │
              ▼                │
           DORMANT ────────────┘
              │
              │ (IMC 차단)
              ▼
           BLOCKED
              │
              │ (삭제)
              ▼
           DELETED (논리 삭제)
```

### 7-2. 알림톡 템플릿 상태 (검수 있음)

```
         [템플릿 등록]
              │
              ▼
        DRAFT (REG) ──────(수정/삭제 가능)
              │
              │ (검수요청)
              ▼
       REQUESTED (REQ) ──(검수요청 취소)──→ DRAFT
              │
              │ (운영팀이 심사 시작)
              ▼
       REVIEWING (REV)
              │
              ├─(승인)──→ APPROVED (APR/A) ─(휴면)─→ DORMANT ─(해제)─→ APPROVED
              │                                              │
              │                                              └─(승인취소)─→ DRAFT
              │
              └─(반려)──→ REJECTED (REJ)
                                │
                                │ (수정 후 재검수)
                                ▼
                           REQUESTED (다시 REQ)

※ APPROVED(APR/A) 상태만 발송 가능 (IMC 4030 에러 방지)
```

### 7-3. 브랜드메시지 템플릿 상태 (검수 없음)

```
         [템플릿 등록]
              │
              ▼
         ACTIVE ◄─────────── (수정)
              │
              │ (삭제)
              ▼
         DELETED (논리 삭제)

※ 즉시 발송 가능. 광고수신동의한 채널 친구만 수신.
```

---

## 8. 웹훅 처리

### 8-1. 수신 흐름

```
IMC 발송 결과 생성
    │
    │ HTTPS POST /api/alimtalk/webhook
    │ Headers: x-imc-signature: <HMAC-SHA256>
    │ Body: { events: [...], batchId, timestamp }
    ▼
[1] IP 화이트리스트 체크 (403 block)
    │
    ▼
[2] HMAC 서명 검증 (401 block)
    │
    ▼
[3] processKakaoWebhook(payload)
    │
    │ for each event:
    │   a) event_id unique INSERT (중복 → skip)
    │   b) messageKey로 messages 테이블 UPDATE (final_status, final_report_code)
    │   c) reportType에 따라 campaign_runs 집계 업데이트
    │   d) resend=true면 부달 LMS도 별도 기록
    │
    ▼
[4] 200 OK 응답 (처리 결과 포함)
```

### 8-2. messageKey 생성 규칙 (한줄로 ↔ IMC 매핑)

발송 시 MySQL 큐 INSERT에서 사용하는 `messageKey`를 아래 규칙으로 생성:
- AI캠페인 발송: `CR_{campaignRunId}_{customerIdx}`
- 직접발송: `DS_{campaignId}_{customerIdx}`
- 테스트발송: `TS_{uuid}`
- 자동발송: `AC_{autoCampaignRunId}_{customerIdx}`

웹훅 수신 시 이 키로 `campaign_runs.id` 또는 `auto_campaign_runs.id`를 역매핑.

---

## 9. 에러 처리

### 9-1. IMC 결과 코드 매핑 (CT-17에 정의)

| IMC 코드 | 한줄로 처리 | UX |
|---------|-----------|-----|
| 0000 | 성공 | - |
| 4000~4999 | DB 상태 업데이트 + 사용자 에러 메시지 | 모달 안내 |
| 5000 (DUPLICATE_MESSAGE_KEY) | messageKey 재생성 후 1회 재시도 | 투명 |
| 6000~6005 (내부 서버) | 지수 백오프 재시도 (최대 3회) | 실패 시 관리자 알림 |
| 9998/9999 (카카오 장애) | 큐에 재발송 대기로 기록 | 재발송 배치로 처리 |

### 9-2. 템플릿 승인 전 발송 시도 (4030)

프론트/백엔드 이중 방어:
- 프론트: 발송 모달에서 `status='APR'` 템플릿만 드롭다운에 표시
- 백엔드: 큐 INSERT 전 `kakao_templates.status` 체크

---

## 10. Phase별 체크리스트

### 🟢 Phase 0 (준비 — 0.5일)
- [ ] IMC API KEY 발급 요청 (`cs_imc@humuson.com`)
- [ ] 샌드박스 서버(`10.147.1.109:28000`) 접근 가능 여부 확인 (VPN 필요?)
- [ ] 휴머스온 웹훅 송신 IP 목록 수령
- [ ] HMAC 서명 스펙 문서 수령 (시크릿 발급 포함)
- [ ] QTmsg Agent 쪽 역할 변경 공지 (관리 API는 한줄로 직접)

### 🔵 Phase 1 — 알림톡 기반 (2~3주, 백엔드 중심)

**DB (1일)**
- [ ] P1-DB-01: ALTER `kakao_sender_profiles` (9개 컬럼 추가)
- [ ] P1-DB-02: ALTER `kakao_templates` (12개 컬럼 추가)
- [ ] P1-DB-03: CREATE `kakao_alarm_users`
- [ ] P1-DB-04: CREATE `kakao_sender_categories` / `kakao_template_categories`
- [ ] P1-DB-05: CREATE `kakao_webhook_events`
- [ ] P1-DB-06: CREATE `kakao_image_uploads`
- [ ] P1-DB-07: 인덱스 전부 생성
- [ ] P1-DB-08: `status/SCHEMA.md` 갱신

**백엔드 (1주)**
- [ ] P1-BE-01: `utils/alimtalk-api.ts` (CT-16) — 발신프로필 11개 함수
- [ ] P1-BE-02: CT-16 — 알림톡 템플릿 13개 함수
- [ ] P1-BE-03: CT-16 — 알림 수신자 4개 + 카테고리 2개 + 이미지 업로드 9개
- [ ] P1-BE-04: `utils/alimtalk-result-map.ts` (CT-17)
- [ ] P1-BE-05: `utils/alimtalk-webhook-handler.ts` (CT-18)
- [ ] P1-BE-06: `routes/alimtalk.ts` 전 경로 구현 (발신프로필/템플릿/알림수신자)
- [ ] P1-BE-07: 이미지 업로드 라우트 + 검증 (사이즈/비율/포맷)
- [ ] P1-BE-08: 웹훅 라우트 + IP 화이트리스트 + HMAC
- [ ] P1-BE-09: `utils/alimtalk-jobs.ts` 배치 3종
- [ ] P1-BE-10: `scheduled-tasks.ts` 등록
- [ ] P1-BE-11: 환경변수 추가 (.env.example 갱신)

**프론트 (1주)**
- [ ] P1-FE-01: 슈퍼관리자 `AlimtalkSendersPage.tsx`
- [ ] P1-FE-02: `SenderRegistrationWizard.tsx` (3 Step)
- [ ] P1-FE-03: `UnsubscribeSettingModal.tsx`
- [ ] P1-FE-04: 고객사 `AlimtalkTemplatesPage.tsx` (목록 + 배지)
- [ ] P1-FE-05: `AlimtalkTemplateFormModal.tsx` 16조합 동적 UI
- [ ] P1-FE-06: `AlimtalkPreview.tsx` 실시간 미리보기
- [ ] P1-FE-07: `alimtalk/*` 서브 컴포넌트 (ButtonEditor/QuickReplyEditor/ItemListEditor 등)
- [ ] P1-FE-08: `AlarmUserManager.tsx`
- [ ] P1-FE-09: `KakaoChannelImageUpload.tsx` 공통 래퍼

**검증 (2일)**
- [ ] P1-QA-01: 샌드박스로 발신프로필 등록 E2E
- [ ] P1-QA-02: 템플릿 등록 → 검수요청 → (모의) 승인 → 발송 E2E
- [ ] P1-QA-03: 이미지 업로드 9종 각각 성공/실패 케이스
- [ ] P1-QA-04: 웹훅 수신 테스트 (Postman으로 모의 POST)
- [ ] P1-QA-05: 배치 3종 수동 실행

### 🟡 Phase 2 — 발송 연동 (1~2주)

- [ ] P2-BE-01: `campaigns.ts` 5경로 전부에 `channel='alimtalk'` 분기 추가
- [ ] P2-BE-02: `auto-campaigns.ts`에 알림톡 선택 지원
- [ ] P2-BE-03: 프론트 발송 모달에 **알림톡 탭** 추가 (Dashboard + AiCampaignSendModal + AutoSendFormModal 3곳)
- [ ] P2-BE-04: 템플릿 변수 매핑 UI (고객 필드 ↔ `#{변수}`)
- [ ] P2-BE-05: 부달문자(resend) 옵션 UI
- [ ] P2-BE-06: 선불 단가 분기 (알림톡 단가 관리)
- [ ] P2-BE-07: ResultsModal에 알림톡 전용 컬럼 (리포트 코드, 부달 여부)
- [ ] P2-BE-08: `CT-04 sms-queue.ts` messageKey 규칙 표준화

### 🟠 Phase 3 — 브랜드메시지 확장 (2주)

- [ ] P3-DB-01: CREATE `brand_message_templates`
- [ ] P3-BE-01: CT-16 — 브랜드메시지 템플릿 5개 함수
- [ ] P3-BE-02: 브랜드메시지 이미지 업로드 6개 함수 완성 (Phase 1에서 skeleton 작성 후 여기서 실사용)
- [ ] P3-BE-03: `routes/alimtalk.ts`에 브랜드메시지 경로 활성화
- [ ] P3-FE-01: `BrandTemplatesPage.tsx` 목록
- [ ] P3-FE-02: `BrandTemplateFormModal.tsx` 8종 chatBubbleType 동적 UI
- [ ] P3-FE-03: 발송 탭에 **브랜드메시지** 탭 추가
- [ ] P3-FE-04: `BrandMessageEditor.tsx` (기존) 확장 — 검수 없음 반영

### 🔴 Phase 4 — 운영 고도화 (1주)

- [ ] P4-OPS-01: 템플릿 심사 상태 동기화 배치 안정화 (웹훅 누락 시 fallback)
- [ ] P4-OPS-02: 발신프로필 상태 주기 확인
- [ ] P4-OPS-03: 슈퍼관리자 대시보드 — 전체 회사별 알림톡 발송량/성공률
- [ ] P4-OPS-04: 알림톡 리포트 코드별 집계 리포트
- [ ] P4-OPS-05: 문서 최종판 (`status/STATUS.md` 갱신, 메모리 업데이트)

---

## 11. 테스트 시나리오

### 11-1. 샌드박스 smoke test

```bash
# 1. 발신프로필 카테고리 조회
curl -s "http://10.147.1.109:28000/kakao-management/api/v1/sender/category" \
  -H "x-imc-api-key: APIKEY-HUMUSON-0001" | jq

# 2. 인증번호 요청
curl -sX POST "http://10.147.1.109:28000/kakao-management/api/v1/sender/token" \
  -H "x-imc-api-key: APIKEY-HUMUSON-0001" \
  -H "Content-Type: application/json" \
  -d '{"yellowId":"@test","phoneNumber":"01000000000"}'

# 3. 발신프로필 등록
curl -sX POST "http://10.147.1.109:28000/kakao-management/api/v1/sender" \
  -H "x-imc-api-key: APIKEY-HUMUSON-0001" \
  -H "Content-Type: application/json" \
  -d '{"token":"123456","yellowId":"@test","phoneNumber":"01000000000","categoryCode":"00100010001"}'

# 4. 알림톡 템플릿 등록
# ... (5-2 TS 참조)

# 5. 검수요청
# ... 

# 6. 발송 (QTmsg Agent 통해서도 가능)
curl -sX POST "http://10.147.1.109:28000/kakao-message/api/v1/alimtalk/send" \
  -H "x-imc-api-key: APIKEY-HUMUSON-0001" \
  -H "Content-Type: application/json" \
  -d '{"messageKey":"TEST_001","senderKey":"...","templateCode":"...","message":"홍길동님 안녕하세요","phoneNumber":"01012345678"}'
```

### 11-2. E2E 시나리오

| # | 시나리오 | Path | 기대 결과 |
|---|---------|------|---------|
| 1 | 고객사가 알림톡 템플릿 등록 | 프론트 → POST `/alimtalk/templates` → IMC → DB | status=DRAFT, IMC templateCode 반환 |
| 2 | 검수요청 | 프론트 → POST `/alimtalk/templates/:code/inspect` → IMC | status=REQUESTED |
| 3 | 운영팀 승인 (수동) | 별도 IMC 관리 도구 | 웹훅 수신 → status=APPROVED |
| 4 | 고객사가 직접발송으로 알림톡 | Dashboard 발송 → MySQL 큐 → Agent → IMC 발송 | 성공 |
| 5 | 웹훅 결과 수신 | IMC → POST `/api/alimtalk/webhook` | `messages` UPDATE, 집계 반영 |
| 6 | 템플릿 반려 후 수정 | REJ → 수정 → 재검수요청 | status 전환 정상 |

---

## 12. 리스크 / 이슈

| 분류 | 이슈 | 영향도 | 대응 |
|------|------|-------|------|
| 🔴 High | IMC API KEY 미발급 | 개발 착수 불가 | Phase 0에서 우선 확보 |
| 🔴 High | 샌드박스 IP(10.147.1.109) 외부 접근 불가 | 로컬 개발 불가 | VPN or 프록시 설정 확인 |
| 🟡 Mid | HMAC 서명 스펙 문서 미수령 | 웹훅 검증 불가 | 휴머스온 담당자에 추가 요청 |
| 🟡 Mid | 휴머스온 웹훅 송신 IP 미수령 | 화이트리스트 못 씀 | 초기엔 IP 체크 skip → 받으면 활성화 |
| 🟡 Mid | QTmsg Agent와 역할 분담 | 중복 구현 위험 | Phase 0에 명확한 경계 합의 (문서화) |
| 🟢 Low | 카테고리 동기화 주기 | 매일 03시 배치 | cron 등록 |
| 🟢 Low | 템플릿 검수 평균 소요시간 미확인 | UX 안내 부정확 | 운영 중 수집 |
| 🟢 Low | 이미지 업로드 실패 시 재시도 전략 | - | 클라이언트 3회 재시도 + DLQ |

---

## 13. 다음 세션 착수 가이드

### 13-1. 세션 시작 시 AI가 먼저 읽을 것

1. `CLAUDE.md` (필수)
2. **본 설계서** (`status/ALIMTALK-DESIGN.md`)
3. `status/STATUS.md` CURRENT_TASK
4. `status/SCHEMA.md` — 기존 스키마 확인

### 13-2. 첫 작업 순서 (다음 세션 Day 1)

**체크인 30분:**
1. Harold님께 인사 + Phase 0 상태 확인
   - IMC KEY 발급됐나?
   - 샌드박스 접근 가능한가?
2. 없으면 Phase 0 먼저 처리

**Day 1 본작업 (Phase 1 DB부터):**
```
✅ P1-DB-01: ALTER kakao_sender_profiles
   ↓ DDL 작성 → Harold님 리뷰 → 서버 수동 실행 (AI는 SQL 파일만 생성)
✅ P1-DB-02: ALTER kakao_templates
✅ P1-DB-03~06: CREATE 4개 신규 테이블
✅ P1-DB-07: 인덱스
✅ P1-DB-08: SCHEMA.md 갱신
→ DB 완료 후 백엔드 진입
```

### 13-3. 구현 중 반드시 확인할 것

- [ ] CLAUDE.md 0번 원칙 — 매 함수 작성 전 `utils/`에 유사 기능 있는지 grep
- [ ] 4-3 기간계 무접촉 — 발송 INSERT 로직은 읽기만, 수정 금지
- [ ] 4-7 하나씩 세심하게 — 에이전트 병렬 금지
- [ ] 7-1 컨트롤타워 수정 시 필수 프로세스 — grep 전수 → 교체 → 잔존 0건 확인

### 13-4. Phase 1 완료 정의 (Definition of Done)

- [ ] 샌드박스 환경에서 E2E 시나리오 1~6번 전부 성공
- [ ] 타입체크 0 에러 (backend + frontend)
- [ ] 메모리 `project_d130.md` 작성 (Phase 1 완료 + Phase 2 착수 가이드)
- [ ] STATUS.md 갱신
- [ ] Harold님 컨펌 → 배포 → 운영 환경 smoke test

---

## 14. 미입수 문서 (참고)

권장/선택 항목 — 필요 시 추후 보충:
- 채널 소개 4개 (카카오/문자/국제문자/RCS) — Phase 4에 참조
- 통계 API — **불필요** (Harold님이 QTmsg 소유자이므로 자체 집계)
- 문자 발송/관리 / RCS 발송/관리 — 현행 QTmsg 유지, 필요 시 확장

---

## 15. Harold님 확정 사항 & 오픈 이슈

### 확정
- ✅ 화면 위치: **A안** (발신프로필=슈퍼관리자 / 템플릿=고객사)
- ✅ 통계 API 불필요 (QTmsg 자체 집계)
- ✅ 설계서 완성 후 **다음 세션부터 구현 착수**
- ✅ QTmsg Agent 소유 — 필요시 Agent 쪽도 수정 가능

### 오픈 (다음 세션 시작 시 확인)
- ⏳ IMC API KEY 발급 상태
- ⏳ 휴머스온 웹훅 송신 IP 목록
- ⏳ HMAC 서명 시크릿
- ⏳ 샌드박스 VPN 설정 여부
- ⏳ QTmsg Agent 관리 API 역할 분담 합의

---

**설계서 작성 완료.** 다음 세션에서 이 문서 펴고 `Phase 0 → Phase 1 → ...` 순서로 착수하면 됩니다.

📎 **관련 원본 문서:** `C:\Users\ceo\Downloads\imc_extracted\` (50개 원문 텍스트)
