# 한줄로 — DB 스키마 레퍼런스

> **이 문서는 STATUS.md / OPS.md와 함께 운영됩니다.**
> DB 구조 변경 시 반드시 이 문서도 함께 업데이트하십시오.

---

## PostgreSQL 테이블 목록 (요약)

| # | 테이블명 | 용도 |
|---|----------|------|
| 1 | address_books | 주소록 |
| 2 | audit_logs | 감사 로그 |
| 3 | callback_numbers | 발신번호 |
| 4 | campaign_runs | 캠페인 실행 |
| 5 | campaigns | 캠페인 |
| 6 | companies | 고객사 |
| 7 | company_settings | 고객사 설정 KV |
| 8 | consents | 수신 동의 |
| 9 | customer_field_definitions | 고객 필드 정의 |
| 10 | customers | 고객 |
| 11 | file_uploads | 파일 업로드 |
| 12 | kakao_sender_profiles | 카카오 발신 프로필 (D130 IMC 확장) |
| 13 | kakao_templates | 카카오 알림톡 템플릿 (D130 IMC 확장) |
| 14 | kakao_friendtalk_images | 카카오 친구톡 이미지 (레거시) |
| 14-A | **brand_message_templates** | **브랜드메시지 템플릿 (D130 신설, 검수 없음)** |
| 14-B | **kakao_alarm_users** | **알림톡 검수 알림 수신자 (D130 신설, 회사당 10명)** |
| 14-C | **kakao_sender_categories** | **발신프로필 카테고리 캐시 (D130, 3단 트리)** |
| 14-D | **kakao_template_categories** | **템플릿 카테고리 캐시 (D130, flat 6자리)** |
| 14-E | **kakao_webhook_events** | **IMC 웹훅 이벤트 로그 (D130, idempotency)** |
| 14-F | **kakao_image_uploads** | **IMC 이미지 업로드 캐시 (D130)** |
| 15 | messages | 메시지 (월별 파티션) |
| 16 | mobile_dm_requests | 모바일 DM 요청 |
| 17 | opt_outs | 수신거부 (user_id 기준) |
| 18 | opt_out_sync_logs | 수신거부 동기화 로그 |
| 19 | plans | 요금제 |
| 20 | plan_requests | 요금제 변경 요청 |
| 21 | products | 상품 |
| 22 | projects | 프로젝트 |
| 23 | purchases | 구매내역 |
| 24 | rcs_templates | RCS 템플릿 |
| 25 | sender_numbers | 발신번호 관리 |
| 26 | sender_number_documents | 발신번호 인증서류 |
| 27 | sms_templates | SMS 템플릿 |
| 28 | standard_fields | 표준 필드 정의 |
| 29 | super_admins | 슈퍼 관리자 |
| 30 | test_contacts | 테스트 연락처 |
| 31 | transmission_certifications | 전송 인증 |
| 32 | unsubscribes | 수신거부 (user_id 기준) |
| 33 | user_alarm_phones | 사용자 알림 전화번호 |
| 34 | user_sender_profiles | 사용자-카카오 프로필 매핑 |
| 35 | user_sessions | 사용자 세션 |
| 36 | users | 사용자 |
| 37 | sync_agents | Sync Agent 등록 정보 |
| 38 | sync_logs | 동기화 로그 |
| 39 | sms_line_groups | 발송 라인그룹 |
| 40 | billing_invoices | 거래내역서/정산 |
| 41 | balance_transactions | 잔액 변동 이력 |
| 42 | payments | PG 결제 내역 |
| 43 | deposit_requests | 무통장입금 요청 |
| 44 | analysis_results | AI 분석 결과 캐시 |
| 45 | spam_filter_tests | 스팸필터 테스트 |
| 46 | spam_filter_test_results | 스팸필터 테스트 결과 |
| 47 | auto_campaigns | 자동발송 스케줄 (D69 생성 완료) |
| 48 | auto_campaign_runs | 자동발송 실행 이력 (D69 생성 완료) |
| 49 | sender_managers | 발신번호 관리 담당자 |
| 50 | sender_registrations | 발신번호 등록 신청 |
| 51 | callback_number_assignments | 발신번호 사용자별 배정 (D87) |
| 52 | flyers | 전단AI 전단지 (Phase 1) |
| 53 | short_urls | 전단AI 단축URL (Phase 1) |
| 54 | url_clicks | 전단AI 클릭 로그 (Phase 1) |
| 55 | login_blocks | 로그인 차단 (D145 P0, 2026-05-07 — IP+loginId 쌍 5회/10분 자동 차단 30분) |
| 56 | company_agent_ids | 에이전트(QTmsg) 발송ID ↔ 회사 매핑 (2026-07-03 신설) |
| 57 | customer_send_stats | 고객별 발송 누적 카운터 (2026-07-03 신설 — 예측 분모 전용. customer_id PK(FK customers CASCADE), company_id(idx), total_sent, last_sent_at. 고객당 1행) |
| 58 | customer_send_stats_marks | 발송 카운터 캠페인 멱등 마커 (2026-07-03 신설 — campaign_ref varchar(120) PK, 재시도 중복 카운트 차단) |
| - | ai_training_logs | 문안 학습 로그 (회사별 tenant_ref HMAC 격리). ★ 2026-07-03 실측: `ck_training_message_type` CHECK = message_type IN ('SMS','LMS','MMS','KAKAO','EMAIL','DM') — DM 추가(전 채널 학습 통합 Phase 1). 적재=fire-and-forget 격리(발송 무영향), source_ref 멱등 |
| - | ai_training_logs **(2026-07-04 ADD 대기)** | `click_count int` · `conversion_count int` — Tier1 반응 신호(DM·이메일 클릭 환류, 랭커/검색기 클릭 우선 정렬). 코드 42703 폴백이라 미실행 무영향. `ALTER TABLE ai_training_logs ADD COLUMN click_count integer; ADD COLUMN conversion_count integer;` |
| - | best_copy_seed_usage **(2026-07-04 CREATE 대기)** | 시드 사용 기록(성과 환류). `id bigserial PK, seed_id uuid, tenant_ref varchar(64)=getTenantRef, channel varchar(10), used_at timestamptz`. INDEX(seed_id),(tenant_ref,used_at). 코드 42P01 폴백(미생성 무영향) |
| - | best_copy_assets **(2026-07-04 CREATE 대기)** | 업종 승리공식·AI 재창작 예시. `id uuid PK, kind varchar(20)[formula\|style_example], industry_code varchar(20), channel varchar(10), is_ad bool, content text, meta jsonb, created_at timestamptz`. INDEX(kind,industry_code). 코드 42P01 폴백 |
| - | send_fatigue_daily **(2026-07-05 CREATE 대기)** | 발송 피로도 일일 버킷(광고성 문자+알림톡 합산, day=KST). `company_id uuid NOT NULL, phone varchar(20) NOT NULL, day date NOT NULL, sent_count int NOT NULL DEFAULT 0, PK(company_id,phone,day)` + INDEX(day). 45일 초과 프루닝(fatigue-guard 6h 워커). 코드 42P01 폴백(미생성=게이트·카운터 비활성) |
| - | companies **(2026-07-05 ADD 대기)** | `fatigue_cap_days int` · `fatigue_cap_max int` — 발송 피로도 상한(최근 N일 M건). NULL=비활성(opt-in — 회사가 설정 화면에서 켠 경우만 게이트). 코드 42703 폴백. `ALTER TABLE companies ADD COLUMN fatigue_cap_days integer; ALTER TABLE companies ADD COLUMN fatigue_cap_max integer;` |

---

## PostgreSQL 테이블 상세

### address_books (주소록)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| group_name | varchar(100) |
| phone | varchar(20) |
| name | varchar(50) |
| extra1~3 | varchar(100) |
| created_at | timestamp |

### audit_logs (감사 로그)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| user_id | uuid FK |
| action | varchar(50) |
| target_type | varchar(50) |
| target_id | uuid |
| details | jsonb |
| ip_address | inet |
| user_agent | text |
| created_at | timestamptz |

### login_blocks (로그인 차단 — D145 P0, 2026-05-07)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | gen_random_uuid() |
| ip_address | inet NOT NULL | 차단 IP |
| login_id | varchar(100) NOT NULL | 차단 loginId (B안: IP+ID 쌍) |
| blocked_at | timestamptz NOT NULL | 차단 시각 |
| expires_at | timestamptz NOT NULL | 만료 시각 (자동: blocked_at + 30분) |
| reason | varchar(50) NOT NULL | 'auto_5fail_10min' / 'manual:상세' |
| fail_count | int NOT NULL DEFAULT 5 | 차단 trigger 시점 실패 횟수 (수동=0) |
| blocked_by | uuid | 수동 차단한 super_admin id |
| unblocked_at | timestamptz | 해제 시각 (NULL=활성) |
| unblocked_by | uuid | 해제한 super_admin id 또는 user(login_success) |
| unblock_reason | text | 'login_success' / 'admin_unblock' / 사용자 입력 |
| created_at | timestamptz | |

**인덱스:**
- `idx_login_blocks_active` — `(login_id, ip_address) WHERE unblocked_at IS NULL` (활성 차단 빠른 조회)
- `idx_login_blocks_history` — `(created_at DESC)` (이력 페이지)

**정책 (CT-08과 별개, utils/login-block.ts 컨트롤타워):**
- 같은 (IP, loginId) 쌍에서 5회 이상 실패 within 10분 → 30분 자동 차단
- audit_logs(login_fail) 기준 카운트 (action='login_fail' AND ip_address=X AND details->>'loginId'=Y)
- 차단 중 같은 쌍 시도 → 즉시 403 LOGIN_BLOCKED + 남은 시간 안내
- 다른 IP의 같은 loginId, 다른 loginId의 같은 IP는 영향 없음 (정상 사용자 보호)
- 로그인 성공 시 해당 쌍의 미만료 차단 자동 해제

### callback_numbers (발신번호)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| phone | varchar(20) |
| label | varchar(100) |
| is_default | boolean |
| store_code | varchar(50) |
| store_name | varchar(100) |
| assignment_scope | varchar(10) DEFAULT 'all' NOT NULL | — 'all'=전체사용, 'assigned'=지정사용자만 (D87)
| created_at | timestamp |

### callback_number_assignments (발신번호 사용자별 배정 — D87)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| callback_number_id | uuid FK → callback_numbers(id) ON DELETE CASCADE |
| user_id | uuid FK → users(id) ON DELETE CASCADE |
| assigned_by | uuid |
| created_at | timestamptz |
| UNIQUE(callback_number_id, user_id) | |

### campaign_runs (캠페인 실행)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| campaign_id | uuid FK |
| run_number | integer |
| target_filter | jsonb |
| sent_count | integer |
| success_count | integer |
| fail_count | integer |
| status | varchar(20) |
| scheduled_at | timestamp |
| sent_at | timestamp |
| target_count | integer |
| message_content | text |
| message_type | varchar(20) |
| started_at | timestamp |
| completed_at | timestamp |
| created_at | timestamp |

### campaigns (캠페인)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| user_id | uuid FK |
| company_id | uuid FK |
| campaign_name | varchar(200) |
| description | text |
| user_prompt | text |
| ai_mode | boolean |
| send_type | varchar(20) — ai/manual |
| target_spec | jsonb |
| target_filter | jsonb |
| target_count | integer |
| total_target_count | integer |
| message_type | varchar(10) |
| message_content | text |
| message_template | text |
| message_subject | varchar(200) |
| subject | varchar(200) |
| callback_number | varchar(20) |
| sender_number_id | uuid FK |
| kakao_profile_id | uuid FK |
| kakao_template_id | uuid FK |
| is_ad | boolean |
| sent_count | integer |
| success_count | integer |
| fail_count | integer |
| status | varchar(20) |
| scheduled_at | timestamptz |
| sent_at | timestamptz |
| send_rate_per_minute | integer |
| analysis_start_date | date |
| analysis_end_date | date |
| event_start_date | date |
| event_end_date | date |
| excluded_phones | text[] |
| created_by | uuid FK |
| cancelled_by | uuid |
| cancelled_by_type | varchar(20) |
| cancel_reason | text |
| cancelled_at | timestamp |
| created_at | timestamptz |
| updated_at | timestamptz |
| mms_image_paths | jsonb | ★ 2026-06-08 실측 보강 |
| send_channel | varchar(20) | ★ 실측 |
| send_phase | varchar(20) | ★ 실측 (발송 단계) |
| send_config | jsonb | ★ 실측 |
| staging_id | uuid | ★ 실측 (직접발송 staging) |
| processed_count | integer | ★ 실측 |
| result_final | boolean | ★ 실측 (D228+ 발송결과 캐시 확정) |
| result_synced_at | timestamptz | ★ 실측 |
| kakao_bubble_type | varchar(20) | ★ 실측 |
| kakao_sender_key | varchar | ★ 실측 |
| kakao_targeting | char(1) | ★ 실측 |
| kakao_attachment_json | text | ★ 실측 |
| kakao_carousel_json | text | ★ 실측 |
| kakao_resend_type | varchar(20) | ★ 실측 |
| use_individual_callback | boolean | ★ 실측 |
| individual_callback_column | varchar | ★ 실측 |

### companies (고객사)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| name | varchar(100) | |
| company_name | varchar(100) | |
| company_code | varchar(20) | |
| business_number | varchar(20) | 사업자번호 |
| business_type | varchar(50) | |
| ceo_name | varchar(50) | |
| brand_name | varchar(100) | |
| brand_slogan | varchar(200) | |
| brand_description | text | |
| brand_tone | varchar(50) | |
| contact_name | varchar(50) | |
| contact_email | varchar(100) | |
| contact_phone | varchar(20) | |
| address | text | |
| manager_phone | varchar(20) | |
| manager_contacts | jsonb | |
| opt_out_080_number | varchar(20) | 수신거부 번호 |
| reject_number | varchar(20) | |
| sender_number_preregistered | boolean | |
| status | varchar(20) | active 등 |
| plan_id | uuid FK | |
| trial_expires_at | timestamp | |
| monthly_budget | numeric(12,2) | 요금 |
| cost_per_sms | numeric(6,2) | |
| cost_per_lms | numeric(6,2) | |
| cost_per_mms | numeric(6,2) | |
| cost_per_kakao | numeric(6,2) | |
| billing_type | varchar(20) | postpaid/prepaid (기본 postpaid) |
| balance | numeric(15,2) | 선불 잔액 (기본 0) |
| deposit_account_info | text | 무통장입금 계좌 안내 |
| send_start_hour | integer | 기본 9 |
| send_end_hour | integer | 기본 21 |
| daily_limit | integer | |
| daily_limit_per_customer | integer | |
| holiday_send_allowed | boolean | |
| duplicate_prevention_days | integer | 기본 7 |
| cross_category_allowed | boolean | |
| target_strategy | varchar(50) | AI 설정 |
| excluded_segments | text | |
| approval_required | boolean | 승인 |
| approver_email | varchar(100) | |
| use_db_sync | boolean | 데이터 |
| use_file_upload | boolean | |
| data_input_method | varchar(20) | |
| db_name | varchar(100) | |
| customer_schema | jsonb | |
| enabled_fields | jsonb | |
| test_contact_mode | varchar(20) | |
| store_code_list | jsonb | |
| basic_analysis_url | varchar(400) | |
| premium_analysis_enabled | boolean | |
| premium_analysis_url | varchar(400) | |
| print_url | varchar(400) | |
| alarm_threshold | integer | |
| use_product_category_large | boolean | |
| use_product_category_medium | boolean | |
| use_product_category_small | boolean | |
| api_key | varchar(100) | ★ 싱크에이전트 인증 전용 (CDP 아님) |
| api_secret | varchar(100) | ★ 싱크에이전트 인증 전용 (CDP 아님) |
| cdp_api_key | varchar(100) | ★ D172 (CDP 전용 public key — 자사몰 클라이언트 호출 식별) |
| cdp_api_secret_hash | varchar(255) | ★ D172 (CDP server-side 인증 bcrypt 해시 — raw 1회 노출 후 미저장) |
| cdp_api_key_issued_at | timestamptz | ★ D172 (CDP key 발급 시각) |
| auto_campaign_override | integer | 자동발송 회사별 오버라이드 (NULL=플랜따름, 0=비활성, 1+=허용건수) |
| ai_usage_threshold_config | jsonb | ★ D217+ (2026-05-25) — AI 사용량 한도 알림 설정 `{ enabled, threshold_percent: 50\|80\|95, channels: ['email','sms','inapp'], updated_at }` (기본 `{}`) |
| max_users | integer | 최대 사용자 수 (기본 5) |
| session_timeout_minutes | integer | 세션 타임아웃 분 (기본 30) |
| ai_credits_base_remaining | integer | ★ D227+ 종량제: 이번 달 남은 기본 크레딧 (매월 리셋, DEFAULT 0 NOT NULL) |
| ai_credits_purchased | integer | ★ D227+ 종량제: 구매분 크레딧 잔액 (이월, DEFAULT 0 NOT NULL) |
| ai_credits_reset_at | timestamptz | ★ D227+ 종량제: 마지막 월 리셋 시각 (KST 월 기준) |
| ai_credits_monthly_cap | integer | ★ D227+ 종량제: 자동충전 월 상한 (NULL=무제한, 0=자동차감 끔). Phase 1=컬럼만 |
| created_by | uuid | |
| created_at | timestamp | |
| updated_at | timestamp | |
| service_type | varchar | ★ 2026-06-08 실측 보강 |
| subscription_status | varchar | ★ 실측 |
| plan_notified_code | varchar(20) | ★ 2026-07-06 추가 (ALTER) — 요금제 변경 안내 1회 노출용. 마지막 안내한 plan_code(localStorage 비교 대체). NULL=현재 값으로 조용히 초기화 |
| line_group_id | uuid | ★ 실측 (발송 라인그룹) |
| kakao_enabled | boolean | ★ 실측 |
| billing_cycle_start | integer | ★ 실측 |
| billing_cycle_type | varchar | ★ 실측 |
| cost_per_test_sms | numeric | ★ 실측 |
| cost_per_test_lms | numeric | ★ 실측 |
| cost_per_spam_filter | numeric | ★ 실측 |
| business_category | varchar | ★ 실측 |
| business_item | varchar | ★ 실측 |
| allow_callback_self_register | boolean | ★ 실측 |
| opt_out_auto_sync | boolean | ★ 실측 |
| brand_kit | jsonb | ★ 실측 |
| ai_mapping_calls_month | integer | ★ 실측 |
| ai_mapping_last_month | varchar | ★ 실측 |
| user_isolation_enabled | boolean | ★ 실측 |
| cdp_auto_execute_enabled | boolean | ★ 실측 (자동마케팅 C게이트) |
| cdp_auto_execute_max_recipients | integer | ★ 실측 |
| cdp_auto_execute_max_cost_krw | integer | ★ 실측 |
| cdp_auto_execute_max_risk | varchar | ★ 실측 |
| cdp_allowed_origins | text[] | ★ 실측 (CDP CORS) |
| cdp_allowed_app_ids | text[] | ★ 2026-06-18 실측 (CDP 네이티브 앱 키 인증 허용 번들ID — cdp_allowed_origins의 앱 버전) |
| voice_inbound_enabled | boolean | ★ 실측 |
| use_ai_orchestrator | boolean | ★ 실측 |
| legacy_grandfathered | boolean | ★ 실측 |
| first_signup_discount_until | timestamptz | ★ 실측 (오픈 기념 구독할인) |
| predictive_enabled | boolean | ★ 실측 (자율예측 게이트) |
| postpaid_overage_limit | integer | ★ 실측 |
| onboarding_progress | jsonb | ★ 실측 |
| ai_operator_trial_started_at | timestamptz | ★ 실측 |
| ai_operator_trial_until | timestamptz | ★ 실측 |
| smtp_host | varchar | ★ 실측 (회사 SMTP 발신) |
| smtp_port | integer | ★ 실측 |
| smtp_user | varchar | ★ 실측 |
| smtp_password_encrypted | text | ★ 실측 |
| smtp_secure | boolean | ★ 실측 |
| smtp_from_email | varchar | ★ 실측 |
| smtp_from_name | varchar | ★ 실측 |
| send_hour_start | integer | ★ 실측 레거시(send_start_hour 우선) |
| send_hour_end | integer | ★ 실측 레거시(send_end_hour 우선) |
| holiday_send | boolean | ★ 실측 레거시(holiday_send_allowed 우선) |
| duplicate_days | integer | ★ 실측 레거시(duplicate_prevention_days 우선) |
| usage_type | varchar(10) | ★ 2026-07-03 실측 (사용구분: web/agent/both, NOT NULL DEFAULT 'web' + CHECK. agent=QTmsg 에이전트 전용 게이팅) |

### company_agent_ids (에이전트 발송ID 매핑 — 2026-07-03 신설 실측)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK DEFAULT gen_random_uuid() |
| company_id | uuid FK → companies ON DELETE CASCADE |
| agent_send_id | varchar(100) NOT NULL UNIQUE (QTmsg 발송ID — 전역 유일, 역매핑용) |
| memo | varchar(200) |
| created_at | timestamptz NOT NULL DEFAULT NOW() |
- INDEX idx_company_agent_ids_company (company_id)

### company_settings (고객사 설정 KV)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| setting_key | varchar(100) |
| setting_value | text |
| setting_type | varchar(20) |
| description | varchar(500) |
| created_at | timestamp |
| updated_at | timestamp |

### consents (수신 동의)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| customer_id | uuid FK |
| channel | varchar(20) |
| consent_type | varchar(20) |
| status | varchar(20) |
| consented_at | timestamptz |
| revoked_at | timestamptz |
| source | varchar(30) |
| source_detail | text |
| consent_text | text |
| proof_ref | varchar(200) |
| collected_by_user_id | uuid FK |
| created_at | timestamptz |
| updated_at | timestamptz |

### customer_field_definitions (고객 필드 정의)
> **⚠️ 쓰기 진입점:** CT-07 `upsertCustomFieldDefinitions()` (standard-field-map.ts) — 인라인 INSERT/UPDATE 절대 금지.
> ON CONFLICT (company_id, field_key) DO UPDATE로 항상 최신 라벨 유지 (D73: "최초 등록 우선" 정책 폐기).

| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| field_key | varchar(50) |
| field_label | varchar(100) |
| field_type | varchar(20) |
| field_size | integer |
| search_popup_type | varchar(30) |
| is_key | boolean |
| is_hidden | boolean |
| display_order | integer |
| created_at | timestamp |
- UNIQUE: (company_id, field_key)

### customers (고객)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| phone | varchar(20) |
| name | varchar(100) |
| gender | varchar(10) |
| birth_date | date |
| birth_year | integer |
| birth_month_day | varchar(10) |
| age | integer |
| email | varchar(100) |
| address | text |
| region | varchar(100) |
| grade | varchar(50) |
| store_phone | varchar(20) |
| points | integer |
| store_code | varchar(50) |
| store_name | varchar(100) |
| registered_store | varchar(100) |
| registered_store_number | varchar(50) |
| registration_type | varchar(50) |
| callback | varchar(20) |
| recent_purchase_date | date |
| recent_purchase_amount | numeric(15,2) |
| recent_purchase_store | varchar(100) |
| last_purchase_date | varchar(20) |
| total_purchase_amount | numeric(15,2) |
| total_purchase | numeric(12,2) |
| purchase_count | integer |
| avg_order_value | numeric |
| ltv_score | integer |
| wedding_anniversary | date |
| is_married | boolean |
| sms_opt_in | boolean |
| is_opt_out | boolean |
| is_invalid | boolean |
| is_active | boolean |
| custom_fields | jsonb |
| source | varchar(20) |
| uploaded_by | uuid FK (users.id) | 업로드한 사용자 ID |
| created_at | timestamp |
| updated_at | timestamp |
| customer_code | varchar(50) | ★ 2026-06-08 실측 보강 |
| email_opt_in | boolean | ★ 실측 |
| last_activity_at | timestamptz | ★ 실측 |
| active_sources | jsonb | ★ 실측 (CDP 다중 소스) |
| primary_source | varchar | ★ 실측 |
| preferred_channel | varchar | ★ 실측 |
| source_priority_resolved | varchar | ★ 실측 |
| last_cart_add_at | timestamptz | ★ 실측 (CDP 행동) |
| cart_add_count_30d | integer | ★ 실측 |
| last_wishlist_add_at | timestamptz | ★ 실측 |
| wishlist_add_count_30d | integer | ★ 실측 |
| last_page_view_at | timestamptz | ★ 실측 |
- UNIQUE: (company_id, COALESCE(store_code,'__NONE__'), phone)
- INDEX: uploaded_by
- INDEX: **idx_customers_active_smsable** (company_id, store_code) WHERE is_active=true AND sms_opt_in=true — ★ D150-3 (2026-05-10) 자동발송 worker `runAutoCampaignWorker` D-day 발송 + customer-filter 매 회차 SELECT 시 활성 SMS 가능 고객 부분 인덱스. 1만+ 고객 회사에서 풀스캔 → Bitmap Index Scan 전환.

### file_uploads (파일 업로드)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| user_id | uuid FK |
| original_filename | varchar(255) |
| stored_filename | varchar(255) |
| file_size | integer |
| file_type | varchar(20) |
| total_rows | integer |
| success_rows | integer |
| fail_rows | integer |
| column_mapping | jsonb |
| status | varchar(20) |
| error_message | text |
| created_at | timestamptz |
| completed_at | timestamptz |

### kakao_sender_profiles (카카오 발신 프로필)
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | |
| profile_key | varchar(100) | IMC senderKey |
| profile_name | varchar(100) | 내부 관리명 |
| is_active | boolean | |
| created_at | timestamp | |
| **yellow_id** | varchar(50) | **D130: 카카오 채널 ID(@시작)** |
| **admin_phone_number** | varchar(20) | **D130: 채널 관리자 휴대폰** |
| **category_code** | varchar(11) | **D130: 11자리(대+중+소)** |
| **category_name_cache** | varchar(255) | **D130: 표시명 캐시** |
| **top_sender_yn** | char(1) DEFAULT 'N' | **D130: 최상위 발신 여부** |
| **custom_sender_key** | varchar(40) | **D130: 고객사 지정 키** |
| **status** | varchar(20) DEFAULT 'PENDING' | **D130: PENDING/NORMAL/BLOCKED/DELETED/DORMANT. 2026-06-17 실측: IMC sync 후 'A'(정상) 저장 — 휴면/차단은 block_yn/dormant_yn으로 판정** |
| **unsubscribe_phone** | varchar(15) | **D130: 080 무료수신거부 번호** |
| **unsubscribe_auth** | varchar(10) | **D130: 080 인증번호** |
| **marketing_agree_file_key** | varchar(100) | **D130: 광고동의 증적 파일 키** |
| **brand_targeting_yn** | char(1) DEFAULT 'N' | **D130: 브랜드 M/N 타겟팅 사용 여부** |
| **registered_at** | timestamptz | **D130: 등록 시각** |
| **updated_at** | timestamptz DEFAULT now() | **D130: 최종 갱신** |
| **block_yn** | char(1) DEFAULT 'N' | **2026-06-17: IMC 차단 여부 (syncSenderStatusJob 동기화)** |
| **dormant_yn** | char(1) DEFAULT 'N' | **2026-06-17: IMC 휴면 여부** |
| **brand_message_yn** | char(1) DEFAULT 'N' | **2026-06-17: IMC 브랜드메시지 사용 여부 (brand_targeting_yn과 별개)** |
| **channel_created_at** | timestamptz | **2026-06-17: 카카오 채널 생성일 (IMC createdAt)** |

인덱스: `idx_ksp_company_status(company_id, status)`, `idx_ksp_yellow_id(company_id, yellow_id) UNIQUE WHERE yellow_id IS NOT NULL`

### kakao_templates (카카오 알림톡 템플릿) — D130 IMC 확장 + D135 검수알림
> **D130 신규 컬럼 14개 (nullable):** `template_key`, `custom_template_code`, `emphasize_subtitle`, `template_header`, `item_highlight(jsonb)`, `item_list(jsonb)`, `item_summary(jsonb)`, `represent_link(jsonb)`, `preview_message`, `alarm_phone_numbers`, `service_mode(PRD/STG)`, `image_name`, `highlight_image_name`, `last_synced_at`.
> **D135 추가 컬럼 1개 (nullable):** `alarm_notified_status varchar(10)` — 마지막 담당자 SMS 알림 발송 상태(APPROVED/REJECTED). IMC createAlarmUser 권한(4032) 이슈로 한줄로가 직접 `syncPendingTemplatesJob`에서 발송. 중복 알림 차단용.
> **인덱스:** `idx_kt_company_template_key UNIQUE`, `idx_kt_status`, `idx_kt_profile_id`.

| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| profile_id | uuid FK |
| template_code | varchar(50) |
| template_name | varchar(100) |
| content | text |
| buttons | jsonb |
| variables | text[] |
| status | varchar(20) |
| reject_reason | text |
| created_at | timestamp |
| updated_at | timestamp |
| approved_at | timestamp |
| category | varchar(50) |
| message_type | varchar(10) DEFAULT 'BA' |
| emphasize_type | varchar(20) DEFAULT 'NONE' |
| emphasize_title | varchar(50) |
| image_url | text |
| extra_content | text |
| ad_content | varchar(100) |
| security_flag | boolean DEFAULT false |
| quick_replies | jsonb DEFAULT '[]' |
| requested_at | timestamptz |
| reviewed_at | timestamptz |
| reviewed_by | uuid |
| alarm_notified_status | varchar(10) NULL — D135+ |
| imc_template_status | varchar(10) NULL — ★ 2026-06-10 신설(CT-87) → **2026-06-11 정의 정정(휴머스온 공식)**: S=중지 / A=정상 / R=대기(발송 전 — 첫 발송 시 자동 A 전환, **차단 사유 아님**). 검수상태(status)와 별개. 79738 7300의 진짜 원인은 R이 아니라 대표링크(represent_link) 발송 미동봉이었음 — CT-87의 R 차단은 신규 템플릿 첫 발송을 영구 차단하는 역효과라 해제 정정 의무(미배포). 동기화 = 30분 워커 syncTemplateStatuses + 5분 job + 단건 GET. ALTER 미실행 상태(2026-06-11 운영 실측 — 컬럼 없음, 가드는 null 안전 통과). 실행 SQL: `ALTER TABLE kakao_templates ADD COLUMN IF NOT EXISTS imc_template_status varchar(10);` |

### kakao_friendtalk_images (카카오 친구톡 이미지, 레거시)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK |
| image_name | varchar(200) |
| image_url | varchar(500) |
| original_filename | varchar(200) |
| file_size | integer |
| width | integer |
| height | integer |
| status | varchar(20) |
| created_at | timestamp |
| processed_at | timestamp |

> **D130 이후:** 알림톡/브랜드메시지 IMC 이미지 업로드는 `kakao_image_uploads` 사용. 이 테이블은 레거시 호환용으로 유지.

### brand_message_templates (브랜드메시지 템플릿, D130 신설)
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK → companies(id) ON DELETE CASCADE | |
| profile_id | uuid FK → kakao_sender_profiles(id) ON DELETE CASCADE | |
| template_key | varchar(128) NOT NULL | IMC templateKey |
| custom_template_code | varchar(30) | 고객사 관리코드 |
| manage_name | varchar(30) NOT NULL | 관리명 |
| chat_bubble_type | varchar(20) NOT NULL | TEXT/IMAGE/WIDE/WIDE_ITEM_LIST/CAROUSEL_FEED/PREMIUM_VIDEO/COMMERCE/CAROUSEL_COMMERCE |
| adult_yn | char(1) DEFAULT 'N' | 성인용 여부 |
| header | varchar(20) | WIDE_ITEM_LIST 필수 |
| content | text | 타입별 글자수 상이 |
| additional_content | varchar(34) | COMMERCE 전용 |
| attachment | jsonb | {image/video/commerce/item} |
| carousel | jsonb | {head, list[], tail} |
| buttons | jsonb DEFAULT '[]' | |
| coupon | jsonb | |
| variables | text[] DEFAULT ARRAY[]::text[] | 최대 20개 |
| status | varchar(20) DEFAULT 'ACTIVE' | ACTIVE/DELETED (검수 없음) |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| deleted_at | timestamptz | |

인덱스: `idx_bmt_company_template_key(company_id, template_key) UNIQUE`, `idx_bmt_company_status`, `idx_bmt_profile_id`

### kakao_alarm_users (알림톡 검수 알림 수신자, D130 신설)
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK ON DELETE CASCADE | |
| name | varchar(30) | 선택 |
| phone_number | varchar(20) NOT NULL | |
| active_yn | char(1) DEFAULT 'Y' | |
| imc_alarm_user_id | varchar(50) | IMC alarmUserId |
| created_at | timestamptz | |
| updated_at | timestamptz | |

인덱스: `idx_kau_company_active(company_id, active_yn)`, `idx_kau_company_phone(company_id, phone_number) UNIQUE`

### kakao_sender_categories (발신프로필 카테고리 캐시, D130 신설)
| 컬럼 | 타입 | 비고 |
|------|------|------|
| category_code | varchar(11) PK | 11자리 |
| parent_code | varchar(11) | |
| level | smallint | 1(대)/2(중)/3(소) |
| name | varchar(100) | |
| active_yn | char(1) DEFAULT 'Y' | |
| synced_at | timestamptz | 매일 03:00 KST |

인덱스: `idx_ksc_parent(parent_code, level)`

### kakao_template_categories (템플릿 카테고리 캐시, D130 신설)
> **D131 후속 확장:** IMC 실제 응답에 `groupName` (대분류) + `inclusion`/`exclusion` (UX 가이드)가 포함됨. 3컬럼 추가로 2단 드롭다운(대분류→소분류) UI + 카테고리 선택 가이드 표시 가능.

| 컬럼 | 타입 | 비고 |
|------|------|------|
| category_code | varchar(6) PK | 6자리 (예: `001001`) |
| name | varchar(100) | 소분류 이름 (예: `회원가입`) |
| **group_name** | varchar(30) | **대분류 이름 (예: `회원`, `구매`, `예약`) — D131 추가** |
| **inclusion** | text | **카테고리 포함 대상 설명 (UX 가이드) — D131 추가** |
| **exclusion** | text | **카테고리 제외 대상 설명 (UX 가이드) — D131 추가** |
| active_yn | char(1) DEFAULT 'Y' | |
| synced_at | timestamptz | |

인덱스: `idx_ktc_group_name(group_name)`

### kakao_webhook_events (IMC 웹훅 이벤트, D130 신설 — idempotency)
| 컬럼 | 타입 | 비고 |
|------|------|------|
| event_id | uuid PK | **IMC eventId — 중복 차단 보장** |
| batch_id | uuid | |
| server_key | varchar(100) | |
| message_key | varchar(128) | CR_/DS_/TS_/AC_ 접두사 |
| report_type | varchar(10) | SM/LM/MM/AT/FT/RCS |
| report_code | varchar(10) | |
| resend | boolean DEFAULT false | 부달 여부 |
| received_at | timestamptz | IMC 표기 시각 |
| net_info | varchar(20) | |
| processed_at | timestamptz DEFAULT now() | |
| process_status | varchar(20) DEFAULT 'PENDING' | PENDING/OK/FAILED |
| error_message | text | |
| raw_payload | jsonb NOT NULL | 원본 payload 보존 |

인덱스: `idx_kwe_message_key`, `idx_kwe_batch_id`, `idx_kwe_status WHERE process_status != 'OK'`

### kakao_image_uploads (IMC 이미지 업로드 캐시, D130 신설)
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | |
| user_id | uuid FK | |
| upload_type | varchar(30) NOT NULL | alimtalk_template/alimtalk_highlight/brand_default/brand_wide/brand_wide_list_first/brand_wide_list/brand_carousel_feed/brand_carousel_commerce/marketing_agree |
| image_name | varchar(100) NOT NULL | IMC 반환 파일명 |
| image_url | varchar(500) NOT NULL | IMC 반환 URL |
| original_filename | varchar(200) | |
| file_size | integer | bytes |
| width | integer | |
| height | integer | |
| ratio | numeric(6,4) | 세로/가로 |
| created_at | timestamptz | |
| expired_at | timestamptz | IMC 만료 시점 (있을 시) |

인덱스: `idx_kiu_company_type(company_id, upload_type)`

### messages (메시지) — 월별 파티션 (messages_2026_01~12)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| project_id | uuid FK |
| user_id | uuid FK |
| message_type | varchar(10) |
| recipient_phone | varchar(20) |
| recipient_name | varchar(100) |
| merge_data | jsonb |
| sender_number | varchar(20) |
| reply_number | varchar(20) |
| subject | varchar(200) |
| content | text |
| content_merged | text |
| template_id | uuid FK |
| kakao_profile_id | uuid FK |
| kakao_buttons | jsonb |
| fallback_enabled | boolean |
| fallback_message_id | uuid |
| scheduled_at | timestamp |
| send_rate_per_minute | integer |
| status | varchar(20) |
| result_code | varchar(20) |
| result_message | text |
| sent_at | timestamp |
| delivered_at | timestamp |
| charge_amount | numeric(10,2) |
| created_at | timestamp |
| updated_at | timestamp |

### mobile_dm_requests (모바일 DM 요청)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK |
| dm_sample_id | varchar(50) |
| request_note | text |
| completed_url | varchar(500) |
| status | varchar(20) |
| created_at | timestamp |
| completed_at | timestamp |

### dm_pages (모바일 DM 빌더 — D119/D125/D216+) ★ D216+ 갱신
> **D125 마이그레이션 (옛 누락 보강) + D216+ 4 컬럼 추가.**
> 한줄로 PRO+ 요금제 모바일 DM 빌더 핵심 테이블. 옛 slides 기반 (D119) + 신규 sections 기반 (D125) 동시 지원.

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | |
| created_by | uuid FK | users.id |
| title | varchar(200) | |
| store_name | varchar(100) | |
| header_template | varchar(50) | D119 default/v2 등 |
| footer_template | varchar(50) | D119 |
| header_data | jsonb | D119 |
| footer_data | jsonb | D119 |
| pages | jsonb | D119 DmSlide[] 또는 D128 DmPageGroup[] |
| settings | jsonb | |
| short_code | varchar(20) | 단축URL (UNIQUE) |
| status | varchar(20) | draft/published |
| view_count | integer | |
| **layout_mode** | **varchar(20)** | **D125: scroll/slides/scroll_snap** |
| **sections** | **jsonb** | **D125 Section[]** |
| **brand_kit** | **jsonb** | **D125 BrandKit 토큰** |
| **template_id** | **text** | **D125 템플릿 참조** |
| **ai_prompt** | **text** | **D125 자연어 프롬프트 원문** |
| **validation_result** | **jsonb** | **D125 옛 검수 결과 (10 영역 × 3등급)** |
| **approval_status** | **varchar(20)** | **D125 draft/review/approved/published/rejected** |
| **event_type** | **varchar(30)** | **★ D216+ — lucky_draw/roulette/instant_coupon 등** |
| **personalization_strategy** | **jsonb** | **★ D216+ — Liquid 변수 자동 추천 설정** |
| **quick_start_scenario** | **varchar(30)** | **★ D216+ — 빠른 시작 시나리오** |
| **last_diagnosed_at** | **timestamptz** | **★ D216+ — CT-86 자율 진단 최근 시각** |
| created_at | timestamp | |
| updated_at | timestamp | |

### dm_versions (DM 버전 관리 — D125)
> **옛 D125 §13 — SCHEMA.md 영구 누락 영역 보강 (D216+ 진입 직전 추가).**

| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| dm_id | uuid FK | dm_pages.id ON DELETE CASCADE |
| version_label | text |
| version_number | integer |
| sections | jsonb |
| brand_kit | jsonb |
| note | text |
| created_by | uuid FK | users.id |
| created_at | timestamptz |

### dm_templates (DM 템플릿 갤러리 — D125)
> **옛 D125 §13 — SCHEMA.md 영구 누락 영역 보강 (D216+ 진입 직전 추가).**

| 컬럼 | 타입 |
|------|------|
| id | text PK |
| category | text |
| industry | text |
| name | text |
| description | text |
| thumbnail_url | text |
| sections | jsonb |
| brand_kit | jsonb |
| popularity | integer |
| is_active | boolean |
| created_at | timestamptz |

### dm_views (DM 열람 추적 — D119/D125) ★ 2026-07-02 실측 재기록 + 수신자 추적 3컬럼 ALTER
> 2026-07-02 information_schema 실측: id=bigint(uuid 아님)·ip=inet(varchar 아님)·ab_test_id/ab_variant 존재(기존 문서 누락).
> 같은 날 수신자별 추적 근본 수정 ALTER 3컬럼(recipient_token/anonymous_id/max_scroll_pct) 추가.
> 기록 방식: 뷰어 비콘 UPSERT(키 우선순위 token > phone > anonymous_id) — 열람자 1인 = 1행 누적(duration 합산·scroll GREATEST·sections 병합).

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | bigint PK | 실측 (uuid 아님) |
| dm_id | uuid FK | dm_pages.id ON DELETE CASCADE |
| company_id | uuid FK | |
| phone | varchar | 토큰으로 서버가 확정한 고객 phone (구 ?p= 링크 하위호환) |
| page_reached | integer | |
| total_pages | integer | |
| duration_seconds | integer | 비콘 증가분 합산 (총 체류) |
| ip | inet | 실측 (varchar 아님 — 문자열 그대로 INSERT 가능) |
| user_agent | text | |
| viewed_at | timestamptz | 최초 열람 |
| last_active_at | timestamptz | 마지막 비콘 |
| section_interactions | jsonb | D125 — 섹션별 {views, clicks, elements?} (07-02(5) elements = 버튼·링크 라벨별 클릭 카운트 {"쿠폰 사용하기":2}). ★ 07-02(5) 진짜 적재 개시 = 공개 라우터 본문 파서 유실 수정 후부터(LESSONS_BACKEND 2026-07-02 항목) |
| ab_test_id | uuid | 실측 보강 (기존 문서 누락) |
| ab_variant | varchar | 실측 보강 (기존 문서 누락) |
| **recipient_token** | **text** | **★ 2026-07-02 ALTER — 발송 수신자 토큰(추적 1급 키)** |
| **anonymous_id** | **varchar(100)** | **★ 2026-07-02 ALTER — 뷰어 localStorage 익명 키** |
| open_count | integer NOT NULL DEFAULT 1 | ★ 2026-07-06 ALTER — 재열람 횟수(진입 비콘마다 +1) |
| seen_anon_ids | jsonb | ★ 2026-07-06 ALTER — 열람 기기 익명ID 배열(최대 20 — 공유 신호) |
| **max_scroll_pct** | **integer** | **★ 2026-07-02 ALTER — 스크롤 최대 도달 %(0~100), NULL=미측정** |
- INDEX: idx_dm_views_token (dm_id, recipient_token) WHERE recipient_token IS NOT NULL ★ 2026-07-02
- INDEX: idx_dm_views_anon (dm_id, anonymous_id) WHERE anonymous_id IS NOT NULL ★ 2026-07-02

### dm_recipient_tokens (DM 수신자별 토큰 — 발송 고객 1급 연결) ★ 2026-07-03 information_schema 실측 기록
> 0702 수신자 추적 작업 신설분. DM 발송 시 고객별 토큰 발급(dm.ts → dm-recipient-token.ts) — "DM 발송 고객 명단"의 원천. 성과리포트 고객 축이 발송 집합으로 사용.

| 컬럼 | 타입 |
|------|------|
| token | varchar PK |
| dm_id | uuid |
| customer_id | uuid |
| company_id | uuid |
| created_at | timestamptz |
| expires_at | timestamptz |
| short_code | varchar(12) UNIQUE(부분 인덱스) — ★ 2026-07-06 추가 (ALTER) — hlj.kr 단축링크 코드(base62 8자). NULL=단축 미발급(긴 링크) |

### dm_event_responses (DM 이벤트 응답 누적) ★ D216+ 신설
> **신규 16 섹션 (poll / survey / email_capture / lucky_draw / roulette 등) 인터랙션 누적.**

| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK | companies.id ON DELETE CASCADE |
| campaign_id | uuid FK | dm_pages.id ON DELETE CASCADE |
| section_id | uuid |
| section_type | varchar(30) |
| customer_id | uuid FK NULL | customers.id ON DELETE SET NULL |
| anonymous_id | varchar(100) |
| response_data | jsonb |
| ip_address | varchar(45) |
| user_agent | text |
| occurred_at | timestamptz |
| created_at | timestamptz |
- INDEX: (company_id, campaign_id, occurred_at DESC)
- INDEX: (section_id, section_type)
- INDEX: (customer_id) WHERE customer_id IS NOT NULL
- UNIQUE: uniq_dm_response_per_user (campaign_id, section_id, COALESCE(customer_id::text, anonymous_id)) WHERE COALESCE(...) IS NOT NULL — ★ B 2026-06-14 1인1회 응모

### dm_prizes (DM 인터랙션 경품/등급/재고) ★ B 2026-06-14 신설·실측
> 룰렛/추첨 경품. win_method = random(마감추첨) | preset(엑셀지정) | roulette. roulette_segment_id로 룰렛 세그먼트 매핑.

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | companies.id ON DELETE CASCADE |
| campaign_id | uuid FK | dm_pages.id ON DELETE CASCADE |
| section_id | uuid NOT NULL | |
| rank | integer NOT NULL | |
| name | text NOT NULL | |
| total_count | integer NOT NULL | |
| remaining | integer NOT NULL | 룰렛 실시간 차감 |
| win_method | varchar(20) NOT NULL | |
| roulette_segment_id | varchar(20) | |
| reward_code_pool | jsonb | |
| created_at | timestamptz | |
- INDEX: idx_dm_prizes_campaign (campaign_id, section_id)

### dm_winners (DM 당첨자) ★ B 2026-06-14 신설·실측
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | companies.id ON DELETE CASCADE |
| campaign_id | uuid FK | dm_pages.id ON DELETE CASCADE |
| section_id | uuid | |
| prize_id | uuid FK | dm_prizes.id ON DELETE SET NULL |
| response_id | uuid FK | dm_event_responses.id ON DELETE SET NULL |
| customer_id | uuid FK | customers.id ON DELETE SET NULL |
| rank | integer | |
| win_method | varchar(20) NOT NULL | random/preset/roulette |
| winner_name / winner_phone / winner_email | text | |
| is_member | boolean NOT NULL DEFAULT false | |
| reward_code | text | |
| notified_at | timestamptz | F/G 당첨 통보 발송 시각 |
| drawn_at / created_at | timestamptz | |
- INDEX: idx_dm_winners_campaign (campaign_id, rank)
- UNIQUE: uniq_dm_winners_response (response_id) WHERE response_id IS NOT NULL

### dm_draw_runs (DM 마감추첨 claim·시드 감사) ★ B 2026-06-14 신설·실측
> 워커 원자적 claim(중복 추첨 차단) + 추첨 시드 감사.

| 컬럼 | 타입 | 비고 |
|------|------|------|
| campaign_id | uuid PK | dm_pages.id ON DELETE CASCADE |
| section_id | uuid | |
| seed | text NOT NULL | |
| entry_count / winner_count | integer NOT NULL DEFAULT 0 | |
| drawn_at | timestamptz NOT NULL DEFAULT NOW() | |

### opt_outs (수신거부 — user_id 기준)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK NOT NULL |
| opt_out_number | varchar(20) |
| phone | varchar(20) |
| source | varchar(20) |
| created_at | timestamp |
- UNIQUE: (user_id, phone)

### opt_out_sync_logs (수신거부 동기화 로그)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| sync_type | varchar(20) |
| total_count | integer |
| added_count | integer |
| removed_count | integer |
| status | varchar(20) |
| error_message | text |
| started_at | timestamp |
| completed_at | timestamp |

### plans (요금제) — CT-17 확장 (2026-04-22)
> **CT-17 정책 (2026-04-22 Harold님 확정):**
> - FREE(미가입) = 레거시 이관 고객 중 유료 미가입 상태. 직접발송·수신거부·발송결과·예약(직접) + 직접발송 주소록 99,999건까지. 나머지 전부 잠금.
> - STARTER+ = 고객DB·직접타겟발송·AI 자동매핑·스팸필터 수동 테스트
> - BASIC+ = AI 메시지·AI 타겟·엑셀AI매핑(generateMessages/recommendTarget/parseBriefing)
> - PRO+ = 자동발송·모바일DM·AI 프리미엄(auto-relax 등)·스팸자동화
> - 판정은 plans 플래그가 진실의 원천. plan_code 하드코딩 금지 (`utils/plan-guard.ts` 경유).

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| plan_code | varchar(20) | FREE/**TRIAL**/STARTER/BASIC/PRO/BUSINESS/ENTERPRISE (D132 TRIAL 추가) |
| plan_name | varchar(50) | FREE="미가입", **TRIAL="무료체험"** (PRO와 기능 동일, D132) |
| max_customers | integer | 고객DB 관리 최대 인원 |
| monthly_price | numeric(12,2) | |
| is_active | boolean | |
| trial_days | integer | |
| ai_analysis_level | varchar(20) | none/basic/advanced (기본 none) |
| customer_db_enabled | boolean | 고객DB 업로드·관리·필터·조회. FREE=false, STARTER+ true |
| **target_send_enabled** | **boolean DEFAULT false** | **CT-17: 직접타겟발송(필터 추출 발송). STARTER+ true** |
| **ai_mapping_enabled** | **boolean DEFAULT false** | **CT-17: 엑셀 업로드 AI 자동매핑. STARTER+ true** |
| spam_filter_enabled | boolean | 스팸필터 수동 테스트. FREE=false, STARTER+ true |
| ai_messaging_enabled | boolean | AI 메시지 생성/AI 타겟 추천/엑셀AI매핑. BASIC+ true |
| auto_campaign_enabled | boolean | 자동발송. PRO+ true |
| max_auto_campaigns | integer | 동시 활성 자동캠페인 (PRO:5, BUSINESS:10, ENTERPRISE:NULL=무제한) |
| auto_spam_test_enabled | boolean DEFAULT false | 자동 스팸필터 테스트. PRO+ true |
| ai_premium_enabled | boolean DEFAULT false | AI 프리미엄 (auto-relax/추천캠페인/AI문안생성). PRO+ true |
| **mobile_dm_enabled** | **boolean DEFAULT false** | **CT-17: 모바일 DM 빌더. PRO+ true** |
| **direct_recipient_limit** | **integer** | **CT-17: 직접발송 주소록 최대 건수. FREE=99,999, 나머지 NULL(무제한)** |
| **cdp_enabled** | **boolean DEFAULT false** | **★ D172: 한줄로 CDP (자사몰 → 한줄로 customers/이벤트 sync) feature 플래그. BUSINESS+ true** |
| **cdp_events_per_month** | **integer** | **★ D172: CDP API 월 호출 한도. BASIC=10,000 / PRO=100,000 / BUSINESS=1,000,000 / ENTERPRISE NULL(무제한)** |
| **ai_credits_per_month** | **integer** | **★ D227+ 종량제: 요금제별 월 기본 AI 크레딧 (NULL=0). 실 DB 기준 2026-06-02 확인: 스타터300/베이직750/프로2400/비즈7800/엔터16500 (FREE 0·TRIAL 600). 과거 설계값(스타터50 등)은 폐기 — plans row(SQL)가 진실** |
| created_at | timestamp | |

**companies 추가 컬럼 (CT-17 활용):**
- `subscription_status` varchar(20) — `null | 'trial' | 'trial_expired' | 'paid' | 'active' | 'expired' | 'suspended'`
- `trial_expires_at` timestamp — 30일 PRO 무료체험 만료 시각. `utils/trial-downgrade-worker.ts` Cron(매일 04:00 KST)이 만료 시 자동 강등.

### saved_segments (저장 세그먼트 — D107)
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | |
| user_id | uuid FK | |
| name | varchar(100) NOT NULL | 세그먼트명 |
| emoji | varchar(10) DEFAULT '📋' | 카드 아이콘 |
| segment_type | varchar(20) NOT NULL | 'hanjullo' \| 'custom' |
| prompt | text | AI 한줄로용 프롬프트 |
| auto_relax | boolean DEFAULT false | AI 조건완화 |
| selected_fields | text[] | 맞춤한줄 활용필드 |
| briefing | text | 맞춤한줄 프로모션 설명 |
| url | varchar(500) | 바코드/이벤트 링크 |
| channel | varchar(10) | SMS/LMS/MMS |
| is_ad | boolean DEFAULT false | 광고 여부 |
| last_used_at | timestamp | 최근 사용 시각 |
| created_at | timestamp | |
| updated_at | timestamp | |

### plan_requests (요금제 변경 요청)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK |
| requested_plan_id | uuid FK |
| message | text |
| status | varchar(20) |
| admin_note | text |
| processed_by | uuid |
| processed_at | timestamp |
| created_at | timestamp |

### products (상품)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| product_code | varchar(50) |
| product_name | varchar(200) |
| category_large | varchar(100) |
| category_medium | varchar(100) |
| category_small | varchar(100) |
| price | numeric(15,2) |
| is_active | boolean |
| created_at | timestamp |
| updated_at | timestamp |

### projects (프로젝트)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK |
| project_name | varchar(200) |
| analysis_start_date | date |
| analysis_end_date | date |
| total_count | integer |
| success_count | integer |
| fail_count | integer |
| created_at | timestamp |
| updated_at | timestamp |

### purchases (구매내역)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| customer_id | uuid FK |
| customer_phone | varchar(20) |
| purchase_date | timestamp |
| store_code | varchar(50) |
| store_name | varchar(100) |
| product_id | uuid FK |
| product_code | varchar(50) |
| product_name | varchar(200) |
| quantity | integer |
| unit_price | numeric(15,2) |
| total_amount | numeric(15,2) |
| custom_fields | jsonb |
| created_at | timestamp |

### rcs_templates (RCS 템플릿)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| brand_id | varchar(100) |
| brand_name | varchar(100) |
| template_id | varchar(100) |
| template_name | varchar(100) |
| message_type | varchar(20) |
| content | text |
| media_url | varchar(500) |
| buttons | jsonb |
| status | varchar(20) |
| reject_reason | text |
| created_at | timestamp |
| updated_at | timestamp |
| approved_at | timestamp |
| requested_at | timestamptz |
| reviewed_at | timestamptz |
| reviewed_by | uuid |

### sender_numbers (발신번호 관리)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK |
| phone_number | varchar(20) |
| description | varchar(200) |
| is_verified | boolean |
| is_active | boolean |
| created_at | timestamp |

### sender_number_documents (발신번호 인증서류)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| sender_number_id | uuid FK |
| document_type | varchar(50) |
| file_name | varchar(200) |
| file_path | varchar(500) |
| file_size | integer |
| status | varchar(20) |
| reject_reason | text |
| verified_at | timestamp |
| verified_by | uuid FK |
| created_at | timestamp |
| expires_at | timestamp |

### sms_templates (SMS 템플릿)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK |
| template_name | varchar(100) |
| message_type | varchar(10) |
| subject | varchar(200) |
| content | text |
| created_at | timestamp |
| updated_at | timestamp |

### standard_fields (표준 필드 정의)
| 컬럼 | 타입 |
|------|------|
| id | integer PK |
| field_key | varchar(50) |
| display_name | varchar(50) |
| category | varchar(20) |
| data_type | varchar(10) |
| description | text |
| sort_order | integer |
| is_active | boolean |
| created_at | timestamptz |

### super_admins (슈퍼 관리자)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| login_id | varchar(50) |
| password_hash | varchar(255) |
| name | varchar(100) |
| email | varchar(100) |
| role | varchar(20) |
| is_active | boolean |
| created_at | timestamp |
| last_login_at | timestamp |

### test_contacts (테스트 연락처)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK |
| name | varchar(100) |
| phone | varchar(20) |
| created_at | timestamp |

### transmission_certifications (전송 인증)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| certification_number | varchar(100) |
| certification_type | varchar(50) |
| issued_by | varchar(100) |
| issued_at | date |
| expires_at | date |
| certificate_file_path | varchar(500) |
| is_active | boolean |
| created_at | timestamp |

### unsubscribes (수신거부 — user_id 기준)
> **⚠️ 쓰기 진입점:** CT-03 `registerUnsubscribe()` (unsubscribe-helper.ts) — 인라인 INSERT 절대 금지.
> **조회:** CT-03 `getUserUnsubscribes()` — company_admin은 company_id 기준 전체 조회, brand user는 user_id 기준 조회.
> **등록 정책 (D73):** company_admin이 등록 시 → 해당 고객의 store_code에 매칭되는 brand user(들)에게 자동 배분. admin user_id로 직접 INSERT하지 않음.

| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK NOT NULL |
| phone | varchar(20) |
| source | varchar(20) — manual/upload/080_ars/080_ars_sync/db_upload |
| created_at | timestamp |
- UNIQUE: (user_id, phone)
- INDEX: company_id (080 콜백용, company_admin 전체 조회용)

### user_alarm_phones (사용자 알림 전화번호)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| user_id | uuid FK |
| phone | varchar(20) |
| is_active | boolean |
| created_at | timestamp |

### user_sender_profiles (사용자-카카오 프로필 매핑)
| 컬럼 | 타입 |
|------|------|
| user_id | uuid FK |
| profile_id | uuid FK |
| created_at | timestamp |

### user_sessions (사용자 세션)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| user_id | uuid FK |
| session_token | varchar(500) |
| ip_address | varchar(50) |
| user_agent | text |
| device_type | varchar(20) |
| is_active | boolean |
| created_at | timestamp |
| last_activity_at | timestamp |
| expires_at | timestamp |

### users (사용자)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| login_id | varchar(50) |
| password_hash | varchar(255) |
| user_type | varchar(20) |
| role | varchar(20) |
| name | varchar(100) |
| email | varchar(100) |
| phone | varchar(20) |
| department | varchar(100) |
| status | varchar(20) |
| is_active | boolean |
| must_change_password | boolean |
| password_changed_at | timestamp |
| line_group_id | uuid FK (nullable) | 사용자별 개별 라인그룹 (null이면 회사 라인그룹 사용) → sms_line_groups.id, ON DELETE SET NULL |
| opt_out_080_number | varchar(20) | 나래인터넷 080 수신거부번호 (080-XXX-XXXX). 콜백 매칭용 |
| opt_out_auto_sync | boolean | 080 수신거부 자동연동 활성화 여부 (default: false). 나래 사용 업체만 ON |
| manager_contacts | jsonb | D91: 사용자별 담당자 사전수신 정보 (브랜드별 격리). companies.manager_contacts 대신 우선 사용 |
| created_at | timestamp |
| updated_at | timestamp |
| last_login_at | timestamp |

### sync_agents (Sync Agent 등록 정보)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| agent_name | varchar(100) |
| agent_version | varchar(20) |
| os_info | varchar(100) |
| db_type | varchar(20) |
| status | varchar(20) — active/inactive/error |
| last_heartbeat_at | timestamptz |
| last_sync_at | timestamptz |
| total_customers_synced | integer |
| total_purchases_synced | integer |
| queued_items | integer |
| uptime | integer |
| ip_address | varchar(50) |
| created_at | timestamptz |
| updated_at | timestamptz |

### system_alert_state (시스템 알림 쿨다운 영속 — 2026-06-25 실측 생성)
| 컬럼 | 타입 |
|------|------|
| dedup_key | text PK — 예: agent-down:<agentId> / sync-stalled:<agentId> / queue-delay:<campaignId> |
| last_sent_at | timestamptz NOT NULL DEFAULT now() |

### sync_logs (동기화 로그)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| agent_id | uuid FK |
| company_id | uuid FK |
| sync_type | varchar(20) — customers/purchases |
| mode | varchar(20) — full/incremental |
| batch_index | integer |
| total_batches | integer |
| total_count | integer |
| success_count | integer |
| fail_count | integer |
| failures | jsonb |
| started_at | timestamptz |
| completed_at | timestamptz |
| created_at | timestamptz |

### sms_line_groups (발송 라인그룹)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| group_name | varchar(50) | 그룹명 (대량발송(1) 등) |
| group_type | varchar(20) | bulk/test/auth |
| sms_tables | text[] | 할당된 테이블 목록 |
| is_active | boolean | 활성 여부 |
| sort_order | integer | 정렬 순서 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### flyers (전단AI — 전단지)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK→companies | |
| user_id | uuid FK→users | 생성자 |
| store_code | varchar(50) | 브랜드 격리 |
| title | varchar(200) | 행사명 |
| store_name | varchar(100) | 매장명 |
| period_start | date | 행사 시작일 |
| period_end | date | 행사 종료일 |
| categories | jsonb | 카테고리+상품 배열 |
| template | varchar(50) | grid/list/highlight |
| logo_url | text | 매장 로고 |
| status | varchar(20) | draft/published |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### short_urls (전단AI — 단축URL)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| code | varchar(10) UNIQUE | 단축 코드 (hanjul-flyer.kr/{code}) |
| flyer_id | uuid FK→flyers | |
| company_id | uuid FK→companies | |
| created_at | timestamptz | |
| expires_at | timestamptz | 만료일 (기본 90일) |

### url_clicks (전단AI — 클릭 로그)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | bigserial PK | |
| short_url_id | uuid FK→short_urls | |
| clicked_at | timestamptz | |
| ip | inet | 접속 IP |
| user_agent | text | 브라우저 UA |

---

## MySQL 테이블 (QTmsg - smsdb)

### SMSQ_SEND_1~11 (SMS 발송 큐 - 11개 Agent 라인그룹 분배)
> 로컬: SMSQ_SEND (1개), 서버: SMSQ_SEND_1~11 (11개, 환경변수 SMS_TABLES + 라인그룹으로 분기)
>
> **★ D144 검증(2026-05-06):** 서버 `SMSQ_SEND`는 BASE TABLE이 아니라 **VIEW** = `SMSQ_SEND_1 UNION ALL ... SMSQ_SEND_11` 단순 가상 뷰. 한줄로AI는 SMSQ_SEND_X에 INSERT, VIEW는 모니터링 가상 표시. 한줄로AI 코드는 fallback 단일 'SMSQ_SEND'에 직접 INSERT 가능하나 서버 .env에 SMS_TABLES 명시되어 fallback 미발동. 레거시 invitoMsg watch 대상이던 base table은 D-Day 5/5에 DROP됨.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| seqno | int PK AUTO_INCREMENT | |
| dest_no | varchar(20) | 수신번호 |
| call_back | varchar(20) | 발신번호 |
| msg_contents | mediumtext | 메시지 내용 |
| msg_instm | datetime | 입력 시간 |
| sendreq_time | datetime | 발송 요청 시간 |
| mobsend_time | datetime | 발송 완료 시간 |
| repmsg_recvtm | datetime | 결과 수신 시간 |
| status_code | int | 100=대기, 200+=결과 |
| mob_company | varchar(10) | 11=SKT, 16=KT, 19=LGU+ |
| title_str | varchar(200) | LMS 제목 |
| msg_type | varchar(10) | S=SMS, L=LMS |
| rsv1 | varchar(10) | 기본 '1' |
| sender_code | varchar(9) | |
| bill_id | varchar(40) | |
| file_name1~5 | varchar(120) | MMS 첨부 |
| k_template_code | varchar(30) | 카카오 템플릿 |
| k_next_type | varchar(1) | N=없음 |
| k_next_contents | text | |
| k_button_json | varchar(1024) | |
| k_etc_json | varchar(1024) | |
| k_oriseq | varchar(20) | |
| k_resyes | varchar(1) | |
| app_etc1 | varchar(50) | campaign_run_id 저장 |
| app_etc2 | varchar(50) | |

### billing_invoices (거래내역서/정산)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | 고객사 |
| store_code | varchar(50) | 브랜드별 정산 시 매장코드 |
| store_name | varchar(100) | 브랜드별 정산 시 매장명 |
| billing_start | date | 정산 시작일 |
| billing_end | date | 정산 종료일 |
| invoice_type | varchar(20) | combined=통합, brand=브랜드별 |
| sms_success_count | integer | SMS 성공 수량 |
| sms_unit_price | numeric(6,2) | SMS 단가 |
| lms_success_count | integer | LMS 성공 수량 |
| lms_unit_price | numeric(6,2) | LMS 단가 |
| mms_success_count | integer | MMS 성공 수량 |
| mms_unit_price | numeric(6,2) | MMS 단가 |
| kakao_success_count | integer | 카카오 성공 수량 |
| kakao_unit_price | numeric(6,2) | 카카오 단가 |
| test_sms_count | integer | 테스트 SMS 수량 |
| test_sms_unit_price | numeric(6,2) | 테스트 SMS 단가 |
| test_lms_count | integer | 테스트 LMS 수량 |
| test_lms_unit_price | numeric(6,2) | 테스트 LMS 단가 |
| spam_filter_count | integer | 스팸필터 테스트 수량 (레거시, 미사용) |
| spam_filter_unit_price | numeric(6,2) | 스팸필터 단가 (레거시, 미사용) |
| spam_filter_sms_count | integer | 스팸필터 SMS 수량 |
| spam_filter_sms_unit_price | numeric(6,2) | 스팸필터 SMS 단가 |
| spam_filter_lms_count | integer | 스팸필터 LMS 수량 |
| spam_filter_lms_unit_price | numeric(6,2) | 스팸필터 LMS 단가 |
| subtotal | numeric(12,2) | 공급가액 |
| vat | numeric(12,2) | 부가세 |
| total_amount | numeric(12,2) | 합계 |
| status | varchar(20) | draft/confirmed/paid |
| pdf_path | varchar(500) | 생성된 PDF 경로 |
| notes | text | 비고 |
| created_by | uuid | 생성자 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### balance_transactions (잔액 변동 이력)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | 고객사 |
| type | varchar(20) | charge/deduct/refund/admin_charge/admin_deduct/deposit_charge |
| amount | numeric(15,2) | 변동 금액 |
| balance_after | numeric(15,2) | 변동 후 잔액 |
| description | text | 설명/사유 |
| reference_type | varchar(30) | campaign/payment/admin 등 |
| reference_id | uuid | 연관 ID |
| admin_id | uuid | 관리자 수동 조정 시 |
| created_by | uuid | ★ D98: 차감 실행 사용자 (사용자별 사용금액 격리) |
| message_type | varchar(10) | ★ D145 P0+ (2026-05-07): SMS/LMS/MMS/KAKAO 분리 — `directChannel='both'` 환불 차단 위험 해결. 옛 row는 NULL (호환). prepaidRefund alreadyRefunded/totalDeducted 조회 시 `message_type = $X OR IS NULL` 필터 적용 |
| created_at | timestamptz | |

### ai_credit_transactions (AI 크레딧 차감/충전/리셋 이력) — ★ D227+ 종량제 신설 (2026-05-31)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | gen_random_uuid() |
| company_id | uuid FK | companies(id) |
| type | varchar(20) | deduct / grant / purchase / reset / postpaid_grant |
| amount | integer | 크레딧 양 (항상 양수, 방향은 type) |
| bucket | varchar(10) | base / purchased / mixed (reset=base) |
| source | varchar(60) | AI 작업 source (orchestrate / dm-ai / generate-messages 등) |
| ai_call_log_id | uuid FK | ai_call_log(id) nullable — 토큰 기록과 연결 |
| idempotency_key | varchar(150) UNIQUE | 재시도 중복 차감 차단 (deduct=`source:aiCallLogId`, reset=`reset:company:YYYYMM`) |
| balance_base_after | integer | 차감/리셋 후 기본분 잔액 (감사) |
| balance_purchased_after | integer | 차감/리셋 후 구매분 잔액 (감사) |
| created_by | uuid | 차감 유발 사용자 (nullable) |
| created_at | timestamptz | DEFAULT now() |

> CT `utils/ai-credit.ts` (checkCredit/deductCredit/resetMonthlyCreditsIfNeeded) 단일 진입점. 2버킷(base→purchased) 트랜잭션 차감 + SELECT FOR UPDATE 음수 방지 + idempotency_key 중복 차단. 순수 계산은 `utils/ai-credit-calc.ts`(node:assert 검증). 차감=호출 성공 후(실패 시 미차감). 인덱스 `idx_ai_credit_tx_company_created (company_id, created_at DESC)`.

### campaigns 보호 trigger (★ D145 PDF 후속 — 2026-05-07)

**`protect_completed_target_count`** — 완료된 캠페인의 `target_count` UPDATE 시 RAISE EXCEPTION으로 영구 차단.
- 신설 사유: 폴라초이스 캠페인(`14df97e7`) PG `target_count`가 5/7 새벽 디버깅 도중 수동 SQL UPDATE로 잘못 박힘(15,640). 코드 흐름상 발생 불가 → audit 없는 데이터 오염 사고.
- 동작: `BEFORE UPDATE OF target_count ON campaigns FOR EACH ROW`. `OLD.status = 'completed' AND OLD.target_count IS DISTINCT FROM NEW.target_count` 시 차단.
- 정상 코드 흐름은 모두 `status='scheduled'` 가드라 영향 0 (campaigns.ts:2079, 2088, 926).
- 검증: `UPDATE campaigns SET target_count = 9999 WHERE id = '14df97e7'` → `ERROR: 완료된 캠페인의 target_count는 변경할 수 없습니다.`

### payments (PG 결제 내역) — D184 (2026-05-20) 이니시스 영역 9 컬럼 ALTER 정합
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | 고객사 |
| payment_method | varchar(20) | card/virtual_account/transfer |
| pg_provider | varchar(20) | tosspayments / **inicis** (D184 신규) |
| pg_payment_key | varchar(200) | PG 결제 키 (이니시스 = tid, ApplNum) |
| pg_order_id | varchar(100) | 주문 ID (이니시스 = oid, `HJ-{timestamp}-{rand}` 형식) |
| amount | numeric(15,2) | 결제 금액 |
| status | varchar(20) | pending/completed/failed/cancelled |
| paid_at | timestamptz | |
| cancelled_at | timestamptz | |
| pg_response | jsonb | PG 응답 원본 (authUrl 인증 결과 jsonb 보관) |
| created_at | timestamptz | |
| **user_id** | uuid FK (users.id) | **D184: 결제 실행 사용자 (NULL 가능)** |
| **card_company** | varchar(50) | **D184: 카드사 (이니시스 응답 cardName)** |
| **card_quota** | integer | **D184: 할부 개월 (이니시스 응답 cardQuota)** |
| **result_code** | varchar(10) | **D184: 이니시스 resultCode (0000=성공)** |
| **result_msg** | text | **D184: 이니시스 resultMsg** |
| **buyer_name** | varchar(50) | **D184: 구매자명 (이니시스 form buyername)** |
| **buyer_tel** | varchar(20) | **D184: 구매자 전화 (이니시스 form buyertel)** |
| **buyer_email** | varchar(100) | **D184: 구매자 이메일 (이니시스 form buyeremail)** |
| **product_name** | varchar(200) | **D184: 상품명 (이니시스 form goodname)** |

**D184 신규 인덱스 (2026-05-20):**
- UNIQUE INDEX `uniq_payments_pg_payment_key` ON payments(pg_payment_key) WHERE pg_payment_key IS NOT NULL — 이니시스 tid 중복 INSERT 차단
- UNIQUE INDEX `uniq_payments_pg_order_id` ON payments(pg_order_id) WHERE pg_order_id IS NOT NULL — 한 결제 = 한 orderId (pending → completed UPDATE 정합)
- INDEX `idx_payments_company_created` (company_id, created_at DESC) — 회사 admin 결제 이력 조회
- INDEX `idx_payments_user` (user_id) WHERE user_id IS NOT NULL — 사용자별 결제 조회
- INDEX `idx_payments_status` (status, created_at DESC) — pending/failed 영역 조회
- INDEX `idx_payments_pg_provider` (pg_provider, created_at DESC) — provider별 통계

**D184 결제 흐름 (이니시스 표준결제 v2.x):**
1. `/api/payments/inicis/prepare` (회사 admin 인증) — pending payment INSERT (status='pending', pg_order_id 생성) + 이니시스 form 데이터 + signature 반환
2. Frontend INIStdPay.pay 호출 → 이니시스 결제창 새 창
3. 이니시스 → `/api/payments/inicis/return` form POST callback (인증 X, signature 검증)
4. backend `approveInicisPayment(callback)` — authUrl POST 호출 + SHA256 서명 + verification + 승인 응답
5. `finalizePaymentSuccess(orderId, approval)` 트랜잭션: payments UPDATE (pending→completed) + companies.balance 증가 + balance_transactions charge INSERT
6. 사용자에게 HTML response (postMessage + window.close + frontend redirect fallback)
7. 부모 창 BalanceModals = postMessage 수신 → 잔액 새로고침

**D184 idempotency:**
- pg_order_id UNIQUE = 같은 결제 중복 INSERT 차단
- pending → completed UPDATE에 `status = 'pending'` WHERE 가드 = 동시 처리 차단
- 이미 completed면 alreadyProcessed=true 반환 + balance 추가 증가 X
- 금액 위변조 검증: approval.totPrice vs db.amount 차이 ≤ 0.5

### deposit_requests (무통장입금 요청)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | 고객사 |
| amount | numeric(15,2) | 요청 금액 |
| depositor_name | varchar(50) | 입금자명 |
| status | varchar(20) | pending/confirmed/rejected |
| confirmed_by | uuid | 승인 관리자 |
| confirmed_at | timestamptz | |
| admin_note | text | 관리자 메모 |
| created_at | timestamptz | |

### analysis_results (AI 분석 결과 캐시)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | 고객사 |
| analysis_level | varchar(20) | basic/advanced |
| period_from | date | 분석 시작일 |
| period_to | date | 분석 종료일 |
| insights | jsonb | Claude 분석 인사이트 배열 |
| collected_data | jsonb | 원본 수집 데이터 (PDF 재생성용) |
| created_at | timestamptz | |
- UNIQUE: (company_id, analysis_level, period_from, period_to)
- INDEX: idx_analysis_results_company (company_id, created_at DESC)

### spam_filter_tests (스팸필터 테스트)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | 고객사 |
| user_id | uuid FK | 실행 사용자 |
| callback_number | varchar(20) | 발신번호 |
| message_content_sms | text (nullable) | SMS 테스트 메시지 본문 |
| message_content_lms | text (nullable) | LMS 테스트 메시지 본문 |
| message_hash | varchar(64) (nullable) | 메시지 해시 (앱 매칭용) |
| spam_check_number | varchar(20) (nullable) | 스팸 체크 번호 |
| source | varchar(20) DEFAULT 'manual' | 발원지: manual / auto_campaign |
| variant_id | varchar(2) (nullable) | A/B 테스트 변형 ID (A/B) |
| batch_id | uuid (nullable) | 배치 그룹화 ID (자동 테스트용) |
| subject | text (nullable) | LMS 제목 (2026-06-13 information_schema 실측 확인) |
| first_recipient | jsonb (nullable) | 첫 수신자 정보 (2026-06-13 information_schema 실측 확인) |
| status | varchar(20) | active/completed |
| completed_at | timestamptz (nullable) | 테스트 완료 |
| created_at | timestamptz | |
> ★ 2026-06-13 실측: `started_at` 컬럼은 실DB에 없음(문서 과다였음) — 제거. `subject`·`first_recipient`는 실재(문서 누락이었음).
- INDEX: idx_spam_filter_tests_company (company_id, created_at DESC)
- INDEX: idx_spam_filter_tests_status (status) WHERE status = 'active'
- INDEX: idx_spam_filter_tests_queued (company_id, status, batch_id, variant_id) WHERE status = 'active' — 자동 대기열 조회 최적화

### spam_filter_test_results (스팸필터 테스트 결과)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| test_id | uuid FK | spam_filter_tests.id |
| carrier | varchar(20) | 통신사 (SKT/KT/LGU) |
| message_type | varchar(10) | SMS/LMS |
| phone | varchar(20) | 수신 단말 번호 |
| received | boolean DEFAULT false | 앱 수신 여부 |
| received_at | timestamptz (nullable) | 앱 수신 시각 |
| result | varchar(20) (nullable) | 판정: pass/blocked/failed/timeout (D43-7에서 received→pass 전환) |
> ★ 2026-06-13 실측: `sms_table`·`sms_msgkey`·`message_hash`·`created_at` 컬럼은 실DB에 없음(문서 과다였음) — 제거. 실재 컬럼은 위 8개뿐.
- INDEX: idx_spam_filter_results_test (test_id)
- INDEX: idx_spam_filter_results_pending (test_id, received) WHERE received = false
- **result 허용값:** pass(정상수신), blocked(스팸차단), failed(발송실패), timeout(시간초과), NULL(판정 대기)
- **참조:** sms-result-map.ts의 SPAM_RESULT 상수가 유일한 정의

### auto_campaigns (자동발송 스케줄) — D69 ✅ 생성 완료

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| user_id | uuid FK → users | 생성자 (발송 주체) |
| campaign_name | varchar(200) NOT NULL | |
| description | text | |
| schedule_type | varchar(20) NOT NULL | monthly / weekly / daily |
| schedule_day | integer CHECK(1~28) | monthly: 발송일, weekly: 0~6(일~토) |
| schedule_time | time NOT NULL | 발송 시각 |
| timezone | varchar(50) DEFAULT 'Asia/Seoul' | |
| target_filter | jsonb NOT NULL | customer-filter.ts 호환 필터 |
| store_code | varchar(50) | 브랜드 격리 (NULL = 전체) |
| message_type | varchar(10) DEFAULT 'SMS' | SMS / LMS / MMS |
| message_content | text NOT NULL | 변수 포함 (%고객명% 등) |
| message_subject | varchar(200) | LMS/MMS 제목 |
| callback_number | varchar(20) NOT NULL | 발신번호 |
| sender_number_id | uuid FK → sender_numbers | |
| is_ad | boolean DEFAULT false | |
| pre_notify | boolean DEFAULT true | D-1 사전 알림 |
| notify_phones | text[] | 알림 수신 전화번호 |
| ai_generate_enabled | boolean DEFAULT false | D80: 매 발송 시 AI가 문안을 새로 생성할지 여부 |
| ai_prompt | text | D80: AI에 전달할 마케팅 컨셉/지시 |
| ai_tone | varchar(20) DEFAULT 'friendly' | D80: 톤 (friendly/formal/cute/professional) |
| fallback_message_content | text | D80: AI 실패 시 폴백 메시지 |
| generated_message_content | text | D80: D-2에 생성된 문안 (발송 때 사용) |
| generated_message_subject | varchar(200) | D80: D-2에 생성된 LMS/MMS 제목 |
| generated_at | timestamptz | D80: 문안 생성 시각 |
| status | varchar(20) DEFAULT 'active' | active / paused / deleted |
| last_run_at | timestamptz | |
| next_run_at | timestamptz | |
| total_runs | integer DEFAULT 0 | |
| total_sent | integer DEFAULT 0 | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### auto_campaign_runs (자동발송 실행 이력) — D69 ✅ 생성 완료

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| auto_campaign_id | uuid FK → auto_campaigns | |
| campaign_id | uuid FK → campaigns | 실제 생성된 캠페인 연결 |
| run_number | integer NOT NULL | 회차 (1, 2, 3...) |
| target_count | integer | 필터링된 타겟 수 |
| sent_count | integer DEFAULT 0 | |
| success_count | integer DEFAULT 0 | |
| fail_count | integer DEFAULT 0 | |
| status | varchar(20) DEFAULT 'pending' | pending / notified / spam_tested / sending / completed / cancelled / failed |
| notified_at | timestamptz | 사전 알림 발송 시각 |
| notify_message | text | |
| scheduled_at | timestamptz NOT NULL | 예정 발송 시각 |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| cancelled_at | timestamptz | |
| cancel_reason | text | |
| generated_message_content | text | D80: 해당 회차에 사용된 AI 생성 문안 |
| generated_message_subject | varchar(200) | D80: 해당 회차에 사용된 AI 생성 제목 |
| spam_test_result | jsonb | D80: 스팸테스트 결과 JSON |
| ai_generation_status | varchar(20) | D80: ai_generated / ai_fallback / fixed |
| created_at | timestamptz | |

### sender_managers (발신번호 관리 담당자)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| manager_name | varchar(100) NOT NULL | 담당자 이름 |
| manager_phone | varchar(20) NOT NULL | 담당자 전화번호 |
| manager_email | varchar(100) | 담당자 이메일 |
| status | varchar(20) DEFAULT 'active' | active / inactive |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### sender_registrations (발신번호 등록 신청)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| requested_by | uuid FK → users | 신청자 |
| phone | varchar(20) NOT NULL | 신청 발신번호 |
| label | varchar(100) | 라벨 |
| store_code | varchar(50) | 매장코드 |
| store_name | varchar(100) | 매장명 |
| documents | jsonb DEFAULT '[]' | 첨부 서류 [{type, originalName, storedName, filePath, fileSize, uploadedAt}] |
| request_note | text | 신청 메모 |
| status | varchar(20) DEFAULT 'pending' | pending / approved / rejected |
| reviewed_by | uuid FK → super_admins | 심사자 |
| reviewed_at | timestamptz | 심사 시각 |
| reject_reason | text | 반려 사유 |
| approved_callback_id | uuid FK → callback_numbers | 승인 시 생성된 발신번호 ID |
| created_at | timestamptz | |
| updated_at | timestamptz | |
- INDEX: company_id
- INDEX: status WHERE status = 'pending'
- INDEX: requested_by

---

## D172 — 한줄로 CDP (Customer Data Platform) 신설 (2026-05-19~)

> ★ 자사몰 → 한줄로AI 고객/주문/이벤트 sync 표준 인프라. Braze/Segment/Klaviyo 패턴 정합.
> ★ 운영 진입 가이드 + 자사몰 종류별 통합 방식 = `status/ai_operator_progress.md` (Step 1+ 진입 시 추가) + `memory/project_d172_cdp_kickoff.md`

### cdp_identity_links (자사몰 external_id ↔ 한줄로 customers.id 매핑) — D172 신규

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| customer_id | uuid FK → customers | 한줄로 customers row (NULL 가능 — 비회원 이벤트도 link 박음) |
| source | varchar(30) | 'cafe24' / 'shopify' / 'makeshop' / 'imweb' / 'custom_sdk' / 'webhook' |
| external_id | varchar(200) | 자사몰 내부 회원 ID (cafe24 member_id 등) |
| external_email | varchar(150) | 자사몰 이메일 (회원 매칭 보조) |
| external_phone | varchar(20) | 자사몰 전화 (회원 매칭 보조) |
| last_seen_at | timestamptz | 마지막 식별/이벤트 발생 시각 |
| created_at | timestamptz | |
| updated_at | timestamptz | |
- UNIQUE: (company_id, source, external_id)
- INDEX: customer_id
- INDEX: company_id, external_email
- INDEX: company_id, external_phone

### cdp_events (CDP 이벤트 ingestion 로그) — D172 신규

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| identity_link_id | uuid FK → cdp_identity_links (NULL 가능) | 비회원 이벤트는 NULL |
| customer_id | uuid FK → customers (NULL 가능) | 매칭 시 박음 |
| event_name | varchar(50) | 'page_view' / 'cart_add' / 'cart_remove' / 'checkout_start' / 'purchase' / 'wishlist_add' / custom |
| properties | jsonb DEFAULT '{}' | 이벤트별 자유 데이터 (상품 ID, 금액, URL 등) |
| source | varchar(30) | 'cafe24' / 'shopify' / 'custom_sdk' / 'webhook' |
| occurred_at | timestamptz | 자사몰 발생 시각 (자사몰이 박음, 미박힘 시 created_at) |
| created_at | timestamptz | |
| anonymous_id | varchar | ★ 2026-06-29 실측 (비회원 추적 ID) |
| session_id | varchar | ★ 2026-06-29 실측 |
| trust_level | varchar | ★ 2026-06-29 실측 (이벤트 신뢰 등급) |
| schema_version | varchar | ★ 2026-06-29 실측 |
| sent_at | timestamptz | ★ 2026-06-29 실측 (자사몰 전송 시각) |
| received_at | timestamptz | ★ 2026-06-29 실측 (한줄로 수신 시각) |
- INDEX: company_id, occurred_at DESC
- INDEX: company_id, event_name, occurred_at DESC
- INDEX: customer_id, occurred_at DESC WHERE customer_id IS NOT NULL
- INDEX: company_id, created_at DESC (이벤트 로그 조회용)

### cdp_identity_review (identity 충돌 검수 큐) — 2026-06-25 신규 (gap 2·4)

자동 phone 변경/병합 위험 시 변경하지 않고 플래그만 적재(운영 검수 후 수동 병합). recorder `utils/cdp-identity-review.ts`가 적재, 테이블 미생성 시 안전 skip.

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK DEFAULT gen_random_uuid() | |
| company_id | uuid NOT NULL | (FK 미부여 — 경량) |
| customer_id | uuid NOT NULL | email로 선택된 고객(충돌 시 그대로 진행) |
| kind | varchar(40) NOT NULL | 'phone_conflict' / 'merge_candidate' |
| detail | jsonb NOT NULL DEFAULT '{}' | reason·incomingPhone·conflictHolderId 등 |
| resolved | boolean NOT NULL DEFAULT false | 운영 검수 처리 여부 |
| created_at | timestamptz NOT NULL DEFAULT NOW() | |
- INDEX: idx_cdp_identity_review_company_unresolved (company_id, resolved, created_at DESC)

### cdp_webhook_deliveries (Webhook 신뢰성 추적) — D172 신규

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| source | varchar(30) | 'cafe24' / 'shopify' / ... |
| webhook_event | varchar(100) | 'order.created' / 'customer.created' 등 자사몰별 표준 |
| idempotency_key | varchar(200) | 자사몰이 박은 unique key (재시도 시 중복 차단) |
| payload | jsonb | 원본 webhook payload (디버깅용, 30일 후 NULL) |
| status | varchar(20) | 'received' / 'processed' / 'failed' / 'duplicate' |
| error_message | text | 실패 시 사유 |
| retry_count | integer DEFAULT 0 | |
| processed_at | timestamptz | |
| created_at | timestamptz | |
- UNIQUE: (company_id, source, idempotency_key) — D145 idempotent 패턴 정합
- INDEX: company_id, status, created_at DESC

### cdp_api_call_log (API 호출 누적 — 요금제 게이팅) — D172 신규

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | bigserial PK | |
| company_id | uuid FK → companies | |
| endpoint | varchar(50) | 'identify' / 'event' / 'order' / 'bulk-import' |
| call_count | integer | bulk-import의 경우 row 단위 누적 |
| status_code | integer | 200/400/401/429 등 |
| occurred_at | timestamptz | |
- INDEX: company_id, occurred_at DESC (월별 집계용)

### company_integrations (자사몰 OAuth 통합 인증) — D172-B 신규

> ★ 자사몰별 OAuth 인증 + access_token/refresh_token 보관. 카페24/Shopify/메이크샵 등 표준 SaaS 자사몰 진입 layer.
> ★ access_token / refresh_token은 backend-only — frontend 노출 X. 회사 단위 격리.

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| provider | varchar(20) | 'cafe24' / 'shopify' / 'makeshop' / 'imweb' / 'sixshop' / 'woocommerce' 등 |
| mall_id | varchar(100) | 자사몰 식별자 (카페24 mall_id 등) |
| access_token | text | OAuth access token (Phase 2에서 암호화 박을 가치 — 현재 raw, env DATABASE 격리) |
| refresh_token | text | refresh token |
| token_expires_at | timestamptz | access_token 만료 시각 (카페24 = 2시간 TTL) |
| scope | text | OAuth 부여 scope (mall.read_customer, mall.read_order 등) |
| meta | jsonb DEFAULT '{}' | 자사몰별 추가 데이터 (mall_name, plan, currency 등) |
| webhook_secret | varchar(100) | webhook 서명 검증용 secret (자사몰이 박음 또는 한줄로 발급) |
| connected_at | timestamptz | OAuth 최초 연동 시각 |
| last_synced_at | timestamptz | 마지막 webhook 수신 또는 polling 시각 |
| status | varchar(20) DEFAULT 'active' | 'active' / 'token_expired' / 'revoked' / 'error' |
| created_at | timestamptz | |
| updated_at | timestamptz | |
- UNIQUE: (company_id, provider, mall_id)
- INDEX: company_id
- INDEX: provider, status

### D172-B 운영 환경 추가 실행 SQL (Harold 직접)

```sql
-- 7. company_integrations
CREATE TABLE IF NOT EXISTS company_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider varchar(20) NOT NULL,
  mall_id varchar(100) NOT NULL,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scope text,
  meta jsonb NOT NULL DEFAULT '{}',
  webhook_secret varchar(100),
  connected_at timestamptz,
  last_synced_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, provider, mall_id)
);
CREATE INDEX IF NOT EXISTS idx_company_integrations_company ON company_integrations(company_id);
CREATE INDEX IF NOT EXISTS idx_company_integrations_provider ON company_integrations(provider, status);
```

### D172 환경변수 (Harold .env 박을 영역)

```
# 카페24 App (한줄로 개발자 센터에 등록 후 박음)
CAFE24_CLIENT_ID=...
CAFE24_CLIENT_SECRET=...
CAFE24_REDIRECT_URI=https://app.hanjul.ai/api/cafe24/oauth/callback
```

---

## D175-A — Web Push + In-app Message 채널 (2026-05-19)

> ★ AI Operator + CDP 인프라 위에 박는 채널 확장. 영업팀장 의견 정합(푸시/팝업 채널 강력) + Harold 비전(범용 + 사용 편리).
> ★ Web Push = VAPID 표준 / In-app Message = SDK 자동 표시 + frequency 제어 + 트래킹.

### cdp_push_subscriptions (Web Push 구독 정보) — D175-A 신규

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| customer_id | uuid FK → customers (NULL 가능) | 비회원 anonymous 구독 가능 |
| identity_link_id | uuid FK → cdp_identity_links (NULL 가능) | |
| endpoint | text | Web Push subscription endpoint URL (UNIQUE per company) |
| p256dh_key | text | Web Push P256DH 공개키 |
| auth_key | text | Web Push auth secret |
| user_agent | text | 구독 시 브라우저 UA (디버깅) |
| status | varchar(20) DEFAULT 'active' | active / revoked / expired |
| subscribed_at | timestamptz NOT NULL DEFAULT NOW() | |
| last_sent_at | timestamptz | 마지막 push 발송 시각 |
| created_at | timestamptz | |
| updated_at | timestamptz | |
- UNIQUE: (company_id, endpoint)
- INDEX: company_id, status WHERE status='active'
- INDEX: customer_id WHERE customer_id IS NOT NULL

### cdp_push_campaigns (Web Push 캠페인 발송 이력) — D175-A 신규

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | |
| created_by | uuid FK → users | |
| title | varchar(100) | 푸시 제목 |
| body | text | 본문 |
| url | text | 클릭 시 이동 URL |
| icon | text | 푸시 아이콘 URL (선택) |
| badge | text | 뱃지 URL (선택) |
| recipient_count | integer | 발송 대상 수 |
| success_count | integer DEFAULT 0 | |
| fail_count | integer DEFAULT 0 | |
| status | varchar(20) DEFAULT 'pending' | pending / sending / completed / failed |
| sent_at | timestamptz | |
| created_at | timestamptz | |
- INDEX: company_id, created_at DESC

### cdp_inapp_messages (In-app Message 정의) — D175-A 신규 + D215+ 확장 (★ 2026-06-11 실측 32컬럼 + 2026-06-17 channel 1컬럼 + 2026-06-27 블록 3컬럼 = 36)

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | |
| created_by | uuid FK → users | |
| title | varchar(100) | |
| body | text | |
| action_url | text | CTA 클릭 시 이동 |
| action_label | varchar(50) | CTA 라벨 (기본 "자세히 보기") |
| position | varchar(20) DEFAULT 'top_banner' | top_banner / bottom_banner / center_modal (옛 컬럼 — template fallback) |
| background_color | varchar(20) DEFAULT '#4f46e5' | hex 색상 |
| text_color | varchar(20) DEFAULT '#ffffff' | |
| trigger_event | varchar(50) DEFAULT 'page_load' | page_load / cart_add / purchase 등 CDP 이벤트 |
| display_frequency | varchar(30) DEFAULT 'once_per_session' | once_per_session / once_per_day / always |
| start_at | timestamptz | 노출 시작 시각 (NULL = 즉시) |
| end_at | timestamptz | 노출 종료 시각 (NULL = 무기한) |
| status | varchar(20) DEFAULT 'active' | active / paused / archived |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| template | varchar DEFAULT 'top_banner' | ★ 실측 — 8 템플릿 (top/bottom_banner·center_modal·full_screen·slide_in·inline_card·toast·floating_button) |
| image_url | text | ★ 실측 |
| buttons | jsonb DEFAULT '[]' | ★ 실측 — 다중 CTA 최대 3 |
| segment_conditions | jsonb DEFAULT '{}' | ★ 실측 — CT-78 매칭 |
| trigger_conditions | jsonb DEFAULT '{}' | ★ 실측 — {event, scroll_percent, time_on_page_seconds, cart_value_min} |
| personalization_vars | jsonb DEFAULT '[]' | ★ 실측 |
| parent_message_id | uuid | ★ 실측 — A/B variant 부모 (NULL = 부모) |
| variant_weight | integer DEFAULT 100 | ★ 실측 |
| auto_dismiss_seconds | integer | ★ 실측 |
| max_displays_per_user | integer | ★ 실측 |
| send_start_hour | integer | ★ 실측 — CT-82 시간대 |
| send_end_hour | integer | ★ 실측 |
| allowed_weekdays | integer[] DEFAULT '{0,1,2,3,4,5,6}' | ★ 실측 |
| locale_variants | jsonb DEFAULT '{}' | ★ 실측 |
| animation | varchar DEFAULT 'fade' | ★ 실측 — fade/slide/bounce/pulse |
| channel | varchar(10) NOT NULL DEFAULT 'web' | ★ 2026-06-17 — web/app 채널 분리 (웹 팝업 / 앱 인앱). SDK 서빙(/inapp/active)은 web만 노출 |
| badge_text | varchar(20) | ★ 2026-06-18 실측 — 모달 상단 뱃지 라벨 (NEW·VIP·오랜만이에요 등, nullable). AI 생성 시 시나리오별 자동 |
| content_blocks | jsonb DEFAULT '[]' | ★ 2026-06-27 실측 — 블록 조립 배열(13 블록: media·eyebrow·headline·body·bullets·benefit·countdown·rating·product·divider·spacer·cta_group·footer). 비면 레거시 단색 렌더(외형 변화 0) |
| theme | varchar(30) DEFAULT 'auto' | ★ 2026-06-27 실측 — 큐레이션 테마(auto/light/dark/brand/vibrant/minimal) |
| accent_color | varchar(20) | ★ 2026-06-27 실측 — 강조색 hex(NULL=테마 기본). background_color는 레거시 전용 보존 |
- INDEX: company_id, status, start_at, end_at
- INDEX: idx_inapp_channel(company_id, channel, status) ★ 2026-06-17

### cdp_inapp_impressions (In-app Message 표시/클릭 트래킹) — D175-A 신규 + D215+ 확장 (★ 2026-06-11 운영 information_schema 실측 11컬럼)

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | bigserial PK | |
| company_id | uuid FK | |
| message_id | uuid FK → cdp_inapp_messages | |
| customer_id | uuid FK → customers (NULL 가능) | |
| identity_link_id | uuid FK → cdp_identity_links (NULL 가능) | |
| anonymous_id | varchar(100) | 비회원 브라우저 추적 ID |
| event_type | varchar(20) | 'impression' / 'click' / 'dismiss' |
| occurred_at | timestamptz NOT NULL DEFAULT NOW() | |
| button_id | varchar | ★ 실측 — 다중 CTA click 분리 |
| dwell_seconds | integer | ★ 실측 — 표시→반응 경과 초 |
| attributed_purchase_id | uuid | ★ 실측 — 24h purchase attribution |
- INDEX: company_id, message_id, occurred_at DESC
- INDEX: message_id, event_type

### D175-A 운영 환경 추가 실행 SQL (Harold 직접)

```sql
-- 8. cdp_push_subscriptions
CREATE TABLE IF NOT EXISTS cdp_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  identity_link_id uuid REFERENCES cdp_identity_links(id) ON DELETE SET NULL,
  endpoint text NOT NULL,
  p256dh_key text NOT NULL,
  auth_key text NOT NULL,
  user_agent text,
  status varchar(20) NOT NULL DEFAULT 'active',
  subscribed_at timestamptz NOT NULL DEFAULT NOW(),
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_subs_active ON cdp_push_subscriptions(company_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_push_subs_customer ON cdp_push_subscriptions(customer_id) WHERE customer_id IS NOT NULL;

-- 9. cdp_push_campaigns
CREATE TABLE IF NOT EXISTS cdp_push_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  title varchar(100) NOT NULL,
  body text NOT NULL,
  url text,
  icon text,
  badge text,
  recipient_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  fail_count integer NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_campaigns ON cdp_push_campaigns(company_id, created_at DESC);

-- 10. cdp_inapp_messages
CREATE TABLE IF NOT EXISTS cdp_inapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  title varchar(100) NOT NULL,
  body text NOT NULL,
  action_url text,
  action_label varchar(50) DEFAULT '자세히 보기',
  position varchar(20) NOT NULL DEFAULT 'top_banner',
  background_color varchar(20) NOT NULL DEFAULT '#4f46e5',
  text_color varchar(20) NOT NULL DEFAULT '#ffffff',
  trigger_event varchar(50) NOT NULL DEFAULT 'page_load',
  display_frequency varchar(30) NOT NULL DEFAULT 'once_per_session',
  start_at timestamptz,
  end_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inapp_active ON cdp_inapp_messages(company_id, status, start_at, end_at);

-- 11. cdp_inapp_impressions
CREATE TABLE IF NOT EXISTS cdp_inapp_impressions (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES cdp_inapp_messages(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  identity_link_id uuid REFERENCES cdp_identity_links(id) ON DELETE SET NULL,
  anonymous_id varchar(100),
  event_type varchar(20) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inapp_imp_msg ON cdp_inapp_impressions(company_id, message_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_inapp_imp_event ON cdp_inapp_impressions(message_id, event_type);
```

### D175-A 환경변수 (Harold .env 박음)

```
# Web Push VAPID 키 (web-push 라이브러리 generateVAPIDKeys로 생성 후 박음)
VAPID_PUBLIC_KEY=B...   # base64url 인코딩된 P256 공개키
VAPID_PRIVATE_KEY=...   # base64url 인코딩된 P256 비밀키
VAPID_SUBJECT=mailto:admin@hanjul.ai
```

### D175-A backend 패키지 의존성 (Harold npm install)

```bash
cd /home/administrator/targetup-app/packages/backend && npm install web-push @types/web-push
```

---

## D176 — Continuous Agentic Operator (사용자 동의 흐름) (2026-05-19)

> ★ 한줄로 BEYOND BRAZE 비전 압축 로드맵 1순위 박힘.
> ★ AI는 매일 회고 + 제안서 박음 / 실행은 항상 사용자 동의 후 (Harold 영구 원칙 #1 정합).
> ★ ENT 자동 실행 옵션 (default OFF) — 1,000건/5만원/low risk 임계값만 허용.

### continuous_operators (영구 캠페인 목표) — D176 신규

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | |
| created_by | uuid FK → users | |
| name | varchar(100) | 사용자가 박은 Operator 이름 ("VIP 재구매 영구 운영" 등) |
| objective | text | 자연어 한 줄 ("VIP 재구매 유도 + 매출 30% 증대") |
| schedule | varchar(20) DEFAULT 'daily' | daily / weekly / monthly / yearly(2026-07-05 신설 — 시즌 연 1회) |
| schedule_time | varchar(10) DEFAULT '09:00' | KST 발송 시각 |
| schedule_day_of_week | smallint | 0(일)~6(토) — weekly 전용 (G 2026-06-20 ALTER 실측) |
| schedule_day_of_month | smallint | 1~31 — monthly·yearly 전용 (말일 초과 시 그 달 말일 클램프, G 2026-06-20 ALTER 실측) |
| schedule_month | integer | 1~12 — yearly 전용 대상 월 (2026-07-05 ALTER — 마케팅 캘린더 매월 반복 오발송 근본 수정) |
| status | varchar(20) DEFAULT 'active' | active / paused / archived |
| last_run_at | timestamptz | 마지막 제안서 생성 시각 |
| next_run_at | timestamptz | 다음 제안서 생성 예약 시각 |
| total_proposals | integer DEFAULT 0 | 누적 제안서 수 |
| total_approved | integer DEFAULT 0 | 누적 승인 수 |
| total_rejected | integer DEFAULT 0 | 누적 거부 수 |
| total_auto_executed | integer DEFAULT 0 | 자동 실행 수 (ENT 옵션) |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| budget_monthly | integer | 월 예산(원) — Phase2 D 가드 (2026-06-26 실측) |
| budget_daily | integer | 일 한도(원) — Phase2 D 가드 (2026-06-26 실측) |
| budget_alert_threshold | integer DEFAULT 80 | 예산 임계 알림 % (2026-06-26 실측) |
| delivery_policy | varchar DEFAULT 'daily' | (2026-06-26 실측) |
| verification_required_days | integer DEFAULT 7 | (2026-06-26 실측) |
| verification_passed_days | integer DEFAULT 0 | (2026-06-26 실측) |
| admin_phone_numbers | text[] DEFAULT '{}' | 담당자 알림 연락처 (2026-06-26 실측) |
| backup_admin_phone | varchar | 백업 담당자 연락처 (2026-06-26 실측) |
| admin_alert_channel | varchar DEFAULT 'sms' | 담당자 알림 채널 (2026-06-26 실측) |
| opt_out_minutes | integer DEFAULT 5 | (2026-06-26 실측) |
| spam_score_threshold | integer DEFAULT 30 | (2026-06-26 실측) |
| max_spam_retries | integer DEFAULT 3 | (2026-06-26 실측) |
| auto_send_lead_minutes | integer | 자율 발송 lead(분) — 담당자 N분 전 알림 (2026-06-26 실측) |
| channel | varchar(10) DEFAULT 'lms' | 발송 채널 sms/lms/mms (2026-06-26 ALTER 실측) |
| benefit_content | text | 관리자 직접 입력 혜택 — AI 임의 생성 금지 (2026-06-26 ALTER 실측) |
| sequence_enabled | boolean DEFAULT false | Phase3 C 다단계 시퀀스 on/off (2026-06-26 ALTER 실측) |
| sequence_delay_days | integer | 1차 후 리마인드 대기일 1~30 (2026-06-26 ALTER 실측) |
| sequence_reminder_content | text | 관리자 직접 입력 리마인드 문안 — AI 임의 생성 금지 (2026-06-26 ALTER 실측) |
| send_time_mode | text NOT NULL DEFAULT 'fixed' | 발송 시각 모드 fixed(희망 시각 정각)/ai_optimal(클릭 피크) — schedule_time=발송 희망 시각, next_run_at=생성 시각(희망−lead) 의미 전환 (2026-07-02 ALTER 실측) |
| copy_style | text | 문안 스타일 courteous/friendly/witty/punchy, NULL=브랜드 톤 자동 (2026-07-02 ALTER 실측) |
| prep_reminder_sent_for | date | 월간 캠페인 D-2 사전 준비 문자 멱등(발송일 기록) (2026-07-02 ALTER — 세션 종료 시점 미실행 확인, Harold 실행 예정) |
- INDEX: company_id, status WHERE status='active'
- INDEX: status, next_run_at WHERE status='active' (worker 호출용)
- 2026-06-26 information_schema 덤프 = 위 33컬럼 전부 존재 확정. 중복 4컬럼(notify_phones/backup_phones/notify_channel/lead_minutes)은 DROP 완료(데이터 0). 재질의 금지.
- ★ 2026-07-02 의미 전환: next_run_at = "발송 시각"이 아니라 "생성 시각(발송 희망 − auto_send_lead_minutes)". 기존 행은 −lead UPDATE 마이그레이션 완료(UPDATE 4 실측).

### operator_proposals (AI 매일 제안서) — D176 신규

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| operator_id | uuid FK → continuous_operators | |
| company_id | uuid FK | |
| proposal_json | jsonb | OrchestratorResult 통째로 박힘 (target/messages/channel/schedule/compliance/cost/performance/meta) |
| recipient_count | integer | |
| cost_estimate | integer | 원화 |
| status | varchar(20) DEFAULT 'pending' | pending / approved / rejected / auto_executed / expired |
| auto_executed | boolean DEFAULT false | ENT 자동 실행 임계값 통과 시 true |
| auto_execute_reason | text | 자동 실행 시 임계값 검증 결과 |
| reviewed_by | uuid FK → users | 사용자 승인/거부 시 |
| reviewed_at | timestamptz | |
| campaign_id | uuid FK → campaigns | 실행 시 박힘 |
| expires_at | timestamptz | 7일 후 자동 만료 (사용자 미응답 시) |
| created_at | timestamptz | |
| recap_notified_at | timestamptz | 성과 회고 문자(발송 다음날 9시) 멱등 마커 (2026-07-02 ALTER 실측 — information_schema 1row 확인) |
- INDEX: company_id, status, created_at DESC
- INDEX: operator_id, created_at DESC
- INDEX: status, expires_at WHERE status='pending' (만료 처리용)
- (updated_at 컬럼 없음 — UPDATE에 넣으면 조용히 실패, LESSONS_BACKEND)

### company_daily_briefs (오늘의 추천 — 회사 일일 마케팅 브리핑) — 2026-07-02 신규 (CREATE 실측·배포완료)

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK DEFAULT gen_random_uuid() | |
| company_id | uuid NOT NULL | 회사 격리 |
| brief_date | date NOT NULL | KST 날짜 — UNIQUE(company_id, brief_date) UPSERT |
| headline | text | 오늘의 한 줄 브리핑 |
| recommendations | jsonb DEFAULT '[]' | 추천 ≤3 {title, objective, reason, opportunityType, targetCount(실측 귀속), valueAtStake, recommendedChannel} |
| signals | jsonb DEFAULT '{}' | 수집 신호 원본 {opportunities, activeOperators, pendingProposals, yesterdayRecap, promotionCandidates} |
| created_at | timestamptz DEFAULT NOW() | |
- UNIQUE (company_id, brief_date) / INDEX idx_company_daily_briefs_lookup (company_id, brief_date DESC)
- 생성 = predictive-worker 매일 KST 9시(일일 분석 차감 1회에 포함, 추가 차감 0). 소비 = GET /api/ai/operator/daily-brief + /operator/self-diagnosis 동봉(좌측 진단 패널 단일 소스).

### company_marketing_calendars (마케팅 캘린더 저장 — 회사당 1행) — 2026-07-05 신규 (CREATE Harold 실행 대기, 코드 42P01 폴백)

| 컬럼 | 타입 | 비고 |
|------|------|------|
| company_id | uuid PK REFERENCES companies(id) ON DELETE CASCADE | 회사당 1행 UPSERT |
| entries | jsonb NOT NULL DEFAULT '[]' | AI 설계 12개월 [{month,title,objective,suggestedDay}] — 재생성 시 통째 교체 |
| registrations | jsonb NOT NULL DEFAULT '{}' | {"월": operator_id} — 등록 이력(재생성에도 유지, 같은 달 중복 등록 409 차단) |
| created_at | timestamptz NOT NULL DEFAULT NOW() | |
| updated_at | timestamptz NOT NULL DEFAULT NOW() | |
- 생성/소비 = utils/marketing-calendar-store.ts CT 단일 진입점 (routes/ai.ts generate 저장·GET 조회·POST /operator/continuous calendar_month 등록 기록).

### D176 운영 환경 실행 SQL (Harold 직접)

```sql
-- 12. companies ALTER 3 컬럼 (ENT 자동 실행 옵션)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cdp_auto_execute_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cdp_auto_execute_max_recipients integer NOT NULL DEFAULT 1000;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cdp_auto_execute_max_cost_krw integer NOT NULL DEFAULT 50000;

-- 13. continuous_operators
CREATE TABLE IF NOT EXISTS continuous_operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  name varchar(100) NOT NULL,
  objective text NOT NULL,
  schedule varchar(20) NOT NULL DEFAULT 'daily',
  schedule_time varchar(10) NOT NULL DEFAULT '09:00',
  status varchar(20) NOT NULL DEFAULT 'active',
  last_run_at timestamptz,
  next_run_at timestamptz,
  total_proposals integer NOT NULL DEFAULT 0,
  total_approved integer NOT NULL DEFAULT 0,
  total_rejected integer NOT NULL DEFAULT 0,
  total_auto_executed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_continuous_operators_active ON continuous_operators(company_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_continuous_operators_next_run ON continuous_operators(status, next_run_at) WHERE status = 'active';

-- 14. operator_proposals
CREATE TABLE IF NOT EXISTS operator_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES continuous_operators(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  proposal_json jsonb NOT NULL,
  recipient_count integer NOT NULL DEFAULT 0,
  cost_estimate integer NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'pending',
  auto_executed boolean NOT NULL DEFAULT false,
  auto_execute_reason text,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proposals_company ON operator_proposals(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_operator ON operator_proposals(operator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_expires ON operator_proposals(status, expires_at) WHERE status = 'pending';
```

### D172 운영 환경 실행 SQL (Harold 직접 진행)

```sql
-- 1. companies 컬럼 ALTER
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cdp_api_key varchar(100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cdp_api_secret_hash varchar(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cdp_api_key_issued_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_companies_cdp_api_key ON companies(cdp_api_key) WHERE cdp_api_key IS NOT NULL;

-- 2. plans 컬럼 ALTER
ALTER TABLE plans ADD COLUMN IF NOT EXISTS cdp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS cdp_events_per_month integer;

-- BUSINESS+ 베타 진입은 cdp_enabled = true. 한도는 plan별로 박음.
UPDATE plans SET cdp_enabled = true, cdp_events_per_month = 1000000 WHERE plan_code = 'BUSINESS';
UPDATE plans SET cdp_enabled = true, cdp_events_per_month = NULL WHERE plan_code = 'ENTERPRISE';
UPDATE plans SET cdp_events_per_month = 100000 WHERE plan_code = 'PRO';
UPDATE plans SET cdp_events_per_month = 10000 WHERE plan_code = 'BASIC';

-- 3. cdp_identity_links
CREATE TABLE IF NOT EXISTS cdp_identity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  source varchar(30) NOT NULL,
  external_id varchar(200) NOT NULL,
  external_email varchar(150),
  external_phone varchar(20),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_cdp_identity_links_customer ON cdp_identity_links(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cdp_identity_links_email ON cdp_identity_links(company_id, external_email) WHERE external_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cdp_identity_links_phone ON cdp_identity_links(company_id, external_phone) WHERE external_phone IS NOT NULL;

-- 4. cdp_events
CREATE TABLE IF NOT EXISTS cdp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  identity_link_id uuid REFERENCES cdp_identity_links(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  event_name varchar(50) NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}',
  source varchar(30) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cdp_events_company_occurred ON cdp_events(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cdp_events_company_event ON cdp_events(company_id, event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cdp_events_customer ON cdp_events(customer_id, occurred_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cdp_events_company_created ON cdp_events(company_id, created_at DESC);

-- 5. cdp_webhook_deliveries
CREATE TABLE IF NOT EXISTS cdp_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source varchar(30) NOT NULL,
  webhook_event varchar(100) NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  payload jsonb,
  status varchar(20) NOT NULL DEFAULT 'received',
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, source, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_cdp_webhook_status ON cdp_webhook_deliveries(company_id, status, created_at DESC);

-- 6. cdp_api_call_log
CREATE TABLE IF NOT EXISTS cdp_api_call_log (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  endpoint varchar(50) NOT NULL,
  call_count integer NOT NULL DEFAULT 1,
  status_code integer NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cdp_api_call_log_company ON cdp_api_call_log(company_id, occurred_at DESC);
```

---

### D178~D181 신규 SQL (Harold 직접 PostgreSQL 박을 영역, 7건)

> **현재 박지 X 영역** — Harold 박은 후 본 영역 갱신 박음. 환경변수 박음도 정합 박음.

```sql
-- ════════════════════════════════════════════════════════════════════
-- D177 Self-Optimizing Bandit (Thompson Sampling)
-- ════════════════════════════════════════════════════════════════════

-- 1. operator_proposal_variants — 메시지 변형 + Beta-Bernoulli posterior 박음
CREATE TABLE IF NOT EXISTS operator_proposal_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES operator_proposals(id) ON DELETE CASCADE,
  variant_index integer NOT NULL,
  message_body text NOT NULL,
  byte_count integer NOT NULL DEFAULT 0,
  arm_alpha numeric NOT NULL DEFAULT 1.0,
  arm_beta numeric NOT NULL DEFAULT 1.0,
  sent_count integer NOT NULL DEFAULT 0,
  click_count integer NOT NULL DEFAULT 0,
  conversion_count integer NOT NULL DEFAULT 0,
  reward_total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (proposal_id, variant_index)
);
CREATE INDEX IF NOT EXISTS idx_proposal_variants_proposal ON operator_proposal_variants(proposal_id);

-- ════════════════════════════════════════════════════════════════════
-- D178 인바운드 음성 AI (Naver Clova)
-- ════════════════════════════════════════════════════════════════════

-- 2. voice_inbound_calls — 인바운드 통화 이력 + 트랜스크립트 사후 확인
CREATE TABLE IF NOT EXISTS voice_inbound_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  caller_phone varchar(50) NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  transcript text NOT NULL,
  ai_response text NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  status varchar(50) NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voice_inbound_company_created ON voice_inbound_calls(company_id, created_at DESC);

-- 3. companies ALTER — 회사 admin 음성 AI 활성/비활성 토글
ALTER TABLE companies ADD COLUMN IF NOT EXISTS voice_inbound_enabled boolean NOT NULL DEFAULT false;

-- ════════════════════════════════════════════════════════════════════
-- D180 Email 채널 (SendGrid)
-- ════════════════════════════════════════════════════════════════════

-- 4. email_campaigns — Email 캠페인 메타 + 통계
CREATE TABLE IF NOT EXISTS email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  name varchar(200) NOT NULL,
  subject varchar(200) NOT NULL,
  html_body text NOT NULL,
  text_body text,
  from_name varchar(100),
  from_email varchar(200),
  is_ad boolean NOT NULL DEFAULT false,
  scheduled_at timestamptz,
  sent_at timestamptz,
  status varchar(50) NOT NULL DEFAULT 'draft',
  sent_count integer NOT NULL DEFAULT 0,
  open_count integer NOT NULL DEFAULT 0,
  click_count integer NOT NULL DEFAULT 0,
  bounce_count integer NOT NULL DEFAULT 0,
  unsubscribe_count integer NOT NULL DEFAULT 0,
  ai_generated boolean NOT NULL DEFAULT false,  -- ★ 2026-06-13 추가 (ALTER 필요) — AI 생성 캠페인 발송 시 30크레딧 분기
  target_spec jsonb,                            -- ★ 2026-06-13 추가 (ALTER 필요) — 예약 발송 대상 명세 {type:'customers',grades[]} | {type:'list',recipients[]}
  sections jsonb,                               -- ★ 실측 (운영 존재) — 비주얼 빌더 Section[] (null = manual HTML)
  parent_campaign_id uuid REFERENCES email_campaigns(id) ON DELETE SET NULL, -- ★ 2026-07-06 추가 (ALTER 필요) — 미수신자 재발송 자식이면 원본 id (null=원본)
  resend_generation integer NOT NULL DEFAULT 0, -- ★ 2026-07-06 추가 (ALTER 필요) — 원본=0, 재발송본=1 (재발송 1회 한도 판정)
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_company_created ON email_campaigns(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_parent ON email_campaigns(parent_campaign_id) WHERE parent_campaign_id IS NOT NULL;
-- ALTER (운영 적용 SQL):
--   ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS ai_generated boolean NOT NULL DEFAULT false;
--   ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS target_spec jsonb;
--   ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS sections jsonb;
--   ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS parent_campaign_id uuid REFERENCES email_campaigns(id) ON DELETE SET NULL;
--   ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS resend_generation integer NOT NULL DEFAULT 0;

-- 5. email_events — 자체 트래킹 적재 (open/click/bounce/unsubscribe/delivered). 2026-06-13 자체 픽셀/링크 발신부 신설.
CREATE TABLE IF NOT EXISTS email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  email varchar(200) NOT NULL,
  event_type varchar(50) NOT NULL,
  url text,
  reason text,
  occurred_at timestamptz NOT NULL,
  auto_processed boolean DEFAULT false,  -- ★ 실측 (운영 존재) — bounce/spam/unsubscribe 자동 처리 완료 표식
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_events_campaign ON email_events(campaign_id, occurred_at DESC);

-- ════════════════════════════════════════════════════════════════════
-- D181 Phase 1 영구 개선 (Anthropic Memory + Batch API)
-- ════════════════════════════════════════════════════════════════════

-- 6. ai_company_memory — 회사별 누적 학습 (Anthropic Memory 패턴)
CREATE TABLE IF NOT EXISTS ai_company_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  memory_type varchar(50) NOT NULL,  -- 'success_pattern' / 'customer_insight' / 'brand_tone_evolution' / 'channel_performance' / 'compliance_learning'
  memory_key varchar(200) NOT NULL,
  memory_value text NOT NULL,
  importance integer NOT NULL DEFAULT 5,  -- 1~10
  source varchar(100) NOT NULL DEFAULT 'ai_auto',  -- 'ai_auto' / 'admin_input' / 'campaign_result'
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_accessed_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, memory_type, memory_key)
);
CREATE INDEX IF NOT EXISTS idx_ai_company_memory_company_type ON ai_company_memory(company_id, memory_type);
CREATE INDEX IF NOT EXISTS idx_ai_company_memory_importance ON ai_company_memory(company_id, importance DESC, last_accessed_at DESC);

-- 7. ai_batch_jobs — Anthropic Batch API 박은 영역
CREATE TABLE IF NOT EXISTS ai_batch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  batch_id varchar(100) NOT NULL UNIQUE,
  model varchar(100) NOT NULL,
  total_requests integer NOT NULL,
  status varchar(50) NOT NULL DEFAULT 'submitted',  -- 'submitted' / 'processing' / 'completed' / 'failed' / 'expired'
  succeeded_count integer NOT NULL DEFAULT 0,
  errored_count integer NOT NULL DEFAULT 0,
  expired_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT NOW(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_batch_jobs_company ON ai_batch_jobs(company_id, submitted_at DESC);
```

---

### D187 Journey Builder Lite (Harold 직접 PostgreSQL 실행 영역, 4 테이블 + 6 인덱스)

> **현재 미적용 영역** — Harold 직접 실행 후 본 영역 갱신. 환경변수 변경 없음.

```sql
-- ════════════════════════════════════════════════════════════════════
-- D187 Journey Builder Lite Step 1 (2026-05-20)
-- 7 표준 여정 (가입/재구매/휴면/장바구니/생일/예약/Custom) + 트리거 기반 자동 step 진행
-- Continuous Operator (D176) + Memory tool (D181) 통합
-- ════════════════════════════════════════════════════════════════════

-- 1. journeys — 회사별 활성 여정
CREATE TABLE IF NOT EXISTS journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  template_code varchar(30) NOT NULL,           -- 'onboarding' | 'repeat' | 'dormant' | 'cart' | 'birthday' | 'reservation' | 'custom'
  trigger_event varchar(50) NOT NULL,
  trigger_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'draft',  -- 'draft' | 'active' | 'paused' | 'ended'
  budget_monthly numeric(15,2),                  -- NULL = 무제한 (회사 자유 설정)
  allow_reentry boolean NOT NULL DEFAULT false,
  reentry_cooldown_days integer,
  threshold_recipients_per_step integer,         -- NULL = 무제한 (회사 자유 설정)
  threshold_cost_per_step numeric(15,2),         -- NULL = 무제한 (회사 자유 설정)
  threshold_risk_level varchar(10) NOT NULL DEFAULT 'low',  -- 'low' | 'medium' | 'high'
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  paused_at timestamptz,
  pause_reason text,
  stats_total_entered integer NOT NULL DEFAULT 0,
  stats_total_completed integer NOT NULL DEFAULT 0,
  stats_total_cost numeric(15,2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- 2. journey_steps — 여정 step 정의
CREATE TABLE IF NOT EXISTS journey_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  step_type varchar(20) NOT NULL,                -- 'message' | 'wait' | 'condition'
  delay_hours integer NOT NULL DEFAULT 0,
  channel varchar(20),                            -- 'sms' | 'lms' | 'mms' | 'kakao' | 'email'
  message_template text,
  subject varchar(50),                            -- D187-fix4: LMS/MMS 제목 (KISA 2026-05 + 통신사 정책 — LMS/MMS 발송 시 필수)
  is_ad boolean NOT NULL DEFAULT true,            -- D187-fix2: 광고 표기 자동 합성 (buildAdMessage + buildAdSubject)
  condition_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (journey_id, step_order)
);

-- 3. journey_executions — 고객별 여정 실행 상태 (UNIQUE 제거, 재진입 정합)
CREATE TABLE IF NOT EXISTS journey_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  current_step_order integer NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'active',  -- 'active' | 'completed' | 'paused' | 'failed'
  entered_at timestamptz NOT NULL DEFAULT NOW(),
  next_run_at timestamptz,
  completed_at timestamptz,
  total_cost numeric(15,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  entry_event_properties jsonb  -- ★ 2026-06-22 실측: 진입 이벤트 데이터(주문번호·상품명 등) — 알림톡 정보알림 변수 치환용 (Harold ALTER 실행)
);

-- 4. journey_step_logs — 각 step 실행 이력
CREATE TABLE IF NOT EXISTS journey_step_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES journey_executions(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES journey_steps(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT NOW(),
  status varchar(20) NOT NULL,                    -- 'sent' | 'failed' | 'skipped'
  cost numeric(15,2) NOT NULL DEFAULT 0,
  error_reason text
);

-- 인덱스 6건
CREATE INDEX IF NOT EXISTS idx_journeys_company_status ON journeys(company_id, status);
CREATE INDEX IF NOT EXISTS idx_journey_steps_journey_order ON journey_steps(journey_id, step_order);
CREATE INDEX IF NOT EXISTS idx_journey_executions_due ON journey_executions(next_run_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_journey_executions_customer ON journey_executions(customer_id);
CREATE INDEX IF NOT EXISTS idx_journey_executions_journey_status ON journey_executions(journey_id, status, entered_at DESC);
CREATE INDEX IF NOT EXISTS idx_journey_step_logs_execution ON journey_step_logs(execution_id, sent_at DESC);
```

### ★ 2026-06-29 information_schema 실측 대조 (Harold 제공 — 재질의 금지, 이 기록 신뢰)
운영 PG `information_schema`로 `customers` · `cdp_events` · `journeys` · `journey_executions` 4개 테이블 실측 대조 완료.
- `customers` · `cdp_events`(위 6컬럼 보강 반영) = 문서와 일치.
- `journeys` baseline DDL 외 실측 추가 컬럼(정본): `callback_number`(varchar) · `callback_mode`(text) · `auto_reentry_enabled`(boolean) · `archived_at`(timestamptz) · `pretest_notify_step_defaults`(jsonb) · `entry_baseline_at`(timestamptz) · `last_event_cursor`(timestamptz) · `last_pretest_passed_at`(timestamptz)
- `journey_executions` baseline DDL 외 실측 추가 컬럼(정본): `error_log`(jsonb) · `last_error_at`(timestamptz) · `error_count`(integer) · `result_notified_at`(timestamptz)

### ★ 2026-06-30 information_schema 실측 — journey_steps 전체 21컬럼 (Harold 제공, 재질의 금지)
운영 PG 실측. baseline DDL(9컬럼) 외 ALTER 누적 정본 — `journey_steps` 현재 컬럼:
1 id(uuid) · 2 journey_id(uuid) · 3 step_order(int) · 4 step_type(varchar) · 5 delay_hours(int d0) · 6 channel(varchar) · 7 message_template(text) · 8 condition_jsonb(jsonb) · 9 created_at(timestamptz) · 10 is_ad(bool d true) · 11 subject(varchar) · 12 alimtalk_profile_id(uuid) · 13 alimtalk_template_code(varchar) · 14 alimtalk_variable_map(jsonb) · 15 alimtalk_next_type(varchar) · 16 alimtalk_next_contents(text) · 17 alimtalk_next_subject(varchar) · 18 mms_image_paths(ARRAY) · 19 delay_mode(varchar d 'relative') · 20 target_hour_kst(int) · 21 notify_manager_on_pretest(bool)
- 여정 일반화 ALTER **적용 완료(2026-06-30, Harold 실행)**: `journey_steps.anchor_offset_days`(int) — date_anchor D-N offset. journeys 측 = `start_kind`(varchar20 NOT NULL default 'event')·`anchor_date`(date)·`anchor_recurrence`(varchar20 NOT NULL default 'none')·`anchor_recurrence_day`(int)·`anchor_hour_kst`(int)·`one_shot_scheduled_at`(timestamptz). + 신규 테이블 `journey_anchor_dispatch`(journey_id·step_id·customer_id·send_date·campaign_id·created_at, PK(journey_id,step_id,customer_id,send_date)) — date_anchor 단발 발송 멱등. + idx_journeys_start_kind_status.
- 운영 `customer.points_expiring` 여정 = **0건**(2026-06-30). 운영 여정 row 자체 0(아직 여정 사용 업체 없음) → start_kind 마이그레이션 backfill 불요 · points_expiring 흡수 마이그레이션 불요(코드 일반화만). 단 코드 경로 회귀 차단(9트리거·발송·통계)은 유지.

### 여정 엔진 재설계 신규 (2026-06-04 세션2 — Harold 실행: `docs/superpowers/plans/2026-06-04-journey-redesign.sql`)

> 미적용 — Harold 직접 PG 실행 후 갱신.

- **journeys.entry_baseline_at** `timestamptz` — 신규가입 baseline 설정 시각(첫 활성화 1회·불변). created_at 의존 제거(진입 원장 anti-join 모드 가름).
- **journeys.last_event_cursor** `timestamptz` — cdp 구매·예약 이벤트 처리 커서(이 시각 이후~지금 전수 처리 → 워처 멈춰도 누락 0).
- **journey_entry_ledger**(`journey_id` uuid FK→journeys CASCADE, `company_id` uuid, `store_code` varchar null, `phone` varchar, `kind` varchar 'baseline'|'entered', `created_at`) · **UNIQUE(journey_id, company_id, COALESCE(store_code,'__NONE__'), phone)** + idx(journey_id) — 신규가입 "전에 본 적 없는 식별자"만 진입. 키 = 시스템 upsert 식별자(회사+매장코드+전화번호).
- **journey_step_campaigns**(`journey_id` uuid FK→journeys CASCADE, `step_id` uuid, `send_date` date, `campaign_id` uuid, `created_at`) · **PK(journey_id, step_id, send_date)** — 묶음 발송: (journey,step,KST날짜)당 campaign 1건 공유(발송결과 1줄 + app_etc1=campaignId 상세 검색).
