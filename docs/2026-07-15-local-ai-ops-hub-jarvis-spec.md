# [지시서] 그룹웨어 — Local AI Ops Hub 이벤트 공급 API 스펙

> 발신: Harold / 작성: 비토 (한줄로 CTO 에이전트, Hub 설계 총괄)
> 수신: 자비스 (그룹웨어 담당)
> 일자: 2026-07-15
> 상위 설계: `targetup/docs/2026-07-15-local-ai-ops-hub-design.md` (비토 관할 — 읽을 필요 없음, 이 문서가 네 몫의 전부다)

## 0. 역할 경계 — 먼저 읽어라

Local AI Ops Hub(Harold 노트북에서 도는 에이전트 시스템)는 비토가 설계·구현한다. **그룹웨어의 역할은 딱 셋이다**:

1. 직원이 올린 오류접수·업그레이드 요청을 **이벤트 API로 내보낸다** (Hub가 폴링해서 가져감)
2. Hub의 **heartbeat를 감시**해서 끊기면 Harold 폰으로 Push를 보낸다
3. Hub가 요청하면 **알림을 릴레이**한다 (한줄로 장애 시 문자 대신 쓰는 백업 채널)

네가 만들었던 RFC v0.3.1의 나머지 — 모바일 승인 포털(/agent-jobs), approval digest, ZIP/SCP, 에이전트 오케스트레이션 — 는 한줄로 트랙에서 **채택하지 않는다**(승인 = 로컬웹 버튼, provenance = git, 배포 = Harold Termius). 그쪽 절은 구현하지 마라.

## 1. 이벤트 공급 API (필수 — M1)

### 1-1. 이벤트 피드
```
GET /api/agent/v1/events?cursor=<cursor>&limit=100
Authorization: Bearer <machine-token>
```
응답 이벤트 스키마:
```json
{
  "eventId": "evt_...",          // 불변·전역 유일 — 중복 전달 허용(Hub가 멱등 처리)
  "cursor": "...",               // 단조 증가
  "incidentId": "inc_...",       // 접수 건 단위
  "incidentRevision": 3,         // 댓글·첨부·상태변경마다 +1
  "type": "ERROR_REPORT | UPGRADE_REQUEST | COMMENT_ADDED | ATTACHMENT_ADDED | STATUS_CHANGED",
  "title": "...", "body": "...",
  "author": "직원 표시명",        // 연락처·사번 등 불필요 개인정보 제외
  "origin": "STAFF",             // AGENT_SYSTEM 이벤트는 피드에서 제외(피드백 루프 차단)
  "createdAt": "ISO8601"
}
```

### 1-2. ACK
```
POST /api/agent/v1/events/<eventId>/ack
```
Hub가 로컬 기록을 마친 뒤에만 호출한다. ACK 안 된 이벤트는 재전달하라.

### 1-3. 접수 전체본
```
GET /api/agent/v1/incidents/<incidentId>/snapshot
```
본문 + 댓글 전체 + 첨부 메타(파일명·size·MIME·다운로드 URL). 첨부는 이미지·문서만 — 실행 파일류는 목록에서 제외하고 표기만.

### 계약 규칙
- 이벤트 보존 **30일 이상**. cursor가 보존 밖이면 명시 에러(Hub가 snapshot 재동기화).
- 인증 = 기계 토큰(그룹웨어에서 발급·회수 관리, Hub 전용 1개). HTTPS만.
- 폴링 주기는 Hub가 10~15초로 친다 — rate limit은 그보다 여유 있게.

## 2. Hub 생존 감시 (필수 — M0부터)

```
POST /api/agent/v1/local-hubs/heartbeat
{ "hubId": "hanjul-hub-1", "status": "ONLINE", "checkedAt": "...", "queueDepth": 0 }
```
- **3분 무신호 = Harold 폰으로 Push** "Local Hub offline". 복구 시 "recovered" 1회.
- heartbeat 본문에 소스 경로·IP·토큰 같은 건 받지도 저장하지도 마라.

## 3. 알림 릴레이 (필수 — M0부터)

```
POST /api/agent/v1/notify
{ "level": "INFO | WARN | CRITICAL", "title": "...", "body": "..." }
```
- Harold 폰 Push로 전달. 용도 = 한줄로가 아파서 한줄로 문자를 못 쓸 때의 백업 채널 + Hub 자체 공지.
- CRITICAL은 즉시, INFO는 묶어 보내도 된다.

## 4. 완료 판정 (이거 통과하면 네 몫 끝)

1. 접수 1건 생성 → Hub 폴링으로 수신 → ACK → 재폴링 시 미재전달 확인
2. 같은 이벤트 5회 중복 전달 → Hub 잡 1개(중복 무해) 확인
3. 댓글 추가 → revision 증가 이벤트 수신 확인
4. heartbeat 3분 중단 → Harold 폰 Push 실측 1건
5. notify CRITICAL → Push 실측 1건
6. `origin=AGENT_SYSTEM`으로 쓴 댓글이 피드에 안 나오는지 확인

## 5. 순서

M0(지금): §2 heartbeat + §3 notify 먼저 — Hub 헬스 워커가 이것부터 쓴다. M1: §1 이벤트 3종. 스펙 질문은 비토에게(이 문서 기준으로만 구현 — RFC 잔여 절 구현 금지).
