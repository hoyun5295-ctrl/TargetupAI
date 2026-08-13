# 한줄로 — 관제탑 (STATUS)

> **상시 로드 문서. 30KB 상한.** 룰의 원천은 CLAUDE.md — 이 문서는 "현재 상태"와 "라우팅"만 담는다.
> 재설계 전(2026-07-03 관제탑 재설계 v2) 전체 원본은 git 이력에 보존 — `_backup-20260703-관제탑재설계전/` 폴더는 2026-07-07 삭제(git 이력에서 복구 가능). 필요 시 `git log --all -- 'status/_backup-20260703-*'`로 해당 커밋 조회.
> 사용법: 상황이 생기면 아래 라우팅 표에서 문서를 찾아 **지시된 범위만** 읽는다. 문서 전체 로드 금지. 아카이브는 archive/INDEX.md grep 경유로만.

---

## 1) 라우팅 표 — 이런 경우엔 이 문서

| 상황 | 참조 문서 | 읽는 범위 |
|------|-----------|-----------|
| DB 쿼리 작성 / 스키마 확인 | SCHEMA.md | 대상 테이블 절만 |
| 도메인 작업 착수 전 사고 이력 | lessons/LESSONS_{DB,FRONTEND,BACKEND,DEPLOY,ARCHITECTURE,META}.md | **도메인↔파일 매핑은 CLAUDE.md `read_lessons_first`가 소유**(여기 재서술 금지). 읽는 범위 = 해당 도메인 전체 · 배포는 OPS.md 해당 절 동반 |
| **Harold님이 "브레인스토밍"이라고 말했을 때** · superpowers 스킬 선택 · Codex 라운드 운영·수용 판단 | **COLLAB.md** | 브레인스토밍 = §1 전체 정독 후 그대로 진행(의무) / 그 외 = 해당 절만 |
| **Codex 리뷰를 돌릴 때** — 실행 절차·요청문 규격·멈춤 판정·복구 | **[CODEX-RUNBOOK.md](CODEX-RUNBOOK.md)** | 착수 전 §1·§2(의무) / 20분 무응답이면 §3·§4. 리뷰를 띄우기 전에 반드시 읽는다 — 같은 멈춤을 다섯 번 반복했다 |
| **기능 이름을 부를 때** — 그 기능의 구조·불변 원칙·이력 | **[SOT-INDEX.md §0 기능 상설 SoT](SOT-INDEX.md)** | 해당 기능 행 → 그 기능 문서. **"여정"** · **"싱크에이전트"** · **"자동마케팅"** · **"템플릿"** · **"정산"** · **"이미지 스튜디오"** · **"자사몰 연동"** · **"자기 개선 루프"** · **"마케팅 플래너"** — 9개 기능이 각자 `docs/FEATURE-*.md`를 갖는다. 기능마다 자기 .md가 이력을 소유하고 STATUS는 참조만 한다(신규 기능도 이 형태로 등재) |
| **프로젝트·트랙 SoT 문서·호출어를 찾을 때** | **[SOT-INDEX.md](SOT-INDEX.md)** | 해당 트랙 행만. **신규 프로젝트 SoT는 이 라우팅 표가 아니라 SOT-INDEX.md에 등재한다**(이 표는 도메인 문서 전용 상설) |
| 시스템 구조 파악 | ARCHITECTURE.md | 해당 절만 |
| 자사몰 연동·CDP·커넥터 작업 | INTEGRATIONS.md | 해당 provider 카드 / CDP 공통 절 |
| 버그 수정 | BUGS.md | 해당 버그 항목 (해결분은 archive/BUGS_RESOLVED.md) |
| 과거 작업 조회·회귀 의심 | archive/INDEX.md → TASKS_YYYY-MM.md | grep 적중 항목만 |
| 의사결정 배경 확인 | DECISIONS.md | 해당 ADR |
| 리스크 전체 확인 | RISKS.md | 전체 |
| 싱크에이전트 **증상별 진단**(구조·원칙은 위 기능 문서) | SYNC-AGENT-TROUBLESHOOTING.md | 해당 증상 절 (isae 현장 완료 이력 = archive/SYNC-AGENT-ISAE-2026-06-30-HANDOFF.md grep) |
| 옛 설계서·핸드오프·디버그노트 | archive/DESIGNS/ (archive/INDEX.md 경유) | grep 적중 문서만 |
| Codex 등 외부 에이전트 온보딩·리뷰 판정 기준 | AGENTS.md (레포 루트) | 전체 (경량 유지 — 룰 원천은 CLAUDE.md, 여긴 축약판) |

---

## 2) CURRENT_TASK (활성 작업만)

> **카드 스키마(고정 4줄):** 제목 / `SoT·기억·다음` / `⛔` 금지·불변 조건(있을 때만) / `잔여`. 그 이상 쓰지 않는다. **★0814 — 실측 대기를 열거하지 않는다: `잔여` 줄은 착수 원장이 어느 문서 어느 절인지만 가리킨다.**
> **경위·수치·근본원인·함정은 SoT 문서와 memory가 소유한다.** 여기 재서술 = doc_ownership 위반. 지우기 전 소유 문서에 그 사실이 실존하는지 grep으로 확인하고, 없으면 소유 문서에 먼저 옮긴 뒤 지운다.
> **회전 룰:** 잔여가 0이면 카드를 지운다(원문 = archive/TASKS_YYYY-MM.md + memory). 남은 일만 아래 "완료분 잔여"에 한 줄. 30KB 초과 = 회전 미이행.

### 마케팅 플래너 (AX 월간 대행) — Phase 0~4 + **0814 정정 4건·캘린더 재구성 전량 배포완료**(남은 DDL 0)
> 호출어 **"마케팅 플래너"** → **[FEATURE-MARKETING-PLANNER.md](../docs/FEATURE-MARKETING-PLANNER.md)가 전부 소유**(정체성 §2 · 불변 원칙 §3 · 구조 §4 · 요금 §5 · 단계 §6 · 이력 §7 · 남은 것 §8). 근거 = [시점 설계서](../docs/2026-08-12-ax-marketing-planner-design.md) · Phase 3·4 근거 = [0813 인계 문서](../docs/2026-08-13-planner-phase34-handoff.md)
> ⛔ 불변 원칙은 기능 문서 §3이 소유 — 여기 재서술 금지. 축만 = 미승인=미발송=미차감 / 실행은 당일만 / 취소·실행 직렬화 / 회수는 사람 판정 / 과금 키·환불 규약
> 잔여 = **실측만** — Phase 3·4 5건 + 화면 7건 + 캘린더 화면. **[기능 문서 §8](../docs/FEATURE-MARKETING-PLANNER.md)이 착수 원장** · 0814 정정 4건·캘린더 상세 = [§7-1](../docs/FEATURE-MARKETING-PLANNER.md) · 발송 창 08~21시(KST) · **Codex 적대 검토 0814 취소**(원스텝 우선)

### 자사몰 연동 — Phase 0~4 + **고도몰 주기 수집·여정 소급 가드·권한 점검·조치 필요 배지**(0810(2)~(4)) 코드완료
> 호출어 **"자사몰 연동"** → **[FEATURE-CDP-INTEGRATION.md](../docs/FEATURE-CDP-INTEGRATION.md)가 전부 소유**(불변 원칙 §2 · provider 현황 §4 · 구조 §3 · 이력 §6·§6-3~§6-5 · 남은 것 §7·§7-1). 시점 설계 = [0809 설계서](../docs/2026-08-09-cdp-integration-redesign-design.md), API 스펙 = INTEGRATIONS.md
> ⛔ "자동 수집"은 도는 워커가 있을 때만 / **소급 적재는 데이터만 채우고 발송은 못 한다**(막는 건 발생 시각 창 하나) / 수집 실패로 `status` 변경 금지 / 회사 전체 고객 명단은 관리자 몫 / **끊긴 연동을 미연결로 보여주지 않는다** — 상세 §2-8·§6-4·§6-5
> 잔여 = 문서 §7이 착수 원장(실측 5건 · 네이버·메이크샵 매핑). **Phase 5 분해 완료**(2,499→1,489줄, 40%↓ · §7-1) · **수신 끊김·싱크에이전트 편입은 §6-5에서 종결**. DDL 0 · 롤백 = `CDP_DASHBOARD_V2=false`

### 보안 체계 — 설계 확정·착수 대기 (0809 신설)
> 호출어 **"보안"** → **[설계서](../docs/2026-08-09-security-architecture-design.md)가 전부 소유**(위협 모델 §2 · 실측 현황 §3 · 원칙 §4 · 단계 §5 · 미확인 §6). 여기 재서술 금지. 경위 = 0809 .65 UFW 락아웃 + Harold 지시
> ⛔ **잠그기 전에 두 번째 문(콘솔·예비 허용)을 실측 확인** — Phase 1 전 잠금 작업 금지 / **노출 판정은 패널이 아니라 외부 측정으로**(0809 실증) / 방화벽이 유일 방어인 자산은 결함으로 본다
> 잔여 = Phase 0 즉시 조치 4건(호스팅 비밀번호·이메일 2FA·`.env.bak` 추적 제거·`.gitignore` 키 패턴) → Phase 1 자산·콘솔 경로 측정 → Phase 2 WireGuard. **.65 락아웃은 하나로호스팅 지원 요청 대기 중**

### 자동마케팅 — 재설계 배포완료(0804) · **0805 §12-1·5·6도 배포완료**(커밋 `08605ab9` · 남은 DDL 0)
> 호출어 **"자동마케팅"** → **[FEATURE-AUTOMARKETING.md](../docs/FEATURE-AUTOMARKETING.md)가 전부 소유** — 착수 전 필독 §1(정체성 §0 → 불변 원칙 §2 → 계약 §4). 실측 사실 §10 · 범위 밖 별건 §11 · 기억 [[project_2026_0803_automarketing_targeting_redesign]]
> ⛔ 새 축 판정 기준은 §0이 소유(사건 = 여정 / 상태·변화 = 자동마케팅) — 여기 재서술 금지. **DDL 전량 실행완료(0804 2건 + 0805 1건) · 남은 DDL 0**
> 잔여 = **남은 개발 4건 = [문서 §12](../docs/FEATURE-AUTOMARKETING.md)가 착수 원장**(조건부 대기 = 상품 데이터 · 나머지는 다른 트랙과 함께) + 화면 실측 9건(§12 하단 7 + 0805분 2). 운영을 막는 건 0

### 요금제 무료 메시징 — **0805 전량 배포완료 + DDL 실행완료** · 실측 대기
> SoT [설계서](../docs/2026-08-05-plan-free-messaging-design.md)(구현 결과 §7-A · 확정 기록 §9 · 수량표 §2) · 다음 = 배포 → DDL 4문 → 실측 1건(§8-7)
> ⛔ 총 한도 = 월정액 **10% 하나**를 4유형 분할 · 선불 소진은 되돌리지 않고(§5-1-A) 정산 축은 **`부담 = 차감 + 무료`**(§5-1-B) · 후불은 소진 없이 성공 행에 한도 배분(§5-2) · 잔량 식 하나(`REMAINING_EXPR`) · **DDL은 배포 직후** — 그 전까지 후불 발행·미리보기·요금제 화면은 `DB_MIGRATION_PENDING`으로 막힌다 · TRIAL 0건 / STAFF는 ENTERPRISE 동일
> 잔여 = **실측 2건 = ①월 중 가입 시 그 달 미지급(Harold 예정) ②무료 소진 후 초과분 정상 과금** · 이월 2건(청구서 2페이지 수량 분리 · billing_type 전환 TOCTOU = [정산 문서](../docs/FEATURE-BILLING.md) §7). Codex 4R + 헤더 소비처 전수 확인 완료(critical 2·high 10·medium 2 + 자체발견 2 전량 정정 · 청구 수량 정의는 `billableQuantity` CT 하나)

### 여정 — **0808 이어달리기 + 스튜디오 6건 전량 배포완료**(0802 재설계에 이어)
> 기능 상설 = **[여정](docs/FEATURE-JOURNEY.md)**(호출어 "여정" — 구조·불변 원칙·이력 색인 전부) · 트랙 SoT [재설계 설계서](docs/2026-08-01-journey-redesign-design.md) · [이어달리기 설계서](docs/2026-08-08-journey-succession-design.md)(구현 결과 §9-A) · 기억 [[project_2026_0801_journey_redesign]] · 다음 = 실측
> ⛔ 불변 원칙·판정 계약은 여정 문서와 설계서가 소유 — 착수 전 [여정 문서 §2·§3](docs/FEATURE-JOURNEY.md)부터 읽는다. 이어달리기 = **DDL 0·발송 무변경** · dedup 축은 `trigger_event`(`template_code`로 되돌리면 repeat 3종이 서로를 오차단) · 프리셋은 서버가 계약값으로 덮어쓰고 저장에도 그 표식이 있을 때만 트리거를 싣는다
> 잔여 = **[여정 문서 §8](docs/FEATURE-JOURNEY.md)이 착수 원장**(실측·별건 전량 그 절이 소유 — 0814 이관)

### 레거시 PAY 흡수 (Track D) — 충전·잔액 축 배포완료 + **0811 접수 2건 배포완료**(§15), 컷오버 전
> SoT [통계·인프라](docs/2026-07-07-pay-absorption-track-d-design.md) · [충전·잔액](docs/2026-07-24-agent-prepaid-charge-design.md)(단독 재개용) · 기억 [[project_2026_0724_agent_prepaid_charge]] · 다음 = 7월 실충전 4개(`B0082`·`D0078`·`D0079`·`C0112`)에 `billing_type='prepaid'` 지정(283행 전부 postpaid라 지금은 충전 등록도 요청 탭도 열리지 않는다)
> ⛔ 백필 경계 = 143 `SeqNo 7052`(07-23 14:38) — 컷오버 시 143 MAX가 그보다 크면 초과분 1회 더 / 잔액 권위 행 = `StoreId=CustId`, 대표 행 없는 계정(`B0046` 등) 합산 금지 / §5-4 요청·§5-3 실행·신청 원장 ≠ 지갑 원장 — 혼동 금지(§15) / `deposit_requests` 재사용 폐기 / 고객사 원장 조회는 소유 0건 = `1 = 0`(§15)
> 잔여 = 한줄로 실측 1건 → 직원 143 PAY 입력 중단 → 서수란 선불·단가 자료 · §5-5 고아 대조 워커 · 강문희 143 종료 통지 · §8-8 런소프트 통장 대조 · 표시명·잔액 배포(SoT §13·§14) · **0811 접수 2건 실측 2**(고객사 충전 내역에 직원 충전·차감 표시 / 슈퍼 충전 폼 잔액 표시·충전 후 갱신 — §15. DDL 0) · 별건 피케이포유 인코딩 손상(§2-4)

### 정산 — 호출어 **"정산"** → [FEATURE-BILLING.md](../docs/FEATURE-BILLING.md)가 전부 소유
> 구조·불변 원칙 18개·남은 것 9건·이력 전부 **그 문서 하나가** 갖는다(§7 착수 원장 · §8-6 = 0807분+0807(2) 추기). 상태 = **0806(2)·0807·0807(2)·0808까지 전량 배포완료**(2026-08-08 · ENV `TAXBILL_ARCHIVE_BCC` 등록 포함) · 다음 = 실측
> **자동 발행 첫 실행(08-08 09:00) 실측 완료 — 13건 전부 성공**(§8-6 실측 추기) · ⛔ 크로커다일 `failed` **[재시도] 금지**(§8-4 정정 — 전송이 끝나 지금은 **성공해서 정상 문서가 취소된다**. 관문은 배포 전) · **`failed` ≠ 국세청 미발행**(305는 승인번호가 없다)
> 잔여 = **실측 3건**(아카이브 mobile@ 수신 1건 · 수정 장 재시도 관문 · AI자연어 조건 열) · 화면 실측(0805(2) 6건 · 0806분) · 시세이도 PO · **§7 갈라 둔 9건**(엑셀 · 발송 지연 귀속 · 발송ID · 불변 발송기록[아카이브 outbox 포함] · `getInfo` 폐기[0807(2) 보강] · 재전송 큐 환경 표식[0808 신규] · 이의신청 가드 · 전이 CAS · 사유1 묶음 — `mobile@`은 0808 완료로 제외)

### 싱크에이전트 — **0813 아난티 설치 실측 결함 3부류 정정 = 1.7.1 세트 완료**(0803 커서 재설계에 이어)
> 호출어 **"싱크에이전트"** → **[FEATURE-SYNC-AGENT.md](../docs/FEATURE-SYNC-AGENT.md)가 전부 소유** — 착수 전 필독 §9 · 불변 원칙 §2 · 커서 규약 §4 · 배포 게이트 §5 · 원격 릴리즈 §6 · 이력 §7(0813 최상단 = 이번 정정) · 재싱크·출고 절차 §8 · 기억 [[project_2026_0727_sync_agent_vm_verification]]
> ⛔ **사전 질의서 회신 없이 신규 출고 금지**(★0813 신설 — SoT `sync-agent/PREINSTALL-QUESTIONNAIRE.md` · 절차 = 기능 문서 §8) / "문제없다" 표현 금지 — 상태는 검사 범위·결과로만(경위 = 기능 문서 §7 0813행 + memory)
> 잔여 = **[싱크에이전트 문서 §10](../docs/FEATURE-SYNC-AGENT.md)이 착수 원장**(실측·후속 전량 그 절이 소유 — 0814 이관)

### 0729 브랜드메시지 — 청구축·발송경로 재구축 **전량 배포완료**(`4864d5d9` — 0731 Codex 11R SHIP)
> SoT [청구·개방](docs/2026-07-29-brand-message-billing-design.md) §7 · [발송경로 재구축](docs/2026-07-29-brand-message-qtmsg-agent-design.md) §8 구현 결과 · **§9 표시 축 재구축**(0731 실측이 깬 것 — 배포완료) · 기억 [[project_2026_0729_brand_message_billing]] · 다음 = 재측정(대체발송 `SM`으로) → 브랜드 단가 입력(여미지 `B0227`)·발행 실측
> ⛔ **발송 불가 = Agent 버전 미달**(SoT §9-1) / 지원 유형 = TEXT·IMAGE·WIDE만, 늘릴 땐 `utils/billing-types.ts` 표에만(SoT §5-3) / 축 복원 금지 — 채널=`resolveRefundAxes`, `send_phase='preparing'` 게이트
> 잔여 = 재측정 · 단가 입력·발행 실측 · AI 타겟추출 페이징(별건) · 학습 채널 키 이관(`mysql-refund-sweeper.ts:601` — 저장 키라 이관 판단 필요)

### 0727 여정 알림톡 + 환불 의무 — 전량 배포완료
> SoT 알림톡·잔액 = 기억 [[project_2026_0727_journey_alimtalk_and_agent_tls]] · 환불 = [BUGS.md](BUGS.md) B-0727-1·2 · 다음 = 운영 확인(알림톡 대체문안 CT `utils/alimtalk-fallback.ts` `f91d5ea5` / `balance_transactions.refund_key` 원인별 분리, DDL 실행 완료)
> ⛔ 대체문안 선택이 `대체문안 작성(B)`인데 문안이 비면 저장·활성화·발송 세 지점에서 차단 — `원문 그대로(L)`는 게이트웨이가 우리 `msg_contents`를 그대로 내보낸다
> 잔여 = 운영 확인만 (에이전트 축은 0803 1.7.0에 흡수 — [싱크에이전트 문서](../docs/FEATURE-SYNC-AGENT.md))

### 0731 인앱 이미지 클릭 랜딩 — 배포완료(Codex 4R approve), 실측 대기
> SoT = 기억 [[project_2026_0731_inapp_image_link_studio_event_track]] · 다음 = 실측 3건(포스터 링크 클릭·캐러셀 슬라이드별·인라인 카드 몰 DOM 무손상) — 0721 캐러셀 실측 이 왕복에 흡수. ⚠몰 반영은 SDK 서빙 캐시·브라우저 캐시라 Ctrl+Shift+R 후 확인
> ⛔ `image_link_url` ALTER는 운영 실행 확인됨(SCHEMA 41컬럼) / 블록이 진실인 메시지는 flat 링크를 저장·판독 양층에서 비운다(legacy 폴백 계약 — 완화 금지) / 메시지 DOM 제거는 `data-hanjullo-wrap` 마커 단일 길목(parentElement 추론 복원 금지)
> 잔여 = 실측 3건 · 팝폰 네이티브 이미지 클릭(계약서 절 기준·OTA 별건). 같은 세션의 스튜디오 행사 트랙분(행사 생성·예시 배치)은 0809에 닫혔다 — [이미지 스튜디오 문서](../docs/FEATURE-IMAGE-STUDIO.md) §7

### 다음 세션 (예정)
> 경위·범위·확정 사실은 링크가 소유한다. 여기엔 제목·다음 한 수·호출어만.
> ① **템플릿** — 호출어 **"템플릿"** → **[FEATURE-ALIMTALK-TEMPLATE.md](../docs/FEATURE-ALIMTALK-TEMPLATE.md)가 전부 소유**(구조·불변 원칙·이관 절차·이력·남은 것). 여기 다시 쓰지 않는다. 0804 = IMC 이관 실행 화면 신설·게이트 테넌트 격리·메트로시티 이관.
> ② **0718 성능 후속** — 관측 사이클 1회전: 1순위 campaigns 발송 폴러 인덱스(EXPLAIN 후 처방) · 2순위 `balance_transactions` 잔액 SUM N+1(호출처 추적) · 그 후 M3/롤업. [핸드오프](docs/2026-07-18-frontend-splitting-incident-handoff.md) · [[project_2026_0717_dashboard_performance]]
> ③ **아임웹·아이디룩 시연** — 스토어 등록 확인 → 테스트 몰 OAuth 리허설(pm2 로그+회원가입 1건 webhook) → 시연. INTEGRATIONS.md 아임웹 카드 · [[project_2026_0719_imweb_appstore_idlook]]
> ④ **이미지 스튜디오** — 호출어 **"이미지 스튜디오"** → **[FEATURE-IMAGE-STUDIO.md](../docs/FEATURE-IMAGE-STUDIO.md)가 전부 소유**(구조·불변 원칙·카탈로그 규약·이력·남은 것 §8). 여기 다시 쓰지 않는다. 0811 = 249종·추천 용도 축·갤러리 페이징. **0813 = 제작 화면 재설계**(대형 예시 + 입력칸 위 Tip · 오버레이 시도는 접음 — 문서 §7 0813행). 잔여 = 문서 §8.
> ⑤ **자기 개선 루프** — 호출어 **"자기 개선 루프"** → **[FEATURE-AI-LEARNING.md](../docs/FEATURE-AI-LEARNING.md)가 전부 소유**(정체성 §2 · 불변 원칙 §3 · 단계 §6). 0811 **Phase 0 배포완료**(문자 클릭 → 문안 학습 원장 · DDL 0). 다음 = Phase 1 승자 환류.
> ⑥ **비토 라인 14·15 미결 4건** — ①배정 화면 게이팅 범위(Harold 미확인) ②라인그룹 DELETE가 `users.line_group_id` 미체크 ③sweeper 2종 bulk-only 사각 ④Codex 결과 미수령. [[project_2026_0717_bito_line14_15_lineadmin]]
> ⑦ **인앱 잔여** — 웹 실측(쿠폰·CTA 정렬·허용표·AI 생성 1건) · 0717 직원 디버깅분 코드완료·미검증 · M3 네이버 env 키 등록 시 활성 · M6 이메일·인앱 이식(별도 설계). [[project_2026_0717_inapp_debug_session_incomplete]]
> ⑧ **Local AI Ops Hub** — 설계 3부작 완료·Harold 결정(H-2 M0 착수) 대기. 실무보다 후순위. [[project_2026_0715_local_ai_ops_hub]]
> ⑨ **선불 자동충전(입금 감지)** — ★0811 **보류**(월 입금 20건 미만 — 재개 조건은 기술이 아니라 건수). 축 조사 4종·구조적 사실·재개 첫 한 수 전부 [SoT §8](docs/2026-07-28-auto-charge-ibk-design.md). 호출어 "자동충전 개발재개"
> ⑩ **원스텝 AI 컨텐츠 생성 — ★0814 최우선** · 호출어 **"원스텝 생성"** → **[설계서](../docs/2026-08-13-one-step-content-interview-design.md)가 전부 소유**. Phase 0~4 배포·DDL 완료 · 다음 = 실측 1건 + Codex(§7).
> ⑪ **CLAUDE.md 룰 병합** — 호출어 **"룰 병합"**. 28룰 → 원칙 10그룹. 진단·그룹표·절차 = [[feedback_claude_md_rule_merge_plan]]. ⛔금지 문장 0 손실 · 한 그룹씩 승인 · 별도 세션에서.
> (지속) 비토 API 발송 경로 전환 검토 [[project_2026_0710_bito_api_direct_test]] · (보류) 팝폰 SDK 검증

---

### 완료분 잔여 — ★2026-08-14 폐지 (Harold 방침)

> **실측 대기는 STATUS에 두지 않는다.** 배포가 끝난 건의 실측은 해보다가 문제가 나면 그때 고치면 되는 일이고,
> 목록으로 상시 로드에 얹으면 읽지 않는 표가 매 세션 비용만 먹는다(0725 신설 이래 재팽창의 진원지였다).
> **행선지** — 기능 문서가 있는 트랙은 그 문서의 "남은 것" 절(열면 파악된다) · 없으면 해당 memory 파일 · 이력은 `archive/TASKS_YYYY-MM.md`.
> 07월분 13행 전량은 [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) 최하단 "2026-08-14 회전" 절로 이관(유실 0 · 살아 있는 운영 주의 2건도 그 절이 소유).

| 건 | 남은 것 | 상세 |
|---|---|---|
| **0808·0811 슈퍼관리자 대기 뱃지 축** | 배포완료 · 실측 4 + 추가 과제 2 = [LESSONS_FRONTEND](lessons/LESSONS_FRONTEND.md) 핵심원칙 상단 2항 · 계약 테스트 3본이 축을 고정 | 08월분이라 잔류 — 다음 회전 대상 |

> 회전 이력: 0721 · 0722 · 0725 · 0728(스키마 전환) · **0814(07월분 13행 전량 archive 이관 + 이 표 폐지)**.

---

## 3) 진행 예정 작업 (TODO)

> 완료분 원문 = [archive/DONE_LOG_2026.md](archive/DONE_LOG_2026.md) "STATUS §3 TODO 완료분 회전 (2026-07-07)" 절.

- [ ] **직원 버그리포트 실동작 검증**: 8차 B8-01~B8-13(app.hanjul.ai) · 9차 S9-04/S9-08(발송결과 성능 + sent_at 정확성) · D39 세션2(필터 UI + AI 보유필드)
- [ ] **AI 맞춤한줄 Phase 2**: 실서비스 통합 테스트(실제 발송) — Harold 검증 대기
- [ ] **카카오 알림톡 템플릿 관리(Humuson API v2.1.1)**: 고객사 CRUD+검수+발신프로필 UI · 슈퍼 고객사별 연동 설정(humuson_user_id·uuid) · 발송 시 APR 상태만 선택 · 백엔드 프록시 `/api/kakao-templates/*`+kakao_templates 확장+상태 전이 규칙 · Phase 2(이미지 업로드·알림 수신자·발신프로필 그룹)
- [ ] **선불 요금제**: 카드결제 = **이니시스 계속 사용**(★2026-08-11 Harold 결정 — KCP PG 연동 계획 전면 철회) → 입금감지 자동화 = 금융결제원 오픈뱅킹 축([자동충전 설계서 §8](../docs/2026-07-28-auto-charge-ibk-design.md) — IBK 예금조회 API 미제공으로 축 전환)
- [ ] **보안**: 슈퍼관리자 IP 화이트리스트 · SSH 키 인증 전용 전환(선택)
- [ ] **인비토AI**: 데이터 축적 후 모델 학습 파이프라인 설계 · 이용약관 제14조 배포 후 서비스 공지(조항 신설 2026-07-03 완료)

---

## 4) 리스크·결정·완료 이력 — ★2026-08-14 폐지(중복 제거)

> 세 절을 지웠다. **행동 지시는 CLAUDE.md가, 이력은 전용 문서가 소유한다** — 같은 지시가 두 곳에 있으면 한쪽만 고쳐져 갈라진다(실제로 §6이 갈라져 있었다: 폐지된 표를 가리키고 있었다).
> **리스크**(옛 §4 R1·R2·R23) → 행동 지시는 CLAUDE.md 「개발 안전」(tsc 0 · pg_dump 백업 · Docker 127.0.0.1)이 이미 소유. 대장·이력 = [RISKS.md](RISKS.md)
> **결정**(옛 §5) → [DECISIONS.md](DECISIONS.md). ⚠ 2026-03-16 이후 결정은 미등재로 TASKS·memory에 산재 — 소급 등재는 별도 과제
> **완료 이력**(옛 §6) → [archive/DONE_LOG_2026.md](archive/DONE_LOG_2026.md) · 월별 = [archive/INDEX.md](archive/INDEX.md) → TASKS_YYYY-MM.md grep
