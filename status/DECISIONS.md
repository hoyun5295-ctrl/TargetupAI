# 한줄로 — DECISION LOG (ADR)
> 이 문서가 의사결정 기록의 유일한 소유 문서다. STATUS.md에는 최근 5건 1줄 요약만 존재한다.
> 원본: STATUS.md §9 — 2026-07-03 관제탑 재설계 v2로 원문 그대로 이관.

## 9) DECISION LOG (ADR Index)
> 항목이 10개를 초과하면 오래된 항목은 아카이브로 이동하고 1줄 요약만 남긴다.

| ID | 날짜 | 결정 | 근거 |
|----|------|------|------|
| D36 | 02-26 | MySQL 타임존 KST — 풀 레벨 보강 | 커넥션 풀 10개 중 1개만 TZ 설정되는 구조적 문제 |
| D37 | 02-26 | GPT 의견 수용 원칙 — 코드 근거 기반 판단 | GPT "미수정" 지적에 코드 확인 없이 동의→문서 오염 |
| D38 | 02-26 | 표준 필드 아키텍처 복구 — standard-field-map.ts 매핑 레이어 도입 | 4곳 하드코딩 불일치→필터 전멸+데이터 손실 |
| D39 | 02-26 | 표준 필드 아키텍처 재정의 — 필수 17개 + 커스텀 15개 확정 | 기존 41개→32개 정리. FIELD-INTEGRATION.md 기준 |
| D40 | 02-27 | AI 맞춤한줄 동적 필드 + UX 개선 — 커스텀 실데이터만 노출 + 톤 제거 + 필드명 표시 | enabled-fields 단일 경로+JSONB 실데이터만 반환 |
| D41 | 02-27 | 대시보드 동적 카드 시스템 — 슈퍼관리자 체크 설정 + FIELD_MAP 17개 기반 카드 풀 | 고객사마다 보유 데이터 다름. 하드코딩 고정→동적 전환. company_settings 활용, 4칸/8칸 모드 |
| D42 | 02-27 | 발송현황 하드코딩 제거 — VIP/30일매출 → 성공건수/평균성공률/총사용금액 | 발송현황 영역에 VIP·매출은 맥락 불일치. 발송 관련 지표로 통일 |
| D43 | 02-27 | 기능 정상화 및 DB 동적 기준 정립 — 5개 안건 (회사명/매핑UI/타겟필터/수신거부동기화/AI포맷) | D39 이후 미반영 기능 정상화. 발송 파이프라인 미접촉 |
| D44 | 02-27 | AI 매핑 화면 개편 — 컴포넌트 분리 + 태그 클릭 2열 그리드 + 커스텀 +/- | 하드코딩 드롭다운 16개→FIELD_MAP 동적 20개, Dashboard.tsx 310줄 분리 경량화 |
| D45 | 02-27 | AI 한줄로 3종 개선 — 개인화 필수 파싱 + 샘플 고객 미리보기 + 이모지 강제 제거 | 변수 오류 방지+미리보기 실감+SMS 깨짐 방지. 발송 파이프라인 무접촉 |
| D46 | 02-27 | 직접 타겟 설정 전면 리팩토링 — 컴포넌트 분리 + 전체 필드 노출 + 2열 컴팩트 + 다중선택 + 연령범위 | SKIP_FIELDS 제거(Harold님 확정), 사용자에게 필드 선택 위임. Dashboard 405줄 감소 |
| D47 | 02-27 | 직접 타겟 발송 모달 분리 + 하드코딩 8곳 동적화 + 커서위치 버그 수정 — TargetSendModal.tsx 신규 | fieldsMeta 기반 동적(자동입력/테이블/치환/바이트체크/미리보기). Dashboard 638줄 감소 |
| D48 | 02-27 | 수신거부 양방향 동기화 — plan_id 기준 customers.sms_opt_in 동시 UPDATE + opt_out_auto_sync 플래그 | unsubscribes=SoT, opt_outs 레거시 확인, 나래인터넷 전용 auto_sync 분기. 080번호 하드코딩 제거→동적 |
| D49 | 02-28 | 🔴 MySQL 랜섬웨어 긴급 대응 — 외부 차단+비밀번호 강화+권한 분리+보안 강화 | 3306 외부 노출→봇 공격→SMSQ 테이블 삭제. 127.0.0.1 바인딩+smsuser DROP 권한 제거+fail2ban+UFW 포트 차단. PostgreSQL 무사, 고객 데이터 유출 없음 |
| D50 | 02-28 | 결과코드 매핑 Phase 3 — 프론트 하드코딩 제거 + 백엔드 해석값 전달 | ResultsModal.tsx STATUS_CODE_MAP(14개)/CARRIER_MAP(9개) 하드코딩 삭제→백엔드 API가 sms-result-map.ts 기반 해석값 직접 전달. 프론트에 결과코드 매핑 로직 없음=불일치 불가 |
| D51 | 02-28 | 결과코드 매핑 Phase 4 — 3-Tier 전수 점검 완료 + admin.ts/billing.ts 전환 | admin.ts 5곳(statusMap7개+carrierMap3개 로컬 삭제→헬퍼 사용+statusType 추가) + billing.ts 5곳(3개 집계함수→상수참조) + `>=200` 버그 수정(실패 건수 누락). AdminDashboard.tsx statusType 동적 분기. ResultsModal.tsx sampleData 동적 치환. **18파일 점검, 하드코딩 잔존 0건** |
| D52 | 03-04 | 하드코딩 전수조사 + 동적 전환 + 설정 중앙집중화 (B11-01~05) | (1) campaigns.ts `'18008125'` 폴백→DB 필수화 (2) alert()→setToast 전면교체(40+곳) (3) ai.ts `'0807196700'`→DB 동적조회 (4) 단가 5파일→defaults.ts (5) AI모델명 4파일→AI_MODELS (6) Redis 4곳→공유인스턴스 (7) 타임아웃/배치/캐시TTL/RateLimit 12파일→중앙상수. **총 21건 전체 해소, 12파일 수정, 기간계 무접촉** |
| D53 | 03-04 | 요금제별 기능 게이팅 — 무료/스타터/베이직/프로/비즈니스 5단계 기능 잠금 | plans 테이블 3컬럼 추가(customer_db_enabled/spam_filter_enabled/ai_messaging_enabled). 백엔드 6파일 API 게이팅 + 프론트 5파일 UI 잠금. 무료=직접발송만, 스타터=+스팸필터+고객DB+타겟팅, 베이직=+AI발송, 프로=+AI분석basic, 비즈니스=+AI분석advanced. **기간계 무접촉** |
| D54 | 03-05 | 스팸필터 폴링 로직 개선 — QTmsg 성공 후 10초 대기→BLOCKED 판정 | 기존 3분 무조건 대기→QTmsg 성공 시점 추적(qtmsgSuccessTime Map)+10초 grace period. 타임아웃 180→60초. 이력 탭 추가. **기간계 무접촉** |
| D55 | 03-05 | 보안 긴급점검 + 슈퍼관리자 세션 관리 + 세션 타이머 UI | JWT_SECRET/MYSQL_PASSWORD fail-fast(폴백값 제거, 미설정 시 서버 기동 차단). mms-images.ts 자체 JWT→공용 authenticate. Math.random()→crypto.randomInt(). 슈퍼관리자 3중 구멍 수정(세션 미생성/세션체크 건너뛰기/프론트 감시 스킵→전부 해소, 30분 타임아웃). user_sessions.user_id FK 제거(DDL-D55, super_admins ID 허용). expires_at 서버측 만료 강제(브라우저 닫기→재오픈 시 서버 차단). dotenv.config() app.ts 최상단 이동. 은행 스타일 세션 타이머 UI 전체 사용자 적용. **코드+DDL+배포 완료. 기간계 무접촉** |
| D56 | 03-05 | P0-Q1 SQL Injection 방지 + 스팸필터 선불차감 누락 수정 | sms-table-validator.ts 신규(화이트리스트 정규식). admin.ts 라인그룹 생성/수정 API 입구 검증. campaigns.ts 환경변수 경고+DB 조회 필터링+prepaidDeduct/prepaidRefund export. spam-filter.ts 선불차감 추가(테스트폰×메시지타입 건수). 수정 3파일+신규 1파일. **기간계 무접촉. 배포+실서버 검증 완료** |
| D57 | 03-05 | P0-C1~C5 발송 파이프라인 안정화 5건 전체 구현 | **(C1)** AI발송+직접발송 per-customer/per-batch try/catch→sentCount 추적→부분실패 시 실패분만 선별적 환불(기존 all-or-nothing 제거). **(C2)** normalize-phone.ts 신규(normalizePhone 단일함수, `/\D/g` 비숫자 전체 제거)→campaigns.ts 27곳 `replace(/-/g,'')` 통일 교체+**directCustomerMap 키 불일치 핵심버그 수정**(L1962 raw phone→normalizePhone). **(C3)** calcSplitSendTime() 헬퍼 신규—SEND_HOURS.end 초과 시 다음날 start로 이월. defaults.ts SEND_HOURS 설정 추가(환경변수 SEND_START_HOUR/SEND_END_HOUR). 직접발송 SMS+카카오 2경로 적용. **(C4)** AI발송 sendTime `'${sendTime}'` 템플릿 리터럴→`?` 파라미터화(SQL Injection 차단). **(C5)** 테스트발송 bill_id `userId\|\|''`→`randomUUID()` 고유 추적ID+requestUid 통일+실패건 DB 기록+응답에 testRequestUid 반환. 수정 2파일(campaigns.ts, defaults.ts)+신규 1파일(normalize-phone.ts). TypeScript 0에러. **기간계 발송 흐름 자체는 변경 없음 — 에러 처리/환불/정규화 보강만** |
| D58 | 03-06 | 12차 버그리포트 4건 수정 + 기능개선 3건 — 예약취소 Agent 대응, 발송결과 타임아웃, 필터 UI 전면개선, 담당자테스트 | **(B12-01)** 예약취소 DELETE+UPDATE 이중처리(Agent 픽업건 9999 코드) **(B12-02)** sync-results 60분 타임아웃+환불 **(B12-03)** 스팸필터 subject 전달 **(B12-04)** 특수문자/보관함/저장 모달 공용화 **(F12-01)** AI 머지태그 원본 표시 **(F12-02)** 필터 UI: 성별 자동감지 패턴매칭(gender/sex/성별)+DB값 자동매핑(M/F/male/남/여/1/0→한글), 생일 월별 프리셋, 금액 최소~최대 범위입력(콤마포맷+원 단위+빠른선택+col-span-2), 수신자 테이블 성별 한글 표시 **(F12-03)** 타겟발송 담당자테스트 버튼(3열 그리드+10초 쿨다운). 수정 7파일. **기간계 무접촉** |
| D59 | 03-07 | 2차 코드 전수점검 P1~P6 총 28건 수정 — 정산정확성+SQL Injection+입력검증+하드코딩+인프라+프론트엔드 | **(P1)** ai.ts `\|\|10`→`??10`, analysis.ts 채널별 정확비용, manage-stats.ts dead code 삭제. **(P2)** safe-field-name.ts 신규+campaigns/customers/ai 3파일 custom_fields 화이트리스트+dateFilter 파라미터화. **(P3)** mms-images UUID검증, upload.ts path.basename, manage-users 비밀번호8~72자. **(P4)** SYSTEM_SMS_CALLBACK 환경변수화, INVITO_INFO 상수+billing 4곳교체, ©연도 동적화5곳, constants/company.ts 신규+15곳교체. **(P5)** Redis error handler, AI API 키 warn, process 에러핸들러(PM2 연계), PG Pool 환경변수설정. **(P6)** Dashboard setInterval cleanup, optOutNumber 안전장치, 교차중복발송방지, console.log삭제. 수정20파일+신규4파일. **기간계 무접촉. tsc 3패키지 전체 통과** |
| D60 | 03-08 | SyncAgent API Key 관리 UI + 사용자별 라인그룹 배정 | 상용화 온보딩 시 DB 직접 접근 불가→슈퍼관리자 UI 필요. 동일 회사 내 사용자간 발송 라인 공유→홀딩 문제. users.line_group_id 추가, getCompanySmsTables userId optional 확장. 기간계 기존 호출 100% 호환. |
| D61 | 03-08 | 프론트엔드 난독화 적용 | 상용화 전 소스 보호. vite-plugin-javascript-obfuscator production only. stringArray+base64+disableConsoleOutput. frontend+company-frontend 양쪽. |
| D67 | 03-12 | 080 콜백 진단 + 수신동의 변형 + 사용자별 고객DB 삭제 | 080 콜백 서버코드 정상 확인(나래측 URL 미등록 원인). 연동테스트 stale state 버그 수정. SMS_OPT_IN_FALSE 13개 변형 추가(비동의/불동의/거절/해지 등). admin.ts 사용자별 uploaded_by 기준 고객 삭제 API+UI. 기간계 무접촉 |
| D68 | 03-12 | 대시보드 UI 4건 + AI 생일 타겟팅 + 테스트 비용 합산 | (1) 총구매금액 $→CreditCard+천단위콤마 (2) 커스텀필드 라벨 is_hidden NULL 미매칭 수정 (3) AI 생일타겟팅: 프롬프트+customer-filter mixed+3경로 전부 birth_date 추가 (4) 발송현황 총사용금액에 담당자테스트+스팸필터 비용 합산. 메트로시티 가상DB 2만건 생성. 기간계 무접촉 |
| D69 | 03-12 | 자동발송 기능 기초 설계 | 메트로시티 요청. auto_campaigns+auto_campaign_runs 테이블 설계, PM2 워커+D-1 사전알림 아키텍처, 프론트 AutoSendPage(블러 프리뷰 게이팅)+DashboardHeader 메뉴 추가. 프로 이상 전용. company_user(브랜드담당자) 생성/수정/삭제 가능. 매월 28일 max. 기존 파이프라인(customer-filter, sms-queue, messageUtils) 100% 재활용. 설계문서: AUTO-SCHEDULE-DESIGN.md |
| D73 | 03-14 | 무료체험 PRO 게이팅 + 수신거부 브랜드 자동배정(CT-03) + 커스텀 필드 라벨 UPSERT(CT-07) | 무료체험 만료 후 직접발송만 유지. 수신거부 admin 등록 시 store_code 기준 브랜드 사용자 자동배정(기존 admin 몰림 방지). "최초 등록 우선" 라벨 고착 버그→ON CONFLICT DO UPDATE. 컨트롤타워 우선 확인 원칙 CLAUDE.md 섹션 0 추가 |
| D78 | 03-16 | 프로 자동 스팸필터 테스트 + CT-09 spam-test-queue.ts | 프로 요금제 차별화 핵심. AI 문안생성→자동 스팸테스트(큐 기반 순차처리)→차단 시 자동 재생성(최대2회). 프로 이상 무료. DB: plans.auto_spam_test_enabled + spam_filter_tests(source/variant_id/batch_id). spam_check_number 하드코딩 제거→080번호 동적조회. **배포 완료, 실서비스 E2E 검증 필요** |
| D71 | 03-13 | customers_unified 뷰 store_phone 누락 + upload.ts region 중복 수정 | (1) 슈퍼관리자 고객DB 탭 500 에러: customers_unified 뷰에 store_phone 미포함 → DROP+CREATE VIEW로 store_phone 추가 (서버 DDL). (2) 엑셀 업로드 30,000건 전건 오류: D70-17에서 region을 FIELD_MAP에 추가했으나 upload.ts에서 이미 파생 컬럼으로 별도 처리 → INSERT에 region 중복 → insertCols/rowValues/updateClauses 3곳에서 명시적 region 제거, FIELD_MAP 순회에서 derivedRegion 우선 사용하도록 통합. **교훈:** ①customers 테이블 컬럼 추가 시 customers_unified 뷰도 반드시 재생성 ②FIELD_MAP에 필드 추가 시 upload.ts 파생 컬럼과 중복 여부 확인 필수. 수정 1파일(upload.ts)+DDL 1건 |
| D79 | 09-04 | 링크가드 = 독립 제품·별도 저장소 · 게이트웨이는 관제센터 클라이언트 | Harold "별도 폴더·관제센터 포함(.65)". 제품 SoT = projects/linkguard/docs/FEATURE-LINKGUARD.md · 게이트웨이 접점 피더 = docs/bito-gateway/FEATURE-GW-LINKGUARD.md. 해시 비밀 원천 = 관제센터(게이트웨이 ENV 폐지). 배포만으로는 아무도 안 막힘(정책 토글·원장 항목 일치 때만). Codex 적대 7R 종결 뒤 .65 배포·차단 실측 1건. |
| D80 | 09-04 | 관제센터 관리자 OTP = 첫 로그인 QR 등록(ENV 키는 선택) | Harold "로그인하면 QR 뜨게". 비밀번호 확인 뒤 임시 키·QR → 6자리로 확정(linkguard_admin_totp) · 초기화는 CLI totp-reset 만(화면·API 없음) · ENV 에 키가 있으면 고정. |
| D81 | 09-04 | 카카오 실패 전환분(KS·KL) = 일반 SMS·LMS 단가로 청구(전용 단가 컬럼 미신설) | 전환의 실체가 그 문자 발송이고, 랩디 V0001 실측상 쓰는 발송ID가 전 기간 한 곳뿐이다. 전 고객사 단가 화면에 입력 칸을 둘 늘리면 0814에 정리한 "안 쓰는 유형이 목록을 채우는" 소음이 되살아난다. KS·KL 코드 자체는 발송 통계 화면의 **가시성**(알림톡이 실패해 문자로 나간 건수) 용도로 유지한다. 전환 단가를 문자와 다르게 매길 필요가 생기면 그때 별도 컬럼을 만든다. 경위 = [BUGS B-0904-5](BUGS.md) · 반영 = `billing-types.ts` agentCodeAliases |

**아카이브:** D1-AI발송2분기(02-22) | D2-브리핑방식(02-22) | D3-개인화필드체크박스(02-22) | D4-textarea제거(02-22) | D5-별도컴포넌트분리(02-22) | D6-대시보드레이아웃(02-22) | D7-헤더탭스타일(02-23) | D8-AUTO/PRO뱃지(02-23) | D9-캘린더상태기준(02-23) | D10-6차세션분할(02-23) | D11-KCP전환(02-23) | D12-이용약관(02-23) | D13-수신거부SoT(02-23) | D14-7차3세션분할(02-24) | D15-제목머지→D28번복(02-25) | D16-스팸테스트과금(02-25) | D17-테스트통계확장(02-25) | D18-정산자체헬퍼(02-25) | D19-구독상태필드(02-25) | D20-AI분석차별화(02-25) | D21-planInfo실시간(02-25) | D22-스팸잠금직접발송만(02-25) | D23-preview보안(02-25) | D24-run세션1완전구현(02-25) | D25-pdfkit선택(02-25) | D26-분석캐싱24h(02-25) | D27-비즈니스3회최적화(02-25) | D28-제목머지제거(02-25) | D29-5경로전수점검(02-25) | D30-즉시sending전환(02-25) | D31-GPT fallback(02-25) | D32-발송파이프라인복구(02-26) | D33-messageUtils통합(02-26) | D34-스팸필터DB직접조회(02-26) | D35-선불환불보장(02-26) | D-대시보드모달분리(02-23): 8,039줄→4,964줄

---

