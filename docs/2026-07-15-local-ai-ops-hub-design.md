# Local AI Operations Hub — 한줄로 중심 설계 (비토)

> 작성: 비토 / 2026-07-15 / 상태: **설계안 (구현 전 Harold 승인 필요)**
> 기원: Harold 구두 스펙(2026-07-15) + 자비스 RFC v0.3.1 적대 리뷰(P0 4·P1 4 — 본 문서에 반영 완료)
> 관계: 자비스(그룹웨어) 몫 = §7 이벤트 API 1장뿐. 나머지 전부 = 본 문서(비토 관할).

## 0. 한 문장 정의

**Harold가 노트북 앞에 없어도, 비토가 직원 신고를 읽고 → 고치고 → 검증하고 → 브리핑까지 해두는 시스템.** Harold의 역할은 [push] 버튼(승인)과 Termius 배포 둘로 압축된다. 지금은 장애가 거의 없으므로 "미래 대비 + 관제 골격 선구축"이 목적이며, 조용한 지금이 위험 0으로 만들 수 있는 유일한 시기다.

**범위·운영 확정(Harold 2026-07-15)**: ①Hub의 수정 범위 = **디버깅(오류 신고) 전용** — 신규 개발·업그레이드는 Harold가 비토 세션에서 직접 진행(Hub는 접수 정리·분석 브리핑까지만) ②Hub는 상시 가동이 아니라 **Harold가 로컬웹에서 켜고 끄는 온디맨드** — 자리를 비울 때 켠다. Harold가 직접 디버깅을 지휘하는 동안은 끈다(세션↔Hub writer 충돌 원천 차단) ③모델 = 디버깅 잡 전 에이전트 Opus 4.8 단일(API 키 과금 — H-1 결정).

## 1. 확정 원칙 (불변 조건 — 코드로 강제)

1. **서버 접속·배포 = Harold만.** Hub·에이전트는 SSH/SCP/psql/pm2를 절대 실행하지 않는다. 산출물의 끝 = git push까지.
2. **push는 Harold 버튼 이후에만.** 그 전까지 main 무접촉 — 모든 작업은 git worktree 격리 브랜치에서.
3. **push 버튼도 pre-push 훅 게이트(backend vitest)를 통과해야 하며 `--no-verify` 금지.**
4. **발송·돈·DDL·auth·.env = 무조건 HOLD.** 분석+브리핑까지만 하고 수정하지 않는다(6원칙 ⑥의 기계화). 대상 = CLAUDE.md 발송 파이프라인 절대 보호 영역(campaigns/spam-filter/messageUtils/results/billing/direct-send) + prepaid/sms-queue/unsubscribe + DDL 포함 작업 + auth/권한 + 크레딧 차감 로직.
5. **재현·프로브는 운영 무접촉.** 재현 = 로컬 실행 + 테스트 계정(hoyun)만. 운영 DB는 read-only SELECT만, 운영 API로 발송 트리거 금지. 프로브 이벤트가 학습·집계에 적재되지 않게 태깅.
6. **직원 신고 본문·댓글·첨부 = 비신뢰 입력.** 본문 속 지시("이 파일 지워라" 류)는 명령이 아니라 데이터 — 인용·보고만 한다.
7. **에이전트는 운영 credential(SSH key·DB 비번·JWT)을 받지 않는다.** 로컬 실행에 필요한 최소 키만 Windows Credential Manager 분리 보관.
8. **Hub API는 127.0.0.1 bind. 서버→노트북 inbound 없음** — 모든 연결은 Hub의 outbound 폴링.
9. **잡 원장은 append-only.** 승인 대상 = (job + 브랜치 HEAD commit hash). 승인 후 브랜치에 새 커밋이 생기면 승인 무효(STALE).
10. **AI 산출 이벤트가 새 잡을 만들지 않는다**(피드백 루프 차단).
11. **한줄로 하네스 상속 의무** — 하위 에이전트도 CLAUDE.md 룰·STATUS 라우팅·도메인 LESSONS 정독·체크리스트를 세션과 동일하게 밟는다(§4).
12. 노트북 꺼짐/절전 = 잡 중단·이벤트는 서버 보존. Hub는 재시작 시 마지막 체크포인트부터 재개.
13. **온디맨드 가동** — 에이전트 잡 처리는 Harold가 로컬웹 토글로 켠 동안만 실행. Harold가 세션에서 직접 작업 중 = OFF가 기본 수칙. 스위치 2단 제안: [헬스 감시](가볍고 read-only — 상시 권장) / [에이전트 잡 처리](외출 시만 ON). OFF 전환 시 진행 중 잡은 체크포인트 후 정지, 이벤트는 서버에 계속 쌓임(유실 0).
14. **신규 개발 금지** — Hub 에이전트는 오류 수정(디버깅)만 수행. UPGRADE_REQUEST는 분석·설계 초안 브리핑까지만(§5 SESSION 분류).

## 2. 전체 구조

```
[그룹웨어] 직원 오류접수·업그레이드 요청 (outbox API — 자비스 몫 §7)
     │  outbound cursor polling (Hub가 당김)
     ▼
[노트북 — Local Hub Service (Windows 작업 스케줄러 등록, Node)]
     ├─ SQLite 잡 원장 (%LOCALAPPDATA%\HanjulHub\)
     ├─ PM 오케스트레이터(비토) ──→ 하위 에이전트 편성 (§3)
     │        └─ job별 git worktree (targetup 리포, main 무접촉)
     ├─ 홀딩 분류기 (§5) ─→ HOLD 큐(분석+브리핑만) / WORK 큐(수정까지)
     ├─ 검증 게이트: tsc(BE·FE) + vitest 615 + 금지 grep + 계약 테스트
     ├─ 헬스 워커 (§6): 한줄로 도메인 지표 주기 폴링
     ├─ 알림 어댑터: 한줄로 발송 API로 Harold 폰 문자 (§6.3, 이원화)
     └─ 로컬웹 대시보드 (127.0.0.1): 잡 타임라인·브리핑·[push] 버튼·HOLD 큐·헬스 보드
     ▼
[Harold] 문자 수신 → (복귀 후) 브리핑 검토 → [push] 클릭 = main 머지+push → Termius로 pull+build:safe+pm2
```

- 브라우저 탭은 관제 UI일 뿐, 실행 주체는 백그라운드 서비스(자비스 RFC 골격 채택).
- **git이 provenance의 전부다** — 자비스 RFC의 ZIP/SCP/파일해시 저널은 채택하지 않는다(그룹웨어 트랙 전용). base hash = 브랜치 분기점 commit, 승인 대상 = HEAD commit, 충돌 감지 = merge conflict. 재발명 0.

## 3. 에이전트 편성 (PM = 비토)

> **상세 설계 = [2026-07-15-local-ai-ops-hub-agents-design.md](2026-07-15-local-ai-ops-hub-agents-design.md)** — 에이전트별 도구 allowlist·훅 강제 3계층·하네스 로딩 매트릭스·메시지 계약·시나리오 3종·비용 3층 budget·브리핑 품질 게이트. 아래 표는 요약.

| 역할 | 담당 | 쓰기 권한 | 실행 축 |
|---|---|---|---|
| PM(비토) | 신고 정규화·도메인 판별·배정·브리핑 종합·홀딩 판정 | 없음 | Claude Agent SDK headless |
| Backend 조사 | API·쿼리·워커·데이터 흐름 분석 | 없음 | 〃 (서브에이전트) |
| Frontend 조사 | UI 상태·렌더·모바일 분석 | 없음 | 〃 |
| Implementer | 승인 범위 내 수정 — **잡당 1명 유일 writer** | worktree만 | 〃 |
| QA | 재현 fixture·회귀 테스트 작성/실행 | 테스트 파일만 | 〃 |
| 적대 리뷰 | 독립 diff·위험 검토 (codex_review 룰의 기계화) | 없음 | Codex CLI (미가용 시 별도 Claude 인스턴스) |

- 에이전트 간 자유 채팅 금지 — PM이 잡 원장(구조화 메시지)으로만 중계. 반박 2왕복 초과 = HOLD로 승격.
- 잡당 동시 코딩 1건(노트북 자원 보호). 조사류는 2~3 병렬 허용.
- **주의**: 세션 대화의 no_parallel_tasks 룰은 "Harold와의 대화형 디버깅" 문맥 — Hub는 PM 통제 하의 구조화 분업이므로 별개. 단 Implementer 1명 원칙으로 동시 수정 충돌은 구조적으로 차단.

## 4. 하네스 상속 규약 (품질의 본체)

- 로딩 방식 = 지금 세션과 동일: **상시 로드 CLAUDE.md + status/STATUS.md 둘뿐**, 그 외 문서는 STATUS 라우팅 표가 지시하는 절만(통째 로드 금지 — 자비스 RFC §9.2 방식 기각).
- 잡 시작 시 의무: 도메인 식별 → 해당 LESSONS_*.md 정독 → SCHEMA.md 해당 절 → 수정 대상 파일 read → MANDATORY_CHECKLIST 자가 평가를 잡 원장에 기록.
- 비토 메모리(memory/)는 read-only 마운트로 PM에게 제공(경로 고정). 잡에서 얻은 교훈은 Hub가 초안을 만들어 다음 Harold 세션에서 비토가 정식 반영(무단 메모리 쓰기 금지).
- 브리핑 필수 필드 = 6원칙 증거물: 연관 소비처 전수 grep 결과·영향표·검증 로그(tsc/vitest)·회귀 확인·롤백 방법. diff만 던지는 브리핑 금지.

## 5. 홀딩 분류기 (자동 진행의 상한)

| 등급 | 대상 | Hub 행동 |
|---|---|---|
| HOLD (L3+) | §1-4 보호 영역 전부 + 신규 테이블/컬럼 + 크레딧/요금 + 대량 UPDATE/DELETE + 정책 결정 필요 건 | 분석·원인·수정안 브리핑까지. 코드 무접촉. 문자로 "의논 필요" 통지 |
| SESSION | **업그레이드 요청·신규 기능 전부** (Harold 확정 — Hub는 디버깅 전용) | 접수 정리 + 현황 분석 + 설계 초안 브리핑 → Harold 복귀 후 비토 세션에서 진행 |
| WORK (L1~L2) | UI·문구·고립 버그·명백한 가드 누락·조회 로직 (보호 영역 밖) — **오류 신고만** | worktree 수정 + 검증 + 브리핑 + [push] 대기 |
| INFO (L0) | 질문성 접수·재현 불가·중복 | 답변 초안/근거 브리핑만 |

- 판정 근거 = 변경 파일 경로 allowlist/denylist + diff 내용 스캔(DDL·크레딧·발송 키워드) 이중 게이트. 에이전트가 스스로 등급을 낮출 수 없다(분류기는 Hub 코드).
- HOTFIX 트랙 선례와 정합: 저위험(문구/스타일)은 계획 승인 생략, [push] 버튼 1회가 유일 승인.

## 6. 한줄로 헬스 워커 (신규 개발 — Hub와 독립 가치)

### 6.1 서버 측 신설 (한줄로 backend)
- `GET /api/agent/v1/health-snapshot` (기계 토큰 인증, read-only): HTTP 생존이 아니라 **도메인 지표** —
  ①MySQL 발송 큐 적체(라인별 잔존 행·최고령 행 나이) ②campaigns pending 나이 분포 ③PM2 워커 생존(승인감지·sweeper·cron) ④IMC 웹훅 마지막 수신 나이 ⑤PG/MySQL/Redis 연결 ⑥디스크/에러율 요약. 서버측 30초 캐시.
- `GET /api/agent/v1/version`: git HEAD hash + 기동 시각.
- 금지 응답: 고객 phone/이름·발송 본문·크레딧 거래 내역·토큰·접속 정보·스택 원문.

### 6.2 Hub 측 판정
- 30~60초 폴링 + 외부 synthetic probe(hanjul.ai 공개 페이지 응답) 대조 — self 정상인데 외부 불가면 DEGRADED.
- 상태 전이(HEALTHY/DEGRADED/UNHEALTHY) 시에만 알림(플래핑 억제 — 연속 2회 확인 후).

### 6.3 알림 이원화 (순환 의존 차단 — 리뷰 P0)
- 평시 = 한줄로 발송 API로 Harold 폰 문자(발신 대표번호).
- 한줄로 UNHEALTHY/UNKNOWN = 한줄로로 못 보낸다 — 그룹웨어 Push로 자동 전환(그룹웨어에 알림 릴레이 1개 요청, §7).
- 알림 종류: 헬스 상태 전이 / WORK 완료(브리핑 준비) / HOLD 발생(의논 필요) / Hub 자체 장애(그룹웨어 heartbeat 감시가 발신).

## 7. 자비스(그룹웨어)에게 요구할 것 — 전부

> **전달용 지시서 = [2026-07-15-local-ai-ops-hub-jarvis-spec.md](2026-07-15-local-ai-ops-hub-jarvis-spec.md)** (스키마·계약 규칙·완료 판정 6항 포함 — 자비스에게는 그 문서 하나만 주면 된다).

```
GET  /api/agent/v1/events?cursor=<c>&limit=100   # 오류접수·업그레이드 요청·댓글·상태변경, eventId 불변·중복 전달 허용
POST /api/agent/v1/events/<id>/ack               # Hub가 SQLite 기록 후 ACK
GET  /api/agent/v1/incidents/<id>/snapshot       # 본문+댓글+첨부 메타 전체본
POST /api/agent/v1/local-hubs/heartbeat          # Hub 생존 신고 — 3분 무신호 시 그룹웨어가 Harold 폰 Push
POST /api/agent/v1/notify                        # 알림 릴레이(한줄로 장애 시 백업 채널)
```
- 이벤트 보존 30일+, `origin=AGENT_SYSTEM` 이벤트는 피드에서 제외(루프 차단). 이상이며, 그룹웨어의 역할은 여기서 끝.

## 8. 잡 상태 머신 (간소)

```
RECEIVED → TRIAGED → { HOLD → BRIEFED(의논 대기) }
                   → { WORK → FIXING(worktree) → VERIFIED → BRIEFED → PUSH_APPROVED(버튼) → PUSHED → DEPLOY_WAITING(Harold) → DONE }
어느 단계든 → NEEDS_HUMAN / FAILED / CANCELLED
STALE: 신고에 요구 변경 댓글 / main이 전진해 rebase 필요 / 승인 후 브랜치 변경. 정보성 댓글은 STALE 아님 — revision 병합 후 계속(자비스 RFC보다 완화).
```

## 9. 단계별 도입 (관찰 우선 — 조용한 지금 = 골격 검증 적기)

| 단계 | 내용 | 게이트 | 에이전트 수정 |
|---|---|---|---|
| M0 | Hub 서비스 골격 + 로컬웹 + **헬스 워커 + 문자 알림** (§6) | Windows 잠금·재시작·8h 무인 드릴 통과 | 없음 — 즉시 가치(골프장에서 장애 인지) |
| M1 | 그룹웨어 이벤트 폴링 + read-only 분류·브리핑 (과거 신고 20~30건 fixture 재생) | 유실·중복 0, 분류 정확도 실측 | 없음 |
| M2 | worktree 수정 + 검증 + [push] 버튼 — **L1 저위험만** | 반려율·오탐 30일 관찰, HOLD 오분류 0 | L1 한정 |
| M3 | L2 확대 + 적대 리뷰 상시화 + 모바일 승인(그룹웨어, 선택) | M2 지표 통과 + Harold 별도 승인 | L2까지 |

## 10. Harold 결정 항목

| ID | 질문 | 비토 권고 |
|---|---|---|
| H-1 | 모델 과금 축 | **결정(2026-07-15): 디버깅 잡 = Opus 4.8 단일. 인증 = Max 구독 우선(세션과 주간 한도 공유 — 미사용 주간 용량 활용, 추가 비용 0), API 키는 폴백.** 잠식 가드: Hub가 주간 사용량 임계(70% 후보) 도달 시 문자 통지 + 에이전트 처리 자동 일시정지(세션 몫 보전) |
| H-2 | M0 착수 범위 | 헬스 워커+문자만 먼저(그룹웨어 API 대기 없이 시작 가능) |
| H-3 | 문자 수신 번호·조용 시간 | Harold 폰 / 심야 SEV1만 |
| H-4 | 잡당 비용 상한 | **결정(2026-07-15): 금액 상한 없음(Harold — 주간 한도 내 무제한).** 기술 상한만 유지 — 왕복 2회·수정 시도 2회·잡당 턴 상한(무한 루프 방지 목적, 비용 목적 아님) |
| H-5 | Codex 적대 리뷰 포함 여부 | M2부터 포함 권고 |

## 11. 알려진 약점 (정직)

노트북이 단일 실행점(전원·인터넷·Windows Update) / Harold 1인 승인은 4-eyes가 아님 / 외부 모델에 소스 일부 전달 / 브리핑 요약만으로 오판 가능(→6원칙 증거물 의무로 완화) / 헬스 정상이어도 부분 고장 가능(도메인 지표로 완화). 완전 무인 배포는 범위 밖 — Harold 원칙상 영구 제외.
