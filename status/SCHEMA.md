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
| 12 | kakao_sender_profiles | 카카오 발신 프로필 |
| 13 | kakao_templates | 카카오 템플릿 |
| 14 | kakao_friendtalk_images | 카카오 친구톡 이미지 |
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
| created_at | timestamp |

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
| api_key | varchar(100) | |
| api_secret | varchar(100) | |
| max_users | integer | 최대 사용자 수 (기본 5) |
| session_timeout_minutes | integer | 세션 타임아웃 분 (기본 30) |
| created_by | uuid | |
| created_at | timestamp | |
| updated_at | timestamp | |

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
| created_at | timestamp |
| updated_at | timestamp |
- UNIQUE: (company_id, COALESCE(store_code,'__NONE__'), phone)

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
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| profile_key | varchar(100) |
| profile_name | varchar(100) |
| is_active | boolean |
| created_at | timestamp |

### kakao_templates (카카오 템플릿)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| profile_id | uuid FK |
| template_code | varchar(50) |
| template_name | varchar(100) |
| content | text |
| buttons | jsonb |
| status | varchar(20) |
| reject_reason | text |
| created_at | timestamp |
| updated_at | timestamp |
| approved_at | timestamp |

### kakao_friendtalk_images (카카오 친구톡 이미지)
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

### plans (요금제)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| plan_code | varchar(20) |
| plan_name | varchar(50) |
| max_customers | integer |
| monthly_price | numeric(12,2) |
| is_active | boolean |
| trial_days | integer |
| ai_analysis_level | varchar(20) | none/basic/advanced (기본 none) |
| created_at | timestamp |

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
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK NOT NULL |
| phone | varchar(20) |
| source | varchar(20) |
| created_at | timestamp |
- UNIQUE: (user_id, phone)
- INDEX: company_id (080 콜백용)

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

---

## MySQL 테이블 (QTmsg - smsdb)

### SMSQ_SEND_1~11 (SMS 발송 큐 - 11개 Agent 라인그룹 분배)
> 로컬: SMSQ_SEND (1개), 서버: SMSQ_SEND_1~11 (11개, 환경변수 SMS_TABLES + 라인그룹으로 분기)

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
| created_at | timestamptz | |

### payments (PG 결제 내역)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | 고객사 |
| payment_method | varchar(20) | card/virtual_account/transfer |
| pg_provider | varchar(20) | tosspayments |
| pg_payment_key | varchar(200) | PG 결제 키 |
| pg_order_id | varchar(100) | 주문 ID |
| amount | numeric(15,2) | 결제 금액 |
| status | varchar(20) | pending/completed/failed/cancelled |
| paid_at | timestamptz | |
| cancelled_at | timestamptz | |
| pg_response | jsonb | PG 응답 원본 |
| created_at | timestamptz | |

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
