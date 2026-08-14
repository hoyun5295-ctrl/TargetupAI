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
| 59 | agent_charge_requests | 에이전트 충전 **실행** 요청 원장 (2026-07-24 §5-3 신설·DDL 적용완료 — 멱등키 UNIQUE·감사. 게이트웨이 잔액/반영의 진실은 여전히 62 `RSRM_FillAmtHist`) |
| 60 | agent_charge_orders | 에이전트 충전 **요청**(고객사 접수) — §5-4. 웹 `deposit_requests`와 축이 달라 별도 테이블(승인 시 올라가는 지갑이 다르다). **2026-08-11 운영 실존 확인** — 신청 원장일 뿐 지갑 원장이 아니다(직원 직접 충전은 여기 안 남는다) |
| 61 | planner_events | 마케팅 플래너 행사 원장(월간 계획·혜택은 고객사 기입). **2026-08-12 운영 CREATE 완료 — 12컬럼 실측 확인.** 설계서 = `docs/2026-08-12-ax-marketing-planner-design.md` §5-1 |
| 62 | planner_touchpoints | 플래너 터치포인트(행사×채널×시점). **2026-08-12 운영 CREATE 완료 — 12컬럼 실측 확인**(`id·event_id·company_id·channel·timing_rule·format·est_credits·status·lock_reason·asset_ref·exec_ref·created_at` — **updated_at 없음, 쓰기 SQL에 넣지 말 것**). 발송 예정일은 저장하지 않고 조회 시 계산(행사 기간 수정 시 자동 추종 — 이중 진실 금지). **★2026-08-13 Phase 3 ADD 대기 = `exec_meta jsonb NOT NULL DEFAULT '{}'`**(채널별 실행 참조 — 알림톡 template_key·선점 시각·보류 사유·재제출 카운트. uuid 컬럼으로는 못 담는다). 대상 축(전체/참여자)은 `timing_rule.audience`가 갖는다(컬럼 신설 0). 코드 폴백 = 워커 4종이 `exec_meta` 실재를 단일 게이트로 확인하고 없으면 통째로 쉰다(부분 실행 금지) |
| 63 | planner_monthly_approvals **(2026-08-13 운영 CREATE 완료 — 19컬럼 실측 확인)** | 플래너 **월간 승인 원장**(Phase 2). `id uuid PK DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), plan_month varchar(7) NOT NULL, status varchar(20) NOT NULL DEFAULT 'pending' CHECK IN (pending·approving·approved·cancelled), agency_credits integer NOT NULL DEFAULT 0, est_snapshot jsonb NOT NULL DEFAULT '{}', event_ids uuid[] NOT NULL DEFAULT '{}', plan_hash varchar(64), approve_attempt uuid, deduct_idempotency_key varchar(120), deducted_at timestamptz, token varchar(64), token_expires_at timestamptz, submitted_by uuid, submitted_at timestamptz, approved_by uuid, approved_at timestamptz, created_at·updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id, plan_month)`. `event_ids` = **제출 스냅샷**(승인 대상은 그 목록뿐 — 서류에 없던 행사는 승인되지 않는다) · `plan_hash` = **결재 서류 지문**(행사 ID가 같아도 혜택·기간·상품·채널·시점·단가가 바뀌면 다른 서류 → 재결재) · `approve_attempt` = 승인 시도 소유권(선점이 서류를 함께 돌려주고, 복구·확정을 같은 시도에 묶는다. 10분 lease로 회수). 차감 멱등키는 `ai_credit_transactions.idempotency_key`와 같은 값(`planner:{회사}:{YYYY-MM}`)이라 두 원장이 그 키로 대조된다. 코드 42P01 폴백(브리핑 503 · 캘린더 배너 생략). **★2026-08-13 Phase 4 ADD 대기 = `result_notified_at timestamptz`**(월말 결과 통지 멱등 — 없으면 통지 패스만 쉰다. 결과 화면은 이 컬럼과 무관하게 동작) |
| - | ai_training_logs | 문안 학습 로그 (회사별 tenant_ref HMAC 격리). ★ 2026-07-03 실측: `ck_training_message_type` CHECK = message_type IN ('SMS','LMS','MMS','KAKAO','EMAIL','DM') — DM 추가(전 채널 학습 통합 Phase 1). 적재=fire-and-forget 격리(발송 무영향), source_ref 멱등 |
| - | ai_training_logs (클릭·전환 컬럼) | `click_count int` · `conversion_count int` — Tier1 반응 신호(DM·이메일 클릭 환류, 랭커/검색기 클릭 우선 정렬). **★2026-08-11 information_schema 실측 = 둘 다 실존**(0704 "ADD 대기" 표기는 낡은 기록 — `operator_proposals.conversion_attributed_at`·`operator_proposal_variants.sent/click/conversion_count`도 같은 실측으로 실존 확인). ⚠값 유입은 DM·이메일 클릭뿐 — SMS/LMS 클릭(short-url→변이 테이블)은 이 원장에 미배선(자기 개선 루프 설계의 Phase 0) |
| - | best_copy_seed_usage **(2026-07-04 CREATE 대기)** | 시드 사용 기록(성과 환류). `id bigserial PK, seed_id uuid, tenant_ref varchar(64)=getTenantRef, channel varchar(10), used_at timestamptz`. INDEX(seed_id),(tenant_ref,used_at). 코드 42P01 폴백(미생성 무영향) |
| - | best_copy_assets **(2026-07-04 CREATE 대기)** | 업종 승리공식·AI 재창작 예시. `id uuid PK, kind varchar(20)[formula\|style_example], industry_code varchar(20), channel varchar(10), is_ad bool, content text, meta jsonb, created_at timestamptz`. INDEX(kind,industry_code). 코드 42P01 폴백 |
| - | send_fatigue_daily **(2026-07-05 CREATE 대기)** | 발송 피로도 일일 버킷(광고성 문자+알림톡 합산, day=KST). `company_id uuid NOT NULL, phone varchar(20) NOT NULL, day date NOT NULL, sent_count int NOT NULL DEFAULT 0, PK(company_id,phone,day)` + INDEX(day). 45일 초과 프루닝(fatigue-guard 6h 워커). 코드 42P01 폴백(미생성=게이트·카운터 비활성) |
| - | companies **(2026-07-05 ADD 대기)** | `fatigue_cap_days int` · `fatigue_cap_max int` — 발송 피로도 상한(최근 N일 M건). NULL=비활성(opt-in — 회사가 설정 화면에서 켠 경우만 게이트). 코드 42703 폴백. `ALTER TABLE companies ADD COLUMN fatigue_cap_days integer; ALTER TABLE companies ADD COLUMN fatigue_cap_max integer;` |
| - | companies **(2026-08-04 ADD 실행완료)** | `automarketing_exclude_journey boolean` — 여정 진행 중(`journey_executions.status='active'`) 고객을 자동마케팅 대상에서 제외(Harold 확정, opt-in — NULL/false=현행 겹침 허용). 소비 = 자동마케팅 단일 문 게이트뿐(`operator-audience.getExcludeInJourneySetting`), 여정·캠페인 무관. 코드 42703 폴백 |
| - | operator_cycle_snapshots **(2026-08-04 CREATE 실행완료)** | 자동마케팅 **회차 스냅샷** — 변화 축 5종의 유일한 근거(오퍼레이터별 직전 한 벌). `operator_id uuid NOT NULL REFERENCES continuous_operators(id) ON DELETE CASCADE, company_id uuid NOT NULL, customer_id uuid NOT NULL, grade varchar(50), purchase_count integer, total_purchase_amount numeric(15,2), recent_purchase_date date, observed_at timestamptz NOT NULL DEFAULT NOW(), PK(operator_id, customer_id)` + INDEX(company_id). 쓰기 2문뿐 — 보충(DO NOTHING)·발송분 갱신(DO UPDATE). 코드 42P01 폴백. 계약 = [자동마케팅 문서](../docs/FEATURE-AUTOMARKETING.md) §4 |

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

### campaign_runs (캠페인 실행) — 2026-07-30 information_schema 실측 일치(16컬럼)
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
| send_channel | varchar(20) | ★2026-07-29 ALTER 실행 완료(옛 varchar(10)에 `kakao_brand` 11자가 안 들어가 22001 — SoT 브랜드 재구축 §0). 값을 늘릴 땐 길이부터 확인 |
| send_phase | varchar(20) | ★ 실측 (발송 단계). 값: queued/processing/sent/failed + **preparing**(2026-07-31 신설 — 차감 완료 전 워커 픽업 차단). **CHECK 제약 없음**(2026-07-31 pg_constraint 실측 — campaigns의 CHECK는 message_type·status 2건뿐) |
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
| status | varchar(20) | 회사 상태. 코드가 쓰는 값 = `active`·`suspended`(정지)·`terminated`(해지)·`locked`(잠금)·`dormant`(휴면) — 라벨 맵 `AdminDashboard.tsx`. **`NULL`·미설정은 활성으로 취급한다**(판정이 전부 `!== 'terminated'` 형태의 부정 비교라 NULL이 통과한다). 해지 = `UPDATE companies SET status='terminated'`(`routes/admin.ts`) — **해지 시각을 남기는 컬럼이 없다**(`updated_at`은 다른 수정으로도 갱신되어 근거가 못 된다). 그래서 "해지 이후 기간만" 같은 시점 판정은 이 테이블만으로 불가능하다(★2026-08-04 서수란 접수 — 일괄발급 해지 제외 근거) |
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
| cost_per_spam_filter | numeric | ★ 실측 — **코드 소비처 0건(사장 컬럼)**. 스팸필터는 `cost_per_sms/lms`를 그대로 쓴다(D16) |
| unit_price_basis | varchar(20) NOT NULL DEFAULT `'vat_excluded'` | ★ 2026-07-26 ALTER 적용 — **`cost_per_*` 값이 부가세 포함인가 별도인가.** `vat_included`(전환 전 값) / `vat_excluded`(공급가 — 전 77사 마이그레이션 완료). 청구는 공급가, 선불 차감·화면 표시는 부가세 포함가를 쓰는데 그 변환 방향을 이 값이 정한다. 전 회사 전환 완료 시 `vat_included` 분기와 함께 제거 대상. CT=`utils/unit-price.ts`<br>**DEFAULT 실측 = `'vat_excluded'`** (2026-07-27 `information_schema.columns.column_default` 확인 — 신규 회사가 공급가 기준으로 생성된다. 옛 기재 `DEFAULT 'vat_included'`는 마이그레이션 전 값이라 정정) |
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

### company_agent_ids (에이전트 발송ID 매핑 → 에이전트 계정 원장 — 2026-07-03 신설 실측 · 2026-07-24 원장 격상 ALTER 실측)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK DEFAULT gen_random_uuid() |
| company_id | uuid FK → companies ON DELETE CASCADE |
| agent_send_id | varchar(100) NOT NULL UNIQUE (QTmsg 발송ID — 전역 유일, 역매핑용. =게이트웨이 CustId·FillAmtHist.StoreId 축) |
| memo | varchar(200) |
| created_at | timestamptz NOT NULL DEFAULT NOW() |
| billing_type | varchar NOT NULL DEFAULT 'postpaid' CHECK (prepaid/postpaid) — ★2026-07-24 발송ID별 선/후불 (웹 companies.billing_type과 완전 독립) |
| cost_per_sms | numeric NULL — ★2026-07-24 발송ID별 단가 (NULL=미설정) |
| cost_per_lms | numeric NULL — ★2026-07-24 |
| cost_per_mms | numeric NULL — ★2026-07-24 |
| cost_per_kakao | numeric NULL — ★2026-07-24 |
- INDEX idx_company_agent_ids_company (company_id)
- 2026-07-24 ALTER 적용 실측: 10컬럼·기존 283행 전부 postpaid. 잔액은 컬럼 없음(이중 진실 금지 — 게이트웨이 RSRM_SalesStts.RemAmt 최신 DestDt 행을 조회만). SoT=docs/2026-07-24-agent-prepaid-charge-design.md

### [외부 MySQL] sales.RSRM_SalesStts — 에이전트(PAY 엔진) 발송 통계 ★2026-07-25 등재

> **PG가 아니다. 별도 MySQL 컨테이너 `pay-ingest-db`에 있다.** 강문희 쪽 게이트웨이가 여기로 push하고 우리는 읽기만 한다.
> 여기 없어서 매번 컬럼을 추측하다 `SuccCnt`(존재하지 않음) 오류가 났다. **성공 컬럼은 `OkCnt`다.**

**접속** — 앱: `PAY_STATS_DB_*` env (host 기본 `127.0.0.1`, port **23388**, db **`sales`**, user `paystats`).
`paystats`·`hanjul_ro`는 `172.%`(도커 브리지)에서만 붙는다. **컨테이너 안에서 `docker exec`로 접속하면 출처가 `localhost`라 권한이 없다** — 그때는 `root@localhost`를 쓴다.
`sales@139.150.81.213 / 58.227.193.54 / .57 / .58` = 게이트웨이 push 계정(그 4개 IP만 허용).

| 컬럼 | 용도 |
|------|------|
| CustId | **발송ID**. `company_agent_ids.agent_send_id`와 매칭되는 회사 축 |
| StoreId | **대상ID**. 발송 시 입력하는 청구 구분 축(지점·브랜드). 빈 값 가능 |
| DestDt | 일자 **`YYYYMMDD` 문자열**(date 아님). 기간 필터는 문자열 비교 |
| MsgType | 유형 코드 S/L/M/K/X(+KS·KL 대체발송) · **`G` = 브랜드메시지(구 친구톡)** ★2026-07-29 Harold 확인. `pay-stats.ts AGENT_MSG_TYPE_LABEL` 미등재라 화면에 코드가 그대로 노출됐고(0729 등재), 단가 축(`company_agent_ids.cost_per_*` 4개)에 브랜드가 없어 **발행이 차단된다**(0원 조용한 축소가 아니다 — `send-usage-aggregation.ts` `agentUsageKey`가 미매핑 코드를 원본 그대로 유형키로 남기고 `findUnbillableUsageKeys`가 발행 시점에 잡는다. 여미지 B0227 7월 성공 42,833건이 그 자리) |
| TotCnt | 전송 |
| **OkCnt** | **성공** (★`SuccCnt` 아님 — 청구 수량의 기준) |
| FailCnt | 실패 |
| ReadyCnt | 대기. **음수가 관측된다**(게이트웨이 원천값이 완료분을 차감) — 우리 파생 아님 |
| RemAmt | ⛔ **잔액 소스로 쓰지 말 것**(★2026-07-27 정정). 통계 적재 시점의 스냅샷이고 계정에 따라 **전 기간 0**이다(C0130 실측 — 원장은 640,281.625). 현재 잔액은 `RSRM_SalesMst.RemAmt` |
| SysId | 수집 서버 구분 |

- 소비 CT = `utils/pay-stats.ts`(집계 SQL 전량). 월 확장은 `utils/stats-period.ts` 공용.
- 2026-07-25 실측: 청구서(`billing.ts`)는 이 테이블을 **전혀 읽지 않는다** → `usage_type='both'` 회사(금강제화 등)의 에이전트 발송분이 청구서에서 통째로 누락. 재구성 대상.

### [외부 MySQL] sales.RSRM_SalesMst — 발송ID 원장(발급명) ★2026-07-27 등재

> 같은 `pay-ingest-db`(62)에 있다. **발송ID 표시명(발급명)의 유일한 소스**다 — 우리 PG에는 표시명 컬럼이 없고, 두지 않는다.
> 한 회사가 발송ID를 여럿 갖는 게 기본이라(런소프트 = C0130·D0078·D0079) 회사명으로 대체하면 세 줄이 같은 이름으로 보인다.

| 컬럼 | 용도 |
|------|------|
| CustId | **발송ID**. `company_agent_ids.agent_send_id`·`RSRM_FillAmtHist.StoreId`와 같은 축 |
| CustNm | **발급명**(= PAY에 저장된 고객사명). 예 `C0130 런소프트3` · `D0078 런소프트` · `D0079 런소프트2` |
| **RemAmt** | **현재 잔액 (float) — 잔액의 유일한 소스.** ★2026-07-27 확정. 발송이 나가는 대로 실시간으로 깎인다(D0078 4,881,401.2 → 몇 분 뒤 4,881,227.5). 62·143 값 완전 일치 |
| StoreId | **`StoreId = CustId`인 행이 계정 대표 행**이고 잔액은 거기 실린다. 지점 행은 대개 0 |
| UpdTm · SeqNo | `UpdTm` = **계정 생성·정보 수정 시각**(2023~2024에 멈춰 있다) — ⛔ 잔액 갱신 시각이 아니다. 최신행 결정은 `SeqNo`/`ORDER BY CustId, UpdTm DESC, SeqNo DESC` |
| PayTp · StoreNm · MobNo · Email · Memo | PAY 회원 원장 컬럼(미사용) |

- 2026-07-27 실측: **730행 · 발급명 빈 값 0건**(499 CustId — 계정×지점으로 한 CustId에 여러 행).
- 다중 행 계정 실측: 대부분 대표 행 1개에만 잔액이 실린다. **대표 행이 없는 계정도 있다**(`B0046` 200행·`B0021`·`B0062`) → 그 계정은 지점 행을 **합산하지 않고 미확정(null)** 처리한다(근거 없는 합산 금지).
- 소비 CT = `utils/pay-stats.ts` — `fetchCustNames`(IN 조회, 통계 경로) · `getAgentCustNameMap`(전량 60초 캐시, 화면 공용) · `formatAgentIdLabel`(`발송ID / 발급명`) · **`queryPayAgentBalances`/`pickLedgerBalances`(잔액)**.
- 조회 실패·env 미설정 = 이름 없이 발송ID만·잔액은 빈 배열(폴백). 이름·잔액 때문에 화면이 500이 되면 안 된다.

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
> **유니크 인덱스 (2026-08-14 pg_indexes 실덤프)**: `customers_company_id_phone_key`(company_id, phone) ·
> `idx_customers_company_store_phone`(company_id, COALESCE(store_code,'__NONE__'), phone) ·
> `idx_customers_code`(company_id, customer_code) WHERE customer_code IS NOT NULL.
> **폰 키가 진실이다 — 폰당 고객 1행, 다매장은 customer_stores가 소유.** upsert ON CONFLICT는 (company_id, phone)
> (2026-08-14 정정 — 옛 arbiter가 store 표현식 인덱스를 보고 있어 매장 바뀐 고객이 영구 실패했다. 이새 164건).
> store 표현식 인덱스는 정정 배포 후 죽은 인덱스 — DROP 예정. customer_code 키는 arbiter 밖(같은 코드·다른 폰 = 실패 로그).

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
| entry_source | varchar(20) | ★ 2026-07-15 ALTER **대기** — 공용 링크 유입원(한글 별칭 slug·NFC). 격리 UPDATE라 미실행이어도 추적 무결 |
- INDEX: idx_dm_views_token (dm_id, recipient_token) WHERE recipient_token IS NOT NULL ★ 2026-07-02
- INDEX: idx_dm_views_anon (dm_id, anonymous_id) WHERE anonymous_id IS NOT NULL ★ 2026-07-02
- INDEX: idx_dm_views_entry_source (dm_id, entry_source) WHERE entry_source IS NOT NULL ★ 2026-07-15 대기

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

### dm_custom_short_links (고객사 자체 URL 단축 — hlj.kr) ★ 2026-07-10 신규 (CREATE Harold 실행)
> 박성용 신기능(Harold 100크레딧 확정). 고객사 외부 MDM URL→hlj.kr/<code>. /s/:code 3순위 조회(토큰→발행 페이지→커스텀) — 발급 시 3축 코드 충돌 확인. 검증=dm-custom-short-link-core(오픈 리다이렉터 차단).

| 컬럼 | 타입 |
|------|------|
| id | uuid PK DEFAULT gen_random_uuid() |
| company_id | uuid NOT NULL FK companies ON DELETE CASCADE |
| created_by | uuid |
| code | varchar(12) NOT NULL UNIQUE — base62 8자(generateDmShortCode). ★ 2026-07-15 varchar(20) ALTER **대기**(한글 별칭 slug 2~20자·NFC) |
| target_url | text NOT NULL |
| dm_page_id | uuid REF dm_pages CASCADE — ★ 2026-07-15 ALTER **대기**. 발행 DM 한글 별칭 연결(NULL=기존 외부 URL 단축). 부분 UNIQUE(dm_page_id)=DM당 별칭 1개 |
| title | varchar(100) |
| is_active | boolean NOT NULL DEFAULT true — 비활성=접속 시 서비스 홈 폴백 |
| click_count | integer NOT NULL DEFAULT 0 |
| last_clicked_at | timestamptz |
| created_at | timestamptz NOT NULL DEFAULT NOW() |
- INDEX: (company_id, created_at DESC)
- 일일 생성 상한 50 = INSERT 단문 서브쿼리 결합(CT createCustomShortLink)

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
| **advanced_access_enabled** | **boolean NOT NULL DEFAULT false** | **★2026-07-28 ALTER 실측. 상위 등급 전용 기능(베타 진입 `isBetaAccessAllowed`·자율 발송 자격 `continuous-operator`) 판정. 그 전에는 두 곳이 `plan_code IN ('ENTERPRISE','BUSINESS')`를 직접 비교해서, 요금제가 늘 때마다 코드를 고쳐야 했다. 현재 true = ENTERPRISE·BUSINESS·STAFF. 조회 조각은 컬럼 부재 시 옛 규칙으로 폴백한다(`to_jsonb(p) ->> ...`) — ALTER 전후 동작이 같다** |
| dm_builder_enabled | boolean DEFAULT false | ★2026-08-05 실측 등재. 옛 DM 빌더 플래그(현행 판정은 `mobile_dm_enabled`) |
| ai_mapping_monthly_quota | integer DEFAULT 10 | ★2026-08-05 실측 등재 |
| ai_calls_per_month | integer | ★2026-08-05 실측 등재. 종량제 전환 전 호출수 한도(현행 크레딧 축은 `ai_credits_per_month`) |
| created_at | timestamp | |

- **★2026-08-05 전 컬럼 실측 = 27개**(`information_schema` 순수 덤프). 위 표가 27개 전량이다. **무료 메시징 컬럼(`free_sms_qty` 등)은 존재하지 않는다** — [요금제 무료 메시징 설계서](../docs/2026-08-05-plan-free-messaging-design.md) §3-1의 ALTER 4건이 미실행 상태라는 근거.
- **2026-07-28 실측 행 8개**: ENTERPRISE 5,500,000 / BUSINESS 3,000,000 / PRO 1,000,000 / BASIC 350,000 / STARTER 150,000 / **STAFF(임직원) 0** / FREE(미가입) 0 / TRIAL(무료체험) 0.
- **★2026-07-28 `STAFF`(임직원) 신설** — 직원이 전 기능을 테스트·디버깅하는 계정용. **ENTERPRISE 행을 통째로 복제**하고 `plan_code`·`plan_name`·`monthly_price(0)`만 덮었다(컬럼 나열 없이 `jsonb_populate_record`로 복사 — 항목 누락 구조적 차단). 고객용 요금제 안내에는 노출하지 않는다(`frontend/src/utils/planLabel.ts` `INTERNAL_PLAN_CODES` = FREE·TRIAL·STAFF).
- **★2026-07-28 `TRIAL`을 BASIC과 동일 권한으로 맞춤** — 무료체험 부여가 BASIC 대신 TRIAL(월 0원)을 배정하도록 바뀌면서, TRIAL이 BASIC보다 좁던 세 칸(`cdp_enabled` f→t · `cdp_events_per_month` NULL→10,000 · `ai_credits_per_month` 600→750)을 BASIC 값으로 동기화했다. 요금(0)·이름·활성 여부는 그대로.

**companies 추가 컬럼 (CT-17 활용):**
- `subscription_status` varchar(20) — `null | 'trial' | 'trial_expired' | 'paid' | 'active' | 'expired' | 'suspended'`
- `trial_expires_at` timestamp — 30일 PRO 무료체험 만료 시각. `utils/trial-downgrade-worker.ts` Cron(매일 04:00 KST)이 만료 시 자동 강등.

### free_messaging_grants (요금제 무료 메시징 월 지급 원장) ★2026-08-05 신설 — **DDL 대기**

> 설계·확정 = [요금제 무료 메시징 설계서](../docs/2026-08-05-plan-free-messaging-design.md). CT = `utils/free-messaging.ts`.
> 쓰기 진입점 둘뿐 — 지급 = `free-messaging-grant-worker`(기동 즉시 + 10분 주기, 멱등) / 소진 = `prepaidDeduct` 한 곳.

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK `gen_random_uuid()` | |
| company_id | uuid NOT NULL FK companies ON DELETE CASCADE | |
| period_month | date NOT NULL | 그 달 1일(KST). **항상 DB에서 계산**(`date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul')`) |
| msg_type | varchar(20) NOT NULL | `SMS`/`LMS`/`MMS`/`KAKAO` — 차감·청구 유형키와 **같은 축**(BILLING_TYPES) |
| granted_qty | integer NOT NULL DEFAULT 0 | 지급 시점 `plans` 값 **스냅샷**(plans를 나중에 바꿔도 지급된 달은 불변) |
| used_qty | integer NOT NULL DEFAULT 0 | 소진 실적. **되돌리지 않는다**(설계 §5-1-A) |
| plan_id / plan_code | uuid / varchar(20) | 어느 요금제 기준 지급인지 스냅샷 |
| unit_value | numeric(12,2) | 수량 산정에 쓴 **일괄 공통 단가**(SMS 10·LMS 30·MMS 60·알림톡 6). 고객사 단가와 무관 |
| created_at | timestamptz NOT NULL DEFAULT now() | |

- **UNIQUE(company_id, period_month, msg_type)** = 지급 멱등의 전부. 재실행·중복 기동·강등 후 재승급이 이 하나로 막힌다.
- **CHECK(used_qty >= 0 AND used_qty <= granted_qty)** = 초과 소진 구조 차단(코드의 `LEAST`가 1차, 이 제약이 최종).
- 이월 없음 — 소진·조회가 **당월 행만** 보므로 월이 바뀌면 구조적으로 소멸(삭제 배치 없음).

### plans·billing_items 무료 메시징 컬럼 ★2026-08-05 — **DDL 대기**

- `plans` + `free_sms_qty`·`free_lms_qty`·`free_mms_qty`·`free_alimtalk_qty` (integer NOT NULL DEFAULT 0). 수량의 진실은 이 행이고 코드·화면은 파생만 한다.
- `billing_items` + `free_count` (integer NOT NULL DEFAULT 0) — 그 발행이 청구에서 뺀 무료 건수. **소비 마커**라 중간정산으로 같은 달을 두 번 발행해도 이중 공제가 없고, 발행을 지우면 함께 사라져 자동으로 미반영으로 돌아온다. `success_count`는 실제 성공 건수 그대로 두고 **청구 수량만** `success_count − free_count`로 좁힌다.

### company_plan_changes (요금제 변경 이력 — 청구 일할계산의 입력) ★2026-07-25 신설 · 2026-07-26 실측 등재 (13컬럼)

> 신설 사유: `companies.plan_id`를 덮어쓰기만 해서 **언제 바꿨는지가 어디에도 안 남았다.** 월 중간에 플랜을 올리거나 내린 회사의 일할계산 전제가 없었고, 소급으로 알아낼 방법도 없다.
> 쓰기 진입점 = `utils/plan-change-log.ts` `recordPlanChange()` **하나뿐**(plan_id 쓰기 9곳 전수 배선). `client`(PoolClient)가 필수라 plan_id UPDATE와 **같은 트랜잭션 안에서만** 기록된다 — 이력 한 건 유실은 그 뒤 전 구간을 틀어뜨리는 연쇄 손상이라 분리를 타입에서 막았다.

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK NOT NULL `gen_random_uuid()` | |
| company_id | uuid NOT NULL | FK companies |
| from_plan_id | uuid NULL | 직전 플랜. 기준선 행은 NULL |
| to_plan_id | uuid NOT NULL | |
| from_plan_code | varchar NULL | 그 시점 **스냅샷** |
| to_plan_code | varchar NOT NULL | |
| from_monthly_price | numeric NULL | 그 시점 **스냅샷** — `plans.monthly_price`를 나중에 올려도 과거 청구서 재발행 금액이 안 바뀌게 |
| to_monthly_price | numeric NOT NULL | |
| effective_date | date NOT NULL | **요금 적용 기준일**(KST). `changed_at`과 분리 |
| change_type | varchar NOT NULL | `initial`/`upgrade`/`downgrade`/`trial_start`/`trial_expire`/`admin` |
| changed_by | uuid NULL | FK users ON DELETE SET NULL |
| reason | text NULL | |
| changed_at | timestamptz NOT NULL DEFAULT now() | **기록 시각**(≠ 적용 기준일) |

- **직전 플랜은 `companies`가 아니라 이 테이블 최신 행**(`ORDER BY effective_date DESC, changed_at DESC LIMIT 1`)에서 도출한다 — 호출 시점엔 `plan_id`가 이미 새 값으로 덮여 있고, 이력끼리 체인이 이어져야 일할계산이 구간을 끊을 수 있다.
- 회사별 `pg_advisory_xact_lock(hashtext(company_id), hashtext('plan_change'))`로 직렬화. 승강등 판정(`classifyPlanChange`)은 INSERT에 쓰는 바로 그 prev 값으로만 한다.
- **기준선 141행**(2026-07-25 21:18 UTC 일괄 INSERT): `change_type='initial'` · `effective_date = companies.created_at::date` · `from_*` 전부 NULL. reason에 "이력 도입 전 기준선 — 실제 변경 이력 없음" 명시. 분포 = FREE 129 / BASIC 6 / ENTERPRISE 3 / TRIAL 2 / BUSINESS 1.
- 인덱스 실측(2026-07-26 `pg_indexes`): `company_plan_changes_pkey`(id) · `idx_cpc_company_effective`(company_id, effective_date) · `idx_cpc_effective`(effective_date).
- FK·varchar 길이는 아직 `pg_constraint`/`character_maximum_length` 미실측 — 생성 명세는 `docs/2026-07-25-billing-restructure-handoff.md` §3-1.

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
| filter_jsonb | jsonb NULL | ★2026-08-13 실측 등재(이 표에 없던 실존 컬럼 — 플래너 Phase 3·4 착수 실측에서 발견). 구조화 필터. **소비처 grep이 선행**이다 — 참여자 세그먼트(플래너 Phase 4)를 여기에 스냅샷으로 굳히면 진실 복사가 된다(원본 = `cdp_events`) |

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
| source_row_key | varchar(200) NULL | ★ 2026-08-03 실행완료 — 고객사 소스 테이블 원본 행 PK. 싱크 재전송·재싱크 멱등키 |

**시간 축 주의 (2026-08-03 실측)** — `purchase_date`는 **KST 날짜**(1,855,088건 전량 `00:00:00`, 시각 없음)이고 `created_at`은 `NOW()` 적재라 **UTC 벽시계**다(DB 세션 TimeZone = `Etc/UTC`). 한 행에 축이 둘이니 비교 시 반드시 변환을 명시한다.

**멱등 인덱스** — `CREATE UNIQUE INDEX ux_purchases_company_source_row_key ON purchases (company_id, source_row_key) WHERE source_row_key IS NOT NULL` (2026-08-03 실행완료). 부분 인덱스라 키 없는 기존 행·옛 에이전트 적재분은 걸리지 않는다. 적재는 `ON CONFLICT ... DO UPDATE`이며 **`created_at`은 갱신 대상에서 제외**한다(여정 구매 원장 커서가 도착 축으로 읽어, 값을 올리면 이미 발화한 구매가 재발송된다). 소유 = `utils/sync-ingest.ts`.

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
| user_type | varchar(20) | ★ 2026-08-03 실측 분포 = `admin` 126 · `user` 101(매장 배정 7) · `system` 75. **JWT의 `company_admin`·`company_user`는 토큰 변환값이라 DB에 없다** — 권한 판정을 토큰 어휘로 하면 제한 사용자(`user`)가 전체 권한으로 승격된다(자동마케팅 발송 범위 사고 기원) |
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
| is_system | boolean | 싱크에이전트 등 시스템 가상 계정 표식 — 사용자 수 집계·담당자 선정에서 제외(COALESCE(is_system,false)=false 관례, admin.ts:94·billing.ts:533 실사용. 2026-07-07 문서 누락 보강) |
| created_at | timestamp |
| updated_at | timestamp |
| last_login_at | timestamp |

### sync_agents (Sync Agent 등록 정보)
> 2026-08-14 information_schema 실덤프 19컬럼 대조 — `config`·`sync_interval_customers`·`sync_interval_purchases` 3컬럼이 미등재였다. **자기 보고(에이전트 self-report) 전용 컬럼은 이 테이블에 없다** — 별도 테이블이거나 `config` jsonb 안이다(미확인).
> 기본값 주의: `status` DEFAULT `'inactive'` · `uptime`/`queued_items`/`total_*_synced` DEFAULT `0` · `last_heartbeat_at`은 기본값 없음(NULL). 이 조합이 그대로면 **heartbeat 경로가 그 행을 한 번도 쓴 적이 없다는 뜻**이지 "꺼졌다"가 아니다.

| 컬럼 | 타입 |
|------|------|
| id | uuid PK — DEFAULT gen_random_uuid() |
| company_id | uuid FK |
| agent_name | varchar(100) |
| agent_version | varchar(20) |
| os_info | varchar(100) |
| db_type | varchar(20) |
| status | varchar(20) — active/inactive/error · DEFAULT 'inactive' |
| last_heartbeat_at | timestamptz — 기본값 없음(NULL) |
| last_sync_at | timestamptz |
| total_customers_synced | integer — DEFAULT 0 |
| total_purchases_synced | integer — DEFAULT 0 |
| queued_items | integer — DEFAULT 0 |
| uptime | integer — DEFAULT 0 |
| ip_address | varchar(50) |
| created_at | timestamptz — DEFAULT now() |
| updated_at | timestamptz — DEFAULT now() |
| config | jsonb — DEFAULT '{}' |
| sync_interval_customers | integer — DEFAULT 60 |
| sync_interval_purchases | integer — DEFAULT 30 |

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

### SMSQ_SEND_1~11 / 13~15 (SMS 발송 큐 - Agent 라인그룹 분배)
> 로컬: SMSQ_SEND (1개), 서버: SMSQ_SEND_1~11 (QTmsg Agent 11개, 환경변수 SMS_TABLES + 라인그룹으로 분기)
> + **SMSQ_SEND_13·14·15 = 비토 자체 게이트웨이 라인** (★2026-07-17 14·15 신설 — Agent hanjul02/hanjul03).
>   **env `SMS_TABLES`에 없음** — 라우팅은 PG `sms_line_groups`(group_type='bito')가 전담.
>   LOG 테이블(`_YYYYMM`) 없음 — 비토 Agent는 status를 제자리 갱신만 하고 이력으로 옮기지 않는다.
>   그래서 결과 집계는 `classifyResultTables`가 "LOG 짝 없는 LIVE = 결과까지 집계" 분기로 처리한다(이중카운트 구조적 불가).
> + **SMSQ_SEND_12 = 유휴 잔재** — 라인그룹 미등록 · env 미포함 · 코드 참조 0.
>   2026-03-20 더미 8행(010-0000-0000, status 100 미발송)만 고여 있음. 13을 만들 때 `LIKE 12`로 복제한 원본. 폐기 후보(2026-07-17 실측).
>
> **★ D144 검증(2026-05-06):** 서버 `SMSQ_SEND`는 BASE TABLE이 아니라 **VIEW** = `SMSQ_SEND_1 UNION ALL ... SMSQ_SEND_11` 단순 가상 뷰. 한줄로AI는 SMSQ_SEND_X에 INSERT, VIEW는 모니터링 가상 표시. 한줄로AI 코드는 fallback 단일 'SMSQ_SEND'에 직접 INSERT 가능하나 서버 .env에 SMS_TABLES 명시되어 fallback 미발동. 레거시 invitoMsg watch 대상이던 base table은 D-Day 5/5에 DROP됨.
>
> **★ 2026-07-17 실측(`SHOW CREATE TABLE SMSQ_SEND_13`)** — 아래 표에 없던 컬럼 4개가 실재한다: `k_oriseq` varchar(20) · `k_resyes` varchar(1) · `app_etc1` varchar(50) · `app_etc2` varchar(50). 총 29컬럼.
> 인덱스 = PK(`seqno`) + `idx_app_etc1_status`(app_etc1,status_code) + `idx_app_etc1_sendreq`(app_etc1,sendreq_time). InnoDB / utf8mb4_0900_ai_ci.
> `app_etc1` = 캠페인/추적 식별자(결과·정산 매칭 축), `app_etc2` = company_id.
> 신규 라인 테이블은 `CREATE TABLE SMSQ_SEND_N LIKE SMSQ_SEND_13` (root 실행 — smsuser는 CREATE 권한 없음. 권한은 `smsdb.*` 스키마 단위라 자동 상속).

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

### billings (정산 헤더 — 청구서 1페이지 요약) ★2026-07-25 등재 (38컬럼 실측)

> 실제 발행 경로의 헤더. **`billing_items`가 상세.** 0725 기준 실행 이력 = 금강제화 시험 발행 1건뿐.

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK `gen_random_uuid()` | |
| company_id | uuid NOT NULL | |
| user_id | uuid NULL | 사용자 지정 정산(그 사용자 발송분만) |
| agent_id | uuid NULL | 미사용(항상 NULL) |
| billing_year · billing_month | integer NOT NULL | |
| billing_start · billing_end | date NOT NULL | 기간 겹침 중복검사 축 |
| sms_success · lms_success · mms_success · kakao_success | integer NOT NULL DEFAULT 0 | **성공 수량 = 청구 수량** |
| sms_unit_price · lms_unit_price · mms_unit_price · kakao_unit_price | numeric NOT NULL DEFAULT 0 | 단가 스냅샷 |
| test_sms_count · test_lms_count | integer NOT NULL DEFAULT 0 | |
| test_sms_unit_price · test_lms_unit_price | numeric NOT NULL DEFAULT 0 | 미설정 시 일반 단가 상속(0원은 0원 — `resolveBillingUnitPrices`) |
| spam_filter_sms_count · spam_filter_lms_count | integer NULL DEFAULT 0 | |
| spam_filter_sms_unit_price · spam_filter_lms_unit_price | numeric NULL DEFAULT 0 | 스팸 단가 = 일반 SMS/LMS 단가(D16) |
| ai_credit_count | integer NOT NULL DEFAULT 0 | 후불 충전 + overage 크레딧 수량 |
| ai_credit_supply | numeric NOT NULL DEFAULT 0 | 공급가(VAT 별도) |
| subtotal · vat · total_amount | numeric NOT NULL DEFAULT 0 | vat = round(subtotal × 0.1) |
| status | varchar NOT NULL DEFAULT 'draft' | draft/confirmed/paid |
| notes | text NULL | |
| created_by | uuid NULL | |
| created_at · updated_at | timestamptz NOT NULL now() | |
| emailed_at · emailed_to · emailed_by · email_sent_at | — | 발송 이력 |

| scope | varchar(20) NOT NULL DEFAULT 'combined' | ★2026-07-26 ALTER 실측. 발행 단위 — `combined`(회사 1장) / `by_user`(웹 계정별) / `common`(공통 장) / `by_agent`(발송ID별, **미구현·이월**) |
| batch_id | uuid NULL | ★2026-07-26 ALTER 실측. 묶음 발행 식별. 부분 삭제 차단·"N+1장 중 k장" 표기 근거 |

- 2026-07-26 ALTER 적용 실측: `scope`·`batch_id` 추가 + `idx_billings_company_period (company_id, billing_start, billing_end)` · `idx_billings_batch (batch_id) WHERE batch_id IS NOT NULL`. 기존 15행은 DEFAULT로 `combined` 자동 충전.
- **`scope` 축을 값으로만 중복검사에 넣으면 안 된다** — `combined`(user_id·agent_id 둘 다 NULL)와 `by_user`는 키가 달라 둘 다 통과한다. 불변식은 "한 회사·한 기간에는 하나의 scope만"이고, 그래서 이 컬럼이 필요하다. 설계=docs/2026-07-26-billing-scope-and-corrections-design.md §1-6.
- 두 컬럼을 쓰는 endpoint catch에 `column does not exist` → 503 `DB_MIGRATION_PENDING` 분기 의무.
- **에이전트 축 컬럼이 없다** — 그래서 `usage_type='both'` 회사의 게이트웨이 발송분이 청구서에 안 들어간다(0725 발견, 재구성 대상).
- `ai_credit_requests.billed_invoice_id`가 이 테이블을 가리키지만 **FK가 아니다** — 삭제해도 `billed=true`가 남아 재발행 시 크레딧이 영구 미청구. 0725에 `DELETE /:id`가 되돌리도록 수정함.

### billing_items (정산 상세 — 청구서 2페이지 일자별) ★2026-07-25 등재 + 축 확장 ALTER

> 실제 발행 경로 = `POST /api/admin/billing/generate` → `billings`(헤더) + `billing_items`(상세) → `GET /:id/pdf`.
> (`billing_invoices`는 화면에 생성 UI가 없다 — 0725 실측 0행·`billingApi.createInvoice` 호출부 0건.)

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| billing_id | uuid FK → billings **ON DELETE CASCADE** | |
| company_id | uuid FK → companies | |
| user_id | uuid FK → users NULL | ★2026-07-25 **행별 사용자 축**(웹·테스트·스팸). 그 전엔 헤더값 복사라 무의미 |
| agent_id | uuid FK → **company_agent_ids** NULL | ★2026-07-25 FK 신설. 에이전트 발송ID. 그 전엔 항상 NULL |
| store_id | varchar(100) NULL | ★2026-07-25 ALTER 신설. 에이전트 대상ID(`RSRM_SalesStts.StoreId`) |
| channel | varchar(20) NOT NULL DEFAULT 'web' | ★2026-07-25 ALTER 신설. `web`/`agent`/`test`/`spam` — 암묵 판별(message_type 접두) 폐기 |
| item_date | date NOT NULL | |
| message_type | varchar NOT NULL | 유형키(SMS/LMS/MMS/KAKAO/TEST_*/SPAM_*) |
| total_count · success_count · fail_count · pending_count | integer NOT NULL | **청구 수량 = success_count** |
| unit_price | **numeric(12,2) NOT NULL** | 단가 스냅샷. **★2026-07-28 (6,2)→(12,2) ALTER** — 요금제 행이 월정액을 이 칸에 싣는데 상한 9,999.99를 넘어 `numeric field overflow`(22003)로 **발행이 통째로 실패**했다(0727 5건). 원본 `company_plan_changes.to_monthly_price`가 (12,2)인데 저장 칸만 좁았던 것 |
| amount | numeric(12,2) NOT NULL | 단가 × 성공 |
| plan_days | integer NULL | ★2026-07-26 ALTER 신설. **요금제 행 전용** — 일할 구간 일수. 발송 행은 NULL |
| plan_month_days | integer NULL | ★2026-07-26 ALTER 신설. **요금제 행 전용** — 그 달 일수(일할 분모). 발송 행은 NULL |
| created_at | timestamptz NOT NULL | |
- INDEX idx_billing_items_billing_channel (billing_id, channel)
- **요금제(`channel='plan'`) 행은 발송 수량 4칸이 전부 0**이다. 2026-07-26 이전 코드는 일수를 `total_count`에, 월일수를 `fail_count`에 실었고 그 탓에 PDF 2페이지 '전송'·'실패' 열과 상세 모달 합계에 9·31이 발송 건수처럼 더해졌다(Codex 3차 HIGH) — 같은 컬럼이 채널에 따라 다른 뜻이 되는 구조를 전용 컬럼으로 끊었다.
- 2026-07-25 ALTER 적용 실측: `channel`·`store_id` 추가 + `agent_id` FK 신설 + 인덱스. 당시 15행(금강제화 시험 발행분)은 전부 web.
- **★2026-07-28 실측 = 0행.** 위 15행은 그 뒤 삭제됐다. **아직 굳은 청구서가 하나도 없다** = 단가·요금제 이력을 정정할 수 있는 창이 열려 있다는 뜻이다(발행이 쌓이면 스냅샷이 굳어 소급 정정 불가).

### 080 청구·월별 추가 항목 2테이블 ★2026-07-30 신설·실행 완료 (Harold psql)

> 기원 = 서수란 0729 "정산 관련 체크 사항" 티켓 + KT 명세서 실측(인비토 명의 1장·080 번호 18대·번호당 부가서비스 4,000+통화료 변동+VAT). 금액은 전부 **공급가 저장**(VAT는 청구서가 파생 — 0726 원칙).

- **billing_080_numbers** (080 번호↔회사 매핑 — 손글씨 매핑의 시스템화): id uuid PK gen_random_uuid() · number varchar(20) NOT NULL **UNIQUE**(숫자만) · company_id FK→companies · label varchar(100)(부서/브랜드 — 시세이도 Nars 등) · monthly_fee_supply int NOT NULL DEFAULT 9000(080 이용료 공급가 = 인비토 관리료, VAT 포함 9,900. 리스킨=0) · kt_fee_supply int NOT NULL DEFAULT 4000(KT 부가서비스 실비 공급가, VAT 포함 4,400) · charge_call_fee bool DEFAULT true(통화료 귀속 여부) · is_active bool DEFAULT true · memo text · created/updated_at. · **user_id uuid FK→users ON DELETE CASCADE NULL** (**★2026-07-31 ALTER 실행완료** — NULL = 고객사 전체 귀속, 값 있으면 그 계정 귀속. **`SET NULL` 금지** — 계정 귀속이 회사 전체로 둔갑해 엉뚱한 청구서에 실린다[`billing_contacts` 선례]. CASCADE면 계정 삭제 시 매핑이 사라져 KT 반영 때 "미매핑 번호"로 드러난다). INDEX(company_id). ※ 기존 `users/companies.opt_out_080_number`(수신거부 콜백 축)와 **별개** — 그쪽은 회사당 1개뿐이고 의미가 다르다(재사용 불가 실측 grep)
- **billing_extra_items** (월별 추가 청구 항목 — KT 명세서 [반영]이 생성): id uuid PK · company_id FK→companies · period_month date(그 달 1일) · kind varchar(30)(**★2026-08-04 신규 생성은 `080_call`(번호당 1행 — 그 달 그 번호의 통화료) / `manual`(수기 부가서비스) 둘뿐.** 이용료·KT 부가서비스는 `billing_080_numbers` 원장에서 **파생**한다. 옛 `080_fee`·`080_svc` 잔존 행은 **같은 번호에 현행 `080_call` 스냅샷이 있을 때만 건너뛰고, 없으면 그 행이 그 달의 유일한 근거라 그대로 청구한다** — 옛 반영기가 통화료 미청구·0원인 번호에는 `080_call`을 아예 안 만들었기 때문에 kind로 통째 거르면 고정료가 영구 미청구가 된다. 파생·귀속·차단 계약 = `send-usage-aggregation.ts` `buildExtraBillingItems`·`extraRowUserId`·`extraRowsBlockingIssue`·`EXTRA_ITEM_SOURCE_SELECT/_JOIN`, 경위 = docs/2026-07-30-billing-extras-and-groups-design.md §2-4) · label varchar(200)(**화면 표시 전용** — 청구서 항목명은 유형키가 소유한다. 여기에 계약 금액을 적으면 그것이 또 하나의 죽은 복사본이 된다) · supply_amount int(공급가 — `080_call`은 명세서 통화료, `manual`은 건당 단가) · source_ref varchar(100)(귀속 근거 — 080 번호. **★2026-08-04 매핑의 회사·번호를 바꾸면 미소비 행의 `company_id`·`source_ref`도 같은 트랜잭션에서 함께 옮긴다**(양쪽 회사 advisory lock, 그 달 발행이 있으면 409). 안 옮기면 옛 회사 청구서에 그대로 남거나 매핑을 잃어 그 회사 발행이 막힌다) · created_by(FK 없음 — 0728 23503 원칙) · created_at · **billed_billing_id uuid FK→billings ON DELETE SET NULL**(★2026-07-30 2차 ALTER 실행완료 — 소비 마커. ai_credit_transactions.billed_billing_id 선례 미러: 발행이 미소비 행만 싣고 공통 장 id로 마킹 → 분할 기간 재발행 이중청구 구조 차단, 발행 삭제 시 자동 미소비 복귀. Codex 적대검증 1R critical 수용). · **user_id uuid NULL — FK 없음** (**★2026-08-04부터 `manual` 행 전용.** `080_call` 행은 저장하지 않고 귀속을 `billing_080_numbers.user_id`에서 읽는다 — 복사해 두면 매핑에서 귀속을 바꿔도 청구서가 공통 장으로 가던 결함이 그것이었다. **★2026-07-31 ALTER 실행완료** — NULL = 고객사 전체 귀속. 이미 발생한 청구 근거라 계정이 삭제돼도 남아야 해서 FK를 걸지 않았다[`taxbill_issues`가 정산 삭제 후에도 남는 것과 같은 판단]. **게이트는 두지 않았다** — 계정별 발행은 `계정 장 + 공통 장` 구조라 `user_id`가 있으면 그 계정 장, NULL이면 공통 장으로 **분배가 저절로 맞는다**(`buildExtraBillingItems`가 `userId`를 그대로 싣는다). 유령 귀속(계정 삭제로 id만 남은 경우)은 `billing-issue`의 `LEFT JOIN users`가 그 회사 실재 계정일 때만 값을 살려 공통 장으로 내린다 — 존재하지 않는 계정 장이 생겨 발행 전체가 FK로 터지는 것과, 항목을 통째로 빠뜨리는 것 둘 다 피한다). INDEX(company_id, period_month) + **UNIQUE(period_month, kind, source_ref) WHERE source_ref IS NOT NULL**(같은 달 재반영 중복 차단)

### 일괄발급·컨펌·세금계산서 5테이블 ★2026-07-28 신설·실측 등재 (+2026-07-29 수동 정산완료 1테이블·1컬럼 — 실행 대기)

> SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §1(+§3-1 수동 정산완료). DDL 실행·검증 완료(5테이블, 컬럼 수 5/14/19/10/9).
> **★2026-08-05 정정 — `billing_manual_completions`는 실존한다**(information_schema 실측 7컬럼: id · company_id · period_start · period_end · reason · created_by · created_at). **금액 컬럼이 없다** — "그 달은 수동 처리했다"는 기록이지 청구액 원장이 아니다. 특수정산업체 엑셀 업로드는 이 테이블에 얹을 수 없고 신규 테이블이 필요하다(docs/FEATURE-BILLING.md §7).
> `company_billing_settings.manual_billing` ALTER는 **아직 실측 미확인**(0805에 그 컬럼은 조회하지 않았다).
> 공통 원칙: **실행자 컬럼(updated_by·created_by)에 users FK를 걸지 않는다** — 슈퍼관리자는 super_admins 소속이라 FK가 23503으로 터진다(2026-07-28 회사 수정 실패 사고). id만 기록.

- **company_billing_settings** (회사당 1행): company_id PK FK→companies CASCADE · issue_scope `combined`/`by_user`(CHECK, DEFAULT combined — 일괄발급 좌우 기본값) · taxbill_day_policy `last_day`/`first_day`/`manual`(CHECK, DEFAULT last_day) · updated_by(FK 없음) · updated_at · **manual_billing** boolean NOT NULL DEFAULT false **(★2026-07-29 ALTER — 실행 대기)**: 우리 정산으로 발행할 수 없어 사람이 따로 처리하는 회사. 일괄발급 화면의 [전체 담기]·[선택 담기] 양쪽에서 빠진다(목록에는 뜬다 — 숨기면 그 달 처리 여부를 아무도 모른다). **UPSERT에서 이 값은 페이로드에 없으면 보존한다**(EXCLUDED 통째 덮기 → 옛 번들 한 번에 표시가 풀리던 사업자 6필드와 같은 함정) · **min_charge_supply** integer NULL **(★2026-07-30 ALTER 실행완료 — Harold psql NOTICE로 실존 확인)**: 최소과금 공급가(서수란 접수·Harold 확정 — 기본 50,000·VAT는 발행이 파생). 값 있으면 일괄발급 발급 부적격(filterBillableCompanies 서버 단일 진실 + 화면 뱃지·담기 제외) — 청구 경로 = 최소과금 모달의 정액 발행(`issueMinimumChargeBilling`: 실사용 공급가 초과·단가 미설정·미소비 extra·요금제·선불 = 전부 발행 거부 fail-closed)
- **billing_manual_completions** (월 단위 수동 정산완료 — **★2026-07-29 신설·실행 대기**): id uuid PK `gen_random_uuid()` · company_id FK→companies CASCADE · period_start·period_end date · reason text NULL · created_by uuid(**FK 없음** — 0728 `23503` 원칙) · created_at. UNIQUE(company_id, period_start, period_end). **청구서(`billings`)를 만들지 않는다** — 만들면 PDF·세금계산서·매출 집계가 그 가짜 장을 센다. `listUnbilledPostpaid`가 `billings`와 **같은 겹침(overlap) 식**으로 이 테이블도 제외한다(축이 다르면 중간정산 조회에서 화면마다 대상이 달라진다). 해제(DELETE)하면 그 회사는 곧바로 미발급 목록으로 돌아온다. 이미 발행된 회사는 기록 자체를 막는다(어느 쪽이 진실인지 모르게 되는 것을 차단)
- **billing_contacts** (정산 담당자+계산서 사업자, **user_id NULL = 회사 레벨**): id PK · company_id FK CASCADE · user_id FK→users **CASCADE**(SET NULL 금지 — 계정 삭제 시 회사 레벨 행으로 둔갑) · contact_name/email · taxbill_biz_number/company_name/ceo_name/address/biz_type/biz_item(전부 NULL이면 회사 기본 사업자 사용) · updated_by · created/updated_at. UNIQUE = (company_id,user_id) WHERE user_id IS NOT NULL + (company_id) WHERE user_id IS NULL (partial 2본). **★2026-07-31부터 연락처(contact_name·contact_email)는 읽지 않는다** — 수신자는 `billing_recipients`가 소유하고 이 테이블은 **공급받는자 사업자 전용**으로 역할이 좁혀졌다(컬럼은 롤백 여지로 남겨둠)
- **billing_recipients** (정산 메일 수신자 — **★2026-07-31 신설·실행 완료**): id uuid PK gen_random_uuid() · company_id FK→companies CASCADE · user_id FK→users CASCADE **NULL 허용(NULL = 회사 레벨)** · doc_type varchar(20) NOT NULL CHECK(`statement`/`taxbill` — **`both` 없음**: 둘 다 받으면 행 2개. 'both'를 두면 statement 대표가 둘이 되어 부분 유니크로 못 막는다) · email varchar(255) NOT NULL · name varchar(100) · is_primary bool DEFAULT false(**거래내역서 = 컨펌 토큰 행을 받는 1명 / 세금계산서 = 팝빌에 넘길 1명**, 나머지는 참조) · is_active bool DEFAULT true · created_by(FK 없음) · created/updated_at. 인덱스 5본 = 중복 차단 partial UNIQUE 2본(`lower(email)` 기준) + **대표 1명 강제 partial UNIQUE 2본**(`WHERE is_primary`) + (company_id).
  - **기원** = 수신자 원장이 셋으로 갈려 있었다 — 일괄발급 컨펌·"메일 없음" 뱃지·세금계산서는 `billing_contacts`, 개별 정산서·거래내역서 메일은 `companies.contact_email`. 같은 담당자인데 경로마다 다른 주소로 나갈 수 있었다. **이관 실측(0731): `billing_contacts` 메일 보유 행이 1개뿐**이었고 `companies` 쪽은 100사 — 그대로 일괄발급을 돌렸으면 100사 중 99사가 `invoice-confirm.ts:174` "이메일 미등록" 분기로 조용히 스킵됐다.
  - **이관 결과 실측** = 담당자 원장 2행(1건×유형2) + 회사 기본 198행(99사×유형2) → **유형별 100행(전부 회사레벨)**, 수신자 없는 회사 41사(141−100). 폴백은 두지 않는다(두면 원장이 다시 셋이 된다).
  - `companies.contact_email`은 **정산 축에서 분리** — 가입·일일 인사이트 메일이 계속 쓰는 회사 대표 연락처로 남는다.
  - **★Codex 적대검증(0731) 수용분 — 이 표의 불변식은 코드가 지킨다**: ①대표를 지우면 같은 스코프의 다음 활성 행이 **승계**한다(`deleteBillingRecipient`, 라우트가 트랜잭션으로 감쌈) — 승계가 없으면 화면엔 `참조`인 사람이 컨펌 권한자가 된다 ②화면의 자동 대표 지정 기준은 "행이 없다"가 아니라 **"대표가 없다"** ③`doc_type='taxbill'` 대표가 없으면 **계산서를 발행하지 않는다**(`taxbill-popbill`가 `markFailed` — 팝빌은 빈 이메일도 받아 발행하므로, 두면 국세청에 나가고 과금까지 끝난 뒤 고객만 통지를 못 받는다) ④**★2026-07-31(2) 세금계산서도 복수 수신 개방(Harold)** — 발행은 여전히 대표 1명(`invoiceeEmail1`)뿐이고, 참조는 issued 확정 시 `taxbill_email_resends`에 pending 기록 → 재전송 패스가 팝빌 `sendEmail`(설치 SDK 실측)로 같은 계산서 메일을 보낸다. 미검증 필드(addContactList)는 여전히 payload에 넣지 않는다. 재전송 상한 = 장당 앞 10명(`TAXBILL_RESEND_MAX_TARGETS`).
- **invoice_confirmations** (메일 1통=1행): id PK · billing_id FK→billings CASCADE(draft 삭제 시 추적행 동반 삭제) · company_id FK · recipient_user_id FK SET NULL · recipient_email · token UNIQUE(공개 컨펌 링크) · sent_at(3일 타이머 기점) · confirmed_at/ip · objection_at/text/resolved_at · taxbill_status CHECK(`pending`/`confirmed`/`due`/`objected`/`manual_wait`/`ready`/`issued`) · taxbill_issue_date · taxbill_due_at(= min(sent+3일, 익월 10일)) · issued_at · popbill_invoice_key · **superseded_at**(재발급 무효화 마커 — 상태값 아님. **★2026-08-04 실측: 세팅하는 코드가 0곳**이고, **수정 재발행도 이 컬럼을 쓰지 않는다.** 정산을 지우면 추적행이 `billing_id` CASCADE로 함께 사라져 무효화 마커가 의미를 잃기 때문이다 — 수정 재발행의 근거는 `billing_qty_adjustments.reason`이 갖는다. 설계서 §4의 "기존 행 무효화"는 정산을 남긴 채 새 장을 더하는 그림이었는데, 기간 겹침 차단 때문에 그 형태가 성립하지 않는다. 컬럼은 남겨 둔다 — `taxbill-popbill`·`taxbill-worker`가 `superseded_at IS NULL`로 이미 읽고 있어 지우면 그 조건이 깨진다) · **objection_notified_at timestamptz NULL · objection_notify_attempts integer NOT NULL DEFAULT 0**(**★2026-08-04 ALTER 실행완료** — 이의 접수 시 내부 통지. **이의 트랜잭션에서 메일을 보내지 않는다**: 회사 잠금을 든 채 SMTP를 기다리면 그 회사 발행이 멈춘다[`taxbill_email_resends` 선례]. `objection_at`이 이미 내구 기록이라 별도 큐가 필요 없고, `taxbill-worker` 5분 tick이 `objection_at IS NOT NULL AND objection_notified_at IS NULL AND attempts < 5`를 집어 보낸 뒤 확정한다. 수신처 = ENV `BILLING_OBJECTION_ALERT_TO`·`BILLING_OBJECTION_ALERT_BCC`[숨은 참조], 미설정이면 발송 생략 + 경고 로그 1회) · **objection_resolved_at**(실존 — 코드 사용 0건. 수정 재발행이 이의 해소 시각으로 쓴다) · **cc_emails text[]**(**★2026-07-31 ALTER 실행완료** — 참조 수신자 기록. 참조에게는 **토큰 행을 만들지 않는다** — 추적행은 장당 하나라 누가 누르든 한 곳에만 기록되고 상태가 갈라지지 않는다. ⚠ **다만 참조도 그 메일의 컨펌 링크로 컨펌·이의를 남길 수 있다**(본문이 같다 — Codex 적대검증 지적으로 문구 정정). 권한을 나누지 않은 것은 의도다: 컨펌은 그 회사의 의사표시이고, 대표에게만 링크를 보내려면 수신자별로 본문을 나눠야 해 "메일 1통=추적행 1개" 구조가 깨진다) · **confirmed_by_admin uuid NULL · confirm_note text NULL**(**★2026-08-05 ALTER 실행완료** — 업체 확인 대리 기록. 컨펌 링크를 안 누르고 메일·전화로 발행일자를 통보하는 회사가 있어, 작성일자 지정에 컨펌 관문[[FEATURE-BILLING §2-13](../docs/FEATURE-BILLING.md)]을 세우면서 같은 폭으로 연 창구다. **NULL = 고객이 직접 누른 컨펌**이라 두 경로가 값으로 구분된다. FK 없음[0728 `23503` 원칙]. 쓰기 진입점 = `PUT /api/admin/billing/confirmations/:id/admin-confirm` 하나이고 `taxbill_status='manual_wait'` 건에만 연다. 목록 조회(`GET /confirmations`)는 `to_jsonb(ic) ->> '...'`로 읽어 **ALTER 전에도 현황판이 깨지지 않는다**) · created_at. INDEX = (taxbill_status,taxbill_due_at)·(company_id)·(billing_id)
- **billing_qty_adjustments** (수량 수정 발행 — **★2026-08-04 신설·실행완료**, `ALTER TABLE`+`CREATE TABLE`+`CREATE INDEX`×3 psql 출력 확인): id uuid PK `gen_random_uuid()` · company_id FK→companies **CASCADE** · period_start·period_end date · channel varchar(20) · type_key varchar(20) · agent_id uuid NULL(**FK 없음** — 참조 테이블을 확인하지 않은 채 FK를 걸지 않는다. 유효성은 코드가 본다) · qty_delta integer(**음수·양수, CHECK `<> 0`**) · reason text **NOT NULL**(왜 고쳤는지가 없으면 다음 달에 아무도 모른다) · created_by uuid(**FK 없음** — 0728 `23503` 원칙) · created_at. · **updated_at timestamptz NOT NULL DEFAULT now()**(★2026-08-04 2차 ALTER — UPSERT가 갱신) · **applied_delta integer NOT NULL DEFAULT 0 · applied_billing_id uuid NULL**(★2026-08-04 3차 ALTER — **발행이 실제로 실은 델타와 그 장**을 적는다. 시각 비교(`billings.created_at > updated_at`)로 추론했더니 조정을 수정하는 순간 이미 실린 델타까지 미적용으로 뒤집혀 `base`가 통째로 어긋났다[Codex 재검증 high]. 화면의 원래 수량 = `현재 수량 − applied_delta`. 정산 삭제 경로가 `applied_billing_id`로 찾아 둘 다 0·NULL로 되돌린다 — 조정 자체는 회사×기간 축이라 남는다). CHECK(period_start ≤ period_end). **UNIQUE = 단일 표현식 인덱스** `uq_bqa_key`(company_id, period_start, period_end, channel, type_key, COALESCE(user_id,zero-uuid), COALESCE(agent_id,zero-uuid)) — ★2026-08-04 `user_id` 축을 추가하며 부분 인덱스 2본에서 교체했다(널 가능 컬럼이 둘이라 부분 인덱스로는 4벌이 필요하고 하나만 빠뜨려도 중복 조정이 들어간다). UPSERT의 conflict target이 이 표현식과 같아야 추론된다 — psql 검증 완료. + INDEX(company_id, period_start, period_end).
  - **기원** = 서수란 0804 접수 "정산서 발송 후 업체와 수량이 다를 경우 수정 발행이 불가"(제주한라병원 7월 LMS 9,438 vs 업체 9,435). **수량은 사람이 조정한다**(Harold 확정).
  - **축이 발행이 아니라 회사×기간×유형인 이유** — 발행에 붙이면 재발행할 때 조정이 함께 사라져 "고쳐서 다시 내보낸다"가 성립하지 않는다. 적용은 발행 기간과 **정확히 일치**할 때만(겹침이면 어느 발행에 붙는지 모호하다 — 분할 발행에서 갈린다).
  - **적용 방식** = 발행 코어가 같은 채널·유형·단가의 **상세 행 하나**로 얹는다. `buildInvoiceLines`가 (채널·유형·단가)로 묶으므로 조정 줄이 따로 서지 않고 `LMS 9,435건 × ₩22.8` 한 줄로 인쇄된다. 헤더 수량은 상세에서 파생되고, 금액 항등식은 조정분을 `subtotalExact`에 더해 맞춘다. **조정 후 수량이 음수면 발행 거부.**
  - `channel`에 CHECK를 걸지 않았다 — 채널 집합은 코드(`BillingChannel`)가 소유한다. DB에 박으면 채널이 늘 때 DDL부터 막힌다.
- **billing_bulk_jobs**: id PK · period_start/end · total/done/failed_count · status CHECK(`running`/`done`/`cancelled`) · created_by(FK 없음) · created_at/finished_at
- **billing_bulk_job_items**: id PK · job_id FK CASCADE · company_id FK CASCADE · scope CHECK(`combined`/`by_user`) · status CHECK(`pending`/`running`/`success`/`failed`) · error · billing_batch_id · started/finished_at. INDEX(job_id). **한 item 실패는 그 item만 failed — job은 계속**
- **taxbill_issues** (세금계산서 내역 — 18컬럼, 2026-07-28 실측): id PK · confirmation_id FK→invoice_confirmations **SET NULL** · billing_id FK→billings **SET NULL**(정산 삭제 후에도 계산서 내역은 남는다 — 국세청 신고물) · company_id FK CASCADE · kind CHECK(`original`/`modify`) · modify_code smallint CHECK(1~6 — 팝빌 modifyCode) · org_nts_confirm_num(24 — 당초 국세청승인번호, 수정분만) · invoicer_mgt_key(24 — 팝빌 문서번호, 우리 발번) · nts_confirm_num(24 — 발행 후 팝빌 할당) · issue_date · supply/tax/total_amount numeric(15,2) · status CHECK(`ready`/`submitted`/`issued`/`failed`/`cancelled`) · error · created_by(FK 없음) · created/issued_at · **is_test boolean NOT NULL DEFAULT false**(**★2026-08-05 ALTER·백필 실행완료**(true 12 / false 17) — 발행 시점의 팝빌 환경. 기원 = 운영 전환[KST 12:30] 전에 발행된 **12장이 국세청에 안 나갔는데 장부는 `issued`, 화면은 `발행 완료`**였다[합계 20,066,393원]. 어느 환경이었는지가 어디에도 없어 승인번호 모양과 시각으로 추측해야 했다. 발행 패스가 `IsTest`를 그대로 적는다[컬럼 부재 시 표식만 건너뛰고 발행은 진행 — 존재 확인 캐시]. 되돌리기 판정의 단일 축이고, **승인번호 모양으로 가르지 않는다**[팝빌 규칙에 기대는 판정]. 백필 1회 = `issued_at < '2026-08-05 03:30:00+00'`[실측으로 그 선에서 정확히 갈린다]) · INDEX(company_id)·(status). **정산 1건에 원본+수정 N장이 달리는 축** — 컨펌 추적(메일 1통=1행)과 다르다. 웹훅 매칭 축 = invoicer_mgt_key
  - **★2026-07-30 소비처 확정(팝빌 연동 배포 `d4430454`)**: `utils/taxbill-popbill.ts`(ready 소비·발행·getInfo 재조회) · `routes/popbill-webhook.ts`(invoicer_mgt_key 매칭 갱신) · `routes/billing.ts`(장부 목록·수정발행 INSERT·재시도) · `utils/taxbill-worker.ts`(original 행 생성). **날짜 컬럼은 `to_char`로 읽는다** — 이 프로젝트 pg는 `DATE`(1082)를 JS Date로 파싱해(`database.ts`는 1114만 재정의) `String(issue_date)`가 `'Fri Jul 31'`이 된다(0730 실측 — 운영 행 전부 발행 실패할 상태였다). `supply/tax/total_amount`는 numeric이라 **문자열로 온다** → Number 변환 후 정수 검증(팝빌은 정수 String 요구).
  - 이월 DDL 3(미실행): 사유 1 부+정 그룹 상태 컬럼 · 웹훅 이벤트 이력 테이블 · `invoicer_mgt_key` UNIQUE 인덱스.
- **taxbill_email_resends** (세금계산서 참조 재전송 큐 — **★2026-07-31(2) 신설·실행 완료**, CREATE TABLE+인덱스 2본 psql 출력 확인): id uuid PK gen_random_uuid() · taxbill_issue_id FK→taxbill_issues **CASCADE**(장 삭제 시 재전송 대기도 소멸) · invoicer_mgt_key text(팝빌 재전송 키) · email · status varchar(20) DEFAULT `pending`(`pending`/`sent`/`failed`) · attempts int DEFAULT 0(상한 5 = `TAXBILL_RESEND_MAX_ATTEMPTS`, 초과 시 failed 확정 — 수동 재전송 몫) · last_error · created/updated_at. UNIQUE(taxbill_issue_id, lower(email)) + partial INDEX(status, created_at) WHERE pending.
  - **기원(Codex 적대검증 수용)** = 재전송을 발행 패스 안에서 인라인으로 보내면 ①전역 발행 락 보유 중 외부 호출이라 SDK 콜백 미호출 시(1.64.2 timeout·error 이벤트가 error 콜백을 안 부름 — 실측) 전 테넌트 발행이 무기한 정지 ②커밋 후 크래시 시 어떤 참조가 누락됐는지 근거 0. → **issued 확정 트랜잭션에서 pending 행을 내구 기록**하고, 락 밖 `processTaxbillEmailResends`(자체 advisory lock·`sendEmailAsync` 30초 유한 타임아웃·행 단위 상태)가 소비한다. 워커 tick이 발행 패스 직후 호출 — 같은 tick 전달. 테이블 미생성 환경은 발행 무영향(기록만 건너뜀·경고 1회).

### billing_invoices (거래내역서/정산)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | 고객사 |
| billing_id | uuid NULL | ★2026-07-29 information_schema 실측 등재(그 전엔 미등재인데 코드가 쓰고 있었다). 연결된 `billings` 행. **공급받는자 사업자 3단 판정에서 계정 축(`billings.user_id`)을 따라가는 통로** — 이게 없으면 같은 건인데 정산서와 거래내역서가 다른 사업자를 인쇄한다. nullable이라 반드시 LEFT JOIN |
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
| type | varchar(20) | deduct / grant / purchase / reset / postpaid_grant / **refund**(★2026-08-13 신설 — 마케팅 플래너 월간 대행 취소 환불) |
| amount | integer | 크레딧 양 (항상 양수, 방향은 type) |
| bucket | varchar(10) | base / purchased / mixed (reset=base) |
| source | varchar(60) | AI 작업 source (orchestrate / dm-ai / generate-messages 등) |
| ai_call_log_id | uuid FK | ai_call_log(id) nullable — 토큰 기록과 연결 |
| idempotency_key | varchar(150) UNIQUE | 재시도 중복 차감 차단 (deduct=`source:aiCallLogId`, reset=`reset:company:YYYYMM`) |
| balance_base_after | integer | 차감/리셋 후 기본분 잔액 (감사) |
| balance_purchased_after | integer | 차감/리셋 후 구매분 잔액 (감사) |
| created_by | uuid | 차감 유발 사용자 (nullable) |
| created_at | timestamptz | DEFAULT now() |
| reason | text NULL | ★2026-07-26 실측 등재. 슈퍼관리자 수동 지급/조정 사유(`adjustCreditWithClient`) |
| overage_credits | integer NULL | ★2026-07-26 실측 등재. 후불 초과 사용분(base가 음수로 간 양). 정산이 이 합을 청구한다(`billing.ts` overage 집계) |
| billed_billing_id | uuid NULL **FK → billings(id) ON DELETE SET NULL** | ★2026-07-26 ALTER 신설. 초과사용분 **청구 완료 마커**. 없던 동안은 기간으로만 합산해서, 기간 경계를 UTC→KST로 옮기면 KST 00~09시 9시간 구간이 두 청구서에 두 번 들어갈 수 있었다(기간 중복검사는 날짜만 본다). `ai_credit_requests.billed_invoice_id`가 FK가 아니라 돈이 샌 전례가 있어 이쪽은 **FK로** 걸었다 — 청구서를 지우면 자동으로 NULL이 되어 다시 청구 대상이 된다. INDEX `idx_ai_credit_tx_billed_billing (billed_billing_id) WHERE billed_billing_id IS NOT NULL` |

- **CHECK 제약 없음** (2026-07-26 `pg_constraint` 실측 — FK 2·PK 1·UNIQUE(idempotency_key) 1뿐. 같은 날 `billed_billing_id` FK 신설로 FK 3). `type`·`bucket`은 문자열이라 새 값을 넣어도 DB가 막지 않는다. 막아주는 게 없으니 **오타가 조용히 새 종류로 적재된다** — 값 추가 시 소비처(집계·화면) 전수 확인 의무.
- `type` 실사용값: `deduct` · `reset` · `grant` · `admin_deduct` · **`refund`**. `bucket` 실사용값: `base` · `purchased` · `mixed` · `overage`.
- **★2026-08-13 `refund` 신설 시 전수 확인한 소비처 4곳**(CHECK가 없으니 코드가 유일한 방어다):
  ①`getMonthlyUsage`·`sumDeductRows` → **차감 − 환불 순액**으로 정정(안 고치면 돌려준 것도 사용량으로 보인다)
  ②정산 초과사용 집계 3문(`billing.ts`·`billing-issue.ts`×2 — `type='deduct' AND overage_credits>0`)은 **그대로 둔다.**
    대신 환불이 **원 deduct 행의 `overage_credits`를 환불분만큼 줄인다**(미청구 행만 — `billed_billing_id IS NULL`).
    집계 쪽을 고치지 않고 원장에서 상계하는 이유 = 발행된 청구서는 뒤에서 바꾸지 않는다는 계약을 지키면서,
    "돈은 돌려줬는데 쓰지 않은 초과사용이 청구서에 남는" 구멍을 닫는 유일한 길이다.
  ③크레딧 이력 화면 2곳(`CreditHistoryModal` `isPlus` · `AdminDashboard` 인라인 판정) → `refund`를 **증가 축**으로.
  ④버킷 복원(★Codex 1R 정정) = `purchased`면 구매분 / `base`면 base / **`mixed`·`overage`면 음수 base를 먼저 0까지 메우고 나머지를 구매분으로.**
    전액을 base로 넣으면 **월 리셋에서 양수 base가 소멸해 고객이 돈으로 산 구매분이 사라진다**(mixed 1000 환불 → purchased 900 소멸).
    그리고 환불도 **월 리셋을 먼저 적용**한 뒤 얹는다(차감과 같은 순서 계약 — 월 경계 직후 환불이 다음 리셋에 덮이는 것을 막는다).
    환불액은 **원 차감액을 넘지 못한다**(넘으면 없던 크레딧이 생긴다).
  ⑤멱등키에 **결제 회차**를 넣는다 — `planner:{회사}:{월}`(회차 0) → 환불 뒤 재승인은 `#1`. 월 고정 키만 쓰면
    "승인 → 무작업 취소·환불 → 재승인"이 duplicate로 끝나 **무료 대행**이 된다(Codex 1R high).

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

> **⛔ 이 테이블에 에이전트(발송ID) 충전을 섞지 말 것** — 승인 경로가 `companies.balance`(웹 지갑)를 올린다. 에이전트 지갑은 게이트웨이 `RSRM_FillAmtHist`라 아래 `agent_charge_orders`로 분리돼 있다.

### agent_charge_requests (에이전트 충전 **실행** 요청 원장)
> ★ 2026-07-24 §5-3 신설 — DDL 적용 완료(운영 실존 확인 2026-07-27). 슈퍼관리자가 게이트웨이 지갑에 INSERT한 **실행 단위**의 멱등·감사 원장이다.
> 잔액·반영 상태의 진실은 여기가 아니라 62 `pay-ingest-db`의 `RSRM_FillAmtHist`(복제 금지 — 6원칙 ③).

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK DEFAULT gen_random_uuid() | |
| idempotency_key | varchar(80) NOT NULL **UNIQUE** | 재전송·더블클릭·응답 유실 재시도에서 이중 충전을 막는 유일 장치 |
| requested_by | varchar(80) | 실행한 슈퍼관리자 |
| reason | varchar(200) NOT NULL | 충전 사유(감사) |
| charges | jsonb NOT NULL DEFAULT '[]' | `[{seqNo, agentSendId, amount, applied}]` — 게이트웨이 SeqNo 연결 |
| total_amount / abs_total | numeric NOT NULL | 순합 / 절대합(일 한도·고액 알림 판정) |
| status | varchar(20) NOT NULL DEFAULT 'reserved' | reserved(예약) → registered(반영 대기) / uncertain(커밋 응답 유실) → resolve로 registered\|not_applied |
| resolved_by / resolved_at / resolve_note | varchar(80) / timestamptz / varchar(200) | 불확실 해소 감사 |
| created_at | timestamptz NOT NULL DEFAULT now() | INDEX(created_at DESC) |

### agent_charge_orders (에이전트 충전 **요청** — 고객사 접수) **(2026-08-11 운영 실존 확인)**
> ★ 2026-07-27 §5-4 신설. 고객사가 "입금했으니 충전해 달라"를 올리는 접수 원장. **이 테이블은 어떤 잔액도 움직이지 않는다** — 증액은 §5-3 실행 경로 하나뿐이고, 여기 행은 직원이 그 화면을 1클릭으로 채우게 해주는 대기열이다.
> ⚠ **이 테이블은 신청 원장일 뿐 지갑 원장이 아니다.** 직원이 계좌이체 확인 후 직접 넣은 충전·차감은 여기 행을 만들지 않고 게이트웨이 `RSRM_FillAmtHist`에만 들어간다 — 고객사 "충전 내역"을 이 테이블로 그리면 그 건들이 통째로 사라진다(2026-08-11 런소프트 접수 기원 — [설계서 §15](../docs/2026-07-24-agent-prepaid-charge-design.md)).
> 상태 전이: `pending` → `processing`(실행 접수·`charge_request_id` 연결) → `fulfilled`(게이트웨이 `RsApplyFlag='Y'` 확인 후에만) / `pending` → `rejected`(사유 필수).

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK DEFAULT gen_random_uuid() | |
| company_id | uuid NOT NULL FK companies | 요청 회사 |
| agent_send_id | varchar(40) NOT NULL | 충전 대상 발송ID (회사 아님 — 한 회사가 서버별로 여럿 보유) |
| amount | numeric(15,2) NOT NULL CHECK (amount > 0) | **양수만**(상계·차감은 내부 전용이라 요청 창구에서 차단) |
| depositor_name | varchar(50) NOT NULL | 입금자명 |
| expected_at | date NULL | 입금(예정)일 |
| memo | varchar(200) NULL | 고객사 메모 |
| status | varchar(20) NOT NULL DEFAULT 'pending' CHECK (pending/processing/fulfilled/rejected) | |
| reject_reason | varchar(200) NULL | 반려 사유 — 고객사 화면에 그대로 표시 |
| charge_request_id | uuid NULL FK agent_charge_requests **ON DELETE SET NULL** | 실행 단위 연결 |
| requested_by / resolved_by | varchar(80) NULL | 요청자 / 처리자 |
| created_at | timestamptz NOT NULL DEFAULT now() | INDEX(status, created_at DESC) · INDEX(company_id, created_at DESC) |
| resolved_at | timestamptz NULL | |

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

### cdp_inapp_messages (In-app Message 정의) — D175-A 신규 + D215+ 확장 (★ 2026-06-11 실측 32컬럼 + 2026-06-17 channel + 2026-06-27 블록 3컬럼 + 2026-07-07 card_style + 2026-07-14 design + audience_filter + 2026-07-21 poster_slides + 2026-07-31 image_link_url = 41)

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
| card_style | text | ★ 2026-07-07 실측(서버 ALTER 실행완료) — 형태 축(색상 테마와 독립): classic/bubble/ticket/poster. NULL·미지원 값=classic 폴백. 카드형(center_modal·slide_in·inline_card·full_screen)만 적용, 토스트/배너/플로팅=classic |
| design | jsonb | ★ 2026-07-14 실측(0 rows 검증 → 서버 ALTER 실행완료) — 디자인 3.0 메시지 단위 디자인. 스키마(전 키 옵셔널·sanitizeInAppDesign 화이트리스트): {font_display(서체 css), treatment(classic/framed/typographic/spotlight — SDK fail-closed), motion(rich/none), backdrop{dim: soft/standard/deep, blur: bool}}. NULL·미설정=현행 렌더(기존 발행물 회귀 0). 쓰기 전 컬럼 선확인(ensureInAppDesignColumnOrThrow — 이메일 규약 미러) |
| audience_filter | jsonb | ★ 실측(FULL_COLUMNS 서빙 실사용 — 부재 시 인앱 조회 42703) — 타겟 추출(/api/targets/extract) filter를 표시 대상으로 저장. NULL=미사용. 전용 UPDATE(setInAppAudienceFilter) |
| poster_slides | jsonb | ★ 2026-07-21 실측(ALTER 실행완료) — 포스터형 캐러셀 슬라이드 배열(최대 5). 각 슬라이드 {image_url(필수), title, body, cta{label,action_url,background_color,text_color}, link_url(★0731 이미지 클릭 링크), title_color, body_color, title_size, body_size}. NULL·1장=단일 포스터. slide[0]은 flat 합성 저장(구버전 폴백) |
| image_link_url | text | ★ 2026-07-31 실측(ALTER 실행 확인 — docker exec targetup-postgres) — 이미지 자체 클릭 시 이동 링크(전 템플릿 공용·sanitizeActionUrl 무해화). NULL=무동작(기존 발행물 회귀 0). 쓰기 전 컬럼 선확인(ensureImageLinkUrlColumnOrThrow, 부재 시 503) |
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

### cdp_assets (에셋 라이브러리) — 2026-07-18 P3 신규 (★ 2026-07-30 운영 information_schema 실측 16컬럼·제약=PK뿐)

회사별 이미지 소재 저장소 — 업로드/AI 생성물(P4) 등재 → 전 채널 에디터 "라이브러리에서 선택" 재사용. CT=`utils/assets.ts`, API=`/api/assets`. 설계 SoT=docs/2026-07-18-inapp-simplify-image-studio-design.md §5.

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK DEFAULT gen_random_uuid() | |
| company_id | uuid NOT NULL | |
| created_by | uuid | |
| kind | varchar(20) NOT NULL DEFAULT 'uploaded' | uploaded/generated/nukki/variant |
| source_asset_id | uuid | 누끼·변형본의 원본 계보 |
| url | text NOT NULL | 서빙 URL (인앱=/api/cdp/inapp/image/{companyId}/{filename}) |
| filename | varchar(255) | 원본 파일명 (검색축) |
| bytes | bigint NOT NULL DEFAULT 0 | 용량 합산 = 플랜 한도 판정(PLAN_STORAGE_LIMITS: ~BASIC 0.5GB/PRO 2.5GB/BUSINESS+ 5GB) |
| format | varchar(20) | |
| origin | varchar(30) NOT NULL DEFAULT 'inapp' | 등재 출처 (inapp/dm/email/studio) |
| prompt | text | AI 생성물 프롬프트 (P4) |
| created_at | timestamptz NOT NULL DEFAULT NOW() | |
| updated_at | timestamptz NOT NULL DEFAULT NOW() | |
| channel_spec | varchar NULL | 용도 태그 (inapp-poster/dm/email/mms/free + 2026-07-30 poster=채널 무관 단일 생성). CHECK 없음(자유 문자열) — 2026-07-30 pg_constraint 실측 제약=PK뿐 |
| width | integer NULL | 0721 추가 (현행 생성 경로는 null 저장) |
| height | integer NULL | 0721 추가 (현행 생성 경로는 null 저장) |
- INDEX: idx_cdp_assets_company(company_id, created_at DESC)
- 삭제 규약: 발행 인앱 메시지 참조 중 = 409 거부 / 미참조 = 행+실물 파일 동시 삭제 (디스크 증식 차단)

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
| target_hint | text | 발송 대상 축(all/dormant/recent_buyers/vip/birthday/new_customers, NULL=자유 해석) — 마케팅 캘린더 완비 (2026-07-07 ALTER 실행완료 — Harold 배포 선언) |
| mms_image_paths | text[] | 채널 mms 첨부 이미지 serverPath 최대 3, NULL=없음 — 자율발송이 validateMmsPayload 게이트 후 직접발송 spec으로 전달 (★2026-07-30 ALTER 실행완료 — Harold, 임은지 접수) |
- INDEX: company_id, status WHERE status='active'
- INDEX: status, next_run_at WHERE status='active' (worker 호출용)
- 2026-06-26 information_schema 덤프 = 위 33컬럼 전부 존재 확정. 중복 4컬럼(notify_phones/backup_phones/notify_channel/lead_minutes)은 DROP 완료(데이터 0). 재질의 금지.
- ★ 2026-07-02 의미 전환: next_run_at = "발송 시각"이 아니라 "생성 시각(발송 희망 − auto_send_lead_minutes)". 기존 행은 −lead UPDATE 마이그레이션 완료(UPDATE 4 실측).

### operator_proposals (AI 매일 제안서) — D176 신규

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| operator_id | uuid **NOT NULL** FK → continuous_operators | ★2026-08-13 실측 — **NULL 불가**. 오퍼레이터 없는 발송(마케팅 플래너)을 이 표에 실을 수 없다는 뜻이라, 플래너 실행은 **전용 워커 + 공용 CT 재사용**으로 확정됐다(가짜 오퍼레이터 편입 = 자동마케팅 화면·통계·만료 워커 오염이라 기각). 판단 근거 = [플래너 3·4 인계](../docs/2026-08-13-planner-phase34-handoff.md) §1-1 |
| company_id | uuid FK | |
| proposal_json | jsonb | OrchestratorResult 통째로 저장 (target/messages/channel/schedule/compliance/cost/performance/meta) |
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
| expiry_reminder_sent_at | timestamptz | 승인 대기 만료 임박(D-3) 리마인드 멱등 마커 (2026-07-07 ALTER 실행완료 — Harold 배포 선언) |
| scheduled_send_at | timestamptz | 발송 예정 시각 — 2026-07-07부터 pending에도 저장(예정일 경과 승인 경고용). 자율 발송 트리거는 status='scheduled'만 |
| conversion_attributed_at | timestamptz | ★ 2026-07-12 신규 — 전환(구매) 귀속 멱등 마커(발송+7일 창 닫힌 뒤 1회 확정 귀속). **적용 완료(2026-07-12 Harold 실행 — 사전 0행 확인 후 ALTER, 실측)** |
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

### one_step_sessions (원스텝 AI 컨텐츠 생성 — 인터뷰 세션) — ★ 2026-08-13 CREATE 실행 완료(Harold 실행 · 15컬럼)

> 설계 = [원스텝 설계서](../docs/2026-08-13-one-step-content-interview-design.md) §6-1. 소비처 = `routes/content-interview.ts` 단일.
> ⛔ `attempt`·`interview_paid_at`이 **요금 멱등의 근거**다 — 생성 키는 회차를 포함하고(재생성은 생성비를 다시 걷는다),
> 대행 델타 키는 세션 고정이라 `interview_paid_at`이 찍힌 뒤에는 다시 걷히지 않는다.
> ⛔ `section_types`는 **정규화 이후 최종 체인**이다 — 결정축 반영은 커버리지로 못 재므로 이것이 계측 축이다.

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK DEFAULT gen_random_uuid() | |
| company_id | uuid NOT NULL FK → companies ON DELETE CASCADE | |
| created_by | uuid FK → users ON DELETE SET NULL | |
| channel | varchar(20) NOT NULL DEFAULT 'dm' | 1차 = DM 단독 |
| answers | jsonb NOT NULL DEFAULT '{}' | 질문 답(원자 병합 저장) |
| prefill | jsonb NOT NULL DEFAULT '{}' | 프리필 맥락 + 출처 라벨 |
| decisions | jsonb NOT NULL DEFAULT '{}' | 생성 시점 결정값 |
| section_types | jsonb NOT NULL DEFAULT '[]' | **정규화 후** 최종 섹션 체인(계측 축) |
| coverage | jsonb | 반영 커버리지(미반영 항목) |
| result_ref | uuid | 생성 결과 참조 |
| attempt | integer NOT NULL DEFAULT 0 | 생성 회차(생성비 멱등키) |
| interview_paid_at | timestamptz | 대행 델타 차감 표식(재차감 차단) |
| status | varchar(20) NOT NULL DEFAULT 'draft' | draft / generated |
| created_at | timestamptz NOT NULL DEFAULT NOW() | |
| updated_at | timestamptz NOT NULL DEFAULT NOW() | |

인덱스 = `idx_one_step_sessions_company (company_id, created_at DESC)`

### event_campaign_drafts (행사 캠페인 3채널 초안 보관) — ★ 2026-08-13 information_schema 실측 등재(10컬럼)

> 코드는 쓰는데 이 문서에 없던 표. 소비처 = `routes/event-campaigns.ts` 단일(드래프트 CRUD) + 화면 `EventCampaignModal`·`EventCampaignResumeBar`(재개 바 — `MarketingCalendarPage`·`QuickCampaignPage` 두 곳에 붙는다).
> ⛔ **이 표에 다른 축의 초안을 얹지 않는다** — 재개 바가 목록을 그대로 읽어 라벨 없는 칩으로 띄우고 3채널 모달을 연다. 원스텝 인터뷰 세션이 별도 표로 간 이유(설계서 §6-1).

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK DEFAULT gen_random_uuid() | |
| company_id | uuid NOT NULL | |
| created_by | uuid NULL | |
| title | varchar NOT NULL DEFAULT '' | |
| event_text | text NOT NULL DEFAULT '' | 행사 원문(생성 입력) |
| source_kind | varchar NOT NULL DEFAULT 'text' | 초안 출처 구분 축 |
| channels | jsonb NOT NULL DEFAULT '{}' | 채널별 payload {dm,email,inapp} |
| status | varchar NOT NULL DEFAULT 'active' | |
| created_at | timestamptz NOT NULL DEFAULT NOW() | |
| updated_at | timestamptz NOT NULL DEFAULT NOW() | |

### campaign_agency_requests (CRM 캠페인 대행 접수·제안서) — 2026-07-09 신규 + 웹 폼 전환 ALTER 2건 (전부 Harold 실행·information_schema 실측 2026-07-09)

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK DEFAULT gen_random_uuid() | |
| company_id | uuid NOT NULL FK → companies ON DELETE CASCADE | 분석 대상 업체(단일 스코프 불변식) |
| created_by | uuid FK → users ON DELETE SET NULL | 접수 계정 |
| title | varchar(200) NOT NULL | 행사명 |
| memo | text | 고객사 메모(웹 폼 접수 = 참고사항 복사) |
| request_file_path | text **NULL 허용(2026-07-09 DROP NOT NULL)** | legacy xlsx 접수 행 전용 — 웹 폼 접수 = null |
| request_file_name | text | legacy 원본 파일명 |
| parsed_json | jsonb | 폼 값 그대로 저장(AgencyRequestParsed — 파싱 단계 소멸)+직원 보정 |
| status | varchar(20) DEFAULT 'received' | received/designing/delivered/done/on_hold |
| proposal_pdf_path | text | 제안서(uploads/agency-proposals/<company>/<id>.pdf) |
| staff_note | text | 직원 내부 메모 |
| designed_at | timestamptz | 제안서 생성 시각 |
| created_at | timestamptz DEFAULT NOW() | |
| updated_at | timestamptz DEFAULT NOW() | |
| image_paths | jsonb **(2026-07-09 ADD)** | 행사 이미지 [{path,name,mime}] ≤5장 — 경로는 클라이언트 비노출(인증 스트림 전용) |
- INDEX: (company_id, created_at DESC) / (status, created_at DESC)
- 소비 = routes/campaign-agency.ts. 비즈니스+ **활성 구독** 게이트(isCompanyEligible). 상세 = docs/2026-07-09-crm-campaign-agency-implementation.md.

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
-- ★ 2026-08-05 실행완료(설치 확인) — "리마인드가 아닌 scheduled는 오퍼레이터당 1건" 계약을 구조로 지킨다.
--   동시 run-now 두 건이 확인→INSERT 사이(수십 초짜리 AI 호출)에 둘 다 통과해 같은 회차 2회 발송·2회 과금이
--   가능했다. 코드는 조건부 INSERT(SELECT ... WHERE NOT EXISTS)로 창을 좁히고 이 인덱스가 최종 방어다.
--   ⛔ scheduled 진입 경로는 셋(INSERT · 야간 승인 approveProposal · 리마인드 CAS 승격) — 리마인드는 조건에서
--   빠지고, 야간 승인은 23505를 받아 승인을 거절한다. 경위 = docs/FEATURE-AUTOMARKETING.md §7-7
CREATE UNIQUE INDEX ux_operator_proposals_one_scheduled ON operator_proposals (operator_id)
  WHERE status = 'scheduled' AND COALESCE(proposal_json->'meta'->>'is_reminder', 'false') <> 'true';
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
  design jsonb,                                 -- ★ 2026-07-13 추가 (ALTER 필요) — 디자인 3.0 캠페인 단위 {theme, art_direction{typeScale,spacingDensity,accentMotif,sectionDivider}, font_family, font_display, palette{primary,accent,background}, preheader} (null=기본 룩)
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
--   ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS design jsonb;  -- ★ 2026-07-13 이메일 디자인 3.0 (information_schema 0 rows 검증 2026-07-13)

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

### ★ 2026-08-02 신규 `customer_grade_ranks` (회사별 등급 서열 — 배포 후 DDL)

등급 상승 판정의 **유일한 근거**. 우리가 등급 사전을 갖지 않고, 그 회사가 한 번 확인한 순서만 믿는다.

| 컬럼 | 타입 | 뜻 |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK → companies (CASCADE) | |
| grade_value | varchar(50) | `customers.grade` 원문 그대로(같은 폭 — 2026-08-02 실측) |
| rank_order | integer NULL | 낮을수록 아래 등급. **같은 값 = 같은 급** / **NULL = 순서 없음**(등급이 아닌 값) |
| confirmed_by | uuid (FK 없음) | 확인한 사람 — 실행자 컬럼에 users FK 금지 규약 |
| confirmed_at · created_at · updated_at | timestamptz | |
| UNIQUE (company_id, grade_value) | | |

⛔ 순위가 매겨진 값이 **2개 미만이면 등급 트리거는 잠긴다**(위로 갈 자리가 없다). 전부 NULL이면 등급이 아니라 분류다.
⛔ `customers.grade` 원문은 건드리지 않는다(원본 보존).

### ★ 2026-08-02 pg_constraint 실조회 — `journey_steps` 제약·참조 (재질의 금지)

저장 후 스텝 추가·삭제(설계서 §13-1) 착수 전 실조회. **코드가 이 세 가지에 기대고 있다.**

| 사실 | 값 | 코드가 이것에 기대는 곳 |
|---|---|---|
| `journey_steps_journey_id_step_order_key` | UNIQUE (journey_id, step_order) · **`condeferrable = f`(즉시 검사)** | 삭제 후 재번호를 한 문장으로 당길 수 없다 → **2단계**(+1000 → −1001). `deleteJourneyStep` |
| `journey_step_logs` · `journey_anchor_dispatch` · `journey_step_variants` → `journey_steps(id)` | **ON DELETE CASCADE** | 스텝 삭제가 **발송 이력·비용 기록을 함께 지운다** → 발송 이력 있는 스텝은 삭제 거부(게이트) |
| `journey_step_snapshots` | **`journey_steps`를 참조하는 FK가 없다**(참조 3건에 안 들어옴) | CASCADE가 안 되므로 삭제 API가 **직접 지운다**. 이 표에 미등재 테이블 — 전체 컬럼 덤프는 아직 없고 `step_id`·`journey_id`(uuid) 실존만 2026-08-02 확인 |

### ★ 2026-06-29 information_schema 실측 대조 (Harold 제공 — 재질의 금지, 이 기록 신뢰)
운영 PG `information_schema`로 `customers` · `cdp_events` · `journeys` · `journey_executions` 4개 테이블 실측 대조 완료.
- `customers` · `cdp_events`(위 6컬럼 보강 반영) = 문서와 일치.
- `journeys` baseline DDL 외 실측 추가 컬럼(정본): `callback_number`(varchar) · `callback_mode`(text) · `auto_reentry_enabled`(boolean) · `archived_at`(timestamptz) · `pretest_notify_step_defaults`(jsonb) · `entry_baseline_at`(timestamptz) · `last_event_cursor`(timestamptz) · `last_pretest_passed_at`(timestamptz) · **`goal_exit_enabled`(boolean NOT NULL DEFAULT false — 2026-07-10 Harold ALTER 실행·실측, 목표 달성 시 자동 종료)**
- `journey_executions.status` 실사용 값(2026-07-10 정본): active/completed/paused/failed + 'ended'(condition 미충족 종료) + **'goal_met'(2026-07-10 신규 — 진입 이후 구매 확인 이탈, completed_at 동반 기록. 재진입 워커는 completed와 동급 취급)**
- `journey_executions` baseline DDL 외 실측 추가 컬럼(정본): `error_log`(jsonb) · `last_error_at`(timestamptz) · `error_count`(integer) · `result_notified_at`(timestamptz)

### ★ 2026-06-30 information_schema 실측 — journey_steps 전체 21컬럼 (Harold 제공, 재질의 금지)
운영 PG 실측. baseline DDL(9컬럼) 외 ALTER 누적 정본 — `journey_steps` 현재 컬럼:
1 id(uuid) · 2 journey_id(uuid) · 3 step_order(int) · 4 step_type(varchar) · 5 delay_hours(int d0) · 6 channel(varchar) · 7 message_template(text) · 8 condition_jsonb(jsonb) · 9 created_at(timestamptz) · 10 is_ad(bool d true) · 11 subject(varchar) · 12 alimtalk_profile_id(uuid) · 13 alimtalk_template_code(varchar) · 14 alimtalk_variable_map(jsonb) · 15 alimtalk_next_type(varchar) · 16 alimtalk_next_contents(text) · 17 alimtalk_next_subject(varchar) · 18 mms_image_paths(ARRAY) · 19 delay_mode(varchar d 'relative') · 20 target_hour_kst(int) · 21 notify_manager_on_pretest(bool)
- 여정 일반화 ALTER **적용 완료(2026-06-30, Harold 실행)**: `journey_steps.anchor_offset_days`(int) — date_anchor D-N offset. journeys 측 = `start_kind`(varchar20 NOT NULL default 'event')·`anchor_date`(date)·`anchor_recurrence`(varchar20 NOT NULL default 'none')·`anchor_recurrence_day`(int)·`anchor_hour_kst`(int)·`one_shot_scheduled_at`(timestamptz). + 신규 테이블 `journey_anchor_dispatch`(journey_id·step_id·customer_id·send_date·campaign_id·created_at, PK(journey_id,step_id,customer_id,send_date)) — date_anchor 단발 발송 멱등. + idx_journeys_start_kind_status.
- ★ 2026-07-11 여정 강화 패키지 ALTER 6건 — **적용 완료(2026-07-11 information_schema 6행 실측, Harold 제공)**: journeys `goal_kind`(varchar20 NOT NULL DEFAULT 'purchase' — 목표 종류 purchase/click/visit) · `holdout_pct`(smallint NOT NULL DEFAULT 0 — 홀드아웃 대조군 %) · `personal_send_time`(boolean NOT NULL DEFAULT false — send-time 개인화) / journey_steps `not_met_goto`(int — condition 미충족 분기 대상 step_order) · `wait_event_name`(varchar50 — wait 이벤트 대기) · `wait_timeout_hours`(int). journey_executions.status 신규 값 **'holdout'**(컬럼 아님 — 미발송 대조군, 발송 tick의 active 조회에서 자동 제외).
- 운영 `customer.points_expiring` 여정 = **0건**(2026-06-30). 운영 여정 row 자체 0(아직 여정 사용 업체 없음) → start_kind 마이그레이션 backfill 불요 · points_expiring 흡수 마이그레이션 불요(코드 일반화만). 단 코드 경로 회귀 차단(9트리거·발송·통계)은 유지.

### 여정 엔진 재설계 신규 (2026-06-04 세션2 — Harold 실행: `docs/superpowers/plans/2026-06-04-journey-redesign.sql`)

> 미적용 — Harold 직접 PG 실행 후 갱신.

- **journeys.entry_baseline_at** `timestamptz` — 신규가입 baseline 설정 시각(첫 활성화 1회·불변). created_at 의존 제거(진입 원장 anti-join 모드 가름).
- **journeys.last_event_cursor** `timestamptz` — cdp 구매·예약 이벤트 처리 커서(이 시각 이후~지금 전수 처리 → 워처 멈춰도 누락 0).
- **★2026-08-02 실행완료(Harold psql 실측)** — §11-4 구매 원장 커서 축:
  - **journeys.last_purchase_cursor** `timestamptz` · **journeys.last_purchase_cursor_id** `uuid` — 구매 원장(purchases) 커서(도착축 created_at + 행 id 타이브레이커). 활성화(journey-builder)가 approved_at으로 심고, NULL이면 워커가 원장 문을 열지 않는다(소급 발송 차단). 커서 값은 `::text` 원문으로 읽고 쓴다(JS Date 왕복 = µs 절사 = 중복 발송 — LESSONS_BACKEND 최상단).
  - **purchases 인덱스 idx_purchases_company_created_id** `(company_id, created_at, id)` — 원장 커서 조회용. `indisvalid = t` 확인. `purchases.created_at`·`purchase_date` = `timestamp without time zone` 실측(created_at=세션 TZ naive / purchase_date=KST naive — 변환은 파라미터 쪽).
  - 재기준 UPDATE 대상 0건(활성 구매 여정 없음 — paused 1·draft 3, 활성화 시 자동 심김).
- **★2026-08-02 실행완료(§11-5 DDL, Harold psql 실측)**:
  - **journey_entry_ledger.state_value** `varchar(100)` — 원장 상태 일반화(§3-0). `kind='state'` 행(사람 단위, store_code NULL 고정)이 이전 등급을 기억 — 등급 변동(#7) 판정 축. 활성화가 재기준(DO UPDATE), 워커가 매 회차 관측 적재(DO NOTHING), 진입 트랜잭션이 갱신.
  - **journeys CHECK `journeys_trigger_event_registered`** — trigger_event 16값 화이트리스트(§5-4 DB측, 레지스트리 `TRIGGER_CONTRACTS`와 1:1). NOT VALID → VALIDATE 통과 = 기존 전 여정 값이 등록 집합 안임을 실증. **새 트리거 추가 시 레지스트리와 이 CHECK를 함께** — 어긋나면 저장은 되는데 DB가 거부하거나 그 반대가 된다.
- **journey_entry_ledger**(`journey_id` uuid FK→journeys CASCADE, `company_id` uuid, `store_code` varchar null, `phone` varchar, `kind` varchar 'baseline'|'entered', `created_at`) · **UNIQUE(journey_id, company_id, COALESCE(store_code,'__NONE__'), phone)** + idx(journey_id) — 신규가입 "전에 본 적 없는 식별자"만 진입. 키 = 시스템 upsert 식별자(회사+매장코드+전화번호).
- **journey_step_campaigns**(`journey_id` uuid FK→journeys CASCADE, `step_id` uuid, `send_date` date, `campaign_id` uuid, `created_at`) · **PK(journey_id, step_id, send_date)** — 묶음 발송: (journey,step,KST날짜)당 campaign 1건 공유(발송결과 1줄 + app_etc1=campaignId 상세 검색).

### ★ 2026-07-20 Track C M2 — 게이트웨이 알림톡 매핑 2테이블 (템플릿관리자 흡수)

> **적용 완료(2026-07-20 Harold psql 실행 — 시드 4,680행 적재·대조·R0001 실측으로 실증).**
> DDL 사전검증 0720 통과(Harold 실행): 두 테이블 information_schema 0 rows(부재) + 참조 컬럼 7개 실존(companies.id · kakao_templates id/status/template_code/company_id/profile_id · kakao_sender_profiles.profile_key).
> 설계 SoT = docs/2026-07-14-template-migration-track-bc-design.md §4-9-A. 소비처 = utils/gateway-template-mapping-worker.ts · routes/gateway-templates.ts (super_admin 전용).

```sql
-- ① 고객사 ↔ 게이트웨이 납입자ID 연결 (billid는 리터럴 — 병기 'P0042;R0003' 분해 금지)
CREATE TABLE gateway_bill_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id       varchar(30)  NOT NULL UNIQUE,
  server        varchar(2)   NOT NULL CHECK (server IN ('54','58')),
  company_id    uuid         REFERENCES companies(id),   -- NULL 허용: 시드 직후 미연결 상태
  bill_name     varchar(128) NOT NULL DEFAULT '',        -- 레거시 표기(참고용)
  default_usemod varchar(100) NOT NULL,                  -- 신규 템플릿 기본값(시드 최빈값)
  auto_push_enabled boolean   NOT NULL DEFAULT false,    -- 회사별 점진 개시(파일럿 게이트)
  is_active     boolean      NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ② 매핑 desired state + 동기화 상태 (게이트웨이 1행 = 여기 1행)
CREATE TABLE gateway_template_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id       varchar(30)  NOT NULL,
  server        varchar(2)   NOT NULL CHECK (server IN ('54','58')),
  tmplcd        varchar(100) NOT NULL,
  tran_tmplcd   varchar(100) NOT NULL,                   -- 빈 값 금지 — 항상 채움(기본=tmplcd)
  senderkey     varchar(100) NOT NULL,
  billnm        varchar(128) NOT NULL DEFAULT '',
  usemod        varchar(100) NOT NULL,                   -- 행 단위 값(§4-0-2 — 서버 상수 아님)
  company_id    uuid,
  kakao_template_id uuid REFERENCES kakao_templates(id), -- auto 생성분만, seed는 NULL
  source        varchar(10)  NOT NULL DEFAULT 'auto' CHECK (source IN ('seed','auto','manual')),
  sync_status   varchar(12)  NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending','synced','failed','orphan')),
  attempts      int          NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  last_error    text,
  last_synced_at timestamptz,
  last_seen_at  timestamptz,                             -- 대조에서 게이트웨이 실존 확인 시각
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bill_id, tmplcd)                               -- = 게이트웨이 upsert 키와 동일
);
CREATE INDEX idx_gtm_status_retry ON gateway_template_mappings (sync_status, next_retry_at);
CREATE INDEX idx_gtm_company ON gateway_template_mappings (company_id);
```

- sync_status: pending(push 대기/재시도) → synced(효과 검증 통과) / failed(8회 초과·영구 오류 — 알림 후 수동 재개) / orphan(게이트웨이에만 있는 행 — 표시 전용, 자동 삭제 절대 X)
- source: seed(서팀장 엑셀 4,681행 — sync_status 'synced'로 적재) / auto(적재 스캔 생성) / manual(수동 등록 + 대조가 발견한 고아 행)
- env 게이트: `GATEWAY_TMPL_SYNC_ENABLED`(마스터, 기본 false) · `GATEWAY_TMPL_54_ENABLED`(54 푸시, 기본 false — P0001 한글 왕복 실측 후) · `GATEWAY_TMPL_API_TOKEN`
