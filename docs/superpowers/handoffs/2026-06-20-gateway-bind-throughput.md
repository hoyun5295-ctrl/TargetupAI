# 2026-06-20 핸드오프 — 게이트웨이 bind/throughput 조사 (내부 회의 자료)

> F 발송지연(40분)의 throughput 근본 + bind 확장 조사. 한줄로 라인 분리는 별도 배포완료(`2026-06-20-mms-text-line-split.md`). 본 건은 게이트웨이/에이전트 쪽 = **내부 회의 후 방향 결정**.

## 1. bind 확장 시도 결과 (실패 — 같은 ID 다중 bind 불가)
- agent7 `qtmsg.xml` `bind_idx_cnt` 1→2 + `_2` 연결블록(같은 ID `targetai7_m`) → 둘 다 `bind ack 성공 E_OK`로 붙음. 그러나 ~8분 뒤 PING(enquire_link) 응답이 안 와 `no ack ping`으로 deliver thread reset 루프 38회 → 불안정 → bind 1 롤백.
- **QTmsg 매뉴얼 ver4.0 4페이지 확정**: "중계서버에서는 bind id가 유일해야 하기 때문에 동일 Bind ID로 이중실행되는 경우 문제 → 한 개만 실행." 2개 이상 필요 시 = 운영실에 ID 추가 발급(각자 별도 테이블).
- **결론: "4까지 가능" = ID(에이전트) 4개지, 한 ID에 bind 4개가 아님.** 처리량 회선 확장 = 운영실에서 ID 추가 발급.

## 2. throughput 진짜 근본 (32 TPS 비정상)
- 실측 32 TPS(78,020건/40분). 정상 SMPP 한 연결 = 수백~수천 TPS.
- agent fetch는 throttle 아님: `qtmsg.xml` `fetch_count=1000`, `db_select_term=1`.
- 32 TPS = submit을 한 건씩 동기로(submit_resp 받고 다음) 보내는 패턴(window=1) 추정. `qtmsg.xml`에 async/window 설정 0건.
- **근본 fix = submit을 결과 안 기다리고 연속으로 던지는 async window.** qtmsg/게이트웨이 쪽 → 서팀장·벤더 확인.

## 3. MMS 느림 — URL 아님
- 매뉴얼 13p: 웹 URL 첨부(`http://...jpg`)는 건당 socket 0.1초+. 그러나 한줄로는 MMS를 로컬 파일 경로로 첨부(`mms-images.ts` `path.resolve`) → 패널티 무관. MMS 느림은 이미지(300KB+) 전송이 무거운 본질.

## 4. 게이트웨이/에이전트 운영 교훈
- agent **stop 스크립트가 안 끝나고 매달림** → "프로그램 종료" 확인 후 Ctrl-C, start는 따로(`stop && start` 체인 금지). 이번에 8분 line7 멈춤.
- 같은 ID **churn 후 게이트웨이가 `targetai7_m` 세션을 묶어** bind 거부(`receive error2`) → agent 완전 정지 후 몇 분 quiet면 게이트웨이 timeout으로 풀림(15분 정지 후 자동 복구 확인).
- ps로 agent 식별: cmdline에 "agent7"이 아니라 "qtmsg" → `pgrep -f qtmsg` + `readlink /proc/PID/cwd`로 디렉터리 확인.

## 5. 내부 회의 → 결정할 것
1. 처리량 = async window(qtmsg 지원 여부, 서팀장/벤더) vs ID 추가 발급(운영실) 중 무엇으로.
2. ID 추가 시 에이전트·테이블 추가(현 11개 구조 확장) + 라인그룹 배정.
3. async window가 되면 bind/ID 추가 없이 32 TPS → 수백~수천으로 → 40분이 몇 초.
