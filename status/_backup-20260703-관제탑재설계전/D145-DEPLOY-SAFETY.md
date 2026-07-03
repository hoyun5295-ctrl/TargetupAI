# D145 (2026-05-07) — 배포 안전화 작업 가이드

> **5/6 18:54 ~ 5/7 04:00 = 9시간 거래처 차단 사고 영구 재발 방지.**
> 진짜 원인: Harold님이 5/6 18:44~18:54 사이 빌드 시도 → vite `emptyOutDir: true`(기본)로 dist 비움 → 빌드 도중 어떤 이유로 비정상 종료 → dist 비어있는 상태 9시간.

---

## ✅ 적용된 안전화 (코드 변경 완료)

### 1. atomic deploy 패턴 — `build:safe` 스크립트

각 frontend 패키지에 `npm run build:safe` 추가:
- `packages/frontend/scripts/safe-build.sh`
- `packages/company-frontend/scripts/safe-build.sh`
- `packages/flyer-frontend/scripts/safe-build.sh`

**동작:**
1. `npx vite build --outDir dist-new` → 별도 폴더에 빌드
2. `dist-new/index.html` 존재 + 사이즈 ≥ 100 + `dist-new/assets` 폴더 존재 검증
3. 검증 통과 → 옛 dist를 `dist-old`로 백업 + `dist-new`를 `dist`로 atomic mv
4. 검증 실패 → `dist-new` 청소 + 옛 `dist` 그대로 유지 (사이트 차단 0초)

= **빌드 실패해도 사이트는 옛 버전 그대로 작동.**

### 2. 모니터링 cron — `scripts/monitor-dist.sh` (2차 안전망)

1분마다 dist/index.html 부재/손상 자동 감지 + 자동 재빌드.

---

## 🛠️ Harold님 직접 작업 (서버 + 로컬)

### A. 서버에 atomic deploy 적용 (1회 — 다음 배포 시)

```bash
ssh administrator@58.227.193.62
cd /home/administrator/targetup-app
git pull

# safe-build.sh 실행 권한 부여 (1회)
chmod +x packages/frontend/scripts/safe-build.sh
chmod +x packages/company-frontend/scripts/safe-build.sh
chmod +x packages/flyer-frontend/scripts/safe-build.sh
chmod +x scripts/monitor-dist.sh
```

### B. 로컬 PowerShell 프로필 — `tp-deploy-full` 함수 변경

**현재 함수 (위험):**
```powershell
function tp-deploy-full {
    ssh administrator@58.227.193.62 "cd targetup-app && git pull && cd packages/backend && npm install && npm run build && cd ../frontend && npm run build && cd ../flyer-frontend && npm run build && pm2 restart all"
}
```

**변경 후 (안전):**
```powershell
function tp-deploy-full {
    $cmd = @'
cd /home/administrator/targetup-app
git pull
cd packages/backend && npm install && npm run build || { echo "❌ backend 빌드 실패"; exit 1; }
cd ../frontend && npm run build:safe || { echo "❌ frontend 빌드 실패 — 옛 dist 유지"; exit 1; }
cd ../company-frontend && npm run build:safe || { echo "❌ company-frontend 빌드 실패 — 옛 dist 유지"; exit 1; }
cd ../flyer-frontend && npm run build:safe || { echo "❌ flyer-frontend 빌드 실패 — 옛 dist 유지"; exit 1; }
pm2 restart all
echo "✅ 전체 배포 완료"
ls -la /home/administrator/targetup-app/packages/frontend/dist/index.html
'@
    ssh administrator@58.227.193.62 $cmd
}
```

**핵심 변경:**
- `npm run build` → `npm run build:safe` (atomic deploy 패턴 사용)
- 각 단계에 `|| exit 1` 추가 — 빌드 실패 시 즉시 중단 + 옛 dist 유지
- 마지막에 `index.html` 시각 확인 출력

### C. 모니터링 cron 등록 (1회)

```bash
ssh administrator@58.227.193.62
crontab -e

# 추가:
* * * * * /home/administrator/targetup-app/scripts/monitor-dist.sh >> /home/administrator/dist-monitor.log 2>&1

# 저장 후
crontab -l  # 확인
```

= 1분마다 dist/index.html 자동 검사 + 부재 시 즉시 자동 재빌드.

---

## 🚀 새 안전 배포 절차 (다음 세션부터)

```powershell
# 1. 코드 push
tp-push "메시지"

# 2. 안전 배포 (build:safe 사용, 빌드 실패해도 사이트 차단 0초)
tp-deploy-full

# 3. 즉시 검증
# 출력 마지막에 ls -la dist/index.html 표시됨 — 시각이 방금이어야 통과
# 브라우저 https://hanjul.ai (Ctrl+F5) 접속 정상 확인
```

---

## 🛡️ 검증 시나리오 (atomic deploy 안전성)

| 상황 | 옛 결과 (D145 사고) | 새 결과 (atomic deploy) |
|---|---|---|
| 빌드 정상 | dist 정상, 사이트 정상 | dist 정상, 사이트 정상 |
| 빌드 도중 OOM/SIGKILL | dist 비어있는 상태 → **9시간 차단** | dist-new 청소, 옛 dist 유지 → **차단 0초** |
| 빌드 도중 hang | dist 비어있는 상태 → 차단 | dist-new에서 hang, 옛 dist 유지 |
| TS 에러 | npm run build 실패 종료, dist 비어있음 → 차단 | tsc 단계 실패 시 dist-new 안 만듦, 옛 dist 유지 |
| index.html 누락 | dist 폴더 있고 index.html 없음 → 403 | 검증 실패 → 옛 dist 유지 |

---

## 📋 다음 세션 즉시 작업 체크리스트

- [ ] Harold님 로컬 PowerShell `tp-deploy-full` 함수 변경 (위 B 섹션)
- [ ] 서버 SSH → 권한 부여 + 모니터링 cron 등록 (위 A + C)
- [ ] 한 번 `tp-deploy-full` 테스트 — 빌드 결과 검증
- [ ] (선택) 의도적으로 TS 에러 코드 push 후 tp-deploy-full 실행 → 옛 dist 유지되는지 검증

이게 다 적용되면 어제 같은 9시간 사고는 영구 차단됩니다.
