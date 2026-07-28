/**
 * ★ 거래내역서 공개 확인 페이지 (2026-07-28) — 토큰 인증, 로그인 불요
 *
 * SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §4.
 * 마운트: /api/invoice-view (app.ts — 공개, 정산 담당자가 한줄로 계정이 없을 수 있다)
 *
 * 원칙:
 *  - 메일 클릭 즉시 확정 금지 — GET은 금액 요약과 [컨펌하기] 버튼만 그리고,
 *    확정은 사람이 그 버튼을 눌러 보내는 POST로만 된다.
 *    ⛔ GET으로 확정하면 보안 스캐너·메일 클라이언트의 링크 미리열기에 컨펌이 찍힌다.
 *  - ★2026-07-28 상세 내역은 **메일 첨부 PDF**가 담당한다(Harold 지시). 여기서 항목표를 다시 그리지 않는다 —
 *    같은 내역이 두 벌이 되고, 화면이 "검토"와 "컨펌"을 겸하면서 버튼 뜻이 흐려졌다.
 *  - 토큰 = invoice_confirmations.token 1회성 랜덤값. 재발급(superseded)·발급 완료(issued) 후 무효.
 *  - 이의신청 접수 즉시 자동 계산서 제외(status='objected') — 슈퍼관리자 목록에서 사람이 처리한다.
 */

import express, { Router, Request, Response } from 'express';
import pool from '../config/database';

const router = Router();
// helmet·전역 json 파서보다 앞에 마운트되므로(CSP 차단 회피) 본문 파서는 라우터가 직접 든다.
router.use(express.json({ limit: '32kb' }));

const esc = (s: any) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TOKEN_RE = /^[0-9a-f]{16,64}$/i;

async function loadByToken(token: string): Promise<any | null> {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const r = await pool.query(
    // ★ Codex 1R LOW 수용 — date 컬럼은 pg 파서가 Date 객체로 주므로 to_char로 고정한다('Wed Jul 01' 표시 차단).
    `SELECT ic.id, ic.billing_id, ic.token, ic.recipient_email, ic.sent_at, ic.confirmed_at, ic.objection_at,
            ic.taxbill_status, ic.taxbill_due_at, ic.issued_at, ic.superseded_at,
            to_char(b.billing_start, 'YYYY-MM-DD') AS billing_start,
            to_char(b.billing_end, 'YYYY-MM-DD')   AS billing_end,
            b.total_amount, b.ai_credit_count, b.ai_credit_supply, b.scope AS billing_scope,
            c.company_name
       FROM invoice_confirmations ic
       JOIN billings b ON b.id = ic.billing_id
       JOIN companies c ON c.id = ic.company_id
      WHERE ic.token = $1`,
    [token],
  );
  return r.rows.length > 0 ? r.rows[0] : null;
}

/** 상태 → 페이지에서 아직 할 수 있는 행동. */
function actionState(row: any): 'actionable' | 'confirmed' | 'objected' | 'issued' | 'superseded' {
  if (row.superseded_at) return 'superseded';
  if (row.issued_at || row.taxbill_status === 'issued') return 'issued';
  if (row.objection_at) return 'objected';
  if (row.confirmed_at) return 'confirmed';
  return 'actionable';
}

function renderPage(row: any): string {
  const state = actionState(row);
  const amount = (Number(row.total_amount) || 0).toLocaleString();
  const period = `${row.billing_start} ~ ${row.billing_end}`;
  // ★ 재발급 무효분은 금액을 숨긴다(Codex 1R 부분 수용) — 낡은 금액이 최신처럼 읽히는 것 차단.
  const hideDetail = state === 'superseded';
  const statusBanner =
    state === 'superseded' ? '<div class="banner warn">이 거래내역서는 재발급되어 더 이상 유효하지 않습니다. 새로 받으신 메일을 확인해 주세요.</div>'
    : state === 'issued' ? '<div class="banner ok">세금계산서 발행이 완료된 건입니다.</div>'
    : state === 'objected' ? '<div class="banner warn">이의신청이 접수되었습니다. 담당자가 확인 후 연락드리겠습니다.</div>'
    : state === 'confirmed' ? `<div class="banner ok">컨펌이 완료되었습니다 (${new Date(row.confirmed_at).toLocaleString('ko-KR')}). 세금계산서 발행이 진행됩니다.</div>`
    : '';

  // ★ 2026-07-28 주 버튼은 컨펌 하나다. 이의신청은 같은 무게의 버튼이 아니라 아래 작은 링크로 둔다 —
  //   대다수는 컨펌하러 들어오는데 버튼 둘을 나란히 두면 무엇을 눌러야 하는지 한 번 더 생각하게 된다.
  //   ⛔ 메일 링크(GET)만으로는 절대 컨펌하지 않는다. 보안 스캐너·메일 클라이언트가 링크를 미리 열면
  //      사람이 누르지 않은 컨펌이 찍힌다. 사람이 이 버튼을 눌러 보내는 POST 하나만 컨펌으로 친다.
  const actions = state === 'actionable' ? `
    <div class="actions">
      <button id="btnConfirm" class="btn primary" style="width:100%;">컨펌하기</button>
    </div>
    <p class="note" id="objectionLink" style="text-align:center;margin-top:12px;">
      내용에 이견이 있으신가요? <a id="btnObjection" href="javascript:void(0)" style="color:#fca5a5;">이의신청하기</a>
    </p>
    <div id="objectionBox" style="display:none;margin-top:14px;">
      <textarea id="objectionText" rows="4" placeholder="정산에서 이상한 부분, 수정이 필요한 내용을 적어 주세요."></textarea>
      <button id="btnObjectionSubmit" class="btn warn-btn" style="margin-top:8px;">이의신청 접수</button>
    </div>
    <p class="note">컨펌하시면 세금계산서 발행이 진행됩니다. 3일 안에 응답이 없으면 내역이 확정된 것으로 보고 발행이 진행됩니다.</p>` : '';

  return `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>거래내역서 확인 — 한줄로</title>
<style>
  body{margin:0;background:#0f172a;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#e2e8f0;}
  .wrap{max-width:520px;margin:0 auto;padding:40px 20px;}
  .card{background:#1e293b;border:1px solid #334155;border-radius:14px;padding:28px 24px;}
  h1{font-size:18px;margin:0 0 4px;} .sub{font-size:13px;color:#94a3b8;margin:0 0 20px;}
  .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #334155;font-size:14px;}
  .row b{font-size:15px;}
  .lines{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px;}
  .lines th{color:#94a3b8;font-weight:600;text-align:left;padding:6px 4px;border-bottom:1px solid #334155;}
  .lines td{padding:6px 4px;border-bottom:1px solid #1f2b3f;color:#cbd5e1;}
  .lines .num{text-align:right;white-space:nowrap;}
  .banner{margin:16px 0 0;padding:12px 14px;border-radius:10px;font-size:13px;line-height:1.6;}
  .banner.ok{background:#064e3b;color:#a7f3d0;} .banner.warn{background:#78350f;color:#fde68a;}
  .actions{display:flex;gap:10px;margin-top:22px;flex-wrap:wrap;}
  .btn{flex:1;min-width:150px;padding:13px 16px;border-radius:10px;border:0;font-size:14px;font-weight:700;cursor:pointer;}
  .btn.primary{background:#4f46e5;color:#fff;} .btn.ghost{background:transparent;color:#fca5a5;border:1px solid #7f1d1d;}
  .btn.warn-btn{background:#b45309;color:#fff;width:100%;}
  textarea{width:100%;box-sizing:border-box;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:10px;padding:12px;font-size:14px;font-family:inherit;}
  .note{font-size:12px;color:#64748b;line-height:1.7;margin:18px 0 0;}
  .msg{margin-top:14px;font-size:13px;line-height:1.6;display:none;padding:12px 14px;border-radius:10px;}
</style></head>
<body><div class="wrap"><div class="card">
  <h1>거래내역서 컨펌</h1>
  <p class="sub">${esc(row.company_name)} · ${esc(period)}</p>
  ${hideDetail ? '' : `
  <div class="row"><span>청구 기간</span><b>${esc(period)}</b></div>
  <div class="row"><span>청구 금액 (부가세 포함)</span><b>${amount}원</b></div>
  <div class="row"><span>수신</span><b>${esc(row.recipient_email)}</b></div>
  <p class="note">상세 내역은 메일에 첨부된 거래내역서 PDF에 있습니다.</p>`}
  ${statusBanner}
  ${actions}
  <div id="msg" class="msg"></div>
</div></div>
<script>
(function(){
  var token=${JSON.stringify(String(row.token))};
  var msg=document.getElementById('msg');
  function show(text, ok){ msg.style.display='block'; msg.textContent=text;
    msg.style.background = ok ? '#064e3b' : '#7f1d1d'; msg.style.color = ok ? '#a7f3d0' : '#fecaca'; }
  function post(path, body, done){
    fetch('/api/invoice-view/'+token+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok, j:j};});})
      .then(function(x){ if(x.ok){ done(x.j); } else { show(x.j && x.j.error ? x.j.error : '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', false); } })
      .catch(function(){ show('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', false); });
  }
  var bc=document.getElementById('btnConfirm');
  if(bc){ bc.addEventListener('click', function(){
    bc.disabled=true;
    post('/confirm', {}, function(){ show('컨펌이 완료되었습니다. 세금계산서 발행이 진행됩니다. 감사합니다.', true);
      var ac=document.querySelector('.actions'); if(ac) ac.style.display='none';
      var ol=document.getElementById('objectionLink'); if(ol) ol.style.display='none';
      var ob=document.getElementById('objectionBox'); if(ob) ob.style.display='none'; });
  }); }
  var bo=document.getElementById('btnObjection');
  if(bo){ bo.addEventListener('click', function(){
    var box=document.getElementById('objectionBox');
    box.style.display = box.style.display==='none' ? 'block' : 'none';
  }); }
  var bs=document.getElementById('btnObjectionSubmit');
  if(bs){ bs.addEventListener('click', function(){
    var text=(document.getElementById('objectionText').value||'').trim();
    if(text.length<5){ show('이의신청 내용을 5자 이상 적어 주세요.', false); return; }
    bs.disabled=true;
    post('/objection', {text:text}, function(){ show('이의신청이 접수되었습니다. 세금계산서 자동 발행이 보류되고, 담당자가 확인 후 연락드립니다.', true);
      var ac=document.querySelector('.actions'); if(ac) ac.style.display='none';
      var ol=document.getElementById('objectionLink'); if(ol) ol.style.display='none';
      document.getElementById('objectionBox').style.display='none'; });
  }); }
})();
</script></body></html>`;
}

// GET /:token — 중간 확인 페이지 (청구서와 같은 항목 줄을 함께 보여준다 — 내역 검토 후 컨펌)
router.get('/:token', async (req: Request, res: Response) => {
  try {
    const row = await loadByToken(req.params.token);
    if (!row) {
      return res.status(404).send('<meta charset="utf-8"/>유효하지 않은 링크입니다. 메일의 최신 링크로 다시 접속해 주세요.');
    }
    // ★ 2026-07-28 항목표 조회를 걷어냈다. 내역은 **메일에 첨부된 PDF**가 담당한다 —
    //   여기서 항목표를 다시 그리면 같은 내역이 두 벌이 되고(어느 쪽이 진실인지 흐려진다),
    //   화면이 "검토"와 "컨펌"을 겸하면서 버튼 뜻이 흐려졌다(Harold 2026-07-28). 이 페이지는 컨펌만 한다.
    res.setHeader('Cache-Control', 'no-store');
    return res.send(renderPage(row));
  } catch (error: any) {
    console.error('거래내역서 확인 페이지 오류:', error);
    return res.status(500).send('<meta charset="utf-8"/>일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
  }
});

// POST /:token/confirm — 컨펌 ack
router.post('/:token/confirm', async (req: Request, res: Response) => {
  try {
    const row = await loadByToken(req.params.token);
    if (!row) return res.status(404).json({ error: '유효하지 않은 링크입니다.' });
    const state = actionState(row);
    if (state !== 'actionable') {
      return res.status(409).json({ error: '이미 처리된 건입니다. 화면을 새로고침해 주세요.' });
    }
    // manual_wait(직접선택 정책)은 컨펌 시각만 기록하고 상태는 유지한다 — 발급은 사람이 날짜를 정한 뒤다.
    const upd = await pool.query(
      `UPDATE invoice_confirmations
          SET confirmed_at = NOW(),
              confirmed_ip = $2,
              taxbill_status = CASE WHEN taxbill_status IN ('pending', 'due') THEN 'confirmed' ELSE taxbill_status END
        WHERE id = $1::uuid AND confirmed_at IS NULL AND objection_at IS NULL AND superseded_at IS NULL AND issued_at IS NULL`,
      [row.id, String(req.ip || '').slice(0, 64)],
    );
    // ★ 2026-07-28 6원칙 ② — 바뀐 행이 없으면 성공이라고 말하지 않는다.
    //   위 상태 점검과 이 UPDATE 사이에 다른 요청이 끼면 WHERE 가드가 0행을 걸러내는데,
    //   그대로 success를 주면 화면은 "컨펌 완료"를 띄운다. 시스템이 거짓말하는 자리다.
    if ((upd.rowCount || 0) === 0) {
      return res.status(409).json({ error: '이미 처리된 건입니다. 화면을 새로고침해 주세요.' });
    }
    return res.json({ success: true });
  } catch (error: any) {
    console.error('거래내역서 컨펌 오류:', error);
    return res.status(500).json({ error: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

// POST /:token/objection — 이의신청 (자동 계산서 즉시 제외)
router.post('/:token/objection', async (req: Request, res: Response) => {
  try {
    const row = await loadByToken(req.params.token);
    if (!row) return res.status(404).json({ error: '유효하지 않은 링크입니다.' });
    const state = actionState(row);
    if (state === 'issued' || state === 'superseded' || state === 'objected') {
      return res.status(409).json({ error: '이미 처리된 건입니다. 화면을 새로고침해 주세요.' });
    }
    const text = String((req.body as any)?.text || '').trim();
    if (text.length < 5) return res.status(400).json({ error: '이의신청 내용을 5자 이상 적어 주세요.' });
    // 컨펌 후에도 발급 전이면 이의신청을 받는다 — 자동 발급보다 이견 확인이 먼저다.
    // ★ Codex 3R 수용 — 이의 접수와 발급 큐 보류를 **한 트랜잭션**으로. 따로 커밋하면
    //   두 번째가 실패했을 때 confirmation=objected인데 장부는 ready로 남아 발급이 나간다.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const objUpd = await client.query(
        `UPDATE invoice_confirmations
            SET objection_at = NOW(), objection_text = $2, taxbill_status = 'objected'
          WHERE id = $1::uuid AND objection_at IS NULL AND superseded_at IS NULL AND issued_at IS NULL`,
        [row.id, text.slice(0, 4000)],
      );
      // ★ 2026-07-28 6원칙 ② — 0행이면 접수되지 않은 것이다. 발급 큐 회수도 하지 않고 되돌린다.
      if ((objUpd.rowCount || 0) === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: '이미 처리된 건입니다. 화면을 새로고침해 주세요.' });
      }
      await client.query(
        `UPDATE taxbill_issues SET status = 'cancelled', error = '이의신청 접수로 발급 보류'
          WHERE confirmation_id = $1::uuid AND status = 'ready'`,
        [row.id],
      );
      await client.query('COMMIT');
    } catch (txErr) {
      try { await client.query('ROLLBACK'); } catch { /* 아래 응답이 사실을 전달한다 */ }
      throw txErr;
    } finally {
      client.release();
    }
    return res.json({ success: true });
  } catch (error: any) {
    console.error('거래내역서 이의신청 오류:', error);
    return res.status(500).json({ error: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

export default router;
