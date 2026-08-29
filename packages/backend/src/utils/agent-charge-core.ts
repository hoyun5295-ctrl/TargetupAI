/**
 * agent-charge-core.ts — 에이전트(게이트웨이 지갑) 충전 실행 코어 CT (★2026-08-28(3) 이동 신설)
 *
 * 종전에는 이 본문이 관리자 라우트(`POST /api/admin/agent-charges`)에 인라인이었다.
 * 링크 승인(무로그인 · 문자 속 주소) 입구가 생기면서 효과를 여기 한 벌로 옮겼다. **본문은 원본 복사
 * 이동**이고, res 응답만 결과 객체로 바뀌었다(HTTP 매핑은 각 입구 어댑터 소유 · 최외곽 오류 분기도
 * 어댑터에 남아 코어는 그대로 throw한다).
 *
 * ⛔ Codex 7R~12R 계약이 이 안에 그대로 산다: 멱등키 선조회·어드바이저리 락·uncertain 전역 게이트·
 *   일 한도(절대합 2억)·커밋 응답 유실 마킹·reserved 가드·주문 processing 연결. 이 파일을 고칠 때
 *   그 라운드 주석들이 잠근 순서를 바꾸지 마라.
 * ⛔ 게이트가 여기 있으므로 어떤 입구(화면·링크)도 검증을 우회할 수 없다.
 */
import pool, { query } from '../config/database';
import { isPayStatsConfigured, parseAgentCharges, insertAgentCharges } from './pay-stats';
import { sendSystemAlert } from './system-alert';

export type AgentChargeBatchOutcome =
  | { kind: 'ok'; status: 201; requestId: string; registered: Array<{ seqNo: number; agentSendId: string; amount: number; applied: false }> }
  | { kind: 'duplicated'; status: 200; requestId: string | null; registered: any[]; requestStatus: string | null; message: string }
  | { kind: 'uncertain'; status: 502; requestId: string; error: string }
  | { kind: 'uncertain_pending'; status: 409; code: 'UNCERTAIN_PENDING'; error: string; uncertainRequests: any[] }
  | { kind: 'error'; status: number; error: string };

export async function executeAgentChargeBatch(opts: {
  idempotencyKey: string;
  /** parseAgentCharges가 읽는 형태 그대로({ charges: [...] }) — 파싱·검증은 코어가 집행한다 */
  chargesInput: any;
  reason: string;
  /** 감사 표기(varchar 80) — 화면 = 관리자 userId, 링크 = 'link:번호' */
  requestedBy: string;
  orderIds?: string[];
}): Promise<AgentChargeBatchOutcome> {
  const idempotencyKey = String(opts.idempotencyKey || '').trim();
    if (!isPayStatsConfigured()) {
    return { kind: 'error' as const, status: 503, error: '게이트웨이 통계 DB(env paystats) 미설정. 충전 실행 불가' };
  }
    if (idempotencyKey.length < 8 || idempotencyKey.length > 80) {
    return { kind: 'error' as const, status: 400, error: 'idempotencyKey(8~80자)가 필요합니다.' };
  }
    const reason = String(opts.reason || '').trim();
    if (!reason || reason.length > 200) {
    return { kind: 'error' as const, status: 400, error: '충전 사유(1~200자)가 필요합니다.' };
  }
    const parsed = parseAgentCharges(opts.chargesInput);
    if ('error' in parsed) {
    return { kind: 'error' as const, status: 400, error: parsed.error };
  }

    // 발송ID 실존 + 선불(prepaid) + usage_type 검증 — 매핑에 없거나 후불인 ID 차단 (Codex 7R-3)
    const ids = parsed.charges.map((c) => c.agentSendId);
    const known = await query(
      `SELECT cai.agent_send_id, cai.billing_type, c.usage_type
         FROM company_agent_ids cai JOIN companies c ON c.id = cai.company_id
        WHERE cai.agent_send_id = ANY($1)`,
      [ids]
    );
    const infoMap = new Map<string, any>(known.rows.map((r: any) => [String(r.agent_send_id), r]));
    const unknown = ids.filter((v) => !infoMap.has(v));
    if (unknown.length > 0) {
      return { kind: 'error' as const, status: 400, error: `매핑에 없는 발송ID: ${unknown.join(', ')}. 고객사 수정 화면에서 먼저 등록하세요.` };
    }
    const notEligible = ids.filter((v) => {
      const r = infoMap.get(v);
      return r.billing_type !== 'prepaid' || !['agent', 'both'].includes(String(r.usage_type));
    });
    if (notEligible.length > 0) {
      return { kind: 'error' as const, status: 400, error: `선불 지정되지 않은 발송ID: ${notEligible.join(', ')}. 고객사 수정 화면에서 선불 지정 먼저 하세요.` };
    }

    const totalAmount = parsed.charges.reduce((s, c) => s + c.amount, 0);
    const absBatch = parsed.charges.reduce((s, c) => s + Math.abs(c.amount), 0);
    const requestedBy = String(opts.requestedBy || '');

    // 멱등 선조회 → 불확실 게이트 → 일 한도 → 예약 INSERT를 단일 트랜잭션(어드바이저리 락)으로(Codex 9R·10R).
    // - 멱등키 선조회가 한도보다 먼저: 이미 접수된 키의 안전 재전송이 일 한도 성장으로 오거부되지 않게(10R).
    // - 불확실 게이트 = 서버 전역: 미해소 uncertain 존재 시 어떤 경로(새 탭/새로고침/직접 API)로도 신규 충전 차단(10R-1a).
    // - 한도 = gross(abs_total 합산 — 배치 내 ± 상쇄로 우회 불가), 기준일 = Asia/Seoul. 근거: PAY 실측(§2-6).
    // 주문 선점 대상 — uuid 형태만(입구가 무엇을 넘기든 여기서 정규화한다)
    const orderIds = (Array.isArray(opts.orderIds) ? opts.orderIds : [])
      .map((v) => String(v || '').trim())
      .filter((v) => /^[0-9a-fA-F-]{36}$/.test(v));

    const client = await pool.connect();
    let requestId: string | null = null;
    let duplicatedKey = false;
    let uncertainPending: any[] | null = null;
    let capExceeded: { used: number } | null = null;
    let orderClaimFailed: { claimed: number; requested: number } | null = null;
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('agent_charge_requests_daily'))`);
      const dupChk = await client.query(`SELECT id FROM agent_charge_requests WHERE idempotency_key = $1`, [idempotencyKey]);
      if (dupChk.rows.length > 0) {
        duplicatedKey = true;
        await client.query('COMMIT');
      } else {
        // 게이트 대상 = 미해소 uncertain + "seqNo 없는 reserved 전부"(우회 창 0 — Codex 12R-1).
        //   정상 reserved는 같은 요청 처리 안에서 수백 ms 내 registered로 전이되므로, 여기 걸리는 것은
        //   ①마킹 실패 잔존 ②거의 동시에 온 다른 충전뿐. 단독 운영에서 동시 충전 과잉차단은 안전 방향.
        const unc = await client.query(
          `SELECT id, reason, abs_total, created_at, charges FROM agent_charge_requests
            WHERE status = 'uncertain'
               OR (status = 'reserved' AND (charges->0->>'seqNo') IS NULL)
            ORDER BY created_at ASC LIMIT 10`
        );
        if (unc.rows.length > 0) {
          uncertainPending = unc.rows;
          await client.query('ROLLBACK');
        } else {
          const daily = await client.query(
            `SELECT COALESCE(SUM(abs_total), 0) AS s
               FROM agent_charge_requests
              WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')
                AND status IN ('reserved', 'registered', 'uncertain')`
          );
          const dailyUsed = Number(daily.rows[0]?.s || 0);
          if (dailyUsed + absBatch > 200_000_000) {
            capExceeded = { used: dailyUsed };
            await client.query('ROLLBACK');
          } else {
            const reserve = await client.query(
              `INSERT INTO agent_charge_requests (idempotency_key, requested_by, reason, charges, total_amount, abs_total, status)
               VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'reserved')
               ON CONFLICT (idempotency_key) DO NOTHING
               RETURNING id`,
              [idempotencyKey, requestedBy, reason, JSON.stringify(parsed.charges), totalAmount, absBatch]
            );
            if (reserve.rows.length === 0) {
              duplicatedKey = true;
              await client.query('COMMIT');
            } else {
              requestId = String(reserve.rows[0].id);
              // ★2026-08-29 Codex 2R critical — 주문 선점을 **예약과 같은 트랜잭션·게이트웨이 호출 전**으로.
              //   종전에는 게이트웨이 등록이 끝난 뒤에야 pending 조건 UPDATE를 했고 0건도 성공으로 넘겼다.
              //   그래서 화면(랜덤 멱등키)과 링크(order: 키)가 같은 주문을 각자 충전할 수 있었다.
              //   여기서 잡으면 두 입구가 같은 문을 지나고, 프로세스가 죽어도 트랜잭션이 함께 롤백된다.
              //   ⛔ 전건 선점이 아니면 롤백한다 — 부분 선점은 "일부만 충전"이라는 더 나쁜 상태다.
              if (orderIds.length > 0) {
                const claimed = await client.query(
                  `UPDATE agent_charge_orders
                      SET status = 'processing', charge_request_id = $2, resolved_by = $3, resolved_at = NOW()
                    WHERE id = ANY($1::uuid[]) AND status = 'pending' AND agent_send_id = ANY($4::text[])`,
                  [orderIds, requestId, requestedBy || null, parsed.charges.map((c) => c.agentSendId)]
                );
                if ((claimed.rowCount ?? 0) !== orderIds.length) {
                  orderClaimFailed = { claimed: claimed.rowCount ?? 0, requested: orderIds.length };
                  requestId = null;
                  await client.query('ROLLBACK');
                } else {
                  await client.query('COMMIT');
                }
              } else {
                await client.query('COMMIT');
              }
            }
          }
        }
      }
      client.release();
    } catch (txErr) {
      // 롤백까지 실패한 클라이언트는 풀 복귀 금지 — release(true) = destroy (Codex 10R)
      try {
        await client.query('ROLLBACK');
        client.release();
      } catch {
        client.release(true as unknown as Error);
      }
      throw txErr;
    }

  if (uncertainPending) {
    return {
      kind: 'uncertain_pending' as const, status: 409, code: 'UNCERTAIN_PENDING' as const,
      error: '반영 불확실 충전이 미해소 상태입니다. 이력 확인 후 해소해야 신규 충전이 가능합니다.',
      uncertainRequests: uncertainPending,
    };
  }
    if (orderClaimFailed) {
      // 예약까지 롤백됐다 = 게이트웨이 미진입 확정. 주문은 원래 상태 그대로다(고착 0)
      return {
        kind: 'error' as const, status: 409,
        error: `이미 처리 중이거나 대상이 아닌 충전 요청이 섞여 있습니다(${orderClaimFailed.claimed}/${orderClaimFailed.requested}건만 선점). 접수함을 새로고침한 뒤 다시 시도해 주세요.`,
      };
    }
    if (capExceeded) {
      return { kind: 'error' as const, status: 400, error: `일 누적 충전 한도(절대합 200,000,000)를 초과합니다. (오늘 누적 ${capExceeded.used.toLocaleString()} + 이번 ${absBatch.toLocaleString()})` };
    }
    if (duplicatedKey || !requestId) {
      // 같은 키 재전송 — 기존 요청 그대로 반환(재충전 0)
      const existing = await query(
        `SELECT id, charges, status FROM agent_charge_requests WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      const ex = existing.rows[0];
    return {
      kind: 'duplicated' as const, status: 200,
      requestId: ex?.id || null,
      registered: Array.isArray(ex?.charges) ? ex.charges : [],
      // ★Codex 1R critical 수용 — 재전송을 무조건 성공처럼 말하면 uncertain(반영 불확실)까지 숨긴다.
      //   실상태를 동반해 입구가 registered만 성공으로 다루게 한다.
      requestStatus: (ex?.status as string) || null,
      message: '이미 접수된 요청입니다(중복 충전 차단).',
    };
    }

    let registered;
    try {
      registered = await insertAgentCharges(parsed.charges);
    } catch (mysqlErr: any) {
      if (mysqlErr?.chargeCommitUncertain) {
        // 커밋 응답 유실 — 실제 반영됐을 수 있다. 예약을 지우지 않고 uncertain 마킹(같은 키 재시도 = 중복 차단 유지, Codex 8R-1a).
        // 이후 신규 충전은 서버 전역 게이트가 차단하며, 해소는 /agent-charges/:id/resolve 로만 가능.
        // 마킹은 2회 시도 — 그래도 실패하면 reserved 잔존분을 게이트의 stale-reserved 조건이 잡는다(Codex 11R-1)
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await query(`UPDATE agent_charge_requests SET status = 'uncertain' WHERE id = $1`, [requestId]);
            break;
          } catch (markErr) {
            console.error(`[agent-charges] uncertain 마킹 실패(${attempt}/2 — 예약은 유지·게이트가 stale-reserved로 차단):`, markErr);
          }
        }
        // 최고 위험 경로(고액 실반영 가능 + ACK 유실)일수록 즉시 알림 — 금액 무관 발송(Codex 10R)
        sendSystemAlert({
          dedupKey: `agent-charge-uncertain:${requestId}`,
          message: `에이전트 충전 반영 불확실(커밋 응답 유실): 절대합 ${absBatch.toLocaleString()}원 ${parsed.charges.length}건 (by ${requestedBy || 'unknown'}) 사유: ${reason}. 이력 확인 후 해소 필요`,
          cooldownMs: 1000,
        }).catch(() => { /* 미설정/실패 시 조용히 생략 */ });
      return {
        kind: 'uncertain' as const, status: 502,
        requestId: requestId as string,
        error: '커밋 응답 유실. 반영 여부 불확실. 같은 요청을 새로 넣지 말고, 아래 이력에서 해당 발송ID의 최신 행을 먼저 확인하세요.',
      };
      }
      // 커밋 전 실패 = MySQL 롤백 확정(충전 0건) — 예약 해제해 같은 키 재시도 허용.
      // ★2026-08-29 Codex 3R high — 주문 원복과 예약 삭제를 **한 트랜잭션**으로 묶는다.
      //   따로 실행하면 원복 실패 후에도 DELETE가 나가고, FK(ON DELETE SET NULL)가 charge_request_id를
      //   비워 주문이 processing으로 영구 고착된다(되돌릴 단서 소멸).
      //   원복이 전건 성공일 때만 예약을 지운다. 아니면 **예약을 그대로 남긴다** — SeqNo 없는 reserved는
      //   기존 전역 게이트가 신규 충전을 막고, 해소(not_applied)가 주문까지 되돌리는 설계된 복구 루프다.
      const cleanup = await pool.connect();
      try {
        await cleanup.query('BEGIN');
        if (orderIds.length > 0) {
          const restored = await cleanup.query(
            `UPDATE agent_charge_orders
                SET status = 'pending', charge_request_id = NULL, resolved_by = NULL, resolved_at = NULL
              WHERE charge_request_id = $1::uuid AND status = 'processing'`,
            [requestId]
          );
          if ((restored.rowCount ?? 0) !== orderIds.length) {
            throw new Error(`주문 원복 불일치: ${restored.rowCount ?? 0}/${orderIds.length}`);
          }
        }
        await cleanup.query(`DELETE FROM agent_charge_requests WHERE id = $1 AND status = 'reserved'`, [requestId]);
        await cleanup.query('COMMIT');
        cleanup.release();
      } catch (cleanupErr: any) {
        try { await cleanup.query('ROLLBACK'); cleanup.release(); } catch { cleanup.release(true as unknown as Error); }
        // 예약이 남았다 = 전역 게이트가 막고 해소 경로가 수렴시킨다. 사람에게는 알린다.
        console.error('[agent-charges] 실패 정리 불가(예약 보존 — 해소 경로로 수렴):', cleanupErr?.message || cleanupErr);
        sendSystemAlert({
          dedupKey: `agent-charge-claim-stuck:${requestId}`,
          title: '충전 요청 정리가 완료되지 않았습니다.',
          details: ['충전은 실행되지 않았습니다.', '신규 충전은 해소 전까지 잠깁니다.'],
          action: '충전 관리에서 미확정 건을 해소해 주세요.',
          cooldownMs: 1000,
        }).catch(() => { /* 미설정·실패는 조용히 */ });
      }
      throw mysqlErr;
    }

    // 충전은 이미 확정 — 확정 기록(PG) 실패로 500을 내면 프론트가 새 키로 재시도해 이중 충전된다(Codex 8R-1b). 로그만 남기고 201 유지.
    // ★status='reserved' 가드(Codex 12R-2): 이 요청이 그 사이 uncertain/not_applied로 전이됐다면 registered로 되돌리지 않는다
    //   (해소된 건을 늦은 확정이 뒤집어 이중 충전 회계를 만드는 경로 차단).
    try {
      const book = await query(
        `UPDATE agent_charge_requests SET charges = $2::jsonb, status = 'registered' WHERE id = $1 AND status = 'reserved'`,
        [requestId, JSON.stringify(registered.map((r) => ({ seqNo: r.seqNo, agentSendId: r.agentSendId, amount: r.amount, applied: false })))]
      );
      if ((book.rowCount ?? 0) === 0) {
        console.warn(`[agent-charges] 확정 기록 skip — 요청 ${requestId}이 이미 reserved가 아님(uncertain/not_applied 전이됨). 충전은 성공했으므로 이력에서 확인 필요`);
      }
    } catch (bookErr) {
      console.error('[agent-charges] 확정 기록 실패(충전은 성공·멱등 예약 유지 — 이력에서 확인 가능):', bookErr);
    }

    // ★2026-08-29 주문 연결은 **예약 트랜잭션에서 이미 끝났다**(위 선점). 게이트웨이 등록 뒤에 다시
    //   잇던 옛 블록은 제거했다 — 등록 후 연결은 그 사이 창에서 이중 충전을 허용하던 자리다(Codex 2R critical).
    //   'fulfilled'(완료)는 여기서 넘기지 않는다: 게이트웨이 반영(RsApplyFlag='Y') 확인 뒤 대사 워커가 한다(6원칙 ②).

    // 고액 배치(절대합 5천만+) 즉시 알림 — 단독 운영 통제 보강(Codex 9R). 알림 실패는 충전 결과 무영향
    if (absBatch >= 50_000_000) {
      sendSystemAlert({
        dedupKey: `agent-charge-high:${requestId}`,
        message: `에이전트 고액 충전 등록: 절대합 ${absBatch.toLocaleString()}원 ${registered.length}건 (by ${requestedBy || 'unknown'}) 사유: ${reason}`,
        cooldownMs: 1000,
      }).catch(() => { /* 미설정/실패 시 조용히 생략 */ });
    }

    console.log(`[agent-charges] 등록 ${registered.length}건 (req ${requestId} · SeqNo ${registered.map((r) => r.seqNo).join(',')}) by ${requestedBy || 'unknown'} — ${reason}`);
  return {
    kind: 'ok' as const, status: 201,
    requestId: requestId as string,
    registered: registered.map((r) => ({ seqNo: r.seqNo, agentSendId: r.agentSendId, amount: r.amount, applied: false })),
  };
}
