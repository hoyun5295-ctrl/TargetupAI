# 교통정리 안전 프로토콜 — 문서 색인

**작성:** 2026-03-05
**상태:** ✅ 완성
**총 문서:** 4개 (문서 3개 + 스크립트 1개)

---

## 📚 문서별 역할

| 문서 | 크기 | 용도 | 대상 | 활용 |
|------|------|------|------|------|
| **README-MIGRATION-SAFETY.md** | 12KB | 🎯 전체 개요 | 모든 팀원 | 첫 번째 읽기 |
| **PROTOCOL-MIGRATION-SAFETY.md** | 34KB | 📖 상세 프로토콜 | 작업자/리더 | 상세 규칙 참조 |
| **QUICK-REFERENCE-MIGRATION.md** | 8KB | ⚡ 빠른 참고 | 작업자 | **A4 2장 인쇄** |
| **SCRIPTS-SAFETY.sh** | 19KB | 🤖 자동화 스크립트 | DevOps/작업자 | 배포/검증 자동화 |

---

## 🎯 읽는 순서

### 1단계: 전체 이해 (10분)

```
1. README-MIGRATION-SAFETY.md 읽기
   - 프로젝트 배경 이해
   - 3단계 작업 분류 이해
   - 배포 프로토콜 개요 파악
```

### 2단계: 실행 준비 (30분)

```
2. PROTOCOL-MIGRATION-SAFETY.md 읽기
   - 각 작업 유형별 상세 절차
   - 롤백 전략 숙지
   - 위험 신호 감지법 학습

3. QUICK-REFERENCE-MIGRATION.md 인쇄
   - A4 2장으로 인쇄
   - 책상 옆에 배치
   - 실행할 때마다 참조
```

### 3단계: 첫 배포 (실습)

```
4. SCRIPTS-SAFETY.sh 테스트
   ./SCRIPTS-SAFETY.sh help
   ./SCRIPTS-SAFETY.sh health_check

5. 연습 배포 (무접촉 작업)
   - OPS.md 비밀번호 마스킹 (이미 완료)
   - 프로토콜 대로 진행
   - 검증까지 완료

6. Harold님 피드백
   - "문서가 명확한가?"
   - "스크립트가 작동하는가?"
   - "부족한 부분 있는가?"
```

---

## 📋 각 문서 요약

### README-MIGRATION-SAFETY.md

**목차:**
- 프로젝트 배경 (로컬 테스트 없음 → 상용 배포)
- 3단계 작업 분류 (무접촉/근접/접촉)
- 배포 전 체크리스트
- 배포 후 5단계 검증 프로토콜
- 위험 신호 & 대응
- 시나리오별 가이드 (4가지)
- 진행 현황 표

**읽어야 할 사람:**
- 모든 팀원 (개요 이해용)

**핵심 메시지:**
```
🎯 "과잉 안전 = 정상"
   한 번에 하나만
   백업은 필수
   롤백 경로는 항상 확보
```

---

### PROTOCOL-MIGRATION-SAFETY.md

**목차:**
1. 작업 분류 체계 & 안전장치 (3단계)
2. 롤백 전략 (4가지 유형)
3. 배포 검증 순서 & 체크리스트 (5단계)
4. 위험 신호 감지 & 즉시 대응
5. 작업 전 필수 점검 (모든 작업/DB/코드별)
6. 코드 변경 시 안전 규칙
7. 실전 시나리오 & 대응 (2가지)
8. 빠른 참고: 일상적 명령어 모음
9. 체크리스트 인쇄 템플릿
10. 문서 링크 & 참조

**읽어야 할 사람:**
- 실제 작업 수행자
- 리더 (코드/DB 리뷰)

**핵심 내용:**
```
무접촉 (1분) → git로 관리, 즉시 배포 가능
근접 (20분) → pg_dump/mysqldump 필수, DDL 신중
접촉 (30분+) → Harold님 컨펌 필수, 5경로 전수점검

롤백: git revert (코드) or pg_restore (DB)
검증: 5단계 체크리스트 (배포 후 5분)
```

---

### QUICK-REFERENCE-MIGRATION.md

**목차:**
1. 작업 유형별 심사 체크리스트
   - 문서 수정 (1분)
   - DB 스키마 변경 (20분)
   - 코드 변경 (30분+)
2. 위험 신호 & 대응 (5분 안에)
3. 매 배포 후 검증 (5분 체크리스트)
4. 롤백 명령어 (원라이너)
5. 자주 쓰는 명령어 (Copy-Paste)
6. 연락 체인 (문제 시)
7. 🔴 Critical 즉시 중단 신호
8. 작업 기록 템플릿

**읽어야 할 사람:**
- 모든 작업자 (**A4 2장 인쇄해서 책상에 배치**)

**형식:**
```
□ 체크박스 형식
□ Copy-Paste 명령어
□ 신호 감지표
□ 빠른 의사결정
```

**사용 예시:**
```
작업 시작 → QUICK-REFERENCE 1번 항목 확인 → 체크박스 채우기
배포 후 → 3번 항목 (검증 체크리스트) 순서대로 실행
문제 발생 → 2번 항목 (위험 신호) 확인 → 대응 실행
```

---

### SCRIPTS-SAFETY.sh

**함수 목록:**

```bash
# 상태 확인
health_check          전체 헬스 체크
check_pm2            PM2 상태
check_agents         Agent 상태 (11개)
check_db             DB 연결

# 백업
backup_postgres      PostgreSQL 덤프 + 로컬 다운로드
backup_mysql         MySQL 덤프 + 로컬 다운로드
backup_all           전체 백업

# 배포
deploy_code          git pull + pm2 restart
deploy_full          코드 + 프론트빌드

# 테스트
test_api             API 응답 확인
test_send            테스트 발송 통계

# 롤백
rollback_code <hash> git revert 자동화
rollback_db <file>   DB 복원

# 종합
post_deploy_validation 5단계 검증 자동화
```

**사용 방법:**

```bash
# 단독 실행
./SCRIPTS-SAFETY.sh health_check
./SCRIPTS-SAFETY.sh deploy_code
./SCRIPTS-SAFETY.sh post_deploy_validation

# 또는 함수로 import
source SCRIPTS-SAFETY.sh
health_check
deploy_code
```

**설정:**
```bash
SERVER_IP="58.227.193.62"
SERVER_USER="administrator"
APP_DIR="/home/administrator/targetup-app"
```

---

## 🚀 실행 흐름

### 일반적인 배포 시나리오

```
1. QUICK-REFERENCE 작업 유형 확인
   └─ 무접촉/근접/접촉 중 선택

2. 배포 전 체크리스트 확인
   └─ 10개 항목 모두 ✅ 완료

3. 작업 진행
   └─ 로컬 개발 → git commit → git push

4. 배포 실행
   ./SCRIPTS-SAFETY.sh deploy_code  (또는 deploy_full)

5. 검증 실행
   ./SCRIPTS-SAFETY.sh post_deploy_validation

6. 결과 확인
   □ 5/5 통과 → 배포 확정
   □ 1개 실패 → 즉시 롤백
```

### 문제 발생 시나리오

```
배포 중 에러 감지
  ↓
QUICK-REFERENCE 위험 신호 확인
  ↓
해당하는 신호 찾기
  ↓
제시된 대응 명령 실행
  ↓
롤백 또는 수정
  ↓
재검증
  ↓
Harold님 보고
```

---

## 📖 학습 경로

### Week 1: 기초 학습

```
Day 1: README-MIGRATION-SAFETY.md 읽기
       - 프로젝트 이해
       - 3단계 분류 이해
       - 5단계 검증 프로토콜 이해

Day 2: PROTOCOL-MIGRATION-SAFETY.md 읽기 (1/2)
       - 작업 분류 체계
       - 안전장치별 규칙

Day 3: PROTOCOL-MIGRATION-SAFETY.md 읽기 (2/2)
       - 배포 검증 순서
       - 위험 신호 감지

Day 4: QUICK-REFERENCE-MIGRATION.md 인쇄
       - A4 2장으로 인쇄
       - 책상에 배치

Day 5: SCRIPTS-SAFETY.sh 테스트
       ./SCRIPTS-SAFETY.sh help
       ./SCRIPTS-SAFETY.sh health_check
```

### Week 2: 실습

```
Day 6-7: 무접촉 작업 연습
        OPS.md 수정 → 프로토콜 따라 배포 → 검증 완료

Day 8-9: 근접 작업 연습 (선택)
        DB 스키마 변경 → 백업 → DDL 실행 → 검증

Day 10: 코드 변경 연습 (선택)
        campaigns.ts 수정 → 5경로 검증 → 배포 → 검증
```

---

## ✅ 체크리스트: 배포 준비 완료

```
【문서 준비】
□ README 읽음
□ PROTOCOL 읽음
□ QUICK-REFERENCE 인쇄함 (A4 2장)
□ QUICK-REFERENCE 책상에 배치함

【스크립트 준비】
□ SCRIPTS-SAFETY.sh 권한 확인 (755)
□ help 명령 테스트
□ health_check 명령 테스트

【첫 배포 준비】
□ Harold님과 브리핑 완료
□ 배포 항목 확인 (무접촉/근접/접촉)
□ QUICK-REFERENCE 1번 항목 체크리스트 준비
□ 롤백 커밋/스크립트 준비 완료

【배포 진행】
□ QUICK-REFERENCE 참조해서 진행
□ SCRIPTS-SAFETY.sh로 자동화 사용
□ 배포 후 post_deploy_validation 실행
□ 모든 검증 통과 확인

【최종】
□ 배포 기록 남김
□ STATUS.md 갱신
□ Harold님 보고
```

---

## 📞 문의 & 피드백

**문서 이해 안 됨:**
- PROTOCOL-MIGRATION-SAFETY.md 해당 섹션 + QUICK-REFERENCE 참조

**스크립트 실행 문제:**
- ./SCRIPTS-SAFETY.sh help 확인
- 서버 IP/user 설정 확인 (SCRIPTS-SAFETY.sh 상단)

**배포 중 문제:**
- QUICK-REFERENCE "위험 신호" 섹션 참조
- Harold님 연락 (증상/원인 3줄 + 대응 내용)

**문서 개선:**
- Harold님께 피드백 요청
- 다음 버전에 반영

---

## 📊 문서 메타정보

| 문서 | 작성 시간 | 목표 |
|------|----------|------|
| README-MIGRATION-SAFETY.md | 1시간 | 전체 개요 이해 |
| PROTOCOL-MIGRATION-SAFETY.md | 2시간 | 상세 규칙 숙지 |
| QUICK-REFERENCE-MIGRATION.md | 1시간 | 빠른 실행 참조 |
| SCRIPTS-SAFETY.sh | 1.5시간 | 배포 자동화 |

**총 작성 시간:** 5.5시간
**총 문서 크기:** 73KB (+ 스크립트 19KB = 92KB)

---

## 🎯 성공 기준

이 프로토콜이 성공적이라고 판단하는 기준:

```
✅ 배포 전에 QUICK-REFERENCE 체크리스트 100% 완료
✅ 배포 후 5단계 검증 5/5 통과
✅ 6개월 동안 기간계 시스템 다운 0건
✅ 긴급 롤백 필요한 경우 5분 이내 완료
✅ 모든 배포 기록이 STATUS.md에 추적됨
✅ 새 팀원도 문서만 읽고 배포 가능
```

---

**최종 승인:** Harold님
**문서 버전:** 1.0
**마지막 갱신:** 2026-03-05
**다음 검토:** 2026-04-05 (1개월 후 피드백 수집)
