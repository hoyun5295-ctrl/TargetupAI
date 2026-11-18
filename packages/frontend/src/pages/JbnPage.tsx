/**
 * JbnPage, JBN 회원 전용 신청 페이지 /jbn (2026-11-18 C144, 설계서 docs/2026-11-18-c144-jbn-special-price-design.md 4-1)
 *
 * 링크로만 여는 공개 페이지다. 어디에도 걸지 않고, 열려 있는 동안 검색 제외 meta 를 문서 머리에 넣는다.
 * 가격은 서버의 JBN 판 요금제 행에서만 읽는다(utils/jbn-public). 할인율도 정가와 JBN 가격으로 계산한다.
 * 신청은 utils/jbn-public 의 id 하나로 보낸다. 서버가 받지 않았다고 분명히 답한 경우(400)에만 새 id 를 만든다.
 * 이 파일의 글은 고객에게 나가는 글이라 가운뎃점과 줄표를 쓰지 않는다(계약 시험이 본다). 기본 대화상자도 쓰지 않는다.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { PLAN_INFRA } from '../constants/credit';
import {
  JBN_CONSULT_CHOICES, discountPct, fetchJbnPlans, newApplicationId, submitJbnApplication, won,
  type JbnApplyBody, type JbnConsultKey, type JbnPlan,
} from '../utils/jbn-public';
import './jbn-page.css';

const A = '/jbn-assets/';
const Check = () => <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const bg = (file: string) => ({ backgroundImage: `url("${A}${file}")` });

/** 검색 제외: 이 화면이 열려 있는 동안만 robots meta 를 넣고, 떠날 때 원래대로 돌린다 */
function useNoIndex(): void {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = '한줄로 JBN 회원 전용';
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const prevContent = meta?.getAttribute('content') ?? null;
    const created = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'robots');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', 'noindex, nofollow');
    return () => {
      document.title = prevTitle;
      if (created) meta?.remove();
      else if (prevContent !== null) meta?.setAttribute('content', prevContent);
    };
  }, []);
}

type PlansState = { kind: 'loading' } | { kind: 'ok'; plans: JbnPlan[] } | { kind: 'error' };

export default function JbnPage() {
  useNoIndex();

  // 요금 불러오기: 불러오기 하나에 차례 하나, 상한 10초
  const [plansState, setPlansState] = useState<PlansState>({ kind: 'loading' });
  const turn = useRef(0);
  const loadPlans = useCallback(async () => {
    const my = ++turn.current;
    setPlansState({ kind: 'loading' });
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 10_000);
    try {
      const plans = await fetchJbnPlans(ctl.signal);
      if (my === turn.current) setPlansState({ kind: 'ok', plans });
    } catch {
      if (my === turn.current) setPlansState({ kind: 'error' });
    } finally {
      window.clearTimeout(timer);
    }
  }, []);
  useEffect(() => { void loadPlans(); return () => { turn.current += 1; }; }, [loadPlans]);
  const plans = plansState.kind === 'ok' ? plansState.plans : [];

  // 신청
  const [form, setForm] = useState({ companyName: '', ownerName: '', nickname: '', phone: '', memo: '' });
  const [plan, setPlan] = useState<string | null>(null);
  const [method, setMethod] = useState<JbnConsultKey>('phone');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  // 보낸 신청(id 와 그때의 내용 한 묶음). 응답이 불확실하면 칸을 잠근 채 이 내용 그대로 다시 보낸다.
  // 서버가 받지 않았다고 분명히 답한 경우(400)에만 풀어 고칠 수 있다. 완료 화면도 이 내용을 그린다(Codex 구현 1R).
  const [sent, setSent] = useState<JbnApplyBody | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => { setForm((f) => ({ ...f, [k]: e.target.value })); setError(''); };

  // 칸이 그리는 값 = 보낸 신청이 있으면 그 내용, 없으면 지금 고치는 값(Codex 구현 1R 2R 같은 부류 = 화면과 보낸 내용이 어긋남).
  // 칸 밖 입구(요금제 카드)가 고치는 값을 바꿔도 잠긴 동안 화면에는 보낸 내용만 보인다.
  const locked = sending || sent !== null;
  const shown = sent ?? { ...form, interestPlanCode: plan, consultMethod: method, consent };

  const pickPlan = (code: string) => {
    if (!locked) setPlan(code);
    document.getElementById('apply')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const send = async (body: JbnApplyBody) => {
    setSending(true);
    setError('');
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 15_000);
    try {
      const r = await submitJbnApplication(body, ctl.signal);
      if (r.ok) { setDone(true); return; }
      if (r.definitive) setSent(null);   // 서버가 받지 않았다고 답한 것만 칸을 풀어 고쳐 새로 보낸다
      setError(r.error);
    } finally {
      window.clearTimeout(timer);
      setSending(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;
    if (sent) { await send(sent); return; }   // 응답이 불확실했던 신청 = 같은 id, 같은 내용 그대로
    if (!form.companyName.trim()) return setError('회사명을 입력해 주세요.');
    if (!form.ownerName.trim()) return setError('대표자 성함을 입력해 주세요.');
    if (!form.nickname.trim()) return setError('JBN 단톡방 닉네임을 입력해 주세요. 회원 확인에 씁니다.');
    if (!/^0\d{8,10}$/.test(form.phone.replace(/[^0-9]/g, ''))) return setError('연락받으실 휴대폰 번호를 확인해 주세요.');
    if (!consent) return setError('개인정보 수집과 이용에 동의해 주셔야 신청을 받을 수 있습니다.');
    const body: JbnApplyBody = {
      id: newApplicationId(),
      companyName: form.companyName.trim(), ownerName: form.ownerName.trim(), nickname: form.nickname.trim(),
      phone: form.phone, memo: form.memo, interestPlanCode: plan, consultMethod: method, consent, website,
    };
    setSent(body);
    await send(body);
  };

  /** 응답이 불확실한 신청을 두고 내용을 고쳐 새로 신청(앞 신청이 저장됐으면 담당자가 겹친 것을 정리한다) */
  const startOver = () => { setSent(null); setError(''); };

  const planName = (code: string | null) => (code ? plans.find((p) => p.code === code)?.name ?? code : '아직 모르겠어요');
  const offPct = plans.length > 0 ? Math.min(...plans.map((p) => discountPct(p.basePrice, p.price))) : 30;

  return (
    <div className="jbn">
      <header className="w nav">
        <a className="logo" href="#top">한줄로<i>JBN 회원 전용</i></a>
        <span className="sp" />
        <a className="t" href="#who">이런 분께</a>
        <a className="t" href="#feat">기능</a>
        <a className="t" href="#price">특별가</a>
        <a className="btn or sm" href="#apply">도입 상담 신청</a>
      </header>

      <main id="top">
        <section className="w hero">
          <div>
            <p className="lbl">JBN 대표님께만 드리는 특별가</p>
            <h1>고객관리,<br />이제 <em>한 줄</em>이면<br />됩니다</h1>
            <p className="sub">카카오톡과 문자 발송, 고객 관리, 홍보 이미지까지 한줄로 하나로 끝납니다. 반복되는 일은 한줄로가 맡고, 대표님은 무엇을 보낼지만 정하시면 됩니다.</p>
            <div className="offer">
              <div><b>구독료</b><p>모든 요금제 월 구독료 <em>{offPct}% 평생 할인</em></p></div>
              <div><b>발송 단가</b><p>문자와 카카오톡, <em>온라인 최저가 수준</em></p></div>
            </div>
            <div className="cta">
              <a className="btn or" href="#apply">도입 상담 신청</a>
              <a className="btn ln" href="#price">특별가 보기</a>
            </div>
          </div>
          <div className="hv">
            <div className="ph im" style={bg('hero-a.jpg')} role="img" aria-label="매장에서 휴대폰으로 발송 결과를 보는 대표" />
            <div className="chip done">
              <span className="dot"><Check /></span>
              <span>단골 1,240명에게 발송 완료<small>오늘 오전 10:00 예약 발송</small></span>
            </div>
            <div className="phone" aria-hidden="true">
              <span className="nt" />
              <div className="scr">
                <div className="bar0"><b>소요웨어</b>알림톡</div>
                <div className="th">
                  <div className="bub">
                    <div className="im" style={bg('n4-soyo-studioclean.jpg')} />
                    <p>첫 추위엔 울 니트. 윈터 컬렉션이 들어왔어요. 지난 겨울에 찾아 주신 고객님께 먼저 알려 드려요.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="sec sf" id="who">
          <div className="w who">
            <div className="ph im" style={bg('hero-b.jpg')} role="img" aria-label="꽃집에서 휴대폰을 보는 대표" />
            <div>
              <p className="lbl">1인 기업, 소규모 회사</p>
              <h2 className="h2">이런 일,<br />아직 손으로 하고 계신가요</h2>
              <div className="bf">
                <div><s>단골 명단을 엑셀로 정리하고 한 명씩 문자 보내기</s><p>고객 DB에 올려 두면 조건에 맞는 고객에게 <em>한 번에</em></p></div>
                <div><s>행사 때마다 문구 고민하고 받을 사람 다시 고르기</s><p>한 줄만 적으면 <em>문안과 받을 사람</em>까지 AI가 준비</p></div>
                <div><s>생일, 재구매 시기 챙기다가 놓치기</s><p>날짜가 되면 <em>알아서 보내는</em> 자동 마케팅</p></div>
                <div><s>홍보 이미지 외주 맡기고 며칠 기다리기</s><p>템플릿 고르고 문구만 쓰면 <em>포스터 완성</em></p></div>
              </div>
            </div>
          </div>
        </section>

        <div id="feat">
          <section className="ft">
            <div className="w fg">
              <div>
                <p className="q">보내기</p>
                <h3>카카오톡과 문자,<br />한 화면에서 보냅니다</h3>
                <p className="d">알림톡, 브랜드메시지, 문자를 같은 화면에서 고르고 보냅니다. 예약 발송도, 결과 확인도 한곳에서 끝납니다.</p>
                <ul>
                  <li><Check />받을 사람은 수신동의 고객만 자동으로</li>
                  <li><Check />보내기 전에 스팸 검사로 한 번 더 확인</li>
                  <li><Check />수신거부는 080 번호로 자동 처리</li>
                </ul>
              </div>
              <div className="pn" aria-hidden="true">
                <div className="ui">
                  <div className="uh">새 메시지<small>오늘 오전 10:00 예약</small></div>
                  <div className="seg"><span className="on">알림톡</span><span>브랜드메시지</span><span>문자</span></div>
                  <div className="msg"><small>보낼 내용</small>[오후담] 겨울 시즌 메뉴 메이플 크림 라떼가 나왔어요. 이번 주 방문하시면 사이즈 업을 해 드려요.</div>
                  <div className="kv">받는 사람<b>1,240명</b></div>
                  <div className="ubtn">예약하기</div>
                </div>
              </div>
            </div>
          </section>

          <section className="ft rev">
            <div className="w fg">
              <div>
                <p className="q">고객 관리</p>
                <h3>고객 명단 하나로<br />나누고, 골라 보냅니다</h3>
                <p className="d">쓰던 엑셀을 그대로 올리면 항목은 AI가 맞춰 넣습니다. 최근 구매, 생일, 등급처럼 조건을 고르면 받을 사람이 바로 추려집니다.</p>
                <ul>
                  <li><Check />엑셀 올리기 한 번이면 고객 DB 완성</li>
                  <li><Check />조건만 고르면 대상자 수가 바로 보입니다</li>
                  <li><Check />생일, 재구매 안내는 자동 마케팅으로 매일 알아서</li>
                </ul>
              </div>
              <div className="pn" aria-hidden="true">
                <div className="ui">
                  <div className="uh">우리 고객<small>전체 1,240명</small></div>
                  <div className="r"><div><b>최근 3개월 구매</b><span>412명</span></div><em>보내기</em></div>
                  <div className="r"><div><b>이번 달 생일</b><span>58명</span></div><em>보내기</em></div>
                  <div className="r"><div><b>VIP 등급</b><span>96명</span></div><em>보내기</em></div>
                  <div className="r"><div><b>6개월 넘게 안 오신 분</b><span>233명</span></div><em>보내기</em></div>
                  <div className="ok"><Check />생일 안내는 매일 아침 자동으로 나갑니다</div>
                </div>
              </div>
            </div>
          </section>

          <section className="ft last">
            <div className="w fg">
              <div>
                <p className="q">홍보 이미지</p>
                <h3>포스터는<br />이미지 스튜디오에서</h3>
                <p className="d">템플릿을 고르고 상품 사진과 문구만 넣으면 포스터가 나옵니다. 옆의 그림은 모두 이미지 스튜디오로 만든 실제 결과물입니다.</p>
                <ul>
                  <li><Check />만든 포스터는 그대로 메시지에 붙여 보내기</li>
                  <li><Check />디자이너 없이도 매번 같은 품질</li>
                </ul>
              </div>
              <div className="pn">
                <div className="pg">
                  <div className="im" style={bg('n3-ohudam-windowbar.jpg')} role="img" aria-label="카페 시즌 메뉴 포스터" />
                  <div className="im" style={bg('n2-kyeolon-niche.jpg')} role="img" aria-label="화장품 한정 상품 포스터" />
                  <div className="im" style={bg('n1-kyeolon-monoshadow.jpg')} role="img" aria-label="화장품 신상품 포스터" />
                  <div className="im" style={bg('n5-event-gallery.jpg')} role="img" aria-label="매장 오픈 행사 포스터" />
                </div>
              </div>
            </div>
          </section>
        </div>

        <section className="sec sf" id="price">
          <div className="w">
            <div className="prh">
              <div>
                <p className="lbl">JBN 회원 특별가</p>
                <h2 className="h2">모든 요금제 월 구독료<br /><em>{offPct}% 평생 할인</em></h2>
              </div>
              <p className="note">스타터부터 AI 기능과 발송 채널은 모두 같습니다.<br />회사 규모에 맞게 고르시면 됩니다.</p>
            </div>

            {plansState.kind === 'ok' && plans.length > 0 && (
              <div className={`plans${plans.length === 4 ? ' n4' : plans.length === 3 ? ' n3' : ''}`}>
                {plans.map((p) => (
                  <div className="pl" key={p.code}>
                    <div className="pt"><h4>{p.name}</h4><span className="off">{discountPct(p.basePrice, p.price)}% 할인</span></div>
                    <div className="pp"><p className="was">월 {won(p.basePrice)}</p><p className="now">{won(p.price)}<small>/월</small></p></div>
                    <ul><li>AI 크레딧 <b>매월 {p.credits.toLocaleString('ko-KR')}</b></li><li>{PLAN_INFRA[p.code]?.label ?? '고성능 공유 서버'}</li></ul>
                    <div className="pick"><button type="button" onClick={() => pickPlan(p.code)}>이 요금제로 상담</button></div>
                  </div>
                ))}
              </div>
            )}
            {plansState.kind === 'loading' && <div className="plans-msg">요금 안내를 불러오는 중입니다.</div>}
            {(plansState.kind === 'error' || (plansState.kind === 'ok' && plans.length === 0)) && (
              <div className="plans-msg">
                <span>요금 안내를 불러오지 못했습니다. 신청은 아래에서 그대로 하실 수 있습니다.</span>
                <button type="button" className="btn ln sm" onClick={() => void loadPlans()}>다시 불러오기</button>
              </div>
            )}
            <p className="vat">모든 금액은 한 달 기준이며 부가세 별도입니다. 메시지 발송 비용은 보낸 만큼 따로 계산됩니다.</p>

            <div className="info">
              <div><small>발송 단가</small><b>온라인 최저가 수준</b><p>문자와 카카오톡 발송 단가를 온라인 최저가 수준으로 맞춰 드립니다. 자세한 단가는 상담 때 안내해 드립니다.</p></div>
              <div><small>결제 방식</small><b>선불도, 후불도</b><p>충전해서 쓰는 선불, 한 달 쓰고 정산하는 후불 모두 됩니다. 어느 쪽이든 구독료는 할인된 금액으로 나갑니다.</p></div>
              <div><small>할인 기간</small><b>한 번 적용되면 계속</b><p>JBN 특별가는 요금제를 바꾸셔도 그대로 이어집니다.</p></div>
            </div>
          </div>
        </section>

        <section className="sec" id="apply">
          <div className="w ap">
            <div>
              <p className="lbl">도입 상담 신청</p>
              <h2 className="h2">단톡방 닉네임과<br />연락처를 남겨 주세요</h2>
              <ol className="steps">
                <li><span>01</span><div><b>신청</b><small>지금 이 페이지에서 1분이면 끝납니다</small></div></li>
                <li><span>02</span><div><b>회원 확인과 상담</b><small>단톡방 닉네임으로 회원을 확인하고, 업종에 맞춰 직접 보여 드립니다</small></div></li>
                <li><span>03</span><div><b>JBN 특별가로 시작</b><small>고르신 요금제에 특별가를 걸어 드립니다</small></div></li>
              </ol>
              <div className="ph im" style={bg('desk.jpg')} role="img" aria-label="노트북으로 일하는 대표" />
            </div>

            <div className="fm">
              {done ? (
                <div className="done-card" role="status">
                  <div className="big"><Check /></div>
                  <h3>신청을 받았습니다</h3>
                  <p>단톡방 닉네임으로 JBN 회원 확인을 마친 뒤<br />남겨 주신 번호로 담당자가 연락드립니다.</p>
                  <dl>
                    <div><dt>회사명</dt><dd>{sent?.companyName}</dd></div>
                    <div><dt>단톡방 닉네임</dt><dd>{sent?.nickname}</dd></div>
                    <div><dt>관심 요금제</dt><dd>{planName(sent?.interestPlanCode ?? null)}</dd></div>
                    <div><dt>상담 방식</dt><dd>{JBN_CONSULT_CHOICES.find((c) => c.key === sent?.consultMethod)?.label}</dd></div>
                  </dl>
                </div>
              ) : (
                <form onSubmit={submit} noValidate>
                  <h3>JBN 회원 도입 상담</h3>
                  <p className="fs">JBN 단톡방 닉네임으로 회원 여부를 확인합니다.</p>
                  <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                    <div className="f2">
                      <label className="fl"><span>회사명</span><input className="in" value={shown.companyName} onChange={set('companyName')} maxLength={60} placeholder="예) 한줄상사" autoComplete="organization" /></label>
                      <label className="fl"><span>대표자 성함</span><input className="in" value={shown.ownerName} onChange={set('ownerName')} maxLength={30} placeholder="예) 홍길동" autoComplete="name" /></label>
                    </div>
                    <div className="f2">
                      <label className="fl"><span>JBN 단톡방 닉네임</span><input className="in" value={shown.nickname} onChange={set('nickname')} maxLength={40} placeholder="예) 한줄상사 홍길동" /></label>
                      <label className="fl"><span>휴대폰 번호</span><input className="in" value={shown.phone} onChange={set('phone')} maxLength={13} inputMode="numeric" placeholder="010-0000-0000" autoComplete="tel" /></label>
                    </div>
                    <div className="fl"><span>관심 있는 요금제 <i>(선택)</i></span>
                      <div className="opts" role="group" aria-label="관심 있는 요금제">
                        <button type="button" aria-pressed={shown.interestPlanCode === null} onClick={() => setPlan(null)}>아직 모르겠어요</button>
                        {plans.map((p) => (
                          <button type="button" key={p.code} aria-pressed={shown.interestPlanCode === p.code} onClick={() => setPlan(p.code)}>{p.name}</button>
                        ))}
                      </div>
                    </div>
                    <div className="fl"><span>상담 방식</span>
                      <div className="opts" role="group" aria-label="상담 방식">
                        {JBN_CONSULT_CHOICES.map((c) => (
                          <button type="button" key={c.key} aria-pressed={shown.consultMethod === c.key} onClick={() => setMethod(c.key)}>{c.label}</button>
                        ))}
                      </div>
                    </div>
                    <label className="fl"><span>궁금한 점 <i>(선택)</i></span><textarea className="in" value={shown.memo} onChange={set('memo')} maxLength={500} placeholder="지금 쓰고 계신 발송 방법이나 궁금한 점을 적어 주세요" /></label>
                    <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)} />
                    <div className="agree">수집 항목: 회사명, 성함, JBN 단톡방 닉네임, 휴대폰 번호, 접속 IP<br />목적: JBN 회원 확인, 도입 상담 연락<br />보관: 신청일로부터 1년 뒤 파기합니다(접속 IP 는 90일). 동의하지 않으시면 신청을 받을 수 없습니다.</div>
                    <label className="ck"><input type="checkbox" checked={shown.consent} onChange={(e) => { setConsent(e.target.checked); setError(''); }} />개인정보 수집과 이용에 동의합니다 (필수)</label>
                  </fieldset>
                  <p className="err" role="alert">{error}</p>
                  <button type="submit" className="btn or" disabled={sending}>{sending ? '보내는 중' : sent ? '같은 내용으로 다시 보내기' : '상담 신청하기'}</button>
                  {sent && !sending ? (
                    <p className="tail">보낸 내용 그대로 다시 보냅니다. 내용을 고치려면 <button type="button" className="relink" onClick={startOver}>새로 신청하기</button></p>
                  ) : (
                    <p className="tail">신청하시면 담당자가 남겨 주신 번호로 연락드립니다.</p>
                  )}
                </form>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="foot"><div className="w">
        <b>한줄로</b><br />
        주식회사 인비토<br />
        이 페이지는 JBN 회원께만 안내되는 전용 페이지입니다.
      </div></footer>

      {!done && <div className="mcta"><a className="btn or" href="#apply">도입 상담 신청</a></div>}
    </div>
  );
}
