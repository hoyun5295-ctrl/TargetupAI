/**
 * billing-lock.ts — 정산 쓰기의 **회사 단위 잠금** 컨트롤타워 (★ 2026-08-05 신설)
 *
 * 신설 사유: 같은 잠금이 **7벌로 복제돼 있었다**(발행 코어·최소과금·일괄발급 수동완료·080 반영·080 취소·
 * 라우트 2곳). 복제본은 반드시 갈라진다 — 실제로 한 곳만 고쳤을 때 나머지 여섯이 옛 축에 남아
 * "발행은 막았는데 수동완료는 통과"가 성립했다(Codex 지적).
 *
 * 잠금은 **두 겹**이다. 하나로는 닫히지 않는다.
 *
 *   ① advisory(company, 'billing') — 기존 축. 키가 **원문 문자열 해시**라 같은 UUID라도
 *      대문자·소문자 표기가 다르면 서로 다른 잠금이 잡힌다. 이 축만 믿으면 표기가 갈린 두 요청이
 *      나란히 통과한다. 그렇다고 키를 정규화하면 **배포 순간** 옛 코드가 든 잠금과 키가 달라져
 *      그 창에 진짜 경합이 생긴다 — 그래서 옛 키를 그대로 두고 아래를 덧댄다.
 *
 *   ② 회사 행(`companies`) — 정규 축. `$1::uuid` 캐스트가 표기를 정규화하므로 표기가 갈려도
 *      같은 행에서 줄을 선다. 요금제 이력 쓰기(`recordPlanChange` 호출부의 `UPDATE companies SET plan_id`)도
 *      이 행을 잡으므로, 발행과 요금제 변경이 **비로소 직렬화된다**(그전에는 `plan_change`라는 다른 키를 써서
 *      지문을 재대조해도 재조회~COMMIT 사이가 열려 있었다).
 *
 * `FOR NO KEY UPDATE`인 이유 — `FOR UPDATE`는 자식 테이블 INSERT가 부모 행에 거는 `KEY SHARE`까지 막는다.
 * 정산 트랜잭션이 무거운 사용량 집계를 안에서 도는 경로가 있어(최소과금), 그 몇 초 동안 그 회사의
 * 무관한 자식 INSERT가 전부 대기하게 된다. `FOR NO KEY UPDATE`는 `UPDATE companies SET ...`(키 아닌 컬럼)와
 * `FOR UPDATE`에는 그대로 충돌해 **필요한 직렬화는 유지**하면서 그 부작용만 뺀다.
 *
 * ⛔ 정산 쓰기 경로가 늘면 **여기를 부른다.** 인라인으로 두 줄을 복사하면 그 순간 8번째 복제본이다.
 */

/** 트랜잭션 안에서만 의미가 있다 — 반드시 `BEGIN` 뒤, 그 트랜잭션의 `client`로 부른다. */
type Tx = { query: (text: string, params?: any[]) => Promise<any> };

/** 한 회사의 정산 쓰기 잠금. */
export async function lockCompanyForBilling(client: Tx, companyId: string): Promise<void> {
  // advisory는 **호출자가 받은 원문 그대로** 잡는다 — 배포 창에서 아직 도는 옛 코드가 같은 값으로 잡고 있고,
  // 여기서 정규화하면 그 창에 둘이 갈린다. 표기 차이가 만드는 구멍은 아래 행 잠금이 닫는다.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext('billing'))`, [String(companyId)]);
  await client.query(`SELECT 1 FROM companies WHERE id = $1::uuid FOR NO KEY UPDATE`, [String(companyId)]);
}

/**
 * 여러 회사를 한 트랜잭션에서 잠글 때. **정렬 고정**이 교착을 막는다 —
 * 두 요청이 서로 다른 순서로 잡으면 A가 1번을, B가 2번을 쥔 채 서로를 기다린다.
 * 두 겹을 회사마다 붙여서 잡는다(축을 나눠 두 바퀴 돌면 그 사이가 다시 열린다).
 *
 * ★ 2026-08-05 **정렬 축을 DB가 준 값으로 바꿨다.** 여기서 세 번 연속 같은 부류가 났다 —
 *   대소문자로 한 번, 중괄호·하이픈 생략으로 또 한 번. 원인은 규칙이 모자란 게 아니라
 *   **내가 PG의 uuid 파서를 손으로 흉내내고 있던 것**이었다. 규칙을 늘리는 한 다음 표기가 또 나온다.
 *   그래서 파싱·정규화·정렬을 전부 PG에 맡긴다. 이 한 문장이 그 부류를 통째로 없앤다.
 *
 *   `SELECT`는 잠그지 않으므로 이 조회 자체가 순서를 만들지 않는다.
 *   실재하지 않는 회사는 조용히 빼지 않고 던진다 — 잠근 줄 알았는데 안 잠긴 상태가 제일 나쁘다.
 */
export async function lockCompaniesForBilling(client: Tx, companyIds: string[]): Promise<void> {
  // 빈 값은 "넘긴 것이 없다"는 뜻이라 여기서 거른다(그 외 표기 판정은 전부 PG 몫).
  const raws = (companyIds || []).map((x) => String(x || '').trim()).filter((x) => x !== '');
  if (raws.length === 0) return;

  // 회사마다 **처음 들어온 원문 표기**를 함께 받는다 — advisory는 그 값으로 잡아야 배포 창에서 옛 코드와 만난다.
  // 정렬은 `c.id`(uuid 의미값)이라 표기가 어떻든 두 트랜잭션의 순서가 같다.
  const res = await client.query(
    `SELECT DISTINCT ON (c.id) x.raw
       FROM unnest($1::text[]) WITH ORDINALITY AS x(raw, ord)
       JOIN companies c ON c.id = x.raw::uuid
      ORDER BY c.id, x.ord`,
    [raws],
  );
  const distinct = await client.query(
    `SELECT count(*)::int AS n FROM (SELECT DISTINCT t.raw::uuid FROM unnest($1::text[]) AS t(raw)) s`,
    [raws],
  );
  if (res.rows.length !== Number(distinct.rows[0]?.n)) {
    throw new Error('정산 잠금 대상 중 실재하지 않는 고객사가 있습니다.');
  }
  for (const r of res.rows) {
    await lockCompanyForBilling(client, String(r.raw));
  }
}
