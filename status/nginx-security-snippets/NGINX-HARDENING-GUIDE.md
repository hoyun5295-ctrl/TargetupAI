# Nginx 보안 강화 가이드 (월요일 서비스 시작 전 적용)

Harold님 서버에서 단계별 실행. **Step 1 → 2 → 3 순서**.

---

## Step 1 — `/etc/nginx/nginx.conf`의 `http { }` 블록에 추가

서버에서:
```bash
sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak.$(date +%Y%m%d)
sudo nano /etc/nginx/nginx.conf
```
**`http {` 블록 안쪽 맨 위 (또는 기존 설정 어디든 http 블록 안)**에 아래 9줄 추가:

```nginx
    # ─────────────── 보안 강화 (2026-04 서비스 시작) ───────────────
    # nginx 버전 숨기기
    server_tokens off;

    # Rate limit zones — 공격/과부하 방어
    # key=$binary_remote_addr (IP 기준), zone=이름:10m (~16만 IP 저장), rate=초당 허용
    limit_req_zone $binary_remote_addr zone=login_zone:10m  rate=5r/m;    # 로그인 분당 5회
    limit_req_zone $binary_remote_addr zone=upload_zone:10m rate=10r/m;   # 업로드 분당 10회
    limit_req_zone $binary_remote_addr zone=api_zone:10m    rate=100r/m;  # 일반 API 분당 100회
    limit_req_zone $binary_remote_addr zone=webhook_zone:10m rate=300r/m; # 웹훅은 더 여유
    limit_req_status 429;
```

저장 후 테스트:
```bash
sudo nginx -t
```
→ `syntax is ok` + `test is successful` 나와야 Step 2로.

---

## Step 2 — 공용 보안 헤더 스니펫 파일 생성

**한 번 만들어 두면 각 server 블록에서 `include`로 재사용.** 서버에서:

```bash
sudo tee /etc/nginx/conf.d/security-headers.conf > /dev/null <<'EOF'
# 공용 보안 헤더 — server 또는 location 블록에서 include 로 사용
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
EOF
```

**주의**: `conf.d/*.conf`는 자동으로 `http {}` 블록에 `include`되지만, `add_header` 는 server/location 레벨에서 쓰는 지시자라 이 파일을 **바로 활성화하지 말고** Step 3에서 `include`로 불러옵니다.

**대신 위 파일을 `/etc/nginx/snippets/security-headers.conf` 로 두는 게 정석**:
```bash
sudo mkdir -p /etc/nginx/snippets
sudo mv /etc/nginx/conf.d/security-headers.conf /etc/nginx/snippets/security-headers.conf 2>/dev/null
sudo tee /etc/nginx/snippets/security-headers.conf > /dev/null <<'EOF'
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
EOF
```

---

## Step 3 — 각 server 블록에 rate limit + 보안 헤더 적용

서버에서 확인:
```bash
ls /etc/nginx/sites-enabled/
# → hanjul-flyer  targetup  targetup-app  targetup-company
```

**파일 4개 각각 수정**. 예시는 `targetup-app` (hanjul.ai/app.hanjul.ai 추정):

```bash
sudo cp /etc/nginx/sites-enabled/targetup-app /etc/nginx/sites-enabled/targetup-app.bak.$(date +%Y%m%d)
sudo nano /etc/nginx/sites-enabled/targetup-app
```

각 `server { }` 블록의 **443 포트 server** 안에 다음 3곳 수정:

### 3-1. server { } 안 최상단에 보안 헤더 include 추가
```nginx
server {
    listen 443 ssl http2;
    server_name hanjul.ai www.hanjul.ai;
    # ... 기존 ssl_certificate 등 ...

    include /etc/nginx/snippets/security-headers.conf;   # ★ 추가

    # ... 기존 location 등 ...
}
```

### 3-2. 로그인 엔드포인트에 rate limit 적용
```nginx
    # 로그인 전용 — 분당 5회 (burst 5 허용)
    location = /api/auth/login {
        limit_req zone=login_zone burst=5 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

### 3-3. 업로드 엔드포인트에 rate limit + body size
```nginx
    location ~ ^/api/upload/ {
        limit_req zone=upload_zone burst=3 nodelay;
        client_max_body_size 50m;   # 앱과 일치 (multer limit)
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
```

### 3-4. 나머지 API 전역 rate limit (기존 `/api/` location에 `limit_req` 한 줄 추가)
```nginx
    location /api/ {
        limit_req zone=api_zone burst=50 nodelay;   # ★ 추가
        proxy_pass http://127.0.0.1:3000;
        # ... 나머지 proxy_set_header 들 ...
    }
```

### 3-5. 전역 body size 줄이기 (기존 `client_max_body_size 50M` 찾아서 5M로)
```nginx
    client_max_body_size 5m;   # 전역 기본은 작게 — upload/mms는 location별로 50m 오버라이드
```

---

## Step 4 — 웹훅/콜백은 rate limit zone 다르게

`/api/alimtalk/webhook`, `/api/unsubscribes/080callback` 는 IP 화이트리스트로 나래인터넷/휴머스온만 접근 → `webhook_zone`(분당 300회)으로:

```nginx
    location = /api/alimtalk/webhook {
        limit_req zone=webhook_zone burst=50 nodelay;
        # allow 휴머스온_IP1; allow 휴머스온_IP2; deny all;   # Phase 0 IP 수령 후
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location = /api/unsubscribes/080callback {
        limit_req zone=webhook_zone burst=20 nodelay;
        # allow 나래인터넷_IP; deny all;   # IP 받으면 추가
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
```

---

## Step 5 — 문법 검증 + 무중단 reload

```bash
sudo nginx -t
```
→ `syntax is ok` + `test is successful` 필수.

이후:
```bash
sudo systemctl reload nginx
curl -sI https://hanjul.ai | grep -iE 'server|strict-transport|x-frame|x-content'
```

성공 기준:
- `Server: nginx` (버전 없이 — server_tokens off 확인)
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`

---

## Step 6 — Rate limit 실동작 테스트 (선택)

```bash
# 로그인 6번 빠르게 시도 → 6번째는 429 나와야 정상
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "시도 $i: %{http_code}\n" -X POST https://hanjul.ai/api/auth/login \
    -H "Content-Type: application/json" -d '{"loginId":"test","password":"x"}'
done
```

처음 5번은 401, 6번째부터 429 (Too Many Requests)면 정상.

---

## 롤백

문제 발생 시:
```bash
sudo cp /etc/nginx/nginx.conf.bak.YYYYMMDD /etc/nginx/nginx.conf
sudo cp /etc/nginx/sites-enabled/targetup-app.bak.YYYYMMDD /etc/nginx/sites-enabled/targetup-app
sudo nginx -t && sudo systemctl reload nginx
```

---

## 4개 sites-enabled 파일 모두 적용

- `targetup-app` → hanjul.ai / app.hanjul.ai
- `targetup-company` → app.hanjul.ai (추정 중복 확인)
- `targetup` → 슈퍼관리자 (sys.hanjullo.com)
- `hanjul-flyer` → hanjul-flyer.kr 등

**각 파일에** Step 3의 3-1 (보안 헤더 include)와 3-4 (api_zone rate limit)는 최소 적용. `/api/auth/login`은 targetup-app / targetup 두 곳만.

---

## 주의사항

- `limit_req_zone`을 여러 번 정의 금지 (conflict 에러) — Step 1에서 `http {}`에 한 번만.
- `add_header`를 server와 location 둘 다에 쓰면 **location이 우선**하고 server가 무효화됨. `always` 플래그로 회피 (snippet에 이미 포함).
- CSP 헤더는 `/api/flyer/p`, `/api/dm/v` 공개 페이지가 인라인 스크립트 필요하므로 **일단 미적용**. 추후 nonce 기반으로 도입 예정.
