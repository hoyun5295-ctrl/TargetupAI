# 알림톡 템플릿 관리 — 기능 상설 SoT

> **호출어 = "템플릿"** (또는 "알림톡 템플릿", "템플릿 이관").
> 이 문서가 **템플릿 기능의 구조·불변 원칙·이관 절차·이력**을 소유한다. STATUS.md는 상태와 잔여만 갖고 여기를 참조한다.
> 시점별 설계 근거는 설계서가, 실행 절차는 런북이 소유하고 여기엔 링크만 둔다 — 정보 하나는 소유 문서 하나.
>
> 등재 = `status/SOT-INDEX.md` §0 · 원칙 = memory `feedback_feature_doc_owns_history`

---

## §1 착수 전 필독 순서

1. **§2 불변 원칙** — 어기면 발송이 죽거나 남의 회사 자산을 건드린다
2. **§3 구조** — 테이블·엔드포인트·화면이 어떻게 물려 있는가
3. 이관 작업이면 **§4 이관 절차** (딜러 이관 → 우리 쪽 들여오기)
4. 그다음 §6 이력에서 같은 일을 언제 어떻게 했는지 확인

---

## §2 불변 원칙

### 2-1. 템플릿과 발신프로필은 **같은 회사**에 있어야 한다

발송 게이트가 `JOIN kakao_sender_profiles p ON p.id = t.profile_id AND p.company_id = t.company_id`를 요구한다.
템플릿만 다른 회사로 옮기면 그 템플릿은 **타사 프로필을 가리키는 상태**가 되어 승인 게이트에서 막힌다.

이 조건은 2026-08-04에 들어갔다. 그전에는 `p.id = t.profile_id`만 봐서, 템플릿의 `profile_id`가 다른 회사 프로필을 가리키면 **그 회사의 승인 상태로 게이트를 통과**했다(Codex 적대검증 critical). 게이트가 있는 곳은 넷 —
`routes/campaigns.ts`의 `/direct-send` 차감 앞 게이트·큐 적재 직전 재확인·`/direct-send/commit`, 그리고 `utils/auto-campaign-worker.ts` 자동발송 가드.

### 2-2. 옛 senderKey로 이관 여부를 판정하지 않는다

딜러 이관(다우 → 휴머스온)은 **senderKey를 새로 발급한다.** 옛 키로 `getSender`를 부르면 `4011 찾을 수 없음`이 나오는데, 그건 "이관 안 됨"이 아니라 "그 키로는 없음"까지만 증명한다.
판정 수단은 **계정 발신프로필 목록을 채널명으로 검색**하는 것이다(`GET /api/alimtalk/senders/imc?name=`).
반대로 **템플릿 코드(`bizp_…`)는 그대로 유지되고 `templateKey`만 새로 발급**된다. 그래서 게이트웨이 매핑에서 갱신할 것은 `tmplcd`가 아니라 `senderkey` 하나다.

### 2-3. pull 전에 그 bill의 `auto_push`를 끈다

적재 워커 `runScanPass`의 대상 조건은 `status='APPROVED'` + 코드 비어있지 않음 **둘뿐이고 `B_` 접두 필터가 없다**(pull 대상 판정만 `B_`다).
그래서 `bizp_` 템플릿을 pull하면 `auto_push_enabled=true`인 bill에서 **5분 안에 운영 게이트웨이로 자동 upsert**가 나간다.
더 나쁜 쪽은 그다음이다 — 이미 매핑에 있는 코드는 `ON CONFLICT (bill_id,tmplcd) DO NOTHING`이라 **죽은 옛 senderkey를 그대로 유지**하고, 대조 패스도 게이트웨이 실값 채택 방향이라 고치지 않는다. 조용히 발송 불가 경로가 남는다.
⇒ pull·대조가 끝나면 **반드시 다시 켠다.** 끈 채 방치하면 그 회사의 신규 승인분 자동 등록이 조용히 멈춘다.

### 2-4. `template_name`은 로컬 라벨이다

IMC 등록 payload에 들어가지 않고(리스트 검색 파라미터일 뿐), `kakao-template-sync`도 `template_code`·`status`만 갱신하며 이 컬럼을 건드리지 않는다.
그래서 고객사 원본 관리명 복원은 **순수 로컬 UPDATE**로 안전하다(IMC·재승인·발송 무접촉). 반면 `custom_template_code` 수정은 IMC를 호출하므로 성격이 다르다 — **필드마다 로컬/원격 여부를 확인하고 경로를 고른다.**

### 2-5. 이관의 "완료"는 자기 카운트가 아니라 **외부 기준 차집합**으로 증명한다

`failed 0 / 중복 0 / 재카운트 일치`로 종결 보고했는데 게이트웨이가 실제 라우팅하는 코드 62개가 우리에게 없던 적이 있다(0715 아난티, 5일간 무증상).
근본은 회사의 senderKey 2개 중 1개만 연결돼 **그 키의 템플릿이 pull 대상에 아예 안 들어간 것**이었다 — 대상에 없으니 실패도 안 나고 카운트도 맞는다.
⇒ 판정식은 **원천이 아는 키 집합 − 우리가 가진 키 집합 = 공집합**이다. 0이 아니면 사유를 분류한다(대상 키 미연결 / 원천에만 존재 / 귀속 불일치 / INSERT 실패). 뭉뚱그린 "N건 누락"은 조치로 이어지지 않는다.

### 2-6. 대량 import는 후속 워커의 WHERE에 걸리는지 먼저 본다

과거 확정 템플릿 847건을 넣으면서 `alarm_notified_status`를 안 채워, 5분 폴링 job의 `status IN (종결) AND alarm_notified_status IS NULL` 조건에 영구 잔존했다.
수신자가 등록된 회사였다면 **과거 승인 건이 알림 SMS로 실발송**된다. 과거분 적재 시 그 행을 알림·재시도 대상에서 빼는 컬럼을 INSERT에서 함께 채운다.

---

## §3 구조

### 3-1. 테이블

| 테이블 | 역할 | 비고 |
|---|---|---|
| `kakao_sender_profiles` | 발신프로필(채널) | `profile_key`=senderKey · `yellow_id`=@채널ID · `company_id` |
| `kakao_templates` | 알림톡 템플릿 | `profile_id` FK · **`(company_id, template_key)` UNIQUE** · `template_code`는 IMC 원본 유지 |
| `brand_message_templates` | 브랜드메시지 템플릿 | 검수 없음(D130 신설) |
| `gateway_bill_mappings` | 게이트웨이 납입자ID 연결 | **`auto_push_enabled`가 자동 등록 게이트**(§2-3) |
| `gateway_template_mappings` | 게이트웨이 코드별 매핑 | 발송 라우팅의 실제 축(`bill_id`·`tmplcd`·`senderkey`) |

컬럼 상세 = [SCHEMA.md](../status/SCHEMA.md) 해당 절.

### 3-2. 엔드포인트 (super_admin 전용, 이관용)

| 경로 | 하는 일 |
|---|---|
| `GET /api/alimtalk/senders/imc?name=` | IMC 계정 발신프로필 **검색**(읽기 전용, DB 무접촉). 이관 판정 수단(§2-2) |
| `GET /api/alimtalk/senders/imc/:senderKey` | 단일 키 raw 조회 |
| `POST /api/alimtalk/senders/import` | IMC 프로필을 **우리 회사에 연결**. 중복 키는 409 |
| `POST /api/alimtalk/templates/import` | 그 senderKey의 IMC 템플릿을 `kakao_templates`로. **`dryRun` 기본 true** · 회사 내 기존 키/코드는 skip(멱등) |
| `GET /api/alimtalk/templates/imc/probe` | IMC 목록 raw 구조 확인(디버그) |

`templates/import`는 IMC 계정 **전체 목록을 페이지네이션으로 끝까지 훑고** `senderKey` 일치분만 고른다. 0건이면 `imcScanned`(훑은 총 건수)를 함께 돌려준다 — 그 숫자가 크면 "IMC에 그 프로필 템플릿이 없다"는 뜻이고, 작으면 목록 조회가 끊긴 것이다.
**부분 스캔으로 진행하지 않는다** — 중간 페이지 실패 시 502로 중단한다(누락 import가 "완료"로 보이는 것을 막는다).

### 3-3. 화면 (슈퍼관리자)

- **발신프로필 관리** — `components/alimtalk/AlimtalkSendersSection.tsx`. 헤더 [IMC에서 가져오기] → `ImcProfileImportModal`(**full 모드**: IMC 검색 → 연결 → 템플릿 가져오기)
- **템플릿 관리 탭** — `pages/AdminDashboard.tsx`. 헤더 [IMC에서 가져오기] → 같은 모달의 **`templateOnly` 모드**(이미 연결된 프로필을 골라 템플릿만). 이미 연결된 키로 `senders/import`를 부르면 409라 그 단계를 지나지 않는다
- 목록에 **`채널` 컬럼**(프로필명 + `@채널ID`) — 대행사는 한 회사 밑에 여러 브랜드 채널을 갖는다

---

## §4 이관 절차 (딜러 이관 → 우리 쪽 들여오기)

전제 = 상대(휴머스온)에서 딜러 이관이 끝나 있어야 한다. **프로필이 먼저 끝나고 템플릿이 뒤따르는 일이 잦다.**

1. **IMC 계정에서 채널명으로 검색** — 옛 senderKey로 찾지 않는다(§2-2)
2. 대상 bill의 **`auto_push` 끄기**(§2-3)
3. **프로필 연결** → **템플릿 가져오기**(미리보기 → 반영)
4. **차집합 대조** — 원천이 아는 코드 − 우리 코드 = 0인지(§2-5)
5. **`auto_push` 복귀**
6. 그다음은 상대 몫 — 게이트웨이 매핑 `senderkey` 갱신. **1건만 갱신해 실발송 결과코드를 확인한 뒤 전량 적용**한다(6원칙 ⑤). 옛 경로로 지금 발송이 되는지는 우리 쪽에서 확인 불가하다

> `/senders/import`는 IMC의 `unsubscribePhoneNumber`(080 무료수신거부)를 가져오지 않는다 — 광고성 발송을 쓸 회사면 따로 챙긴다.

레거시 덤프(event_admin)는 **대조용**이다. IMC에 원본이 없는 코드의 본문이 거기에만 있다. 하지만 덤프에는 `template_key`가 없고(레거시는 `template_code`만), 거기서 만든 행은 IMC에 대응 원본이 없어 30분 동기화 워커가 못 찾는다 — **넣는 소스로 쓰지 않는다.**

---

## §5 아직 안 끝난 것

- **메트로시티 → 유에스소프트**(서수란 0803 접수) — 프로필 연결·템플릿 가져오기 완료. 남은 것은 상대의 게이트웨이 매핑 `senderkey` 갱신(§4-6)
- **아이올리(`P0019`) 26건 매핑 `senderkey` 갱신** — 0730부터 미결. 1건 실발송 확인이 선행
- 68코드 + 3브랜드(제이씨패밀리·마크앤로나·혼가먼트)는 **휴머스온 등록이 선행**(우리 작업 아님)
- IMC 계정 발신프로필 252 vs 한줄로 등록 205 — 미연결분 점검
- 0723자 점검표 회신 수령 → 템플릿관리자 흡수(Track B+C) 컷오버. 병행 = M4 실발송 1건 · 497 기준 · M5(B-3 계정·`Bill_ID`) · 브랜드 스코프(B-2)

---

## §6 이력 색인

| 시점 | 무엇 | 검증·근거 |
|---|---|---|
| 0714~0715 | Track B-1 — IMC 프로필 연결·템플릿 import 엔드포인트 신설 | [설계 §5-1](2026-07-14-template-migration-track-bc-design.md) |
| 0715 | 아난티 pull "완료" 오보고 → **차집합 판정으로 전환**(§2-5) | 게이트웨이 B_ 코드 62개 누락 5일 무증상 |
| 0720 | 게이트웨이 자동 등록 개통 — 밀린 720건 전량 push(실패 0)·auto_push 33 bill ON·마스터 게이트 ON | 로그 실측 |
| 0722 | 이관으로 유실된 고객사 원본 관리명 복원(3,242건·remainDiff 0) | §2-4 근거 |
| 0730 | **회사 병합 CT 신설**(`utils/company-merge.ts` + `POST /companies/:id/merge`) — 계정명이 달라 한 업체가 회사 둘로 생긴 3건 | dryRun→실행→외부 SELECT 3중, 잔존 0·`verified: true` · Codex 2R |
| 0730(2) | 아이올리 딜러 이관 실측 — **옛 키 4011**(§2-2)·**auto_push 함정**(§2-3)·26건 pull | 차집합 대조(양쪽 26·게이트웨이만 68·IMC만 0) |
| **0804** | **IMC 이관 실행 화면 신설** + 게이트 테넌트 격리 + 목록 결함 3건 | 아래 §6-1 |

### 6-1. 0804 상세

- **이관 화면이 없었다.** 엔드포인트 3개는 0714~0730에 다 있었는데 배선이 0이라, 이관할 때마다 사람이 토큰을 들고 직접 호출했다(0730 아이올리도 그랬다). `ImcProfileImportModal` 신설 — 새 API·새 로직 0, 배선만. 모달이 순서를 강제한다(회사·채널명 → 연결 → 미리보기 → 반영).
- **게이트가 타사 프로필을 허용했다**(Codex 2R critical) — §2-1. 4곳 차단.
- **회사 목록이 20개만 떴다.** `GET /api/companies`가 기본 `limit=20` + `created_at DESC`인데 파라미터 없이 불렀다. 발신프로필 등록 Wizard도 같은 목록을 써서 **20개사 밖 회사는 그동안 선택 자체가 불가**했다. `limit=1000` 명시 + 가나다순 정렬 + 검색(`SearchableSelect`).
- **드롭다운이 잘렸다.** 원인은 모달 크기가 아니라 회사 선택이 `overflow-y-auto` 안에 있던 것 — 모달만 키웠으면 잘리는 위치만 내려갔다. 1단계를 스크롤 밖 고정 영역으로 분리.
- **목록에 채널이 없었다.** 대행사는 한 회사 밑에 여러 채널을 갖는데 회사명만 보여 상세를 열어야 했다. `profile_name`은 이미 응답에 있었고 화면이 안 쓰던 것 — `yellow_id`만 더해 컬럼 신설.
- **템플릿 화면에도 진입점**(`templateOnly` 모드) — 프로필은 이미 연결됐고 템플릿만 다시 받아야 하는 경우가 실제로 났다.

---

## §7 뒤집힌 판단

- **"템플릿만 옮기면 된다"** → 옮길 수 없다. 프로필이 같은 회사에 없으면 발송 게이트가 막는다(§2-1). 프로필을 함께 옮기거나 대상 회사 프로필로 재연결해야 한다.
- **"회사 병합 도구가 있으니 그걸 쓰면 된다"** → 대행 관계는 병합이 아니다. 병합은 게이트웨이 bill·PAY 발송ID까지 옮겨 **청구 축이 바뀐다.** 별개 업체면 발신프로필·템플릿만 움직인다.
- **"레거시 덤프에서 넣자"** → 넣는 소스로 쓰지 않는다(§4 끝). 덤프에는 `template_key`가 없고 IMC 대응 원본이 없어 동기화 워커가 그 행을 영영 못 찾는다.
- **"이관됐는지 옛 키로 조회하면 된다"** → `4011`이 나온다. 키는 새로 발급된다(§2-2).

---

## §8 이관 트랙 전사 (2026-07-05 ~ 08-04)

레거시 카카오 템플릿관리자(event-admin, 143)를 한줄로로 흡수한 트랙. **memory에 흩어져 있던 이력을 2026-08-04에 이 문서로 모았다.**

### 8-1. 소스와 매칭 (0705~0714)

- 소스 = `event-admin.invitocorp.com`, MySQL **143:3388 `event_admin`**, 계정 `invito`(비번은 jar `application.yml` `live_share` 프로필). `display_name`이 utf8이라 `--default-character-set=utf8` 없이 조회하면 한글이 `?`로 깨진다(데이터는 정상).
- 테이블 = `user`(59, 업체명=`display_name`) · `kakao_sender_profile`(261, `sender_key`=IMC senderKey) · `kakao_alim_talk_template`(4,519 → 0730 4,537, `status` int **1=통과**/-1 반려) · `_button` · `_review` · `kakao_friend_talk_template`(친구톡은 카카오 공식 폐지).
- 매칭 = `display_name` 정규화. **확정 19 · 신규 34.** 더화이트커뮤니케이션 1,988건 = 전체의 44%(대행사).
- **통과 4,299의 분포 = `B_`(휴머스온) 76% / `bizp_`(다우) 18% / 업체지정 5%.** ⇒ **pull 대상은 `B_`만이고 나머지 24%는 기존 게이트웨이 매핑이 계속 라우팅한다.**

### 8-2. 갈림길 — DB 복사(A) vs IMC pull(B)

레거시 DB를 우리 테이블로 복사하는 A안과, senderKey만 잇고 IMC에서 원본을 끌어오는 B안이 있었다.
**B 채택.** 근거 = 한줄로 IMC와 레거시가 **같은 휴머스온 계정**임을 실측으로 확정(아난티 `getSender('6be1390acc…')` → `0000`·`@아난티`·status A). 재검수 쟁점이 소멸하고 폐기에도 강하다.
그때 없던 것은 **import 2종뿐**이었다(기존 senderKey 연결 + IMC 템플릿 pull→행 생성). 등록·검수·승인 감지는 이미 구현돼 있었다.

### 8-3. Track C — 게이트웨이 매핑 API (강문희)

발송 라우팅은 게이트웨이가 자체 저장하는 매핑이 결정한다. 그 매핑을 우리가 자동으로 넣는 축.

- `http://<IP>:25230/tmpl-mgr` · **PUT=upsert(키 = `billid`+`tmplcd`)** / GET=조회 · 62 화이트리스트(밖은 무응답) · 응답 `00`조회/`01`update/`02`insert · **1초 500회 초과 reject**(워커 속도 제한 필수) · **삭제 API 없음**(중계서버 웹관리자에는 있다 — 자동 삭제는 배제하고 대조 워커가 고아 행만 표시).
- **`54`=P코드 / `58`=R코드 계정** — billid 접두 하나가 엔드포인트와 usemod를 동시에 정한다.
- **billid = 계정이 아니라 고객사(납입자ID) 단위** → `companies` : 납입자ID = 1:1.
- ⛔ **`tran_tmplcd`를 빈 값으로 보내지 않는다.** 정의서는 "공백이면 tmplcd로 채움"인데 실측은 **정반대로 `tmplcd`까지 비워졌다**(0720 당일 수정됨). 회피책(항상 `tmplcd` 복사)은 회귀 방어로 유지한다. 운영 4,681행에서 인비토코드≠외부템플릿코드는 **0건**이라 이 정책이 100% 정합.
- ⛔ **`usemod`는 서버 상수가 아니라 행 단위 값이다.** 54에도 HM4가 존재한다(과거 잔재). **기존 고객사는 GET으로 현재값을 읽어 유지**한다 — 상수로 덮으면 HM4가 유실된다. 서 팀장 구두값(54=3/58=6)은 신규 기본값으로만.

### 8-4. 대량 이관 실행 (0720)

- 시드 4,681행(서 팀장 엑셀 「템플릿관리자 등록 목록」 시트 카톡템플릿매핑관리) → `gateway_bill_mappings`·`gateway_template_mappings` 적재. 대조 실측에서 **핵심 3필드(tmplcd·tran·usemod) 전량 일치**, 드리프트 1,482건은 전부 `billnm` 접미사 차이(게이트웨이 표기 `_HU`).
- **정정 하나가 결정적이었다** — 대조가 시드 행 차이를 "재push 대기"로 돌려 엑셀 스냅샷이 운영을 덮어쓸 뻔했다. ⇒ **시드 행은 게이트웨이 실값 채택(자가치유), 시드 행이 게이트웨이에 없으면 failed(자동 재등록 금지).**
- 템플릿 pull = **29곳 3,579건·프로필 198개**, 실패 0, 게이트웨이 `B_` 코드 대비 누락 0. 이관 총량 = 템플릿 4,426 · 프로필 199.
- **0715 아난티 pull이 미완이었음을 여기서 발견했다** — §2-5의 기원. senderKey 2개 중 1개만 연결돼 그 키 템플릿이 대상에 아예 안 들어갔다.
- 대조 계약 정정 = 기준은 **distinct 코드**(bill 2개 회사는 같은 코드가 54·58 양쪽에 등록돼 행이 2배), 판정은 **포함 관계**(IMC가 더 많은 게 정상), 누락은 **사유 4분류**(sender_not_connected·not_in_imc·imc_sender_mismatch·insert_failed).
- 게이트웨이 자동 등록 개통 — 밀린 720건 전량 push(실패 0) → auto_push 33 bill 전량 ON → 마스터 게이트 ON. **밀린 물량 0인 곳도 켜야 한다**(안 켜면 그 회사의 신규 승인분 자동 등록이 조용히 멈춘다).
- 계정 생성 규칙 = **`login_id`는 레거시 `user.user_id` 핸들 우선**(bill 코드로 만들었다가 정정). 초기 비번 `qwer1234` + 강제 변경.
- **회사 1실체 + 축 2연결** — 카카오는 `gateway_bill_mappings`(bill), PAY는 `company_agent_ids`(CustId). 겸용은 연결만 하고 회사를 새로 만들지 않는다.

### 8-5. 회사 병합 (0730)

계정명이 달라 한 업체가 회사 둘로 생성된 3건(쎌렉박스·topcleaningup·아이올리)을 합쳤다. CT = `utils/company-merge.ts` + `POST /api/companies/:id/merge`(super_admin·dryRun 기본).

- 축은 **카탈로그에서 파생한다** — 손으로 고르면 반드시 빠뜨린다(3연속 실증: 회사 축 3개·UNIQUE 2개·간접 FK 3개 누락). 모르는 축이 나오면 통과시키지 말고 멈춘다(fail-closed).
- `company_id`가 없는 연결 테이블은 회사 축 열거로 안 잡힌다(`user_sender_profiles`). 등재는 이름이 아니라 **(자식, 자식컬럼, 부모) 서명**으로.
- move 6(발신프로필·알림톡·브랜드 템플릿·bill·매핑·PAY 발송ID) / keep 4(계정·요금제 이력·회사 설정·고객코드 채번). **옛 회사는 삭제 금지**(FK CASCADE로 자산이 딸려 지워진다).
- ⛔ **대행 관계는 병합이 아니다**(§7) — 병합은 청구 축까지 옮긴다.

### 8-6. 남은 위험 (기록)

게이트웨이 적재 워커는 병합 잠금을 잡지 않아, 옛 상태를 읽은 직후 병합이 커밋되면 `gateway_template_mappings` 1행이 옛 `company_id`로 남을 수 있다. 발송은 `bill_id` 축이라 라우팅은 안 깨지고, 도구가 멱등이라 재실행으로 흡수된다. 모든 writer에 분산 잠금 도입은 불수용.

---

## §9 관련 문서

- 트랙 설계 = [2026-07-14-template-migration-track-bc-design.md](2026-07-14-template-migration-track-bc-design.md) §1·§4
- 회사 병합 = `utils/company-merge.ts` 헤더 주석(축 표·안전장치)
- 레거시 서버 폐기·백업 = memory `project_2026_0703_legacy_server_decommission`(event_admin 덤프 위치·복원 절차)
- 이관 이력 원문 = memory `project_2026_0705_legacy_template_migration`
