#!/usr/bin/env bash
# 전송자격인증 재접수(2026-10-06) — 비토 게이트웨이 서버(.65) 방화벽 · 로그 보관 · 백업 확인
#
# 읽기 전용이다. 설정을 바꾸지 않고, 비밀번호 · 키는 찍지 않는다(환경 파일은 열지 않는다).
# 이 서버에는 한줄로 저장소가 없으므로 내용을 붙여 넣어 실행한다(게이트웨이 서버 .65):
#   bash > ~/cert-server-gateway.txt 2>&1 <<'CHECK'
#   (이 파일 내용)
#   CHECK
# 방화벽 상태 · 인증 로그는 root 권한이 있어야 나온다.

IS_ROOT=0; [ "$(id -u)" = "0" ] && IS_ROOT=1
sec() { echo; echo "======================================================================"; echo "$1"; echo "======================================================================"; }

echo "수집 시각: $(date '+%Y-%m-%d %H:%M:%S %Z') / 서버: $(hostname) / 실행 계정: $(id -un)"

sec "[3.1-1 · 2.2-1] 방화벽 상태와 정책 (접속 포트는 등록된 출발지만 허용)"
if [ "$IS_ROOT" = "1" ]; then
  ufw status numbered
  echo "-- 정책 파일 마지막 수정"; stat -c '%y  %n' /etc/ufw/user.rules /etc/ufw/after.rules 2>/dev/null
else
  echo "(root 권한 필요 — ufw status numbered)"
fi
echo "-- 방화벽 · 침입 차단 서비스"; systemctl is-active ufw fail2ban

sec "[3.1-4] 방화벽 정책 변경 이력 (서버에 남은 명령 기록)"
if [ "$IS_ROOT" = "1" ]; then
  zgrep -h -a 'COMMAND=.*ufw ' /var/log/auth.log* 2>/dev/null | sort | tail -60
  [ -f /var/log/sudo.log ] && { echo "-- /var/log/sudo.log 의 방화벽 명령"; grep -a -B1 'ufw ' /var/log/sudo.log | tail -60; }
else
  echo "(root 권한 필요 — /var/log/auth.log · /var/log/sudo.log 의 방화벽 명령 기록)"
fi

sec "[3.1-4] 서버 관리자 접속 이력 (최근 30건)"
last -n 30 -F -i 2>/dev/null | head -34

sec "[3.1-1] 외부로 열린 포트"
ss -tlnH 2>/dev/null | awk '{print $4}' | sort -u

sec "[3.1-4] 서버 접속 · 명령 수집 장치 (감사 기록으로 보내는 쪽)"
systemctl list-units --type=service --all --no-pager 2>/dev/null | grep -iE 'audit|bito' | head -20
systemctl is-active auditd 2>/dev/null | sed 's/^/auditd: /'

sec "[4.1-5 · 4.2-5] 로그 보관 설정 (1년)"
echo "-- 시스템 저널 보관"
grep -E '^(SystemMaxUse|MaxRetentionSec)' /etc/systemd/journald.conf 2>/dev/null || echo "(journald.conf 에 보관 설정 줄 없음)"
journalctl --disk-usage 2>/dev/null
echo "저널에서 가장 오래된 기록: $(journalctl --no-pager -o short-iso 2>/dev/null | head -1 | cut -c1-25)"
echo "-- 웹 서버 로그 회전(nginx)"
grep -E '^\s*(daily|weekly|rotate|compress)' /etc/logrotate.d/nginx 2>/dev/null
echo "nginx 로그 파일 수: $(ls /var/log/nginx 2>/dev/null | wc -l) / 가장 오래된 파일: $(ls -tr /var/log/nginx 2>/dev/null | head -1)"
echo "-- 기본 회전 주기"
grep -E '^\s*(daily|weekly|monthly|rotate)' /etc/logrotate.conf 2>/dev/null

sec "[4.1-5 · 4.2-5] 로그 · DB 접근 권한"
ls -ld /var/log/nginx /var/log/journal 2>/dev/null
echo "-- DB 는 로컬에서만 열려 있다(외부 접속 불가)"
ss -tlnH 2>/dev/null | awk '{print $4}' | grep -E ':(5432|33306|6379)$'

sec "[4.1-5] DB 백업"
echo "-- 이 계정의 예약"; crontab -l 2>/dev/null | grep -iE 'backup|pg_dump|dump' || echo "(백업 예약 줄 없음)"
if [ "$IS_ROOT" = "1" ]; then
  echo "-- root 예약"; crontab -l -u root 2>/dev/null | grep -iE 'backup|pg_dump|dump' || echo "(백업 예약 줄 없음)"
  echo "-- 시스템 예약"; grep -rlsiE 'backup|pg_dump' /etc/cron.d /etc/cron.daily 2>/dev/null || echo "(해당 파일 없음)"
fi
echo "-- 예약 타이머"; systemctl list-timers --all --no-pager 2>/dev/null | grep -iE 'backup|dump' || echo "(백업 타이머 없음)"
echo "-- 백업 디렉터리(저장소 배치 기준 /opt/bito-gateway/backups · root 전용)"
if [ "$IS_ROOT" = "1" ]; then
  ls -lt /opt/bito-gateway/backups 2>/dev/null | sed -n '2,10p' || echo "(디렉터리 없음)"
  stat -c '%y  LAST_SUCCESS' /opt/bito-gateway/backups/LAST_SUCCESS 2>/dev/null || echo "(LAST_SUCCESS 없음)"
  echo "-- 최근 실행 기록(마지막 10줄)"; tail -10 /opt/bito-gateway/backups/cron.log 2>/dev/null || echo "(cron.log 없음)"
  echo "-- 감시 기록(마지막 6줄)"; tail -6 /opt/bito-gateway/backups/monitor.log 2>/dev/null || echo "(monitor.log 없음)"
  echo "-- 경보 보낼 곳 설정 여부(값은 찍지 않는다)"
  if grep -q '^ALERT_CMD=.\+' /opt/bito-gateway/backups/.env 2>/dev/null; then echo "ALERT_CMD 설정됨"; else echo "ALERT_CMD 없음 또는 비어 있음"; fi
else
  echo "(root 권한 필요 — /opt/bito-gateway/backups)"
fi

sec "[2.2-1] 미등록 출발지 거부 — 게이트웨이 프로세스 로그"
echo "최근 30일 「Agent IP allowlist denied」 줄 수: $(journalctl -u bito-gateway --no-pager --since '30 days ago' 2>/dev/null | grep -c 'IP allowlist denied')"
journalctl -u bito-gateway --no-pager -o short-iso --since '30 days ago' 2>/dev/null | grep 'IP allowlist denied' | tail -5

echo
echo "끝"
