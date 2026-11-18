/**
 * JbnFeatures, JBN 페이지(/jbn) 기능 구역 (2026-11-18 C144 덧붙임)
 *
 * Harold 1118: 좋은 기능들을 다 넣어야지 / 모션그래픽으로 예시 이미지를 아주 상세하게, 생성되는 메시지는 성의 있게 /
 * AI 문안 생성, 오퍼레이터 기능 설명이 제대로 / 스팸 메시지함으로 빠질 위험이 해결된다는 내용 필수, 자사 개발 기술 점검으로 /
 * AI가 고객사의 목소리를 듣고 고객사의 목소리를 낸다(AI 메모리 목소리 복제, 설계서 docs/2026-10-28-ai-memory-brand-voice-design.md).
 *
 * 기능 설명은 앱 기능 안내 원장(backend/src/content/plan-feature-intros.ts)에 있는 사실만 쓴다.
 * 회사 명단 설정으로만 열리는 기능(소셜 채널 게시)은 싣지 않는다.
 * 예시 화면은 그림이 아니라 움직이는 화면 조각이다. 화면에 보일 때만 처음부터 돌고, 움직임 줄이기 설정이면 마지막 장면(전부 보임)에 멈춘다.
 * 고객에게 나가는 글이라 가운뎃점과 줄표를 쓰지 않는다(계약 시험이 본다).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

const A = '/jbn-assets/';
export const bg = (file: string) => ({ backgroundImage: `url("${A}${file}")` });
export const Check = () => <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduce(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduce;
}

/** 마지막 장면(전부 보이는 장면)에 더 머무는 박자 수 */
const HOLD = 2;

/** 예시 화면 하나의 장면 번호. 보이기 시작하면 0부터 ms 마다 하나씩, 마지막 장면에서 HOLD 박자 더 머문 뒤 처음으로. 안 보이면 멈춘다. 움직임 줄이기 또는 관찰 기능 없음 = 마지막 장면 */
function useScene(count: number, ms: number) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const still = reduce || typeof IntersectionObserver === 'undefined';   // 돌리지 않는 환경 = 마지막 장면 고정
  const [seen, setSeen] = useState(false);
  const [p, setP] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || still) return;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [still]);
  useEffect(() => {
    if (!seen || still) return;
    setP(0);
    const t = window.setInterval(() => setP((x) => (x + 1) % (count + HOLD)), ms);
    return () => window.clearInterval(t);
  }, [seen, still, count, ms]);
  const live = seen && !still;
  return { ref, p: still ? count - 1 : Math.min(p, count - 1), live };
}

/** 장면 at 부터 보이는 조각 */
const st = (p: number, at: number, cls = '') => `x-st${p >= at ? ' x-on' : ''}${cls ? ` ${cls}` : ''}`;

/** 한 글자씩 써지는 글. run 이 아니면 다 써진 글 */
function Typed({ text, run, speed = 42 }: { text: string; run: boolean; speed?: number }) {
  const [n, setN] = useState(text.length);
  useEffect(() => {
    if (!run) { setN(text.length); return; }
    setN(0);
    const t = window.setInterval(() => setN((x) => Math.min(x + 1, text.length)), speed);
    return () => window.clearInterval(t);
  }, [run, text, speed]);
  // 다 써진 글 자리를 먼저 잡아 두고(보이지 않게) 그 위에 써 내려간다. 쓰는 동안 화면 높이가 출렁이지 않는다
  return <span className="x-type"><span className="x-ghost">{text}</span><span>{text.slice(0, n)}{run && n < text.length ? <span className="x-caret" /> : null}</span></span>;
}

/** 0 에서 to 까지 올라가는 숫자. run 이 아니면 to */
function Count({ to, run }: { to: number; run: boolean }) {
  const [v, setV] = useState(to);
  useEffect(() => {
    if (!run) { setV(to); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      setV(Math.round(to * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, to]);
  return <>{v.toLocaleString('ko-KR')}</>;
}

function Feature({ rev, q, title, desc, demo, children }: { rev?: boolean; q: string; title: ReactNode; desc: string; demo: ReactNode; children?: ReactNode }) {
  return (
    <section className={`ft${rev ? ' rev' : ''}`}>
      <div className="w fg">
        <div>
          <p className="q">{q}</p>
          <h3>{title}</h3>
          <p className="d">{desc}</p>
          {children}
        </div>
        <div className="pn" aria-hidden="true">{demo}</div>
      </div>
    </section>
  );
}

const Steps = ({ items }: { items: [string, string][] }) => (
  <ol className="x-steps">
    {items.map(([t, s], i) => <li key={t}><span>{String(i + 1).padStart(2, '0')}</span><div><b>{t}</b><small>{s}</small></div></li>)}
  </ol>
);
const Ticks = ({ items }: { items: string[] }) => <ul>{items.map((t) => <li key={t}><Check />{t}</li>)}</ul>;
const Spin = () => <span className="x-spin" />;

// 1. AI 한줄로

const LINE_INPUT = '지난겨울 니트 산 고객에게 윈터 컬렉션 입고 소식이랑 10% 쿠폰 보내줘';
const LINE_DRAFTS: [string, string][] = [
  ['감성형', `(광고)[소요웨어]
서연님, 아침 공기가 제법 차가워졌어요.
지난겨울 골라 주신 울 니트, 올해도 잘 꺼내 입고 계신가요?

오늘 소요웨어 윈터 컬렉션이 들어왔어요. 더 부드러워진 메리노 울 니트와 가볍게 걸치기 좋은 하프 코트까지 한 벌씩 직접 입어 보고 골랐어요.

함께해 주신 고마움을 담아 서연님께 10% 쿠폰을 먼저 드려요. 11월 30일까지 쓰실 수 있어요.`],
  ['혜택강조형', `(광고)[소요웨어] 윈터 컬렉션 입고, 서연님께 10% 쿠폰

서연님, 기다리시던 겨울 니트가 들어왔어요.
지난겨울 니트를 구매해 주신 고객님께만 드리는 10% 쿠폰을 쿠폰함에 넣어 두었어요.

메리노 울 니트 7가지 색과 하프 코트 3가지 색이 새로 나왔고, 인기 사이즈는 일찍 품절될 수 있어요.

쿠폰 사용 기한 11월 30일까지
지금 쿠폰함에서 바로 확인해 보세요.`],
  ['MZ 감성형', `(광고)[소요웨어]
서연님, 니트 꺼낼 날씨 됐어요

작년 겨울 그 니트, 올해 짝꿍 찾으러 오세요
윈터 컬렉션 오늘 오픈했고
서연님 쿠폰함에 10% 쿠폰 넣어 뒀어요

11월 30일까지만 쓸 수 있어요
놓치면 진짜 아까워요`],
];

function LineDemo() {
  const { ref, p, live } = useScene(8, 1900);
  const draft = p === 5 ? 1 : p === 6 ? 2 : 0;
  return (
    <div className="x-app" ref={ref}>
      <div className="x-hd"><b>AI 한줄로</b><span>소요웨어</span></div>
      <div className="x-in"><SparkIcon /><span><Typed text={LINE_INPUT} run={live && p === 0} /></span></div>
      <div className={st(p, 1, 'x-ai')}><i>AI</i><p>쿠폰은 언제까지 쓸 수 있나요? 문안에 꼭 들어가야 하는데 한 줄에 없어서 여쭤요.</p></div>
      <div className={st(p, 2, 'x-me')}><span>11월 30일까지</span></div>
      <dl className={st(p, 3, 'x-kv')}>
        <dt>받는 사람</dt><dd><b><Count to={1126} run={live && p === 3} />명</b></dd>
        <dt>조건</dt><dd>지난겨울 니트 구매, 수신 동의 고객만</dd>
      </dl>
      <div className={st(p, 4)}>
        <div className="x-tabs">{LINE_DRAFTS.map(([k], i) => <span key={k} className={i === draft ? 'on' : ''}>{k}</span>)}</div>
        <div className="x-stack">{LINE_DRAFTS.map(([k, t], i) => <div key={k} className={`x-msg${i === draft ? ' on' : ''}`}>{t}</div>)}</div>
        <div className="x-tags"><span>(광고) 표기 자동</span><span>무료수신거부 번호 자동</span><span>LMS</span></div>
      </div>
      <div className={st(p, 7, 'x-done')}>
        <span><Check />스팸 점검 3사 정상 도착</span><b>내일 오전 10:00 예약</b>
      </div>
    </div>
  );
}

function SparkIcon() {
  return <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>;
}

// 1-1. 우리 회사 목소리(AI 메모리 브랜드 보이스, 설계서 docs/2026-10-28-ai-memory-brand-voice-design.md)

type Mk = string | [string];
const VOICE_SAMPLES: Mk[][] = [
  [['안녕하세요, 오후담이에요 ☕'], '\n\n이번 주는 바닐라 빈 라떼가 새로 나왔어요.\n달지 않고 고소해서 오후에 딱 좋아요.\n\n', ['오늘도 따뜻한 오후 보내세요\n오후담 드림']],
  [['안녕하세요, 오후담이에요 ☕'], '\n\n어제부터 날이 꽤 쌀쌀해졌죠.\n매장 창가 자리에 담요를 새로 놓아 두었어요.\n\n', ['지나가시는 길에 편하게 쉬었다 가세요\n오후담 드림']],
];
const VOICE_LEARNED: [string, string][] = [
  ['인사', '안녕하세요, 오후담이에요 ☕'],
  ['맺음말', '오후담 드림'],
  ['말투', '부드러운 해요체'],
  ['줄 바꿈', '두 문장마다 한 줄 띄움'],
  ['자주 쓰는 말', '따뜻한, 편하게'],
  ['길이', '짧은 문단 서너 개'],
];
const VOICE_PLAIN = '(광고)[오후담] 신메뉴 출시 안내! 군고구마 라떼가 출시되었습니다. 출시 기념 사이즈 업 이벤트를 진행하오니 많은 관심 부탁드립니다.';
const VOICE_OURS = `(광고)[오후담]
안녕하세요, 오후담이에요 ☕

다음 주 월요일부터 군고구마 라떼가 나와요.
직접 구운 고구마를 갈아 넣어서 진하고 고소해요.

첫 주에는 모든 사이즈를 한 단계 올려 드릴게요.
퇴근길에 따뜻하게 한 잔 챙겨 가세요

오후담 드림`;

function VoiceDemo() {
  const { ref, p, live } = useScene(6, 3000);
  return (
    <div className="x-app" ref={ref}>
      <div className="x-hd"><b>AI 메모리 우리 회사 목소리</b><span>오후담</span></div>
      <p className="x-cap">평소 보내던 문자</p>
      <div className="x-samples">
        {VOICE_SAMPLES.map((segs, i) => (
          <div key={i} className="x-msg">
            {segs.map((s, j) => (typeof s === 'string' ? <span key={j}>{s}</span> : <mark key={j} className={p >= 1 ? 'on' : ''}>{s[0]}</mark>))}
          </div>
        ))}
      </div>
      <div className={st(p, 2)}>
        <p className="x-cap">AI가 배운 것 <em className={p >= 3 ? 'on' : ''}><Check />담당자 확인</em></p>
        <div className="x-learn">{VOICE_LEARNED.map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}</div>
      </div>
      <div className={st(p, 4, 'x-in x-in-sm')}><SparkIcon /><span>다음 주 월요일부터 군고구마 라떼, 첫 주는 사이즈 업</span></div>
      <div className={st(p, 5, 'x-plain')}><small>흔한 AI 문안이라면</small>{VOICE_PLAIN}</div>
      <div className={st(p, 4, 'x-msg x-ours')}><small>우리 회사 목소리로</small><Typed text={VOICE_OURS} run={live && p === 4} speed={14} /></div>
    </div>
  );
}

// 2. AI 오퍼레이터(자동 마케팅)

const OP_GOAL = '한 달 넘게 방문이 없는 VIP 단골에게 재방문 안내';
const OP_MSG = `(광고)[오후담]
민지님, 요즘 오후담에 발길이 뜸하셔서 안부 여쭤요.
늘 앉으시던 창가 자리에 겨울 햇살이 참 좋게 들어요.

이번 겨울 시즌 메뉴로 메이플 크림 라떼와 군고구마 라떼가 새로 나왔어요. 오래 기다려 주신 VIP 단골 고객님께는 이번 주 방문하실 때 음료 사이즈 업을 해 드려요.

따뜻한 한 잔 하러 편하게 들러 주세요.`;
const OP_WEEK: [string, string, number][] = [
  ['19', '목', 14], ['20', '금', 9], ['21', '토', 12], ['22', '일', 11], ['23', '월', 8], ['24', '화', 16], ['25', '수', 13],
];

function OperatorDemo() {
  const { ref, p, live } = useScene(8, 2000);
  const total = OP_WEEK.reduce((s, d) => s + d[2], 0);
  return (
    <div className="x-app" ref={ref}>
      <div className="x-hd"><b>AI 오퍼레이터 자동 마케팅</b><span>오후담</span></div>
      <div className="x-in"><SparkIcon /><span><Typed text={OP_GOAL} run={live && p === 0} /></span></div>
      <div className={st(p, 1)}>
        <p className="x-cap">AI 제안서</p>
        <dl className="x-kv">
          <dt>받는 사람</dt><dd><b><Count to={96} run={live && p === 1} />명</b> VIP 등급, 최근 30일 방문 없음</dd>
          <dt>보내는 때</dt><dd>매일 오전 11시, 고객 반응이 높은 시각</dd>
          <dt>혜택</dt><dd>음료 사이즈 업, 대표님이 적은 그대로</dd>
        </dl>
      </div>
      <div className={st(p, 2, 'x-msg x-msg-sm')}>{OP_MSG}</div>
      <div className={st(p, 3, `x-approve${p >= 3 ? ' on' : ''}`)}>
        <span>{p >= 3 ? '승인했습니다, 내일부터 7일 동안 자동' : '7일 승인'}</span><b>{p >= 3 ? <Check /> : null}승인</b>
      </div>
      <div className={st(p, 4, `x-week${p >= 4 ? ' run' : ''}`)}>
        {OP_WEEK.map(([d, w, n], i) => (
          <div key={d} style={{ animationDelay: `${i * 0.22}s` }}><small>{w}</small><b>{d}</b><span>{n}명</span></div>
        ))}
      </div>
      <div className="x-stack x-foot">
        <div className={p === 6 ? 'on' : ''}><Check />스팸 점검 통과, 오늘 14명에게 보냈어요</div>
        <div className={p === 7 ? 'on' : ''}><Check />7일 동안 {total}명에게 보냈어요. 다음 7일도 이어서 할까요?</div>
      </div>
      <div className={`x-toast${p === 5 ? ' on' : ''}`}>
        <small>담당자 휴대폰 문자</small>
        [한줄로] 오늘 오전 11시에 VIP 재방문 안내가 나갑니다. 받는 분 14명, 보낼 문안과 발송 정보를 확인해 주세요.
      </div>
    </div>
  );
}

// 3. 스팸 점검

const CARRIERS = ['SKT', 'KT', 'LG U+'];
type Seg = string | [string, string];
const SPAM_MSG: Seg[] = [
  '(광고)[결온]\n지은님, ',
  ['★★초특급 파격 세일★★', '블랙프라이데이를 맞아'],
  ' 결온 수분 크림과 진정 토너를 30% 할인해 드려요.\n건조해지는 겨울, 매일 쓰는 기초부터 든든하게 채워 두세요.\n',
  ['지금 당장 클릭!! 놓치면 끝!!', '할인은 11월 30일까지, 결온 홈페이지에서 만나 보세요.'],
];

function SpamDemo() {
  const { ref, p } = useScene(7, 1700);
  const fixed = p >= 3;
  const state = (i: number) => (p === 1 || p === 4 ? 'run' : p === 2 || p === 3 ? (i === 2 ? 'bad' : 'ok') : p >= 5 ? 'ok' : 'idle');
  const label = { idle: '대기', run: '점검 중', ok: '정상 도착', bad: '스팸함 위험' } as const;
  return (
    <div className="x-app" ref={ref}>
      <div className="x-hd"><b>스팸 점검</b><span>보내기 전 자동</span></div>
      <div className="x-msg x-spam">
        {SPAM_MSG.map((s, i) => (typeof s === 'string'
          ? <span key={i}>{s}</span>
          : <span key={i}>{fixed ? <><s>{s[0]}</s> <mark>{s[1]}</mark></> : <span className={p === 2 ? 'x-hit' : ''}>{s[0]}</span>}</span>))}
      </div>
      <div className="x-car">
        {CARRIERS.map((c, i) => {
          const s = state(i);
          return <div key={c} data-s={s}><b>{c}</b>{s === 'run' ? <Spin /> : null}{label[s]}</div>;
        })}
      </div>
      <div className="x-stack x-foot">
        <div className={p === 2 ? 'on' : ''}>LG U+에서 스팸함으로 빠질 수 있는 표현을 찾았어요</div>
        <div className={p === 3 || p === 4 ? 'on' : ''}><SparkIcon />걸린 표현만 고쳐서 다시 점검합니다</div>
        <div className={p >= 5 ? 'on' : ''}><Check />세 통신사 모두 정상 도착, 이 문안으로 보냅니다</div>
      </div>
    </div>
  );
}

// 4. 여정 자동화

const JOURNEY: { t: string; s: string; tag: string; note: string; ch?: string; msg?: string; img?: string }[] = [
  { t: '신규 가입', s: '시작 사건', tag: '시작', note: '회원 가입이 확인되면 그 고객의 여정이 시작됩니다.' },
  { t: '환영 인사', s: '가입하면 바로', tag: 'LMS', ch: 'LMS', note: '가입한 고객에게 바로 환영 문자를 보냅니다.', msg: `[결온]
지은님, 결온 회원이 되신 걸 진심으로 환영해요.

결온은 예민한 피부도 매일 편하게 쓸 수 있는 순한 화장품을 만들어요. 처음 오신 분들께 가장 많이 사랑받은 제품은 수분 크림과 진정 토너예요.

피부 타입별 추천은 결온 홈페이지 첫 화면에서 바로 보실 수 있어요.` },
  { t: '3일 기다림', s: '그사이 구매하면 여기서 마침', tag: '기다림', note: '3일 동안 기다린 뒤 아직 구매하지 않은 고객만 다음 단계로 넘어갑니다.' },
  { t: '첫 구매 했나요?', s: '조건', tag: '조건', note: '이미 구매한 고객은 목표를 이뤘으니 여기서 여정을 마칩니다.' },
  { t: '첫 구매 쿠폰', s: '아직 사지 않은 고객만', tag: 'MMS', ch: 'MMS', note: '아직 사지 않은 고객에게만 첫 구매 쿠폰을 보냅니다.', img: 'n2-kyeolon-niche.jpg', msg: `(광고)[결온]
지은님, 결온과 첫인사를 나눈 지 사흘이 지났어요.
아직 고민 중이시라면 첫 구매에만 쓸 수 있는 15% 쿠폰을 받아 보세요.

쿠폰은 오늘부터 7일 동안 쓸 수 있고, 첫 주문에는 수분 크림 미니 사이즈를 함께 보내 드려요.

지은님 피부에 꼭 맞는 첫 제품을 찾으시길 바랄게요.` },
  { t: '첫 구매 확인', s: '목표 달성', tag: '마침', note: '첫 구매가 확인되면 목표 달성, 그 고객은 여정을 마칩니다.' },
];

function JourneyDemo() {
  const { ref, p } = useScene(JOURNEY.length, 2100);
  // 미리보기 = 지금 단계까지 마지막으로 보낸 문자(아직 없으면 비워 둠)
  const sentAt = JOURNEY.reduce((k, n, i) => (n.msg && i <= p ? i : k), -1);
  return (
    <div className="x-app" ref={ref}>
      <div className="x-hd"><b>새로 가입한 고객 여정</b><span>켜져 있음</span></div>
      <div className="x-flow">
        {JOURNEY.map((n, i) => (
          <div key={n.t} className={i === p ? 'now' : i < p ? 'past' : ''}>
            <i>{i + 1}</i><div><b>{n.t}</b><small>{n.s}</small></div><em>{n.tag}</em>
          </div>
        ))}
      </div>
      <div className="x-stack x-jnote">
        {JOURNEY.map((n, i) => <div key={n.t} className={i === p ? 'on' : ''}>{n.note}</div>)}
      </div>
      <div className="x-stack x-jmsg">
        {JOURNEY.map((n, i) => (n.msg
          ? <div key={n.t} className={i === sentAt ? 'on' : ''}><div className={`x-msg${n.img ? ' x-mms' : ''}`}>{n.img ? <span className="im" style={bg(n.img)} /> : null}<span><small>{n.ch} 보낸 문자</small>{n.msg}</span></div></div>
          : null))}
      </div>
      <div className="x-tags"><span>지금 이 여정에 128명</span><span>대조군 10%</span><span>단계마다 보내기 전 스팸 점검</span></div>
    </div>
  );
}

// 5. 마케팅 플래너

const PLAN_EVENTS: [number, string, string][] = [
  [4, '홀리데이 케이크 사전 예약', '문자, 모바일 DM, 이메일'],
  [18, '크리스마스 주말 이벤트', '문자, 모바일 DM'],
  [28, '연말 감사 쿠폰', '문자'],
];

function PlannerDemo() {
  const { ref, p } = useScene(7, 1800);
  const shown = (day: number) => PLAN_EVENTS.findIndex((e) => e[0] === day);
  const cells = [null, null, ...Array.from({ length: 31 }, (_, i) => i + 1), null, null];   // 2026년 12월 1일 = 화요일
  return (
    <div className="x-app" ref={ref}>
      <div className="x-hd"><b>12월 마케팅 플래너</b><span>오후담</span></div>
      <div className="x-cal">
        {['일', '월', '화', '수', '목', '금', '토'].map((w) => <small key={w}>{w}</small>)}
        {cells.map((d, i) => {
          const e = d === null ? -1 : shown(d);
          return <div key={i} className={e >= 0 && p >= e + 1 ? 'ev' : ''}>{d ?? ''}{e >= 0 ? <em>{PLAN_EVENTS[e][1]}</em> : null}</div>;
        })}
      </div>
      <div className="x-evs">
        {PLAN_EVENTS.map(([d, t, ch], i) => (
          <div key={d} className={st(p, i + 1)}><b>12월 {d}일</b><span>{t}</span><small>{ch}</small></div>
        ))}
      </div>
      <div className="x-stack x-plan">
        <div className={p < 4 ? 'on' : ''}><div className="x-note">행사를 담으면 AI가 채널마다 완성본을 만듭니다</div></div>
        <div className={p === 4 ? 'on' : ''}>
          <div className="x-made">
            <div><small>문자</small><b>스팸 점검 통과</b><span>(광고)[오후담] 올해도 홀리데이 케이크 사전 예약을 시작해요. 딸기 생크림과 초콜릿 두 가지, 12월 10일까지 예약하시면 원하시는 날 매장에서 바로 찾아가실 수 있어요.</span></div>
            <div><small>모바일 DM</small><span className="im" style={bg('n5-event-gallery.jpg')} /></div>
            <div><small>이메일</small><b>제목</b><span>올해의 홀리데이 케이크, 먼저 보여 드려요</span></div>
          </div>
        </div>
        <div className={p >= 5 ? 'on' : ''}>
          <div className="x-sms">
            <small>12월 1일 담당자 휴대폰</small>
            [한줄로] 12월 4일 홀리데이 케이크 사전 예약 안내 완성본이 준비됐어요. 문자, 모바일 DM, 이메일 실물과 받는 사람 수를 확인하고 승인해 주세요.
            <b className={p >= 6 ? 'yes' : ''}>{p >= 6 ? <><Check />승인됨, 12월 4일에 나갑니다</> : '확인하고 승인'}</b>
          </div>
        </div>
      </div>
    </div>
  );
}

// 6. 모바일 DM과 이메일

function DmDemo() {
  const { ref, p, live } = useScene(4, 2200);
  return (
    <div className="x-dm" ref={ref}>
      <div className="phone x-phone">
        <span className="nt" />
        <div className="scr">
          <div className={`x-page s${p}`}>
            <div className="im x-hero" style={bg('n3-ohudam-windowbar.jpg')} />
            <div className="x-pg">
              <b>오후담 겨울 시즌 메뉴</b>
              <p>메이플 크림 라떼와 군고구마 라떼가 새로 나왔어요. 창가 자리에서 겨울 햇살과 함께 천천히 즐겨 보세요.</p>
              <span className={`x-btn${p === 2 ? ' tap' : ''}`}>사이즈 업 쿠폰 받기</span>
              <div className="x-evt"><small>참여 이벤트</small>새 메뉴 이름 맞히고 케이크 한 조각 받기</div>
              <span className="x-btn ln">매장 위치 보기</span>
            </div>
          </div>
        </div>
      </div>
      <div className="x-side">
        <div className="x-app x-mini">
          <div className="x-hd"><b>모바일 DM 성과</b><span>보낸 지 3일</span></div>
          <div className="x-nums">
            <div><small>받은 사람</small><b><Count to={1240} run={live && p === 1} /></b></div>
            <div><small>열어 본 사람</small><b><Count to={612} run={live && p === 1} /></b></div>
            <div><small>쿠폰 받음</small><b><Count to={187} run={live && p === 2} /></b></div>
          </div>
          <div className="x-who">
            <div><b>김*은</b><span>열어 봄, 쿠폰 받음</span></div>
            <div><b>박*준</b><span>열어 봄, 이벤트 참여</span></div>
            <div><b>이*희</b><span>아직 안 열어 봄</span></div>
          </div>
        </div>
        <div className={st(p, 3, 'x-app x-mini')}>
          <div className="x-hd"><b>이메일</b><span>회사 메일로 발송</span></div>
          <p className="x-subj">올겨울 오후담 시즌 메뉴, 단골손님께 먼저 보여 드려요</p>
          <div className="x-nums two">
            <div><small>열어 본 비율</small><b>38%</b></div>
            <div><small>많이 누른 링크</small><b>시즌 메뉴 보기</b></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 7. 이미지 스튜디오

const POSTERS: [string, string][] = [
  ['n3-ohudam-windowbar.jpg', '카페 시즌 메뉴 포스터'],
  ['n2-kyeolon-niche.jpg', '화장품 한정 상품 포스터'],
  ['n1-kyeolon-monoshadow.jpg', '화장품 신상품 포스터'],
  ['n5-event-gallery.jpg', '매장 오픈 행사 포스터'],
];

function StudioDemo() {
  const { ref, p } = useScene(4, 1800);
  return (
    <div className="x-studio" ref={ref}>
      <div className="x-chips3">{['템플릿 고르기', '사진과 문구 넣기', '완성'].map((t, i) => <span key={t} className={i === Math.min(p, 2) ? 'on' : ''}>{t}</span>)}</div>
      <div className="pg">
        {POSTERS.map(([f, label], i) => <div key={f} className={`im${i === p ? ' x-pick' : ''}`} style={bg(f)} role="img" aria-label={label} />)}
      </div>
    </div>
  );
}

// 8. 데이터 연결

const SOURCES = ['카페24', '네이버 스마트스토어', '메이크샵', '고도몰', '자체 쇼핑몰', '싱크에이전트', '엑셀'];
const DB_ROWS: [string, string, string, string, number][] = [
  ['김*연', 'VIP', '11.16 니트 구매', '카페24', 0],
  ['박*준', '일반', '11.15 첫 구매', '네이버 스마트스토어', 1],
  ['이*희', 'VIP', '11.14 매장 구매', '싱크에이전트', 5],
  ['최*우', '신규', '11.13 회원 가입', '엑셀', 6],
];

function DataDemo() {
  const { ref, p, live } = useScene(6, 1600);
  const active = p >= 1 && p <= 4 ? DB_ROWS[p - 1][4] : -1;
  return (
    <div className="x-app" ref={ref}>
      <div className="x-hd"><b>연결된 데이터</b><span>정해 둔 주기마다 자동</span></div>
      <div className="x-srcs">{SOURCES.map((s, i) => <span key={s} className={i === active ? 'on' : ''}>{s}</span>)}</div>
      <div className={`x-pipe${live ? ' run' : ''}`}><i /><i /><i /></div>
      <div className="x-db">
        <p className="x-cap">한줄로 고객 DB</p>
        {DB_ROWS.map(([n, g, a, s], i) => (
          <div key={n} className={st(p, i + 1)}><b>{n}</b><em>{g}</em><span>{a}</span><small>{s}</small></div>
        ))}
      </div>
      <div className={st(p, 5, 'x-done')}><span><Check />고객 이력, 여정, 인앱 메시지에 바로 씁니다</span></div>
    </div>
  );
}

// 9. 성과 리포트와 AI 메모리

const REPORT_AI = '이번 달은 화요일 오전 11시에 보낸 문자의 반응이 가장 좋았어요. 6개월 넘게 오지 않은 고객이 233명으로 늘고 있어, 재방문 쿠폰 캠페인을 1순위로 권해요.';
const WEEKS: [string, number][] = [['1주', 42], ['2주', 58], ['3주', 51], ['4주', 76]];

function ReportDemo() {
  const { ref, p, live } = useScene(5, 2600);
  return (
    <div className="x-app" ref={ref}>
      <div className="x-hd"><b>성과 리포트</b><span>최근 30일</span></div>
      <div className="x-nums">
        <div><small>보낸 캠페인</small><b><Count to={18} run={live && p === 0} />건</b></div>
        <div><small>발송 뒤 7일 구매</small><b><Count to={214} run={live && p === 0} />건</b></div>
        <div><small>귀속 매출</small><b><Count to={1860} run={live && p === 0} />만원</b></div>
      </div>
      <div className={`x-bars${p >= 1 ? ' up' : ''}`}>
        {WEEKS.map(([w, v]) => <div key={w}><span style={{ height: `${v}%` }} /><small>{w}</small></div>)}
      </div>
      <div className={st(p, 2, 'x-ai')}><i>AI</i><p><Typed text={REPORT_AI} run={live && p === 2} speed={22} /></p></div>
      <div className={st(p, 3, 'x-reco')}>
        <div><small>추천 캠페인</small><b>휴면 고객 재방문 쿠폰</b><span>받는 사람 233명, 화요일 오전 11시</span></div>
        <em>이 제안대로 설계</em>
      </div>
      <div className={st(p, 4, 'x-mem')}>
        <p className="x-cap">AI 메모리가 배운 우리 회사</p>
        <span>안부 인사로 시작하는 문안에 더 반응해요</span>
        <span>할인보다 증정 혜택의 반응이 높아요</span>
        <span>VIP 고객은 평일 오전에 가장 많이 열어 봐요</span>
      </div>
    </div>
  );
}

// 전체 기능 한눈에(공개 소개 페이지 /intro 목록 + 기본 기능)

const ALL_FEATURES: [string, [string, string][]][] = [
  ['보내기', [
    ['알림톡과 브랜드메시지', '카카오톡으로 안내와 홍보를'],
    ['문자', 'SMS, LMS, MMS 모두'],
    ['모바일 DM', '한 줄로 카드형 DM, 열람까지 추적'],
    ['이메일 마케팅', 'AI 비주얼 이메일, 열고 누른 것까지 확인'],
    ['인앱 메시지', '자사몰에 들어온 그 순간에'],
  ]],
  ['AI 자동화', [
    ['AI 한줄로', '한 줄만 적으면 문안과 받을 사람까지'],
    ['자동 마케팅', '한 번 승인하면 7일 동안 매일 알아서'],
    ['여정 설계', '가입부터 재구매까지, 고객마다 순서대로'],
    ['마케팅 플래너', '달력에 행사만 담으면 완성본까지'],
  ]],
  ['만들기와 점검', [
    ['만들기', '재료만 넣으면 DM과 이메일 완성'],
    ['이미지 스튜디오', '템플릿 고르고 문구만 쓰면 포스터'],
    ['AI 문안 다듬기', '직접 쓴 문안의 톤과 길이를 정리'],
    ['스팸 점검', '통신사 3사 정상 도착을 보내기 전에'],
  ]],
  ['고객과 데이터', [
    ['고객 DB', '쓰던 엑셀 그대로, 항목은 AI가 맞춤'],
    ['자사몰 연동', '카페24, 네이버 스마트스토어 등 자동 연동'],
    ['싱크에이전트', '회사 서버의 고객 DB를 그대로'],
    ['성과 리포트', '30일 성과와 다음 할 일'],
    ['AI 메모리', '우리 회사 목소리를 배워 그대로 씀'],
  ]],
];

export function JbnFeatures() {
  return (
    <div id="feat">
      <section className="sec x-intro">
        <div className="w">
          <p className="lbl">한줄로가 하는 일</p>
          <h2 className="h2">대표님은 한 줄만 적으세요,<br />반복되는 일은 한줄로가 합니다</h2>
          <p className="lead">AI가 우리 회사가 평소 보내던 문자를 읽고 그 목소리 그대로 씁니다. 문안 쓰기, 받을 사람 고르기, 스팸 점검, 매일 보내기까지 한줄로가 맡고, 무엇을 보낼지는 언제나 대표님이 정합니다. 아래 화면은 실제 기능이 움직이는 순서 그대로입니다.</p>
        </div>
      </section>

      <Feature
        q="AI 한줄로"
        title={<>한 줄만 적으세요,<br />문안과 받을 사람은 AI가</>}
        desc="보낼 내용을 한 줄로 적으면 AI가 읽고 문안에 꼭 필요한데 빠진 것만 묻습니다. 받을 고객을 실제 발송과 같은 계산으로 세고, 고른 종류대로 문안을 써 드립니다."
        demo={<LineDemo />}
      >
        <Steps items={[
          ['한 줄 적기', '받을 사람과 혜택을 평소 말하듯 한 줄로 적습니다. 이미 적은 내용은 다시 묻지 않습니다.'],
          ['빠진 것만 답하기', '쿠폰 기한처럼 문안에 꼭 필요한데 빠진 것만 AI가 묻습니다.'],
          ['받는 사람 확인', '수신 동의한 고객만, 실제 발송과 같은 조건으로 셉니다.'],
          ['문안 고르고 보내기', '감성형, 혜택강조형, MZ 감성형 중에서 골라 바로 보내거나 예약합니다.'],
        ]} />
        <Ticks items={[
          '고객 이름과 등급을 넣으면 실제 고객 값으로 바뀐 모습을 미리 봅니다',
          '우리 회사가 평소 보내던 말투 그대로 씁니다',
          '알림톡이라고 적으면 승인된 알림톡 템플릿으로, 아니면 문자로 보냅니다',
        ]} />
        <p className="x-key">할인과 쿠폰은 대표님이 적은 내용만 씁니다. AI가 혜택을 지어내지 않습니다.</p>
      </Feature>

      <Feature
        rev
        q="우리 회사 목소리"
        title={<>AI가 우리 회사 목소리를 듣고,<br />우리 회사 목소리로 씁니다</>}
        desc="평소 보내던 문자를 올리거나 보낸 문자 중에서 고른 뒤 배우기를 누르면, AI가 말투와 인사, 맺음말, 줄 바꿈, 자주 쓰는 표현, 특수문자까지 배웁니다. 그다음부터는 행사와 제품만 알려 주셔도 원래 보내던 그 말투로 문안이 나옵니다."
        demo={<VoiceDemo />}
      >
        <Ticks items={[
          'AI 한줄로, 자동 마케팅, 여정, 모바일 DM, 이메일까지 모든 자동 문안이 같은 목소리로 나옵니다',
          '행사 안내와 안부 인사처럼 문자 성격에 따라 말투를 나눠 배웁니다',
          '배운 내용은 담당자가 확인한 것만 씁니다',
          '문안을 고쳐 보내면 줄 바꿈과 기호, 끝맺는 말투까지 고친 대로 배웁니다',
          '(광고) 표기와 수신거부처럼 법이 정한 것은 목소리보다 먼저 지킵니다',
        ]} />
        <p className="x-key">AI가 쓴 티 나는 문자가 아니라, 대표님이 직접 쓴 것 같은 문자가 나갑니다.</p>
      </Feature>

      <Feature
        q="AI 오퍼레이터"
        title={<>목표만 정해 두면<br />매일 알아서 보냅니다</>}
        desc="목표를 한 줄로 적거나 준비된 시나리오를 고르면 AI가 회차마다 받을 고객과 문안, 보낼 시각을 정해 제안합니다. 대표님이 한 번 승인하면 7일 동안 정해진 시각에 알아서 나갑니다."
        demo={<OperatorDemo />}
      >
        <Steps items={[
          ['목표 정하기', 'VIP 재구매, 휴면 회복, 생일 축하, 포인트 사용 유도처럼 준비된 시나리오 9가지 중에서 고르거나 한 줄로 적습니다.'],
          ['첫 제안 미리 보기', '시작하기 전에 받을 고객 수, 문안, 발송 일정을 먼저 봅니다.'],
          ['7일 승인', '승인하면 다음 회차부터 7일 동안 정해진 시각에 나갑니다.'],
          ['요약 받고 이어 가기', '기간이 끝나기 하루 전에 지난 회차 요약과 다음 승인 안내를 문자로 받습니다.'],
        ]} />
        <Ticks items={[
          '회차마다 보내기 전에 실제 문안과 발송 정보를 담당자 휴대폰으로 알려 드립니다',
          '보낼 시각은 고객 반응이 높은 시간대로 AI에게 맡길 수 있습니다',
          '월 예산과 하루 한도를 정해 두면 넘지 않습니다',
          '1차 문자에 반응하지 않은 고객에게만 한 번 더 보낼 수 있습니다',
        ]} />
        <p className="x-key">보내는 결정은 언제나 사람이 합니다. AI는 제안하고, 승인은 대표님이 합니다.</p>
      </Feature>

      <Feature
        rev
        q="스팸 점검"
        title={<>스팸 메시지함으로 빠질 걱정,<br />보내기 전에 끝냅니다</>}
        desc="공들여 쓴 문자도 고객 휴대폰의 스팸 메시지함으로 들어가면 아무도 보지 않습니다. 한줄로는 자체 개발한 점검 기술로 SKT, KT, LG U+ 세 통신사에서 실제로 정상 도착하는지 보내기 전에 확인합니다."
        demo={<SpamDemo />}
      >
        <Ticks items={[
          '실제로 나갈 문자 그대로 점검합니다. 발신번호, 제목, 고객 이름이 들어간 글까지',
          '걸린 표현을 찾으면 고쳐서 다시 점검합니다',
          '자동 마케팅과 여정은 통과한 문안만 보내고, 통과하지 못하면 멈춘 뒤 담당자에게 알립니다',
          'AI 한줄로로 만든 문안에는 점검 결과가 자동으로 붙습니다',
          '광고 문자는 (광고) 표기와 무료수신거부를 자동으로 붙이고, 광고를 보낼 수 없는 야간에는 보내지 않습니다',
        ]} />
      </Feature>

      <Feature
        q="여정 자동화"
        title={<>가입부터 재구매까지,<br />고객마다 순서대로</>}
        desc="가입, 첫 구매, 생일, 장바구니 이탈처럼 고객에게 일이 생기면 정해 둔 순서대로 메시지가 나갑니다. 단계는 AI가 짜 주고, 고칠 점을 말로 적으면 그대로 고쳐 줍니다."
        demo={<JourneyDemo />}
      >
        <div className="chips">
          {['신규 가입', '첫 구매', '재구매', '휴면', '생일', '등급 상승', '포인트 소멸', '장바구니 이탈', '조회 후 미구매'].map((c) => <span key={c}>{c}</span>)}
        </div>
        <Ticks items={[
          '목표를 이루면 그 고객은 여정을 마칩니다',
          '단계마다 문자 종류와 기다릴 기간을 정합니다',
          '고객이 반응했던 시간대에 맞춰 보냅니다',
          '일부 고객을 남겨 두고 보낸 고객과 결과를 비교합니다',
        ]} />
      </Feature>

      <Feature
        rev
        q="마케팅 플래너"
        title={<>한 달 행사를 달력에 담으면<br />완성본까지</>}
        desc="행사 이름과 기간, 혜택, 보낼 채널과 날짜만 달력에 넣으세요. AI가 문자와 모바일 DM, 이메일 완성본을 만들고 문자는 스팸 점검까지 미리 해 둡니다."
        demo={<PlannerDemo />}
      >
        <Ticks items={[
          '사진과 글, 연동한 쇼핑몰 상품을 넣으면 재료로 씁니다',
          '첫 발송 3일 전 담당자 휴대폰으로 확인 링크가 갑니다',
          '행사마다 한 번만 승인하면 예정일에 그대로 나갑니다',
        ]} />
      </Feature>

      <Feature
        q="모바일 DM과 이메일"
        title={<>사진과 버튼이 담긴 메시지,<br />누가 봤는지까지</>}
        desc="사진과 글, 홈페이지 주소 중 가진 것만 넣으면 AI가 모바일 DM과 이메일 완성본을 만듭니다. 문자 링크로 열리는 모바일 페이지에 사진, 버튼, 참여 이벤트를 담을 수 있습니다."
        demo={<DmDemo />}
      >
        <Ticks items={[
          '누가 열어 보고 무엇을 눌렀는지 받은 사람별로 봅니다',
          '이메일은 회사 메일로 보내고, 안 연 사람에게만 한 번 더 보낼 수 있습니다',
          '자사몰에서는 장바구니에 담았을 때, 나가려 할 때 같은 순간에 인앱 메시지를 띄웁니다',
        ]} />
      </Feature>

      <Feature
        rev
        q="이미지 스튜디오"
        title={<>포스터는<br />문구만 쓰면 완성</>}
        desc="업종별 템플릿을 고르고 상품 사진과 문구만 넣으면 포스터가 나옵니다. 옆의 그림은 모두 이미지 스튜디오로 만든 실제 결과물입니다."
        demo={<StudioDemo />}
      >
        <Ticks items={[
          '제품 사진을 올리면 배경을 자동으로 지웁니다',
          '바꾸고 싶은 점을 말로 적으면 AI가 고칩니다',
          '만든 포스터는 모바일 DM, 이메일, MMS에 바로 씁니다',
        ]} />
      </Feature>

      <Feature
        q="데이터 연결"
        title={<>쓰던 쇼핑몰과 회사 DB,<br />그대로 이어 붙입니다</>}
        desc="카페24, 메이크샵, 고도몰은 연결 한 번이면 회원과 주문이, 네이버 스마트스토어는 주문과 구매 고객이 알아서 들어옵니다. 회사 서버에 고객 DB가 따로 있으면 싱크에이전트를 설치해 그대로 가져옵니다."
        demo={<DataDemo />}
      >
        <Ticks items={[
          '싱크에이전트는 Oracle, MS SQL, MySQL, PostgreSQL을 읽고 정해 둔 주기마다 맞춥니다',
          '쓰던 엑셀을 올리면 이름, 번호, 등급 같은 항목을 AI가 맞춥니다',
          '고객 정보를 다시 입력할 일이 없습니다',
        ]} />
      </Feature>

      <Feature
        rev
        q="성과 리포트와 AI 메모리"
        title={<>보낼수록<br />더 잘 보내게 됩니다</>}
        desc="최근 30일 발송 성과를 한눈에 보고, AI가 원인을 진단해 다음에 할 캠페인을 설계해 줍니다. AI 메모리는 우리 회사에 대해 배운 것을 쌓아 다음 문안과 제안에 씁니다."
        demo={<ReportDemo />}
      >
        <Ticks items={[
          '구매 데이터가 들어와 있으면 발송 뒤 7일 구매와 매출까지 봅니다',
          '추천 카드를 누르면 그 제안대로 캠페인이 설계되고, 검토한 뒤 보냅니다',
          'AI가 꼭 알아야 할 사실은 직접 가르칠 수 있습니다',
        ]} />
      </Feature>

      <section className="sec">
        <div className="w">
          <p className="lbl">한줄로 전체 기능</p>
          <h2 className="h2">마케팅에 필요한 것,<br />한줄로 안에 다 있습니다</h2>
          <div className="allg">
            {ALL_FEATURES.map(([group, items]) => (
              <section key={group}>
                <h3>{group}</h3>
                <ul>{items.map(([name, line]) => <li key={name}><b>{name}</b><span>{line}</span></li>)}</ul>
              </section>
            ))}
          </div>
          <p className="safe"><Check />수신 동의한 고객에게만, 스팸 점검을 거쳐, 광고 규정에 맞게 보냅니다</p>
        </div>
      </section>
    </div>
  );
}
