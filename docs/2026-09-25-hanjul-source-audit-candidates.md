# 한줄로 소스 전수점검 · 1차 탐색 후보 목록 (미검증)

> 장부 = [2026-09-25-hanjul-source-audit.md](2026-09-25-hanjul-source-audit.md). 이 파일은 **점검 목록**일 뿐 사실이 아니다.
> 2026-09-25 워크플로 1차 탐색(청크 76개 중 28개 완료 · 백엔드 routes·utils 일부)에서 나온 450건 중 critical 16건(장부 §2에서 직접 확인)을 뺀 나머지.
> 부분을 직접 점검할 때 해당 줄을 열어 확인하고, 성립하면 장부로 옮긴다. 경로 약어: be/ = packages/backend/src/, fe/ = packages/frontend/src/.

총 434건 · high 59 · medium 214 · low 161

| # | 등급 | 관점 | 위치 | 보고 내용 |
|---|---|---|---|---|
| R001 | high | 속도 | be/routes/address-books.ts:120 | 주소록 저장·추가가 연락처 1건마다 INSERT를 순차 await함(최대 10만 번 왕복) |
| R002 | high | 속도 | be/routes/agency-send.ts:346 | 원스텝 미리보기·확정이 최대 50MB 엑셀을 요청 경로에서 동기 파싱해 백엔드 단일 프로세스 전체가 멈춘다 |
| R003 | high | 속도 | be/routes/agency-send.ts:586 | 재접수용 수신자 목록 API가 LIMIT 없이 전 명단을 한 번에 JSON으로 내려주고, 큰 명단은 결국 접수 단계에서 413으로 실패한다 |
| R004 | high | 결함 | be/routes/ai.ts:3097 | 다중 목표 충돌 분석이 크레딧을 한 번도 차감하지 않고 월 AI 한도도 건너뛴다(companyId 누락) |
| R005 | high | 결함 | be/routes/ai.ts:4066 | 여정 대상 명단과 추출에 매장(브랜드) 격리가 없다: 매장 제한 계정이 다른 매장 고객의 전화번호를 보고 발송까지 한다 |
| R006 | high | 결함 | be/routes/alimtalk.ts:1674 | 알림톡 템플릿을 수정할 때 지운 강조 타이틀과 대표링크가 PG에 남고, 발송할 때 그 옛 값이 그대로 실린다 |
| R007 | high | 속도 | be/routes/analysis.ts:482 | 분석 미리보기가 이탈 고객 수를 세려고 이탈 고객 전원의 행을 Node로 가져온다(창을 열 때마다) |
| R008 | high | 결함 | be/routes/auth.ts:689 | /auth/change-password가 인증·횟수 제한 없이 아무 userId의 비밀번호를 대입해 볼 수 있는 경로다 |
| R009 | high | 결함 | be/routes/billing.ts:2043 | 이미 발행에 반영된 수량 조정을 지우면 기준 수량이 틀어지고, 다음 조정이 틀린 수량으로 재발행된다 |
| R010 | high | 결함 | be/routes/cafe24.ts:116 | 중복 웹훅이 원래 행 상태를 'duplicate'로 덮어써서, 처리에 실패한 이벤트가 재처리 대상에서 영구히 빠짐 |
| R011 | high | 결함 | be/routes/campaigns.ts:456 | 담당자 테스트 발송의 브랜드 행이 app_etc1='test'가 아니어서 테스트 청구 집계와 테스트 통계에서 빠짐 |
| R012 | high | 결함 | be/routes/campaigns.ts:957 | 캠페인 발송의 중복 방지가 '조회 후 삽입'이라 동시 요청 두 개가 모두 통과함 |
| R013 | high | 데이터 | be/routes/campaigns.ts:1662 | 직접발송 staging이 확인 창 전에 적재되고, 취소·실패 시 정리 주체가 없어 개인정보 행이 계속 쌓임 |
| R014 | high | 데이터 | be/routes/cdp.ts:680 | SDK 공개 호출(인앱 조회·노출 기록)마다 cdp_api_call_log에 한 행씩 INSERT하는데 정리 코드가 없음 |
| R015 | high | 결함 | be/routes/cdp.ts:1313 | 인앱 메시지 게시(100크레딧)를 PUT으로 active 전환하면 잔액 확인 없이 게시되고, 차감에 실패해도 무료로 게시 상태가 유지됨 |
| R016 | high | 속도 | be/routes/customers.ts:376 | 고객 엑셀 다운로드가 전체 고객을 LIMIT 없이 메모리에 올리고 XLSX 를 동기로 만든다 |
| R017 | high | 결함 | be/routes/dm.ts:1530 | DM 발송 추적이 수신자 1000명에서 잘려, 퍼널 숫자와 '미열람 재발송' 대상이 조용히 빠진다 |
| R018 | high | 결함 | be/routes/manage-callbacks.ts:174 | 발신번호 수정(PUT /:id)이 등록 승인 절차를 건너뛰고 임의 번호로 바꿀 수 있다 |
| R019 | high | 결함 | be/routes/short-url.ts:83 | 수신자별 단축 URL 클릭이 고객 없이(customer_id NULL) 기록되어 여정의 클릭 분기·클릭 목표가 영영 참이 되지 않음 |
| R020 | high | 결함 | be/routes/spam-filter.ts:23 | 스팸 테스트폰 앱 토큰에 소스 하드코딩 기본값이 있어, 환경변수가 없으면 누구나 테스트폰 등록·결과 위조 가능 |
| R021 | high | 속도 | be/routes/sync.ts:970 | 싱크 배치마다 회사 전체 수신거부 대조 4쿼리와 고객 전량 COUNT(*)를 다시 돌림 |
| R022 | high | 속도 | be/routes/unsubscribes.ts:483 | 수신거부 파일 등록이 번호마다 쿼리 2개씩 순차 실행(N+1) |
| R023 | high | 속도 | be/routes/upload.ts:522 | 최대 50MB 엑셀을 한 업로드에서 동기 XLSX.readFile로 3~4번 전체 파싱(단일 fork 프로세스) |
| R024 | high | 결함 | be/routes/voice.ts:40 | 음성 웹훅 서명 검증이 환경변수가 없으면 통째로 빠짐(fail-open). 운영 문서상 미설정 |
| R025 | high | 속도 | be/utils/agency-send-form.ts:357 | 메일 워커가 대용량 명단 엑셀을 API 단일 프로세스 안에서 동기 파싱해 모든 요청이 멈춤 |
| R026 | high | 데이터 | be/utils/agency-send-intake.ts:443 | 대행발송 수신자 명단(전화번호+변수값)이 영구 누적된다. 3만 상한이 없어져 누적 속도가 등재 당시보다 커졌다 |
| R027 | high | 결함 | be/utils/agency-send-intake.ts:798 | 원스텝·메일 접수의 SMS/LMS 판정이 글자 수 45만 보고 광고 표기·무료거부 줄과 EUC-KR 바이트를 빼먹음 |
| R028 | high | 결함 | be/utils/agency-send-mail-worker.ts:1184 | DB 연결을 한 번만 못 얻어도 이메일 접수 워커가 재시작 전까지 영구 정지 |
| R029 | high | 결함 | be/utils/agency-send-worker.ts:370 | 대행발송 스팸검사가 실패하거나 시간 초과여도 통과로 읽고 발송한다(B-0823-1이 그대로 남아 있음) |
| R030 | high | 결함 | be/utils/ai-segment-generator.ts:231 | AI가 조건을 비워 돌려주면 입력 문장의 '모든/전체' 단어만 보고 전체 고객 발송으로 바꾼다 |
| R031 | high | 결함 | be/utils/alimtalk-jobs.ts:248 | 검수 폴링이 ORDER BY 없이 LIMIT 100이고 IMC 오류 행은 last_synced_at을 갱신하지 않아, 실제 검수중 템플릿이 밀려날 수 있다 |
| R032 | high | 결함 | be/utils/assets.ts:229 | 소재 삭제 시 인앱 메시지만 참조 검사해, 발송된 DM·이메일이 쓰는 이미지 실물 파일까지 지운다 |
| R033 | high | 결함 | be/utils/cafe24-client.ts:361 | 토큰 갱신이 한 번이라도 실패하면(일시 장애 포함) token_expired가 되고, 이후 카페24 웹훅 주문·회원 이벤트가 200으로 조용히 버려짐 |
| R034 | high | 결함 | be/utils/cafe24-scripttag.ts:67 | CDP 키 재발급 후에도 카페24 scripttag가 옛 공개키(?k=)를 계속 써서 몰 행동 수집이 전량 401 |
| R035 | high | 속도 | be/utils/campaign-quick.ts:483 | AI 자동제작 견적 요청마다 카탈로그 최대 500장 원본을 readFileSync로 동기 읽기(단일 프로세스 이벤트루프 차단) |
| R036 | high | 데이터 | be/utils/cdp-auth.ts:481 | cdp_api_call_log가 CDP 호출마다 1행씩 쌓이고 삭제 경로가 없으며, 한도 초과 뒤 거부된 호출도 계속 행을 추가 |
| R037 | high | 데이터 | be/utils/cdp-events.ts:182 | cdp_events(행동 이벤트 로그)를 정리하는 코드가 어디에도 없어 page_view 등이 끝없이 쌓임 |
| R038 | high | 결함 | be/utils/cdp-orders.ts:190 | 주문 매출(RFM)을 먼저 더하고 마커는 나중에 남기는데 그 사이 실패를 삼켜, 같은 주문의 매출이 반복해서 더해짐 |
| R039 | high | 속도 | be/utils/cdp-profile-recompute-worker.ts:23 | 5분마다 도는 증분 조회가 received_at 기준인데 쓸 수 있는 인덱스가 없어 cdp_events 전체를 훑음 |
| R040 | high | 결함 | be/utils/connected-content.ts:384 | 날씨 변수 구조가 AI 문안 지시와 달라, AI가 만든 여정 문자에서 날씨 자리가 빈칸이 되고 날씨 분기가 한 번도 맞지 않음 |
| R041 | high | 결함 | be/utils/continuous-operator.ts:527 | 자동마케팅 수정에서 혜택을 비워도 옛 혜택이 남아 계속 발송됨 |
| R042 | high | 결함 | be/utils/continuous-operator.ts:960 | 생성이 발송 희망 시각을 넘기면 예약 발송이 다음 주기로 밀림(연 1회 시즌 캠페인은 1년 밀림) |
| R043 | high | 속도 | be/utils/continuous-operator.ts:1419 | 자율 발송 패스가 제안 생성 루프 전체가 끝날 때까지 대기 |
| R044 | high | 속도 | be/utils/dm/dm-ai.ts:923 | AI 원스텝 생성이 섹션별 카피 AI 호출을 순서대로 기다리고, 같은 문안두뇌 조회를 섹션마다 반복함 |
| R045 | high | 결함 | be/utils/dm/dm-brand-extractor.ts:201 | 브랜드 추출 URL fetch에 SSRF 가드와 본문 크기 제한이 없음(등재 결함이 코드에 그대로 남아 있음) |
| R046 | high | 결함 | be/utils/dm/dm-interaction.ts:90 | 공개 룰렛·추첨 응모에서 1인 1회 제한을 우회해 경품을 모두 빼갈 수 있음 |
| R047 | high | 결함 | be/utils/dm/dm-quick-action.ts:315 | 원클릭 액션이 sections 컬럼만 고쳐서 화면에 반영되지 않는데 크레딧은 섹션마다 빠짐 |
| R048 | high | 결함 | be/utils/dm/dm-viewer.ts:117 | 레거시(D119) DM 뷰어가 제목·문구·링크를 이스케이프 없이 넣어 공개 페이지에 저장형 XSS가 가능함 |
| R049 | high | 결함 | be/utils/email-channel.ts:662 | 이메일 수신거부가 고객DB와 주소가 정확히 일치하는 행에만 기록돼, 직접 입력 명단이나 대소문자가 다른 주소에는 다음 발송이 다시 나감 |
| R050 | high | 결함 | be/utils/email-tracking.ts:124 | 클릭 추적이 HTML 이스케이프된 `&amp;`까지 원본 URL로 서명해, 파라미터가 2개 이상인 링크가 깨진 주소로 이동함 |
| R051 | high | 결함 | be/utils/full-analysis-runner.ts:92 | 풀분석이 크레딧 차감 결과를 보지 않고 완료 처리해, 잔액이 없어도 PDF가 공짜로 나감 |
| R052 | high | 결함 | be/utils/inapp-explainer.ts:274 | 통계 드릴다운을 열 때마다 AI 진단이 자동 호출돼 1크레딧씩 반복 차감 |
| R053 | high | 데이터 | be/utils/inapp-message.ts:986 | 인앱 노출 로그(cdp_inapp_impressions)가 보관 기한 없이 무한 적재 |
| R054 | high | 속도 | be/utils/inapp-message.ts:1284 | 인앱 표시 조회(/inapp/active)가 방문자 요청마다 노출 이력 전체를 여러 번 훑음 |
| R055 | high | 결함 | be/utils/inapp-personalization.ts:503 | 인증 없는 external_id로 다른 회원의 이름·등급·구매액을 받아 볼 수 있음 |
| R056 | high | 결함 | be/utils/inapp-quick-action.ts:138 | AI 본문 다듬기가 검토·혜택 차단 없이 A/B 변형 3건을 즉시 고객 노출 상태로 생성 |
| R057 | high | 결함 | be/utils/invoice-confirm.ts:290 | 거래내역서 메일 재시도가 실패했던 장을 영원히 건너뛰어 재발송이 되지 않음 |
| R058 | high | 결함 | be/utils/journey-ai-generator.ts:1010 | 스팸 회피 AI 재작성문이 혜택 차단기 없이 실발송 본문을 자동으로 덮어씀 |
| R059 | high | 속도 | be/utils/journey-stats.ts:224 | 여정 통계가 모든 고객사의 cdp_events 전체와 인덱스 없는 journey_step_logs.step_id를 통째로 훑는다 |
| R060 | medium | 개선 여지 | be/routes/address-books.ts:60 | 그룹 '조회'(미리보기)가 그룹 전체(최대 10만 건)를 받아 상위 10건만 보여 줌 |
| R061 | medium | 결함 | be/routes/address-books.ts:105 | 그룹 식별 기준이 생성할 때는 사용자 단위, 관리자가 조회·추가·삭제할 때는 회사 단위로 달라 다른 사용자의 동명 그룹이 섞임 |
| R062 | medium | 결함 | be/routes/address-books.ts:116 | 주소록 저장이 트랜잭션 없이 행 단위로 커밋돼 중간 실패 시 반쪽 그룹이 남고, 같은 이름으로 재시도할 수 없음 |
| R063 | medium | 결함 | be/routes/admin-sync.ts:175 | 에이전트 오류·오늘 건수 집계가 started_at 기준이라 배치 기록(started_at NULL)의 실패가 빠짐 |
| R064 | medium | 속도 | be/routes/admin-sync.ts:251 | 에이전트 상세 응답이 로그 20건의 failures jsonb를 통째로 내려보내고, 매핑 모달은 reported 하나를 얻으려고 이 상세를 부름 |
| R065 | medium | 결함 | be/routes/admin-sync.ts:600 | 에이전트 삭제 방지 기준이 30분 고정이라 하트비트 60분 주기의 정상 에이전트가 경고 없이 삭제됨 |
| R066 | medium | 속도 | be/routes/admin.ts:110 | 사용자 목록을 열 때마다 customers 전체를 uploaded_by별로 집계함 |
| R067 | medium | 결함 | be/routes/admin.ts:2492 | 발신번호 등록 때 대표번호를 먼저 풀고 나서 회선 상한을 검사해, 거절되면 회사에 대표번호가 없어짐 |
| R068 | medium | 결함 | be/routes/admin.ts:2788 | 요금제 신청 승인 때 신청 상태를 조건 없이 바꿔, 두 번 승인하면 무료체험이 이중 부여됨 |
| R069 | medium | 결함 | be/routes/admin.ts:3708 | 수동 잔액 조정에서 잔액 변경과 원장 기록이 한 트랜잭션으로 묶여 있지 않음 |
| R070 | medium | 속도 | be/routes/admin.ts:5500 | 감사 로그 조회마다 audit_logs 전체에서 DISTINCT action을 다시 계산함 |
| R071 | medium | 결함 | be/routes/admin.ts:5971 | 알림톡 템플릿 수동 등록이 소문자 'approved'를 넣어 DB CHECK 제약에 항상 걸림 |
| R072 | medium | 결함 | be/routes/ai-memory.ts:999 | 브랜드 링크 라벨 충돌 처리가 마지막 후보(-9)를 확인하지 않아, 기존 링크를 말없이 덮어쓴다 |
| R073 | medium | 결함 | be/routes/ai-usage.ts:57 | 'Cache 히트율'이 회사별이 아니라 프로세스 전역 누적값이라, 모든 고객사에 같은 숫자와 전체 호출 규모가 보인다 |
| R074 | medium | 결함 | be/routes/ai-usage.ts:75 | 일평균·한도 도달 예측·30일 예측·전월 대비가 잘못 계산된다(호출 없는 날 누락, 이번 달 누계를 지난달 전체와 비교) |
| R075 | medium | 결함 | be/routes/ai-usage.ts:403 | AI 한도 알림 설정은 저장만 되고, 그 값을 읽어 알림을 보내는 코드가 없다 |
| R076 | medium | 속도 | be/routes/ai.ts:280 | AI 문구 생성 요청마다 회사 고객 테이블을 네 번 전체 스캔한다(캐시 없음) |
| R077 | medium | 결함 | be/routes/ai.ts:1085 | 문안 다듬기가 사전 잔액 확인 없이 AI를 불러 잔액 0 회사도 무제한 무료로 쓴다 |
| R078 | medium | 결함 | be/routes/ai.ts:1348 | 고객 평균 통계를 없는 JSON 키에서 읽어 AI 프롬프트와 ROI 추정이 늘 0이 된다 |
| R079 | medium | 결함 | be/routes/ai.ts:1798 | 풀분석이 안내(300)보다 5크레딧 더 차감되고, 실패해도 그 5는 빠진다 |
| R080 | medium | 결함 | be/routes/ai.ts:2542 | 자동마케팅 수정·보관(PUT/DELETE)에 소유자 검증이 없고 status 값도 검증하지 않는다 |
| R081 | medium | 결함 | be/routes/ai.ts:3023 | 담당자 정지(admin-stop)가 발송 선점과 경쟁하면 '정지됨'으로 표시된 채 실제로 발송된다 |
| R082 | medium | 결함 | be/routes/ai.ts:3284 | AI 근거 질의(/operator/explain)가 없는 컬럼을 조회해 항상 500이고, 살아나도 크레딧·한도 없이 Opus를 부른다 |
| R083 | medium | 결함 | be/routes/ai.ts:4832 | 여정 상세 페이지의 진입 고객 목록이 offset을 버려서 늘 첫 50명만 보인다 |
| R084 | medium | 결함 | be/routes/ai.ts:5070 | 예측 1클릭 액션이 약속한 '대상 N명'이 실제 자동마케팅 대상과 다르다(targetFilters는 아무도 안 씀) |
| R085 | medium | 데이터 | be/routes/alimtalk.ts:136 | 공개 웹훅이 쓰이지 않는 이벤트 원문을 kakao_webhook_events에 정리 없이 쌓고, 인증 설정이 없으면 누구나 적재할 수 있다 |
| R086 | medium | 결함 | be/routes/alimtalk.ts:852 | GET /senders/:id가 회사·권한 검사 없이 어떤 발신프로필이든 전체 행을 돌려준다 |
| R087 | medium | 속도 | be/routes/alimtalk.ts:1166 | 알림톡 템플릿 목록·엑셀이 `SELECT t.*`로 검수 증빙파일 바이너리(행당 최대 5MB)까지 DB에서 매번 끌어온다 |
| R088 | medium | 결함 | be/routes/alimtalk.ts:1795 | 템플릿 삭제·검수취소·휴면해제·코드변경 등이 IMC 거절(HTTP 200 + code≠0000)에도 PG 상태를 바꾼다 |
| R089 | medium | 결함 | be/routes/alimtalk.ts:2320 | 브랜드메시지 템플릿 수정이 IMC에만 반영되고 PG 본문은 그대로여서 목록·미리보기·재수정 폼이 옛 내용을 보여 준다 |
| R090 | medium | 결함 | be/routes/analysis.ts:601 | AI 분석 캐시 적중 시 collectedData가 늘 undefined여서 화면 차트가 전부 사라진다 |
| R091 | medium | 결함 | be/routes/analysis.ts:690 | '최적 발송 시간'·요일·히트맵이 UTC 기준으로 계산돼 한국 시각과 9시간(요일도) 어긋난다 |
| R092 | medium | 데이터 | be/routes/analysis.ts:791 | AI 분석이 이탈 고객 20명의 이름·전화번호를 외부 AI로 보내고 analysis_results에 영구 저장하며 브라우저에도 돌려준다 |
| R093 | medium | 결함 | be/routes/analysis.ts:839 | '구매 전환'·'추정 ROI'가 수신자와 무관한 회사 전체 구매를 캠페인 성과로 잡는다 |
| R094 | medium | 속도 | be/routes/analysis.ts:867 | 비즈니스 분석이 서로 독립인 AI 호출 1·2턴을 순차로 기다려 요청 하나가 수 분 동안 열려 있다 |
| R095 | medium | 결함 | be/routes/billing.ts:2492 | 수량 정정 재발행이 조정 외 발행 차단을 미리 보지 않아, 삭제만 커밋되고 재발행이 실패할 수 있다 |
| R096 | medium | 결함 | be/routes/billing.ts:2770 | 발행 미리보기 금액에 080·부가서비스 항목과 수량 조정이 빠져 실제 발행 금액과 다르다 |
| R097 | medium | 올드 디자인 | be/routes/billing.ts:3284 | 개별 정산서 메일이 옛 디자인·옛 브랜드(INVITO/인비토)를 써서 일괄발급 메일(한줄로)과 모양·문서명이 다르다 |
| R098 | medium | 결함 | be/routes/cafe24.ts:75 | 같은 카페24 몰이 여러 회사에 active로 연동되면 웹훅이 임의의 한 회사로만 들어감 |
| R099 | medium | 개선 여지 | be/routes/campaigns.ts:886 | AI 캠페인 발송이 대상 전량을 요청 안에서 동기 조회·치환·적재함(직접발송 staging 워커로 합류할 여지) |
| R100 | medium | 결함 | be/routes/campaigns.ts:3653 | 브랜드메시지 직접 발송이 카카오 활성 여부와 발신프로필 키 소유를 확인하지 않음 |
| R101 | medium | 결함 | be/routes/cdp.ts:638 | /inapp/active가 검증 없이 받은 external_id로 해당 회원의 이름·등급·포인트·구매액을 응답에 실어 줌 |
| R102 | medium | 속도 | be/routes/cdp.ts:888 | install-status가 부를 때마다 회사의 cdp_events 전 기간을 두 번 전체 집계함 |
| R103 | medium | 결함 | be/routes/cdp.ts:1163 | Web Push 발송이 HTTP 요청 안에서 구독자 전원에게 순차 배치로 나가고 멱등키가 없어, 타임아웃 뒤 다시 누르면 중복 발송됨 |
| R104 | medium | 속도 | be/routes/cdp.ts:1189 | 인앱 목록 조회가 메시지마다 노출 통계 쿼리를 한 번씩 동시에 던짐(N+1), 진입 화면은 그중 6개만 씀 |
| R105 | medium | 결함 | be/routes/companies.ts:94 | 공개 문의 메일에 방문자 입력이 이스케이프 없이 HTML 로 들어간다 |
| R106 | medium | 속도 | be/routes/companies.ts:965 | 대시보드 진입마다 캐시 없이 고객 전수 집계(30여 개 FILTER)와 고객 COUNT 를 돈다 |
| R107 | medium | 결함 | be/routes/companies.ts:2916 | RCS 템플릿 폼의 브랜드 ID·브랜드명이 저장되지 않고 버려진다 |
| R108 | medium | 결함 | be/routes/companies.ts:2942 | RCS 템플릿 수정(PUT)은 링크 결함 검사를 건너뛴다 |
| R109 | medium | 결함 | be/routes/content-interview.ts:386 | 원스텝 생성 결과를 세션에 저장하지 않아, 응답을 못 받으면 낸 돈의 결과물이 사라지고 재시도하면 다시 걷힌다 |
| R110 | medium | 속도 | be/routes/customers.ts:161 | 고객 목록 페이지를 넘길 때마다 중복 접기 뷰 전체를 두 번(COUNT + 정렬) 계산한다 |
| R111 | medium | 결함 | be/routes/customers.ts:747 | 고객 통계의 연령대 계산에 올해 연도(2026)가 하드코딩돼 있다 |
| R112 | medium | 속도 | be/routes/customers.ts:1057 | 직접 타겟 추출이 조건에 맞는 고객 전체(PII 포함)를 JSON 한 덩어리로 브라우저에 보낸다 |
| R113 | medium | 결함 | be/routes/customers.ts:1779 | 고객 상세·360 타임라인만 분류코드(브랜드·몰) 격리가 빠져 있다 |
| R114 | medium | 속도 | be/routes/dm.ts:255 | 공개 DM 뷰어가 열람 1번에 '쪽 수 × 2' 쿼리를 날린다(필드 매핑을 쪽마다 다시 조회) |
| R115 | medium | 속도 | be/routes/dm.ts:284 | 열람 비콘이 15초마다 DM 행 전체(pages·sections JSON 포함)를 SELECT *로 읽는다 |
| R116 | medium | 데이터 | be/routes/dm.ts:389 | DM·재료·카탈로그 이미지가 한 번 올라가면 지워지지 않는다(삭제 경로에 호출처 없음 · 정리 작업 없음) |
| R117 | medium | 결함 | be/routes/dm.ts:1209 | DM 소유 가드(canAccessDm)가 발송·추적·수정 경로 여럿에서 빠져 있다(같은 회사 안 사용자 격리) |
| R118 | medium | 속도 | be/routes/dm.ts:1360 | DM 타겟 발송이 대상 고객 전체를 Node로 가져와 토큰을 만들고, 한 문장짜리 UNNEST로 적재한다(요청 안에서 동기 처리) |
| R119 | medium | 결함 | be/routes/dm.ts:1394 | send-to-target이 수신자 토큰을 필터·캠페인 생성 전에 발급해, 실제로 안 나간 사람도 '발송'으로 잡힌다 |
| R120 | medium | 결함 | be/routes/dm.ts:2508 | A/B 테스트 결과에 체류·완독·클릭이 쌓이지 않아 승자 판정이 사실상 방문 수 비율로만 난다 |
| R121 | medium | 속도 | be/routes/email.ts:217 | 이메일 오픈 픽셀 1회마다 캠페인 이벤트 전체를 훑는 COUNT가 돈다(인덱스 부재) + 동시 오픈이면 카운트가 빠진다 |
| R122 | medium | 속도 | be/routes/email.ts:453 | 이메일 캠페인 목록을 열 때마다 회사의 AI 크레딧 거래 전체를 LIKE로 훑는다 |
| R123 | medium | 결함 | be/routes/email.ts:723 | 이메일 발송·미오픈 재발송의 중복 방지가 확인 후 실행(check-then-act) 방식이라, 동시 요청이 오면 같은 메일이 두 번 나간다 |
| R124 | medium | 결함 | be/routes/godo.ts:100 | 고도몰 연동 해제가 진행 중인 백필 끝에서 되돌려져, 해제한 몰에서 수집이 다시 시작된다 |
| R125 | medium | 데이터 | be/routes/image-studio.ts:194 | 스튜디오 임시 용량 상한(200MB)이 /generate에만 걸려 무료 쓰기 경로로 무제한 적재할 수 있다 |
| R126 | medium | 결함 | be/routes/image-studio.ts:335 | 상품 이미지 가져오기의 SSRF 가드가 기존 CT보다 약하다(DNS 재바인딩, IPv4-mapped 누락) |
| R127 | medium | 결함 | be/routes/image-studio.ts:489 | MMS 저장이 용량 검사 전에 원본 임시파일을 지워, 용량 초과 뒤 재시도하면 유료 생성 이미지를 잃는다 |
| R128 | medium | 결함 | be/routes/imweb.ts:77 | 웹훅 중복 수신이 원래 행의 상태를 'duplicate'로 덮어써 실패 건이 재처리 큐에서 빠진다 |
| R129 | medium | 결함 | be/routes/insight.ts:30 | 일일 인사이트가 '어제 발송·성공·실패'를 항상 0으로 돌려주고 화면과 메일이 그 값을 실적처럼 보여 준다 |
| R130 | medium | 결함 | be/routes/manage-callbacks.ts:126 | 대표번호 해제가 회선 상한·INSERT보다 먼저 커밋돼, 등록이 거절되면 회사에 대표번호가 없어진다 |
| R131 | medium | 결함 | be/routes/manage-stats.ts:144 | 발송통계 '테스트' 탭이 LIVE 큐 테이블만 봐서 완료된 테스트(LOG 이동분)가 빠진다 |
| R132 | medium | 결함 | be/routes/manage-users.ts:216 | 관리자 계정 삭제 차단이 DB에 없는 값('company_admin')과 비교해 항상 통과한다 |
| R133 | medium | 데이터 | be/routes/mms-images.ts:83 | MMS 이미지 저장소(uploads/mms)에 정리 주기가 없어 쓰지 않은 업로드가 계속 쌓인다 |
| R134 | medium | 결함 | be/routes/pay-mappings.ts:25 | PAY 시드 계정이 전부 같은 고정 초기 비밀번호로 만들어져, 로그인 안 한 계정은 누구나 들어갈 수 있다 |
| R135 | medium | 결함 | be/routes/results.ts:731 | 발송 상세 메시지 목록이 캠페인 소유 확인에 실패해도 404 없이 공용 라인 테이블을 조회함 |
| R136 | medium | 속도 | be/routes/results.ts:1016 | 발송 내역 CSV export가 청크마다 전체 UNION을 다시 정렬하는 OFFSET 방식이라 대형 캠페인에서 시간이 제곱으로 늘어남 |
| R137 | medium | 데이터 | be/routes/short-url.ts:96 | 클릭마다 IP·UA·referer·원본 URL을 cdp_events에 저장하고 보관 기한이 없음 |
| R138 | medium | 결함 | be/routes/spam-filter.ts:263 | 유료 스팸 테스트는 발송 도중 실패해도 미발송분을 환불하지 않음 |
| R139 | medium | 데이터 | be/routes/sync.ts:894 | sync_logs가 배치마다 1행씩 실패 전량 JSON과 함께 쌓이고 지우는 곳이 없음 |
| R140 | medium | 데이터 | be/routes/sync.ts:897 | sync_logs가 보관 기한 없이 쌓이고 배치별 실패 목록(전화번호 포함)을 상한 없이 jsonb로 통째 저장 |
| R141 | medium | 속도 | be/routes/unsubscribes.ts:73 | 최대 20MB 엑셀을 요청 스레드에서 동기 파싱하고, 파싱 단계와 등록 단계에서 두 번 함 |
| R142 | medium | 속도 | be/routes/unsubscribes.ts:197 | 수신거부 목록 20건을 보여주려고 회사 전체 수신거부를 읽어 JS에서 정렬·자름 |
| R143 | medium | 결함 | be/routes/upload.ts:494 | 백그라운드 업로드가 프로세스 재시작에 대비가 없음 → 진행률이 'processing'에 멈추고 화면은 무한 폴링 |
| R144 | medium | 결함 | be/routes/upload.ts:539 | 헤더 없는 파일(첫 행이 숫자·전화번호뿐)을 고객DB에 올리면 전 행이 오류 처리되고 첫 행은 빠짐 |
| R145 | medium | 결함 | be/routes/upload.ts:869 | 업로드 커스텀 필드 타입 자동 감지가 항상 빈 값 → 매 업로드마다 field_type을 VARCHAR로 덮어씀 |
| R146 | medium | 결함 | be/routes/voice.ts:41 | 음성 웹훅 HMAC이 원본 바이트가 아니라 재직렬화 문자열로 계산됨(rawBody 미확보) |
| R147 | medium | 결함 | be/routes/woocommerce.ts:121 | 중복 웹훅 수신 시 원본 행의 status를 'duplicate'로 덮어써서 failed 건이 재처리 대상에서 빠짐 |
| R148 | medium | 데이터 | be/utils/access-log.ts:61 | 화면 이동마다 audit_logs에 page_view가 쌓이는데 보관 기한·정리가 없음 |
| R149 | medium | 데이터 | be/utils/agency-send-intake.ts:744 | analyzeOneStep이 수신자 객체를 두 벌 만들고, 한 벌(groups[].recipients)은 쓰는 곳이 없음 |
| R150 | medium | 결함 | be/utils/agency-send-mail-worker.ts:1067 | 이메일 접수는 커밋 뒤 1차 검사를 즉시 깨우지 않아 40분 리드타임 중 최대 5분을 잃음 |
| R151 | medium | 데이터 | be/utils/agency-send-mail-worker.ts:1230 | 메일함(DELE 0)과 처리 원장이 무기한 쌓이고, 매분 전체 UIDL·LIST와 전량 대조 쿼리가 함께 커짐 |
| R152 | medium | 데이터 | be/utils/agency-send-worker.ts:1048 | 대행발송 수신자 명단(전화번호·개인화 값)이 영구 보관된다 |
| R153 | medium | 헛도는 작업 | be/utils/agency-send-worker.ts:1323 | 취소된 대행발송 건마다 30일 동안 5분마다 큐 취소를 다시 실행한다 |
| R154 | medium | 결함 | be/utils/agent-build-tiers.ts:278 | 자동 업데이트 티어 판별이 Server 2012(R2 아님)를 win-mid로 보내 설치 티어표와 어긋난다 |
| R155 | medium | 결함 | be/utils/ai-mapping.ts:440 | AI 응답 파싱에 실패하면 전부 null인 매핑을 성공으로 반환하고, 쿼터도 차감되며, 에이전트 로컬 폴백도 타지 않는다 |
| R156 | medium | 속도 | be/utils/ai-memory-accumulator-worker.ts:78 | 여정 학습 집계가 매시간 실행 건마다 cdp_events를 JSON 조건과 OR로 훑는다(멱등 없음) |
| R157 | medium | 속도 | be/utils/ai-memory-accumulator-worker.ts:136 | 등급 인사이트 대상 선정 쿼리가 매시간 회사별로 customers 전체를 등급별로 집계한다 |
| R158 | medium | 속도 | be/utils/ai-memory-accumulator-worker.ts:233 | DM 학습 후보를 매시간 dm_recipient_tokens 전체 DISTINCT로 뽑는다 |
| R159 | medium | 헛도는 작업 | be/utils/ai-memory-accumulator-worker.ts:242 | DM·이메일 학습의 20시간 멱등 조건이 회사당 한 행이라, 7일 동안 매시간 다시 계산된다 |
| R160 | medium | 데이터 | be/utils/ai-memory-accumulator-worker.ts:254 | DM 학습 워커가 수신자 1000명으로 잘린 표본으로 학습 코퍼스의 발송 수를 덮어쓴다 |
| R161 | medium | 결함 | be/utils/ai-segment-generator.ts:149 | 자연어 타겟 변환 프롬프트에 오늘 날짜(KST)가 없고, 예시 날짜만 UTC로 계산된다 |
| R162 | medium | 속도 | be/utils/ai-self-diagnosis.ts:158 | 자가진단이 cdp_events 전체 이력과 고객 전체를 기간 조건 없이 훑고, 서로 독립인 조회를 순차로 기다린다 |
| R163 | medium | 헛도는 작업 | be/utils/alimtalk-jobs.ts:245 | 검수 알림 수신자가 없는 회사의 승인·반려 템플릿이 5분 폴링 대상에서 영원히 빠지지 않는다 |
| R164 | medium | 속도 | be/utils/automarketing-roi.ts:70 | ROI 매출 쿼리가 회사의 전체 기간 구매 이벤트를 훑고, CDP 보유 확인도 COUNT(*) 전수 집계 |
| R165 | medium | 개선 여지 | be/utils/automarketing-roi.ts:76 | '자동마케팅이 만든 매출'이 실제로는 발송 후 7일 창 안의 회사 전체 구매 합계 |
| R166 | medium | 데이터 | be/utils/bandit-optimizer.ts:455 | 여정 변이 보상을 수신자 한 명마다 같은 행에 UPDATE(+조회·로그) |
| R167 | medium | 데이터 | be/utils/best-copy-assets.ts:53 | best_copy_seed_usage가 생성마다 쌓이기만 하고 정리가 없으며, 집계는 전 기간을 훑음 |
| R168 | medium | 속도 | be/utils/best-copy-miner.ts:76 | 베스트 문안 채굴이 업종 학습 로그 전건을 LIMIT 없이 메모리에 올리고 매번 전부 AI로 재판정 |
| R169 | medium | 개선 여지 | be/utils/billing-issue.ts:269 | 정산 발행의 두 무거운 사용량 집계(일자축·상세축)가 서로 독립인데 순차로 await된다 |
| R170 | medium | 결함 | be/utils/brand-basic-info.ts:54 | 브랜드 학습 모달 저장이 세금계산서 공급받는자(상호·사업자번호)를 권한 확인·형식 검증 없이 덮어쓴다 |
| R171 | medium | 속도 | be/utils/brand-message.ts:1594 | 브랜드메시지 수신거부 필터가 발송마다 그 계정의 수신거부 전량을 LIMIT 없이 읽는다 |
| R172 | medium | 결함 | be/utils/brand-voice-validator.ts:35 | FE0F(이모지 변형 선택자)·ZWJ를 독립 이모지로 잡아서 허용된 이모지(❤️ 등)까지 위반 판정 → 매번 AI 재생성 |
| R173 | medium | 결함 | be/utils/campaign-lifecycle.ts:84 | 예약 정리(cleanupScheduledCampaigns) UPDATE에 status 가드가 없어 동시에 일어난 취소를 completed·failed로 덮어씀 |
| R174 | medium | 결함 | be/utils/campaign-lifecycle.ts:249 | 취소의 '픽업 수'에 성공 코드가 섞여 있어, LIVE에서 결과를 제자리 갱신하는 비토 라인은 전량 발송 뒤에도 alreadySent=false → 대행 접수가 '취소됨'으로 확정 |
| R175 | medium | 헛도는 작업 | be/utils/campaign-lifecycle.ts:597 | target_count(정제 전)가 성공+실패보다 영구히 커서, 수신거부·중복 제외가 있는 캠페인이 7일 동안 5분마다 재동기화·재UPDATE됨 |
| R176 | medium | 데이터 | be/utils/campaign-quick.ts:115 | AI 자동제작 재료 이미지 사본이 uploads/dm-images에 무기한 누적(포기·교체된 업로드 포함) |
| R177 | medium | 속도 | be/utils/campaign-response-attribution.ts:130 | 반응 매트릭스가 창 3개마다 '고객 전체 × 캠페인 EXISTS'와 '전 기간 구매 이벤트 × 캠페인 EXISTS'를 반복 |
| R178 | medium | 결함 | be/utils/campaign-sync-worker.ts:265 | 여정 결과 알림의 '완료 2시간 뒤 대기 포함 발송' 폴백이 절대 실행되지 않아 대기가 남은 여정은 알림이 영구 누락 |
| R179 | medium | 결함 | be/utils/cdp-burst-limit.ts:37 | 버스트 제한이 회사 단위라 브라우저 SDK /ingest가 전 쇼핑객 합산 50건/10초에 막혀 행동 이벤트가 유실됨 |
| R180 | medium | 속도 | be/utils/cdp-diagnostics.ts:85 | 자사몰 진단의 이벤트 누적 COUNT에 기간 하한이 없어 회사의 전 기간 cdp_events를 스캔 |
| R181 | medium | 헛도는 작업 | be/utils/cdp-events.ts:209 | 이벤트 1건마다 고객 프로필을 즉시 재계산하고, 5분 워커가 같은 고객을 또 재계산함 (이중 작업) |
| R182 | medium | 결함 | be/utils/cdp-events.ts:413 | 브라우저 SDK로 들어온 장바구니·페이지 조회는 고객 행(last_cart_add_at 등)에 반영되지 않아, '오늘의 추천'의 장바구니 신호에서 빠짐 |
| R183 | medium | 결함 | be/utils/cdp-fusion-explainer.ts:157 | 자사몰 AI 진단이 모든 오류를 삼키고 '건강도 50점'을 실제 결과처럼 돌려주며, 크레딧 부족·한도 초과도 가려짐 |
| R184 | medium | 개선 여지 | be/utils/cdp-identity.ts:309 | 회원 1명 식별에 쿼리 10여 개와 백그라운드 프로필 재계산(쿼리 6개)이 붙어, 대량 가져오기 부하를 키움 |
| R185 | medium | 속도 | be/utils/cdp-orders.ts:101 | 주문 1건 처리마다 order_id를 JSON 식으로 찾아, 그 회사의 모든 purchase 이벤트를 훑음 (대량 가져오기 때 제곱으로 느려짐) |
| R186 | medium | 결함 | be/utils/cdp-profile-recompute-worker.ts:59 | 30일 장바구니·위시 카운터가 0으로 줄어들지 않아, 오래전에 담은 고객이 인앱 세그먼트에 계속 들어감 |
| R187 | medium | 데이터 | be/utils/cdp-webhook-retry-worker.ts:28 | 웹훅 수신 기록 표가 지워지지 않고 계속 쌓이는데, 재처리 워커는 5분마다 회사 조건 없이 이 표를 세 번 훑음 |
| R188 | medium | 결함 | be/utils/cdp-webhook-retry-worker.ts:55 | 아임웹 웹훅 재처리 때 본문 추출 규칙이 원래 경로와 달라서, 실패한 아임웹 웹훅은 재처리해도 복구되지 않음 |
| R189 | medium | 결함 | be/utils/citations.ts:96 | 근거 인용 문서 조립 쿼리가 없는 컬럼(campaigns.name, status_code)을 읽어 /api/ai/operator/explain이 항상 500 |
| R190 | medium | 개선 여지 | be/utils/company-smtp-client.ts:260 | 이메일 캠페인이 수신자마다 SMTP 연결·TLS·인증을 새로 하고, 회사 SMTP 설정도 매번 다시 조회함 |
| R191 | medium | 결함 | be/utils/connected-content.ts:176 | 날씨 API가 실패하거나 지역을 못 찾으면 '맑음'·'서울'을 실제 값처럼 넣어, 비 오는 날에도 '맑음' 문자가 나갈 수 있음 |
| R192 | medium | 결함 | be/utils/continuous-operator.ts:692 | paused_no_credit 상태는 자동 재개가 불가능한 막다른 상태이고 매분 재선택됨 |
| R193 | medium | 결함 | be/utils/continuous-operator.ts:795 | 고객 통계의 평균 구매횟수·금액이 존재하지 않는 custom_fields 키를 읽어 항상 0 |
| R194 | medium | 결함 | be/utils/continuous-operator.ts:1009 | 다음 회차 생성이 스팸 미통과로 승인 대기 중인 리마인드를 조용히 만료시킴 |
| R195 | medium | 속도 | be/utils/continuous-operator.ts:1439 | 매분 operator_proposals를 인덱스 없이 5번 훑고, 2번은 큰 JSON을 풀어 조건 비교 |
| R196 | medium | 데이터 | be/utils/continuous-operator.ts:1642 | 크레딧 부족 회사의 미정산 제안서를 매분 proposal_json 전체로 다시 씀 |
| R197 | medium | 결함 | be/utils/continuous-operator.ts:1757 | 오퍼레이터 일·월 예산 창이 UTC 기준이라 KST 아침 발송에서 오판 |
| R198 | medium | 결함 | be/utils/continuous-operator.ts:2061 | 수동 승인 발송은 실제 수량·비용을 제안서에 남기지 않아 예산이 과소 집계됨 |
| R199 | medium | 결함 | be/utils/copy-context.ts:89 | 설·추석 시즌 창이 2026년 날짜로 고정되어 2027년부터 실제 명절과 어긋남 |
| R200 | medium | 데이터 | be/utils/customer-cdp-fusion.ts:63 | page_view 이벤트마다 customers 행을 UPDATE해 고객 테이블이 부풀어 오름 |
| R201 | medium | 결함 | be/utils/customer-cdp-fusion.ts:111 | 장바구니·찜 30일 카운터 감쇠 함수가 호출되지 않아 휴면 고객 카운터가 영구히 남음 |
| R202 | medium | 결함 | be/utils/customer-filter.ts:265 | days_within 기준일을 UTC 날짜로 잘라 KST 00~09시에 하루가 더 포함됨 |
| R203 | medium | 헛도는 작업 | be/utils/customer-filter.ts:660 | 필터 호환 래퍼가 호출마다 입력 필터와 SQL·파라미터를 DEBUG 로그로 남김(고객 검색값 포함) |
| R204 | medium | 결함 | be/utils/customer-timeline.ts:995 | 원천 하나만 결과를 낼 때 '더 보기' 커서가 만들어지지 않아 최근 50건 이후를 볼 수 없음 |
| R205 | medium | 결함 | be/utils/customer-upsert.ts:121 | 싱크·업로드 때마다 last_activity_at이 NOW()로 올라가 인앱 '최근 N일 활동' 세그먼트가 오염됨 |
| R206 | medium | 데이터 | be/utils/customer-upsert.ts:191 | 고객 업서트가 값이 같아도 모든 충돌 행을 다시 써서 full 싱크마다 customers 전 행이 재작성됨 |
| R207 | medium | 결함 | be/utils/daily-insight-mailer.ts:89 | 일일 인사이트의 어제 발송·성공·실패가 0으로 하드코딩돼 메일과 성과 화면에 거짓 수치가 매일 표시됨 |
| R208 | medium | 헛도는 작업 | be/utils/direct-send-worker.ts:537 | 직접발송 워커가 할 일이 없어도 5초마다 campaigns 조회 4회를 돌림 |
| R209 | medium | 결함 | be/utils/dm/dm-ab-test.ts:378 | DM A/B 테스트 성과 집계가 실제 열람 데이터를 보지 못해 체류·완독·클릭 지표가 항상 0이거나 무의미함 |
| R210 | medium | 결함 | be/utils/dm/dm-ai.ts:983 | AI 비주얼 디렉터가 회사 브랜드 색을 한 번도 받지 못해 생성 DM 색이 브랜드킷을 무시함 |
| R211 | medium | 헛도는 작업 | be/utils/dm/dm-ai.ts:1079 | 원스텝 생성의 CTA 카피 AI 호출 결과를 버림(생성할 때마다 opus 1회 이상 낭비) |
| R212 | medium | 결함 | be/utils/dm/dm-brand-kit.ts:38 | brand_kit 컬럼 확인이 한 번 실패하면 false로 영구 캐시돼 재시작 전까지 브랜드킷 저장이 조용히 무시됨 |
| R213 | medium | 속도 | be/utils/dm/dm-builder.ts:488 | DM 목록이 페이지 없이 회사 전체 DM의 sections·brand_kit·settings JSON을 매번 가져옴 |
| R214 | medium | 속도 | be/utils/dm/dm-builder.ts:578 | 열람 비콘 경로의 getDmByCode가 15초 하트비트마다 DM 전체 행(SELECT *)을 읽음 |
| R215 | medium | 결함 | be/utils/dm/dm-builder.ts:836 | 수신자 추적 원장이 1000명에서 잘려 발송 깔때기와 학습 지표가 틀림 |
| R216 | medium | 데이터 | be/utils/dm/dm-builder.ts:902 | 열람 하트비트마다 dm_views에 바뀌지 않는 UPDATE가 한 번 더 실행돼 죽은 튜플이 쌓임 |
| R217 | medium | 결함 | be/utils/dm/dm-interaction.ts:308 | 엑셀 사전 당첨자 가져오기를 다시 올리면 당첨자가 중복으로 들어감 |
| R218 | medium | 헛도는 작업 | be/utils/dm/dm-interaction.ts:408 | 추첨 워커가 1분마다 발행 DM 전체의 JSON을 텍스트로 바꿔 LIKE로 훑고, 추첨할 수 없는 DM도 계속 다시 읽음 |
| R219 | medium | 결함 | be/utils/dm/dm-interaction.ts:474 | 마감 추첨이 claim을 먼저 저장하고 나머지를 트랜잭션 밖에서 해서, 중간에 실패하면 추첨이 다시 돌지 않음 |
| R220 | medium | 결함 | be/utils/dm/dm-quick-action.ts:315 | 원클릭 개선·자율 진단이 화면이 읽지 않는 sections 칸만 다뤄서, 결과는 반영이 안 되는데 크레딧은 나간다 |
| R221 | medium | 데이터 | be/utils/dm/dm-recipient-token.ts:104 | DM 수신자 토큰과 열람 행이 보관 기한이나 정리 없이 계속 쌓임 |
| R222 | medium | 속도 | be/utils/dm/dm-viewer.ts:1099 | 공개 DM 열람마다 페이지 수만큼 필드 매핑 조회가 순차로 반복됨(N+1) |
| R223 | medium | 결함 | be/utils/email-channel.ts:143 | SMTP 발신자 이름이 비어 있으면 광고 메일 법정 footer의 전송자 명칭이 플랫폼명 '한줄로AI'로 찍힘 |
| R224 | medium | 결함 | be/utils/email-channel.ts:423 | 발송 선점이 원자적이지 않아 같은 캠페인이 동시에 두 번 발송될 수 있음 |
| R225 | medium | 개선 여지 | be/utils/email-channel.ts:459 | 수신자별 순차 SMTP 발송이 연결 풀 없이 매번 새로 접속하고, 매번 회사 설정을 조회함 |
| R226 | medium | 결함 | be/utils/email-channel.ts:499 | 캠페인에서 지정한 발신자 이름·주소가 실제 From 헤더에 반영되지 않음(법정 footer와 불일치) |
| R227 | medium | 결함 | be/utils/email-channel.ts:504 | 텍스트 본문(text/plain 파트)이 개인화·변수 제거·광고 표기 없이 원문 그대로 발송됨 |
| R228 | medium | 개선 여지 | be/utils/email-channel.ts:517 | SMTP 거부(반송)를 기록하지 않아 반송율이 항상 0이고, 무효 주소에 계속 발송됨 |
| R229 | medium | 데이터 | be/utils/email-channel.ts:609 | email_events가 보관 기한 없이 계속 쌓임(수신자별 delivered + 모든 반복 오픈·클릭) |
| R230 | medium | 속도 | be/utils/email-channel.ts:632 | 오픈·클릭 이벤트마다 캠페인 전체 이벤트를 스캔하는 COUNT가 돌고, 동시 이벤트면 카운터가 빠짐 |
| R231 | medium | 결함 | be/utils/email-send-sweeper.ts:104 | 예약 발송 선점 뒤 수신자 해석이 실패하면 30분 뒤 failed가 되고, 재시도 없이 예약 발송이 누락됨 |
| R232 | medium | 속도 | be/utils/enabled-fields.ts:158 | 캐시 무효화마다 Redis KEYS로 전체 키 공간을 스캔함(싱크 배치마다 호출) |
| R233 | medium | 결함 | be/utils/forecast.ts:24 | 발송 추세 예측이 발송 없는 날을 빼고 회귀해서 기울기와 '다음 동일 기간' 예측이 틀어짐 |
| R234 | medium | 속도 | be/utils/free-messaging.ts:73 | 무료 잔량 식(REMAINING_EXPR)이 인덱스 없는 billing_items를 선불 발송마다 두 번 전체 스캔함 |
| R235 | medium | 결함 | be/utils/free-messaging.ts:222 | recordFreeAttempt가 선불 차감 트랜잭션 안에서 SAVEPOINT 없이 실행됨: 이 함수가 실패하면 발송 차감이 통째로 실패함 |
| R236 | medium | 데이터 | be/utils/full-analysis-runner.ts:84 | 풀분석 PDF가 서버 디스크에 쌓이기만 하고 지워지지 않는다 |
| R237 | medium | 결함 | be/utils/gateway-template-mapping-worker.ts:124 | 54 게이트가 꺼져 있을 때 보류된 54 서버 pending 행이 배치 앞자리를 계속 차지해 58 서버 행이 영영 푸시되지 않을 수 있음 |
| R238 | medium | 헛도는 작업 | be/utils/godo-sync-worker.ts:153 | 고도몰 주기 수집이 30분마다 최근 약 3일 주문 전부를 다시 처리하며, 주문 1건당 UPDATE 5회를 헛돌림 |
| R239 | medium | 결함 | be/utils/grade-conversion-stats.ts:72 | 등급별 전환율의 분모(sent)가 구매 이벤트 수만큼 부풀려져 cvr이 과소 산출됨 |
| R240 | medium | 속도 | be/utils/image-serve.ts:143 | 이미지 변환 캐시 미스 때 같은 파일을 동시에 요청하면 각자 sharp로 변환하고, 요청 경로에서 동기 fs를 씀 |
| R241 | medium | 결함 | be/utils/image-studio.ts:189 | 숨겨 둔 템플릿 프롬프트(scaffold·textStyle)가 소재 라이브러리 API로 고객 브라우저에 그대로 내려감 |
| R242 | medium | 결함 | be/utils/image-studio.ts:214 | 세일 템플릿의 자리표시 문구 '[혜택은 직접 입력해주세요]'가 포스터에 그대로 그려진 채 2크레딧이 차감됨 |
| R243 | medium | 개선 여지 | be/utils/imweb-client.ts:57 | 아임웹 회원·주문 읽기 권한을 받아 두고도 초기 백필을 하지 않아, 연동 직후 고객·구매 이력이 비어 있음 |
| R244 | medium | 결함 | be/utils/imweb-client.ts:231 | 같은 아임웹 siteCode가 여러 회사에 active로 존재할 수 있고, 웹훅은 그중 임의의 한 곳으로 라우팅됨 |
| R245 | medium | 결함 | be/utils/imweb-client.ts:438 | 회원 식별값이 없는 아임웹 주문(비회원 주문 등)은 syncOrder가 예외를 던져 적재되지 않음 |
| R246 | medium | 결함 | be/utils/inapp-ai-generator.ts:702 | AI 응답 JSON 파싱에 실패해도 크레딧은 이미 빠져 있고, 깨진 응답이 5분간 캐시돼 재시도도 같은 실패를 냄 |
| R247 | medium | 결함 | be/utils/inapp-ai-generator.ts:759 | 생성 결과에 trigger_event가 없어 플래너가 만든 인앱은 AI가 고른 트리거와 상관없이 모든 페이지 로드에도 노출됨 |
| R248 | medium | 속도 | be/utils/inapp-display-eligibility.ts:87 | SDK 생존 신호 조회가 기간 제한 없이 회사의 cdp_events 전체를 훑을 수 있음 |
| R249 | medium | 결함 | be/utils/inapp-explainer.ts:227 | 성과 진단 프롬프트가 근거 없는 효과 수치를 사실처럼 주입하고, 생성기 규칙(본문 40~70자)과 정반대인 기준(200~400자 권장)을 줌 |
| R250 | medium | 결함 | be/utils/inapp-funnel-stats.ts:127 | '24h 매핑 매출'이 고객의 클릭 횟수만큼 중복 합산됨 |
| R251 | medium | 결함 | be/utils/inapp-funnel-stats.ts:134 | 인앱 24시간 구매 귀속이 날짜 칸을 자정 시각으로 비교해 당일 구매를 거의 놓치고, 이후 재구매가 생기면 과거 귀속이 사라짐 |
| R252 | medium | 결함 | be/utils/inapp-funnel-stats.ts:289 | 디바이스 분포가 실측 없이 전체 수치를 7:3으로 나눈 만든 값 |
| R253 | medium | 속도 | be/utils/inapp-funnel-stats.ts:402 | 인앱 개요와 회사 평균 CTR 집계가 요청마다 회사의 전체 노출 이력을 훑음 |
| R254 | medium | 속도 | be/utils/inapp-message.ts:1016 | 인앱 목록 화면이 메시지마다 전 기간 통계 쿼리를 따로 날림(N+1) |
| R255 | medium | 결함 | be/utils/inapp-message.ts:1239 | 인앱 서빙의 회원 매핑이 source를 무시하고 customer_id NULL 행도 집어 세그먼트 판정이 흔들림 |
| R256 | medium | 결함 | be/utils/inapp-personalization.ts:415 | 인앱 개인화 변수 추출표가 표준 표기(%고객등급%·%보유포인트%)를 몰라 식별 회원에게 빈칸 표시 |
| R257 | medium | 결함 | be/utils/inapp-variant-optimizer.ts:117 | 변형을 부모로 삼아 변형을 만들 수 있어 절대 노출되지 않는 손자 변형이 생기고 크레딧만 차감 |
| R258 | medium | 결함 | be/utils/inapp-variant-optimizer.ts:404 | A/B 승자 선언이 부모 메시지를 정지시키면 승자 변형까지 전부 노출 중단 |
| R259 | medium | 결함 | be/utils/journey-ai-generator.ts:926 | 날짜축 여정 문안 생성만 AI 혜택 차단기를 거치지 않음 |
| R260 | medium | 속도 | be/utils/journey-ai-generator.ts:960 | 날짜축 여정 자동 생성이 AI 호출 최대 8회를 순차 대기하고 중간 실패 시 앞선 크레딧이 버려짐 |
| R261 | medium | 헛도는 작업 | be/utils/journey-anchor-scheduler.ts:162 | 날짜축 여정이 발송일 동안 30분마다 대상 최대 10만 명을 다시 추출·재삽입 시도 |
| R262 | medium | 결함 | be/utils/journey-stats.ts:233 | 단계·등급별 전환 수가 존재할 수 없는 event_name 'order'를 세서 항상 0이다 |
| R263 | medium | 속도 | be/utils/journey-stats.ts:313 | 등급별 통계가 실행 1건당 한 행씩 전부 내려받고 행마다 cdp_events 상관 서브쿼리 2개를 돈다 |
| R264 | medium | 결함 | be/utils/journey-stats.ts:742 | 실시간 위치가 current_step_order를 '현재 단계'로 잘못 해석해서 1단계 대기 고객이 안 보이고 한 칸씩 밀려 표시된다 |
| R265 | medium | 속도 | be/utils/journey-target-extractor.ts:821 | 미리보기 인원 수를 구하려고 최대 10만 개 UUID를 Node로 가져왔다가 다시 DB로 보내고, 같은 추출을 두 번 돈다 |
| R266 | medium | 속도 | be/utils/journey-trigger-watcher.ts:212 | 일 단위로만 바뀌는 상태형 트리거 추출을 5분마다(하루 288회) 회사 전체 스캔으로 다시 돈다 |
| R267 | medium | 헛도는 작업 | be/utils/kakao-template-sync-worker.ts:49 | 30분마다 IMC 전체 템플릿 목록을 두 번 연달아 페이지 순회하고 페이지마다 로그를 남긴다 |
| R268 | medium | 속도 | be/utils/login-block.ts:104 | 로그인 실패 1회마다 인덱스·보관 정리가 없는 audit_logs를 JSONB 조건으로 카운트한다 |
| R269 | medium | 결함 | be/utils/messageUtils.ts:158 | 잔여 변수 제거 정규식이 '30%할인+10%적립' 같은 정상 문구를 지움 |
| R270 | medium | 결함 | be/utils/voice-inbound.ts:126 | 음성 AI 호출에 companyId가 undefined로 넘어가 회사별 AI 한도·크레딧·통계가 모두 우회됨 |
| R271 | medium | 결함 | fe/pages/AdminDashboard.tsx:13226 | 동기화 설정 모달이 현재 주기 대신 60/30 고정값으로 열려, 저장하면 실제 주기를 덮어씀 |
| R272 | medium | 개선 여지 | fe/pages/Dashboard.tsx:1225 | 대시보드 첫 로딩이 서로 독립인 API 5개를 차례로 await 한다(요청 폭포) |
| R273 | medium | 헛도는 작업 | fe/pages/JourneysPage.tsx:900 | 여정을 펼칠 때 부르는 /stats 응답을 잘못된 모양으로 읽어서 결과를 버리고, 펼칠 때마다 무거운 통계를 다시 돈다 |
| R274 | low | 결함 | be/routes/admin-sync.ts:165 | '오늘' 집계가 CURRENT_DATE(UTC)를 써서 한국 시간 00~09시 동기화가 빠짐 |
| R275 | low | 헛도는 작업 | be/routes/admin-sync.ts:357 | PUT /config의 column_mapping은 아무도 읽지 않는 죽은 경로이고 매핑 검증도 우회함 |
| R276 | low | 결함 | be/routes/admin-sync.ts:362 | PUT /config가 config jsonb 전체를 읽고 고쳐 쓰는 방식이라 heartbeat의 명령 큐 갱신이나 명령 append와 겹치면 덮어씀 |
| R277 | low | 개선 여지 | be/routes/admin-sync.ts:559 | 릴리즈 등록 시 서버에 exe가 있는지 확인하지 않고 기존 활성 릴리즈를 트랜잭션 없이 해제함 |
| R278 | low | 헛도는 작업 | be/routes/admin-sync.ts:675 | GET /agents/:agentId/logs는 소비처 없는 죽은 엔드포인트이고, 되살리면 NULL started_at 행이 맨 위로 옴 |
| R279 | low | 결함 | be/routes/admin.ts:1446 | 회선 상한에 0이나 잘못된 값을 넣으면 오류 없이 '제한 없음'으로 저장됨 |
| R280 | low | 결함 | be/routes/admin.ts:2533 | 발신번호 수정 API가 등록 때의 정규화·중복·회선 상한 검사를 모두 건너뜀 |
| R281 | low | 개선 여지 | be/routes/admin.ts:2962 | 발송통계는 페이지를 넘길 때마다 기간 전체를 다시 집계한 뒤 JS에서 잘라냄 |
| R282 | low | 헛도는 작업 | be/routes/admin.ts:2971 | 발송통계 API가 관리자 화면에서 쓰지 않는 테스트 통계를 매번 계산함 |
| R283 | low | 속도 | be/routes/admin.ts:5328 | AI 학습 현황 조회가 독립된 쿼리 8개를 순서대로 기다리고, 같은 테이블을 여러 번 전체 스캔함 |
| R284 | low | 결함 | be/routes/admin.ts:5885 | 알림톡 템플릿 승인·반려·수동 등록에서 reviewed_by가 항상 NULL로 저장됨 |
| R285 | low | 결함 | be/routes/agency-send.ts:217 | 대행발송 전 엔드포인트의 자격 확인(requireAgencySend)이 try 밖에 있어, DB 오류 때 응답 없이 요청이 매달린다 |
| R286 | low | 개선 여지 | be/routes/agency-send.ts:227 | 접수 목록이 최근 100건으로 고정되고 페이징은 프론트에서만 해서, 101번째 이후 접수는 화면에서 볼 수 없다 |
| R287 | low | 데이터 | be/routes/agency-send.ts:499 | 대행발송 화면 이미지 업로드 파일은 접수가 안 되거나 취소·만료돼도 지워지지 않는다 |
| R288 | low | 결함 | be/routes/ai-memory.ts:214 | 자연어 메모리 검색의 '관련 학습'이 질문과 거의 무관하게 중요도 상위 5건으로 나온다 |
| R289 | low | 개선 여지 | be/routes/ai-usage.ts:335 | 사용량·메모리 자연어 질문에 최고가 모델(opus)을 쓰고, 그 호출이 고객 월 한도에서 차감된다 |
| R290 | low | 헛도는 작업 | be/routes/ai.ts:192 | router.use(authenticate) 뒤에 라우트별 authenticate를 또 걸어 세션 조회가 요청당 두 번 나간다 |
| R291 | low | 결함 | be/routes/ai.ts:320 | '최근 발송 성공 문안' few-shot이 최근순이 아니라 가나다순 상위 10개다 |
| R292 | low | 개선 여지 | be/routes/ai.ts:900 | 대상 수와 수신거부 수를 같은 조건으로 두 번 스캔한다(한 쿼리로 합칠 수 있음) |
| R293 | low | 헛도는 작업 | be/routes/ai.ts:1707 | 프론트 호출이 없는 옛 라우트 5개가 남아 있다(동기 PDF 보고서 등) |
| R294 | low | 결함 | be/routes/ai.ts:1799 | 풀분석 작업이 프로세스 안 setImmediate로만 돌아 재시작 시 'running'에 영구히 멈춘다 |
| R295 | low | 올드 디자인 | be/routes/ai.ts:3021 | 고객에게 그대로 보이는 오류 문구에 내부 은어·DB 지시문이 남아 있다 |
| R296 | low | 결함 | be/routes/ai.ts:3630 | 여정 활성화 전 '매장번호 미등록' 사전 확인이 앞 1,000명만 봐서 인원을 적게 말하거나 놓친다 |
| R297 | low | 헛도는 작업 | be/routes/ai.ts:4054 | 날짜축 여정 [타겟확인]이 같은 추출을 두 번 돌린다(100건 + 10,001건) |
| R298 | low | 결함 | be/routes/ai.ts:4144 | 자동 재진입 토글이 '운영 중 옵션 변경 금지·검증 무효화' 규칙을 우회한다 |
| R299 | low | 속도 | be/routes/ai.ts:5165 | 예측 '지금 전체 재계산'이 회사 전체 계산을 요청 경로에서 동기로 돌리고, 사전 잔액 확인도 없다 |
| R300 | low | 헛도는 작업 | be/routes/ai.ts:5375 | /usage가 화면이 쓰지 않는 월 사용량·캐시 통계를 계산하고, 캐시 통계는 전 회사 합산값이다 |
| R301 | low | 결함 | be/routes/alimtalk.ts:531 | 발신프로필 가져오기(import)의 채널 중복 검사가 사용 중지된 옛 프로필까지 보고 막는다(신규 등록 경로와 정책 불일치) |
| R302 | low | 결함 | be/routes/alimtalk.ts:1297 | 템플릿 등록의 'B3 복구'(4014 중복 키 → 기존 IMC 템플릿 연결) 분기는 조건상 절대 실행되지 않는다 |
| R303 | low | 데이터 | be/routes/analysis.ts:960 | 분석 PDF를 디스크에 쓰고 지우지 않아 pdfs 폴더에 계속 쌓이고, 같은 분석을 동시에 받으면 한 파일에 겹쳐 쓴다 |
| R304 | low | 올드 디자인 | be/routes/analysis.ts:1133 | AI 분석 PDF 리포트가 화면과 달리 차트 없이 텍스트 표뿐이고, 맑은고딕 글꼴에 이모지(💡)를 찍는다 |
| R305 | low | 헛도는 작업 | be/routes/auto-campaigns.ts:997 | 자동발송 라우트 1,018줄이 워커 봉인·화면 제거 뒤에도 그대로 마운트돼 있고, '다음 실행 취소'는 실제로 건너뛰지도 못한다 |
| R306 | low | 헛도는 작업 | be/routes/balance.ts:216 | 무통장입금 요청마다 승인 담당자 전원에게 LMS가 나가는데, 중복 방지는 '같은 금액, 10분 이내'뿐 |
| R307 | low | 개선 여지 | be/routes/billing.ts:2730 | 미리보기 1회에 같은 SMSQ 집계가 2번(브랜드 분기면 3번) 돌고, 화면이 쓰지 않는 필드도 계산한다 |
| R308 | low | 헛도는 작업 | be/routes/billing.ts:3020 | 화면 호출부가 없는 옛 billing_invoices 라우트 6개와 /agent-price-gaps가 남아 있다 |
| R309 | low | 데이터 | be/routes/billing.ts:3247 | 개별 정산서 메일이 검사 전에 PDF를 만들고, 발송하지 않는 경로에서도 파일을 지우지 않는다 |
| R310 | low | 헛도는 작업 | be/routes/cafe24.ts:160 | 실측용 임시 로그 경로(launch-log)가 무인증·무제한으로 계속 동작함 |
| R311 | low | 올드 디자인 | be/routes/cafe24.ts:459 | 카페24 연동 완료·실패 창이 브랜드 없는 기본 카드라 앱 디자인과 동떨어짐 |
| R312 | low | 헛도는 작업 | be/routes/campaigns.ts:503 | 테스트 발송 실패 기록 INSERT가 campaign_id에 사용자 ID를 넣어 매번 FK 위반으로 실패함 |
| R313 | low | 헛도는 작업 | be/routes/campaigns.ts:867 | 캠페인 발송마다 디버그 로그(targetFilter pretty JSON, filterQuery, scheduled_at)를 출력 |
| R314 | low | 결함 | be/routes/campaigns.ts:3227 | 예약 시간 변경 API가 브랜드 발송 가능 시간(08:00~20:50) 검사 없이 전 행을 옮김(화면 미사용) |
| R315 | low | 결함 | be/routes/campaigns.ts:3343 | 예약 문안 수정이 080 조회를 campaigns.user_id로 하고 주소록 필드를 넘기지 않음(화면 미사용 경로) |
| R316 | low | 결함 | be/routes/campaigns.ts:3732 | 브랜드메시지 발송 중 예외가 나면 캠페인이 status='sending'으로 영구히 남음 |
| R317 | low | 결함 | be/routes/cdp.ts:375 | 공개 키로 호출되는 여정 변이 클릭·전환 기록에 중복 방지와 호출 제한이 없어 밴딧 통계를 부풀릴 수 있음 |
| R318 | low | 개선 여지 | be/routes/cdp.ts:587 | SDK 공개 경로 인증이 호출마다 회사·요금제 조회를 반복함, 짧은 캐시 여지 |
| R319 | low | 결함 | be/routes/cdp.ts:693 | 서버 오류(500·503)와 입력 오류(400) 호출도 고객사 월 CDP 한도에 합산됨 |
| R320 | low | 올드 디자인 | be/routes/companies.ts:66 | 문의 알림 메일 템플릿이 그라데이션 헤더 + 이모지 제목의 옛 스타일이고 대체 배경이 없다 |
| R321 | low | 헛도는 작업 | be/routes/companies.ts:125 | /settings 가 인증을 두 번 하고, 같은 companies 행을 4번 따로 읽는다 |
| R322 | low | 헛도는 작업 | be/routes/companies.ts:735 | 회신번호 목록 조회가 요청마다 컬럼 존재 확인용 쿼리를 한 번 더 날린다 |
| R323 | low | 데이터 | be/routes/content-interview.ts:131 | 원스텝 인터뷰 세션이 정리 없이 계속 쌓인다 |
| R324 | low | 헛도는 작업 | be/routes/customers.ts:450 | 호출처가 없는 고객 API 5개가 남아 있다(/fields·/schema·/filter·/bulk, companies /refresh-schema) |
| R325 | low | 결함 | be/routes/customers.ts:1411 | 고객 삭제 3종이 트랜잭션 없이 여러 표를 차례로 지워, 중간 실패 시 격리가 풀린 상태로 남을 수 있다 |
| R326 | low | 헛도는 작업 | be/routes/dm.ts:1067 | 호출처 없는 DM 엔드포인트가 다수 남아 있다(일부는 AI 호출·회사 격리 누락 표면) |
| R327 | low | 개선 여지 | be/routes/dm.ts:1313 | send-to-target이 발행비 차감·발행을 입력 검증보다 먼저 한다 |
| R328 | low | 데이터 | be/routes/dm.ts:1446 | send-to-target의 이른 400 반환이 이미 적재한 staging 행을 남긴다 |
| R329 | low | 결함 | be/routes/dm.ts:1461 | 캠페인 이름·테스트 문자의 날짜·시각이 서버 시간대를 따른다(Asia/Seoul 미지정) |
| R330 | low | 올드 디자인 | be/routes/email.ts:147 | 수신자용 이메일 수신거부 페이지가 브랜드 없이 한줄로 내부 다크·보라 그라데이션 테마로 고정돼 있다 |
| R331 | low | 데이터 | be/routes/event-campaigns.ts:187 | 추적·초안 테이블에 보관 기한이 없다(email_events 오픈마다 1행 · event_campaign_drafts 전체 채널 payload 영구 보관) |
| R332 | low | 헛도는 작업 | be/routes/event-campaigns.ts:256 | 임시 보관 재개 바 목록이 채널 payload 전체를 최대 50건 내려보낸다 |
| R333 | low | 데이터 | be/routes/imweb.ts:64 | 웹훅 수신 원장(cdp_webhook_deliveries) 행이 삭제되지 않고 계속 쌓인다 |
| R334 | low | 올드 디자인 | be/routes/invoice-public.ts:169 | 외부 고객이 보는 오류 안내 화면이 스타일 없는 맨 글자 페이지다 |
| R335 | low | 헛도는 작업 | be/routes/manage-callbacks.ts:45 | 발신번호 목록·범위 변경 때마다 컬럼 존재를 확인하는 스키마 탐침 쿼리가 돈다 |
| R336 | low | 속도 | be/routes/manage-scheduled.ts:31 | 예약 캠페인 목록 limit에 상한이 없다 |
| R337 | low | 결함 | be/routes/mms-images.ts:163 | MMS 이미지 삭제 권한 판정이 존재하지 않는 req.user.role을 본다 |
| R338 | low | 결함 | be/routes/payments.ts:230 | 결제창 닫기 콜백(무인증)이 주문번호만 알면 대기 결제를 취소 상태로 뒤집는다 |
| R339 | low | 속도 | be/routes/results.ts:678 | 캠페인 상세를 열 때마다 cdp_events에서 JSON 속성 조건으로 클릭 수를 셈 |
| R340 | low | 결함 | be/routes/saved-segments.ts:111 | 세그먼트 사용 시각 갱신이 회사·사용자 조건 없이 id만으로 UPDATE |
| R341 | low | 데이터 | be/routes/sender-registration.ts:90 | 발신번호 서류가 검증 실패·등록 실패 때도 디스크에 남음 |
| R342 | low | 결함 | be/routes/sender-registration.ts:119 | 승인된 발신 담당자의 이름·전화번호를 재승인 없이 바꿀 수 있는 PUT(화면 소비처 없음) |
| R343 | low | 데이터 | be/routes/sns.ts:179 | 끝내지 않은 SNS 연결 state 행(PKCE verifier 포함)이 만료 뒤에도 지워지지 않음 |
| R344 | low | 올드 디자인 | be/routes/sns.ts:1093 | SNS 연결 복귀 창이 앱 글꼴(Pretendard)·톤을 따르지 않는 범용 안내 카드 |
| R345 | low | 데이터 | be/routes/sync.ts:533 | heartbeat마다 sync_agents.config JSONB 전체를 다시 씀 |
| R346 | low | 결함 | be/routes/sync.ts:1087 | 싱크 구매 수량·단가·금액 0이 NULL로 바뀜(falsy 처리) |
| R347 | low | 결함 | be/routes/unsubscribes.ts:619 | 발송 전 수신거부 수 미리보기가 번호 정규화를 하지 않아 실제 제외 수와 어긋남 |
| R348 | low | 데이터 | be/routes/upload.ts:187 | 직접발송·주소록용 파싱(includeData) 원본 파일이 응답 뒤에도 최대 약 2시간 디스크에 남음 |
| R349 | low | 개선 여지 | be/routes/upload.ts:265 | AI 컬럼 매핑이 두 벌이고, 고객DB용 /mapping은 회사별 AI 한도·캐시·통계 경로를 우회 |
| R350 | low | 헛도는 작업 | be/routes/upload.ts:962 | 업로드마다 customer_schema를 회사 전체 스캔으로 재계산하지만 그 키를 읽는 소비처가 없음 |
| R351 | low | 데이터 | be/routes/woocommerce.ts:108 | 웹훅 수신 1건마다 cdp_webhook_deliveries 1행 영구 누적(payload만 30일 후 NULL) |
| R352 | low | 올드 디자인 | be/routes/woocommerce.ts:254 | 몰 연동 승인 결과 창이 앱의 새 디자인 체계와 따로 놀고, 3곳에 복붙돼 있음 |
| R353 | low | 결함 | be/utils/account-action.ts:89 | 관리자 경로의 계정 제한 감사 기록은 before가 조치 뒤 상태로 적힘 |
| R354 | low | 데이터 | be/utils/agency-send-mail-worker.ts:989 | 이미 접수된 메일을 이미지와 함께 다시 보내면 저장한 MMS 이미지 파일이 고아로 남음 |
| R355 | low | 헛도는 작업 | be/utils/agency-send-worker.ts:501 | 승인 기한을 이미 놓친 건에도 담당자 테스트 문자(실물·MMS)를 먼저 보낸다 |
| R356 | low | 개선 여지 | be/utils/agency-send-worker.ts:1312 | 대조 워커가 5분마다 최대 200건을 한 건씩 캠페인 조회한다(N+1) |
| R357 | low | 데이터 | be/utils/agent-protocol.ts:76 | 에이전트 명령 결과를 config jsonb에 최대 6MB까지 두고 heartbeat마다 통째로 다시 쓴다 |
| R358 | low | 결함 | be/utils/ai-mapping.ts:130 | AI 매핑 월 쿼터가 확인과 증가 사이에 경합해 한도를 넘길 수 있다 |
| R359 | low | 속도 | be/utils/ai-rate-limit.ts:157 | AI 호출 기록 때마다 월 사용량 캐시를 지워, 다음 호출이 매번 요금제 조회와 월 COUNT를 다시 한다 |
| R360 | low | 결함 | be/utils/alimtalk-ai-matcher.ts:339 | AI 실패 시 키워드 매칭이 캠페인 의도와 무관한 키워드에도 점수를 줘, 엉뚱한 템플릿이 '매칭됨'이 될 수 있다 |
| R361 | low | 결함 | be/utils/alimtalk-jobs.ts:612 | 발신프로필 상태 동기화가 ORDER BY 없이 LIMIT 200이라, 200개를 넘는 프로필은 계속 갱신되지 않을 수 있다 |
| R362 | low | 데이터 | be/utils/alimtalk-webhook-handler.ts:180 | 웹훅 이벤트를 원본 JSON째 영구 저장하지만 이 데이터를 쓰는 곳도 정리하는 곳도 없다 |
| R363 | low | 결함 | be/utils/auto-campaign-worker.ts:921 | (봉인된 경로) 선불 차감 뒤 알림톡 가드 실패·예외 시 환불 없이 종료 |
| R364 | low | 헛도는 작업 | be/utils/auto-campaign-worker.ts:1487 | 영구 봉인된 자동발송 워커가 매분 기동되고 약 1,400줄이 죽은 코드로 남음 |
| R365 | low | 결함 | be/utils/bandit-optimizer.ts:296 | 누적 Bandit 추천에서 현재 제안의 변이 성과가 두 번 더해짐 |
| R366 | low | 헛도는 작업 | be/utils/batch-ai.ts:79 | Batch API 제출 함수가 어디서도 호출되지 않아 ai_batch_jobs가 항상 비어 있음 |
| R367 | low | 결함 | be/utils/best-copy-assets.ts:141 | 업종 공식·스타일 예시 교체가 트랜잭션 없는 DELETE 후 INSERT이고, AI 응답이 깨지면 기존 예시가 전부 사라짐 |
| R368 | low | 결함 | be/utils/billing-issue.ts:107 | 기간 충돌 안내 문구가 PG date(Date 객체)를 String().slice(0,10)으로 잘라 'Wed Jul 01'처럼 연도 없는 영문으로 나온다 |
| R369 | low | 데이터 | be/utils/billing-pdf.ts:227 | 렌더할 때마다 pdfs/에 새 파일이 생기는데 메일 경로는 지우지 않고, 정리 작업·DB 참조도 없다 |
| R370 | low | 헛도는 작업 | be/utils/billing-pdf.ts:658 | 구형 거래내역서(billing_invoices) PDF 생성기·로더가 생성 경로 없이 남아 있고 레이아웃도 구형이다 |
| R371 | low | 결함 | be/utils/billing-recipients.ts:78 | 메일 거부 판정이 부분 문자열 비교라 참조 주소 거부를 대표 수신자 거부로 오판할 수 있다 |
| R372 | low | 결함 | be/utils/cafe24-client.ts:513 | 구형 웹훅 HMAC 서명을 === 로 비교(비상수 시간) |
| R373 | low | 헛도는 작업 | be/utils/callback-filter.ts:155 | 등록 회신번호 조회 때마다 컬럼 존재 확인 쿼리를 한 번 더 보내고, 여정은 수신자 1건마다 회사 전체 번호 집합을 조회 |
| R374 | low | 데이터 | be/utils/campaign-quick.ts:440 | 판독 결과 캐시(buildVisionCache)는 같은 키를 다시 조회할 때만 만료가 지워져 프로세스 수명 동안 계속 커짐 |
| R375 | low | 속도 | be/utils/campaign-sms-export.ts:97 | 발송내역 CSV가 OFFSET 청크라 청크마다 전체 UNION 결과를 다시 정렬 |
| R376 | low | 개선 여지 | be/utils/campaign-sync-worker.ts:430 | 재대조·예약 정리가 캠페인마다 MySQL 집계를 따로 호출(N+1) — 회사별 배치로 묶을 여지 |
| R377 | low | 헛도는 작업 | be/utils/cancelled-queue-sweeper.ts:26 | 1분마다 7일 안에 취소된 캠페인 전부에 대해 전 라인 합집합 MySQL COUNT를 두 번 이상 반복 |
| R378 | low | 속도 | be/utils/cdp-auth.ts:218 | CDP 인증 미들웨어가 요청마다 같은 companies⋈plans를 중복 조회(브라우저 ingest는 매 요청 2쿼리, 캐시 없음) |
| R379 | low | 결함 | be/utils/cdp-auth.ts:426 | 월 한도 합계에 우리 서버 오류(500·503) 호출까지 들어가 고객 월 한도가 소진됨 |
| R380 | low | 헛도는 작업 | be/utils/cdp-events.ts:224 | page_view 등 이벤트마다 인앱 메시지 후보를 조회하는데, 결과는 로그 한 줄에만 씀 |
| R381 | low | 개선 여지 | be/utils/cdp-events.ts:488 | SDK 배치 적재가 이벤트마다 INSERT를 따로 보냄 (최대 100번 왕복) |
| R382 | low | 결함 | be/utils/cdp-profile-recompute-worker.ts:16 | 증분 재계산 상한 2000을 넘은 고객은 '다음 주기에 이어서'가 안 되고 그대로 빠짐 |
| R383 | low | 속도 | be/utils/company-data-profile.ts:212 | 신규 고객 여정 게이트가 5분마다 회사 고객 전체를 EXISTS로 여러 번 훑을 수 있음 |
| R384 | low | 개선 여지 | be/utils/connected-content.ts:262 | 재고·가격·신상품 Connected Content는 아직 빈 껍데기라 재고는 늘 '있음'으로 나옴 |
| R385 | low | 데이터 | be/utils/continuous-operator.ts:986 | 제안서마다 OrchestratorResult 전체를 저장하고 만료·거부분도 지우지 않음 |
| R386 | low | 헛도는 작업 | be/utils/copy-label-sweeper.ts:36 | 30분마다 최근 7일 카카오 캠페인 전체를 MySQL에서 재집계하고, 결과가 같아도 학습 로그를 UPDATE함 |
| R387 | low | 올드 디자인 | be/utils/crm-agency-pdf-render.ts:36 | 고객에게 전달되는 제안서 PDF가 맑은 고딕·보라 체계로 현재 앱(Pretendard·파랑)과 따로 놂 |
| R388 | low | 개선 여지 | be/utils/crm-agency-proposal.ts:114 | 대행 제안서의 플랜별 타겟 실측을 순차 Opus 호출로 처리(HTTP 요청 안) |
| R389 | low | 속도 | be/utils/customer-timeline.ts:1003 | 타임라인 첫 페이지에서 요약 발송 집계·요약·수신거부 확인이 원천 조회 뒤에 순차 실행됨 |
| R390 | low | 올드 디자인 | be/utils/daily-insight-mailer.ts:109 | 일일 인사이트 메일 HTML이 디자인 4.0 체계와 동떨어진 옛 스타일 |
| R391 | low | 결함 | be/utils/daily-insight-mailer.ts:219 | 위저드 상태 행이 사용자별이라 같은 회사에 인사이트 메일이 중복 발송되고, 안내된 수신 거부 메뉴는 존재하지 않음 |
| R392 | low | 올드 디자인 | be/utils/dashboard-card-pool.ts:35 | 대시보드 카드 설정 UI가 lucide 아이콘을 두고도 이모지 아이콘을 표시함 |
| R393 | low | 헛도는 작업 | be/utils/design-core/brand-profile.ts:36 | 브랜드 프로필 조회가 같은 companies.brand_kit 행을 두 번 읽음 |
| R394 | low | 올드 디자인 | be/utils/design-core/template-registry.ts:105 | 정예 골든 템플릿 10종이 전부 시각 승인 전(visual_approved=false)인데 게이트 없이 노출됨 |
| R395 | low | 데이터 | be/utils/dm/dm-builder.ts:295 | DM 버전 1행에 같은 섹션 내용이 세 번 저장됨 |
| R396 | low | 속도 | be/utils/dm/dm-sample-customer.ts:56 | 검수·샘플 렌더 때마다 회사 고객 전체를 정렬 스캔해 샘플 1명을 고름 |
| R397 | low | 올드 디자인 | be/utils/dm/dm-viewer.ts:40 | 레거시(D119) 뷰어가 2016년풍 기성 그라데이션과 이미지 위 카운터를 그대로 씀 |
| R398 | low | 올드 디자인 | be/utils/dm/dm-viewer.ts:742 | 참여형 섹션 결과 문구와 투표 선택 색이 브랜드와 무관한 고정 초록·빨강·보라 인라인 스타일 |
| R399 | low | 결함 | be/utils/dm/dm-viewer.ts:811 | (등재 결함 잔존) 복수 선택 투표에서 선택을 풀면 원래 카드 배경·테두리까지 지워짐 |
| R400 | low | 올드 디자인 | be/utils/dm/dm-viewer.ts:1113 | DM 종료·404 안내 페이지가 이모지 제목과 회색 카드뿐인 기본 화면(브랜드·다음 행동 없음) |
| R401 | low | 개선 여지 | be/utils/email-channel.ts:217 | 이메일 캠페인 목록과 발송 중 3초 폴링이 본문 HTML·sections·target_spec 전체를 싣는다 |
| R402 | low | 개선 여지 | be/utils/email-channel.ts:217 | 캠페인 목록이 SELECT *로 HTML 전문·섹션 JSON·디자인까지 최대 200건을 매번 내려보냄 |
| R403 | low | 올드 디자인 | be/utils/email-channel.ts:321 | 광고 법정 footer가 디자인 카드 밖에 기본 <hr>과 11px 회색 문단으로 붙음 |
| R404 | low | 개선 여지 | be/utils/email-channel.ts:496 | 직접 작성 HTML 캠페인은 고객 데이터가 있어도 {{ customer.X }}를 치환하지 않고 지워 문장이 끊김 |
| R405 | low | 올드 디자인 | be/utils/email/email-tokens.ts:322 | 이메일 기본 버튼이 세로 광택 그라데이션과 컬러 그림자를 쓰는 옛 스타일 |
| R406 | low | 헛도는 작업 | be/utils/expired-pending-sweeper.ts:20 | 48시간 경과분을 찾는 스위퍼가 1분마다 인덱스 없이 bulk 라이브 큐 전 테이블을 전체 스캔함 |
| R407 | low | 속도 | be/utils/full-analysis-collect.ts:39 | 신규·기존 고객 비율 하나를 구하려고 회사의 활성 고객 전부를 메모리로 읽어옴 |
| R408 | low | 데이터 | be/utils/full-analysis-runner.ts:84 | 풀분석 PDF 파일과 job 행을 지우는 경로가 없음 |
| R409 | low | 개선 여지 | be/utils/gateway-template-mapping.ts:419 | 매핑 푸시 검증이 행마다 해당 bill의 매핑 전량을 GET으로 다시 받음 |
| R410 | low | 속도 | be/utils/geo-access.ts:297 | 기계 경로 출발지 판정이 CDP·싱크에이전트 호출마다 예외 대역을 DB에서 조회함 |
| R411 | low | 결함 | be/utils/help-answer.ts:225 | 도움말 일 한도가 UTC 날짜 기준이라 KST 09시에 초기화되고, 캐시 적중 답변도 한도를 소모함 |
| R412 | low | 데이터 | be/utils/image-serve.ts:139 | 원본 이미지를 지워도 .opt 변환 캐시 파일은 남음 |
| R413 | low | 속도 | be/utils/image-studio.ts:44 | 이미지 스튜디오 요청 경로의 동기 파일 I/O(템플릿 샘플 존재 확인 수백 회, temp 폴더 전체 stat, 수 MB 이미지 동기 쓰기) |
| R414 | low | 올드 디자인 | be/utils/inapp-ai-generator.ts:207 | 인앱 생성기에 옛 단색·135° 그라데이션·기본 인디고(#4f46e5) 배색이 남아 있고, AI에게 블록 렌더가 쓰지 않는 색 필드까지 만들게 함 |
| R415 | low | 결함 | be/utils/inapp-explainer.ts:177 | 메시지 CTR(전 기간 누적)과 회사 평균 CTR(최근 30일)을 기간이 다른 채로 비교함 |
| R416 | low | 헛도는 작업 | be/utils/inapp-funnel-stats.ts:276 | 드릴다운 한 번에 같은 메시지 노출 이력을 5~7번 반복 집계함 |
| R417 | low | 결함 | be/utils/inapp-funnel-stats.ts:547 | 식별 고객 총수가 LIMIT 500으로 잘린 행 수라 500명 이상이면 '500명'으로 표시됨 |
| R418 | low | 결함 | be/utils/inapp-segment-matcher.ts:287 | 세그먼트 빈 값 판정과 SQL 조건 생성의 기준이 달라 0값 조건이 익명 방문자를 조용히 제외 |
| R419 | low | 헛도는 작업 | be/utils/inapp-trigger-engine.ts:221 | CDP 이벤트마다 인앱 후보를 DB 조회하지만 결과는 로그 한 줄에만 쓰임 |
| R420 | low | 개선 여지 | be/utils/integration-scope.ts:103 | SDK 수집 배치마다 Origin→분류코드 조회를 DB로 반복 |
| R421 | low | 올드 디자인 | be/utils/invoice-confirm.ts:332 | 같은 거래내역서 메일이 발송 경로에 따라 디자인·브랜드명이 다름 |
| R422 | low | 데이터 | be/utils/invoice-confirm.ts:363 | 거래내역서 메일 발송 성공분 PDF가 디스크에 계속 남음 |
| R423 | low | 데이터 | be/utils/journey-step-campaign.ts:127 | 여정 발송 1건마다 공유 캠페인 매핑을 다시 조회하고 같은 campaigns 행을 다시 쓴다 |
| R424 | low | 결함 | be/utils/journey-step-diagnosis.ts:131 | 진단 완주율이 홀드아웃을 분모에 넣어 통계 화면 값과 어긋나고, AI 추천 프롬프트의 여정 목표는 항상 '재구매 유도'로 고정된다 |
| R425 | low | 결함 | be/utils/journey-target-extractor.ts:338 | 2월 29일생 고객은 평년에 생일 여정에 영원히 진입하지 못한다 |
| R426 | low | 속도 | be/utils/journey-trigger-watcher.ts:357 | 커서 경로 진입은 고객마다 쿨다운 조회와 INSERT를 따로 해서 한 트랜잭션에서 최대 약 2천 번 왕복한다 |
| R427 | low | 결함 | be/utils/kakao-template-sync.ts:51 | IMC 목록 순회가 1만 건에서 조용히 끊겨 그 뒤 템플릿은 상태 동기화가 안 된다 |
| R428 | low | 결함 | be/utils/liquid-templating.ts:461 | Liquid 블록(if·for·case) 안의 assign이 블록 밖으로 전달되지 않는다 |
| R429 | low | 헛도는 작업 | be/utils/makeshop-client.ts:243 | 메이크샵 미리보기가 토큰이 만료된 상태면 토큰을 두 번 새로 발급한다 |
| R430 | low | 올드 디자인 | fe/components/AddressBookModal.tsx:646 | 주소록 그룹 행의 동작 버튼 5개가 각기 다른 파스텔 색과 이모지 아이콘이라 산만하고 구식으로 보임 |
| R431 | low | 올드 디자인 | fe/components/AiMemory/BrandVoiceCard.tsx:333 | 브랜드 학습 모달의 '브랜드 보이스' 탭 안에 독립 카드가 통째로 들어가 헤더 이중화, 카드 안 카드, 4개월째 'NEW' 배지가 남아 있다 |
| R432 | low | 헛도는 작업 | fe/pages/AdminDashboard.tsx:2838 | 정산서 메일 발송 전에 화면이 PDF를 한 번 더 통째로 렌더·다운로드한다(옛 서버 제약의 잔재) |
| R433 | low | 올드 디자인 | fe/pages/AiUsagePage.tsx:474 | AI 사용량 화면이 운영자 화면 통일 규칙(메뉴 안 = slate-950 단색 + 바이올렛 액센트만)을 벗어나 여러 색 그라데이션 면을 쓰고, 고객에게 원시 DB 이름을 보인다 |
| R434 | low | 올드 디자인 | fe/pages/DmBuilderPage.tsx:691 | DM 편집기 AI 추천 액션 바가 이모지 아이콘과 네온 그라데이션을 써서 제품 디자인 규율과 맞지 않음 |
