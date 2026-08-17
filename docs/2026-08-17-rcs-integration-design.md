# RCS 연동 설계서 — 한줄로(대행사 모델) + 비토 게이트웨이(젬텍 NGS RCS)

> 작성 2026-08-17. 브레인스토밍 회의(기획·프론트엔드·디자이너·백엔드·회의론자 전원, 교차 반박 1라운드 + 회의론자 최종 검증) 수렴 결과.
> 근거 규격 = 젬텍 NGS RCS API 연동 규격서 V2.0.2 (2025-12-17) 전문 실독 + 양 레포 소스 실측.
> 상태 = **Harold님 검토 대기.** 승인 전 코드 수정 없음.

---

## §0. 한 줄 요약과 목표

한줄로가 **RCS Biz Center(RBC) 대행사**로 등록하고, 브랜드는 **고객사가 직접 소유**한다. 발송은 비토 게이트웨이 `gemtek_rcs` 커넥터 → 젬텍 NGS RCS API. RCS 실패 건은 게이트웨이의 기존 대체발송 축으로 문자 재발송한다.

목표 수준(Harold 확정) = **"젬텍 계정 아이디만 나오면 바로 실연동 가능한 상태"**. 단, 실연동 증명 경로는 clientapi 1건 실측이고, 화면·에이전트 경로는 파일럿 단계로 분리한다(§7).

## §1. 확정 사실 (전부 실독·실측 — 추측 0)

### 1-1. 젬텍 규격 v2.0.2

| 축 | 사실 |
|---|---|
| 인증 | `POST /v2/auth` JWT(clientId/clientSecret/grantType=clientCredentials) → accessToken + grant_server 헤더. expiresIn 초, 만료 전 재인증 |
| 발송 | `POST /v2/message` — chatbotId(발신번호, RBC 사전등록)·userContact·clientMsgId(Max40 unique)·messagebaseId·header("0" 정보성/"1" 광고)·expiryOption(1=1일 default/2=40초/3=3분/4=1시간)·copyAllowed·**brandKey(대행사 고객 필수)**·**agencyId/agencyKey(대행사 고객 필수, 불일치 시 통신사 실패)**·groupId·osc·body·buttons |
| body | title(LMS 30자)·description(SMS 100/LMS 1300/MMS 총합 1300, carousel small 30·medium 60, 텍스트 템플릿 90, 이미지 템플릿 500)·media(`maapfile://{fileId}`)·카드 복수 시 title1/description1/media1 suffix |
| buttons | GSMA RCC.07 suggestions 6종 — dialerAction/composeAction/urlAction/calendarAction/clipboardAction/mapAction |
| 통합 RCS | **iOS 26+ 아이폰 지원.** messagebaseId RP\* 계열(RPSSAXX001/RPLSAXX001/RPMSMMX001/RPMSMTX001). **프리 템플릿 = 브랜드 생성 시 자동 발급**(텍스트 발송은 템플릿 심사 0). header 항상 "0"·footer 미사용·copyAllowed 항상 false → **"(광고)"와 080 무료수신거부를 본문에 직접 삽입**. 이미지 PNG/JPG만 |
| 파일 | `POST /v2/file` multipart, fileId=`{brandId}.{userCode}`, messagebaseId별 규격 validation, 1MB, RCS용 D+365 |
| 웹훅 | 젬텍→우리 POST, 배열 1~100건 `{result,message,clientMsgId,sn,telco,timestamp}`. 응답 `[{result:1000,sn}]` 아니면 재전송. `54002 = No Rcs Capability` |
| **대체문자** | **API에 필드 없음 — RCS 실패→SMS 전환은 전적으로 우리 구현** |
| RBC Open API | 대행사가 브랜드/발신번호/템플릿 생성·조회·수정·삭제 가능 (apidocs.rcsbizcenter.com/rbc-api) |
| 개통 | 브랜드(고객사 개설·심사 1~3영업일) → 대행사 지정 → 챗봇=발신번호(010 불가·업체당 5개·가입증명서) → 템플릿(선택) |
| 계정 조건 | TPS·월 발송량 협의 + **접속 IP 등록** + **Webhook URL 등록**. 에러코드는 별첨 xlsx(미보유) |
| STG/PRD | `ngsrcs-dev.gmgo.co.kr:8403` / `ngsrcs.gmgo.co.kr:8403` |

### 1-2. 현재 코드 실측 요약

- **한줄로**: `rcs_templates` CRUD만 존재(발송·과금·결과 0). 슈퍼관리자 수기 승인 = RBC와 무관한 가짜 게이트. 직접발송 RCS 분기는 dead 선언됐으나 **LMS 차감+발송 0의 돈 사고 경로가 잠복**(§9-②).
- **게이트웨이**: `gemtek_rcs` 커넥터 골격만(6필드 전송·WriteState 미설정·테스트 0). msg_type 축 전 소비처에 RCS 부재 = 진입 불가. **웹훅 이중 바인딩 결함**(§3-4). 카카오 실패→문자 대체발송 기계는 가동 중이며 재사용 가능(§3-5).
- **거짓 안내 운영 중**: "RCS 미지원 단말은 SMS로 자동 폴백" 문구가 화면 3곳에 노출 중 — 대체 기계가 없으므로 현재 거짓(§9-①).

## §2. 모델 — 대행사·브랜드·개통

### 2-1. 소유 구조 (Harold 확정)

| 개념 | 소유 | 한줄로가 하는 일 |
|---|---|---|
| 브랜드 | **고객사** (RBC에서 직접 개설) | 개설 링크+준비물 안내. 개설 자동화 불가 |
| 대행사 권한 | 한줄로 (고객사가 RBC에서 지정) | 지정되면 RBC Open API로 브랜드 목록 폴링 → **brandKey 자동 수집** |
| 챗봇(발신번호) | 브랜드 종속 | Open API로 **생성 대행**. 가입증명서 업로드는 기존 발신번호 동선 재사용 |
| 템플릿 | 브랜드 종속 | 통합 프리 템플릿 = 자동 발급(심사 0). 서식형은 P3에서 Open API CRUD |
| agencyId/agencyKey | 한줄로(전 고객사 공통) | 게이트웨이 `bind_account.connection_config`에 보관 |

### 2-2. 상태 동기화 원칙 (fail-closed)

- RBC 심사 상태는 `rbc-sync-worker`(kakao-template-sync-worker 동형)가 폴링으로 따라간다. **우리 DB의 approved는 증명이 아니다**(알림톡 §2-5 "외부 기준 차집합" 교훈).
- 워커 가동 전까지 화면은 **'심사중' 외의 상태를 표시하지 않는다.**
- **수기 승인 버튼(admin.ts:4623~)은 워커보다 먼저 제거**하고, 제거 커밋에 기존 `status='approved'` 행을 되돌리는 UPDATE를 동반한다(회의론자 Q5).
- `provider_status`+`provider_synced_at`을 우리 `status`와 **별도 컬럼**으로 둔다(§4-3) — RBC 상태를 우리 상태에 덮으면 승인 템플릿 수정 게이트가 꼬인다.

## §3. 게이트웨이 설계

### 3-1. msg_type 축 = `rcs_sms` / `rcs_lms` / `rcs_mms` 3유형

- 단일 `rcs` 불가(과금 CASE가 msg_type 단위 단가) · `rcs_tpl` 미신설(템플릿은 과금 단위가 아니라 payload 필드 — 카카오 brand_basic/free 분할이 치른 비용이 반례). 카드형은 `rcs_mms`의 payload 변형(messagebase_id로 구분).
- 단가 유형 분화 방향: **3→1 합치기는 표시 계층에서 무손상, 1→3 쪼개기는 이력 재구성 불가 + legacy CASE 분기 영구 잔존**(047의 kakao_brand 실증). 따라서 3으로 시작.
- proto enum은 **append-only**: `RCS_SMS=10, RCS_LMS=11, RCS_MMS=12`. `connector/types.go` iota도 끝에 append + **proto↔iota 대조 테스트 신설**(현재 우연히 일치하는 상태).

### 3-2. 소비처 등재표 (전수 — 하나라도 빠지면 그 증상까지 명기)

| # | 위치 | 조치 | 누락 시 증상 |
|---|---|---|---|
| 1 | `proto/bito/v1/bito.proto:117-128` | enum append 10~12 | 컴파일 실패(즉시 드러남) |
| 2 | `connector/types.go:104-142` | iota+String() append + 대조 테스트 | proto와 조용히 어긋남 |
| 3 | `connector/capability.go` 4함수 | rcs 3키 + `gemtek_rcs` provider case | 전량 차단(default false) |
| 4 | `tps/category.go` | `rcs` 카테고리 | BAD_TYPE 종결 |
| 5 | `tps/limiter.go:136-145 getLimit` | `case "rcs"` | 한도 0 → 후보 전탈락 → 무한 재큐잉(원인 로그 불명) |
| 6 | **TPS 축 확장 4곳(회의론자 N2)** — `connector/types.go:96 TPSLimits` 필드 + `engine.go:770·792` + `connector_session_monitor.go:77·102` INSERT + 해당 테이블 DDL | RCS TPS 필드 신설 | "발송이 안 나가는데 에러 없음" |
| 7 | `queue/dispatcher.go:37-49` | rcs lane | QUEUED 행을 아무도 claim 안 함 — **로그 0** |
| 8 | `migrations/025` | rcs partial index | lane 쿼리 전체스캔 |
| 9 | `migrations/047 CASE:138-158` | rcs 3분기 + 단가 컬럼(§3-6) | `no_price` 차단(안전하나 사용자 불명) |
| 10 | `clientapi/server.go:588 unitPrice` | 3분기 | API 경로만 400 |
| 11 | `agent/fieldmap/mapper.go:777~` | pb 3종 (P2) | 에이전트 거절 |
| 12 | `agent/config/config.go:882 supportedMsgTypeKeys` | 3키 (P2) | config 검증 실패 = **에이전트 기동 불가** |
| 13 | `engine/router.go:500-504·585-589` | provider×category 화이트리스트에 `gemtek_rcs`/`rcs` 추가 | 후보 0 |
| 14 | `migrations/027·028` 결과코드 레지스트리 | `(gemtek_rcs, rcs_*, 'RC', raw)` 등재 | 고객 결과코드 매핑 전량 미스 |
| 15 | `resultcode.go:55-64 reportSuccessCodes` | **RCS 종결 성공코드 등재** | **도달 성공 전량 실패환불 + 대체문자 중복 발송**(최대 위험) |
| 16 | `engine/validator.go:50` | 빈 message 거절 조건에 RCS 카드형 예외(rcs_payload 본문 허용, 회의론자 N3) | 카드형 입구에서 영구 입력 오류 |
| 17 | `session/grpc_server.go:719 msgTypeToString` | 수정 불요 — 미인식 enum→빈 문자열→해당 건만 거절이 정상임을 확인만 | — |

⚠ **결과코드 이중 소유 금지(회의론자 N1)**: `provider_result_code_map`(027)은 **표시·매핑용**이고 이를 읽는 Go 판정 코드는 0건이다. 성패 판정의 유일 소유자는 `resultcode.go`다. 이 문서와 `resultcode` 패키지 doc comment에 명문화한다 — 레지스트리의 `is_success`만 고치고 판정을 고쳤다고 믿는 사고를 막는다.

### 3-3. `gemtek_rcs` 커넥터 재작성 (덧대기 아님 — 규격 v2.0.2 기준 재작성)

**요청 조립**
- 필수·선택 필드 전부: `brandKey`·`agencyId`·`agencyKey`·`buttons`(GSMA 6종)·`body.media`·`expiryOption`·`groupId`·`copyAllowed`·`osc`.
- **brandKey 공급원 = `agent_account`/`sender_account` 신규 컬럼**(게이트웨이가 발송 직전 주입). 에이전트·clientapi 둘 다 brandKey를 몰라도 된다. ⛔ bind config에 두면 한 브랜드로 전 고객사가 발송된다 / 에이전트 payload_map에 걸면 컬럼 부재 시 조용히 누락된다.
- **agencyId/agencyKey = `bind_account.connection_config`**(전 고객사 공통 자격).
- `messagebaseId` 하드코딩(SS000000/SL000000/SMwThT00) **삭제** → payload 공급 + config의 통합 RCS 기본표(RP\*). **빈 값 = 발송 거절(fail-fast, 회의론자 N5)** — 빈 값으로 내보내면 통신사 단 실패인데 우리 로그에 근거가 안 남는다.
- `header`는 payload에서(광고 "1"/정보성 "0"). 통합 RCS는 항상 "0"이되 (광고)·080은 한줄로가 본문에 삽입(§5-3).

**payload 운반**
- `message_request.rcs_payload jsonb` **신설**. ⛔ `kakao_payload` 재사용 금지 — `report.go`의 소비 키가 전부 `kakao_*`라 grep이 샌다(별칭 은폐).
- 스키마: `{"brand_key","messagebase_id","header","expiry_option","copy_allowed","group_id","osc","buttons":[...],"media":["maapfile://..."],"fallback_msg_type","fallback_message","fallback_title"}`
- `report.go loadRequest` SELECT에 `rcs_payload` 편입 + **fallback 판정 함수(`report.go:456-470`)가 rcs_payload도 읽도록 일반화**(회의론자 N6 — 안 하면 대체발송 설정을 영영 못 읽는다).

**응답·상태**
- **WriteState 5개 반환 경로 전부 설정**: `result==1000`→`SendAccepted` / 명시 거절→`SendRejected` / CONN·READ_ERR→`Unknown`. 현재 zero값 방치로 엔진이 전건 격리 — **계정이 나와도 0건인 첫 번째 원인.**
- `resp.StatusCode` 확인(5xx HTML이 PARSE_ERR·Retryable:false로 오판되는 결함 제거).
- `messageResponse.Amount`(젬텍 선불 잔액) → SendResult 편입 → opsAI 경보 축.

**경계 규약(명문화)**
- **ACK 경계 = 정규화(1000→"0")** — ClassifyAck 성공 집합이 {0,0000}이므로 규약상 맞다.
- **REPORT 경계 = 원문 보존** — "0"으로 접으면 결과코드 매핑이 원시 코드를 잃는다.
- 이 "경계마다 다른 규약"이 존재한다는 사실 자체를 커넥터 doc comment에 적는다(브랜드메시지 §4-4의 교훈은 "다른 것"이 아니라 "다르다고 적혀 있지 않은 것"이었다).

**파일 업로드**
- `POST /v2/file`은 **커넥터 밖** — 템플릿·소재 등록 시점에 한줄로 백엔드가 호출(발송 임계 경로에 1MB 업로드 금지). 커넥터는 `maapfile://{fileId}` 문자열만 받는다. fileId 유효기간 D+365 → `rcs_templates.file_expires_at`으로 추적.

**테스트(현재 0 → 최소 5)**
① brand_key 누락 시 발송 전 거절 ② messagebaseId payload 공급 + 빈 값 거절 ③ WriteState 4경로 ④ description 길이 상한(100/1300/30·60) ⑤ buttons JSON 라운드트립. + 요청 바디 골든 스냅샷.

### 3-4. 웹훅 — 단일화 + 인증 (계정 발급 전 필수 수정)

**현재 결함(실측)**: 웹훅이 둘이다.
- `cmd/gateway/main.go:326-397` — 무조건 :4404에 기동, 결과를 **로그만 찍고 버린 뒤 1000 ACK**(TODO 주석 그대로). 젬텍은 성공으로 알고 재전송하지 않는다 = **결과 영구 유실**.
- `gemtek_rcs/webhook.go` — 규격 준수(durable 저장 후 ACK). 커넥터가 config 포트에 기동.
- 같은 포트면 커넥터 기동 실패(영영 ACTIVE 안 됨), 다르면 젬텍 등록 URL이 어느 쪽이냐로 무증상 유실.

**처방**
1. main.go 인라인 웹훅 **삭제**. 커넥터 webhook.go 한 벌만. 포트·경로의 유일 원천 = `bind_account.connection_config`.
2. 인증 3단: **IP 허용목록**(connection_config, `RemoteAddr` 기준, 허용목록 비면 전량 거절 = fail-closed) + **고엔트로피 webhook_path**(`/v2/report/{32자}` — 코드 변경 0) + 거절 시 **401**(저장·ACK 없음). 위조 성공=과금 확정, 위조 실패=대체문자 실발송 — 둘 다 돈이 움직이므로 무인증 불가.
3. ReportType `"RC"` 상수 유지 + 027/028 등재(레지스트리 조회 키에 report_type 포함).
4. 배치 부분 실패 처리: 규격이 건별 result를 허용하는지 젬텍 확인 후 건별 ACK로 개선(현재 중간 503 시 배치 전체 재전송 — 멱등이라 안전하나 반복 시 배치가 안 끝남).

### 3-5. 대체발송 — 기존 축 재사용 (신설 0)

- 기계는 이미 있다: `report.go` 판정 + `attempt_role='fallback'` + 부모-자식 유니크 + **부모 환불→자식 차감 결속**(순 1건 과금) + report_queue replay. 채널 종속은 3곳뿐:
  1. `report.go:426` `kakao_` 접두 게이트 → **채널 중립 CT** `IsFallbackEligibleMsgType`으로
  2. `:964·967` 라벨 → 채널별(`RCS_FALLBACK_*`)
  3. `:982` fallbackSuccessCode → RCS 전용 코드
- `fallback_msg_type`은 **한줄로가 payload에 반드시 명시**(기본 판정이 EUC-KR 90바이트 축이라 1300자 RCS LMS가 sms로 잘린다 — fail-open 금지).
- 발신번호 동일 조건은 구조적 보장(부모 callback 승계 = chatbotId와 동일 값). 단 **RCS 발신번호가 게이트웨이 `sender_number` 화이트리스트에 등재**돼 있어야 대체 자식이 살아나간다 → 개통 체크리스트 항목.
- `54002 No Rcs Capability` = 즉시 대체(재시도 대상 아님 — `isRetryable` 편입 금지). RCS 대체발송은 카카오와 달리 **예외가 아니라 상시 정상 경로**다.
- **expiryOption: 광고성 = 3(3분) / 정보성 = 4(1시간).** `finalIsAd`로 자동 결정, 사용자에게 묻지 않음. 근거 — 1(1일)은 어제 할인이 오늘 도착 / 2(40초)는 읽을 수 있던 RCS까지 이중 발송 / 4를 광고에 쓰면 21시 발송 실패→22시 대체문자가 야간 광고 제한(autosend-policy) 위반.
- **무리포트 타이머 신설 안 함** — Indeterminate에서 발송을 여는 장치 = 중복 수신+이중 과금(Verdict 설계를 무력화). 대신:
  - 젬텍 서면 확인(§8): "expiryOption 만료 시 실패 리포트를 주는가". 안 주면 그때 재설계(영구 미종결 건이 생기므로).
  - `detectDeliveredStale`에 RCS 임계 5분 별도 경보(관측만, 상태 불변경).
- **paystats 분기(회의론자 N4)**: fallback 자식 단가 매핑이 현재 KS/KL(카카오 전환) 고정 — RCS 자식은 SMS/LMS 단가 분기 추가. **반드시 P2 파일럿 첫 적재 이전에**(UPSERT 키 이동은 옛 행을 안 지워 이중 청구 — 적재 행 0 시점에만 안전).

### 3-6. 과금 축 (게이트웨이)

- `reseller.default_price_rcs_sms/_lms/_mms` + `billing_plan.price_rcs_*` — **nullable · DEFAULT 없음 · NOT NULL 없음**(047:25-28 패턴 복붙 금지 — "미설정"이 15원 계약으로 위장된다).
- 047 CASE에 3분기. 값 NULL이면 `no_price` fail-closed 유지 = **실측 전 발송 불가가 컬럼이 아니라 값으로 달성**된다. 실측 후 UPDATE 한 줄.
- legacy 분기 0 · 유령 유형 0 · 이력 정정 0.

### 3-7. 라우팅 능력 축 — 이번 트랙에서는 **하드코딩에 추가만**

- 회의론자 판정 수용: provider×category 화이트리스트 3벌(`router.go` 2 SQL + `capability.go:87`)을 `provider_capability` 테이블로 내리는 것은 **전 채널 라우팅 공용 CT 수정**이라 scope_discipline §3(공용 컴포넌트 금지) 위반. RCS 1건도 안 나간 상태에서 기존 3채널 회귀 위험.
- 이번 트랙 = 3벌 각각에 `gemtek_rcs`/`rcs` 케이스 추가(4벌째를 만드는 게 아니라 기존 3벌에 한 줄씩). **[추가 과제] provider_capability 테이블화**는 기록만 하고 착수하지 않는다(§10).
- `bind_account.msg_category='rcs'` — varchar(10)·CHECK 없음 확인, DDL 불요.

## §4. 한줄로 설계

### 4-1. 발송 경로

- **P0·P1 = clientapi 직결**(게이트웨이 `POST /internal/v1/messages`). 이유 — 아이디가 나온 날 실연동을 증명할 수 있는 유일 경로(에이전트 실측은 RCS 브랜드 보유 고객사가 필요한데 현재 0개사).
- **에이전트 경로 = P2**(회의론자 Q2 수용). 근거 실측 — `config.go:632-635` 미지원 msg_type 키 = config 검증 실패 = **에이전트 기동 불가**(그 라인의 SMS·알림톡까지 정지). 역순 배포 사고 방지를 위해 **게이트웨이 먼저 → 에이전트 나중** 순서 강제.
  - 최소 계약은 성립 확인: `static_msg_type`(라인 고정 지정, msg_type 컬럼 없는 고객사 DB 선례 실재) + phone/callback/message/title만. `validateRCSFieldContract` 신설.
  - 「RCS 고객사 DB 표준 컬럼 규격서」 작성·협의는 P0에서 **착수**하되 임계 경로에서 제외(외부 합의 리드타임은 우리 통제 밖).
- **no_price 피드백 경로(회의론자 Q3-a)**: 후불 회사는 한줄로 차감 게이트를 안 지나므로(billing_type≠prepaid 즉시 통과) 게이트웨이 no_price가 화면까지 와야 한다. clientapi 응답의 오류를 한줄로 라우트가 받아 **"RCS 요금이 설정되지 않았습니다 — 관리자에게 문의"** 사용자 메시지로 변환한다. "접수 성공·실발송 0" 상태 금지.

### 4-2. 과금 (한줄로 측 — 3중 등재, 하나라도 빠지면 §의 증상)

| 지점 | 조치 | 누락 시 증상(실측) |
|---|---|---|
| `companies.cost_per_rcs_sms/_lms/_mms` + `company_agent_ids` 동형 | DDL(nullable) | — |
| `unit-price.ts MESSAGE_TYPE_PRICE_COLUMN` | `RCS_SMS/RCS_LMS/RCS_MMS` 3키 (**단일 'RCS' 키 금지** — 3단 단가가 뭉개짐) | `unknownType:true` → **경고만 내고 0원 통과 = 무제한 공짜 발송**(0726 사고 재현) |
| `billing-types.ts BILLING_TYPES` | 3행, `smsqCode:null`(SMSQ 안 탐), MMS 뒤·KAKAO 앞 배치, 라벨 「RCS 단문/RCS 장문/RCS 이미지」 웹·에이전트 동일 | 청구서 발행 차단 또는 조용한 0원(파일 헤더 명기 사고 2건) |
| **`prepaid.ts` SELECT 3곳(:132·:296·:444)** | `cost_per_rcs_*` 컬럼 명시 추가 | `companyRow[col]=undefined` → `unset:true` → **값을 채워도 전건 차단 + 환불 경로 동사** |
| `resolveRefundAxes` | rcs 축 편입 | RCS 실패분이 환불에서 조용히 누락 |
| `unit-price-invariants` 테스트 | `cost_per_rcs_*` SELECT 포함 검사로 확장(현재 unit_price_basis만 검사 — Q3-c를 기계가 못 잡음) | 재발 방지 없음 |
| `unit-price.ts` 헤더 "축 6개" 주석 | 같은 커밋에서 갱신 | 주석이 잔존 원인 |

- **이중 과금 고지**: 발송 전 다이얼로그 3줄 — `RCS n건 × 단가` / `미지원 단말은 문자로 재발송되며 별도 과금` / `대체문자는 최대 3분 후 발송`(숫자 명시). 건수 추정치는 지어내지 않는다 — "건수는 결과에서 확인".

### 4-3. DB — `rcs_templates` 확장 + 개통 상태

`rcs_templates` 추가 컬럼: `brand_key varchar(100)`(⚠ 기존 `brand_id`와 **다른 축** — brand_id는 fileId 접두, brand_key는 발송 필수 파라미터. 합치지 않는다) · `chatbot_id` · `messagebase_id` · `header` · `expiry_option` · `file_id` + `file_expires_at`(D+365) · **`provider_status` + `provider_synced_at`**(우리 `status`와 별도 — RBC 축).

개통 상태 원장(신규 테이블 또는 companies 확장 — 구현 시 information_schema 확인 후 확정): 회사별 브랜드 연결 상태(brand_id·brand_key·위임 상태·심사 상태·last_synced_at)와 챗봇 목록(업체당 5개 전제). **RCS 개통 게이트 컬럼**(카카오 `kakao_enabled` 동형)으로 미개통 회사의 발송 진입 차단.

### 4-4. RBC Open API 연동

- 브랜드 목록 조회(위임 수락 감지→brandKey 수집) / 챗봇 생성·조회 / 템플릿 CRUD(P3) / 심사 상태 폴링.
- `rbc-sync-worker` — kakao-template-sync-worker 동형. 주기 폴링 + 반려 사유 수집.
- **[실측 게이트]** 대행사 권한으로 위임 **전** 무엇이 가능한지 미확인(§8) — 위임 전 화면은 링크 안내만.

### 4-5. 멱등·중복

- clientMsgId = **NGSSerial 재사용**(20자리 시퀀스 < Max40, 전역 유일). 별도 규약 금지 — 웹훅 Serial 매칭이 깨진다.
- 한줄로→게이트웨이 멱등키 = `source_seq`, **재사용 불가 값**(`캠페인런ID:수신자ID`).
- 웹훅 재전송 멱등은 기존 장치로 충분(IS DISTINCT FROM 가드 + enqueueReportOnce).

## §5. 화면 설계

### 5-1. 정보 구조 (수렴)

- **헤더 메뉴 불변** — '카카오&RCS' 라벨·개수 유지.
- **KakaoRcsPage의 RCS 탭 = `/rcs` 링크 탭**(탭 자체가 navigate — 관문 카드 금지=클릭 1회, 라벨 'RCS'+이탈 아이콘, 복귀는 `goBackOr`). 에이전트 전용 회사 영향 0(그 회사엔 탭 미렌더 기존 분기). 이 작업에서 **3탭의 죽은 동적 클래스**(`border-${tab.color}-500` — safelist 부재로 현재 무효)를 함께 정정한다.
- **`/rcs` 신규 다크 페이지**: 개통 스테퍼 + 작성기 + 템플릿. 발송결과는 신설하지 않고 기존 발송결과 화면에 RCS 축 편입(§6).
- **직접발송 헤더 [RCS] 버튼 = navigate**(모달 아님 — 주재자 판정: 작성기 단일 렌더 문맥 + 개통 게이팅 일원화 + DirectSendPanel 1645행 비대화 방지). **이동 확인 조건 = 본문 OR 수신자 존재**(회의론자 Q1 — 본문만 보면 5만 명 업로드가 사각). staging 후 navigate는 허용하지 않는다(stagingId가 URL·storage에 없어 고아 5만 행 발생 — DELETE가 발송 경로에만 있음). 미개통 회사는 같은 버튼이 개통 화면으로.
- DirectSendPanel **채널 탭 부활 금지**(3자 일치 — kakaoMessage 공유 state 회귀).
- 막다른 안내 2곳(DirectSendPanel:1058·TargetSendModal:732 "RCS 템플릿에서 등록해주세요" 텍스트) → 실제 링크로.

### 5-2. 톤·액센트 (확정)

- 베이스 = **`bg-slate-950` 플랫**(최신 신규 트랙 플래너와 동일 + 하한 표 일치). violet 그라데이션은 AI 계열 표식이라 채널 화면에 상속 금지.
- 액센트 = **`from-sky-500 to-indigo-500`**(sky/cyan 계열 9회 점유 실측 회피). 현행 RCS purple 폐기(violet과 한 칸 차이로 AI 계열과 혼동).
- 상태 색 분리: 대기 amber / 승인 emerald / 반려 rose. 헤더 `bg-slate-900/70 backdrop-blur sticky` 표준.
- 프레임 규칙 신설: **미리보기 폰 프레임 밖 = slate 다크, 안 = 밝은 단말색.** 프레임 안에 입력 컨트롤을 넣지 않는다(흰 패널 다크 상속 사고 축). 흰색 명도 5단위 사다리·비활성 투명도 집합 등 토큰 불변식 준수.

### 5-3. 작성기

- 좌 에디터 / 우 sticky 320px 미리보기(브랜드메시지 문법). **판정 배지**("이 메시지는 RCS LMS로 나갑니다 · 1,300자 중 412자 · 버튼 3개 중 1개")는 미리보기 상단(결과의 언어), **카운터**는 에디터 쪽(입력의 언어).
- 포맷 자동 판정(SMS↔LMS↔MMS 자동 승격 — 직접발송 계약 동일). messagebaseId를 사용자에게 고르게 하지 않는다.
- **(광고)+080 = 본문에 실제 삽입**(잠금 표시 + 글자수 카운터 포함 + "통신사가 자동으로 붙이지 않아 본문에 포함됩니다" Tip 1줄). ⛔ 문자 작성기의 오버레이 방식 복사 금지 — RCS에서는 거짓 표시가 되고 사용자가 100자를 다 쓰고 거부당한다. 합성은 기존 CT(`prepareSendMessage`·`getOpt080Number`·`buildAdMessageFront`) 재사용 — AI 문안 경로의 "(광고)·080 미포함, 시스템 부착" 계약 유지.
- **변수 비중 게이지** — "텍스트 대부분이 변수면 반려" 조항의 사전 차단. 임계 초과 시 등록 버튼 옆 경고.
- **카드형(캐러셀) = 별도 토글**(자동 판정 세그먼트와 분리 — 데이터 구조가 다름). JourneyStepStudio식 인덱스 스튜디오(도트 네비+좌우 이동, 드래그 정렬 없음). 도트 미완성 amber 링 — 판정은 `rcs-spec.ts` 단일소스. 2~6장 경계에서 추가/삭제 버튼 **미렌더**(흐림 금지). 미리보기는 전체 가로 슬라이드(편집은 1장, 확인은 6장) + 편집↔슬라이드 인덱스 동기.
- **비파괴 전환 계약**: 일반→카드형 = 제목·본문·이미지·버튼을 카드1로 이관 + 원문 `plainDraft` 보관 / 카드형→일반 = plainDraft 복원 + `cardDraft` 유지. 지우는 게 없으므로 확인 모달 없음. 저장 버튼 옆 "저장은 지금 모드만(보관 초안 N건)" 1줄.
- **이미지 = 업로드**(URL 입력 폐지 — 규격 검증 불가). 선택 즉시 1MB·3규격(900×560/900×900/900×1200) 판정 + 리사이즈 제안. 비율은 **캐러셀 단위** 선택(한 캐러셀 내 혼용 불가). 6장 업로드는 5초+ → 로딩 차단 오버레이. 실패 시 항목별 정직 피드백 + 수동 경로 병설.
- 버튼 편집 = GSMA **6종 전부**(전화/메시지전송/URL/캘린더/복사/지도 — 현행 4종에 메시지전송·캘린더 누락). 캘린더는 시작/종료/제목 3필드.
- 검증 단일소스 = `utils/rcs-spec.ts`(포맷 판정·길이·버튼 수·이미지 규격) + backend 미러 계약 테스트(campaign-axis 선례). 화면은 판정을 직접 계산하지 않는다.
- 수신자별 치환 검산 테이블은 모달 유지(상시 3단이 4단이 되는 것 방지).

### 5-4. 개통 스테퍼

- **2축 분리 표시**(알림톡 「승인」/「상태」 2컬럼 선례): 위임 축(미연결/위임요청/수락됨 — 고객사가 움직임) + RBC 심사 축(미제출/접수/심사중/승인/반려+사유 — 외부가 움직임).
- 각 단계 **소유자 텍스트 배지**: `내 차례` / `한줄로 처리 중` / `RBC 심사 중`(색만으로 구분 금지).
- **진행률 바·예상 완료 시각 금지**(외부 심사를 우리가 계산하면 거짓 표시). 표시는 사실 3개 — 접수 시각 · 경과일("심사 2일째") · `last_synced_at`("마지막 확인 3분 전"). "통상 1~3영업일"은 정적 참고 문구로만.
- 심사 대기 중 화면이 죽지 않게 — **"지금 할 수 있는 다음 일: 첫 메시지 초안 써두기"를 병렬 개방**(템플릿 작성은 발신번호 승인과 독립).
- 반려 = 사유 + 그 자리에서 고치는 버튼(배지로 끝내지 않음).
- 선행 단계 미충족 시 다음 단계는 흐림이 아니라 **안내 카드로 대체**(누를 수 없는 버튼 미렌더 원칙).
- 상태 로드 = 진입 1회 + 60초 주기 + visibilitychange 복귀 동기화. 못 센 카운트는 0이 아니라 null.
- 가입증명서 첨부는 기존 발신번호 서류 동선(CallbacksTab) 재사용.

### 5-5. 폐기·정리

- `RcsTemplateFormModal.tsx` **전량 폐기**(버튼 4종·2개 상한·카드형 부재·URL 미디어·거짓 아이폰 안내·라이트 모달 — 살릴 것은 RcsButton 데이터 형태뿐).
- KakaoRcsPage 인라인 확인 모달·인라인 토스트 → 공용 ConfirmModal·useToast로.
- 신규 페이지는 lazyPage + 난독화 exclude 확인(0718 청크 사고 계열).

## §6. 발송결과·통계

- `campaign-axis.ts` + `billing-types.ts` **미러 양쪽**에 rcs 등재 + 계약 테스트(안 넣으면 RCS가 'LMS'로 표시 — 브랜드메시지 사고 재발 자리). `results.ts` 허용목록 **3곳**(587·723·956).
- **집계 저장소 제3축 유의**: 한줄로 기존 집계는 QTmsg MySQL 축, RCS는 게이트웨이 PG 축 — 집계 산식을 먼저 열고 발송을 켠다("요약 0 / 상세 정상" 재발 방지).
- 응답 필드 9종(화면 계약): `send_channel('rcs')` / `channel_label` / `rcs_message_format(SMS|LMS|MMS|MMS_CARD)` / `delivery_channel_final` / `is_fallback`+`fallback_reason` / 부모-자식 관계(`parent_message_id`) / 요약 4값(`rcs_attempted/rcs_delivered/fallback_sent/rcs_reach_rate`) / `brand_id·brand_name` / `template_id·template_status_at_send`.
- 표시: 캠페인 **1행 유지** + `RCS 성공 N · 대체문자 M · 실패 K` 3축 칩, 상세는 부모-자식 2행 접기(요약은 부모 기준 1건 — 안 하면 발송 건수 2배 집계). 비용은 분리 표기(`RCS 단가×N + 문자 단가×M` — 합치면 청구서와 다르게 읽힘).
- **fail-closed 렌더**: 대체 관련 필드가 응답에 없으면 폴백 칩을 그리지 않고 "확인 중" 단일 칩.
- 도달률·대체율 추정치 금지 — 실측 축적 전에는 "결과에서 확인".

## §7. 티켓 분할·Phase (회의론자 Q4 수용 — 7티켓 + 선행 1)

| 순서 | 티켓 | 내용 | 게이트 |
|---|---|---|---|
| 선행 | **T0. 즉시 정정 3건**(§9) | 별도 세션. RCS 트랙과 분리(롤백 단위 오염 방지) | — |
| P0-1 | T1. WriteState + 웹훅 단일화·인증 | §3-3 상태·§3-4 | 계정 없이 완결 |
| P0-2 | T2. TPS·능력 축 | §3-2 #3~8·13(하드코딩 추가만 — 테이블화 제외) | `capability_test`·`category_test`의 rcs 거절 줄을 뒤집는 커밋 = 진입 커밋. T1·T3~T4와 같은 PR 흐름으로 |
| P0-3 | T3. msg_type 소비처 등재 | §3-2 #1·2·9·10·14·15·16 | proto↔iota 대조 테스트 |
| P0-4 | T4. 과금 축 | §3-6 + §4-2 전체(3중 등재+SELECT 3곳+환불+테스트 확장) | 값 NULL = fail-closed |
| P0-5 | T5. 커넥터 재작성 + 테스트 | §3-3 | 테스트 5+ |
| P1 | 실측 대본(코드 0줄·30분) | ① `/v2/auth` curl ② **성공 리포트 1건 원문 캡처(최상위)** ③ messagebaseId 발급 목록 서면 ④ brandKey·agencyId 필수 여부 서면 ⑤ 에러코드 xlsx | §8 게이트 해소 |
| P2-1 | T6. 대체발송 개통 | §3-5(paystats 분기는 **첫 적재 이전**) | P1 성공코드 확정 후 |
| P2-2 | T7. 화면(§5) + 발송결과(§6) + RBC 워커(§4-4) | 파일럿 1개사 개통 | — |
| P2-3 | 에이전트 경로 | §4-1(supportedMsgTypeKeys·validateRCSFieldContract·배포 순서 강제) | 고객사 DB 규격 합의 후 |
| P3 | 서식형 템플릿 CRUD·심사형·버튼 고도화 | RBC Open API | — |

- **화면(T7)을 P0에서 뺀 이유**: "아이디만 나오면 실연동"의 증명은 clientapi 1건이지 화면이 아니다. 화면 하나가 세션 여러 개 규모라 P0에 넣으면 P0가 무한히 커진다(회의론자 Q4). 설계는 본 문서 §5가 전부 소유하므로 착수 시 재설계 없음.
- 젬텍 요청 사항(계정과 함께): STG 계정 / 접속 IP 등록(.65) / Webhook URL 등록 / 에러코드 xlsx / "만료 시 실패 리포트 여부" 서면 / "웹훅 건별 ACK 허용 여부" 서면.

## §8. 실측 게이트 (미검증 — 이 항목들이 확정되기 전에 해당 코드를 확정하지 않는다)

1. **RCS 종결 성공 코드**(최상위 — 미등재면 도달 성공 전량 실패환불+중복 발송)
2. brandKey·agencyKey가 우리 계정 형태에서 실제 필수인지
3. RP\* 통합 messagebaseId가 우리 계정에 열리는지
4. expiryOption 만료 시 실패 리포트 발생 여부(미발생이면 타이머 재설계)
5. PRD TLS — IP 직접 URL이면 인증서 SAN 확인(STG는 되고 PRD만 깨지는 형태)
6. RBC Open API 대행사 권한 범위(위임 전 가능 작업)
7. `messageResponse.Amount`·젬텍 단가표(프리/서식 단가 갈리면 4번째 유형 검토)
8. 웹훅 건별 ACK 허용 여부

## §9. 즉시 정정 3건 (T0) — **2026-08-17 구현 완료 · 배포 대기**

착수 시 실측으로 **범위가 설계보다 넓어졌다.** ②의 원인이 `'rcs'`라는 값이 아니라 **채널 검사의 부재**였고
(`sendChannel: '아무값'`이 똑같이 통과했다), 같은 구멍이 진입점 **3곳**에 있었다. 그래서 값을 지우는 대신 축을 세웠다.

**① 허위 폴백 문구 — 전수 정정 완료(5곳)**
설계가 적은 3곳 외에 발송 화면 2곳이 더 있었다. `KakaoRcsPage.tsx:240` · `RcsTemplateFormModal.tsx:140`(문구 교체) ·
동 `:257-261`(대체발송 안내 블록 삭제 — "아이폰 미지원"까지 이중으로 거짓) · `DirectSendPanel.tsx` · `TargetSendModal.tsx`(죽은 분기와 함께 제거).

**② 돈 사고 잠복 경로 — 화이트리스트 축 신설 + 게이트 4곳**
- 실측된 구멍(전부 `차감 실행 → 적재 0건 → 응답 성공`):
  `POST /campaigns/direct-send`(campaigns.ts) · `POST /campaigns/direct-send/commit`(direct-send-core → direct-send-processor) · `POST /campaigns` → `POST /campaigns/:id/send`
- **CT 신설** `billing-types.ts` — `SEND_CHANNELS`(sms·both·kakao·kakao_brand·alimtalk) + `isSupportedSendChannel()`. 순수 추가라 기존 소비처 0 변경.
  ⛔ 이 함수는 `trim()`을 하지 않는다 — 적재 분기가 원문을 비교하므로 게이트만 다듬으면 `' sms '`가 통과하고 적재가 빗나가 **게이트가 같은 사고를 새로 만든다**(자가 적대 검토에서 발견·정정).
- **게이트 4곳**(전부 차감·캠페인 INSERT보다 앞) + 거절 시 서버 로그 기록(4xx 무흔적 금지 원칙).
- **프론트 죽은 분기 제거** — `Dashboard.tsx`(페이로드 생성·유니온 타입 리터럴·템플릿 로더·prop 전달) · `DirectSendPanel.tsx`(props·destructure·RCS 블록·매핑 안내) · `TargetSendModal.tsx`(props·RCS 블록).
- **계약 테스트 신설** `send-channel-axis.test.ts`(8건) — 목록에 적재 경로 없는 채널을 넣으면 빨간불 / 목록 밖 값으로 분기하면 빨간불 / 게이트 4곳 존재 / 차감 CT가 자체 판정을 갖지 않음. **역주입 검증 완료**(`rcs_lms` 임시 추가 시 정확한 사유로 실패하는 것을 확인 후 원복).

**③ 수기 승인 — UI·endpoint 폐기 완료**
`admin.ts` approve·reject endpoint 삭제(조회는 유지) · `AdminDashboard.tsx` RCS 승인·반려 버튼 제거 + 핸들러를 알림톡 전용으로 축소(`rejectModal`의 채널 축 제거).
**남은 것 = 기존 `status='approved'` 행 되돌리기(§9-1).** 이걸 해야 "우리가 아는 상태는 검수중뿐"이 성립한다.

### §9-1. Harold님 실행 SQL (배포 후)

먼저 영향 건수를 본다.

```sql
SELECT status, COUNT(*) FROM rcs_templates GROUP BY status;
```

그 결과에 `approved`가 있으면 되돌린다(발송 경로가 없어 운영 영향 0 — 표시만 정정된다).

```sql
UPDATE rcs_templates
   SET status = 'pending', approved_at = NULL, reviewed_at = NULL, reviewed_by = NULL, updated_at = NOW()
 WHERE status = 'approved';
```

### §9-1-A. Codex 적대검토 1R 수용 결과 — **축을 다시 세웠다** (2026-08-17)

1차 시도(전역 화이트리스트 + 불리언 검사)는 `needs-attention`을 받았고 **지적 4건을 전부 실측으로 확인해 수용**했다.
넷이 다른 문제로 보였지만 뿌리는 둘이었다.

| # | 지적 | 실측 확인 | 처방 |
|---|---|---|---|
| critical | 전역 목록이 **문마다 다른 처리 능력**을 못 본다 | `/direct-send`엔 `kakao_brand` 적재 분기가 없는데 BRAND로 차감 / `/:id/send`엔 **알림톡 적재 자체가 없다**(`insertAlimtalkQueue` 호출 0건) | `PIPELINE_SEND_CHANNELS`(direct·campaign·brand)로 분리 |
| high | 배열이 게이트를 통과한다 | `String(['sms'])==='sms'`로 통과 → 적재 분기 `=== 'sms'`엔 빗나감. `[]`는 빈값으로 보이는데 `[] \|\| 'sms'`는 빈 배열 | 불리언 검사 폐기 → **resolver**가 정규화 값을 돌려주고 호출부가 그 값만 사용. 비문자열 전부 거절 |
| high | AI 추천이 과금 유형으로 그대로 들어간다 | `recommended_channel`을 '카카오'만 걸러 받음 → `RCS` 등이 `messageType`이 되고 단가표에 없어 **0원 통과**(무료 발송), 큐에는 LMS로 적재 | `CHARGEABLE_MESSAGE_TYPES` + `resolveChargeMessageType` 신설(입구 확정) · 프론트 `normalizeAiMessageChannel` CT + 유니온 타입 |
| medium | 계약 테스트가 거짓 통과 | 텍스트 검색이라 **다른 라우트**의 `'kakao_brand'` 리터럴에 걸려 통과 | 라우트 **구간별** 대조로 재작성(19건) |

**자가 검토로 추가 발견·정정 2건** — ①`/campaigns/:id/send`의 게이트가 `campaign_runs` INSERT 뒤였다(§9-3의 4번째 사례가 될 뻔했다) ②`/direct-send`의 `isAlimtalkSend`가 게이트보다 **앞에서 원본**을 읽고 있었다. 둘 다 게이트를 라우트 앞머리로 올려 닫았다.

**함께 정리된 죽은 코드** — `/:id/send`의 알림톡 제목 검증 예외 분기(D224+, 2026-05-27). 게이트가 알림톡을 막으므로 도달 불가가 됐다. 남기면 다음 사람이 그 경로가 산다고 믿는다.

### §9-1-C. Codex 적대검토 2R 수용 결과 — **보상·종결 계약을 전 경로로 넓혔다** (2026-08-17)

2R도 `needs-attention`이었고 **critical 1 · high 2를 전부 실측 확인해 수용**했다(라운드 상한 = 2회, 3R 없음).
1R 정정이 **조기 return 경로만** 덮고 예외 경로·나머지 입구를 빠뜨린 것이 공통 원인이다.

| # | 지적 | 실측 확인 | 처방 |
|---|---|---|---|
| critical | 예외 경로가 실행 행도 보상도 안 한다 | 안쪽 `catch`는 `deductType` 축만 환불하고 `campaign_runs`를 안 건드림(→ 잠금). `both`는 BRAND 축 차감이 남음. **최상위 catch는 아무것도 안 함** | 안쪽 catch = `resolveRefundAxes`로 **축별 환불** + `failCampaignRun` / 최상위 catch = 실행 행 id를 밖으로 올려 종결 |
| high | 환불 실패가 성공으로 지나간다 | `prepaidRefund` 반환 타입이 `{refunded, ok}` — **던지지 않고 `ok:false`로 돌아온다**(tsc가 확인해 줌) | 결과 확인 + `markRefundPending` 등재(같은 파일 직접발송 경로 선례와 동일 CT) |
| high | 직접발송이 여전히 무과금 유형을 받는다 | `directDeductType`이 원본 `msgType`을 그대로 씀 → `sms` + `RCS`면 0원으로 나감. commit 경로도 동일 | 두 문에 `resolveChargeMessageType` 게이트 + 차감·위임에 **확정 값** 사용 |
| medium | 계약 테스트가 여전히 존재 검사 | **앞 분기의 종결 호출이 뒤 분기를 가려 준다**(내 구현 실측) | 거절 **사이 구간**으로 판정하도록 교체 + 예외 경로·환불 결과·게이트 순서·원본 재사용 검사 추가(22건) |

⚠ **high #2는 내 1R 정정이 만든 회귀였다.** 잠금을 푼 것 자체는 옳지만, 그 전까지는 잠금이 재시도를 막아 이중 청구를 **우연히** 막고 있었다. 잠금을 풀면 미수 등재가 함께 있어야 한다.

**강화한 테스트가 또 잡은 것** — 최상위 catch가 미종결이었다. 지적을 코드로만 받지 않고 테스트로 옮긴 덕에 4번째 경로가 드러났다.

**미착수(medium — SoT 등재만)** = Codex 권고인 "요청 단위 오케스트레이션 테스트(영속·과금·큐 어댑터 모킹)". 소스 스캔보다 강하지만 별도 축의 투자라 §10에 남긴다.

### §9-1-B. Harold님 실행 SQL — 기존 데이터 영향 확인 (배포 후, 하나씩)

게이트가 서면 **기존 행 중 목록 밖 값**은 발송 시 400을 받는다(차감 없이 막힌다 = 의도된 동작). 실제로 그런 행이 있는지 먼저 본다.

```sql
SELECT send_channel, message_type, COUNT(*) FROM campaigns GROUP BY send_channel, message_type ORDER BY 3 DESC;
```

그리고 이미 잠긴 캠페인이 있는지 — 실행 행은 남았는데 실적이 0인 것(§9-3 결함의 피해 실측).

```sql
SELECT cr.campaign_id, cr.id AS run_id, cr.status, cr.created_at
  FROM campaign_runs cr
 WHERE cr.status IN ('sending','scheduled')
   AND COALESCE(cr.success_count,0) = 0 AND COALESCE(cr.fail_count,0) = 0
   AND COALESCE(cr.sent_count,0) = 0
   AND cr.created_at < NOW() - INTERVAL '1 day'
 ORDER BY cr.created_at;
```

여기 나온 행이 곧 "발송이 잠긴 캠페인"이다. 정정 배포 뒤에는 새로 생기지 않으며, 기존 행은 아래로 푼다.

```sql
UPDATE campaign_runs SET status = 'failed', completed_at = COALESCE(completed_at, NOW())
 WHERE status IN ('sending','scheduled')
   AND COALESCE(success_count,0) = 0 AND COALESCE(fail_count,0) = 0 AND COALESCE(sent_count,0) = 0
   AND created_at < NOW() - INTERVAL '1 day';
```

### §9-2. 검증 결과 (2026-08-17)

`tsc --noEmit` backend 0 · frontend 0 / backend vitest **171 파일 2,591건 전량 통과**(신규 계약 22건 포함).

잔존 grep — `sendChannel: 'rcs'` 0건 · 죽은 채널 분기 0건(남은 `'rcs'` 문자열은 템플릿 관리 탭 식별자뿐) ·
**게이트 뒤 원본 재사용 0건**(`resolveSendChannel` 4곳, 그 뒤 `sendChannel` 원본 참조 없음).

계약 테스트는 **역주입으로 실제 적중을 확인**했다 — 적재 분기 없는 채널(`rcs_lms`)을 목록에 넣으면 1건,
파이프라인에 `alimtalk`을 넣으면 3건이 각각 정확한 사유로 실패하고, 원복하면 전량 통과한다.

## §9-3. 착수 중 발견한 별건 — **캠페인 발송 조기 return이 실행 행을 남겨 캠페인을 영구 잠근다** (미착수·Harold 판단)

게이트를 `campaign_runs` INSERT 앞으로 올리다가(§9-② 자가 정정) **같은 부류의 기존 결함 3건**을 전수 스캔으로 확인했다.
`POST /campaigns/:id/send`는 실행 행을 먼저 만든 뒤 실패할 수 있는 검사·차감을 하는데, 그 조기 return들이 **행을 정리하지 않는다.**

| 지점 | 상황 | 결과 |
|---|---|---|
| `campaigns.ts:902` | 카카오 미활성 403 | `campaign_runs` `status='sending'` 잔존 |
| `campaigns.ts:909` | 선불 잔액 부족 402 | 동일 |
| `campaigns.ts:934` | `both` 브랜드 차감 실패 402 (차감은 되돌리나 실행 행은 그대로) | 동일 |

잔존 행은 `campaigns.ts:845`의 중복 발송 방지 검사("이미 발송이 진행 중")에 걸려 **그 캠페인의 이후 모든 발송을 영구 차단**한다.
잔액이 부족해 한 번 막힌 캠페인은 충전한 뒤에도 못 보낸다는 뜻이다.

**뿌리** = "되돌릴 것을 먼저 만들고, 그 뒤에 실패할 수 있는 일을 한다"는 순서. 같은 진단이 이미 `campaigns.ts:802`(D93)에 있고 그때는 한 건만 앞으로 옮겼다.
**처방 방향**(둘 다 필요) — ①카카오 활성 검사는 run INSERT 앞으로 이동(값이 그 시점에 다 있다) ②차감 실패 경로는 실행 행을 종결 상태로 전이(단순 DELETE는 이력이 사라진다 — 전이 규약·sweeper·재발송 UX 영향 확인 필요).

⛔ **이번 세션에서 고치지 않았다.** RCS 접수 축 밖이고, 실행 행 생명주기를 건드리므로 별도 축이다(`scope_discipline_one_ticket_axis` §4). 착수 판단은 Harold님 몫.

## §10. 추가 과제 (이번 트랙 범위 밖 — 기록만)

- **발송 라우트 요청 단위 오케스트레이션 테스트**(Codex 2R medium) — 영속·과금·큐 어댑터를 모킹해 입구별로 "거절 전 상태 변경 0 · 정규화 값 전파 · 모든 4xx/5xx/throw 출구 · 축별 보상"을 검사한다. 지금의 소스 스캔은 그 계약을 근사할 뿐이다.
- **알림톡 직접발송의 차감 축 확인** — `directDeductType`이 알림톡에서 `msgType`(LMS)로 떨어진다. `cost_per_kakao`가 따로 있는데 의도된 것인지 미확인. 돈 축이라 실측 없이 건드리지 않았다.

- provider_capability 테이블화(라우팅 능력 축 하드코딩 3벌 해소) — 전 채널 공용 CT라 별도 트랙.
- 웹훅 배치 건별 ACK 개선(젬텍 서면 회신 후).
- `no_price` 게이트웨이 오류의 한줄로 화면 노출 체계 일반화(브랜드·카카오에도 동일 적용 검토).
- STATUS.md:75 "비토 API 발송 경로 전환 검토"(지속 항목) — RCS clientapi가 첫 사용자가 되므로 그 실측이 이 검토의 입력이 된다.

## §11. 뒤집힌 판단 기록 (경위 보존)

| 시점 | 판단 | 뒤집힌 근거 |
|---|---|---|
| 구 문서(CHANNEL-EXPANSION.md:46) | "미지원 단말 자동 SMS/LMS 폴백" | 규격 v2.0.2 실독 — 대체문자 필드 없음. 우리가 만든다(아카이브 원문은 불변, 본 문서가 정정 소유) |
| 아이톡비즈 가이드 | "RCS 전송실패(아이폰 사용자)" | 통합 RCS(2025-12) — iOS 26+ 지원. 가이드가 구버전 |
| 회의 1R 기획 | KakaoRcsPage 탭 유지 | 탭 활성색이 이미 죽어 있음(safelist 부재) + 4축이 탭 한 칸에 불가 → 철회 |
| 회의 1R 기획 | 단가 1유형 시작 | 1→3 쪼개기가 이력 재구성 불가(047 실증) → 3유형+NULL 선등재 |
| 회의 1R 백엔드 | "에이전트 경로 먼저 열지 마라" | static_msg_type 최소 계약 성립 → 병행 가능. 단 회의론자 실측(config 검증 실패=기동 불가)으로 **P2 배치** |
| 회의 1R 백엔드 | "54002가 Indeterminate로 fallback 안 열림" | 실독 — 비공백 미등록 코드는 Failure. 철회. 진짜 위험은 **성공 코드 미등재** |
| 회의 1R 백엔드 | "빈 컬럼이 no_price 무력화" | 값 기준 판정이라 nullable이면 유지 → 철회 |
| 회의 2R 프론트 | 직접발송 [RCS] 버튼 = 모달 | 주재자 판정 navigate(단일 렌더 문맥·개통 게이팅·패널 비대화). 이동 확인 조건은 본문+수신자(회의론자) |
| 수렴안 G | provider_capability 테이블화 포함 | scope_discipline §3 위반(공용 CT) → 추가 과제로 분리 |
