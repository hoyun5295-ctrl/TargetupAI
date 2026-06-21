# 2026-06-20 핸드오프 — 한줄로 MMS/문자 라인 분리 (2순위 구현)

> **배포 완료(2026-06-20, Harold).** 발송·돈이라 운영 **실측 1건**(MMS+LMS 섞인 발송 → 라인 갈림 확인)은 Harold/직원 몫(아래 5장).

## 0. 한 줄 요약
같은 라인에서 무거운 MMS가 단일 bind를 점유해 뒤에 깔린 문자(LMS/SMS)가 길게 대기하던 문제(시세이도 LMS 40분 지연)를, **회사 라인 안에서 MMS와 문자를 서로 겹치지 않는 라인으로 갈라** 문자가 MMS 뒤에 안 깔리게 했다. 게이트웨이·agent 무수정, `sms-queue.ts` 적재 코드만.

## 1. 배경 (이번 세션 데이터로 확정)
- 6/12 시세이도(549ead81) 즉시발송 LMS 4건: 한줄로 적재 `sendreq 10:32:03`(정상) → 통신사 송출 `mobsend 11:12`(40분 후). 한줄로 무죄.
- 원인: agent 송출 로그상 우리 LMS(seqno 1294xxx)가 같은 라인의 MMS(끌레드뽀 웰컴, seqno 1278xxx) 등 **앞선 backlog 뒤에서 11:12에야 처리**. 단일 bind(`bind_idx_cnt=1`) + 게이트웨이 묶음-대기로 라인 드레인이 느림.
- **bind 늘리기(처리량 ↑)는 실패로 확정**: 같은 ID 다중 bind는 이 게이트웨이에서 ping ack가 꼬여 reset 루프(38회) → 기각. 처리량을 bind로 늘리려면 **게이트웨이가 별도 ID 발급**해야 함(상대 작업, 한줄로 밖). → 그래서 우리 손에 있는 2순위(라인 분리)만 구현.

## 2. 설계 결정 — "회사 라인 안에서만" 분리 (핵심 안전)
- 분리를 회사 자기 라인 집합({7,8,9} 등) **안에서만** 수행 → 메시지가 여전히 회사 라인 안 → **집계·취소·정산이 회사 라인 union을 통째 조회하므로 전부 그대로 잡힘(무영향)**. 정산은 app_etc1(campaign) 기준이라 라인 무관.
- 기각: "문자를 회사 밖 유휴 라인({1~6})으로 빼기" — 집계·취소가 그 라인을 못 봐 **2026-06-11 라인불일치 사고(87,014건 실발송) 재현 위험**.

## 3. 구현
- **신규 순수 함수** `utils/sms-line-split.ts` (DB import 0, TDD):
  - `splitLinesByMsgType(tables, hasMms, hasText) → { mmsLines, textLines }`.
  - 라인 <2 또는 한 종류만 → 둘 다 전 라인(기존 동작). 혼합+라인≥2 → 앞 `MMS_LANE_COUNT`(=1)개 MMS, 나머지(다수) 문자. 문자 최소 1 보장.
- **신규 테스트** `utils/sms-line-split.verify.ts` — 7 케이스(3라인 1/2, 2라인 1/1, 1라인 공유, MMS만/문자만 전 라인, disjoint, 빈 라인). RED→GREEN 확인.
- **배선** `utils/sms-queue.ts` `bulkInsertSmsQueue`:
  - import 추가 + `hasMms`/`hasText` 계산 → `splitLinesByMsgType` → 행마다 `getNextSmsTable(row[3]==='M' ? mmsLines : textLines)`.
  - INSERT 13컬럼·배치 로직 **불변**. 글로벌 라운드로빈(rrIndex) 유지(호출 간 균등 분배 보존).

## 4. 발송 5경로 영향표 (CT 1곳 수정으로 자동 전파)
| 경로 | 호출 | 영향 |
|---|---|---|
| AI(campaigns:855)·직접동기(1847)·직접worker(direct-send-processor:131)·자동마케팅(auto-campaign-worker:1016) | bulkInsertSmsQueue(companyTables) | 분리 자동 적용 |
| 여정(journey-executor:767) | bulkInsertSmsQueue(1 row) | 단건이라 무영향(안전) |
| 알림톡·인증·시스템알림 | bulkInsertSmsQueue([authTable]) | 단일라인(N=1) → 공유, 무영향 |
| 집계(stats/results/sync/export, getCompanySmsTablesWithLogs)·취소(getCampaignQueueTables)·정산(billing app_etc1) | — | **0 변경**(회사 라인 union 조회) |

## 5. 배포 + 실측 1건 (발송·돈, 6원칙)
- 배포: `tp-push "..."` → 서버 git pull → `pm2 restart all`(backend ts-node — **build:safe 금지/OOM**) → frontend 변경 없음.
- **실측(배포 후)**: MMS+LMS 섞인 발송 1건 적재 후, 같은 회사의 `SMSQ_SEND_{7,8,9}_YYYYMM`에서 그 캠페인(app_etc1)의 행을 조회 → **MMS는 한 라인(7), 문자는 다른 라인(8/9)** 으로 갈렸는지 확인. + 단일 타입 발송(문자만/ MMS만)이 전 라인 쓰는지(회귀 0).
- 권장: 배포 전 `/codex:review`(돈·발송 변경 이중 검증, Harold 룰).

## 6. 검증 현황
- 순수 함수 tsc PASS + TDD 7/7. 박-단어 0. DB 컬럼/JOIN 신규 0(INSERT 불변). 백엔드 full tsc는 OOM 우려로 미실행 — 배선은 type-trivial glue(인라인 검토).
- 변경 파일: `utils/sms-line-split.ts`(신규), `utils/sms-line-split.verify.ts`(신규), `utils/sms-queue.ts`(import+bulkInsertSmsQueue).

## 7. 남은 일 (다음)
- 게이트웨이 별도 ID 발급(처리량 ↑) = 상대 작업. 받으면 agent별 `_2` ID로 bind 늘리는 건 그때(같은 ID 재시도 금지).
- 라인 분리 비율(`MMS_LANE_COUNT`)은 운영 보고 조정 가능(현재 MMS 1 / 문자 나머지).
