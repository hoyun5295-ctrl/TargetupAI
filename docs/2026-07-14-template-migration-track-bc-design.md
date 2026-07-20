# 템플릿관리자 이관 설계 — Track B(이관·계정) + Track C(게이트웨이 연동)

> 작성: 비토 / 2026-07-14 / 상태: **설계안 (구현 전 Harold 승인 필요 — 6원칙 ⑥)**
> 상위 SoT: `docs/레거시서버_폐기_플랜.md` (§2-3·§4-3·Track B/C)
> 형제 문서: [자비스 지시서](2026-07-14-jarvis-gateway-template-spec.md) · [강문희 제안서](2026-07-14-legacy-template-api-proposal-kang.md)

## 1. 확정 사실 (근거 문서)

| 사실 | 근거 |
|---|---|
| 알림톡 senderkey 공식 경로 = 중계서버 매핑관리, 우선순위 최상위 | QTmsg 매뉴얼 p.8~9 (방법1, KMS만 해당) |
| k_etc_json senderkey는 매뉴얼상 친구톡용 문서화 — 알림톡 적용은 강문희 확인 대기 | 매뉴얼 p.8 / 강문희 제안서 §4-2 |
| 매핑의 실체 = senderkey 세팅 + 코드 치환(외부→인비토) + 출중계 라우팅(외부모듈) | 구성안 1안 존재사유 + 매핑 스크린샷 컬럼 |
| 필드 정본 = `k_template_code` / `k_etc_json`.`senderkey` (PPT의 k_templ_code·senerkey = 오타) | 매뉴얼 그림1·p.8 |
| 매핑 최상위 우선 → 낡은 매핑이 새 senderkey를 이김 → 자동 파이프라인은 upsert 필수, DELETE는 수동만 | 매뉴얼 p.8 + 0611 사고 교훈 |
| 통과 템플릿 4,299 = B_(휴머스온) 3,290(76%) / bizp_(다우) 791(18%) / 업체지정 218(5%) | 서팀장 엑셀 실측 2026-07-14 |
| 회사 51(테스트 1 제외 50) / 발신프로필 242(휴면 4 = 전부 더화이트 산하) | 발신프로필 엑셀 실측 |
| 더화이트 = 155프로필 리셀러 단일 관리계정 귀속(서팀장 확인) / 시세이도 = 4브랜드 1계정 | 서팀장 회신 6번 + 엑셀 |
| 브랜드 가시성 방침: 고객사 관리자 = 전체 열람, 각 브랜드 = 자기 브랜드(sender_key) 템플릿만 | Harold 확정 2026-07-14 |
| 게이트웨이 매핑은 143 미참조(엔진 자체 저장) → 기존 매핑은 143 폐기와 무관 | 서팀장 회신 2번 |
| 결과코드 감시 지표 = 7103/7105/7106/7204/7315 | 매뉴얼 p.17 |
| ★0715 소스 확인: 발신프로필 카톡인증 등록(token+등록+승인 워크플로+슈퍼관리자 타사 귀속)·검수 알림(kakao_alarm_users CRUD+승인/반려 SMS 발화)·승인 감지(웹훅 IP/HMAC+5분 폴링+1h sender sync)·getSender = 전부 운영 중 코드 | alimtalk.ts:156/178/293/2232 · alimtalk-jobs.ts:706 · alimtalk-api.ts:218 |
| ★0715 소스 확인: 템플릿 조회 = 회사 전체 노출 정책(2026-07-04 Harold) — 브랜드(sender_key) 열람 스코프 **미구현** = 이 프로젝트의 유일한 진짜 신규 개발 | alimtalk.ts:605 |
| 친구톡 = 카카오 공식 폐지(브랜드메시지 전환) — 레거시 친구톡 템플릿 이관·실사용 확인 불요 | Harold 2026-07-15 |
| ★0715(2) 실측: 아난티 getSender 0000·@아난티·A = **같은 휴머스온 계정 확정**(관문 1 통과). alimtalk:false는 정상 운영 인비토도 false = 무의미 값. IMC 목록 = [hasNext,total,templateList]·item에 senderKey+profile.senderKey 존재·total 4,904 | 본 세션 curl 실측 2026-07-15 |
| ★0715(2) 실행: import 2종 구현·배포 + 아난티 파일럿 pull 847건(APPROVED 827·KREJ 20·failed 0·중복 0·재카운트 일치). **엑셀 497 vs IMC 실측 827 — 서팀장 집계 기준 확인 대기** | POST /senders/import·/templates/import 실행 결과 |
| ★0715(3) Harold 확정 — **다우기술 중계 축 신설**: 제이씨패밀리·유성소프트 2사 = 다우로 프로필·템플릿 기 구축 + 휴머스온 적용 불가 → 다우 고정(bizp_ 축의 실체). 결정 = ①중계사(휴머스온/다우)는 고객사 절대 미노출 ②슈퍼관리자에서 회사별 지정(기본 휴머스온·지정 업체만 다우) → 등록·검수 요청이 지정 중계사 API로 발신 ③재판매 사업상 멀티 중계사 연동 = 자산("하는 김에 제대로"). 구현 = 다우 어댑터 CT(CT-16 동일 인터페이스)+회사 축 DDL+슈퍼관리자 UI — 선행 = 다우 API 스펙 문서·계정 확보 | Harold 2026-07-15 |
| ★0715(5) **강문희 스펙 회신 도착 → 관문 2 해소 (Harold 확정 2026-07-16)**: ①1안 진행 확인 ②upsert 가능(replace 응답코드 별도 설계·**기준키 = (BILL_ID, 외부템플릿코드)로 확정 답신**) ③조회 BILL_ID 전량 OK ④**54/58 구분 = 송신측(우리) 지정** — 수신은 서버별 상시 listen(중계 분기 없음) → 매핑 클라이언트 CT는 서버별 엔드포인트 이원 발송 ⑤반영 = 엔진 내부 reload 자체 해결(재기동 불요) ⑥인증 = API키(토큰) 화이트리스트 ⑦필드 명칭 쟁점 소멸(API 신규 개발 = 표준 필드명 새로 작성·구성안 표기는 설명용) ⑧**알림톡 senderkey 동봉 = 친구톡과 동일 지원(54·58 전부)** — 신규 업체 온보딩 축 성립(업체 안내 시 "필드명 상이 가능" 명기) ⑨검증 절차 OK. **삭제 기능 없음 확정(Harold)**: 키 오등록 행 = 발송 매칭 불가라 무해 → 대조 워커 '고아 행' 표시만 / 값 실수 = 동일 키 upsert 교정. 답신 = 삭제 불요 확정 + upsert 키 명확화 + 착수 시기 문의. | 강문희 PDF 2026-07-15 · Harold 픽스 07-16 |
| ★0715(4) Harold 방향 전환 — **다우 API 연동 폐기, 휴머스온 흡수 확정**: 다우 연동 개발 안 함. 제이씨패밀리·유성소프트 = 다우 발신프로필을 휴머스온 딜러로 이관해 아난티처럼 senderKey pull로 흡수. **선행 관문(미해소) = 발신프로필 딜러사 이관 가능 여부** — 앞서 "휴머스온 적용 불가"가 (a)이관 시도 실패인지 (b)단순 미가시 관측인지 실측 필요. 두 업체 senderKey를 `GET /senders/imc/:key`로 1콜 조회 → 보이면 이미 흡수/미가시였던 것, 404면 이관 절차 필요(카카오 채널 관리자→딜러 변경 신청). 아래 (3) 스펙 조사분은 폐기 근거로만 보존(재활용 안 함). | Harold 2026-07-15 |
| ~~★0715(3) 다우 스펙 확보~~ (0715(4)로 폐기 — 참고용 보존): 비즈뿌리오 카카오 템플릿 API 정본 3편(헬프센터 섹션 9582248569871 — 개정이력 9582549148047·개요 9582586917135·템플릿 관리 11599105673999, zendesk 공개 조회 API `/api/v2/help_center/ko/articles/<id>.json` 경유). base=kapi.ppurio.com·인증=bizId+apiKey(본문 동봉·API 연동 승인 후 발급)·엔드포인트 4(add/detail/codeCheck/list)·검수상태 REG→REQ→APR(목록 status REG/REQ/REJ/STP/RDY/ACT)·웹훅 없음=폴링·필드 IMC 개념 동일. 미확정 2(실측): 등록→검수 자동 여부 / 수정·삭제 API 부재 시 반려 재등록 흐름. **잔여 선행 = 서팀장 bizId 확인+apiKey 발급** | 본 세션 웹 실측 2026-07-15 |

## 2. 전체 그림

```
[고객사] 템플릿 요청
   ↓
[한줄로] IMC 등록·검수 자동화 (기존 완비 — 웹훅+30분 워커+5분 job+단건 GET 4중 안전망)
   ↓ 승인 확정(APR + templateCode)
[한줄로] 아웃박스 큐 적재
   ↓ 워커
[게이트웨이 매핑 upsert API] (레거시=강문희 API수신프로그램 / 자체=자비스 규약 — 동일 클라이언트 재사용)
   ↓
[효과 검증] 조회 API로 행 실존 재확인 → 그때만 템플릿 상태 "발송 가능"
   ↓ 상시
[대조 안전망 워커] 게이트웨이 전량 조회 ↔ 한줄로 승인 상태 diff → 자동 보정+알림
```

발송 경로는 무변경(기존 업체 Agent payload 그대로). 신규·자체게이트웨이 이관 업체 = 온보딩 시 senderkey 동봉 스펙.

## 3. Track B — 이관·계정 (개발 실체)

### B-1. 슈퍼관리자 import 2종
1. **senderKey 연결**: 이미 IMC에 등록된 발신프로필을 한줄로 회사에 "연결"하는 경로 (현행 POST /senders는 카톡인증 신규 등록 전용이라 별도 필요).
2. **템플릿 pull**: 해당 senderKey의 IMC 승인 템플릿을 `kakao_templates` 행으로 생성 (현행 sync는 기존 행 백필 전용·행 생성 안 함). 검수 상태·템플릿코드 = IMC 원본 그대로(재검수 없음).

대상 = B_(휴머스온) 3,290건. bizp_·업체지정 1,009건은 pull 대상 아님 — 게이트웨이 기존 매핑으로 발송 유지, 새 템플릿부터 한줄로 등록.

### B-2. 브랜드 계층 가시성
- 모델: 회사(고객사) 1 : N 발신프로필(브랜드). 템플릿 열람 = 브랜드(sender_key) 단위 스코프, 부모(고객사 관리자) = 합집합 전체.
- 적용 대상: 다중 프로필 19사(더화이트 155·시세이도 4·신성통상 5 등). 단일 프로필 32사는 평면.
- **선행 확인 결과(2026-07-15 소스 확인 완료)**: 현행 = 회사 전체 노출 정책(alimtalk.ts:605, 2026-07-04 Harold 확정 — profileId 필터는 query param일 뿐 권한 강제 아님). sender_key 열람 스코프 = **미구현 확정** → users↔kakao_sender_profiles 연결 축 신설 필요. 잔여 = 연결 테이블/컬럼 DDL 설계 시 information_schema 검증(db_column_verify_before_code).

### B-3. 계정 생성
- 회사 51(테스트 제외 50) 중 기존 매칭(확정 19) 제외분 신규 생성. usage_type='agent'(Track A 완비), bill_id는 `company_agent_ids`에 시드.
- **bill_id 시드의 원천 = 서팀장 신규 산출물(★0715 정정)**: Bill_ID↔실업체↔발신프로필(senderKey) 매핑은 기존 어느 파일에도 없음 — 7/7 PAY 원부(RSRM_SalesMst)는 PAY 정산 축, 7/14 엑셀 2종은 카카오 축이라 서로 안 이어져 있음. 두 축(게이트웨이 bill_id ↔ 카카오 senderKey)을 잇는 확정본을 서팀장이 새로 작성(§5-5 ① — B0001 테스트 뭉치·복수 표기 정리 포함, 템플릿코드 불요=senderKey 확정 시 IMC pull 자동).
- 휴면 프로필 4건(더화이트 산하) = 이관 보류. @테스트(user_no=4, key=1234567890) = 제외.

## 4. Track C — 게이트웨이 매핑 연동 (개발 실체)

### 4-0. ★2026-07-20 레거시 API 계약 확정 (강문희 「카카오 템플릿관리 API정의서」 수령·구현 완료·62서버 조회 실측 통과)

> 원본 = 큐테크놀로지 2026-07-20 pptx(5p). 구현 완료·실동작 상태로 수령. 아래는 우리 구현이 의존하는 계약 전문.

| 항목 | 확정 내용 |
|---|---|
| 엔드포인트 | `http://<서버IP>:25230/tmpl-mgr` — **54=P코드 계정 / 58=R코드 계정**(서팀장 0720 확정). 현재 58만 가동, 54는 우리 점검 통지 후 포팅 |
| 프로토콜 | HTTP + JSON. **PUT=등록·수정(upsert) / GET=조회**. GET에 body 동봉(자바 제약 시 PATCH 대체 허용) |
| 인증 | 헤더 `Authorization: <token>` + **발신 IP 화이트리스트(62서버 등록 완료)**. 화이트리스트 밖 = 사유 없이 reject. 토큰 변경 가능성 명시 → **env 관리 + 변경 통지 경로 협의 대상** |
| upsert 키 | **billid + tmplcd**. 기존 키를 치면 덮어씀(덮어쓰기 위험 = 클라이언트 책임) |
| 필수 필드 | `billid`, `senderkey`, `usemod`, `tmplcd` (전부 string) |
| 선택 필드 | `billnm`, `tran_tmplcd`(공백이면 서버가 tmplcd로 채움) |
| billid 단위 | **계정(billID)이 아니라 고객사 = 납입자ID 1건**. 서팀장이 "납입자ID 1건 등록 시 그 아래 모든 계정이 해당 템플릿 사용" 하도록 엔진 등록 절차를 변경(0720 채팅) → 매핑 테이블 = `companies : 납입자ID = 1:1` |
| usemod | ⚠ **서버 상수가 아니다 — 템플릿 행 단위 값**(0720 실등록 데이터로 정정, §4-0-2). 서팀장 구두값(54=HM1~3 / 58=HM1~6)은 **신규 고객사 기본값**으로만 쓴다. 실제 54에는 HM1~3과 **HM1~4가 혼재**(더화이트 P0032 등 7개 Bill_ID), 다우 업체는 `DPK_DW1~3`, 예외 `DPK_GT1` 1행. 58은 전부 HM1~6 일관. **⛔ 기존 고객사는 GET으로 현재 usemod를 읽어 그대로 유지**(상수로 덮으면 HM4가 날아간다) |
| 응답 코드 | `00` 조회 성공 / `01` update / `02` insert / `21` 인증 / `22` DB insert 에러 / `23` 시스템 / `24` body 없음 / `27` 필수필드 공백(필드명 적시) |
| 레이트리밋 | **1초 500회 이상 = 공격 간주 reject**(무응답) → 아웃박스 워커 발사 속도 제한 필수 |
| 삭제 | **API에는 없음**(자동화 불가 = 유지). 단 **★0720 강문희: 중계서버 웹관리자에 삭제 기능 존재** — 조회 후 수동 삭제 가능. ⇒ 옛 "삭제 자체가 없음(0716)" 기재는 정정. **자동 삭제는 여전히 설계에서 배제**하고, 대조 워커가 고아 행을 표시 → 운영자가 웹관리자에서 수동 삭제하는 구조로 간다(0611 사고 이후 "삭제는 사람 승인으로만" 원칙과 정합) |
| 토큰 운영(★0720 강문희) | 서버측 임의 변경 없음. 해킹 확실 시에만 변경 후 메일 통지(드묾). 클라이언트 요청 시 협의 변경. **토큰 파일 = `/home/mmsr3/svrs/tmplmgr/conf/conf.json`**(`api_key`·`white_ip`=`127.0.0.1;58.227.193.62`) — 운영실 직접 변경 가능. 변경 후 재기동 = `cd /home/mmsr3/svrs/tmplmgr/ && run.sh restart`(프로세스 `tmpl_api`). **화이트리스트는 ufw에도 있어 함께 변경 필요** |
| 통신 구간 | 62·58·54 = 동일 IDC·동일 랙 내부 구간 → 평문 HTTP 수용(Harold 0720) |
| **54 인코딩 주의** | ★0720 강문희: **54는 표준 한글이 EUC-KR, DB charset이 latin1**이라 포팅에 추가 확인 필요(58은 UTF-8 정상 실증). ⇒ **P0001 점검 시 한글 `billnm` 왕복이 첫 확인 항목.** 깨지면 클라이언트 인코딩 분기 필요 |

### 4-0-1. ★0720 실측 — PUT 왕복 검증 완료 + **서버 결함 1건 발견(구현 필수 회피책)**

테스트 계정(서팀장 지정) = **P0001(54 자체테스트) / R0001(58 자체테스트)**. 58 가동 중이라 R0001로 6회 호출 실측.

| # | 호출 | 결과 | 판정 |
|---|---|---|---|
| 0 | `GET {"billid":"HANJULLO_PROBE_0000"}` | `{"data":[],"req_result":"00"}` | 화이트리스트·토큰·엔드포인트 정상. **미등록 billid = 에러 아닌 빈 배열** |
| 1 | PUT (tmplcd=`..._0001`, tran_tmplcd=`""`) | `02 insert ok` | insert 분기 정상 |
| 2 | GET | `{"billnm":"한줄로연동테스트","tmplcd":"","tran_tmplcd":"",...}` | ⚠ **tmplcd 유실** |
| 3 | PUT 동일 키·billnm 변경 | `01 update ok` | update 분기 정상 |
| 4 | GET | billnm 변경 반영 | upsert 갱신 정상 |
| 5 | PUT (tmplcd=`..._0002`, tran_tmplcd=`..._TRAN_0002`) | `02 insert ok` | **tmplcd가 키로 작동 — 새 행 생성**(설계 전제 유효) |
| 6 | GET | data 2건. 2행은 tmplcd·tran_tmplcd 모두 정상 저장 | 결함 조건 확정 |

> **★결함(2026-07-20 발견) — `tran_tmplcd`를 빈 문자열로 보내면 `tmplcd`까지 빈 값으로 저장 → ✅당일 수정·재검증 통과.**
> 발견 당시: 정의서 계약은 "tran_tmplcd 공백 시 서버가 tmplcd로 채움"인데 실제는 **반대로 빈 tran_tmplcd가 tmplcd를 덮어씀**(대입 방향 역전). tmplcd는 필수 필드인데 `27 Validation err`도 미반환.
> **강문희 조치(당일)**: "소스 코딩 오류 확인, 수정 후 API 데몬 반영, 계약대로 동작". **재검증 [7]·[8]**: 동일 조건(tran_tmplcd `""`)으로 PUT → `02 insert` + 조회 시 `tmplcd`=`HANJULLO_TEST_0003` 유지, `tran_tmplcd`도 같은 값으로 **자동 채움 정상**. 한글 `billnm` 왕복도 정상(58=UTF-8 확인).
> **⛔ 그래도 구현 회피책은 유지**: 매핑 CT는 `tran_tmplcd`를 빈 값으로 보내지 않고 항상 `tran_tmplcd = tmplcd` 복사값을 넣는다(우리 정책과 동일하므로 비용 0, 회귀 시 자동 방어). 계약테스트에 이 케이스를 남긴다.
> R0001 잔존: 테스트 행 3건(1건은 tmplcd 빈 값 = 발견 당시 산물). **삭제는 중계서버 웹관리자에서 가능**(아래 참조).

**해소된 미확정**: ①테스트 billid = P0001·R0001(서팀장 0720) ②**`"P00xx;R00xx"` 병기 = 실제 사용됨**(§4-0-2 — 실등록 데이터에 `P0042;R0003` 1행 존재. 한 고객사가 54·58 양쪽 계정을 가지면 세미콜론 병기, 등록서버는 58). **③`tran_tmplcd` 정책 확정 = tmplcd 복사**(결함 회피 + 실데이터 불일치 0건 검증).

**58번 계약 검증 완료(0720)**: 조회 / insert(02) / update(01) / billid+tmplcd 키 / tran_tmplcd 자동 채움 / 한글 UTF-8 왕복 — 전 항목 통과. **잔여 = 강문희 54 포팅(EUC-KR·latin1 확인 중, 익일 내 예정) → P0001로 동일 점검(한글 왕복 우선) → 최종 통지.**

### 4-0-2. ★0720 매핑 시드 데이터 확보 — 「템플릿관리자 등록 목록」(서팀장 0716 제공·실등록 전량)

> 원본 = `OneDrive/문서/카카오톡 받은 파일/템플릿관리자 등록 목록 (1).xlsx` 시트 `카톡템플릿매핑관리`.
> **컬럼이 API payload와 1:1**: `등록서버 | Bill_ID | 회사명 | SenderKey | 외부모듈 | 인비토코드 | 외부템플릿코드` → 각각 엔드포인트 / billid / billnm / senderkey / usemod / tran_tmplcd / tmplcd.
> ⇒ **서팀장에게 추가로 요청할 산출물 없음**(관문 5-① Bill_ID↔실업체↔발신프로필 확정본 = 이 파일로 충족).

**규모**: 매핑 **4,681행** · **Bill_ID 41개** · 계정명 218 · SenderKey 211. Bill_ID 1개에 다수 계정·프로필이 붙는 **고객사 단위** 구조가 데이터로 확인(서팀장 0720 설명과 일치).

**서버 축**: `P`=54 (3,155행) / `R`=58 (1,503행). **Bill_ID가 두 서버에 걸친 사례 0건**(같은 회사라도 서버별 별도 발급 — 한국고용노동교육원 = P0074·R0027, 마리오몰 = P0013·R0041). 예외 1건 = **`P0042;R0003`(아이비케이저축, 등록서버 58)** → 정의서의 병기 표기가 실사용됨을 입증.

**usemod 실분포**(⚠ 서버 상수 아님):

| 모듈 | 행수 | 비고 |
|---|---|---|
| DPK_HM1·2·3 | 각 4,394 | 공통 기반 |
| DPK_HM4 | 1,937 | **54에도 존재** — P0032(더화이트)·P0071·P0064(베네통)·P0074·P0020·P0070·P0076. **★0720 서팀장 사유**: 아이디어스가 대량 발송한다고 해서 받은 모듈이며, **58번으로 옮기면서 3개로만 관리**함 ⇒ 54의 HM4 등록분은 **과거 잔재**(현 관리 기준은 3개). 그래도 기존분은 조회값 유지 원칙 적용 — 우리가 바꿀 이유가 없다 |
| DPK_HM5·6 | 각 1,494 | 58 전용(58은 전부 HM1~6 일관) |
| DPK_DW1 / DW2·3 | 286 / 각 242 | 다우 업체(유성소프트·제이씨패밀리 등) |
| DPK_GT1 | 1 | 예외 1행(P0019) |

같은 Bill_ID 안에서도 템플릿마다 모듈이 다른 사례 4건(P0019는 DW1 / DW1;2;3 / GT1 3종). **⇒ usemod는 행 단위 값 — 기존분은 조회로 읽어 유지, 서팀장 구두값은 신규 고객사 기본값.**

**tran_tmplcd 실증**: 인비토코드 ≠ 외부템플릿코드 **불일치 0건 / 4,681행 전부 동일**. 치환 사례가 운영에 존재하지 않음 → 우리 정책(tran_tmplcd = tmplcd 복사)이 기존 운영과 100% 일치.

**템플릿 코드 prefix**: `B*` 3,353 / `bizp_` 798 / 업체지정(ACS·ANH·APS·APH 등) — 0714 파악한 휴머스온 76%·다우 18%·업체지정 5%와 정합.

**B prefix 23행 = 옛 형식 잔재**: 전부 **유성소프트**(B0067·B0070~B0076, 계정 8개, DPK_DW1, bizp_ 템플릿). 같은 회사의 신형식 P0022도 별도 존재. 유성소프트는 0715 "다우→휴머스온 흡수" 대상이라 정리 시 함께 해소.

**집중도**: P0032(더화이트, 계정 141개) 1,914행 = 전체의 41%. R0007(아난티) 886행. 상위 2개가 60%. → M5 확대 순서는 소규모부터, 더화이트는 마지막(§7 리스크 정합).

**설계 반영 포인트**: billid 접두(P/R) 하나가 **엔드포인트와 usemod 값을 동시에 결정**한다. usemod는 서버 모듈 증설 시 바뀌므로 코드 상수가 아닌 **설정값**으로 분리하고, 대조 워커 점검 항목에 usemod를 포함해 서버 실값과 상시 대조한다(조회 응답에 usemod가 그대로 실려 옴).

### 4-1. 구성요소

| 구성요소 | 내용 | 위치(계획) |
|---|---|---|
| 매핑 클라이언트 CT | upsert/조회 호출 + 레거시·자체 게이트웨이 공용 어댑터. payload 6필드(billid·billnm·senderkey·usemod·tmplcd·tran_tmplcd). **billid 접두(P/R)로 엔드포인트·usemod 동시 분기** · **tran_tmplcd 빈 값 전송 금지(§4-0-1 결함)** · 레이트리밋 1초 500회 미만 | `utils/gateway-template-mapping.ts` (CT 신설) |
| 아웃박스 워커 | 승인 확정 → 큐 적재 → 멱등 upsert + 백오프 재시도 + N회 실패 알림 | 기존 워커 패턴 준용 |
| 효과 검증 게이트 | upsert 응답만 믿지 않음 — 조회로 실존 재확인 후에만 "발송 가능" 표시. 그 전 = "승인완료·발송준비중" | 6원칙 ② |
| 대조 안전망 워커 | 주기 전량 diff(5요소 전체) → 어긋남 자동 보정+알림. 초기 1회 = 서팀장 엑셀 4,159건 baseline 대조 = 이관 검증 | 6원칙 ③ |
| 삭제 승인 UI | ~~DELETE는 자동화에서 제거 — 슈퍼관리자 확인 모달로만~~ / ~~0715 "삭제 자체가 없음"~~ → **★0720 정정: API에는 없지만 중계서버 웹관리자에 삭제 기능이 있다(강문희)**. 결론은 동일 — **자동 삭제는 설계에서 배제**, 대조 워커가 '고아 행'을 표시하고 **운영자가 웹관리자에서 수동 삭제**. 값 실수는 동일 키 upsert 교정. 자체게이트웨이(자비스)는 별도 스펙 | 0611 재발 차단(삭제=사람 승인) |

## 4-9. M2 구현 설계 (★2026-07-20 확정 — Harold "한 치의 빈틈도 없이")

> 원칙: **desired state + 수렴**. 이벤트 훅(승인 순간 push)에 의존하지 않는다 — 훅은 경로 3개(웹훅·5분 폴링·1h sync)라 하나만 놓쳐도 구멍. 대신 워커가 "있어야 할 매핑"을 상태에서 계산해 게이트웨이와 수렴시킨다(놓친 전이 자동 복구·멱등).

### A. 데이터 모델 (PG 신규 2 테이블)

> **★DDL 사전 검증 0720 통과(Harold 실행)**: `gateway_bill_mappings`·`gateway_template_mappings` = information_schema **0 rows(부재 확인)** / 참조 컬럼 7개 전부 실존(companies.id · kakao_templates id·status·template_code·company_id·profile_id · kakao_sender_profiles.profile_key). 아래 DDL은 **그대로 실행 가능한 확정본**(db_column_verify_before_code 이행 완료). 실행 후 SCHEMA.md에 두 테이블 절 즉시 기록.

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
  tran_tmplcd   varchar(100) NOT NULL,                   -- ⛔ 빈 값 금지 — 항상 채움(기본=tmplcd)
  senderkey     varchar(100) NOT NULL,
  billnm        varchar(128) NOT NULL DEFAULT '',
  usemod        varchar(100) NOT NULL,                   -- 행 단위 값(§4-0-2)
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

### B. 파일 구성 (CT 원칙 — 로직은 utils, 라우트는 thin)

| 파일 | 역할 |
|---|---|
| `utils/gateway-template-mapping.ts` (CT 신설) | HTTP 클라이언트(PUT/GET)·엔드포인트 resolve(server→host)·payload 빌더(트림·필수 검증·tran_tmplcd=빈값이면 tmplcd 복사)·응답코드 매핑(00/01/02=성공, 21/22/23/24/27=타입別 에러)·**직렬 레이트리밋(호출 간 최소 200ms = 5/s ≪ 500/s)**·효과 검증(upsert 후 GET 재조회로 해당 tmplcd 실존+필드 일치 확인 = 6원칙 ②) |
| `utils/gateway-template-mapping-worker.ts` | ①**적재 스캔**(5분): `kakao_templates status='APPROVED'` × `gateway_bill_mappings(auto_push_enabled=true, company_id 연결)` → 없는 desired 행 INSERT(pending). usemod=bill의 default_usemod, senderkey=해당 템플릿 profile의 profile_key ②**푸시**(1분): pending/재시도 도래분 배치(상한 50) → upsert→검증→synced. 실패=백오프(1m→5m→30m→2h→6h, 8회 초과=failed+`sendSystemAlert` 쿨다운) ③**대조**(6h): bill_id별 GET 전량 → desired와 diff(tmplcd·tran_tmplcd·usemod·billnm) — 게이트웨이에만 있는 행=orphan 표시(자동 삭제 절대 X·웹관리자 수동 삭제 안내), desired만 있는데 synced인 행=드리프트→pending 재전환+알림, `last_seen_at` 갱신 |
| `routes/gateway-templates.ts` (super_admin 전용) | bill 연결·auto_push 토글 / 매핑·상태 조회 / seed-import(dryRun 기본 true·멱등) / 대조 리포트 / 수동 push 트리거. 테이블 부재 시 503 `DB_MIGRATION_PENDING`(워커는 조용히 skip) |
| `app.ts` | `startGatewayTemplateMappingWorker()` 등록(기존 start* 패턴) + 라우트 mount |

### C. 불변 규칙 (계약 테스트로 고정)

1. **tran_tmplcd 빈 값 전송 절대 금지** — 빌더가 빈 값이면 tmplcd 복사(0720 결함 회피 유지·회귀 방어)
2. **billid 리터럴 보존** — 병기(`P0042;R0003`) 분해·재조합 금지. 시드 그대로
3. **기존 행 usemod 불변** — 시드·GET에서 온 값을 그대로 유지(HM4 잔재 포함). default_usemod는 **신규 행에만**
4. **server='54' 푸시 보류 게이트** — env `GATEWAY_TMPL_54_ENABLED=false`가 기본. 강문희 54 포팅 + P0001 **한글 왕복 실측** 통과 후에만 true(EUC-KR·latin1 리스크)
5. **전체 동기화 마스터 게이트** — env `GATEWAY_TMPL_SYNC_ENABLED=false` 기본. 배포≠가동
6. **삭제 없음** — orphan은 표시만. 삭제는 중계서버 웹관리자에서 사람이(0611 원칙)
7. **발송 경로 무접촉** — campaigns.ts·direct-send 등 절대 보호 영역 파일 수정 0. 이 트랙은 매핑 등록만
8. 레이트리밋 위반 시 무응답 reject이므로 **타임아웃(20s)+재시도 백오프**가 유일한 복구 경로 — 재시도는 항상 멱등(upsert)

### D. 시드·매칭·가동 순서 (배포 런북)

1. **DDL 2건** — information_schema 사전 검증(테이블 부재 확인) → Harold 서버 psql 실행 → SCHEMA.md 갱신
2. **코드 배포** — 워커는 env 게이트 false라 무동작(안전)
3. **시드 임포트** — 서팀장 엑셀 4,681행→JSON 변환(내가 생성)→`POST seed-import dryRun` 검토→실행. `gateway_bill_mappings` 41건(+B잔재)·`gateway_template_mappings` 4,681건 `source='seed', sync_status='synced'`(이미 게이트웨이에 실존하는 상태값이므로)
4. **대조 1회 수동 실행** — 시드(엑셀) vs 게이트웨이 실서버 GET 전량 diff = **이관 검증 그 자체**. diff 결과 보고
5. **실측 1건(6원칙 ⑤)** — 테스트 bill(R0001)로 워커 경유 전 사이클(적재→푸시→검증→synced) 통과 확인
6. **아난티 파일럿** — 아난티 company↔R0007 연결 + auto_push_enabled=true → 신규 승인 템플릿 1건이 자동 등록되는지 + M4 실발송 1건
7. **확대(M5)** — 소규모부터, 더화이트(41% 집중) 마지막

### E. 알려진 한계 (정직 고지)

- **GET 응답에 senderkey가 없다** — 대조는 tmplcd·tran_tmplcd·usemod·billnm 4필드만 가능. senderkey 정합은 upsert 응답코드 + M4 실발송으로 검증. (강문희에게 GET 응답 필드 추가 요청 여부 = Harold 결정, 차단 아님)
- 54 인코딩은 P0001 실측 전 미지수 — 게이트 4번이 방어
- 시드의 company 매칭(레거시 회사명→companies)은 점진 — 미연결 bill은 대조만 되고 auto push는 안 됨(안전한 기본값)

### D-2. 시드 변환 스펙 (다음 세션 — 엑셀→JSON)

- **원본**: `C:\Users\ceo\OneDrive\문서\카카오톡 받은 파일\템플릿관리자 등록 목록 (1).xlsx` 시트 `카톡템플릿매핑관리` (4,681행 — "(1)" 붙은 최신본. 한글 경로라 glob+`-LiteralPath`로 접근, python은 스크립트 파일로)
- **컬럼→필드**: 등록서버→server / Bill_ID→bill_id(**리터럴 — trim만, 분해·대문자화 금지**) / 회사명→billnm / SenderKey→senderkey / 외부모듈→usemod / 인비토코드→tran_tmplcd / 외부템플릿코드→tmplcd
- **적재 규칙**: `gateway_template_mappings` = 4,681행 `source='seed', sync_status='synced'`(게이트웨이 실존 상태이므로), UNIQUE(bill_id,tmplcd) 충돌=skip 카운트 보고. `gateway_bill_mappings` = bill_id별 1행(서버·최빈 usemod=default_usemod·대표 billnm), company_id=NULL·auto_push_enabled=false로 시작
- **주의**: 엑셀 내 (bill_id,tmplcd) 중복 존재 가능(같은 템플릿코드가 계정명만 다른 행) → dryRun에서 중복 수 확인 후 최신행 우선 규칙 적용. B-prefix 23행(유성소프트 잔재)도 그대로 시드(대조 대상)

### H. ★0720 실행 결과 + 다음 세션 런북 — 템플릿 일괄 이관 (여기서 시작)

> **0720 종결(전부 Harold 실측)**: M2 배포·DDL·env 3키 / 시드 4,680행·41bill / 대조 = 키 기준 전량 실존·최종 드리프트 0
> (시드 행 필드 차이 1,482건 = billnm `_HU` 표기 — **대조 정정: 시드 행은 게이트웨이 실값 채택(재push 금지)**) /
> R0001 워커 전 사이클(pending→push→효과검증→synced) 통과 / **카카오축 회사 33 연결 + 15 생성** + **PAY축 80 실체(회사 50 생성·계정 38·CustId 283 연결·겸용 전환 17)** /
> 에이전트 3메뉴 게이팅 + **에이전트 발송결과 화면(RSRM_SalesStts 배선·목록+상세) 신성통상 실측 통과**.
> 계정 정책 확정: 아이디 = 걔네가 쓰던 것(레거시 카카오 핸들 > PAY MemId), 비번 일괄 qwer1234+최초 변경 강제. users.user_type DB값='admin'(CHECK 실측).

**다음 세션 = 카카오 템플릿 일괄 이관(매핑) 완료가 목표.**

1. **전제 확정(Harold 0720)**: 강문희 게이트웨이 push 축은 계속 홀딩(마스터 게이트 `GATEWAY_TMPL_SYNC_ENABLED=false` 유지) — **템플릿 이관(IMC pull)은 한줄로↔IMC만 오가므로 게이트웨이와 무관, 즉시 진행 가능.**
2. **재료(전부 확보 상태)**: 회사↔bill 연결(카카오 33+PAY 80) / bill별 senderKey = `gateway_template_mappings.senderkey`(211키) / 검증된 도구 = `POST /api/alimtalk/senders/import`(프로필 연결)+`POST /api/alimtalk/templates/import`(IMC pull — 아난티 847건 실증·멱등·재카운트).
3. **절차**: 일괄 이관 endpoint 신설(dryRun 기본) — 연결된 회사별로 ①bill의 distinct senderKey → senders/import(연결) ②templates/import(pull) ③검증 = 회사별 pull 건수 ↔ 게이트웨이 시드 행수(B_ 계열) 대조. **B_(휴머스온 76%)만 pull** — bizp_·업체지정 24%는 IMC 부재라 pull 금지(발송은 기존 게이트웨이 매핑 유지·새 템플릿부터 한줄로). 순서 = 소규모부터, 더화이트(1,914행 41%) 마지막.
4. **자료가 더 필요하면 Harold님께 요청**: 서수란 팀장 수령 자료 일체(「템플릿관리자 등록 목록 (1).xlsx」=OneDrive 카카오톡 받은 파일·발신프로필 엑셀·PAY 3종)와 레거시 원본(event_admin DB — Harold만 143 접속) 등 — 필요 시점에 구체 항목으로 요청할 것.
5. 잔여 병행: 아난티 파일럿(auto_push+마스터 게이트 ON+M4 실발송 1건) / 강문희 54 포팅 메일→P0001 한글 왕복→54_ENABLED / 아이디 보류 4(p0019·p0070·r0019·r0029) / company_only 12곳 계정=요청 시.

### I. ★0720(8) 일괄 이관 구현 — 대조 계약 정정 + 0715 누락 62건 발견

> 상태: **코드 완료·tsc 0·vitest 798 통과 / 배포·실행 대기.** DDL 0건(신규 컬럼·테이블 없음).

**0715 아난티 pull은 완료가 아니었다(운영 DB 실측).** `failed 0 / 중복 0 / 재카운트 일치`로 종결 보고됐지만, 게이트웨이가 실제로 라우팅하는 B_ 코드 **62개가 한줄로에 없다**. 원인 = 아난티 시드 senderKey 2개 중 `6be13…`만 `/senders/import`로 연결되고 `7dc0de…`(62코드)는 미연결 → 그 키의 템플릿이 pull 대상에 아예 들어오지 않음. 누락분은 한줄로 어디에도 없음(전역 조회 0 rows). **pull 경로가 자기가 만든 수만 세고 게이트웨이 기준과 대조하지 않으면 이 유형은 영원히 안 보인다.** senderKey 2개 이상 회사가 30곳 중 17곳이라 같은 자리가 그만큼 있었다.

**대조 계약 정정(0720 실측 확정)**

| 항목 | 옛 기재 | 정정 |
|---|---|---|
| 기준 단위 | 시드 **행수** | **distinct 템플릿코드** — bill 2개 회사(마리오아울렛 P0013·R0041, 엔그램, 한국고용노동교육원)는 같은 코드가 54·58 양쪽 등록이라 행이 2배(4행/2코드·32/16·146/73). 전체 3,353행 = **3,262코드** |
| 판정 | pull 건수 **=** 시드 행수 | **포함 관계** — 아난티 시드 559코드 vs IMC pull 847건. IMC가 더 많은 게 정상(게이트웨이 미등록 승인분). 통과 조건 = `게이트웨이 B_ 코드 − 한줄로 보유 = 공집합` |
| 누락 처리 | (없음) | **사유 4분류 의무** — `sender_not_connected`(0715 유형) / `not_in_imc`(게이트웨이 고아·사람 판단) / `imc_sender_mismatch`(귀속 불일치=코드 결함) / `insert_failed` |

**B_ 필터 확정** — `split_part(tmplcd,'_',1)='B'` 3,353행 전량이 `B_` 형식. pull 대상 판정 = `startsWith('B_')`. 제외분 실분포: bizp 797 · SJT 105 · ACS 95 · ANH 85 · APS 68 · APH 58 · SJB 22 · ANT 14 · tryon/sdmall 각 9 · sdnetworks 7 · whole 6 · sdcap/r 각 4 · 숫자형 다수. **B_ 0건 회사 4곳(아이올리 211행·메트로시티 52·미구하라 10·쎌렉박스 9)은 pull 0건이 정답** — 실패로 오판 금지.

**검수 알림·폴링 루프(동반 정정)** — `/templates/import`가 `alarm_notified_status`를 안 채워, 이관된 과거 확정 템플릿이 `syncPendingTemplatesJob`(5분) 조회 조건(`status IN (APPROVED,REJECTED,KREJ) AND alarm_notified_status IS NULL`)에 영구 잔존. 알림 수신자 0명이면 `count=0`이라 상태 표시 없이 다음 주기 재시도(alimtalk-jobs.ts:356) → **0720 실측 폴링 대상 747건 전량이 0715 아난티 이관분**. 3,262건을 같은 상태로 넣으면 4배가 되어 실제 검수 중 템플릿의 상태 반영이 밀린다. 알림 수신자가 등록된 회사면 과거 승인 건이 승인 알림 LMS로 실발송된다. → 이관 INSERT는 종결 상태를 미리 기록해 억제, 기존 잔존분은 백필 endpoint로 정리.

**구현물**

| 파일 | 역할 |
|---|---|
| `utils/kakao-bulk-migration.ts` (CT 신설) | 순수 함수 — B_ 판정 · IMC item senderKey/코드 추출(D217+ 실측 키만) · 전량 스캔 index · **회사 단위 senderKey 합집합 대상 구성**(코드수 오름차순 정렬=실행 순서) · 누락 4분류 · 이관분 alarm 상태 |
| `utils/__tests__/kakao-bulk-migration.test.ts` | 계약 24건 — 규칙 6개 고정(B_ 한정·합집합·distinct 기준·포함 관계·사유 분류·알림 억제) |
| `routes/gateway-templates.ts` `POST /bulk-migrate-templates` | dryRun 기본 true. IMC **전량 1회 스캔**(senderKey마다 재스캔하면 215키×50페이지=1만 콜) → 회사별 프로필 연결(IMC 실조회 통과분만·타사 선점은 표시만) → B_ pull → 대조 → 효과 검증 재카운트 |
| `routes/gateway-templates.ts` `POST /imported-alarm-suppress` | 기존 이관분 알림 억제 백필. 대상 한정 = **`billIds` 명시 필수**(전역 일괄 금지) + 종결 상태 + `alarm_notified_status` 미기록. ★첫 구현의 `requested_at IS NULL AND created_by IS NULL`(import 경로 표식) 판별식은 **0720 실측으로 폐기** — 대상 847건 전부 `requested_at`이 채워져 있고(컬럼 기본값) 정상 등록 경로도 `created_by`가 NULL이라 판별력이 0이었다(백필 0건). 표식 추정 대신 사람이 범위를 지정한다 |

**안전 설계** — 게이트웨이 호출 0 · `gateway_template_mappings` 쓰기 0(마스터 게이트 false 유지와 무관) · 발송 경로 파일 수정 0 · 부분 IMC 스캔 시 중단(누락 pull이 "완료"로 보이는 것 차단) · D231+ 방어로 회사·프로필·템플릿 상한 + `offset` 이어달리기(전 단계 멱등).

**실행 순서(코드수 오름차순 = endpoint 정렬 그대로)**
1. 전체 dryRun 훑기 — `{dryRun:true, offset:0, maxCompanies:10}`을 offset 0·10·20·30으로 4회. 여기서 senderKey별 IMC 가시성(`would_link` / `imc_not_visible` / `linked_to_other_company`)이 전부 드러난다.
2. 소규모 실행 — 여미지(1코드)부터 `{dryRun:false, offset:N, maxCompanies:1}`. 응답 `reconcile.passed=true` 확인 후 다음.
3. 중간 규모(sdmall 117·신성통상 115·고운세상 103) 개별 실행.
4. **아난티 재실행** — 백필이 아니라 재실행 대상(미연결 `7dc0de…` 연결 → 62코드 pull).
5. **더화이트 단독 회차** — 1,687코드·senderKey 141개. `maxProfiles`/`maxTemplates` 상한으로 여러 회차.
6. `POST /imported-alarm-suppress` dryRun → 실행(잔존 0 확인).

**★0720 실행 결과 — 이관 본체 완료(Harold 실행)**

| 차수 | 구간 | 템플릿 | 프로필 | 실패 | 누락 |
|---|---|---|---|---|---|
| 1 | offset 0 (10곳) | 97 | 14 | 0 | 인비토 10만 |
| 2 | offset 10 (10곳) | 499 | 19 | 0 | 0 |
| 3 | offset 20 (9곳) | 984 | 27 | 0 | 0 |
| 4 | 더화이트 단독 | 1,999 | 138 | 0 | 0 |
| **계** | **29곳** | **3,579** | **198** | **0** | — |

- **dryRun 예측과 실행 결과가 전 차수 정확히 일치.** 회사별 게이트웨이 B_ 코드 대비 누락 0.
- **0715 아난티 누락 62건 복구 확인** — 미연결이던 `7dc0de…`가 IMC에서 보여 연결·pull 성공(847+66=913, 누락 0).
- **미연결 senderKey의 IMC 가시성 = 해소** — `imc_not_visible` 9건(메트로시티 2·아이올리 4·더화이트 3)은 전부 게이트웨이 B_ 코드가 없는 키라 이관 영향 0. **딜러 이관이 필요한 회사는 없다**(0715(4) 관문 소멸).
- **인비토(R0046) 제외** — senderKey 2개(`@invitocorp`·`@poppon`)가 `테스트계정2`(IVITO123)에 귀속돼 있고 B_ 10코드도 이미 그 회사에 존재. 데이터 공백 아님. 자동 재연결을 막아둔 덕에 팝폰 실사용 프로필이 딸려 옮겨가는 것을 피함. 프로필 귀속 정리는 별건.
- **알림 상태 기록 정상** — 3,579건 전부 `alarm_notified_status`가 종결 상태로 들어가, 5분 폴링 대상이 이관 전(747)에서 1건도 늘지 않음.
- 게이트웨이보다 IMC가 많은 초과분(예 더화이트 1,687→1,999, 베네통 39→102)은 **게이트웨이 매핑이 없어 현재 라우팅 불가** — push 축이 열릴 때 적재 스캔이 승인 템플릿 전량으로 desired 행을 만들며 자동 해소. 컷오버 전 선행 조건.

### G. (0720 소진) 옛 재개 런북 — M2 구현 완료로 종료

1. **정독 의무**: CLAUDE.md → STATUS §2 → 본 문서 §4-0~§4-9 전체 → LESSONS_DB·LESSONS_BACKEND(핵심 원칙+워커·외부API 절)
2. **DDL 실행**(Harold psql — §A 확정본 그대로) → SCHEMA.md 두 테이블 절 기록
3. **구현**(§B 파일 4개): CT → 워커 → 라우트 → app.ts 등록. 불변 규칙 §C 8개 = 계약 테스트 먼저(RED)
4. **검증**: vitest(§F 목록) → tsc 0 → 자가 grep → **Codex adversarial**(발송 인접 의무)
5. **배포**: env 3키(`GATEWAY_TMPL_API_TOKEN`=현행 토큰·`GATEWAY_TMPL_SYNC_ENABLED=false`·`GATEWAY_TMPL_54_ENABLED=false`) → tp-push → build:safe → pm2
6. **시드**(§D-2) → 대조 1회(diff 보고) → R0001 실측 1건 → 이후는 §D 6~7(아난티 파일럿)
7. **병행 확인**: 강문희 54 포팅 완료 메일 오면 P0001 **한글 왕복** 점검 → 통과 시에만 `GATEWAY_TMPL_54_ENABLED=true`
8. **★미생성 납입자ID 일괄 생성(Harold 0720 지시 — 이 세션 의제)**: 한줄로 카카오 사용 예정 고객사 중 엔진 납입자ID(P/R) 미보유인 곳의 ID를 일괄 생성·연결하는 작업. **생성 주체·방법은 미확정(추측 금지)** — 납입자ID는 엔진측 발급 체계라 서팀장에게 "신규 납입자ID를 누가 어떤 화면/절차로 만드는지, 일괄 생성이 가능한지" 확인 후 진행. 생성되면 `gateway_bill_mappings`에 연결(company_id·server·default_usemod=서버 기본값). 대상 산정 = 한줄로 kakao_sender_profiles 보유 회사 − 기존 bill 연결 회사.
- 이 시점 확정 사실 전부 = §4-0(계약)·§4-0-1(결함·재검증)·§4-0-2(시드 데이터)·§4-9(설계). **여기 없는 건 사실이 아니라 추측이다 — 재확인 후 진행.**

### F. 검증·리뷰 게이트

- vitest 계약 테스트: 빌더(트림·필수·tran 복사·빈값 거부)·server resolve·병기 리터럴·백오프 스케줄·diff 로직(usemod 포함)·레이트리밋 간격 — 기존 테스트 패턴 미러
- tsc 0 + 자가 grep(모델명·박단어·dialog 0)
- **Codex adversarial 리뷰 의무**(발송 인접 신규 인프라) — 종결 전
- 배포 후: 워커 기동 로그·테이블 부재 skip 동작·503 응답 확인

## 5. 선행 관문 (코드 착수 전)

1. **아난티 getSender 실측** — ★0715 통과(0000·@아난티·status A — 같은 계정 확정, §1 참조). 실측 경로 = 신설 `GET /api/alimtalk/senders/imc/:senderKey`(super_admin debug 1콜). B_ 76% pull 성립 확정.
2. **강문희 스펙 회신** — ★**0720 통과**: API 정의서 수령 + 구현 완료 통지 + **62서버 조회 실측 정상**(§4-0). 계약 전문 확정. 잔여 = 미확정 2건 회신(테스트 billid·billid 병기 표기) → PUT 점검 → 결과 통지 → 강문희 54 포팅. **M2 착수 관문은 사실상 해소**(잔여 2건은 PUT 검증용이며 CT 설계를 막지 않음).
3. **브랜드 스코프 DDL 설계** — 미구현 확정(0715 소스 확인·§B-2). 잔여 = users↔프로필 연결 축 DDL 설계 + information_schema 검증 (db_column_verify_before_code).
4. **자비스 개발 완료 회신** — 자체게이트웨이 upsert/조회 API + 실측 4시나리오 통과.
5. **서팀장 실무 4건** — ①Bill_ID↔실업체↔발신프로필 확정본 → **★0720 충족 완료**: 0716 제공 「템플릿관리자 등록 목록 (1).xlsx」가 Bill_ID·회사명·SenderKey·모듈·코드까지 전량 포함(§4-0-2 분석). **추가 요청 불요.** (별건으로 0720 수령한 `PAY_회사단위_실고객.xlsx`는 **PAY 정산 축(CustId B/C/D)**으로 Track D용 — 템플릿 축(P/R)과 혼동 금지) ②휴머스온 계정 교차 확인(관문 1 통과로 사실상 해소) ③수동 등록 컷오버 날짜 합의(이중 등록 방지 — 한줄로 가동일부터 서팀장 수동 중단) ④업체 담당자 연락처+안내 패키지(계정 발급·검수 알림 수신자 초기 등록·차단 전 최종 검수).

## 6. 마일스톤

| 단계 | 내용 | 게이트 |
|---|---|---|
| M0 | 관문 실측(아난티 getSender) + 강문희·자비스 회신 | 관문 1 ★0715 통과 / **2 ★0720 통과** / 4 대기 |
| M1 | 스펙 확정 + 브랜드 스코프 스키마 검증 | **API 계약 ★0720 확정(§4-0)** / 브랜드 스코프 DDL은 관문 3 |
| M2 | Track C: 매핑 CT + 아웃박스 + 효과검증 + 대조 워커 | tsc 0 + 테스트. **착수 가능(0720) — 데이터 3종(납입자ID 목록·usemod 상수·companies 매칭) 확보 시 실호출** |
| M3 | Track B: import 2종(★0715 구현·배포 — `/senders/import`·`/templates/import`+CT-16 역변환 4종+계약 테스트 13) + 브랜드 계층·계정 생성(잔여) | tsc 0 + vitest 628 통과 |
| M4 | 아난티 파일럿 — pull ★0715 완료(847건·APPROVED 827·KREJ 20·중복 0). 잔여 = 실발송 1건 + 결과코드 0 확인 + 497 집계 기준 대조(서팀장) | 6원칙 ⑤ 실측 |
| M5 | 확대(회사별 순차 — 더화이트·시세이도 등) + 신규 승인분 자동 등록 개시 | 대조 워커 diff 0 |
| M6 | 레거시 템플릿관리자 접속 차단 → 2주 무클레임 → 폐기 게이트(플랜 §6) | Track F |

각 단계 착수 전 Harold 승인. M2~M3 구현 시 도메인 LESSONS(BACKEND·DB) 정독 + Codex 리뷰(발송·돈 인접 = adversarial) 의무.

## 7. 리스크

- 강문희 API 품질(1.5일 개발) = 이 설계의 바닥 → 스펙 합의문(멱등·조회 전량)으로 방어, 효과 검증 게이트가 최종 방어선. **★0720 실증: 첫 점검에서 계약↔동작 불일치 1건 발견(tran_tmplcd 빈 값 → tmplcd 유실, §4-0-1). 정의서 문구만 믿고 구현했으면 전 템플릿의 코드가 빈 값으로 등록될 뻔했다 — 효과 검증 게이트(upsert 후 조회 재확인)가 이 유형을 잡는 유일한 장치임이 확인됨. 잔여 필드·분기도 동일하게 실측 후에만 확정한다.**
- 낡은 매핑 우선 문제(senderkey 교체 시) → upsert가 UPDATE를 포함하므로 해소. 대조 워커가 2차 방어.
- bizp_·업체지정 24%는 IMC에 없음 → pull 금지(대조 워커 diff 대상에서도 원천 구분). 잔존 발송은 기존 매핑이 담당.
- 더화이트 리셀러 = 전체 44% 집중 → M5에서 회사 단위 마지막 순번 배치(파일럿·소규모 검증 후).
