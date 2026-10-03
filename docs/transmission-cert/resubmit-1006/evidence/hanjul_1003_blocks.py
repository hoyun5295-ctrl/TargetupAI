# -*- coding: utf-8 -*-
"""
한줄로 운영 DB 조회 출력 원문 (2026-10-03 09:47 · Harold 실행 · 한줄로 서버 .62)

조회문 = hanjul-evidence.sql (읽기 전용). 아래 값은 받은 출력을 글자 그대로 옮긴 것이다 — 고치지 않는다.
가림은 이미지를 만들 때(make_hanjul_evidence_images.py) 한다.
⛔ 모바일 본인인증(한국모바일인증) 연동 뒤 다시 조회할 구간([3.4-1] 번호 등록 현황 · [3.4-3] 인증수단 등록 · 변경 이력)은 싣지 않는다.
"""

COLLECTED = '2026-10-03 09:47 (한국)'

RETENTION = r"""
+-------------------------------+-------------------------------+-----------+
|       가장 오래된 기록        |        가장 최근 기록         | 전체 건수 |
+-------------------------------+-------------------------------+-----------+
| 2026-02-11 16:35:46.449685+09 | 2026-10-03 09:44:11.924745+09 |     42994 |
+-------------------------------+-------------------------------+-----------+
(1 row)
""".strip('\n')

RETENTION_MONTHLY = r"""
+---------+-------+
|   월    | 건수  |
+---------+-------+
| 2026-02 |   900 |
| 2026-03 |  1030 |
| 2026-04 |  1163 |
| 2026-05 |  4262 |
| 2026-06 |  4469 |
| 2026-07 |  4874 |
| 2026-08 |  6069 |
| 2026-09 | 17303 |
| 2026-10 |  2924 |
+---------+-------+
(9 rows)
""".strip('\n')

KINDS = r"""
+---------------------------------+------------+------+------+------+------+
|            기록 종류            | 첫 기록일  | 7월  | 8월  | 9월  | 10월 |
+---------------------------------+------------+------+------+------+------+
| access_origin_exception_granted | 2026-08-30 |    0 |    1 |    0 |    6 |
| admin_account_created           | 2026-08-27 |    0 |    2 |    0 |    0 |
| admin_account_disabled          | 2026-08-27 |    0 |    2 |    0 |    0 |
| admin_password_changed          | 2026-08-28 |    0 |    1 |    0 |    0 |
| admin_role_changed              | 2026-08-27 |    0 |    2 |    0 |    0 |
| agency_link_approved            | 2026-08-31 |    0 |    3 |   21 |    2 |
| best_layout.example_promote     | 2026-09-05 |    0 |    0 |    1 |    0 |
| campaign_correction             | 2026-06-11 |    0 |    0 |    0 |    0 |
| charge_link_approved            | 2026-09-11 |    0 |    0 |    9 |    2 |
| company_line_group_change       | 2026-06-12 |   11 |   12 |  164 |    0 |
| company_terminated              | 2026-09-07 |    0 |    0 |    1 |    0 |
| company_unit_price_update       | 2026-07-27 |   70 |    4 |    4 |    0 |
| customer_bulk_delete            | 2026-02-23 |    0 |    0 |    0 |    0 |
| customer_delete                 | 2026-03-24 |    0 |    0 |    0 |    0 |
| customer_delete_all             | 2026-02-12 |   11 |    1 |    0 |    0 |
| customer_delete_by_user         | 2026-03-12 |    0 |    0 |    0 |    0 |
| deposit_hold_resolved           | 2026-08-29 |    0 |    1 |    1 |    0 |
| diagnosis_status_change         | 2026-08-16 |    0 |    2 |    0 |    0 |
| foreign_access_blocked          | 2026-10-01 |    0 |    0 |    0 |   16 |
| foreign_access_detected         | 2026-08-28 |    0 |  222 |   64 |    6 |
| geo_cidrs_replaced              | 2026-08-27 |    0 |    4 |    0 |    0 |
| kakao_profile_disabled          | 2026-09-12 |    0 |    0 |    1 |    0 |
| line_group_create               | 2026-07-17 |    2 |    0 |    1 |    0 |
| line_group_update               | 2026-07-17 |    1 |    0 |    4 |    0 |
| login_blocked                   | 2026-02-12 |    0 |    0 |    0 |    0 |
| login_fail                      | 2026-02-11 |  304 |  315 |  213 |   21 |
| login_session_conflict          | 2026-08-18 |    0 |  255 |  643 |   71 |
| login_success                   | 2026-02-11 | 4455 | 3761 | 4198 |  472 |
| login_takeover                  | 2026-08-18 |    0 |  130 |  396 |   44 |
| logout                          | 2026-08-18 |    0 | 1048 | 2711 |  308 |
| machine_origin_detected         | 2026-08-20 |    0 |  270 |  667 |   55 |
| make_read_url_use               | 2026-09-28 |    0 |    0 |   10 |    0 |
| mfa_challenge                   | 2026-09-12 |    0 |    0 |   56 |   10 |
| mfa_fail                        | 2026-09-19 |    0 |    0 |    1 |    0 |
| mfa_phone_changed               | 2026-08-28 |    0 |    1 |   30 |    0 |
| mfa_success                     | 2026-09-12 |    0 |    0 |   52 |   10 |
| page_view                       | 2026-09-12 |    0 |    0 | 7758 | 1714 |
| privacy_edit                    | 2026-09-12 |    0 |    0 |    1 |    0 |
| privacy_export                  | 2026-08-20 |    0 |   23 |   82 |    5 |
| privacy_view                    | 2026-09-12 |    0 |    0 |   55 |  172 |
| sales_outreach.confirm          | 2026-09-05 |    0 |    0 |   29 |    0 |
| sales_outreach.contact          | 2026-09-28 |    0 |    0 |    4 |    0 |
| sales_outreach.delete           | 2026-09-06 |    0 |    0 |   22 |    0 |
| sales_outreach.delete_bulk      | 2026-09-06 |    0 |    0 |    1 |    0 |
| sales_outreach.enqueue          | 2026-09-05 |    0 |    0 |   29 |    0 |
| sales_outreach.import_dm        | 2026-10-01 |    0 |    0 |    0 |    1 |
| sales_outreach.promote_recipe   | 2026-09-06 |    0 |    0 |    1 |    0 |
| sales_outreach.rebuild_email    | 2026-10-01 |    0 |    0 |    0 |    1 |
| sales_outreach.recrawl          | 2026-09-05 |    0 |    0 |    2 |    0 |
| sales_outreach.regenerate       | 2026-09-09 |    0 |    0 |    2 |    0 |
| sales_outreach.review           | 2026-09-28 |    0 |    0 |    2 |    0 |
| sales_outreach.send             | 2026-09-06 |    0 |    0 |    1 |    0 |
| sales_outreach.store_grab       | 2026-09-24 |    0 |    0 |    1 |    0 |
| sales_outreach.test_send        | 2026-09-05 |    0 |    0 |   15 |    1 |
| sender_auth_challenge           | 2026-09-12 |    0 |    0 |   15 |    3 |
| sender_auth_success             | 2026-09-12 |    0 |    0 |   15 |    3 |
| sender_line_policy_update       | 2026-08-20 |    0 |    2 |    0 |    0 |
| spam_block_rule_create          | 2026-08-27 |    0 |    1 |    0 |    0 |
| totp_enrolled                   | 2026-05-11 |    0 |    2 |    0 |    0 |
| totp_enroll_start               | 2026-05-11 |    0 |    3 |    0 |    0 |
| user_account_created            | 2026-10-02 |    0 |    0 |    0 |    1 |
| user_update                     | 2026-06-29 |   20 |    1 |   20 |    0 |
+---------------------------------+------------+------+------+------+------+
(62 rows)
""".strip('\n')

GEO_CIDRS = r"""
+------+-------+---------+-------------------------------+
| 국가 | 출처  | 대역 수 |          마지막 갱신          |
+------+-------+---------+-------------------------------+
| KR   | apnic |    2597 | 2026-08-30 21:33:46.810267+09 |
+------+-------+---------+-------------------------------+
(1 row)
""".strip('\n')

GEO_DAILY = r"""
+------------+--------------+------+
|    날짜    | 감지(기록만) | 차단 |
+------------+--------------+------+
| 2026-09-01 |            5 |    0 |
| 2026-09-02 |            3 |    0 |
| 2026-09-03 |            5 |    0 |
| 2026-09-04 |            5 |    0 |
| 2026-09-06 |            1 |    0 |
| 2026-09-07 |            1 |    0 |
| 2026-09-08 |            2 |    0 |
| 2026-09-09 |            1 |    0 |
| 2026-09-10 |            4 |    0 |
| 2026-09-11 |            4 |    0 |
| 2026-09-13 |            2 |    0 |
| 2026-09-14 |            9 |    0 |
| 2026-09-15 |            1 |    0 |
| 2026-09-17 |            3 |    0 |
| 2026-09-18 |            1 |    0 |
| 2026-09-21 |            5 |    0 |
| 2026-09-22 |            1 |    0 |
| 2026-09-23 |            2 |    0 |
| 2026-09-24 |            1 |    0 |
| 2026-09-25 |            1 |    0 |
| 2026-09-26 |            1 |    0 |
| 2026-09-28 |            1 |    0 |
| 2026-09-29 |            3 |    0 |
| 2026-09-30 |            2 |    0 |
| 2026-10-01 |            0 |   16 |
| 2026-10-02 |            5 |    0 |
| 2026-10-03 |            1 |    0 |
+------------+--------------+------+
(27 rows)
""".strip('\n')

GEO_BLOCKED_RAW = r"""
+-------------------------------+------------------------+----------------+----------------+-----------------------------------------------------------------------+
|             일시              |          종류          |      계정      |   출발지 IP    |                                 상세                                  |
+-------------------------------+------------------------+----------------+----------------+-----------------------------------------------------------------------+
| 2026-10-01 20:07:01.025643+09 | foreign_access_blocked | lululemon44117 | 167.103.97.108 | {"exempted": false, "appSource": "hanjul", "exceptionUnknown": false} |
| 2026-10-01 20:05:10.269449+09 | foreign_access_blocked | lululemon44117 | 167.103.97.86  | {"exempted": false, "appSource": "hanjul", "exceptionUnknown": false} |
| 2026-10-01 20:04:17.229953+09 | foreign_access_blocked | lululemon44117 | 167.103.97.86  | {"exempted": false, "appSource": "hanjul", "exceptionUnknown": false} |
| 2026-10-01 20:04:16.373875+09 | foreign_access_blocked | lululemon44117 | 167.103.97.86  | {"exempted": false, "appSource": "hanjul", "exceptionUnknown": false} |
| 2026-10-01 20:04:06.76346+09  | foreign_access_blocked | lululemon44117 | 167.103.97.86  | {"exempted": false, "appSource": "hanjul", "exceptionUnknown": false} |
| 2026-10-01 20:03:53.512568+09 | foreign_access_blocked | lululemon44117 | 167.103.97.86  | {"exempted": false, "appSource": "hanjul", "exceptionUnknown": false} |
| 2026-10-01 20:03:52.815754+09 | foreign_access_blocked | lululemon44117 | 167.103.97.86  | {"exempted": false, "appSource": "hanjul", "exceptionUnknown": false} |
| 2026-10-01 20:03:51.225334+09 | foreign_access_blocked | lululemon44117 | 167.103.97.86  | {"exempted": false, "appSource": "hanjul", "exceptionUnknown": false} |
| 2026-10-01 20:02:11.489377+09 | foreign_access_blocked | lululemon44117 | 167.103.97.86  | {"exempted": false, "appSource": "hanjul", "exceptionUnknown": false} |
| 2026-10-01 20:02:07.824581+09 | foreign_access_blocked | lululemon44117 | 167.103.97.86  | {"exempted": false, "appSource": "hanjul", "exceptionUnknown": false} |
| 2026-10-01 20:01:34.024076+09 | foreign_access_blocked | lululemon44117 | 167.103.97.86  | {"exempted": false, "appSource": "hanjul", "exceptionUnknown": false} |
| 2026-10-01 20:01:30.448692+09 | foreign_access_blocked | lululemon44117 | 167.103.97.86  | {"exempted": false, "appSource": "hanjul", "exceptionUnknown": false} |
| 2026-10-01 20:01:28.909883+09 | foreign_access_blocked | lululemon44117 | 167.103.97.86  | {"exempted": false, "appSource": "hanjul", "exceptionUnknown": false} |
| 2026-10-01 10:20:31.065195+09 | foreign_access_blocked | shadmin        | 153.72.39.239  | {"exempted": false, "appSource": "hanjul", "exceptionUnknown": false} |
| 2026-10-01 10:20:03.373023+09 | foreign_access_blocked | shadmin        | 153.72.39.239  | {"exempted": false, "appSource": "hanjul", "exceptionUnknown": false} |
| 2026-10-01 10:19:56.185674+09 | foreign_access_blocked | shadmin        | 153.72.39.239  | {"exempted": false, "appSource": "hanjul", "exceptionUnknown": false} |
+-------------------------------+------------------------+----------------+----------------+-----------------------------------------------------------------------+
(16 rows)
""".strip('\n')

EXCEPTIONS = r"""
+-------------------------------+-------------+--------------+----------------+-------------------+------------------------------------------------------+--------+-------------------------------+-----------+------+
|           등록 일시           |    범위     |    고객사    |      계정      |     허용 대역     |                         사유                         | 승인자 |           승인 일시           | 허용 만료 | 유효 |
+-------------------------------+-------------+--------------+----------------+-------------------+------------------------------------------------------+--------+-------------------------------+-----------+------+
| 2026-08-30 21:36:45.386912+09 | company_api | 이새에프앤씨 |                | 125.141.198.22/32 | 이새에프엔씨 싱크에이전트                            | ceo    | 2026-08-30 21:36:45.386912+09 |           | t    |
| 2026-10-02 09:35:23.713323+09 | user        |              | lululemon44117 | 167.103.96.0/23   | 고객사 사내 보안 프록시(Zscaler 서울 거점) 의무 경유 | ceo    | 2026-10-02 09:35:23.713323+09 |           | t    |
| 2026-10-02 09:35:23.713323+09 | user        |              | gwss           | 165.225.228.0/23  | 고객사 사내 보안 프록시(Zscaler 서울 거점) 의무 경유 | ceo    | 2026-10-02 09:35:23.713323+09 |           | t    |
| 2026-10-02 09:35:23.713323+09 | user        |              | laprairie01    | 165.225.228.0/23  | 고객사 사내 보안 프록시(Zscaler 서울 거점) 의무 경유 | ceo    | 2026-10-02 09:35:23.713323+09 |           | t    |
| 2026-10-02 09:35:23.713323+09 | user        |              | laprairie01    | 167.103.96.0/23   | 고객사 사내 보안 프록시(Zscaler 서울 거점) 의무 경유 | ceo    | 2026-10-02 09:35:23.713323+09 |           | t    |
| 2026-10-02 09:35:23.713323+09 | user        |              | lpcom          | 167.103.96.0/23   | 고객사 사내 보안 프록시(Zscaler 서울 거점) 의무 경유 | ceo    | 2026-10-02 09:35:23.713323+09 |           | t    |
| 2026-10-02 09:35:23.713323+09 | user        |              | toun28         | 3.36.143.29/32    | 고객사 고정 접속 서버(AWS 서울 리전)                 | ceo    | 2026-10-02 09:35:23.713323+09 |           | t    |
+-------------------------------+-------------+--------------+----------------+-------------------+------------------------------------------------------+--------+-------------------------------+-----------+------+
(7 rows)
""".strip('\n')

EXCEPTION_AUDIT = r"""
+-------------------------------+---------------------------------+--------+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
|             일시              |              종류               | 처리자 |                                                                                                           상세                                                                                                            |
+-------------------------------+---------------------------------+--------+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| 2026-08-27 22:37:06.223002+09 | geo_cidrs_replaced              | ceo    | {"after": 1, "before": 0, "source": "apnic"}                                                                                                                                                                              |
| 2026-08-27 22:37:12.437418+09 | geo_cidrs_replaced              | ceo    | {"after": 1, "before": 1, "source": "apnic"}                                                                                                                                                                              |
| 2026-08-27 23:13:16.721824+09 | geo_cidrs_replaced              | ceo    | {"after": 60, "before": 1, "source": "apnic"}                                                                                                                                                                             |
| 2026-08-30 21:33:46.846289+09 | geo_cidrs_replaced              | ceo    | {"after": 2597, "before": 60, "source": "apnic"}                                                                                                                                                                          |
| 2026-08-30 21:36:45.390247+09 | access_origin_exception_granted | ceo    | {"cidr": "125.141.198.22/32", "scope": "company_api", "reason": "이새에프엔씨 싱크에이전트", "userId": null, "companyId": "682956b7-37a3-46b5-9868-b63011bda47b", "expiresAt": null}                                      |
| 2026-10-02 09:35:23.713323+09 | access_origin_exception_granted | ceo    | {"cidr": "167.103.96.0/23", "scope": "user", "reason": "고객사 사내 보안 프록시(Zscaler 서울 거점) 의무 경유", "userId": "8a9eb03d-7942-4935-972a-a50bd1fe3b1c", "channel": "sql", "companyId": null, "expiresAt": null}  |
| 2026-10-02 09:35:23.713323+09 | access_origin_exception_granted | ceo    | {"cidr": "165.225.228.0/23", "scope": "user", "reason": "고객사 사내 보안 프록시(Zscaler 서울 거점) 의무 경유", "userId": "9a1b4822-8f1d-45d8-b838-1d3bf9a38c20", "channel": "sql", "companyId": null, "expiresAt": null} |
| 2026-10-02 09:35:23.713323+09 | access_origin_exception_granted | ceo    | {"cidr": "165.225.228.0/23", "scope": "user", "reason": "고객사 사내 보안 프록시(Zscaler 서울 거점) 의무 경유", "userId": "1a927b8e-eb81-4c07-983d-c2a534ecb44d", "channel": "sql", "companyId": null, "expiresAt": null} |
| 2026-10-02 09:35:23.713323+09 | access_origin_exception_granted | ceo    | {"cidr": "167.103.96.0/23", "scope": "user", "reason": "고객사 사내 보안 프록시(Zscaler 서울 거점) 의무 경유", "userId": "1a927b8e-eb81-4c07-983d-c2a534ecb44d", "channel": "sql", "companyId": null, "expiresAt": null}  |
| 2026-10-02 09:35:23.713323+09 | access_origin_exception_granted | ceo    | {"cidr": "167.103.96.0/23", "scope": "user", "reason": "고객사 사내 보안 프록시(Zscaler 서울 거점) 의무 경유", "userId": "1c373b69-4ca0-46f6-83ab-d4918613c25c", "channel": "sql", "companyId": null, "expiresAt": null}  |
| 2026-10-02 09:35:23.713323+09 | access_origin_exception_granted | ceo    | {"cidr": "3.36.143.29/32", "scope": "user", "reason": "고객사 고정 접속 서버(AWS 서울 리전)", "userId": "6c04e7cf-3142-41d7-918b-f4ea2e0e1eee", "channel": "sql", "companyId": null, "expiresAt": null}                   |
+-------------------------------+---------------------------------+--------+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
(11 rows)
""".strip('\n')

MACHINE = r"""
+---------+-------------------------+---------------+-----------+------+-----------+-----------+
|   월    |          종류           |     경로      | 등록 여부 | 건수 | 고객사 수 | 출발지 수 |
+---------+-------------------------+---------------+-----------+------+-----------+-----------+
| 2026-08 | machine_origin_detected | company_agent | false     |  270 |         1 |         1 |
| 2026-09 | machine_origin_detected | company_agent | false     |  667 |         2 |         3 |
| 2026-10 | machine_origin_detected | company_agent | false     |   55 |         1 |         1 |
+---------+-------------------------+---------------+-----------+------+-----------+-----------+
(3 rows)
""".strip('\n')

MFA_MONTHLY = r"""
+---------+-----------+-----------+-----------+------+----------------+
|   월    | 인증 요청 | 인증 성공 | 인증 실패 | 잠김 | 인증한 계정 수 |
+---------+-----------+-----------+-----------+------+----------------+
| 2026-09 |        56 |        52 |         1 |    0 |              3 |
| 2026-10 |        10 |        10 |         0 |    0 |              2 |
+---------+-----------+-----------+-----------+------+----------------+
(2 rows)
""".strip('\n')

MFA_RAW = r"""
+-------------------------------+---------------+-------+----------------+
|             일시              |     종류      | 계정  |   출발지 IP    |
+-------------------------------+---------------+-------+----------------+
| 2026-10-03 01:07:32.294148+09 | mfa_success   | hoyun | 115.138.27.202 |
| 2026-10-03 01:06:51.098685+09 | mfa_challenge | hoyun | 115.138.27.202 |
| 2026-10-02 23:05:33.105744+09 | mfa_success   | hoyun | 115.138.27.202 |
| 2026-10-02 23:05:22.948252+09 | mfa_challenge | hoyun | 115.138.27.202 |
| 2026-10-02 23:02:37.171503+09 | mfa_success   | hoyun | 115.138.27.202 |
| 2026-10-02 23:02:28.021732+09 | mfa_challenge | hoyun | 115.138.27.202 |
| 2026-10-02 16:40:19.230257+09 | mfa_success   | hoyun | 106.101.83.37  |
| 2026-10-02 16:40:08.056727+09 | mfa_challenge | hoyun | 106.101.83.37  |
| 2026-10-02 16:24:32.450724+09 | mfa_success   | hoyun | 115.138.27.202 |
| 2026-10-02 16:24:23.049106+09 | mfa_challenge | hoyun | 115.138.27.202 |
| 2026-10-02 12:12:24.878161+09 | mfa_success   | suran | 180.226.236.94 |
| 2026-10-02 12:12:12.162827+09 | mfa_challenge | suran | 180.226.236.94 |
| 2026-10-02 11:05:14.708286+09 | mfa_success   | hoyun | 180.226.236.94 |
| 2026-10-02 11:05:01.507876+09 | mfa_challenge | hoyun | 180.226.236.94 |
| 2026-10-01 17:29:55.423747+09 | mfa_success   | hoyun | 115.138.27.202 |
| 2026-10-01 17:29:45.579358+09 | mfa_challenge | hoyun | 115.138.27.202 |
| 2026-10-01 13:14:16.637523+09 | mfa_success   | hoyun | 106.101.10.201 |
| 2026-10-01 13:14:00.54438+09  | mfa_challenge | hoyun | 106.101.10.201 |
| 2026-10-01 09:48:49.216827+09 | mfa_success   | hoyun | 180.226.236.94 |
| 2026-10-01 09:48:38.726943+09 | mfa_challenge | hoyun | 180.226.236.94 |
+-------------------------------+---------------+-------+----------------+
(20 rows)
""".strip('\n')

SENDER_AUTH_MONTHLY = r"""
+---------+-----------+-----------+----------------+
|   월    | 인증 요청 | 인증 성공 | 인증한 계정 수 |
+---------+-----------+-----------+----------------+
| 2026-09 |        15 |        15 |              3 |
| 2026-10 |         3 |         3 |              2 |
+---------+-----------+-----------+----------------+
(2 rows)
""".strip('\n')

SENDER_AUTH_RAW = r"""
+-------------------------------+-----------------------+---------+----------------+
|             일시              |         종류          |  계정   |   출발지 IP    |
+-------------------------------+-----------------------+---------+----------------+
| 2026-10-02 16:40:59.968478+09 | sender_auth_success   | hoyun   | 106.101.83.37  |
| 2026-10-02 16:40:50.5357+09   | sender_auth_challenge | hoyun   | 106.101.83.37  |
| 2026-10-02 13:50:52.345051+09 | sender_auth_success   | suran   | 180.226.236.94 |
| 2026-10-02 13:50:38.759674+09 | sender_auth_challenge | suran   | 180.226.236.94 |
| 2026-10-02 11:44:31.408117+09 | sender_auth_success   | hoyun   | 180.226.236.94 |
| 2026-10-02 11:44:22.018622+09 | sender_auth_challenge | hoyun   | 180.226.236.94 |
| 2026-09-29 23:38:24.34589+09  | sender_auth_success   | hoyun   | 115.138.27.202 |
| 2026-09-29 23:38:09.485728+09 | sender_auth_challenge | hoyun   | 115.138.27.202 |
| 2026-09-28 11:01:07.138362+09 | sender_auth_success   | hoyun   | 180.226.236.94 |
| 2026-09-28 11:00:49.370542+09 | sender_auth_challenge | hoyun   | 180.226.236.94 |
| 2026-09-26 22:43:39.151723+09 | sender_auth_success   | hoyun   | 115.138.27.202 |
| 2026-09-26 22:43:26.983713+09 | sender_auth_challenge | hoyun   | 115.138.27.202 |
| 2026-09-22 15:50:52.358057+09 | sender_auth_success   | hoyun   | 115.138.27.202 |
| 2026-09-22 15:50:40.027761+09 | sender_auth_challenge | hoyun   | 115.138.27.202 |
| 2026-09-22 09:54:12.891568+09 | sender_auth_success   | hoyun   | 180.226.236.94 |
| 2026-09-22 09:54:01.280116+09 | sender_auth_challenge | hoyun   | 180.226.236.94 |
| 2026-09-21 14:33:16.78223+09  | sender_auth_success   | hoyun   | 115.138.27.202 |
| 2026-09-21 14:33:03.226835+09 | sender_auth_challenge | hoyun   | 115.138.27.202 |
| 2026-09-20 07:35:00.109871+09 | sender_auth_success   | psy5868 | 115.138.27.202 |
| 2026-09-20 07:34:45.27906+09  | sender_auth_challenge | psy5868 | 115.138.27.202 |
+-------------------------------+-----------------------+---------+----------------+
(20 rows)
""".strip('\n')

ISSUED = r"""
+-------------------------------+----------------------+-------------+-----------------------------------------------------------------------------------------------------------------------------------------------------------------+
|             일시              |         종류         |   발급자    |                                                                              상세                                                                               |
+-------------------------------+----------------------+-------------+-----------------------------------------------------------------------------------------------------------------------------------------------------------------+
| 2026-10-02 16:00:06.087909+09 | user_account_created | eunji_admin | {"channel": "super_admin", "loginId": "shiseido7", "userType": "user", "companyId": "3e7ec67b-f093-4b41-91c0-1eb284d8bfef", "companyName": "(주) 한국시세이도"} |
+-------------------------------+----------------------+-------------+-----------------------------------------------------------------------------------------------------------------------------------------------------------------+
(1 row)
""".strip('\n')

ACCOUNT_MONTHLY = r"""
+---------+-------------+
|   월    | 생성된 계정 |
+---------+-------------+
| 2026-02 |          10 |
| 2026-03 |           4 |
| 2026-04 |         154 |
| 2026-05 |           4 |
| 2026-06 |           2 |
| 2026-07 |          53 |
| 2026-08 |           3 |
| 2026-09 |           6 |
| 2026-10 |           1 |
+---------+-------------+
(9 rows)
""".strip('\n')

REVIEW_MONTHLY = r"""
+--------------+-------------+-------------+-------------+----------------+-----------+-----------+----------------+-----------+-----------+-------------------+---------------+----------------+----------------+
| 점검 대상 월 | 로그인 성공 | 로그인 실패 | 로그인 차단 | 동시 접속 감지 | 인증 잠김 | 국외 차단 | 기계 접속 차단 | 계정 제한 | 회사 해지 | 개인정보 내보내기 | 고객 전체삭제 | 직원 등급 변경 | 직원 계정 생성 |
+--------------+-------------+-------------+-------------+----------------+-----------+-----------+----------------+-----------+-----------+-------------------+---------------+----------------+----------------+
| 2026-09      |        4198 |         213 |           0 |            643 |         0 |         0 |              0 |         0 |         1 |                82 |             0 |              0 |              0 |
| 2026-10      |         472 |          21 |           0 |             71 |         0 |        16 |              0 |         0 |         0 |                 5 |             0 |              0 |              0 |
+--------------+-------------+-------------+-------------+----------------+-----------+-----------+----------------+-----------+-----------+-------------------+---------------+----------------+----------------+
(2 rows)
""".strip('\n')

REVIEW_FAIL_TOP = r"""
+---------+----------------+---------+-----------+----+
|   월    |      계정      | 실패 수 | 출발지 수 | rn |
+---------+----------------+---------+-----------+----+
| 2026-09 | dp26           |      16 |         3 |  1 |
| 2026-09 | soongsil       |      14 |         1 |  2 |
| 2026-09 | ACEMKT         |       9 |         2 |  3 |
| 2026-09 | louisquatorze1 |       8 |         1 |  4 |
| 2026-09 | jessinewyork01 |       7 |         2 |  5 |
| 2026-09 | dp76           |       7 |         1 |  6 |
| 2026-09 | woorim         |       6 |         2 |  7 |
| 2026-09 | sgbaek         |       6 |         1 |  8 |
| 2026-09 | bhappy4        |       6 |         1 |  9 |
| 2026-09 | keli           |       5 |         2 | 10 |
| 2026-10 | espayment01    |       6 |         1 |  1 |
+---------+----------------+---------+-----------+----+
(11 rows)
""".strip('\n')

REVIEW_BLOCK_RAW = r"""
+------------------------------+--------------------+-------+----------------+
|             일시             |        종류        | 계정  |   출발지 IP    |
+------------------------------+--------------------+-------+----------------+
| 2026-09-07 10:53:53.63993+09 | company_terminated | suran | 180.226.236.94 |
+------------------------------+--------------------+-------+----------------+
(1 row)
""".strip('\n')

# 2026-10-03 · Harold 실행 · 차단 시행 뒤 「감지」 6건의 상세(예외 통과 여부)
EXEMPT_PASS_COLLECTED = '2026-10-03 10:40 (한국)'
EXEMPT_PASS = r"""
          created_at           |    login_id    |       ip        | exempted | lookup_failed
-------------------------------+----------------+-----------------+----------+---------------
 2026-10-02 16:39:13.011443+09 | gwss           | 165.225.229.111 | true     | false
 2026-10-02 21:49:37.573796+09 | lululemon44117 | 167.103.97.86   | true     | false
 2026-10-02 23:19:08.53219+09  | toun28         | 3.36.143.29     | true     | false
 2026-10-02 23:21:43.081884+09 | toun28         | 3.36.143.29     | true     | false
 2026-10-02 23:21:46.819614+09 | toun28         | 3.36.143.29     | true     | false
 2026-10-03 01:07:48.55608+09  | toun28         | 3.36.143.29     | true     | false
(6 rows)
""".strip('\n')

# ── 수집 B: 한줄로 서버 확인 스크립트(hanjul-server-check.sh) 출력 원문 ──────────────────────
# 일반 계정(administrator) 실행 = 2026-10-03 10:05 받음 · root 재실행(방화벽 구간) = 10:06 받음 · 한줄로 서버 .62
SERVER_COLLECTED = '2026-10-03 10:05 · 10:06 (한국 · 출력을 받은 시각)'

SERVER_FW = r"""
Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), deny (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere
3000                       DENY IN     Anywhere
9001:9011/tcp              DENY IN     Anywhere
9090/tcp                   ALLOW IN    58.227.193.62
22/tcp (v6)                ALLOW IN    Anywhere (v6)
80/tcp (v6)                ALLOW IN    Anywhere (v6)
443/tcp (v6)               ALLOW IN    Anywhere (v6)
3000 (v6)                  DENY IN     Anywhere (v6)
9001:9011/tcp (v6)         DENY IN     Anywhere (v6)

-- 방화벽 서비스
active
active
-- 정책 파일 마지막 수정
2026-08-20 16:00:26.576150622 +0900  /etc/ufw/user.rules
2026-08-20 16:00:20.933386033 +0900  /etc/ufw/after.rules
""".strip('\n')

SERVER_FW_CMDS = r"""
-- 저널에 남은 방화벽 명령(최근 400일)
2026-07-26T06:18:10+09:00 invito sudo[1504877]: administrator : TTY=pts/0 ; PWD=/home/administrator ; USER=root ; COMMAND=/usr/sbin/ufw status numbered
2026-08-15T14:07:57+09:00 invito sudo[2418068]: administrator : TTY=pts/1 ; PWD=/home/administrator ; USER=root ; COMMAND=/usr/sbin/ufw status
2026-08-20T16:00:25+09:00 invito sudo[2612784]: administrator : TTY=pts/0 ; PWD=/home/administrator/targetup-app ; USER=root ; COMMAND=/usr/sbin/ufw reload
2026-08-27T23:58:32+09:00 invito sudo[2941286]: administrator : TTY=pts/0 ; PWD=/home/administrator/targetup-app/packages/frontend ; USER=root ; COMMAND=/usr/sbin/ufw status verbose
""".strip('\n')

SERVER_ADMIN_LOGIN = r"""
administ pts/0        115.138.27.202   Fri Oct  2 22:57:40 2026   still logged in
administ pts/0        115.138.27.202   Fri Oct  2 16:12:47 2026 - Fri Oct  2 16:32:20 2026  (00:19)
administ pts/0        115.138.27.202   Fri Oct  2 16:01:54 2026 - Fri Oct  2 16:12:22 2026  (00:10)
administ pts/0        180.226.236.94   Fri Oct  2 09:19:50 2026 - Fri Oct  2 15:29:27 2026  (06:09)
administ pts/1        115.138.27.202   Thu Oct  1 15:20:22 2026 - Fri Oct  2 02:02:29 2026  (10:42)
administ pts/0        115.138.27.202   Thu Oct  1 14:26:37 2026 - Thu Oct  1 17:23:07 2026  (02:56)
administ pts/0        115.138.27.202   Wed Sep 30 16:12:23 2026 - Thu Oct  1 08:53:18 2026  (16:40)
administ pts/1        115.138.27.202   Wed Sep 30 06:52:36 2026 - Wed Sep 30 06:57:04 2026  (00:04)
administ pts/0        115.138.27.202   Tue Sep 29 10:13:18 2026 - Wed Sep 30 13:37:28 2026 (1+03:24)
administ pts/0        115.138.27.202   Mon Sep 28 12:43:52 2026 - Mon Sep 28 17:21:40 2026  (04:37)
administ pts/0        180.226.236.94   Mon Sep 28 10:53:20 2026 - Mon Sep 28 11:59:44 2026  (01:06)
administ pts/0        115.138.27.202   Sun Sep 27 07:24:12 2026 - Sun Sep 27 23:31:28 2026  (16:07)
administ pts/0        115.138.27.202   Sat Sep 26 08:25:51 2026 - Sun Sep 27 02:20:17 2026  (17:54)
administ pts/0        115.138.27.202   Fri Sep 25 06:31:31 2026 - Sat Sep 26 03:50:15 2026  (21:18)
administ pts/0        115.138.27.202   Thu Sep 24 21:23:39 2026 - Fri Sep 25 02:47:17 2026  (05:23)
administ pts/1        106.101.135.212  Thu Sep 24 09:00:36 2026 - Thu Sep 24 10:07:30 2026  (01:06)
administ pts/0        115.138.27.202   Thu Sep 24 07:19:29 2026 - Thu Sep 24 10:37:21 2026  (03:17)
administ pts/0        115.138.27.202   Wed Sep 23 11:15:34 2026 - Thu Sep 24 02:36:45 2026  (15:21)
administ pts/0        115.138.27.202   Wed Sep 23 10:24:48 2026 - Wed Sep 23 11:12:19 2026  (00:47)
administ pts/0        115.138.27.202   Tue Sep 22 13:22:50 2026 - Tue Sep 22 16:40:42 2026  (03:17)
administ pts/0        180.226.236.94   Tue Sep 22 09:49:48 2026 - Tue Sep 22 12:10:59 2026  (02:21)
administ pts/0        115.138.27.202   Tue Sep 22 07:17:49 2026 - Tue Sep 22 09:03:24 2026  (01:45)
administ pts/1        115.138.27.202   Mon Sep 21 19:24:52 2026 - Tue Sep 22 05:56:53 2026  (10:32)
administ pts/0        115.138.27.202   Mon Sep 21 14:43:50 2026 - Tue Sep 22 05:58:31 2026  (15:14)
administ pts/0        115.138.27.202   Mon Sep 21 07:55:06 2026 - Mon Sep 21 14:43:37 2026  (06:48)
administ pts/0        115.138.27.202   Sun Sep 20 17:02:58 2026 - Mon Sep 21 04:38:05 2026  (11:35)
administ pts/0        115.138.27.202   Sun Sep 20 07:16:16 2026 - Sun Sep 20 12:15:02 2026  (04:58)
administ pts/0        115.138.27.202   Sat Sep 19 08:07:18 2026 - Sat Sep 19 23:39:11 2026  (15:31)
administ pts/0        115.138.27.202   Fri Sep 18 19:38:50 2026 - Sat Sep 19 01:04:47 2026  (05:25)
administ pts/0        115.138.27.202   Fri Sep 18 08:07:19 2026 - Fri Sep 18 09:06:50 2026  (00:59)

wtmp begins Wed Feb  4 11:18:18 2026
""".strip('\n')

SERVER_PORTS = r"""
0.0.0.0:22
0.0.0.0:23388
0.0.0.0:443
0.0.0.0:80
127.0.0.1:3306
127.0.0.1:36715
127.0.0.1:4317
127.0.0.1:5432
127.0.0.1:6379
127.0.0.1:8555
127.0.0.53%lo:53
127.0.0.54:53
[::]:22
[::]:23388
*:3000
*:3001
[::]:443
[::]:80
*:9001
*:9002
*:9003
*:9004
*:9005
*:9007
*:9008
*:9009
*:9010
*:9011
""".strip('\n')

SERVER_LOG_RETENTION = r"""
-- 앱 로그 회전(pm2-logrotate)
$ pm2 set pm2-logrotate:max_size 100M
$ pm2 set pm2-logrotate:retain 400
$ pm2 set pm2-logrotate:compress true
$ pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
$ pm2 set pm2-logrotate:rotateInterval 0 0 * * *
-- 앱 로그 파일: 가장 오래된 것 5개 / 개수 / 용량
-rw-rw-r-- 1 administrator administrator        0 Sep 12 15:30 pm2-logrotate-error.log
-rw-rw-r-- 1 administrator administrator 73328826 Sep 12 15:31 targetup-backend-out__2026-09-12_15-30-59.log.gz
-rw-rw-r-- 1 administrator administrator    41860 Sep 13 00:00 studio-py-out__2026-09-13_00-00-00.log
-rw-rw-r-- 1 administrator administrator       95 Sep 13 00:00 pm2-logrotate-out__2026-09-13_00-00-00.log
-rw-rw-r-- 1 administrator administrator     7149 Sep 13 00:00 outreach-render-out__2026-09-13_00-00-00.log
파일 수: 98 / 용량: 246M
-- 웹 서버 로그 회전(nginx)
        daily
        rotate 400
        compress
nginx 로그 파일 수: 71 / 가장 오래된 파일: error.log.34.gz
-- 시스템 저널 보관
SystemMaxUse=12G
MaxRetentionSec=1year
Archived and active journals take up 1.6G in the file system.
저널에서 가장 오래된 기록: 2026-07-12T02:36:32+09:00
""".strip('\n')

SERVER_LOG_PERMS = r"""
drwxrwxr-x  2 administrator administrator   12288 Oct  3 00:00 /home/administrator/.pm2/logs
drwxr-sr-x+ 3 root          systemd-journal  4096 Feb  4  2026 /var/log/journal
drwxr-xr-x  2 root          adm              4096 Oct  3 00:00 /var/log/nginx
-- DB 는 로컬에서만 열려 있다(외부 접속 불가)
127.0.0.1:6379
127.0.0.1:5432
127.0.0.1:3306
""".strip('\n')

SERVER_BACKUP = r"""
-- 예약
0 3 * * * /home/administrator/backups/backup.sh >> /home/administrator/backups/cron.log 2>&1
30 8 * * * /home/administrator/backups/backup-monitor.sh >> /home/administrator/backups/monitor.log 2>&1
-- 최근 실행 기록(마지막 12줄)
[2026-10-02 03:33:02] 로컬 정리 완료 (7일 초과)
[2026-10-02 03:33:02] ===== 백업 성공 완료 =====
[2026-10-03 03:00:01] ===== 백업 시작 (20261003_030001) =====
[2026-10-03 03:00:01] PostgreSQL 덤프+암호화...
[2026-10-03 03:00:32] PostgreSQL 완료: 368M
[2026-10-03 03:00:32] MySQL 덤프+암호화...
mysqldump: [Warning] Using a password on the command line interface can be insecure.
[2026-10-03 05:23:24] MySQL 완료: 402M
[2026-10-03 05:23:24] 59 오프사이트 전송...
[2026-10-03 05:23:31] 전송 완료
[2026-10-03 05:23:31] 로컬 정리 완료 (7일 초과)
[2026-10-03 05:23:31] ===== 백업 성공 완료 =====
-- 서버에 남아 있는 백업(최근 8개)
-rw-rw-r-- 1 administrator administrator      3985 Oct  3 08:30 monitor.log
-rw-rw-r-- 1 administrator administrator     42383 Oct  3 05:23 cron.log
-rw-rw-r-- 1 administrator administrator        20 Oct  3 05:23 LAST_SUCCESS
-rw-rw-r-- 1 administrator administrator 421472021 Oct  3 05:23 mysql_smsdb_20261003_030001.sql.gz.gpg
-rw-rw-r-- 1 administrator administrator 385842948 Oct  3 03:00 pg_targetup_20261003_030001.sql.gz.gpg
-rw-rw-r-- 1 administrator administrator 417460136 Oct  2 03:32 mysql_smsdb_20261002_030001.sql.gz.gpg
-rw-rw-r-- 1 administrator administrator 381680916 Oct  2 03:00 pg_targetup_20261002_030001.sql.gz.gpg
-rw-rw-r-- 1 administrator administrator 406911269 Oct  1 03:22 mysql_smsdb_20261001_030001.sql.gz.gpg
-- 마지막 성공 표식
2026-10-03 05:23:31.631241666 +0900  LAST_SUCCESS
""".strip('\n')

SERVER_BACKUP_MONITOR = r"""
-- 감시 예약
30 8 * * * /home/administrator/backups/backup-monitor.sh >> /home/administrator/backups/monitor.log 2>&1
-- 감시 기록(마지막 8줄)
[2026-09-26 08:30:01] OK: 백업 신선도 정상
[2026-09-27 08:30:01] OK: 백업 신선도 정상
[2026-09-28 08:30:01] OK: 백업 신선도 정상
[2026-09-29 08:30:01] OK: 백업 신선도 정상
[2026-09-30 08:30:01] OK: 백업 신선도 정상
[2026-10-01 08:30:01] OK: 백업 신선도 정상
[2026-10-02 08:30:01] OK: 백업 신선도 정상
[2026-10-03 08:30:01] OK: 백업 신선도 정상
-- 경보 보낼 곳 설정 여부(값은 찍지 않는다)
ALERT_CMD 없음 또는 비어 있음
""".strip('\n')

# ── 이새 싱크에이전트 출발지 재등록 뒤 재확인 (2026-10-03 · Harold 실행 · .62) ──────────────
# 재등록 = 10:00:37(회사 에이전트 범위) · 기록은 같은 출발지를 1시간에 한 번만 남긴다 · 백엔드 프로세스 09:43~11:39 동일
ISAE_RECHECK_COLLECTED = '2026-10-03 11:49 (한국 · 출력을 받은 시각)'

ISAE_RECHECK_DETECTED = r"""
         action          |                     details                     |   ip_address   |            kst
-------------------------+-------------------------------------------------+----------------+----------------------------
 machine_origin_detected | {"scope": "company_agent", "registered": false} | 125.141.198.22 | 2026-10-03 09:30:19.105884
 machine_origin_detected | {"scope": "company_agent", "registered": false} | 125.141.198.22 | 2026-10-03 10:00:16.99482
(2 rows)
""".strip('\n')

ISAE_RECHECK_AGENT = r"""
 agent_name | status |       heartbeat_kst        |          sync_kst
------------+--------+----------------------------+----------------------------
 isae       | active | 2026-10-03 11:00:17.846848 | 2026-10-03 11:30:19.864189
(1 row)
""".strip('\n')

# ── 백업 경보 설정 뒤 재수집 (2026-10-03 · Harold 실행 · .62 root) ─────────────────────────────
# 12:08 경보 보낼 곳(ALERT_CMD) 설정 · 시험 발송(응답 200 · 담당자 휴대폰 수신 확인 = Harold) → 14:51 백업 구간 재수집
# → 서버 스크립트의 경보 줄 확인(서버본은 저장소본과 해시가 다르다 · 경보 줄은 같은 동작)
SERVER_BACKUP2_COLLECTED = '2026-10-03 14:51 (한국) · 경보 시험 12:08'

SERVER_BACKUP2 = r"""
-- 예약
0 3 * * * /home/administrator/backups/backup.sh >> /home/administrator/backups/cron.log 2>&1
30 8 * * * /home/administrator/backups/backup-monitor.sh >> /home/administrator/backups/monitor.log 2>&1
-- 최근 실행 기록(마지막 12줄)
[2026-10-02 03:33:02] 로컬 정리 완료 (7일 초과)
[2026-10-02 03:33:02] ===== 백업 성공 완료 =====
[2026-10-03 03:00:01] ===== 백업 시작 (20261003_030001) =====
[2026-10-03 03:00:01] PostgreSQL 덤프+암호화...
[2026-10-03 03:00:32] PostgreSQL 완료: 368M
[2026-10-03 03:00:32] MySQL 덤프+암호화...
mysqldump: [Warning] Using a password on the command line interface can be insecure.
[2026-10-03 05:23:24] MySQL 완료: 402M
[2026-10-03 05:23:24] 59 오프사이트 전송...
[2026-10-03 05:23:31] 전송 완료
[2026-10-03 05:23:31] 로컬 정리 완료 (7일 초과)
[2026-10-03 05:23:31] ===== 백업 성공 완료 =====
-- 서버에 남아 있는 백업(최근 8개)
-rw-rw-r-- 1 administrator administrator      3985 Oct  3 08:30 monitor.log
-rw-rw-r-- 1 administrator administrator     42383 Oct  3 05:23 cron.log
-rw-rw-r-- 1 administrator administrator        20 Oct  3 05:23 LAST_SUCCESS
-rw-rw-r-- 1 administrator administrator 421472021 Oct  3 05:23 mysql_smsdb_20261003_030001.sql.gz.gpg
-rw-rw-r-- 1 administrator administrator 385842948 Oct  3 03:00 pg_targetup_20261003_030001.sql.gz.gpg
-rw-rw-r-- 1 administrator administrator 417460136 Oct  2 03:32 mysql_smsdb_20261002_030001.sql.gz.gpg
-rw-rw-r-- 1 administrator administrator 381680916 Oct  2 03:00 pg_targetup_20261002_030001.sql.gz.gpg
-rw-rw-r-- 1 administrator administrator 406911269 Oct  1 03:22 mysql_smsdb_20261001_030001.sql.gz.gpg
-- 마지막 성공 표식
2026-10-03 05:23:31.631241666 +0900  LAST_SUCCESS
""".strip('\n')

SERVER_BACKUP_MONITOR2 = r"""
-- 감시 예약
30 8 * * * /home/administrator/backups/backup-monitor.sh >> /home/administrator/backups/monitor.log 2>&1
-- 감시 기록(마지막 8줄)
[2026-09-26 08:30:01] OK: 백업 신선도 정상
[2026-09-27 08:30:01] OK: 백업 신선도 정상
[2026-09-28 08:30:01] OK: 백업 신선도 정상
[2026-09-29 08:30:01] OK: 백업 신선도 정상
[2026-09-30 08:30:01] OK: 백업 신선도 정상
[2026-10-01 08:30:01] OK: 백업 신선도 정상
[2026-10-02 08:30:01] OK: 백업 신선도 정상
[2026-10-03 08:30:01] OK: 백업 신선도 정상
-- 경보 보낼 곳 설정 여부(값은 찍지 않는다)
ALERT_CMD 설정됨
""".strip('\n')

SERVER_ALERT_HOOKS = r"""
== /home/administrator/backups/backup.sh (마지막 수정 2026-09-22 13:22:53)
20:alert(){
23:  [[ -n "${ALERT_CMD:-}" ]] && ALERT_MSG="한줄로 백업 실패: $1" bash -c "${ALERT_CMD}" || true
25:trap 'alert "라인 ${LINENO} 중단(직전 명령 실패)"' ERR
34:(( PG_SZ >= MIN_PG_BYTES )) || { alert "PG 산출물 과소 ${PG_SZ}B"; exit 1; }
43:(( MY_SZ >= MIN_MYSQL_BYTES )) || { alert "MySQL 산출물 과소 ${MY_SZ}B"; exit 1; }
46:file -b "${PG_OUT}" | grep -qi "PGP.*encrypted" || { alert "PG 산출물이 PGP 암호문 아님"; exit 1; }
47:file -b "${MY_OUT}" | grep -qi "PGP.*encrypted" || { alert "MySQL 산출물이 PGP 암호문 아님"; exit 1; }
== /home/administrator/backups/backup-monitor.sh (마지막 수정 2026-07-16 13:36:27)
4:MAX_AGE_HOURS=26
12:  (( age_h > MAX_AGE_HOURS )) && msg="마지막 성공 백업 ${age_h}시간 전(기준 ${MAX_AGE_HOURS}h 초과)"
15:  echo "[$(date '+%F %T')] ALERT: ${msg}"
16:  [[ -n "${ALERT_CMD:-}" ]] && ALERT_MSG="한줄로 백업 이상: ${msg}" bash -c "${ALERT_CMD}" || true
""".strip('\n')

SERVER_ALERT_TEST = r"""
기존 ALERT_CMD 줄 수: 0
alert_http=200
-- 감시 실행
[2026-10-03 12:08:39] OK: 백업 신선도 정상
""".strip('\n')

# ── 발송 기록(문자 결과 월별 표) 보관 현황 (2026-10-03 · Harold 실행 · .62 root · 발송 DB 읽기 전용) ─────────────
# 약관 13조 9항 「1개월 보관 · 자동 파기」 개정(1년 이상 보관) 근거. 우리 코드에는 월별 발송 기록 표를 지우는 곳이 없다(1003 확인).
SEND_LOG_COLLECTED = '2026-10-03 (한국)'

SEND_LOG_RANGE = r"""
+--------------+--------------+------------+
| oldest_month | newest_month | log_tables |
+--------------+--------------+------------+
| 202602       | 202611       |        110 |
+--------------+--------------+------------+
""".strip('\n')

SEND_LOG_MONTHS = r"""
+--------+--------+-------------+
| month  | tables | approx_rows |
+--------+--------+-------------+
| 202602 |     11 |          33 |
| 202603 |     11 |      210847 |
| 202604 |     11 |      238243 |
| 202605 |     11 |     2983557 |
| 202606 |     11 |     5384673 |
| 202607 |     11 |     3135047 |
| 202608 |     11 |     2754744 |
| 202609 |     11 |     2263019 |
| 202610 |     11 |           0 |
| 202611 |     11 |           0 |
+--------+--------+-------------+
""".strip('\n')

# ── 한줄로 앱 로그 폴더 권한 좁힘 (2026-10-03 · Harold 실행 · .62 root · chmod g-w,o-w) ─────────────
LOG_DIR_PERM_COLLECTED = '2026-10-03 (한국)'

LOG_DIR_PERM = r"""
-- 바꾸기 전
drwxrwxr-x 2 administrator administrator 12288 Oct  3 00:00 /home/administrator/.pm2/logs
-- 바꾼 뒤
drwxr-xr-x 2 administrator administrator 12288 Oct  3 00:00 /home/administrator/.pm2/logs
-- 로그가 계속 쓰이는지(최근 1분 안에 바뀐 파일)
/home/administrator/.pm2/logs/targetup-backend-out.log
""".strip('\n')

# ── 한줄로 방화벽 9090 허용 줄 삭제 (2026-10-03 17:27 · Harold 실행 · .62 root · 직전 듣는 프로그램 없음 확인) ─────────────
FW_9090_COLLECTED = '2026-10-03 17:27 (한국)'

FW_9090_DELETE = r"""
삭제 시각: 2026-10-03 17:27:18
Rule deleted
-- 남은 9090 줄
(없음)
2026-10-03 17:27:18.845193087 +0900  /etc/ufw/user.rules
""".strip('\n')

# ── 한줄로 원격 관리(SSH) 출발지 2곳 제한 (2026-10-03 · Harold 실행 · .62 root) ─────────────
# 17:34:12 대표 · 사무실 허용 추가 → 지금 접속 출발지 = 대표 확인 → 17:34:59 전체 허용(v4 · v6) 삭제 → 새 창 접속 확인 → 17:35:55 재수집
SSH_LIMIT_COLLECTED = '2026-10-03 17:34 · 17:35 (한국)'

SSH_LIMIT_ADD = r"""
추가 시각: 2026-10-03 17:34:12
Rule added
Rule added
-- 22 번 규칙
[ 1] 22/tcp                     ALLOW IN    Anywhere
[ 6] 22/tcp                     ALLOW IN    115.138.27.202             # owner-ssh
[ 7] 22/tcp                     ALLOW IN    180.226.236.94             # office-ssh
[ 8] 22/tcp (v6)                ALLOW IN    Anywhere (v6)
""".strip('\n')

SSH_LIMIT_AFTER = r"""
수집 시각: 2026-10-03 17:35:55
Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), deny (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere
3000                       DENY IN     Anywhere
9001:9011/tcp              DENY IN     Anywhere
22/tcp                     ALLOW IN    115.138.27.202             # owner-ssh
22/tcp                     ALLOW IN    180.226.236.94             # office-ssh
80/tcp (v6)                ALLOW IN    Anywhere (v6)
443/tcp (v6)               ALLOW IN    Anywhere (v6)
3000 (v6)                  DENY IN     Anywhere (v6)
9001:9011/tcp (v6)         DENY IN     Anywhere (v6)

-- 방화벽 서비스
active
active
-- 정책 파일 마지막 수정
2026-10-03 17:34:59.710661457 +0900  /etc/ufw/user.rules
2026-10-03 17:34:59.787660488 +0900  /etc/ufw/user6.rules
""".strip('\n')
