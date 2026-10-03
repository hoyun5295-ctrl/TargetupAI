#!/usr/bin/env bash
# 전송자격인증 재접수(2026-10-06) — 한줄로 서버(.62) 설정 · 로그 보관 · 백업 · 방화벽 확인
#
# 읽기 전용이다. 설정을 바꾸지 않고, 비밀번호 · 키는 찍지 않는다(.env 는 통제 스위치 이름으로 고른 줄만 본다).
# 실행(한줄로 서버 .62):
#   bash /home/administrator/targetup-app/docs/transmission-cert/resubmit-1006/evidence/hanjul-server-check.sh \
#     > ~/cert-server-hanjul.txt 2>&1
# 방화벽 상태 · 인증 로그는 root 권한이 있어야 나온다. 권한 없이 돌리면 그 구간에만 안내가 찍힌다.

ENV_FILE=/home/administrator/targetup-app/packages/backend/.env
IS_ROOT=0; [ "$(id -u)" = "0" ] && IS_ROOT=1

sec() { echo; echo "======================================================================"; echo "$1"; echo "======================================================================"; }

echo "수집 시각: $(date '+%Y-%m-%d %H:%M:%S %Z') / 서버: $(hostname) / 실행 계정: $(id -un)"

sec "[2.2 · 3.4 · 3.5] 통제 시행 스위치 (운영 프로세스가 읽는 .env)"
grep -E '^(GEO_BLOCK_ENFORCE_FROM|ORIGIN_ALLOWLIST_ENFORCE_FROM|MFA_ENFORCE_FROM|MFA_PILOT_LOGIN_IDS|SENDER_AUTH_ENFORCE_FROM|SENDER_AUTH_PILOT_LOGIN_IDS|SENDER_AUTH_FAIL_CLOSED|IDENTITY_VERIFY_ENFORCE_FROM|IDENTITY_VERIFY_PILOT_LOGIN_IDS|IDENTITY_VERIFY_PROVIDER|AUDIT_LOG_VIEWER_IDS|GEO_HITS_VIEWER_IDS)=' "$ENV_FILE" \
  || echo "(해당 줄 없음)"
echo "-- .env 마지막 수정 / 백엔드 기동 시각 (수정이 기동보다 늦으면 아직 반영 전이다)"
stat -c '%y  .env' "$ENV_FILE"
PID=$(pm2 pid targetup-backend 2>/dev/null)
[ -n "$PID" ] && [ "$PID" != "0" ] && ps -o lstart= -p "$PID" | sed 's/$/  targetup-backend 기동/'

sec "[3.1-1] 방화벽 상태와 정책"
if [ "$IS_ROOT" = "1" ]; then
  ufw status verbose
  echo "-- 방화벽 서비스"; systemctl is-active ufw fail2ban
  echo "-- 정책 파일 마지막 수정"; stat -c '%y  %n' /etc/ufw/user.rules /etc/ufw/after.rules 2>/dev/null
else
  echo "(root 권한 필요 — ufw status verbose)"
  systemctl is-active ufw fail2ban
fi

sec "[3.1-4] 방화벽 정책 변경 이력 (서버에 남은 명령 기록)"
if [ "$IS_ROOT" = "1" ]; then
  zgrep -h -a 'COMMAND=.*ufw ' /var/log/auth.log* 2>/dev/null | sort | tail -60
  echo "-- 저널에 남은 방화벽 명령(최근 400일)"
  journalctl --no-pager -o short-iso --since "400 days ago" _COMM=sudo 2>/dev/null | grep -a 'ufw ' | tail -60
else
  echo "(root 권한 필요 — /var/log/auth.log 의 방화벽 명령 기록)"
fi

sec "[3.1-4] 서버 관리자 접속 이력 (최근 30건)"
last -n 30 -F -i 2>/dev/null | head -34

sec "[3.1-1] 외부로 열린 포트"
ss -tlnH 2>/dev/null | awk '{print $4}' | sort -u

sec "[4.1-5 · 4.2-5] 로그 보관 설정 (1년)"
echo "-- 앱 로그 회전(pm2-logrotate)"
pm2 conf pm2-logrotate 2>/dev/null | grep -E 'retain|compress|max_size|rotateInterval|dateFormat' || echo "(pm2-logrotate 설정을 읽지 못함)"
echo "-- 앱 로그 파일: 가장 오래된 것 5개 / 개수 / 용량"
ls -ltr ~/.pm2/logs 2>/dev/null | sed -n '2,6p'
echo "파일 수: $(ls ~/.pm2/logs 2>/dev/null | wc -l) / 용량: $(du -sh ~/.pm2/logs 2>/dev/null | cut -f1)"
echo "-- 웹 서버 로그 회전(nginx)"
grep -E '^\s*(daily|weekly|rotate|compress)' /etc/logrotate.d/nginx 2>/dev/null
echo "nginx 로그 파일 수: $(ls /var/log/nginx 2>/dev/null | wc -l) / 가장 오래된 파일: $(ls -tr /var/log/nginx 2>/dev/null | head -1)"
echo "-- 시스템 저널 보관"
grep -E '^(SystemMaxUse|MaxRetentionSec)' /etc/systemd/journald.conf 2>/dev/null || echo "(journald.conf 에 보관 설정 줄 없음)"
journalctl --disk-usage 2>/dev/null
echo "저널에서 가장 오래된 기록: $(journalctl --no-pager -o short-iso 2>/dev/null | head -1 | cut -c1-25)"

sec "[4.1-5 · 4.2-5] 로그 접근 권한 (삭제 · 변조 방지)"
ls -ld ~/.pm2/logs /var/log/nginx /var/log/journal 2>/dev/null
echo "-- DB 는 로컬에서만 열려 있다(외부 접속 불가)"
ss -tlnH 2>/dev/null | awk '{print $4}' | grep -E ':(5432|3306|6379)$'

sec "[4.1-5] 백업 (매일 · 암호화 · 외부 서버 전송)"
echo "-- 예약"
crontab -l 2>/dev/null | grep -i backup || echo "(백업 예약 줄 없음)"
echo "-- 최근 실행 기록(마지막 12줄)"
tail -12 /home/administrator/backups/cron.log 2>/dev/null || echo "(cron.log 없음)"
echo "-- 서버에 남아 있는 백업(최근 8개)"
ls -lt /home/administrator/backups 2>/dev/null | sed -n '2,9p'
echo "-- 마지막 성공 표식"
stat -c '%y  LAST_SUCCESS' /home/administrator/backups/LAST_SUCCESS 2>/dev/null || echo "(LAST_SUCCESS 없음)"

sec "[4.1-5] 백업 실패 경보 (백업이 안 돌면 알리는 감시)"
echo "-- 감시 예약"
crontab -l 2>/dev/null | grep -i 'backup-monitor' || echo "(감시 예약 줄 없음)"
echo "-- 감시 기록(마지막 8줄)"
tail -8 /home/administrator/backups/monitor.log 2>/dev/null || echo "(monitor.log 없음)"
echo "-- 경보 보낼 곳 설정 여부(값은 찍지 않는다)"
if grep -q '^ALERT_CMD=.\+' /home/administrator/backups/.env 2>/dev/null; then echo "ALERT_CMD 설정됨"; else echo "ALERT_CMD 없음 또는 비어 있음"; fi

echo
echo "끝"
