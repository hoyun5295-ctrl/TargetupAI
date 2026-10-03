# -*- coding: utf-8 -*-
"""
비토 게이트웨이 증빙 원문 (2026-10-03 수집)

Harold가 게이트웨이 운영 서버에서 실행해 돌려준 출력을 **글자 그대로** 옮긴 것이다. 값을 고치지 않는다.
이미지를 만들 때의 가림(고객사 식별값 · 외부 주소 끝자리)은 make_evidence_images.py 가 하고, 여기 원문은 그대로 둔다.

수집 세 번
  Q1 = 로그 조회 1차 (2026-10-03 07:26 · 운영 DB · 읽기 전용)
  Q2 = 로그 조회 2차 (2026-10-03 07:29 무렵 · 운영 DB · 읽기 전용)
  S1 = 서버 설정 확인 (2026-10-03 07:31 무렵 · 게이트웨이 서버 · root)
"""

COLLECTED = {
    'Q1': '2026-10-03 07:26 (한국 시각)',
    'Q2': '2026-10-03 07:29 (한국 시각)',
    'S1': '2026-10-03 07:31 (한국 시각)',
}

# ── Q1 [1] 기록 종류별 월별 건수 — 머리 두 줄(발췌 표에 공통으로 붙인다) ──
Q1_KIND_HEADER = r"""
                   action                    |       target_type        |  first_at  |  last_at   | aug |  sep   |  oct
---------------------------------------------+--------------------------+------------+------------+-----+--------+--------
""".strip('\n')

UFW_STATUS = r"""
Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    115.138.27.202             # gateway-owner-ssh
[ 2] 80/tcp                     ALLOW IN    Anywhere                   # gateway-http-acme
[ 3] 443/tcp                    ALLOW IN    Anywhere                   # gateway-https
[ 4] 4404/tcp                   ALLOW IN    115.138.27.202             # gateway-owner-rcs-webhook
[ 5] 9443/tcp                   ALLOW IN    58.227.193.62              # hanjul-agent-grpc-tls
[ 6] 9443/tcp                   ALLOW IN    58.227.193.66              # bito-console-agent-grpc-tls
[ 7] 9443/tcp                   ALLOW IN    119.193.215.98             # agent itensms03 아이티앤
[ 8] 9443/tcp                   LIMIT IN    Anywhere                   # agent grpc tls - app allowlist enforces source
[ 9] 22/tcp                     ALLOW IN    180.226.236.94             # company-admin-ssh
[10] 22/tcp                     ALLOW IN    106.101.137.84             # temporary harold hotspot ssh
[11] 9444/tcp                   LIMIT IN    Anywhere                   # ViTO spec TCP mTLS 2026-09-24
[12] 80/tcp (v6)                ALLOW IN    Anywhere (v6)              # gateway-http-acme
[13] 443/tcp (v6)               ALLOW IN    Anywhere (v6)              # gateway-https
[14] 9443/tcp (v6)              LIMIT IN    Anywhere (v6)              # agent grpc tls - app allowlist enforces source
[15] 9444/tcp (v6)              LIMIT IN    Anywhere (v6)              # ViTO spec TCP mTLS 2026-09-24
""".strip('\n')

UFW_FILES = r"""
2026-09-24 20:31:23.867845587 +0900  /etc/ufw/user.rules
2026-07-31 15:41:13.785134252 +0900  /etc/ufw/after.rules
""".strip('\n')

UFW_COMMAND_LOG = r"""
2026-08-30T15:48:55.539913+09:00 invito sudo:   invito : TTY=pts/0 ; PWD=/home/invito ; USER=root ; TSID=0005BN ; COMMAND=/usr/sbin/ufw status verbose
2026-08-30T15:49:53.499324+09:00 invito sudo:   invito : TTY=pts/0 ; PWD=/home/invito ; USER=root ; TSID=0005BP ; COMMAND=/usr/sbin/ufw allow proto tcp from 58.227.193.66 to any port 9090 comment bito-console-agent-grpc
2026-08-30T15:49:58.380374+09:00 invito sudo:   invito : TTY=pts/0 ; PWD=/home/invito ; USER=root ; TSID=0005BQ ; COMMAND=/usr/sbin/ufw status verbose
2026-09-07T22:58:41.784351+09:00 invito sudo:   invito : TTY=pts/0 ; PWD=/home/invito ; USER=root ; TSID=0005JS ; COMMAND=/usr/sbin/ufw status verbose
2026-09-08T21:26:35.195178+09:00 invito sudo:   invito : TTY=pts/0 ; PWD=/home/invito/bito-dashboard-upload ; USER=root ; TSID=0005NY ; COMMAND=/usr/sbin/ufw status numbered
2026-09-08T21:26:42.128959+09:00 invito sudo:   invito : TTY=pts/0 ; PWD=/home/invito/bito-dashboard-upload ; USER=root ; TSID=0005NZ ; COMMAND=/usr/sbin/ufw allow from 119.193.215.98/32 to any port 9443 proto tcp comment 'agent itensms03 아이티앤'
2026-09-08T21:26:46.883419+09:00 invito sudo:   invito : TTY=pts/0 ; PWD=/home/invito/bito-dashboard-upload ; USER=root ; TSID=0005O0 ; COMMAND=/usr/sbin/ufw status numbered
2026-09-08T22:07:58.856607+09:00 invito sudo:   invito : TTY=pts/0 ; PWD=/home/invito/bito-dashboard-upload ; USER=root ; TSID=0005OJ ; COMMAND=/usr/sbin/ufw limit 9443/tcp comment 'agent grpc tls - app allowlist enforces source'
2026-09-08T22:08:29.241322+09:00 invito sudo:   invito : TTY=pts/0 ; PWD=/home/invito/bito-dashboard-upload ; USER=root ; TSID=0005OK ; COMMAND=/usr/sbin/ufw status numbered
2026-09-15T12:22:22.223221+09:00 invito sudo:   invito : TTY=pts/0 ; PWD=/home/invito ; USER=root ; TSID=0005Q1 ; COMMAND=/usr/sbin/ufw status verbose
2026-09-15T12:24:41.031001+09:00 invito sudo:   invito : TTY=pts/0 ; PWD=/home/invito ; USER=root ; TSID=0005Q4 ; COMMAND=/usr/sbin/ufw allow from 180.226.236.94 to any port 22 proto tcp comment company-admin-ssh
2026-09-15T12:24:41.214281+09:00 invito sudo:   invito : TTY=pts/0 ; PWD=/home/invito ; USER=root ; TSID=0005Q5 ; COMMAND=/usr/sbin/ufw status numbered
2026-09-23T14:03:11.943246+09:00 invito sudo:   invito : TTY=pts/0 ; PWD=/home/invito ; USER=root ; TSID=0005WX ; COMMAND=/usr/sbin/ufw status
2026-09-26T20:26:37.315229+09:00 invito sudo:     root : TTY=pts/1 ; PWD=/root ; USER=root ; TSID=000617 ; COMMAND=/usr/sbin/ufw status verbose
2026-09-26T20:26:42.252364+09:00 invito sudo:     root : TTY=pts/1 ; PWD=/root ; USER=root ; TSID=000618 ; COMMAND=/usr/sbin/ufw status numbered
2026-09-26T20:27:50.191325+09:00 invito sudo:     root : TTY=pts/1 ; PWD=/root ; USER=root ; TSID=00061A ; COMMAND=/usr/sbin/ufw status verbose
2026-09-26T20:27:50.274559+09:00 invito sudo:     root : TTY=pts/1 ; PWD=/root ; USER=root ; TSID=00061B ; COMMAND=/usr/sbin/ufw status numbered
""".strip('\n')

LAST_LOGINS = r"""
invito   pts/0        115.138.27.202   Sat Oct  3 07:26:12 2026   still logged in
invito   pts/0        180.226.236.94   Fri Oct  2 09:14:54 2026 - Fri Oct  2 15:29:27 2026  (06:14)
invito   pts/0        115.138.27.202   Fri Oct  2 08:14:13 2026 - Fri Oct  2 08:38:48 2026  (00:24)
invito   pts/2        115.138.27.202   Thu Oct  1 20:48:13 2026 - Thu Oct  1 20:48:43 2026  (00:00)
invito   pts/2        115.138.27.202   Thu Oct  1 19:50:34 2026 - Thu Oct  1 19:50:39 2026  (00:00)
invito   pts/2        115.138.27.202   Thu Oct  1 18:58:05 2026 - Thu Oct  1 18:58:10 2026  (00:00)
invito   pts/0        115.138.27.202   Thu Oct  1 17:58:50 2026 - Fri Oct  2 02:04:04 2026  (08:05)
invito   pts/0        115.138.27.202   Thu Oct  1 17:55:57 2026 - Thu Oct  1 17:56:01 2026  (00:00)
invito   pts/0        115.138.27.202   Thu Oct  1 17:11:51 2026 - Thu Oct  1 17:11:56 2026  (00:00)
invito   pts/0        115.138.27.202   Thu Oct  1 15:06:32 2026 - Thu Oct  1 15:06:38 2026  (00:00)
invito   pts/0        115.138.27.202   Thu Oct  1 14:37:02 2026 - Thu Oct  1 14:37:57 2026  (00:00)
invito   pts/2        115.138.27.202   Wed Sep 30 22:55:14 2026 - Wed Sep 30 22:55:23 2026  (00:00)
invito   pts/2        115.138.27.202   Wed Sep 30 22:37:50 2026 - Wed Sep 30 22:42:49 2026  (00:04)
invito   pts/0        115.138.27.202   Wed Sep 30 17:05:03 2026 - Thu Oct  1 08:53:18 2026  (15:48)
invito   pts/0        115.138.27.202   Tue Sep 29 15:24:37 2026 - Wed Sep 30 13:37:28 2026  (22:12)
invito   pts/1        115.138.27.202   Sun Sep 27 07:46:40 2026 - Sun Sep 27 07:46:45 2026  (00:00)
invito   pts/0        115.138.27.202   Sun Sep 27 07:46:23 2026 - Sun Sep 27 21:44:07 2026  (13:57)
invito   pts/3        100.73.46.62     Sat Sep 26 19:08:37 2026 - Sat Sep 26 22:33:44 2026  (03:25)
invito   pts/2        100.116.151.70   Sat Sep 26 18:58:30 2026 - Sat Sep 26 19:14:43 2026  (00:16)
invito   pts/0        115.138.27.202   Sat Sep 26 08:26:39 2026 - Sun Sep 27 02:21:19 2026  (17:54)

wtmp begins Thu Jul 30 16:47:22 2026
""".strip('\n')

SERVICES = r"""
auditd.service active running
bito-admin-api.service active running
bito-gateway.service active running
fail2ban.service active running
linkguard-control.service active running
""".strip('\n')

BACKUP_CRON = r"""
30 3 * * * /opt/bito-gateway/backups/bito-db-backup.sh >> /opt/bito-gateway/backups/cron.log 2>&1
30 8 * * * /opt/bito-gateway/backups/bito-db-backup-monitor.sh >> /opt/bito-gateway/backups/monitor.log 2>&1
""".strip('\n')

BACKUP_DIR = r"""
-rw-r--r-- 1 root root       5800 Oct  3 03:33 cron.log
-rw-r--r-- 1 root root         20 Oct  3 03:33 LAST_SUCCESS
-rw-r--r-- 1 root root  202955741 Oct  3 03:33 gw_message_request_20261003_033001.csv.gz.gpg
-rw-r--r-- 1 root root 1531232855 Oct  3 03:32 gw_main_20261003_033001.dump.gpg
-rw-r--r-- 1 root root        280 Oct  3 03:30 gw_manifest_20261003_033001.txt
-rw-r--r-- 1 root root        350 Oct  2 08:30 monitor.log
-rw-r--r-- 1 root root  193023395 Oct  2 03:32 gw_message_request_20261002_033001.csv.gz.gpg
-rw-r--r-- 1 root root 1245843873 Oct  2 03:32 gw_main_20261002_033001.dump.gpg
2026-10-03 03:33:20.285445853 +0900  LAST_SUCCESS
""".strip('\n')

BACKUP_RUN_LOG = r"""
[2026-10-03 03:32:46] 발송 기록(끝난 행의 MMS 이미지 제외)+암호화...
[2026-10-03 03:33:04] 발송 기록 완료: 202955741B
[2026-10-03 03:33:04] .59 오프사이트 전송...
[2026-10-03 03:33:20] 전송 완료
[2026-10-03 03:33:20] 로컬 정리 완료 (3일 초과 삭제)
[2026-10-03 03:33:20] ===== 백업 성공 완료 (본 1531232855B · 발송 기록 202955741B) =====
""".strip('\n')

BACKUP_MONITOR_LOG = r"""
[2026-09-29 08:30:01] OK: 백업 신선도 정상
[2026-09-30 08:30:01] OK: 백업 신선도 정상
[2026-10-01 08:30:01] OK: 백업 신선도 정상
[2026-10-02 08:30:01] OK: 백업 신선도 정상
""".strip('\n')

IP_DENIED_JOURNAL = r"""
2026-10-03T07:29:24+09:00 invito bito-gateway[2396885]: {"time":"2026-10-03T07:29:24.80263736+09:00","level":"WARN","msg":"Agent IP allowlist denied","component":"grpc-server","agentID":"bito-test-97","remoteAddr":"58.227.193.66:45408","remoteIP":"58.227.193.66","error":"remote IP 58.227.193.66 is not in agent allowlist"}
2026-10-03T07:30:20+09:00 invito bito-gateway[2396885]: {"time":"2026-10-03T07:30:20.052049733+09:00","level":"WARN","msg":"Agent IP allowlist denied","component":"grpc-server","agentID":"bito-test-97","remoteAddr":"58.227.193.66:49254","remoteIP":"58.227.193.66","error":"remote IP 58.227.193.66 is not in agent allowlist"}
2026-10-03T07:31:22+09:00 invito bito-gateway[2396885]: {"time":"2026-10-03T07:31:22.014052356+09:00","level":"WARN","msg":"Agent IP allowlist denied","component":"grpc-server","agentID":"bito-test-97","remoteAddr":"58.227.193.66:54612","remoteIP":"58.227.193.66","error":"remote IP 58.227.193.66 is not in agent allowlist"}
건수: 1973
""".strip('\n')

# ── Q1 ──
Q1_RETENTION = r"""
            oldest             |            newest             | total
-------------------------------+-------------------------------+--------
 2026-06-15 12:30:13.176027+09 | 2026-10-03 07:26:20.203042+09 | 618305
(1 row)
""".strip('\n')

Q1_ADMINS = r"""
 username |   role   | is_active |         last_login_at
----------+----------+-----------+-------------------------------
 admin    | admin    | t         | 2026-10-02 09:20:39.271407+09
 suran    | operator | t         | 2026-10-02 14:36:05.246152+09
(2 rows)
""".strip('\n')

Q1_ALLOWED_IP_COUNT = r"""
 total | active | active_with_ip | active_without_ip
-------+--------+----------------+-------------------
    17 |     15 |             13 |                 2
(1 row)
""".strip('\n')

Q1_ACCESS_MONTHLY = r"""
  month  | channel |  event_type  | outcome | events | ips
---------+---------+--------------+---------+--------+-----
 2026-09 | agent   | auth_failed  | denied  |     15 |   4
 2026-09 | agent   | connected    | ok      |    718 |   7
 2026-09 | agent   | disconnected | ok      |    706 |   7
 2026-09 | api     | request      | ok      |  15437 |   2
 2026-10 | agent   | auth_failed  | denied  |   1968 |   1
 2026-10 | agent   | connected    | ok      |      7 |   2
 2026-10 | agent   | disconnected | ok      |      8 |   3
 2026-10 | api     | request      | ok      |   1518 |   1
(8 rows)
""".strip('\n')

Q1_DENIED_REASONS = r"""
          reason           | channel | events | ips |           first_at            |            last_at
---------------------------+---------+--------+-----+-------------------------------+-------------------------------
 AUTH_FAILED               | agent   |   1981 |   5 | 2026-09-09 15:36:41.969137+09 | 2026-10-03 07:26:18.5994+09
 SPEC_CLIENT_CERT_REQUIRED | agent   |      2 |   1 | 2026-09-25 06:55:43.418608+09 | 2026-09-25 07:25:49.979598+09
(2 rows)
""".strip('\n')

Q1_SERVER_AUDIT = r"""
         action         |     first_at     |     last_at      |  cnt
------------------------+------------------+------------------+--------
 SERVER_AUDITD_EXECVE   | 2026-07-11 19:57 | 2026-10-03 07:26 | 613362
 SERVER_AUDIT_HEARTBEAT | 2026-07-07 10:29 | 2026-10-03 07:18 |   1068
 SERVER_COMMAND         | 2026-07-07 10:41 | 2026-10-03 07:26 |    459
 SERVER_LOGIN           | 2026-07-07 10:28 | 2026-10-03 07:26 |    799
 SERVER_LOGOUT          | 2026-07-07 10:28 | 2026-10-02 15:29 |    791
(5 rows)
""".strip('\n')

Q1_ISSUED = r"""
     action     |       target_type        | cnt |           first_at            |            last_at
----------------+--------------------------+-----+-------------------------------+-------------------------------
 CONNECT_WIZARD | commercialization_wizard |  24 | 2026-07-08 23:47:17.386858+09 | 2026-09-30 14:08:24.468279+09
 CREATE         | reseller                 |   8 | 2026-06-15 17:26:05.860306+09 | 2026-09-29 15:18:13.676803+09
 CREATE         | sender_account           |   1 | 2026-07-10 11:29:08.745996+09 | 2026-07-10 11:29:08.745996+09
(3 rows)
""".strip('\n')

# Q1 [1] 에서 종류별로 발췌한 줄(줄 자체는 원문 그대로)
Q1_ROWS_SERVER = r"""
 SERVER_AUDITD_EXECVE                        | server                   | 2026-07-11 | 2026-10-03 |   0 | 347363 | 265968
 SERVER_AUDIT_HEARTBEAT                      | server                   | 2026-07-07 | 2026-10-03 |   0 |    651 |    416
 SERVER_COMMAND                              | server                   | 2026-07-07 | 2026-10-03 |   0 |     55 |     34
 SERVER_LOGIN                                | server                   | 2026-07-07 | 2026-10-03 |   0 |     33 |     39
 SERVER_LOGOUT                               | server                   | 2026-07-07 | 2026-10-02 |   0 |     32 |     39
""".strip('\n')

Q1_ROWS_ADMIN_LOGIN = r"""
 ADMIN_LOGIN_FAILED                          | admin_user               | 2026-07-08 | 2026-09-30 |   7 |     10 |      0
 ADMIN_LOGIN_MFA                             | admin_user               | 2026-07-04 | 2026-10-02 |  62 |     88 |      8
 ADMIN_LOGIN_PASSWORD_OK                     | admin_user               | 2026-07-07 | 2026-10-02 |  62 |     91 |      8
 ADMIN_LOGOUT                                | admin_user               | 2026-07-10 | 2026-10-02 |   9 |      8 |      2
""".strip('\n')

Q1_ROWS_CREDENTIALS = r"""
 AGENT_BOOTSTRAP_FINALIZE                    | agent_account            | 2026-08-05 | 2026-09-23 |   3 |      3 |      0
 AGENT_CONTROL_ENROLL                        | agent_account            | 2026-08-04 | 2026-09-23 |  13 |      4 |      0
 AGENT_ENROLLMENT_NONCE_ISSUE                | agent_account            | 2026-08-04 | 2026-08-15 |  16 |      0 |      0
 AGENT_PROVISIONAL_CREDENTIAL_REVOKE         | agent_account            | 2026-08-04 | 2026-08-14 |  11 |      0 |      0
 AGENT_TRUST_AUTHORITY_REPLACED              | agent_trust_policy       | 2026-08-04 | 2026-08-04 |   1 |      0 |      0
 ISSUE_INSTALL_BUNDLE                        | agent_account            | 2026-09-04 | 2026-10-01 |   0 |     29 |      1
 ROTATE_TOKEN                                | agent_account            | 2026-08-14 | 2026-10-01 |   2 |      1 |      1
 SPEC_CERT_REQUIRED_OFF                      | spec_account             | 2026-09-25 | 2026-09-25 |   0 |      1 |      0
 SPEC_CERT_REQUIRED_ON                       | spec_account             | 2026-09-25 | 2026-09-25 |   0 |      1 |      0
 SPEC_TOKEN_REISSUE                          | spec_account             | 2026-09-24 | 2026-09-25 |   0 |      2 |      0
""".strip('\n')

Q1_ROWS_SENDER_NUMBER = r"""
 SET_SENDER_NUMBER_POLICY                    | reseller                 | 2026-07-05 | 2026-09-02 |   3 |      1 |      0
 UPSERT_CUSTOMER_SENDER_NUMBER               | customer_sender_number   | 2026-07-18 | 2026-09-24 |   1 |      2 |      0
""".strip('\n')

Q1_ROWS_ACCOUNT_CHANGE = r"""
 ACTIVATE                                    | sender_account           | 2026-07-08 | 2026-09-08 |   3 |      1 |      0
 DEACTIVATE                                  | agent_account            | 2026-08-27 | 2026-09-25 |   1 |      5 |      0
 DEACTIVATE                                  | reseller                 | 2026-07-04 | 2026-09-25 |   2 |      3 |      0
 DEACTIVATE                                  | sender_account           | 2026-07-08 | 2026-09-25 |   3 |      4 |      0
 HARD_DELETE                                 | agent_account            | 2026-09-02 | 2026-09-24 |   0 |      2 |      0
 HARD_DELETE                                 | reseller                 | 2026-08-28 | 2026-09-02 |   1 |      1 |      0
 UPDATE                                      | agent_account            | 2026-06-15 | 2026-10-01 |   5 |     11 |      2
""".strip('\n')

# ── Q2 ──
Q2_NO_IP_ACCOUNTS = r"""
       agent_id        |          name           |          created_at           |          updated_at
-----------------------+-------------------------+-------------------------------+-------------------------------
 api-hanjullo-api-test | 한줄로 API ingress      | 2026-07-10 12:06:41.484405+09 | 2026-09-08 20:15:31.45529+09
 api-rabd-api-01       | rabd-api-01 API ingress | 2026-08-07 17:02:12.456445+09 | 2026-08-13 23:26:59.464777+09
(2 rows)
""".strip('\n')

Q2_OCT_DENIED = r"""
  day  |   agent_id   |   remote_ip   |   reason    | events |           first_at            |            last_at
-------+--------------+---------------+-------------+--------+-------------------------------+-------------------------------
 10-01 | bito-test-97 | 58.227.193.66 | AUTH_FAILED |     84 | 2026-10-01 22:42:53.280652+09 | 2026-10-01 23:59:39.165046+09
 10-02 | bito-test-97 | 58.227.193.66 | AUTH_FAILED |   1440 | 2026-10-02 00:00:36.409113+09 | 2026-10-02 23:59:14.28179+09
 10-03 | bito-test-97 | 58.227.193.66 | AUTH_FAILED |    447 | 2026-10-03 00:00:11.784715+09 | 2026-10-03 07:29:24.803058+09
(3 rows)
""".strip('\n')

Q2_SERVER_AUDIT_GAP = r"""
        action        |        last_before_gap        |          resumed_at
----------------------+-------------------------------+-------------------------------
 SERVER_AUDITD_EXECVE | 2026-07-12 16:45:04.026424+09 | 2026-09-26 22:26:47.357483+09
 SERVER_LOGIN         | 2026-07-31 16:33:22.711844+09 | 2026-09-26 22:31:35.787918+09
 SERVER_COMMAND       | 2026-07-31 16:33:30.450624+09 | 2026-09-27 07:46:23.523351+09
(3 rows)
""".strip('\n')

Q2_TOKEN_EVENTS = r"""
          created_at           |       action       |  target_type  | username |  target_id
-------------------------------+--------------------+---------------+----------+--------------
 2026-09-24 21:14:58.901274+09 | DEACTIVATE         | agent_account | admin    | SPECTEST01
 2026-09-24 21:15:01.090121+09 | HARD_DELETE        | agent_account | admin    | SPECTEST01
 2026-09-24 21:23:06.648007+09 | SPEC_TOKEN_REISSUE | spec_account  | admin    | SPECTEST01
 2026-09-25 07:03:39.758903+09 | SPEC_TOKEN_REISSUE | spec_account  | admin    | SPECTEST01
 2026-09-25 12:38:38.547955+09 | DEACTIVATE         | agent_account | admin    | SPECTEST01
 2026-10-01 22:47:50.380514+09 | ROTATE_TOKEN       | agent_account | admin    | bito-test-97
(6 rows)
""".strip('\n')

Q2_ALLOWED_IP_HEADER = r"""
          created_at           | username |  target_id   |                 new_allowed_ips
-------------------------------+----------+--------------+-------------------------------------------------
""".strip('\n')

Q2_ALLOWED_IP_CHANGES = r"""
 2026-10-01 22:39:13.899696+09 | admin    | bito-test-97 | ["115.138.27.202"]
 2026-10-01 22:36:30.565416+09 | admin    | bito-test-97 | ["115.138.27.202"]
 2026-09-24 07:07:44.352401+09 | admin    | bito-test-97 | ["58.227.193.66"]
 2026-09-22 14:52:10.555334+09 | suran    | thewc01      | ["43.202.231.223"]
 2026-09-22 14:46:58.140642+09 | suran    | eternal01    | ["10.0.131.103", "15.164.54.169", "3.39.204.6"]
 2026-09-22 14:46:00.871664+09 | suran    | eternal01    | ["10.0.131.103", "15.164.54.169", "3.39.204.6"]
 2026-09-16 15:16:46.0141+09   | admin    | eternal02    | ["10.0.12.170", "13.209.166.222"]
 2026-09-16 15:16:27.94357+09  | admin    | itensms03    | ["1.201.116.44"]
 2026-09-15 20:26:20.301689+09 | admin    | bito-test-99 | ["58.227.193.66"]
 2026-09-15 17:54:24.407031+09 | admin    | thewc01      | ["43.202.231.223"]
 2026-09-09 15:04:21.547658+09 | suran    | itensms03    | ["1.201.116.44"]
 2026-09-09 15:04:16.441152+09 | suran    | itensms03    | ["1.201.116.44"]
 2026-09-08 15:49:57.441371+09 | suran    | thewc01      | ["43.202.231.223"]
 2026-08-28 14:32:25.56697+09  | suran    | invitotests2 | null
 2026-08-26 15:57:50.368381+09 | suran    | itensms03    | ["119.193.215.98"]
(15 rows)
""".strip('\n')

# 위 표에서 시험 계정 bito-test-97 의 세 줄(미등록 출발지 거부 사례의 앞 절반)
Q2_ALLOWED_IP_TEST97 = r"""
 2026-10-01 22:39:13.899696+09 | admin    | bito-test-97 | ["115.138.27.202"]
 2026-10-01 22:36:30.565416+09 | admin    | bito-test-97 | ["115.138.27.202"]
 2026-09-24 07:07:44.352401+09 | admin    | bito-test-97 | ["58.227.193.66"]
""".strip('\n')

# ── 2026-10-03 11:58 재수집(Harold 실행 · .65 root) ──────────────────────────────
# 11:54 임시 SSH 허용 줄(휴대폰 핫스팟) 삭제 · 사설 원격 접속망 서비스 해제(disable --now) 뒤
COLLECTED_S2 = '2026-10-03 11:58 (한국 시각)'

UFW_STATUS_1158 = r"""
Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    115.138.27.202             # gateway-owner-ssh
[ 2] 80/tcp                     ALLOW IN    Anywhere                   # gateway-http-acme
[ 3] 443/tcp                    ALLOW IN    Anywhere                   # gateway-https
[ 4] 4404/tcp                   ALLOW IN    115.138.27.202             # gateway-owner-rcs-webhook
[ 5] 9443/tcp                   ALLOW IN    58.227.193.62              # hanjul-agent-grpc-tls
[ 6] 9443/tcp                   ALLOW IN    58.227.193.66              # bito-console-agent-grpc-tls
[ 7] 9443/tcp                   ALLOW IN    119.193.215.98             # agent itensms03 아이티앤
[ 8] 9443/tcp                   LIMIT IN    Anywhere                   # agent grpc tls - app allowlist enforces source
[ 9] 22/tcp                     ALLOW IN    180.226.236.94             # company-admin-ssh
[10] 9444/tcp                   LIMIT IN    Anywhere                   # ViTO spec TCP mTLS 2026-09-24
[11] 80/tcp (v6)                ALLOW IN    Anywhere (v6)              # gateway-http-acme
[12] 443/tcp (v6)               ALLOW IN    Anywhere (v6)              # gateway-https
[13] 9443/tcp (v6)              LIMIT IN    Anywhere (v6)              # agent grpc tls - app allowlist enforces source
[14] 9444/tcp (v6)              LIMIT IN    Anywhere (v6)              # ViTO spec TCP mTLS 2026-09-24
""".strip('\n')

UFW_FILES_1158 = r"""
2026-10-03 11:54:42.452769913 +0900  /etc/ufw/user.rules
2026-07-31 15:41:13.785134252 +0900  /etc/ufw/after.rules
""".strip('\n')

SERVICES_1158 = r"""
auditd.service active running
bito-admin-api.service active running
bito-gateway.service active running
fail2ban.service active running
linkguard-control.service active running
tailscaled 부팅 시 자동 시작: disabled
""".strip('\n')

LAST_LOGINS_1158 = r"""
invito   pts/0        115.138.27.202   Sat Oct  3 07:26:12 2026   still logged in
invito   pts/0        180.226.236.94   Fri Oct  2 09:14:54 2026 - Fri Oct  2 15:29:27 2026  (06:14)
invito   pts/0        115.138.27.202   Fri Oct  2 08:14:13 2026 - Fri Oct  2 08:38:48 2026  (00:24)
invito   pts/2        115.138.27.202   Thu Oct  1 20:48:13 2026 - Thu Oct  1 20:48:43 2026  (00:00)
invito   pts/2        115.138.27.202   Thu Oct  1 19:50:34 2026 - Thu Oct  1 19:50:39 2026  (00:00)
invito   pts/2        115.138.27.202   Thu Oct  1 18:58:05 2026 - Thu Oct  1 18:58:10 2026  (00:00)
invito   pts/0        115.138.27.202   Thu Oct  1 17:58:50 2026 - Fri Oct  2 02:04:04 2026  (08:05)
invito   pts/0        115.138.27.202   Thu Oct  1 17:55:57 2026 - Thu Oct  1 17:56:01 2026  (00:00)
invito   pts/0        115.138.27.202   Thu Oct  1 17:11:51 2026 - Thu Oct  1 17:11:56 2026  (00:00)
invito   pts/0        115.138.27.202   Thu Oct  1 15:06:32 2026 - Thu Oct  1 15:06:38 2026  (00:00)
invito   pts/0        115.138.27.202   Thu Oct  1 14:37:02 2026 - Thu Oct  1 14:37:57 2026  (00:00)
invito   pts/2        115.138.27.202   Wed Sep 30 22:55:14 2026 - Wed Sep 30 22:55:23 2026  (00:00)
invito   pts/2        115.138.27.202   Wed Sep 30 22:37:50 2026 - Wed Sep 30 22:42:49 2026  (00:04)
invito   pts/0        115.138.27.202   Wed Sep 30 17:05:03 2026 - Thu Oct  1 08:53:18 2026  (15:48)
invito   pts/0        115.138.27.202   Tue Sep 29 15:24:37 2026 - Wed Sep 30 13:37:28 2026  (22:12)
invito   pts/1        115.138.27.202   Sun Sep 27 07:46:40 2026 - Sun Sep 27 07:46:45 2026  (00:00)
invito   pts/0        115.138.27.202   Sun Sep 27 07:46:23 2026 - Sun Sep 27 21:44:07 2026  (13:57)
invito   pts/3        100.73.46.62     Sat Sep 26 19:08:37 2026 - Sat Sep 26 22:33:44 2026  (03:25)
invito   pts/2        100.116.151.70   Sat Sep 26 18:58:30 2026 - Sat Sep 26 19:14:43 2026  (00:16)
invito   pts/0        115.138.27.202   Sat Sep 26 08:26:39 2026 - Sun Sep 27 02:21:19 2026  (17:54)

wtmp begins Thu Jul 30 16:47:22 2026
""".strip('\n')

# ── 2026-10-03 게이트웨이 서버 로그 1년 보관 설정(Harold 실행 · .65 root) ──────────────
# 조회 12:01:05 · 적용 12:01:50 · 점검 12:02:09 받음(한국 시각)
COLLECTED_LOG = '2026-10-03 12:01 · 12:02 (한국 시각 · 출력을 받은 시각)'

GW_LOG_BEFORE = r"""
/dev/sda4       899G   94G  760G  11% /
Archived and active journals take up 4.1G in the file system.
가장 오래된 저널: 2026-08-22T22:08:30+09:00
-- journald.conf 보관 줄
27:#SystemMaxUse=
35:#MaxRetentionSec=
-- nginx 회전 설정
/var/log/nginx/*.log {
        daily
        missingok
        rotate 14
        compress
        delaycompress
        notifempty
        create 0640 www-data adm
        sharedscripts
        prerotate
                if [ -d /etc/logrotate.d/httpd-prerotate ]; then \
                        run-parts /etc/logrotate.d/httpd-prerotate; \
                fi \
        endscript
        postrotate
                invoke-rc.d nginx rotate >/dev/null 2>&1
        endscript
}
nginx 로그 용량: 10M
""".strip('\n')

GW_LOG_AFTER = r"""
-- 확인
SystemMaxUse=45G
MaxRetentionSec=1year
        daily
        rotate 400
journald: active
logrotate 점검 오류 줄: 1
2026-10-03T12:01:36+09:00 invito bito-gateway[2396885]: {"time":"2026-10-03T12:01:36.771925265+09:00","level":"INFO","msg":"회선 간격 요약","component":"engine","bindAccountID":14,"mode":"enforce","sends":1,"intervalMs":34.5,"minGapMs":4731246.5,"burstGaps":0,"gapsBelowInterval":0,"ackP50Ms":2.4,"ackP99Ms":2.4,"ackMaxMs":2.4,"rateLimited":0,"penalty":1,"learnedDrop":0,"standbyPicks":0,"maxWaitMs":0.1,"maxInFlight":1,"limitSMS":80,"limitMMS":30}
2026-10-03T12:01:37+09:00 invito bito-gateway[2396885]: {"time":"2026-10-03T12:01:37.831093634+09:00","level":"INFO","msg":"PAY 통계 적재 완료","rows":1,"failed":0,"full":false,"since":"2026-10-02"}
""".strip('\n')

GW_LOG_CHECK = r"""
considering log /var/log/nginx/error.log
-- 전체 설정으로 시험
considering log /var/log/nginx/error.log
drwxr-xr-x 2 root adm 4096 Oct  3 00:00 /var/log/nginx
total 10224
-rw-r----- 1 www-data adm 2398806 Oct  3 12:02 access.log
-rw-r----- 1 www-data adm     396 Oct  3 07:36 error.log
-rw-r----- 1 www-data adm 5204899 Oct  3 00:00 access.log.1
-rw-r----- 1 www-data adm     194 Oct  2 07:11 error.log.1
""".strip('\n')

# ── 2026-10-03 4.3 ③ 후속조치: 사내 서버 시험 Agent(bito-test-97) 정지와 정지 뒤 확인(Harold 실행) ──
# 정지 = .66 사내 서버 12:12:48 · 확인 = .65 게이트웨이 12:16:30 (정지 출력은 상태 줄만 발췌 · 인증 요청 줄 제외)
COLLECTED_FOLLOWUP = '2026-10-03 12:12 · 12:16 (한국 시각)'

FOLLOWUP_STOP = r"""
Removed "/etc/systemd/system/multi-user.target.wants/bito-agent-bito-test-97.service".
-- 상태
inactive
disabled
정지 시각: 2026-10-03 12:12:48
""".strip('\n')

FOLLOWUP_AFTER = r"""
          now_kst
----------------------------
 2026-10-03 12:16:30.146908
(1 row)

     minute_kst      | event_type  | outcome |   reason    | event_count |   remote_ip
---------------------+-------------+---------+-------------+-------------+---------------
 2026-10-03 12:06:00 | auth_failed | denied  | AUTH_FAILED |           1 | 58.227.193.66
 2026-10-03 12:07:00 | auth_failed | denied  | AUTH_FAILED |           1 | 58.227.193.66
 2026-10-03 12:08:00 | auth_failed | denied  | AUTH_FAILED |           1 | 58.227.193.66
 2026-10-03 12:09:00 | auth_failed | denied  | AUTH_FAILED |           1 | 58.227.193.66
 2026-10-03 12:10:00 | auth_failed | denied  | AUTH_FAILED |           1 | 58.227.193.66
 2026-10-03 12:11:00 | auth_failed | denied  | AUTH_FAILED |           1 | 58.227.193.66
 2026-10-03 12:12:00 | auth_failed | denied  | AUTH_FAILED |           1 | 58.227.193.66
(7 rows)

12:13 이후 프로세스 로그의 허용 IP 거부 줄 수: 0
""".strip('\n')

# ── 2026-10-03 12:22 시험 API 계정(api-hanjullo-api-test) 정지 · 허용 IP 지정 현황(Harold 실행 · .65 운영 SQL) ──
# 정지 사유 = 시험용 · 요청 0건 · 허용 IP 미지정 · 감사 기록 710895(처리자 admin · channel sql)
COLLECTED_E05 = '2026-10-03 12:22 (한국 시각)'

E05_DEACTIVATE = r"""
  id   |   action   |       target_id       |            kst
--------+------------+-----------------------+----------------------------
 710895 | DEACTIVATE | api-hanjullo-api-test | 2026-10-03 12:22:14.783612
(1 row)

INSERT 0 1
""".strip('\n')

E05_COUNTS = r"""
 사용 중 | 사용 중 · 허용 IP 지정됨 | 사용 중 · 허용 IP 없음
---------+--------------------------+------------------------
      14 |                       14 |                      0
(1 row)
""".strip('\n')
