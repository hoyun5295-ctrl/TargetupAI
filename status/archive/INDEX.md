# 아카이브 INDEX — grep 진입점
> 과거 작업·종결 버그·옛 설계서는 반드시 이 인덱스 grep으로 진입한다 (doc_routing). 원문은 링크 파일에 무손실 보존.
> 생성: 2026-07-03 관제탑 재설계 v2 (원본 STATUS.md §4 179건 중 157건 + 최근 완료 20건 = 177건 이동)

## 1) 과거 CURRENT_TASK (원문 = TASKS_YYYY-MM.md)

> 검색 키워드 = 원문에 실제 등장하는 증상·도메인어 + 파일명 + CT (창작 0). 2026-07-03 증상어 보강.

| 날짜 | 제목 | 검색 키워드 | 파일 |
|------|------|-------------|------|
| 2026-02-27 | 🔧 D43 — 기능 정상화 및 DB 동적 기준 정립 (2026-02-27~) — ✅ 전체 완료 | 환불 차감 정산 카카오 수신거부 080 타겟발송 발송결과 개인화 변수 sms-result-map.ts auth.ts companies.ts Dashboard.tsx | [TASKS_2026-02.md](TASKS_2026-02.md) |
| (무날짜·2026-02) | ✅ 이전 완료 요약 | 선불 수신거부 080 대시보드 요금제 세션 스팸 스팸필터 모달 billing.ts | [TASKS_2026-02.md](TASKS_2026-02.md) |
| 2026-03-31 | 🔧 D101 — 0331 PPT 버그리포트 15건 디버깅 (2026-03-31) — ✅ 배포완료 | 회신번호 직접발송 개인화 업로드 엑셀 슈퍼관리자 리포트 스팸 배포 messageUtils.ts formatDate.ts ai.ts TargetSendModal.tsx | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-31 | 🔧 D100 — PPT 버그리포트 전면 디버깅 + 전단AI 이미지 + 세션 동시접속 (2026-03-31) — ✅ 배포완료 | 템플릿 업로드 엑셀 세션 로그인 캘린더 리포트 스팸 배포 모달 messageUtils.ts ai.ts upload.ts customers.ts | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-28 | 🔧 D99 — 브랜드메시지 수신자 확장 + 날짜 밀림 최종 수정 + 개별회신번호 컬럼 선택 (2026-03-28) — ✅ 배포완료 | 브랜드메시지 회신번호 엑셀 마이그레이션 배포 formatDate.ts KakaoRcsPage.tsx BrandMessageEditor.tsx BrandMessagePreview.tsx CT-08 | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-27 | 🔧 D98 — PPT 버그리포트 11건 전면 수정 + 재검증 (2026-03-27) — ✅ 배포완료 | 알림톡 업로드 엑셀 대시보드 세션 리포트 스팸 스팸필터 배포 deduplicate.ts formatDate.ts results.ts CustomerDBModal.tsx CT-14 CT-11 | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-27 | 🔧 D97 — 브랜드메시지 전체 구현 + 디버깅 이슈 발견 (2026-03-27) — ✅ 배포완료 | 차감 선불 브랜드메시지 카카오 템플릿 회신번호 수신거부 직접발송 변수 업로드 brand-message.ts sms-queue.ts campaigns.ts BrandMessageEditor.tsx CT-12 CT-04 | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-26 | 🔧 D96 — 자동발송 테스터 피드백 5건 + 직접발송 분리 + 슈퍼관리자 (2026-03-26) — ✅ 배포완료 | RCS 템플릿 발신번호 회신번호 직접발송 자동발송 타겟발송 변수 슈퍼관리자 세션 Dashboard.tsx auto-campaigns.ts AutoSendPage.tsx AutoSendFormModal.tsx | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-26 | 🔧 D95 — QA 버그리포트 11건 + 컨트롤타워 정비 + 헤더 UI (2026-03-26) — ✅ 배포 완료 | 알림톡 카카오 RCS 템플릿 회신번호 직접발송 자동발송 발송결과 개인화 변수 highlightVars.tsx Dashboard.tsx AiCustomSendFlow.tsx formatDate.ts | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-25 | 🔧 D94 — 채널 확장 Phase 1: 카카오&RCS 메뉴 + 알림톡 발송 (2026-03-25) — ✅ 배포 완료 | 정산 알림톡 브랜드메시지 카카오 RCS 템플릿 회신번호 직접발송 변수 슈퍼관리자 companies.ts admin.ts sms-queue.ts campaigns.ts CT-04 | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-23 | 🔧 D91 — QA 버그리포트 10건 전면 수정 (2026-03-23) — ✅ 수정 완료 | 발신번호 회신번호 수신거부 080 타겟발송 발송결과 개인화 치환 마이그레이션 리포트 ai.ts campaigns.ts results.ts packages/backend/src/utils/callback-filter.ts CT-08 | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-20 | 🔧 D90 — AI 한줄로/맞춤한줄 개별회신번호 옵션 누락 수정 (2026-03-20) — ✅ 수정 완료 | 회신번호 직접발송 모달 AiCampaignSendModal.tsx Dashboard.tsx TargetSendModal.tsx packages/frontend/src/components/AiCampaignSendModal.tsx | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-20 | 🔧 D89 — 마이너 수정 5건 + D88 직접발송 잠금 회귀 수정 (2026-03-20) — ✅ 배포 완료 | 카카오 예약발송 직접발송 발송결과 고객DB 무료체험 스팸 스팸필터 배포 customer-filter.ts CustomerDBModal.tsx results.ts formatDate.ts CT-01 | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-20 | 🔧 D88 — QA 버그리포트 11건 전면 수정 (2026-03-20) — ✅ 배포 완료 | 발신번호 회신번호 수신거부 직접발송 자동발송 개인화 업로드 고객DB 게이팅 무료체험 DashboardHeader.tsx Dashboard.tsx auto-campaigns.ts CustomerDBModal.tsx CT-08 | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-19 | 🔧 D87 — 발신번호 사용자별 배정 기능 (2026-03-19~20) — ✅ 배포 완료 | 발신번호 이메일 슈퍼관리자 마이그레이션 사고 배포 모달 sender-registration.ts manage-callbacks.ts companies.ts CallbacksTab.tsx CT-10 | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-19 | 🔧 D86 — 자동발송 완전화 + 맞춤한줄/개인화/스팸 수정 (2026-03-19) — ✅ 배포 완료 | 자동발송 개인화 문안 스팸 사고 배포 모달 services/ai.ts routes/ai.ts AiCustomSendFlow.tsx Dashboard.tsx | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-19 | 🔧 D83 — 고객DB 필터 전면 수정 + 자동발송 3건 중복/시간오차/개인화 (2026-03-19) — ✅ 배포 완료 | 자동발송 미발송 개인화 고객DB 워커 타임존 세션 리포트 배포 customer-filter.ts normalize.ts CustomerDBModal.tsx customers.ts CT-01 | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-18 | 🔧 D82 — AI 타겟추출 정상화 + 전체필드 동적필터 통일 + 개인화 통일 + 자동발송 시간 KST (2026-03-18) — ✅ 배포 완료 | 자동발송 개인화 치환 고객DB 스팸 배포 routes/ai.ts services/ai.ts customer-filter.ts CustomerDBModal.tsx CT-01 | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-16 | 🔧 D78 — 프로 요금제 자동 스팸필터 테스트 + CT-09 (2026-03-16) — 배포 완료, 실서비스 검증 필요 | 차감 선불 080 고객사 요금제 워커 문안 스팸 스팸필터 배포 spam-test-queue.ts app.ts ai.ts spam-filter.ts CT-09 | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-16 | 🔧 D79 — 인라인 함수 전수조사/제거 + 날짜 정규화 수정 + 필터 UI 동적화 + plan_code 수정 (2026-03-16) — 배포 대기 | 업로드 엑셀 대시보드 고객DB 요금제 세션 스팸 스팸필터 배포 모달 normalize.ts upload.ts customers.ts CustomerDBModal.tsx | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-17 | 🔧 D81 — 대시보드 카드 동적 필터링 + UI 개선 4건 (2026-03-17) — 배포 대기 (git lock 해결 후) | 회신번호 타겟발송 대시보드 고객사 빌드 배포 모달 AiSendTypeModal.tsx DirectTargetFilterModal.tsx Dashboard.tsx admin.ts | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-16 | ✅ D80 — AI 프리미엄 기능 3종 (자동조건완화 + 성과추천 + 문안자동생성) (2026-03-16) — 배포 완료 | 발신번호 회신번호 자동발송 세그먼트 요금제 게이팅 마이그레이션 문안 성과 스팸 migrations/ai-premium-features.sql services/ai.ts routes/ai.ts AiSendTypeModal.tsx | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-16 | ✅ D77 — 대시보드 DB현황 6분할 페이징 뷰 (2026-03-16) — 배포 완료 | 업로드 대시보드 슈퍼관리자 고객사 마이그레이션 배포 AdminDashboard.tsx admin.ts Dashboard.tsx dashboard-card-pool.ts | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-15 | ✅ D76 — AI 문안 요일 오류 수정 + 요금제 피처 업데이트 + 자동발송 회사별 오버라이드 (2026-03-15) — 배포 완료 | 카카오 자동발송 요금제 마이그레이션 문안 배포 ai.ts PricingPage.tsx auto-campaigns.ts packages/backend/src/services/ai.ts | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-14 | ✅ D75 — UI/UX 버그 4건 수정 + CT-08 개별회신번호 필터링 컨트롤타워 (2026-03-14) — 배포 완료 | 회신번호 리포트 배포 모달 AiCampaignResultPopup.tsx AiCampaignSendModal.tsx Dashboard.tsx callback-filter.ts CT-08 | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-14 | ✅ D74 — 컨트롤타워 동적화 + store_phone 정규화 수정 (2026-03-14) — 배포 완료 | 080 개인화 리포트 배포 customer-filter.ts/ai.ts normalize.ts standard-field-map.ts customer-filter.ts | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-14 | ✅ D73 — 무료체험 게이팅 + 수신거부 아키텍처 정비 + 커스텀 필드 라벨 CT-07 (2026-03-14) — 배포 완료 | 수신거부 직접발송 업로드 CSV 고객사 게이팅 무료체험 리포트 스팸 스팸필터 Dashboard.tsx upload.ts unsubscribes.ts sync.ts CT-07 CT-03 | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-12 | 🔧 D69 — 자동발송 기능 (2026-03-12) — Phase 1 배포 완료 + 모달 개선 진행 중 | 카카오 발신번호 직접발송 자동발송 개인화 변수 업로드 대시보드 슈퍼관리자 요금제 routes/auto-campaigns.ts utils/auto-campaign-worker.ts app.ts AutoSendPage.tsx | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-13 | ✅ D72 — 예약캠페인 관리 + 발송비용 계산 + storageType 동적필터 + 발송 성능개선 (2026-03-13) — 배포 완료 | 카카오 예약발송 직접발송 자동발송 발송결과 문안 스팸 스팸필터 배포 모달 campaigns.ts Dashboard.tsx ScheduledCampaignModal.tsx CalendarModal.tsx CT-04 | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-13 | 🔧 D71 — 시세이도 3만건 업로드 후속 수정 (2026-03-13) — ✅ 완료 (배포 완료) | 업로드 엑셀 슈퍼관리자 고객DB 배포 upload.ts standard-field-map.ts customers.ts defaults.ts | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-12 | 🔧 D70 — 직원 QA 버그 일괄수정 (2026-03-12) — 🔶 진행 중 (3차 배포 완료, 잔여 1건 B-D70-18) | 카카오 회신번호 직접발송 타겟발송 개인화 변수 치환 업로드 엑셀 대시보드 customers.ts CustomerDBModal.tsx upload.ts sms-templates.ts | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-12 | ✅ D68 — 대시보드 UI 수정 + AI 생일 타겟팅 + 테스트 비용 합산 + 커스텀 필드 라벨 (2026-03-12) — 배포 완료 | 직접발송 대시보드 고객DB 스팸 스팸필터 배포 통계 dashboard-card-pool.ts Dashboard.tsx customers.ts upload.ts | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-12 | 🔧 D67 — 080 콜백 진단 + 수신동의 변형 인식 + 사용자별 고객DB 삭제 (2026-03-12~) — ✅ 완료 (배포 완료) | 수신거부 080 업로드 슈퍼관리자 고객사 고객DB 로그인 빌드 배포 모달 packages/frontend/src/pages/Unsubscribes.tsx packages/backend/src/utils/normalize.ts packages/backend/src/routes/admin.ts packages/frontend/src/pages/AdminDashboard.tsx | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-09 | 🔧 D62 — 13차~15차 실동작 검증 버그 수정 (2026-03-09~03-10) — ✅ 15차 빌드+배포 완료 (2026-03-10 22:17), 실동작 검증 대기 | 환불 차감 수신거부 예약취소 직접발송 발송결과 개인화 세션 리포트 스팸 AiCampaignResultPopup.tsx AiPreviewModal.tsx campaigns.ts ai.ts | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-10 | 🔧 D63 — 16차 버그리포트 수정 + 메시징 컨트롤타워 리팩토링 (2026-03-10~) — 🟡 진행 중 | 환불 차감 선불 회신번호 수신거부 080 예약취소 직접발송 발송결과 개인화 utils/store-scope.ts customers.ts campaigns.ts ai.ts CT-01 CT-02 | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-11 | 🔧 D66 — 17차 실동작 검증 + PPT 버그리포트 수정 (2026-03-11~03-12) — ✅ 수정+배포 완료, 실동작 검증 대기 | 환불 차감 회신번호 수신거부 080 예약취소 예약발송 직접발송 발송결과 개인화 campaign-lifecycle.ts normalize.ts campaigns.ts customers.ts CT-01 CT-03 | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-11 | ✅ D65 — sync-results 결과동기화 Blocker 수정 (2026-03-11) — 완료, 배포 완료 | 환불 차감 회신번호 직접발송 발송결과 배포 campaign-lifecycle.ts utils/campaign-lifecycle.ts config/database.ts routes/results.ts | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-08 | ✅ D61 — 프론트엔드 난독화 적용 (2026-03-08) — 완료 | 난독화 빌드 배포 vite.config.ts | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-08 | ✅ D60 — SyncAgent API Key 관리 + 사용자별 라인그룹 배정 (2026-03-08) — 완료 | 라인그룹 슈퍼관리자 고객사 모달 admin.ts campaigns.ts AdminDashboard.tsx | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-07 | ✅ D59 — 2차 코드 전수점검 (2026-03-07) — 완료 | - | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-03-04 | 🔧 D53 — 요금제별 기능 게이팅 구현 (2026-03-04~) | 환불 차감 수신거부 직접발송 발송결과 업로드 대시보드 고객DB 요금제 게이팅 spam-filter.ts ai.ts upload.ts /customers.ts | [TASKS_2026-03.md](TASKS_2026-03.md) |
| 2026-04-30 | 🟢 D143 (2026-04-30) — ENTERPRISE 잠금 + 매뉴얼 + 자연인 오픈 + app.hanjul.ai 폐기 (배포 완료) | 알림톡 카카오 RCS 검수 템플릿 회신번호 자동발송 슈퍼관리자 세션 로그인 LoginPage.tsx auth.ts Dashboard.tsx | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-29 | 🟡 D142+ 알림톡 PDF 0428 (2026-04-29) — D135/D139 후속 7건 + IMC 이미지 이중 래핑 unwrap (수정 완료 · 배포 대기) | 알림톡 카카오 검수 업로드 사고 배포 모달 AlimtalkTemplateFormV2.tsx ItemListEditor.tsx AlimtalkManagementSection.tsx alimtalk-api.ts | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-28 | 🟡 D142 (2026-04-28) — 한줄로_20260428.pdf 11건 + 1년 반복 필드값 사고 패턴 구조적 종결 (수정 완료 · 배포 대기) | 카카오 080 직접발송 자동발송 타겟발송 개인화 변수 치환 엑셀 슈퍼관리자 backend/utils/standard-field-map.ts frontend/utils/formatDate.ts backend/utils/messageUtils.ts formatDate.ts | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-27 | 🟢 D141 (2026-04-27~28) — 한줄로_20260427.pdf 5건 근본수정 + 끌로드원칙 7-1 3차 재점검 (배포 완료 2026-04-28) | 카카오 회신번호 직접발송 자동발송 타겟발송 발송결과 변수 치환 업로드 고객DB upload.ts DirectSendPanel.tsx formatDate.ts AiCampaignResultPopup.tsx | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-25 | 🟣 D140 (2026-04-25) — 브랜드메시지 IMC 매뉴얼 16개 정합성 전수 점검 + Phase C 정제 헬퍼 일반화 | 브랜드메시지 빌드 배포 alimtalk-api.ts brand-message.ts BrandMessageEditor.tsx routes/alimtalk.ts | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-25 | 🟣 D139 (2026-04-25) — 알림톡 PDF 7건 후속 검수 피드백 (D135 후속) | 알림톡 카카오 검수 업로드 메모리 배포 routes/alimtalk.ts AlimtalkTemplateFormV2.tsx AlimtalkManagementSection.tsx ItemListEditor.tsx | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-24 | 🟣 D138 (2026-04-24~25 새벽) — 직접발송 파일등록+개별회신번호 "발송 실패" 근본 수정 | 회신번호 직접발송 엑셀 CSV 배포 모달 DirectSendPanel.tsx formatDate.ts Dashboard.tsx DirectPreviewModal.tsx | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-24 | 🟣 D137 (2026-04-24) — 한줄로_20260423.pdf 10건 전건 근본수정 + Sync Agent v1.5.2 빌드 완료 | 카카오 회신번호 수신거부 예약발송 직접발송 타겟발송 발송결과 업로드 대시보드 슈퍼관리자 messageUtils.ts formatDate.ts services/ai.ts DirectSendPanel.tsx CT-14 CT-07 | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-22 | 🟢 D136 P1 (2026-04-22 밤 연속 세션) — PDF 9건 전체 완료 + 전수점검 추가 수정 | 잔액 선불 알림톡 카카오 검수 템플릿 발신번호 회신번호 수신거부 예약발송 upload.ts/unsubscribe-helper.ts utils/enabled-fields.ts routes/customers.ts sync.ts CT-03 CT-18 | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-21 | 🚑 D131 (2026-04-21) — 싱크에이전트 실점검 이슈 3건 해결 + D130 이슈 일괄 정리 | 알림톡 검수 템플릿 자동발송 싱크에이전트 세션 문안 스팸 스팸필터 크래시 admin-sync.ts customer-upsert.ts upload.ts/sync.ts/customers.ts sync-agent/src/index.ts CT-16 | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-22 | 💎 D132 (2026-04-22) — CT-17 요금제 게이팅 + 30일 PRO 무료체험 + subscription_status 네이밍 정리 (✅ 배포+검증 완료) | 템플릿 수신거부 직접발송 자동발송 타겟발송 발송결과 모바일DM 대시보드 슈퍼관리자 고객사 utils/plan-guard.ts utils/trial-downgrade-worker.ts routes/ai.ts routes/auto-campaigns.ts CT-17 | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-22 | 🚛 D135 (2026-04-22) — 레거시 회신번호+수신거부 이관 + 전환 안내 팝업/랜딩 배포 (✅ 완료) | 회신번호 수신거부 예약발송 CSV 세션 난독화 메모리 배포 | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-22 | 🔄 D134 (2026-04-22 밤늦게) — 레거시 ID 일괄 이관 (62 회사 + 141 사용자) + 후속 UI 수정 (✅ 완료) | 회신번호 슈퍼관리자 고객사 페이지네이션 세션 배포 legacy_migration.sql AdminDashboard.tsx | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-22 | 📊 D133 (2026-04-22 밤) — 대시보드 카드 상세 개선 + 고객 DB 다운로드 (Phase A+B 통합 — ✅ 배포+실화면 검증 완료) | 엑셀 대시보드 고객DB 페이지네이션 세션 배포 모달 routes/companies.ts routes/customers.ts components/dashboard/DeltaBadge.tsx Dashboard.tsx CT-01 CT-02 | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-21 | 🔥 D131 (2026-04-21 저녁) — Agent v1.5.1 + 알림톡 IMC 6005 + 담당자테스트 9007 + PPT 9건 일괄 처리 | 알림톡 검수 템플릿 예약취소 자동발송 싱크에이전트 엑셀 세션 메모리 스팸 sync-agent/src/normalize/index.ts utils/normalize.ts field-map.ts utils/mms-validator.ts | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-18 | 🔗 Sync Agent v1.5.0 — ✅ Day 1~3 전구간 구현 + 배포 완료 (2026-04-18) | 수신거부 싱크에이전트 업로드 고객사 세션 마이그레이션 빌드 배포 utils/ai-mapping.ts routes/sync.ts auth.ts middlewares/sync-active-check.ts | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-21 | 📨 D130 — 알림톡/브랜드메시지 IMC 연동 Phase 1 — 🔄 2026-04-21 화요일 실점검 + 전수감사 진행 중 | 후불 알림톡 브랜드메시지 카카오 RCS 발신프로필 검수 템플릿 발신번호 수신거부 utils/alimtalk-api.ts utils/alimtalk-result-map.ts utils/alimtalk-webhook-handler.ts utils/alimtalk-jobs.ts CT-16 CT-17 | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-17 | 🎨 D126 V2 + D127 V3 + D128 V4 — DM 빌더 고도화 (2026-04-17) — ✅ 전 구간 완료, 배포 대기 | 검수 세그먼트 세션 메모리 배포 모달 dm-viewer.ts | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-17 | 🎨 D125 — 모바일 DM 빌더 프로모델 v1 구현 (2026-04-17) — ✅ **전 구간 완료** | 검수 템플릿 변수 메모리 배포 디자인 | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-16 | 🔧 D124 — 0416 직원 검수 5건 + 필드명 통일 + 무료수신거부 빈줄 (2026-04-16) — 🟡 수정완료-배포완료 | 카카오 검수 템플릿 회신번호 수신거부 직접발송 타겟발송 발송결과 개인화 변수 TargetSendModal.tsx utils/textInsert.ts mms-image-util.ts mmsImage.ts | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-16 | 🔧 D123 — 0415 직원 검수 12건 전수 수정 + 레거시 인프라 복구 + 영업총판 제안서 (2026-04-16) — ✅ 배포완료 | 알림톡 카카오 검수 템플릿 회신번호 수신거부 080 직접발송 자동발송 타겟발송 setenv.sh admin.ts services/ai.ts AutoSendPage.tsx CT-08 | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-15 | 🔧 D122 — 전단AI 대규모 업데이트 + 한줄로 카카오추천 제거 (2026-04-15) — ✅ 배포완료 | 카카오 업로드 엑셀 슈퍼관리자 로그인 배포 통계 PrintFlyerPage.tsx flyer-print-renderer.ts flyer-carts.ts flyer-orders.ts | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-14 | 🔧 D121 — KISA subject(광고) 전경로 + AI 문안 4차/5차 강화 + 빈필드 제외 (2026-04-14~15) — ✅ 배포완료 | 개인화 변수 치환 문안 스팸 스팸필터 사고 배포 모달 messageUtils.ts formatDate.ts campaigns.ts auto-campaign-worker.ts | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-14 | 🔧 D120 — UI 통일 + 캘린더 이동 + 080 버그 + 전단AI user_id 격리 (2026-04-14) — ✅ 배포완료 | 수신거부 080 예약취소 자동발송 발송결과 개인화 변수 문안 캘린더 스팸 flyers.ts campaigns.ts/results.ts AiPreviewModal.tsx DashboardHeader.tsx | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-13 | 🔧 D119 — 0413 직원검수 7건 + 전단AI 흰화면 + 모바일DM 빌더 신규 (2026-04-13) — ✅ 배포완료 | 검수 발신번호 회신번호 080 직접발송 자동발송 모바일DM 개인화 업로드 고객DB format-number.ts target-sample.ts ai.ts App.tsx | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-12 | 🔧 D114 — 0410 PDF 버그 10건 + 신규 기능 1건 (2026-04-12) — ✅ 배포완료 | 검수 수신거부 직접발송 자동발송 발송통계 변수 치환 업로드 엑셀 CSV companies.ts admin.ts customers.ts upload-mapping-validator.ts | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-09 | 🔧 D111 — 0408 검수 9건 + 오픈 전 결정사항 2건 (2026-04-09) — ✅ 배포완료 | 검수 080 직접발송 자동발송 타겟발송 치환 업로드 워커 세션 로그인 utils/session-manager.ts utils/campaign-validation.ts utils/format-number.ts formatDate.ts CT-07 | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-08 | 🔧 D110 — 캠페인 결과조회 버그 + CT-04 전면 UNION ALL 최적화 (2026-04-08) — ✅ 코드수정완료, 배포완료 | 카카오 직접발송 발송통계 라인그룹 대시보드 슈퍼관리자 고객사 메모리 배포 모달 admin.ts packages/backend/src/routes/admin.ts results.ts sms-queue.ts CT-04 | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-07 | 🔧 D109 — 0406+0407 PDF 버그 + 검수리스트 일괄 처리 (2026-04-07) — ✅ 배포완료 | 검수 수신거부 080 직접발송 자동발송 타겟발송 발송결과 발송통계 개인화 변수 unsubscribe-helper.ts formatDate.ts standard-field-map.ts utils/target-sample.ts CT-03 | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-04 | 🔧 D108 — AI 분석 시각화 고도화 + BUSINESS 자동화 연계 + 예시 PDF (2026-04-04) — ✅ 배포완료 | 수신거부 대시보드 요금제 리포트 배포 AnalysisCharts.tsx analysis.ts AnalysisModal.tsx Dashboard.tsx | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-04 | 🔧 D107 — AI 발송 템플릿 + DB 현황 디자인 리뉴얼 + 메시지 셀 컨트롤타워 (2026-04-04) — ✅ 배포완료 | 템플릿 세그먼트 요금제 마이그레이션 배포 모달 디자인 saved-segments.ts ResultsModal.tsx utils/saved-segments.ts routes/saved-segments.ts | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-02 | 🔧 D103 — (광고) 중복 수정 + 발송 경로 컨트롤타워 전면 통합 + 개별회신번호 동적 필터링 (2026-04-02) — ✅ 배포완료 | 회신번호 수신거부 080 변수 치환 업로드 성과 배포 messageUtils.ts sms-queue.ts callback-filter.ts formatDate.ts | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-02 | 🔧 D104 — 0402 PPT 버그리포트 10건 (타임존 컨트롤타워화 + 숫자필터 + YYMMDD + cooldown) (2026-04-02) — ✅ 배포완료 | 정산 자동발송 타겟발송 발송결과 발송통계 타임존 세션 리포트 스팸 스팸필터 stats-aggregation.ts admin.ts manage-stats.ts results.ts | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-04 | 🔧 D106 — 0403 버그리포트 8건 + 컨트롤타워 전수점검 강제 프로세스 (2026-04-04) — ✅ 배포완료 | 회신번호 080 직접발송 자동발송 발송결과 발송통계 미발송 개인화 변수 치환 stats-aggregation.ts manage-stats.ts sms-queue.ts results.ts | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-02 | 🔧 D105 — 자동발송 4단계 라이프사이클 개선 (P7~P10) (2026-04-02) — ✅ 배포완료 | 수신거부 자동발송 개인화 워커 마이그레이션 문안 스팸 스팸필터 배포 auto-campaign-worker.ts AutoSendFormModal.tsx CT-01 CT-03 | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-04-01 | 🔧 D102 — 0401 PPT 버그리포트 15건 + 맞춤한줄 회신번호 + 중복제거/수신거부 (2026-04-01) — ✅ 배포완료 | 회신번호 수신거부 080 직접발송 자동발송 미발송 개인화 치환 워커 성과 messageUtils.ts formatDate.ts | [TASKS_2026-04.md](TASKS_2026-04.md) |
| 2026-05-31 | 🗄️ D227+ 2026-05-31 — AI Operator 5개 배포 완료 + 요금제 종량제(AI 크레딧) 설계도 | 환불 차감 크레딧 치환 슈퍼관리자 요금제 종량제 세션 학습 성과 operator-performance-estimator.ts grade-conversion-stats.ts performance-insight.ts continuous-operator.ts | [TASKS_2026-05.md](TASKS_2026-05.md) |
| (무날짜·2026-05) | 🗄️ 옛 D227+ 세션 (성과추정 재설계 이전) — 장바구니 리커버리 + 본문 0 bytes 정정 + 3원칙 | 세션 성과 SDK 사고 배포 utils/ai-json.ts ai.ts utils/operator-performance-estimator.ts services/ai.ts | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-31 | 🚀 2026-05-31 세션 종결 — 발송결과 모달 재설계 + SDK v0.3.5-b + SDK 듀얼 플랫폼 토대(카페24·고도몰) | 알림톡 검수 예약취소 발송결과 세션 SDK 빌드 배포 모달 CampaignDetailModal.tsx results.ts formatDate.ts ResultsModal.tsx | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-29 | 🚀 D226~D227+ 세션 종결 (2026-05-29) — SDK v0.3.5-a 코드 + 운영 긴급 fix 4건 + DB 컬럼 다운 3중 안전망 | 발송결과 고객사 페이지네이션 세션 SDK 사고 배포 post-deploy-smoke.sh | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-28 | 🚀 D225+ 세션 전체 종결 (2026-05-28) — Brand Voice Learning + 알림톡 fix + Email 이력 + UI 정정 + SDK v0.3.5 설계도 + 비토 정체성 강화 | 알림톡 페이지네이션 세션 학습 메모리 문안 SDK 사고 routes/campaigns.ts routes/results.ts CT-99 CT-100 | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-27 | 🚀 D224+ 세션 전체 종결 매트릭스 (2026-05-27) — 9 작업 모두 완료 | 알림톡 직접발송 자동발송 업로드 세션 메모리 사고 배포 acme.sh dashboard.ts campaigns.ts services/ai.ts | [TASKS_2026-05.md](TASKS_2026-05.md) |
| (무날짜·2026-05) | 🚀 옛 D222+ 다음 세션 진입 가이드 (D222+ 전체 종결 후 — **배포 + 스크린샷 + CHAPTER 10 신설**) | 템플릿 수신거부 직접발송 발송결과 여정 인앱 세그먼트 변수 업로드 엑셀 dashboard.ts | [TASKS_2026-05.md](TASKS_2026-05.md) |
| (무날짜·2026-05) | 🚀 옛 D222+ Phase 5 진입 가이드 (D222+ Phase 4 종결 후 — 참조용) | 직접발송 발송결과 세션 보안 | [TASKS_2026-05.md](TASKS_2026-05.md) |
| (무날짜·2026-05) | 🚀 옛 D222+ Phase 4 진입 가이드 (D222+ Phase 3 종결 후 — 참조용) | 직접발송 발송결과 세션 | [TASKS_2026-05.md](TASKS_2026-05.md) |
| (무날짜·2026-05) | 🚀 옛 D222+ Phase 3 진입 가이드 (D222+ Phase 2 종결 후 — 참조용) | 직접발송 발송결과 세션 배포 | [TASKS_2026-05.md](TASKS_2026-05.md) |
| (무날짜·2026-05) | 🚀 옛 D222+ Phase 2 진입 가이드 (D222+ Phase 1 종결 후 — 참조용) | 직접발송 발송결과 세션 배포 dashboard.ts | [TASKS_2026-05.md](TASKS_2026-05.md) |
| (무날짜·2026-05) | 🚀 옛 D222+ Phase 1 진입 가이드 (D220+ + D221+ 종결 후 — 참조용) | 직접발송 발송결과 변수 세션 CDP 배포 모달 디자인 | [TASKS_2026-05.md](TASKS_2026-05.md) |
| (무날짜·2026-05) | 🚀 옛 D220+ 진입 가이드 (D219+ Part 2 + 후속 통합 종결 후 — 참조용) | 무료체험 세션 모달 | [TASKS_2026-05.md](TASKS_2026-05.md) |
| (무날짜·2026-05) | 🚀 옛 D219+ 진입 가이드 (D218+ Phase 1~3 부분 종결 후 — 참조용) | 여정 세션 학습 메모리 스팸 스팸필터 사고 배포 app.ts journey-pretest-validator.ts journey-pretest-notifier.ts journey-pause-handler.ts CT-92 CT-93 | [TASKS_2026-05.md](TASKS_2026-05.md) |
| (무날짜·2026-05) | 🚀 옛 D218+ 진입 가이드 (D217+ AI Operator 10 메뉴 강화 종결 후 — **참조용**) | 알림톡 카카오 검수 여정 모바일DM 인앱 페이지네이션 세션 예측 학습 routes/ai-memory.ts routes/ai-usage.ts utils/kakao-template-sync.ts utils/kakao-template-sync-worker.ts CT-86 CT-87 | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-25 | 🚀 옛 D215+ 진입 가이드 (참조용 — 종결 완료 2026-05-25) | 여정 인앱 세션 메모리 성과 리포트 SDK 자사몰 사고 디자인 customer-upsert.ts CT-77 CT-65 | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-23 | 🚀 옛 D213+ 진입 가이드 (참조용 — 종결 완료 2026-05-23) | 알림톡 여정 인앱 변수 요금제 세션 예측 LTV 학습 메모리 constants/ai-operator-modules.ts ai.ts CT-64 CT-59 | [TASKS_2026-05.md](TASKS_2026-05.md) |
| (무날짜·2026-05) | 🚀 옛 진입 가이드 (D197~D208 통합 종결 후 — 참조용) | 대시보드 세션 예측 이탈 사고 배포 ai.ts predictive-suite.ts predictive-worker.ts connected-content.ts CT-53 CT-55 | [TASKS_2026-05.md](TASKS_2026-05.md) |
| (무날짜·2026-05) | 🚀 옛 진입 가이드 (D190 Phase A 통합 종결 후 — 참조용) | 알림톡 검수 템플릿 여정 변수 슈퍼관리자 세션 예측 이탈 학습 utils/short-url.ts utils/korean-ecommerce-domains.ts routes/short-url.ts journey-executor.ts CT-49 CT-48 | [TASKS_2026-05.md](TASKS_2026-05.md) |
| (무날짜·2026-05) | 🚀 옛 진입 가이드 (D189 통합 종결 후 — 참조용) | 환불 알림톡 발신프로필 템플릿 회신번호 직접발송 자동발송 타겟발송 여정 이메일 push.ts packages/frontend/src/components/journey/JourneyVariantsEditor.tsx packages/frontend/src/components/journey/JourneyMmsUploader.tsx packages/sdk-js/src/journey-variants.ts CT-41 CT-42 | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-15 | 🔥 D162-4 (2026-05-15 ~ 2026-05-19, 진행 중) — 알림톡 발송 모달 전면 재구성 + 잔존 검증 | 알림톡 카카오 검수 타겟발송 변수 치환 세션 메모리 사고 배포 AlimtalkSendModal.tsx routes/companies.ts | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-19 | 🚀 D162-5 → D170+ (2026-05-19) — Braze급 SaaS Step 0 (D163~D170) 완료 + 배포 | 여정 인앱 변수 게이팅 세션 보안 LTV 학습 메모리 성과 services/ai-orchestrator.ts routes/cdp.ts app.ts utils/cafe24-client.ts CT-23 CT-24 | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-19 | 🚀 D162-5 원본 kickoff (2026-05-19) — 참조용 | 타겟발송 여정 게이팅 무료체험 세션 메모리 성과 리포트 배포 모달 services/ai.ts | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-08 | 🟢 D150 (2026-05-08~11) — 알림톡+카카오 전체 마무리 (코드 작업 종결, 월요일 자연 검증만 잔여) | 알림톡 브랜드메시지 카카오 발신프로필 검수 템플릿 업로드 세션 메모리 배포 brand-message.ts | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-08 | 🟢 D149-#B 진짜 root cause 100% 검증 (2026-05-08 저녁) — D135~ 4주 알림톡 디버깅 진짜 종결 | 알림톡 검수 사고 alimtalk-api.ts | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-08 | 🟢 D147+D148+D149 (2026-05-08 오후) — 알림톡 PDF 0508 누적 4건 root cause fix 종결 (D135~ 마감) | 알림톡 검수 세션 메모리 사고 배포 alimtalk.ts alimtalk-api.ts | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-08 | 🟢 D147 (2026-05-08 오후) — 알림톡 PDF 0508 root cause fix + atomic safe-build (고객사 사용 중 차단 0초) | 알림톡 검수 고객사 메모리 사고 빌드 배포 alimtalk.ts scripts/safe-build.sh | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-07 | 🟢 D146 (2026-05-07 밤) — 알림톡 PDF 0506 7건 마감 + emphasize 정합화 + atomic build 메모리 | 알림톡 업로드 메모리 빌드 FormV2.tsx companies.ts alimtalk.ts packages/backend/src/routes/alimtalk.ts | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-07 | 🟢 D145 (2026-05-07) — 9시간 사고 복구 + PDF 0506 13건 배포 + 영구 재발 방지 인프라 적용 | 환불 차감 알림톡 카카오 발신번호 직접발송 슈퍼관리자 고객DB 세션 백업 /scripts/safe-build.sh scripts/monitor-dist.sh routes/internal-alert.ts prepaid.ts | [TASKS_2026-05.md](TASKS_2026-05.md) |
| (무날짜·2026-05) | 🟡 D144/D145 배포완료 작업 보존 (참고) | 환불 발신번호 직접발송 발송통계 슈퍼관리자 고객사 고객DB 세션 메모리 사고 admin.ts sms-result-map.ts campaign-lifecycle.ts messageUtils.ts | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-06 | 🔥 D144 후속2 (2026-05-06 17:00 작성, 5/7 새벽 D145로 흡수) — **참고 보존** | 환불 정산 발신번호 직접발송 자동발송 발송결과 발송통계 라인그룹 슈퍼관리자 고객사 packages/backend/src/utils/stats-aggregation.ts packages/backend/src/routes/admin.ts packages/backend/src/routes/campaigns.ts packages/backend/src/routes/results.ts | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-05 | 🟢 D143 D-Day (2026-05-05) — 레거시 이관 100% 완료 · 5/6 발송 모니터링만 잔여 | 잔액 선불 회신번호 수신거부 예약발송 세션 | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-05-06 | ✅ D144 (2026-05-06) — SMSQ_SEND 정체 확정 종결 | 잔액 회신번호 직접발송 발송통계 라인그룹 CSV 슈퍼관리자 고객사 세션 리포트 | [TASKS_2026-05.md](TASKS_2026-05.md) |
| 2026-06-25 | 🟢 2026-06-25 (세션2) — CDP 갭보강 A~E + 모바일DM 아트디렉션 P1 + CustomerDataGate 디버깅3 (★전부 배포완료) | 모바일DM 세션 CDP 배포 | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-30 | 🟢 2026-06-30 (이어서3) — 알림톡 흰글씨 fix + 싱크에이전트 페이지네이션 전면 견고화 + 자동마케팅 중복 정정 + 비-문자 개인화 설계서 | 과금 알림톡 카카오 싱크에이전트 여정 자동마케팅 모바일DM 이메일 인앱 개인화 AlimtalkChannelPanel.tsx customer-upsert.ts operator-proposal-dedup.ts CT-97 CT-01 | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-30 | 🟢 2026-06-30 (이어서2) — 여정 일반화 전체 구현 + 빌더 정정 + AI Operator fallback 근본 정정 (★전부 배포완료) | 크레딧 알림톡 템플릿 수신거부 여정 개인화 문안 브랜드보이스 RAG 배포 ai-json.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-30 | 🟢 2026-06-30 (이어서) — 문안 퀄리티/브랜드보이스 강화 + AI Operator 정정 + 발송현황 카드 (★배포완료) + 여정 일반화 설계서 | 차감 크레딧 알림톡 템플릿 여정 대시보드 문안 브랜드보이스 배포 통계 brand-voice-prompt.ts customers.ts Dashboard.tsx | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-30 | 🟢 2026-06-30 — 크레딧 모델 v2 (코드완료·검증) + 메인 대시보드 카드 + 문안 퀄리티/브랜드보이스 설계서 | 차감 크레딧 과금 여정 이메일 인앱 대시보드 슈퍼관리자 요금제 세션 brand-voice-prompt.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-29 | 🟢 2026-06-29 — 여정 자동화 재설계 + 오늘의 여정 기회(분석 엔진) + 대화형 수정 + AI Operator 소개 PPT 뷰어 + 제안화면 강화 (★배포완료) | 알림톡 080 여정 세그먼트 변수 치환 세션 예측 LTV 성과 JourneysPage.tsx journey-opportunities.ts journey-ai-editor.ts operator-message-decorator.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-28 | 🟢 2026-06-28(이어서2) — 이메일 마케팅 마무리 + Phase 2-A 분석 대시보드 + 후속 UX (★배포완료) | 차감 크레딧 템플릿 이메일 세그먼트 변수 대시보드 세션 마이그레이션 메모리 | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-28 | 🟢 2026-06-28(이어서) — 인앱 진입 재설계 + 이메일 브레이즈급 Phase 1 + AiMemory 모달화 + 버그 2건 (★배포완료) | 템플릿 이메일 인앱 세그먼트 개인화 변수 대시보드 세션 배포 모달 App.tsx | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-28 | 🟢 2026-06-28 — 문안 두뇌(7천건 RAG) 배포완료 + AI 학습/브랜드보이스 화면 밀도 개선 + 다음 설계서 2건 | 이메일 인앱 세션 학습 메모리 문안 브랜드보이스 RAG 성과 배포 | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-27 | 🟢 2026-06-27 — 인앱 메시지 렌더 격상(블록+테마+모션) + 인앱 콘솔 슬레이트 리디자인 + 제안서 보강 (★코드 배포완료 / PPT는 산출물 전달) | 크레딧 템플릿 인앱 변수 업로드 요금제 SDK 빌드 배포 모달 inapp-theme.ts inapp-blocks.ts inapp.ts inapp-blocks.test.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-26 | 🟢 2026-06-26 — 자동마케팅 Phase 1~3 + 운영 디버깅 + 고객사 관리자 페이지 모던 리디자인 (★전부 배포완료) | 환불 발신번호 080 발송통계 여정 자동마케팅 모바일DM 업로드 슈퍼관리자 고객사 dm-art-direction.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-25 | 🟢 2026-06-25 — 운영 디버깅 5건 + CDP(자사몰 연동) 심층감사 → 보강 설계서 (★디버깅 배포완료 / CDP 구현완료) | 환불 차감 선불 수신거부 싱크에이전트 여정 모바일DM 이메일 인앱 변수 dm.ts qtmsg-type.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-22 | 🟡 2026-06-22 — 싱크에이전트 2008R2+Oracle 대응 + 위저드 전수조사 (★코드·빌드 완료 / 미배포) | 싱크에이전트 여정 엑셀 CSV 페이지네이션 마이그레이션 빌드 배포 agent-build-tiers.ts ai.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-21 | 🟢 2026-06-21 — AI Operator P1 + 모바일DM 퀄리티 Phase 1+3 (★배포완료 2026-06-21) | 환불 차감 과금 알림톡 카카오 모바일DM 업로드 배포 디자인 ai-orchestrator.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-18 | 🟢 2026-06-18 — 인앱 메시지 전면 개선 (디자인·카피·편집3탭·이미지·도메인 ★배포완료 / 모달 표시 1건 미해결) | 인앱 세션 SDK 자사몰 배포 모달 디자인 | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-18 | 🟢 2026-06-18 — 자체 자사몰 + 앱 데이터 수집 고도화 (Track A·B·C ★배포완료 2026-06-18) | 인앱 고객사 SDK 자사몰 빌드 배포 모달 auto-capture/ecommerce.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-17 | 🟢 2026-06-17~18 — SDK 강화: 자사몰 BYO 자격 연동 (카페24·네이버 BYO 폼 + 고도몰 커넥터, ★배포완료 2026-06-18) | SDK 자사몰 배포 모달 provider-credentials.ts provider-oauth-url.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-17 | 🟢 2026-06-17 — 인앱 메시지 웹/앱 채널 분리 1·2단계 (★배포완료) | 인앱 SDK 자사몰 빌드 배포 모달 통계 inapp.ts auto-capture/index.ts .test.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-17 | 🟢 2026-06-17 — 발신프로필 080 필드 교체 (상태/브랜드메시지/등록일) (★배포완료) | 알림톡 브랜드메시지 카카오 발신프로필 080 대체발송 슈퍼관리자 고객사 배포 | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-17 | 🟢 2026-06-17 — 직원 디버깅 2건(전송 대기 미처리·전송≠통계) + 시세이도 미발송 근본 (★배포완료) | 회신번호 미발송 엑셀 CSV 슈퍼관리자 리포트 게이트웨이 중계 배포 통계 admin.ts results.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-16 | 🟢 2026-06-16 — 싱크에이전트 OS별 빌드 5티어 + 슈퍼관리자 배포 위저드 + 다운로드 엔드포인트 + 매뉴얼 갱신 (★배포완료) | 싱크에이전트 업로드 슈퍼관리자 빌드 배포 components/admin/AgentDeployWizard.tsx utils/agent-build-tiers.ts admin-sync.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-16 | 🟢 2026-06-16 — 비토(Bito) 자체 게이트웨이 연동(Agent 설치·라인 bito) + 아난티 시연 DB (★배포완료) | 알림톡 변수 고객사 고객DB 세션 게이트웨이 배포 install.sh sms-queue.ts AdminDashboard.tsx | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-15 | 🟢 2026-06-15(이어서) — 발송/싱크/알림톡 5건 전건 수정·배포·확인 + 빌드 멈춤 fix + 슈퍼관리자 상세 엑셀 (★배포완료, 버그4 2026-06-16 해결) | 알림톡 템플릿 대체발송 7300 변수 엑셀 CSV 슈퍼관리자 난독화 메모리 results.ts sms-table-split.ts kakao-template-sync.ts vite.config.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-15 | 🟢 2026-06-15 — 캠페인관리·싱크 레거시빌드·Bito 게이트웨이 연동 + 발송/싱크/알림톡 5건 버그(다음세션 일괄수정) | 알림톡 템플릿 7300 세션 리포트 게이트웨이 빌드 배포 통계 formatDate.ts admin.ts sms-queue.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-14 | 🟢 2026-06-14 — 모바일 DM 전면 재설계 (B~G 엔진/editor + 캔버스 편집 UX 보강) — ★Harold 배포 완료. ★세션2 완료(배포 대기) = ⑥ AI 슬라이드 자동생성(신규 dm-page | 차감 크레딧 직접발송 자동발송 변수 업로드 엑셀 세션 문안 배포 | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-13 | 🟢 2026-06-13(이번 세션) — 인비토AI 학습 데이터 + 모바일 DM 재설계 설계 (배포완료) | 이메일 세션 학습 문안 자사몰 스팸 빌드 배포 | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-13 | 🟢 2026-06-13(밤) — AI 학습 메모리 "제대로 학습엔진" A~G (배포완료) + 인비토AI 파인튜닝 데이터 파이프라인 보강·ceo 학습 페이지 (배포완료) | 알림톡 여정 이메일 변수 슈퍼관리자 워커 세션 학습 메모리 RAG utils/ai-memory-text.ts ai-memory-customer-insight.ts brand-tone-evolution.ts campaigns.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-13 | 🟡 2026-06-13(저녁) — Email 캠페인 AI 강화 + DM 빌더 목록 강화·시나리오 썸네일 (코드 완료·배포 대기) + AI 학습 메모리 설계서 (★다음 세션 구현) | 차감 수신거부 여정 고객DB 세션 학습 메모리 성과 배포 utils/email-tracking.ts utils/email-send-sweeper.ts utils/email-ai.ts constants/credit.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-13 | 🟢 2026-06-13 — 직원 디버깅 5건 전건 원인 확정 + 일괄 수정 (배포 완료 2026-06-13) | 환불 선불 알림톡 카카오 검수 템플릿 발신번호 수신거부 발송결과 발송통계 system-alert.ts system-monitor-worker.ts sync.ts results.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-11 | 🟢 2026-06-11(밤) — 디버깅 배치 5건+건6 전건 원인 확정·근본 코드 완료 (배포 완료 — 2026-06-13 세션에서 확인) | 환불 차감 정산 청구 직접발송 자동발송 워커 세션 배포 | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-11 | 🔴 2026-06-11(오후) — ★다음 세션 = 디버깅 5건 일괄 작업★ + 싱크에이전트 v1.5.5 + 무료체험 6/30 마감·배너 (전부 배포 완료) | 환불 차감 청구 검수 자동발송 싱크에이전트 대시보드 무료체험 워커 세션 utils/basic-trial.ts OpenTrialPopup.tsx | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-11 | 🔴 2026-06-11 — 에이치피오 예약취소 87,014건 실발송 사고 (손해 250만원) — 근본수정 5겹+감사로그 푸시 완료 | 정산 080 예약취소 라인그룹 게이팅 워커 문안 사고 빌드 utils/audit-log.ts billing.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-11 | 🟢 2026-06-11 — 인앱메시지 SDK 배선 T0~T6 구현 완료(배포완료) + 고도몰 SDK 가이드 3차 보강(완성코드판) | 크레딧 이메일 인앱 변수 세션 로그인 SDK 빌드 배포 cart-estimate.ts sync.ts CT-79 | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-09 | 🟢 2026-06-09 — 발송통계 성공→실패 오분류 + 미도래 예약 대기집계 정정 (코드 완료·배포완료 / 데이터 65건 정정 완료, P1 돈/정산) | 정산 후불 예약발송 발송결과 발송통계 워커 사고 배포 통계 prepaid.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-09 | 🟢 2026-06-09 — CDP 페이지 전면 모달화 Task1~9 완료 (배포완료, frontend-only) | 게이팅 CDP SDK 자사몰 빌드 배포 모달 CdpSettingsPage.tsx cdp.ts cdp-auth.ts cafe24.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-08 | 🟢 2026-06-08 — 발송일시 송출일 기준 통일(배포) + 풀분석 프리미엄 보고서 Plan1+2·레이아웃 완료·Plan3 설계(배포완료) | 차감 크레딧 예약발송 직접발송 발송결과 발송통계 세그먼트 슈퍼관리자 세션 예측 admin.ts results.ts ai.ts rfm-segment.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-08 | 🟢 2026-06-08 — 성과 리포트 전면 재설계 + 세그먼트 메뉴 이동 + BASIC 무료체험 시스템 (전부 배포) | 세그먼트 업로드 슈퍼관리자 고객DB 요금제 무료체험 성과 리포트 CDP 배포 ai.ts basic-trial.ts customers.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-08 | 🟢 2026-06-08 — 발송버그1 마무리 + 체험크레딧 정리 + AI게이팅 스타터화 + AI Operator 소개 메뉴 + 로그인 팝업 교체 (전부 배포) | 크레딧 알림톡 카카오 여정 변수 치환 요금제 게이팅 워커 세션 utils/alimtalk-emphasize.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-07 | 🟢 2026-06-07 — 발송 버그 3건 수정 (버그2·3 완료 / 버그1 부분 · 전부 배포완료) | 정산 알림톡 직접발송 대체발송 여정 변수 치환 세션 예측 리포트 | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-07 | 🟢 2026-06-07 — 재검증(이상0) + C게이트 토글 + 크레딧 보강 + 자율예측 재설계 완료(배포완료) | 차감 크레딧 정산 알림톡 여정 자동마케팅 세그먼트 슈퍼관리자 예측 LTV admin.ts predictive-segments-core.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-06 | 🟢 2026-06-06 — 자동마케팅 점검+정정 & 여정 엔진 재점검+정정 (전부 배포) | 차감 080 미발송 여정 자동마케팅 세션 배포 통계 | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-05 | 🟢 2026-06-05 세션8 — 자동마케팅 자율 발송 구현 완성 (배포 완료) | 차감 크레딧 잔액 수신거부 080 직접발송 자동마케팅 게이팅 세션 문안 | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-05 | 🟢 2026-06-05 세션7 — 여정 결함 11건 fix(배포) + 자동마케팅 점검 + 자율발송 설계 | 차감 크레딧 직접발송 자동발송 여정 자동마케팅 워커 세션 문안 스팸 services/ai.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-05 | 🟢 2026-06-05 세션6 — 발송결과 markFinalized 완전집계 + 알림톡 변수매칭 필드 노출 | 환불 차감 정산 후불 알림톡 발송결과 여정 변수 엑셀 고객사 billing.ts campaign-sync-worker.ts address-books.ts AlimtalkSendModal.tsx | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-05 | 🟢 2026-06-05 세션5 — 직원 디버깅 3건 + 발송통계 캐시·라인그룹 | 환불 알림톡 발송결과 발송통계 라인그룹 대체발송 여정 엑셀 CSV 세션 results.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-05 | 🟢 2026-06-05 세션4 — 여정 엔진 Phase 9 완료 (배포완료) | 알림톡 여정 세션 마이그레이션 예측 빌드 배포 journey-simulator-core.ts journey-step-format.ts journey-options-validator.ts JourneyOptionsEditor.tsx | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-04 | 🟢 2026-06-04 세션3 — 여정 엔진 Phase 7·6A·6B·8 완료·배포 (Phase 9만 남음) | 크레딧 여정 세션 마이그레이션 스팸 배포 journey-condition.ts send-time-util.ts journey-pretest-scan.ts journey-points-trigger.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-04 | 🟢 2026-06-04 세션2 — 여정 엔진 재설계 Phase 1~5 완료·배포 (6~9 다음 세션) | 차감 직접발송 여정 세션 마이그레이션 스팸 배포 utils/journey-safety-filter.ts journey-entry-ledger.ts journey-step-campaign.ts docs/superpowers/plans/2026-06-04-journey-redesign.sql | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-04 | 🔴 2026-06-04 세션 — 톤28 504 실증 완료 + 여정 엔진 전면 재설계 필요(결함 9개) | 환불 후불 수신거부 여정 업로드 세션 스팸 스팸필터 통계 | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-03 | 🟡 2026-06-03 세션 (미완) — 크레딧 UI 강화 + 여정 503 디버깅 | 차감 크레딧 직접발송 여정 인앱 세션 마이그레이션 배포 모달 app.ts Toast.tsx | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-03 | 🟢 2026-06-03 세션 — 알림톡 변수검증 강화 + 부달 B 재추가 + 자동마케팅 크레딧 재배치 + 이폴리움 연동 문서화 | 크레딧 알림톡 템플릿 자동마케팅 변수 세션 SDK 스팸 배포 | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-02 | 🟢 2026-06-02 세션 — 여정 미리보기 타겟 연동 + 크레딧 재매핑 작업1 + 작업2~5 핸드오프 | 차감 크레딧 여정 치환 세션 예측 LTV 문안 성과 리포트 utils/journey-target-extractor.ts credit.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-01 | 🟢 2026-06-01 세션 — AI 크레딧 가치 기반 전면 재설계 + 모델 핵심 고급 + 설정 페이지 재개편 | 차감 크레딧 여정 자동마케팅 모바일DM 인앱 대시보드 요금제 세션 문안 constants/credit.ts Settings.tsx | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-01 | 🟢 2026-06-01 세션 — 크레딧 점검 #1/#2/#3 + 요금제 UI 재구성 | 차감 크레딧 청구 수신거부 직접발송 세그먼트 요금제 무료체험 종량제 세션 ai.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-01 | 🟢 2026-06-01 세션 — 크레딧 UI 폴리시 + 충전/이력 완성 + 알림톡 디버깅 4건 설계도 | 차감 크레딧 정산 잔액 선불 후불 알림톡 템플릿 대체발송 이메일 constants/credit.ts utils/ai-credit-recharge.ts ai-credit-calc.ts billing.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-01 | 🚀 D229+ 2026-06-01 세션 종결 — 종량제 Phase 3 + Phase 4/5 (크레딧 가시성·관리) 구현·배포 | 크레딧 후불 대시보드 슈퍼관리자 고객사 요금제 종량제 세션 난독화 CDP cdp-auth.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-06-01 | 🚀 D228+ 2026-06-01 세션 — 종량제 Phase 1 + Phase 2 전체 완료 + 스팸 정책 변경 | 차감 크레딧 후불 과금 알림톡 싱크에이전트 여정 슈퍼관리자 요금제 종량제 utils/ai-credit-calc.ts ai-credit-tx.ts ai-credit.ts ai-credit-context.ts | [TASKS_2026-06.md](TASKS_2026-06.md) |
| 2026-07-02 | 🟢 2026-07-02 (6) — 자동마케팅 완성: 발송 전 흐름 스펙 + 일일 분석 엔진(오늘의 추천) + 회고·ROI·캘린더·D-2 준비 (★배포완료 — 단 prep_reminder_sent_for ALTER  | 차감 크레딧 알림톡 카카오 검수 템플릿 080 여정 자동마케팅 이메일 | [TASKS_2026-07.md](TASKS_2026-07.md) |
| 2026-07-02 | 🟢 2026-07-02 (5) — DM 추적 근본 수리(본문 파서) + 상세 추적/버튼 단위 + AI 학습 메모리 자동 전송 + 디자인 v2 (★추적 수리 서버 검증완료 / 나머지 배포대기) | 수신거부 080 여정 오퍼레이터 이메일 변수 고객사 워커 세션 학습 app.ts dm.ts ai.ts | [TASKS_2026-07.md](TASKS_2026-07.md) |
| 2026-07-02 | 🟢 2026-07-02 (4) — DM·이메일 전면 정비 (★전부 배포완료) | 크레딧 템플릿 발신번호 이메일 치환 문안 스팸 배포 모달 CT-08 | [TASKS_2026-07.md](TASKS_2026-07.md) |
| 2026-07-02 | 🟢 2026-07-02 (3) — 모바일DM 수신자별 추적 근본 수정: 토큰 1급 키 + 열람 깊이/섹션/클릭 + 추적 화면 격상 (★배포완료·ALTER 적용) | 모바일DM 이탈 배포 dm-tracking.ts CT-86 | [TASKS_2026-07.md](TASKS_2026-07.md) |
| 2026-07-02 | 🟢 2026-07-02 (2) — 이메일 마케팅 종결: 크레딧 모델 개편 + 개인화 동적화 + 링크/쿠폰/서식/페이징 (★전부 배포완료) | 환불 차감 크레딧 과금 템플릿 이메일 인앱 개인화 변수 배포 CT-58 | [TASKS_2026-07.md](TASKS_2026-07.md) |
| 2026-07-02 | 🟢 2026-07-02 (1) — 브랜드보이스 형태 추출 강화 + 브랜드 링크 + 문안 편집기 모달 (★전부 배포완료) | 수신거부 변수 치환 문안 브랜드보이스 배포 모달 CT-99 CT-100 | [TASKS_2026-07.md](TASKS_2026-07.md) |
| 2026-07-01 | 🟢 2026-07-01 (이어서 3) — 서버 상태 점검 후 코드 수정: 42P08(시스템 sync user INSERT 타입충돌) + PG 부팅 연결 재시도 + CORS 안내 (★배포·검증완료) | 수신거부 배포 sync.ts companies.ts utils/system-sync-user.ts config/database.ts | [TASKS_2026-07.md](TASKS_2026-07.md) |
| 2026-07-01 | 🟢 2026-07-01 (이어서 2) — 예측 일일차감 eligibility 요금제기반 재정의 + 슈퍼관리자 화이트 모던화 + 이메일 placeholder 발송 UX (★전부 배포·검증완료) | 차감 크레딧 이메일 슈퍼관리자 요금제 예측 배포 모달 email-ai.ts email-channel.ts | [TASKS_2026-07.md](TASKS_2026-07.md) |
| 2026-07-01 | 🟢 2026-07-01 (이어서) — 비-문자 개인화+타겟추출 전체(이메일·인앱·DM) + DM 수신자별 토큰 발송/추적/편집기 + 발행 주소복사 (★전부 배포완료) | 차감 크레딧 과금 이메일 인앱 개인화 변수 치환 요금제 세션 channel-eligibility.ts CT-97 CT-20 | [TASKS_2026-07.md](TASKS_2026-07.md) |
| 2026-07-01 | 🟢 2026-07-01 — AI 모델 전환: 문안=Sonnet 5 / 오퍼레이터 정밀=Opus 4.8 + 검수 thinking·오탐차단 + 브랜드보이스 톤 강화 (★전부 배포완료·로그검증) | 카카오 검수 발신번호 080 오퍼레이터 CSV 게이팅 학습 메모리 문안 config/defaults.ts defaults.ts ai.ts ai-mapping.ts | [TASKS_2026-07.md](TASKS_2026-07.md) |

## 2) 종결 버그·과거 DONE LOG

- [BUGS_RESOLVED.md](BUGS_RESOLVED.md) — 종결 버그 배치 전체 + 과거 현황 블록 (원본 BUGS.md 60행~ 원문)
- [DONE_LOG_2026.md](DONE_LOG_2026.md) — 옛 DONE LOG 31건 (2~3월 D55~D88 등)
- [LESSONS_META_ORIGINAL-20260703.md](LESSONS_META_ORIGINAL-20260703.md) — LESSONS_META 압축 전 원문(사례 경위 전문)

## 3) 옛 설계서·핸드오프·디버그노트 (DESIGNS/ — 42개)

- [DESIGNS/AI-INLINE-REFINE-DESIGN.md](DESIGNS/AI-INLINE-REFINE-DESIGN.md)
- [DESIGNS/AI-REFINE-POPUP-MASTER-PROMPT.md](DESIGNS/AI-REFINE-POPUP-MASTER-PROMPT.md)
- [DESIGNS/ALIMTALK-DESIGN.md](DESIGNS/ALIMTALK-DESIGN.md)
- [DESIGNS/AUTO-SCHEDULE-DESIGN.md](DESIGNS/AUTO-SCHEDULE-DESIGN.md)
- [DESIGNS/AUTO-SPAM-TEST-DESIGN.md](DESIGNS/AUTO-SPAM-TEST-DESIGN.md)
- [DESIGNS/BRAND-MESSAGE-DESIGN.md](DESIGNS/BRAND-MESSAGE-DESIGN.md)
- [DESIGNS/CHANNEL-EXPANSION.md](DESIGNS/CHANNEL-EXPANSION.md)
- [DESIGNS/CODE-REVIEW-P7-BACKLOG.md](DESIGNS/CODE-REVIEW-P7-BACKLOG.md)
- [DESIGNS/D130-NEXT-ACTIONS.md](DESIGNS/D130-NEXT-ACTIONS.md)
- [DESIGNS/D130-SESSION-HANDOFF.md](DESIGNS/D130-SESSION-HANDOFF.md)
- [DESIGNS/D144-PDF-0506-FIXES.md](DESIGNS/D144-PDF-0506-FIXES.md)
- [DESIGNS/D144-STATS-REALTIME-REFACTOR.md](DESIGNS/D144-STATS-REALTIME-REFACTOR.md)
- [DESIGNS/D145-DEPLOY-SAFETY.md](DESIGNS/D145-DEPLOY-SAFETY.md)
- [DESIGNS/D91-BUGFIX-REPORT.md](DESIGNS/D91-BUGFIX-REPORT.md)
- [DESIGNS/DEBUG-FIX-DESIGN-2026-06-11.md](DESIGNS/DEBUG-FIX-DESIGN-2026-06-11.md)
- [DESIGNS/DM-PRO-DESIGN.md](DESIGNS/DM-PRO-DESIGN.md)
- [DESIGNS/FIX-GUIDE-D62.md](DESIGNS/FIX-GUIDE-D62.md)
- [DESIGNS/FLYER-AI-DESIGN.md](DESIGNS/FLYER-AI-DESIGN.md)
- [DESIGNS/FLYER-BUGS.md](DESIGNS/FLYER-BUGS.md)
- [DESIGNS/FLYER-EXPANSION-DESIGN.md](DESIGNS/FLYER-EXPANSION-DESIGN.md)
- [DESIGNS/FLYER-MART-ROADMAP.md](DESIGNS/FLYER-MART-ROADMAP.md)
- [DESIGNS/FLYER-MIGRATION-PLAN.md](DESIGNS/FLYER-MIGRATION-PLAN.md)
- [DESIGNS/FLYER-POS-AGENT-DEV.md](DESIGNS/FLYER-POS-AGENT-DEV.md)
- [DESIGNS/FLYER-POS-AGENT.md](DESIGNS/FLYER-POS-AGENT.md)
- [DESIGNS/FLYER-QR-COUPON-DESIGN.md](DESIGNS/FLYER-QR-COUPON-DESIGN.md)
- [DESIGNS/FLYER-SCHEMA.md](DESIGNS/FLYER-SCHEMA.md)
- [DESIGNS/FLYER-STATUS.md](DESIGNS/FLYER-STATUS.md)
- [DESIGNS/FLYER-SUPERADMIN.md](DESIGNS/FLYER-SUPERADMIN.md)
- [DESIGNS/LEGACY-MIGRATION.md](DESIGNS/LEGACY-MIGRATION.md)
- [DESIGNS/SCALING.md](DESIGNS/SCALING.md)
- [DESIGNS/SYNC-AGENT-CWD-PATCH-v1.5.1.md](DESIGNS/SYNC-AGENT-CWD-PATCH-v1.5.1.md)
- [DESIGNS/SYNC-AGENT-ENVIRONMENTS.md](DESIGNS/SYNC-AGENT-ENVIRONMENTS.md)
- [DESIGNS/SYNC-AGENT-REMOTE-INSTALL.md](DESIGNS/SYNC-AGENT-REMOTE-INSTALL.md)
- [DESIGNS/SYNC-AGENT-V1.5.0-DESIGN.md](DESIGNS/SYNC-AGENT-V1.5.0-DESIGN.md)
- [DESIGNS/SYNC-AGENT-V1.5.0-QA-GUIDE.md](DESIGNS/SYNC-AGENT-V1.5.0-QA-GUIDE.md)
- [DESIGNS/SYNC-AGENT-V1.5.0-RELEASE-NOTES.md](DESIGNS/SYNC-AGENT-V1.5.0-RELEASE-NOTES.md)
- [DESIGNS/SYNC-AGENT-V1.5.0-SESSION-HANDOFF.md](DESIGNS/SYNC-AGENT-V1.5.0-SESSION-HANDOFF.md)
- [DESIGNS/debug-notes-2026-06-02.md](DESIGNS/debug-notes-2026-06-02.md)
- [DESIGNS/debug-notes-2026-06-11.md](DESIGNS/debug-notes-2026-06-11.md)
- [DESIGNS/handoff_D163_beta_modal_system.md](DESIGNS/handoff_D163_beta_modal_system.md)
- [DESIGNS/legacy-payment-migration.md](DESIGNS/legacy-payment-migration.md)
- [DESIGNS/교통정리-전수점검-20260305.md](DESIGNS/교통정리-전수점검-20260305.md)
- [DESIGNS/관제탑_재설계_마스터프롬프트_v2.md](DESIGNS/관제탑_재설계_마스터프롬프트_v2.md)
