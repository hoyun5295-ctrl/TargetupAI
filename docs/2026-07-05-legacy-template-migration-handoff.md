# 레거시 카카오 템플릿 이관 핸드오프 (event-admin → 한줄로)

> **작성**: 2026-07-05
> **목적**: 레거시 event-admin(카카오 템플릿 관리자)의 발신프로필·알림톡 템플릿을 한줄로로 이관 — 한줄로 카카오 프로필 기능 오픈 + 정산 통합 + 레거시 서버 폐기 준비
> **성격**: 서팀장 회의 자료 + 실행 핸드오프. 오늘(2026-07-05) 세션에서 실측·대조한 사실만 기록.
> **관련**: `docs/레거시서버_폐기_플랜.md`, `status/SCHEMA.md`(kakao_sender_profiles·kakao_templates)

---

## 0. 큰 그림

1. 한줄로 카카오 프로필/템플릿 기능은 현재 **잠금(내부 테스트만)** 상태 → 오픈 예정.
2. 오픈하는 김에 레거시 event-admin에 등록된 업체들의 **발신프로필 + 알림톡 템플릿을 한줄로로 미리 이관**.
3. 궁극 목표 = 모든 업체를 한줄로 company로 수렴(정산 통합). Agent만 쓰는 업체도 결국 한줄로 계정 필요.
4. 이관·검증 완료 후 **레거시 구식 서버 폐기·삭제**. (PAY 사이트는 별도 트랙)

---

## 1. 레거시 소스 현황 (실측)

### 1-1. 접속
- 시스템: **event-admin.invitocorp.com** (카카오 템플릿 관리자), Spring Boot `live2-event-admin-server.jar` (/home/event/admin-api, 포트 8081).
- 서버: **27.102.203.143** (다우클라우드), SSH 포트 27153 root — **Harold만 접속**(AI 레거시 SSH 금지).
- DB: MySQL **포트 3388**(비표준), DB `event_admin`.
- **접속 계정 = `invito`** (`event` 아님 — event는 거부됨). 계정·비번 출처 = jar 내 `BOOT-INF/classes/application.yml`의 `live_share` 프로필 datasource. 비번은 Harold 보유(문서 미기재).
- 조회 예: `mysql --default-character-set=utf8 -uinvito -p -h127.0.0.1 -P3388 event_admin`
- 주의: `display_name`은 utf8 컬럼 → mysql 클라이언트에 `--default-character-set=utf8` 안 주면 한글이 `?`로 깨져 보임(데이터는 정상).

### 1-2. 대상 테이블 (event_admin)
| 테이블 | 역할 |
|---|---|
| `user` (59행) | 업체 계정. **업체명 = `display_name`** (매칭 키). `no`(PK)·`user_id`(영문핸들)·`parent_no`(상위계정)·`manager_name/tel/email`·`status` |
| `kakao_sender_profile` (261행) | 발신프로필. `no`(PK)·`user_no`(→user)·`plus_friend_id`(카카오 채널 @id)·**`sender_key`(IMC senderKey)**·`status` |
| `kakao_alim_talk_template` (4,519행) | 알림톡 템플릿. `no`·`user_no`·`kakao_sender_profile_no`(→profile)·`msg_type`·`title`·`contents`(2048)·`ext_contents`(2000)·`emp_type/emp_title/emp_sub_title`(강조표기)·**`template_code`(IMC)**·`status`(int)·`hidden`·reg/mod/rej/req_date |
| `kakao_alim_talk_template_button` | 템플릿 버튼 |
| `kakao_alim_talk_template_review` | 검수. `kakao_alim_talk_template_no`·`review`·`answer`·`file1~5`·`status` |
| `kakao_friend_talk_template` | 친구톡(한줄로에선 폐지→브랜드메시지, 별도 취급) |
| `smsq_send*`, `user_token` | 이관 대상 아님 |

### 1-3. 규모·상태
- 계정 59 / 프로필 261 / 템플릿 4,519 (계정당 프로필 평균 4.4 = 멀티 프로필).
- 템플릿 status 분포: **1 = 4,294**(검수통과 추정, 이관 핵심) / -1 = 187(반려 추정) / 0 = 28 / 2 = 9 / -2 = 1.
- ★ status 정수값의 정확한 의미는 회의에서 확정 필요(1만 이관할지 등).

---

## 2. 한줄로 대상 현황 (실측)

- 대상 테이블: `kakao_sender_profiles`(**`profile_key` = IMC senderKey**), `kakao_templates`(**`template_key` = IMC templateKey**), `companies`.
- 한줄로 전체 company = **76개**(작고 관리 가능).
- 카카오 프로필/템플릿 기능 = **잠금 상태(빈 값, greenfield)** → 덮어쓸 데이터 없어 이관 안전.

---

## 3. 매칭 결과 (레거시 55개 실업체 전수 대조)

> 테스트 계정 2개(유저테스트 invitouser·최종테스트(리셀러) rtest) 제외 = 실업체 53개.

### 3-1. 확정 매칭 — 한줄로에 이미 있음 (오늘 이관 대상)
| 레거시(user_id) | 템플릿 | → 한줄로 company | 한줄로 company id |
|---|---|---|---|
| 아난티 (ananti) | 511 | 아난티 | 5f1fde65-01a8-446b-a712-b34828b40509 |
| (주)고운세상코스메틱 (gwss) | 155 | (주)고운세상코스메틱 | b4e467f0-6ba4-4d1c-aca8-49ff052ffdf0 |
| 베네통코리아 (benetton) | 96 | 베네통 | d6b3d71c-ed35-4d49-ab72-0392cf789d9e |
| 에이스하드웨어 (acekakao) | 69 | 에이스하드웨어 | 8afb2332-813e-493f-95c7-cf1f65db3fe7 |
| 아난티 이터널저니 (anantiej) | 67 | 아난티 (통합) | 5f1fde65-… (아난티에 합침) |
| 숭실원격평생교육원 (smart) | 57 | 숭실원격평생교육원 | 4a107cef-67da-4390-88de-1f2049baee71 |
| 우림FMG (woorim) | 56 | 주식회사 우림에프엠지 | 44729573-aff0-4c37-a00b-cea3977260ee |
| 메트로시티 (metrocity) | 46 | 메트로시티 | 70abccd0-d4d6-4bb1-ab31-3b2202aa5060 |
| 이새F&C (isae) | 44 | 이새에프앤씨 | 682956b7-37a3-46b5-9868-b63011bda47b |
| 무주덕유산리조트 (mdysresort) | 31 | 무주덕유산리조트 | f02dde2c-f0bb-4af8-9150-15e651076192 |
| 게스코리아 (guess) | 28 | 게스코리아 | a844d2f2-23de-4157-bd27-1a0b37c60810 |
| 마리오몰 (mariomall) | 27 | 마리오아울렛 (통합) | 9c228259-… (마리오아울렛에 합침) |
| 금강제화 (kumkang) | 18 | 금강제화 | bb1fc50b-7c5b-4080-827e-aef587bcd082 |
| 최선어학원 (choisun) | 16 | 최선어학원 | 0d20b03b-4c66-4205-ae81-a3b53a70481d |
| 에프앤드에이 (fnasms) | 16 | 에프앤드에이 | 4bc0b9d3-f135-4dba-b7de-8967950cb16e |
| 시세이도 (shiseido) | 13 | 시세이도 | c2716774-8282-4a2f-87d7-5c0b3a47f479 |
| 마리오아울렛 (emario) | 11 | 마리오아울렛 | 9c228259-a3ca-4832-9feb-d25572717697 |
| 미구하라 (miguhara) | 10 | 미구하라_대행 | e0de7586-aee8-4ae7-a8c8-b41cf4605e9e |
| 주식회사 인비토 (invito) | 7 | 인비토 | 681fed7a-17df-43d4-bd39-d1a3983195fd |

- **19개 레거시 계정 → 17개 한줄로 company** (아난티·마리오아울렛이 각 2개 레거시 흡수). 템플릿 합계 ≈ **1,278건**.
- 통합 주의: 아난티 ← 아난티+이터널저니 / 마리오아울렛 ← 마리오아울렛+마리오몰.

### 3-2. 제외 (오늘 안 함)
- **기프트스마트 (martsmart, 9)** — 한줄로 `마트스마트`와 이름 유사하나 **다른 업체**(Harold 확인). 신규 생성 트랙으로.

### 3-3. 신규 생성 필요 (서팀장 회의 후 확정 — 34개)
더화이트커뮤니케이션 **1988★** · 제이씨패밀리 199 · 에스디몰 176 · 신성통상 169 · 브이패스 110 · 이비전글로벌 81 · 한국고용노동교육원 74 · 한라의료재단 73 · 교촌에프앤비 50 · 베터라이프 46 · 방위사업청 41 · 주목 36 · 인포필러 35 · 아이올리 23 · 엔그램(ngram 17) · 티앤비소프트 17 · 뷰티뷰티 15 · 한국가스안전공사 13 · 시세이도?(아래 특이사항) · 미구하라 별도? · 기프트스마트 9 · 펫웰페어 9 · 엔그램(edugram 8) · IBK저축은행 5 · 일레븐스퀘어 4 · 산타데이 4 · 에스투컨텐츠 3 · 에스에이치플러스더블유몰 3 · 원신더블유몰 3 · 함께하자쿠나 3 · 스카이컴퍼니 3 · 비즈아이솔루션 3 · 파스텔세상 3 · 여미지 2 · 홈스토리생활 2 · 유성소프트 1

---

## 4. 이관 방식 — A vs B (★ 회의에서 확정)

핵심 갈림길 = **한줄로 IMC 연동이 레거시와 같은 휴머스온 계정인가?** (양쪽 다 IMC 등록 자산 — sender_key·template_code 존재)

- **B (같은 계정, 권장)**: 회사별 발신프로필(senderKey)만 한줄로에 등록 → 한줄로 IMC sync가 IMC 원본에서 템플릿을 끌어옴. **앱 정식 경로**라 안전, IMC와 계속 정합, 레거시 폐기에도 안 깨짐.
- **A (다른 계정)**: 레거시 DB(`kakao_alim_talk_template` + button + review) → 한줄로 `kakao_templates`로 필드매핑 직접 복사(1회 스냅샷). IMC와 분리.

미확정 시 실측: 아난티 senderKey `6be1390acc6dceecd2441f93fd14324d6d82ed1d`로 한줄로 IMC가 그 템플릿을 보는지 확인 → 보이면 B 확정.

---

## 5. 오늘 진행 스코프 + 안전 원칙

- 오늘은 **3-1의 확정 19개만**. 신규 생성 34개는 서팀장 회의 후.
- 실발송 자산(검수상태·senderKey 정합)이라 **한줄로 운영 PG 직접 대량 INSERT는 지양** → 가능하면 앱 정식 경로(B).
- 순서: **아난티 1건 실측** → 정상 확인 → 나머지 18개.
- B 실행 시 한줄로 카카오 프로필/sync 소스 확인 필요(발신프로필 등록 → 템플릿 sync 경로).

---

## 6. 회의 확정 안건 (미결)

1. **A/B — IMC 같은 휴머스온 계정 여부** (전체 방식 결정).
2. **더화이트커뮤니케이션 1,988건**(전체의 44%) — thewc는 이름상 **대행사**. 단일 회사 것인지, 여러 end-client 대행 등록분인지. 단일 company로 밀어넣으면 안 될 수 있음.
3. **인비토 한줄로 중복** — `인비토`(681f…) + `주식회사 인비토`(c7c9…) 2개. 정리.
4. **시세이도 vs (주)한국시세이도** — 한줄로에 둘 다 존재. 레거시 시세이도(13건) 귀속 대상.
5. **신규 생성 34개** — 어느 것을 생성하고 어느 것을 버릴지(폐업·테스트·저가치).
6. **친구톡 템플릿**(`kakao_friend_talk_template`) 처리 — 한줄로는 친구톡 폐지→브랜드메시지.
7. **템플릿 status 값 의미**(1/-1/0/2/-2) 확정 — status=1만 이관할지.
8. **PAY 사이트** 별도 트랙(결제·정산 데이터).

---

## 7. 폐기 순서 (자산 유실 방지 — 절대)

1. **`event_admin` 전체 `mysqldump` 백업**(4,519 템플릿 원본 안전망).
2. 한줄로 이관·검증 **완료 확인**.
3. **그 후에만** 레거시 서버 down·삭제.

→ 순서 뒤집으면 원본 영구 소멸. 백업·검증 전 삭제 금지.
