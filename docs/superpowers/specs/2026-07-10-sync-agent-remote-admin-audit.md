# 싱크에이전트 원격 관리 전수 점검 + 개선 설계 (2026-07-10)

> 목표(Harold 확정): **원격 지원(TeamViewer 등)을 붙이지 않고, 슈퍼관리자에서 실행할 수 있는 명령·조회를 최대화**한다.
> 기원: 이새 매장명 매핑 문의(2026-07-10) 처리 중 원격 관리의 구조적 결함이 드러남 — 슈퍼관리자가 고객사 소스 컬럼을 알 수 없고, 기존 매핑도 볼 수 없으며, 한 줄 추가 저장이 전체 매핑을 날리는 함정 구조.
> 이새 자체는 **종결**(현상 유지 — 약 2개월 뒤 타 업체 ERP로 재연동 예정이라 지금 손대지 않음). 본 문서는 에이전트 제품 전반의 점검·개선.
> 본문 실측 = 2026-07-10 코드·운영 DB. 코드와 불일치 시 코드가 진실.

---

## 1. 현재 원격 관리 능력 — 실측 인벤토리

### 1-1. 명령 (슈퍼관리자 → 에이전트)
- 허용 명령 5종: `full_sync` `restart` `pause` `resume` `update_config` (routes/admin-sync.ts:349 ALLOWED_COMMAND_TYPES)
- 전달 경로: `POST /api/admin/sync/agents/:id/command` → `sync_agents.config.commands[]` 큐잉 → 에이전트 **heartbeat 응답**으로 전달 후 큐 즉시 비움(At-Most-Once, routes/sync.ts:445-447) — 명령 반영 최대 지연 = heartbeat 주기(기본 60분)
- `update_config` payload = `{ mapping: { customers, purchases, customFieldLabels } }` (admin-sync.ts:392) — 에이전트가 **런타임 매핑 교체 + config.enc 영구 저장 + 바뀐 타겟만 full_sync** (이새 런북 2026-0702 §5 실증)

### 1-2. 에이전트 → 서버 보고 (heartbeat)
- 보고 항목: agentVersion·status·osInfo·dbType·lastSyncAt·queuedItems·uptime (routes/sync.ts:392-394)
- **보고하지 않는 것(공백)**: 소스 DB 컬럼 목록 · 현재 적용 중인 매핑 · 명령 실행 결과(성공/실패) · 에러 로그 · 소스 연결 상태

### 1-3. 조회/설정 (슈퍼관리자 화면)
- 버튼: 상세 / 설정(주기·배치) / 명령 / 매핑 / 삭제 + 버전 배포 · 새로고침 (AdminDashboard Sync Agent 모니터링)
- 버전 원격 배포: sync_releases 등록 → 박스 매시간 자동 수령(1.6.0 updater 자기교체 fix 완료, **1.6.1 릴리즈 등록 잔여** — STATUS §3 TODO)
- `GET /api/sync/config`: 주기·배치·column_mapping·commands 반환(routes/sync.ts:1217-1225)

### 1-4. 진실 이원화 (핵심 구조 문제)
- **서버 `config.column_mapping`은 에이전트 실제 매핑과 다르다.** 이새 실측: 서버 저장분 = NULL·commands=[] 인데 에이전트는 매핑 23개(표준 8+custom 15)로 정상 가동 — 실제 매핑의 진실은 **에이전트 로컬 config.enc뿐**이고 서버는 사본조차 없다. 슈퍼관리자에서 "지금 뭐가 매핑돼 있나"를 볼 방법이 없음.

## 2. 결함 전수 목록 (이번 실측로 확정)

| # | 결함 | 근거(실측) | 위험 |
|---|---|---|---|
| D1 | 매핑 모달이 기존 매핑을 안 불러옴(항상 빈 행) | AdminDashboard.tsx:864 | 부분 추가 저장 = **전체 매핑 소실**(에이전트는 통째 교체 — 런북 §5) |
| D2 | 소스 컬럼명을 슈퍼관리자가 알 수 없음(자유 타이핑) | 모달 구조 + heartbeat 보고 공백 | 원격 매핑 사실상 불가 — 이새 때 원격 지원 중 `--show-config`로 우회했음 |
| D3 | custom 슬롯 사용/잔여 현황 표시 없음 | 모달 구조. 이새 실측 15/15 만석 | 만석 슬롯에 덮어쓰기 사고 여지 |
| D4 | 명령 실행 결과(ACK) 회신 없음 | heartbeat 수신 필드에 결과 없음 | 적용 여부를 매번 DB 재조회로 검증해야 함(효과 검증 원칙 위배 소지) |
| D5 | 명령 큐 At-Most-Once — 전달 직후 큐 삭제, 에이전트 적용 실패 시 재전송 없음 | sync.ts:445-447 | 명령 유실 가능(특히 update_config) |
| D6 | 명령 반영 최대 60분 대기 — 즉시 반영 수단 없음 | heartbeat 주기 | 긴급 정지(pause)조차 최대 60분 |
| D7 | 서버에 적용 매핑 사본 없음(§1-4) | 이새 config NULL 실측 | 장애·재설치 시 매핑 복원 불가(런북 재작성 의존) |
| D8 | custom 슬롯 상한 15 | standard-field-map + 이새 15/15 실측 | ERP 연동사 확장 시 슬롯 부족 재발 예상 |

## 3. 개선 백로그 (우선순위 확정 — 구현 세션용)

### P0 — 매핑 안전화 + 가시성 (D1·D2·D3·D7 일괄 해소, 한 세트)
1. **에이전트 자기 보고 확장**: heartbeat 본문에 `appliedMapping`(현재 적용 매핑)·`sourceColumns`(고객/구매 소스 조회 결과 컬럼 목록)·`configVersion` 추가 → 서버가 `sync_agents.config.reported`에 저장(서버 사본 확보 = D7 해소). 에이전트 신버전 필요.
2. **매핑 모달 재작성**: 열 때 reported.appliedMapping **프리필**(빈 화면 함정 제거) + 소스 컬럼 **드롭다운**(직접 타이핑 폐지, reported.sourceColumns) + custom 잔여 슬롯 카운터 표시 + 저장 전 "이 저장은 매핑 전체를 교체합니다 — N개 행 전송" ConfirmModal.
3. reported가 아직 없는 구버전 에이전트는 모달에 "에이전트 보고 대기(구버전)" 정직 안내 — 빈 화면으로 저장 못 하게 차단.

### P1 — 명령 신뢰성 + 즉시성 (D4·D5·D6)
4. **명령 ACK**: 명령에 command_id 이미 있음 → 에이전트가 실행 결과 `{command_id, ok, message}`를 다음 heartbeat에 동봉 → 서버 기록(config.command_results 최근 N건) + 화면 명령 이력에 성공/실패 표시.
5. **At-Least-Once 전환**: 큐에서 "전달 시 삭제" → "ACK 수신 시 삭제"로. 에이전트는 command_id 멱등 처리(이미 실행한 id 무시). D5 유실 제거.
6. **즉시 반영 수단**: 명령 등록 시 에이전트 폴링을 임시 단축(예: 다음 1시간 heartbeat 1분)하는 `boost` 지시를 heartbeat 응답에 동봉 — 또는 에이전트 상주 폴링 주기 자체 설정화. (원격 푸시는 인바운드 포트가 없어 불가 — 폴링 단축이 현실 답)

### P2 — 원격 진단 도구 (원격 지원 대체의 마지막 조각)
7. `report_logs` 명령: 에이전트 최근 로그 N줄 업로드 → 슈퍼관리자 상세에서 열람.
8. `test_connection` 명령: 소스 DB 연결/조회 1행 테스트 결과 회신.
9. **매핑 dry-run**: 소스 1행에 신규 매핑을 적용한 결과 미리보기(저장 전 검증 — 이새 custom_5 매장코드 오적재 같은 사고 사전 차단).
10. custom 슬롯 확장(15→30) 검토 — customers.custom_fields는 jsonb라 DB 변경 0, FIELD_MAP·화면·에이전트 슬롯 상수 확장(D8). 소비처 전수 grep 필수.

## 4. 전수 점검 체크리스트 (구현 전 실측 — 다음 세션 1단계)

- [ ] **A. 에이전트 소스 위치 확정** — targetup 레포에는 없음(packages = pos-agent뿐, 실측). sync-agent.exe 빌드 소스가 어느 폴더/레포인지 Harold님 확인 필요. ★이게 확정돼야 P0-1·P1 전부 가능
- [ ] B. 에이전트의 update_config 적용 코드 실측 — 매핑 merge/replace 여부를 코드로 재확정(런북 기록은 "교체")
- [ ] C. heartbeat 주기 실측(기본 60분? 에이전트 설정값?) + config GET 호출 시점
- [ ] D. 명령별 에이전트 핸들러 유무(full_sync/restart/pause/resume/update_config 각각)
- [ ] E. 서버 `PUT 설정`(admin-sync.ts:274 column_mapping 저장)과 명령 update_config의 관계 — 두 경로가 다르게 저장되는지(이원화 재확인)
- [ ] F. 운영 에이전트 전수 현황: `SELECT id, company_id, agent_version, status, last_heartbeat_at FROM sync_agents ORDER BY last_heartbeat_at DESC;` — 버전 분포(구버전 잔존 = P0-3 안내 대상)
- [ ] G. sync_releases 1.6.1 등록 상태(기존 TODO와 병합 — 자기교체 fix 안정판)

## 5. 비범위·주의

- **이새 = 손대지 않음**(종결·현상 유지, 2개월 뒤 타 업체 재연동). 개선 배포도 이새 박스에 강제 적용하지 않고 신버전 릴리즈 채널로만.
- 매핑 의미 자체(FIELD_MAP·표준 필드)는 불변 — 관리 통로만 고친다.
- 에이전트 신버전 릴리즈는 updater 자기교체 이력(1.6.0 fix·1.6.1 등록 잔여)과 같은 트랙 — 릴리즈 절차는 기존 sync_releases 흐름 준수.
- 발송·과금 무관 — 전부 관리/조회 축. 단 full_sync 명령 유발 변경은 고객 데이터 재동기화라 6원칙 ②(효과 검증) 적용.

## 6. 다음 세션 시작 순서

1. CLAUDE.md·STATUS.md + LESSONS_BACKEND·LESSONS_FRONTEND 정독 → 본 문서 전체 정독
2. §4 체크리스트 A~G 실측(A가 막히면 Harold님께 소스 위치 질의부터)
3. P0 세트(1~3)부터 설계 보고 → 동의 → 구현. P1·P2는 P0 배포 후 순차
4. 검증: tsc·vitest + 명령 왕복 실측 1건(테스트 에이전트 또는 스테이징 박스) + Codex 리뷰
