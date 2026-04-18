# Sync Agent v1.5.0 — QA 가이드 (서팀장 전달용)

> **목적:** Sync Agent v1.5.0 완성본 E2E 테스트 시나리오 제공
> **대상:** 서팀장
> **기반:** `status/SYNC-AGENT-V1.5.0-DESIGN.md` §14-3
> **배포:** 2026-04-21 기준 Day 1~3 구현 완료 (배포 대기)

---

## ⚠️ 사전 준비 (Harold님 확인 후 서팀장 시작)

1. **DB 마이그레이션 완료 확인** (Day 1 heredoc 블록 실행됨)
   ```sql
   \d users        -- is_system 컬럼 존재
   \d customers    -- customer_code 컬럼 존재
   \d customer_code_sequences
   SELECT COUNT(*) FROM users WHERE is_system=true;  -- 기존 회사 수만큼 존재
   SELECT customer_code FROM customers LIMIT 5;       -- {company_code}-000001 형식
   ```

2. **tp-deploy-full 완료** (백엔드 + 프론트엔드 배포됨)

3. **Agent 빌드 산출물 준비** — Harold님 로컬에서 실행
   ```bash
   cd sync-agent
   npm run build:exe       # release/sync-agent.exe
   npm run build:linux     # release/sync-agent
   bash installer/build-linux-package.sh 1.5.0
   installer\build-installer.bat 1.5.0   # Windows 인스톨러
   ```

4. **테스트 환경 계정 + API 키** — 슈퍼관리자 sys.hanjullo.com에서 테스트 회사 생성 → `api_key` / `api_secret` 발급

---

## A. 신규 설치 + AI 매핑 시나리오

### 준비
1. 로컬 MSSQL/MySQL 중 하나에 `sync-agent/setup_test_db.sql` 주입
2. 테스트 Windows PC에 `SyncAgent-Setup-1.5.0.exe` 실행

### 테스트
1. 설치 마법사 자동 실행 (브라우저 http://localhost:9876)
2. **Step 1**: 서버 URL / API Key / API Secret 입력 → "접속 테스트"
3. **Step 2**: DB 접속 정보 입력 → "접속 테스트"
4. **Step 3**: 고객 테이블 / 구매 테이블 선택
5. **Step 4 (신규)**: 컬럼 매핑 화면에서 **"AI 매핑 실행"** 버튼 클릭
   - ✅ 로딩 스피너 + "Claude Opus 4.7 호출 중..." 문구 확인
   - ✅ 응답 수신 후 매핑 테이블 select가 자동 업데이트되는지 확인
   - ✅ 상단 status 영역에 "✅ AI 매핑 완료 — 고객: N개 / 모델: claude-opus-4-7" 출력
   - ✅ 매핑 결과 수동 수정 가능한지 확인
6. **Step 5**: 동기화 설정 (기본 360분 = 6시간)
7. **Step 6**: 저장 완료 → config.enc 저장 → 서비스 등록

### 검증
- 한줄로 DB 조회
  ```sql
  SELECT customer_code FROM customers WHERE company_id='<테스트회사ID>' LIMIT 10;
  -- {company_code}-000001 ... 형식 확인
  ```
- 설치 시 서버 호출 1회 카운트
  ```sql
  SELECT ai_mapping_calls_month, ai_mapping_last_month FROM companies WHERE id='<테스트회사ID>';
  -- ai_mapping_calls_month = 1 (또는 2 — 고객+구매 각 1회)
  ```

---

## B. 증분 동기화 시나리오

### 테스트
1. 소스 DB에서 고객 1건 UPDATE (예: grade 'BRONZE' → 'SILVER')
2. 6시간 대기 **또는** Agent 수동 재시작
3. 한줄로 DB 조회
   ```sql
   SELECT grade FROM customers WHERE phone='<테스트번호>';
   -- 'SILVER' 확인
   ```

### 로그 확인
```
[sync] 증분 동기화 시작: customers
[sync] 파이프라인 결과: 원본 1건, 매핑 1건, 정규화 1건, dropped 0건, 전송 1건
[Sync] Customers: 1 upserted, 0 failed
```

---

## C. 수신거부 싱크 (CT-03 3단 배정) 시나리오

### 테스트
1. 소스 DB에서 SMS_YN 'Y' → 'N' 1건 변경
2. 싱크 실행 (수동 트리거 또는 6시간 후)
3. 한줄로 DB에서 `sms_opt_in=false` 확인
   ```sql
   SELECT phone, sms_opt_in FROM customers WHERE phone='<테스트번호>';
   -- sms_opt_in = false
   ```
4. `unsubscribes` 테이블 확인
   ```sql
   SELECT u.*, usr.user_type, usr.is_system
   FROM unsubscribes u JOIN users usr ON usr.id = u.user_id
   WHERE u.phone='<테스트번호>' AND u.source='sync';

   -- 예상: 3건 이상
   --   · is_system=true user (1건)
   --   · admin user 수만큼 (N건)
   --   · store_code 담당 company_user 수만큼 (M건)
   ```

### 발송 테스트
1. 한줄로에서 해당 phone을 타겟으로 발송 시도
2. ✅ 수신자 목록에서 자동 제외 확인

---

## D. 엑셀 업로드 차단 (SyncActiveBlockModal) 시나리오

### 전제
- `companies.use_db_sync = true` (sys.hanjullo.com 설정)
- `sync_agents` 테이블에 `status='active'` 레코드 존재

### 테스트 — 차단되어야 하는 UI
1. **고객 DB 업로드 버튼** 클릭 → ✅ `SyncActiveBlockModal` 표시
2. **고객 개별 추가** (`POST /api/customers`) → ✅ 403 `SYNC_ACTIVE_BLOCK`
3. **고객 전체 삭제** (`POST /api/customers/delete-all`) → ✅ 403
4. **고객 개별 삭제/일괄삭제** → ✅ 403

### 테스트 — 허용되어야 하는 UI
1. **직접발송 수신자 엑셀** 업로드 → ✅ 정상 작동 (차단 안 됨)
2. **수신거부 번호 엑셀** 업로드 → ✅ 정상
3. **AI 분석 / 발송 / 조회** → ✅ 정상

### 모달 메시지 확인
```
🔗 싱크에이전트 사용 중
이 회사는 현재 싱크에이전트를 통해 고객사 DB 서버와 자동으로 동기화 중입니다.
고객 DB를 수동으로 수정하면 다음 동기화 시 소스 DB 데이터로 다시 덮어써져
변경 내용이 유실됩니다.
고객 정보를 변경하려면 귀사의 DB 서버에서 직접 수정해주세요.
```

---

## E. Linux 설치 시나리오

### 준비
- Ubuntu 20.04 LTS 또는 22.04 LTS 서버

### 테스트
```bash
scp SyncAgent-1.5.0-linux-x64.tar.gz user@server:/tmp/
ssh user@server
cd /tmp
tar -xzf SyncAgent-1.5.0-linux-x64.tar.gz
cd sync-agent-1.5.0-linux-x64
sudo bash install.sh            # /opt/sync-agent 에 설치
sudo /opt/sync-agent/sync-agent --setup-cli   # 대화형 설치
```

### CLI 설치 대화 확인
- ✅ 서버 URL / API Key / API Secret 입력
- ✅ DB 접속 정보 입력
- ✅ 테이블 선택
- ✅ **"🤖 AI 자동 매핑 (Claude Opus 4.7)을 사용하시겠습니까? (Y/n)"** — Y 입력
- ✅ 매핑 결과 출력 후 수정 가능
- ✅ 동기화 주기 입력
- ✅ 저장 완료

### 서비스 시작
```bash
sudo systemctl start sync-agent
sudo systemctl enable sync-agent       # 부팅 시 자동 시작
journalctl -u sync-agent -f             # 실시간 로그
```

로그 예시:
```
✅ Sync Agent 가동 중 (Ctrl+C로 종료)
   고객 동기화: 매 360분
   구매 동기화: 매 360분
   Heartbeat: 매 60분 (v1.5.0)
   큐 재전송: 매 30분 (v1.5.0)
```

---

## F. 설정 변경 (설정 폴링 제거 검증)

### 테스트
1. **sys.hanjullo.com 슈퍼관리자** 로그인
2. 회사별 싱크 주기 변경 (예: 360분 → 480분)
3. Agent는 **별도 `/config` 호출 없이** 다음 싱크 실행 시 응답의 `config` 필드로 수신
4. 로그 확인
   ```
   🔧 원격 설정 변경: 고객 동기화 주기 { before: 360, after: 480 }
   🔄 동기화 주기 변경 — 스케줄러 재시작
   ```
5. 8시간 후 싱크 실행 확인

---

## G. AI 매핑 쿼터 초과 시나리오

### 테스트
1. 같은 회사에서 AI 매핑을 11번 호출
2. 11번째 호출 시 403 응답
   ```json
   {
     "success": false,
     "error": "AI 매핑 호출 한도 초과 (월 10회, 사용 10회)",
     "code": "AI_MAPPING_QUOTA_EXCEEDED",
     "limit": 10,
     "used": 10
   }
   ```
3. 설치 마법사 Step 4 상단 status 영역에 빨간색 에러 표시
4. 사용자가 수동 매핑 가능한지 확인

### 월 리셋 검증
- `companies.ai_mapping_last_month`를 전월(예: '2026-03')로 UPDATE
- AI 매핑 재호출 시 자동으로 0으로 리셋 후 카운트 시작

---

## H. is_system 로그인 차단 시나리오

### 테스트
1. 로그인 페이지에서 `login_id = 'system_sync_<company_id>'` + 아무 비밀번호로 로그인 시도
2. ✅ **403 응답: "시스템 계정은 로그인할 수 없습니다."** 확인
3. `audit_logs` 테이블에 `action='login_blocked'`, `details.reason='system_account'` 기록 확인

---

## 🚨 회귀 테스트 (v1.4.x 기능 깨지지 않았는지 확인)

- [ ] 기존 엑셀 업로드 (싱크 비활성 회사) — 정상 작동
- [ ] AI 캠페인 발송 5경로 (AI/직접/예약/테스트/자동) 전부 정상
- [ ] 수신거부 필터링 (발송 시 자동 제외)
- [ ] 고객 조회 / 필터 / 커스텀 필드 표시
- [ ] 발송 결과 동기화 (MySQL → PostgreSQL)

---

## 📋 QA 보고 템플릿

| 시나리오 | 결과 | 비고 |
|---------|------|------|
| A. 신규 설치 + AI 매핑 | ⬜ |  |
| B. 증분 동기화 | ⬜ |  |
| C. 수신거부 3단 배정 | ⬜ |  |
| D. 엑셀 업로드 차단 | ⬜ |  |
| E. Linux 설치 | ⬜ |  |
| F. 설정 변경 | ⬜ |  |
| G. AI 쿼터 초과 | ⬜ |  |
| H. is_system 로그인 차단 | ⬜ |  |
| 회귀 테스트 | ⬜ |  |

**이슈 발견 시:** `status/BUGS.md`에 추가 + Harold님 및 Claude에게 에스컬레이션.

---

**v1.5.0 QA 가이드 끝**
