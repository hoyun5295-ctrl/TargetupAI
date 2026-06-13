# Email 캠페인 AI 강화 + 트래킹 토대 설계서 (2026-06-13, Harold 승인)

## 배경

Email 캠페인(/email-campaigns)은 회사 SMTP 직접 등록 + 수동 캠페인 작성 + 이력 모달까지 구현된 상태. AI 기능 0건. 설계 조사에서 확인된 토대 공백 2건을 포함해 Phase A~G를 한 번에 구현한다.

- 토대 공백 1: 오픈/클릭 트래킹 발신부 부재 — email_events 수신부(webhook)만 있고 픽셀/링크 래핑/개인 토큰 수신거부가 없음. 수신거부 링크가 고정 URL이라 개인 식별 불가.
- 토대 공백 2: 수신자 = 수동 타이핑만 — customers(email + email_opt_in)가 있는데 고객DB 연동 없음.
- 토대 공백 3 (구현 중 확인): status='scheduled' 캠페인을 실제 발송하는 워커가 없음 — 예약은 장식. target_spec 저장 + 스케줄 워커로 해결.
- 토대 공백 4 (구현 중 확인): 발송이 HTTP 요청 안 동기 루프(100건당 1초 대기) — 고객DB 연동 후 수천 건이면 타임아웃. 비동기 전환.

## 크레딧 (Harold 승인 — 운영 2단 구조 일치)

| source | 차감 | 시점 |
|---|---|---|
| email-ai-generate | 3 | 생성(돌려보기) 호출마다. 작은 차감 = confirm 모달 X, 토스트만 |
| email-ai-publish | 30 | AI 생성(ai_generated=true) 캠페인 발송 확정 최초 1회. 멱등키 `email-ai-publish:{campaignId}`. CreditConfirmModal 의무. 수동 캠페인 발송 = 0 |
| email-refine | 1 | 다듬기(제목·본문) 호출마다 |
| email-precheck | 1 | 발송 전 진단. 광고 표기 등 기계 체크는 코드(0크레딧), AI는 스팸 위험 분석만 |
| email-performance-insight | 5 | 발송 후 성과 진단. 이벤트 0건 시 호출 차단 + 차감 0 |
| email-send-time-recommend | 5 | 자사 오픈 표본 30건 미만 = insufficient_data 안내 + AI 호출 생략 + 차감 0 |

차감 구현 = checkCredit → 작업 성공 → deductCreditSafe (dm.ts 패턴 1:1). InsufficientCreditError → 402 INSUFFICIENT_CREDIT.

## Phase 구성

### A. 트래킹 토대 (utils/email-tracking.ts 신설 CT)
- token = base64url(payload JSON) + '.' + base64url(HMAC-SHA256). payload = { c: campaignId, e: email, u?: url }. 키 = EMAIL_TRACKING_SECRET || JWT_SECRET.
- 공개 라우트 (routes/email.ts, authenticate 앞):
  - GET /api/email/t/o/:token → 1x1 투명 GIF + recordEmailEvent(open)
  - GET /api/email/t/c/:token → recordEmailEvent(click) + 302 redirect (u까지 HMAC 서명 = open redirect 차단)
  - GET /api/email/u/:token → 다크 톤 수신거부 확인 페이지(HTML 직접 응답)
  - POST /api/email/u/:token → recordEmailEvent(unsubscribe) → 기존 자동 처리(customers.email_opt_in=false) 재사용
- 발송 직전 HTML 가공(수신자별): 링크 래핑(mailto/tel/anchor/{{변수}} 제외) → 수신거부 토큰 치환 → 픽셀 주입. 광고성(is_ad)이면 (광고) prefix + 수신거부 footer는 기존 로직 유지하되 토큰 URL로 교체.
- 발송 성공 수신자마다 recordEmailEvent('delivered') 기록 → 수신자별 이력/미오픈자 추출 토대.

### B. 수신자 고객DB + 발송 비동기화 + 예약 실발송
- POST /api/email/recipients/preview { grades?: string[] } → { total, gradeBreakdown, sample }. 조건 = email 유효(@ 포함) AND email_opt_in IS DISTINCT FROM false (NULL = 미거부 취급) + 회사 격리.
- POST /campaigns/:id/send body 확장: { recipients?: [...], target?: { type:'customers', grades?: string[] }, mode: 'immediate' | 'scheduled' }.
  - immediate: 검증(SMTP/Zero-Count/placeholder) → status='sending' + 응답 { queued: true, total } → setImmediate로 엔진 실행(완료/실패 status 자체 갱신).
  - scheduled: campaign.scheduled_at 미래 필수 → target_spec 저장 + status='scheduled' (발송 X). email-send-sweeper가 도래 시 발송.
  - 이중 발송 가드: status='sending' 시 409.
- utils/email-send-sweeper.ts 신설: 60초 주기. ① scheduled_at 도래 'scheduled' → target_spec 해석 → 발송 시작 ② 'sending' 인데 updated_at 30분+ 정체 → 'failed' (엔진이 배치마다 sent_count/updated_at 갱신 = 살아있음 신호). app.ts 등록.
- DB ALTER 2건: email_campaigns.ai_generated boolean NOT NULL DEFAULT false / email_campaigns.target_spec jsonb. (+ email_events.auto_processed 운영 존재 확인 — 코드는 이미 사용 중인데 SCHEMA.md 미기록.)

### C. AI 원샷 생성 (utils/email-ai.ts 신설 CT)
- POST /api/email/ai/generate { prompt? | scenario?, is_ad } → callAIWithFallback(model:'opus', source:'email-ai-generate') + buildSystemPromptWithBrandVoice → { name, subjects[3], preheader, html_body, text_body }.
- HTML 규격: 이메일 클라이언트 호환 — max-width 600px 테이블 레이아웃 + 인라인 스타일만 + 라이트 톤. 수신거부 링크 직접 작성 금지(발송 시 자동 부착) + (광고) prefix 직접 작성 금지.
- 구체 혜택(%/원/쿠폰/무료) 임의 생성 금지 → `[혜택을 직접 입력해주세요]` placeholder. placeholder 잔존 시 발송 400 차단 (여정 activateJourney 패턴).
- 빠른 시작 7 시나리오: cart(장바구니 리마인드) / dormant(휴면 재활성) / vip(VIP 감사) / new(신상품 안내) / repurchase(재구매 유도) / birthday(생일 축하) / newsletter(뉴스레터).
- POST /api/email/ai/refine { subject, html_body, instruction } → 수정본 반환 (1크레딧).
- 모델명 노출 0. AI 생성 캠페인 저장 시 ai_generated=true.

### D. 발송 전 AI 진단
- POST /api/email/ai/precheck { campaignId } → 기계 체크(코드·무료: placeholder/제목 길이 40자/프리헤더/링크 수/text_body) + AI 스팸 위험(riskLevel/reasons/suggestions) 1크레딧. 발송 confirm 모달 안 버튼. 진단 없이 발송 가능(강제 X).

### E. 발송 후 성과 진단
- POST /api/email/ai/insight { campaignId } → 실측 집계(오픈율/클릭률/바운스/수신거부/시간대 분포/고유 오픈) → topInsight + 개선 제안 1~3건. 이벤트+발송 0건 = 400 + 차감 0. 완료 캠페인 카드 버튼.

### F. 발송 시간 추천
- POST /api/email/ai/send-time → 자사 90일 오픈 이벤트 KST 시간대 분포. 표본 30건 미만 = insufficient_data(차감 0). 결과에 표본 수 명시. 캠페인 폼 예약 입력 옆 버튼.

### G. 미오픈자 SMS 크로스 채널
- GET /api/email/campaigns/:id/non-openers → delivered 있고 open 없는 이메일 → customers email→phone 매칭 { matched[{phone,name}], unmatchedCount }. 모달에 목록 + 복사. SMS 발송은 기존 시스템 그대로(발송 경로 신설 0 — 0611 교훈). AI 호출 0 = 차감 0.

## Frontend (EmailCampaignsPage.tsx 단일 파일 확장)

- AI 자연어 입력 카드(fuchsia/purple 그라데이션 + Enter) + 빠른 시작 7 카드 — 클릭 1번 = 즉시 생성 → 편집 모달 자동 진입 (marketing_user_ux_priority).
- 생성 진행 시각 효과(단계 카드) + 편집 모달(제목 3안 칩 / 프리헤더 / iframe srcDoc 미리보기 / HTML 토글 / AI 다듬기 1크레딧).
- RecipientsModal 2탭: [고객DB에서 선택](등급 multi-select + 인원 미리보기 + 거부 자동 제외 안내) / [직접 입력](기존).
- 발송 confirm: AI 진단(1크레딧) 결과 카드 + AI 캠페인이면 CreditConfirmModal('email-ai-publish' 30) 체인 + 즉시/예약 분기.
- 캠페인 카드: sending 진행 폴링(sent_count) / 완료 시 [AI 성과 진단](5) + [미오픈자 SMS] 버튼.
- constants/credit.ts: CREDIT_SOURCE_LABELS 6건 + CONFIRM_CREDIT_COSTS['email-ai-publish']=30 추가 (백엔드 CREDIT_COST_MAP 1:1).
- 디자인: 다크 톤 + violet 액센트 + 모바일 반응형 + Source caption + ConfirmModal/useToast (native dialog 0) + 모델명 0.

## 검증

- backend/frontend tsc 0.
- 순수 로직 검증 스크립트 scripts/verify-email-ai.ts (토큰 왕복/변조 거부, 링크 래핑 제외 규칙, 픽셀 주입, placeholder 검출, 제목 길이, 시간대 binning) — ts-node 실행 GREEN.
- 자가 grep: 모델명/박-단어/native dialog/임의 혜택 0건.
- 발송 = 돈·발송 경로 수정 → 배포 후 실측 1건 시나리오(테스트 캠페인 1건 → 본인 이메일 1명 발송 → delivered/open/click 이벤트 확인 → 이력 모달 표시 확인) 의무.

## 배포 (Harold 직접)

1. ALTER SQL 2건 + auto_processed 확인 SQL (보고서에 동봉)
2. backend + frontend build:safe + pm2 restart all
3. (선택) .env EMAIL_TRACKING_SECRET — 미설정 시 JWT_SECRET 사용, PUBLIC_BASE_URL — 기본 https://app.hanjul.ai
