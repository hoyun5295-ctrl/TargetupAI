/**
 * proposal-page.ts — 제안 페이지(/proposal)의 소개 글 · CSS(로그인 뒤에만 내려준다)
 *   ★ 2026-11-16 C136 배포 나(설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §3-3).
 *
 * 승인된 목업(docs/mockups/2026-11-16-c136-proposal-mockup.html · 목업 Codex 2R approve)에서 **스크립트로 떼어 온 것**이다(손으로 다시 치지 않았다).
 *   소개 구역(기능 넷 · 그대로인 것)은 어제까지 공개 폴더에 있던 V3 페이지(public/about-v3.html)의 CSS · 마크업 그대로다.
 * 옮기며 바꾼 것 = 선택자 앞 .ppg(앱의 다른 화면을 건드리지 않는다) · 그림 자리 = gated:파일이름 · 아이콘 id 앞 ppg- ·
 *   요금제 금액 자리 = {{agencyPrice}}(서버가 요금제 표에서 읽어 넣는다 · 못 읽으면 빈 글자).
 * 이 CSS 는 화면이 그리는 구역(신청 폼 · 진행 · 완성본)의 모양도 함께 든다(화면 코드에는 class 이름만 있다).
 * ⛔ 이 파일의 글 · 그림을 프론트 저장소(packages/frontend/src · public)에 다시 두지 않는다(계약 시험 c136-gated-content).
 * 글꼴 = 프리텐다드 하나. 색 = 흰 바탕 + 검정 + 주황 하나.
 */
export const PROPOSAL_PAGE_CSS = `.ppg{--ink:#0B0B0C;--sub:#5F6368;--mute:#6B6B70;--line:#E8E8E6;--soft:#F4F3EF;--acc:#CF4510;--acc-d:#B53C0D;--acc-t:#B53C0D}
.ppg *{box-sizing:border-box;margin:0;padding:0}
.ppg{min-height:100vh;font-family:'Pretendard Variable',Pretendard,system-ui,sans-serif;background:#fff;color:var(--ink);-webkit-font-smoothing:antialiased;word-break:keep-all}
.ppg a{color:inherit;text-decoration:none}
.ppg .ic{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
.ppg .w{max-width:1200px;margin:0 auto;padding:0 32px}
.ppg .im{background-size:cover;background-position:center;background-color:#E9E6DF}
.ppg .btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;height:58px;padding:0 28px;border-radius:14px;font-weight:800;font-size:17px;transition:background .2s,transform .2s}
.ppg .btn:hover{transform:translateY(-1px)}
.ppg .btn.or{background:var(--acc);color:#fff}
.ppg .btn.or:hover{background:var(--acc-d)}
.ppg .btn.ln{box-shadow:inset 0 0 0 1.5px var(--ink)}
.ppg .btn.ln:hover{background:var(--soft)}
.ppg .btn.wh{background:#fff;color:var(--ink)}
.ppg .btn.sm{height:44px;padding:0 18px;border-radius:12px;font-size:15px}
.ppg .nav{display:flex;align-items:center;gap:6px;padding:22px 0}
.ppg .nav .logo{font-weight:900;font-size:22px;letter-spacing:-.04em;display:flex;align-items:baseline;gap:7px}
.ppg .nav .logo i{font-style:normal;font-size:14px;font-weight:800;color:var(--acc-t);letter-spacing:0}
.ppg .nav .sp{flex:1}
.ppg .nav a.t{font-size:15px;font-weight:600;color:var(--sub);padding:10px 14px}
.ppg .nav a.t:hover{color:var(--ink)}
.ppg .hero{display:grid;grid-template-columns:1.06fr 1fr;gap:56px;align-items:center;padding:36px 0 96px}
.ppg .hero h1{font-size:clamp(40px,5.6vw,76px);font-weight:900;line-height:1.1;letter-spacing:-.045em}
.ppg .hero h1 em{font-style:normal;color:var(--acc)}
.ppg .hero .sub{margin-top:26px;font-size:clamp(17px,1.5vw,20px);line-height:1.68;color:var(--sub);max-width:27em}
.ppg .hero .cta{margin-top:36px;display:flex;gap:12px;flex-wrap:wrap}
.ppg .hv{position:relative;aspect-ratio:1/1.04;background:var(--soft);border-radius:36px;overflow:hidden}
.ppg .hv .ps{position:absolute;left:7%;top:8%;width:52%;aspect-ratio:3/4;border-radius:18px;box-shadow:0 30px 60px -34px rgba(0,0,0,.5)}
.ppg .hv .ph{position:absolute;right:7%;top:17%;width:31%}
.ppg .src{display:flex;align-items:center;gap:11px;background:#fff;border-radius:16px;padding:8px 16px 8px 8px;box-shadow:0 14px 34px -18px rgba(0,0,0,.5);font-size:13.5px;font-weight:700;line-height:1.35}
.ppg .src .im{width:54px;height:54px;border-radius:10px;flex-shrink:0}
.ppg .src small{display:block;font-size:12px;font-weight:600;color:var(--sub)}
.ppg .hv .src{position:absolute;left:7%;bottom:6%}
.ppg .phone{aspect-ratio:262/528;border-radius:16% / 8%;background:#0B0B0C;padding:3.8%;position:relative;box-shadow:0 34px 70px -30px rgba(0,0,0,.55);container-type:inline-size}
.ppg .phone .scr{height:100%;border-radius:13.5% / 6.6%;background:#F2F2F4;overflow:hidden;display:flex;flex-direction:column}
.ppg .phone .nt{position:absolute;left:50%;top:3.6%;width:30%;height:4.2%;border-radius:99px;background:#0B0B0C;transform:translateX(-50%)}
.ppg .phone .bar0{padding:16cqi 5cqi 4cqi;text-align:center;background:#fff;border-bottom:1px solid #E6E6E8;font-size:4.4cqi;color:#5F6368}
.ppg .phone .bar0 b{display:block;font-size:5.4cqi;color:#0B0B0C}
.ppg .phone .th{flex:1;padding:4cqi 4.6cqi 5cqi;display:flex;flex-direction:column;justify-content:flex-end}
.ppg .bub{background:#E6E6EA;border-radius:8cqi 8cqi 8cqi 2.4cqi;padding:3cqi;width:88%;font-size:4.4cqi;line-height:1.5}
.ppg .bub .im{aspect-ratio:3/4;border-radius:5.4cqi;margin-bottom:2.6cqi}
.ppg .bub p{padding:0 1.4cqi 1cqi}
.ppg .gal{padding:0 0 112px}
.ppg .gal .row{display:grid;grid-template-columns:repeat(5,1fr);gap:18px}
.ppg .gal .im{aspect-ratio:3/4;border-radius:16px;transition:transform .35s cubic-bezier(.2,.8,.2,1)}
.ppg .gal .im:hover{transform:translateY(-8px)}
.ppg .gal p{margin-top:22px;font-size:16px;color:var(--sub);text-align:center}
.ppg .sec{padding:112px 0}
.ppg .sec.sf{background:var(--soft)}
.ppg .lbl{font-size:15px;font-weight:800;color:var(--acc-t)}
.ppg .h2{font-size:clamp(30px,4.2vw,56px);font-weight:900;line-height:1.14;letter-spacing:-.045em;margin-top:12px}
.ppg .h2 em{font-style:normal;color:var(--acc-t)}
.ppg .dt{margin-top:48px;border-top:2px solid var(--ink)}
.ppg .dh,.ppg .dr{display:grid;grid-template-columns:120px 1fr 1.3fr;gap:28px;align-items:center}
.ppg .dh{padding:14px 0;font-size:13.5px;font-weight:800;color:var(--mute)}
.ppg .dh span:last-child{color:var(--ink)}
.ppg .dr{padding:26px 0;border-top:1px solid #DEDDD8}
.ppg .dr time{font-size:26px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.ppg .dr .was{font-size:18px;color:var(--mute);text-decoration:line-through;text-decoration-thickness:1.5px}
.ppg .dr .now{font-size:clamp(20px,2.3vw,29px);font-weight:800;letter-spacing:-.035em}
.ppg .dr .now em{font-style:normal;color:var(--acc-t)}
.ppg .ft{padding:104px 0 0}
.ppg .ft:last-of-type{padding-bottom:112px}
.ppg .fg{display:grid;grid-template-columns:1fr 1fr;gap:72px;align-items:center}
.ppg .ft:nth-of-type(even) .fg .pn{order:-1}
.ppg .ft .q{margin-top:10px;font-size:18px;font-weight:600;color:var(--sub)}
.ppg .ft h3{font-size:clamp(30px,3.6vw,48px);font-weight:900;line-height:1.16;letter-spacing:-.045em;margin-top:14px}
.ppg .ft .d{margin-top:20px;font-size:18px;line-height:1.72;color:var(--sub);max-width:29em}
.ppg .ft ul{list-style:none;margin-top:24px;display:grid;gap:12px}
.ppg .ft li{display:flex;gap:12px;align-items:flex-start;font-size:17px;font-weight:600;line-height:1.5}
.ppg .ft li .ic{width:22px;height:22px;padding:4px;border-radius:50%;background:var(--ink);color:#fff;stroke-width:3;margin-top:2px}
.ppg .ft .nt{margin-top:22px;font-size:14.5px;color:var(--sub)}
.ppg .pn{background:var(--soft);border-radius:32px;min-height:470px;display:grid;place-items:center;padding:44px}
.ppg .ui{width:100%;max-width:400px;background:#fff;border-radius:22px;padding:22px 22px 20px;box-shadow:0 30px 60px -38px rgba(0,0,0,.4);font-size:14.5px}
.ppg .ui .uh{font-size:15.5px;font-weight:800;display:flex;justify-content:space-between;align-items:baseline}
.ppg .ui .uh small{font-size:12px;font-weight:600;color:var(--mute)}
.ppg .r{display:grid;grid-template-columns:46px 1fr auto;gap:12px;align-items:center;padding:12px 0;border-top:1px solid var(--line)}
.ppg .ui .uh+.r,.ppg .ui .uh+.j,.ppg .ui .uh+.sr{margin-top:12px}
.ppg .r .im{width:46px;height:46px;border-radius:10px}
.ppg .r b{display:block;font-size:14.5px;font-weight:700}
.ppg .r span{font-size:13px;color:var(--sub)}
.ppg .r em{font-style:normal;font-weight:800;font-size:14.5px}
.ppg .ubtn{margin-top:14px;height:48px;border-radius:12px;background:var(--ink);color:#fff;font-weight:700;font-size:14.5px;display:flex;align-items:center;justify-content:center;gap:8px}
.ppg .j{display:flex;align-items:center;gap:12px;padding:14px 0;border-top:1px solid var(--line)}
.ppg .j b{flex:1;font-size:14.5px;font-weight:700}
.ppg .j span{font-size:13px;color:var(--sub)}
.ppg .tg{width:38px;height:22px;border-radius:99px;background:var(--ink);position:relative;flex-shrink:0}
.ppg .tg::after{content:"";position:absolute;top:3px;right:3px;width:16px;height:16px;border-radius:50%;background:#fff}
.ppg .est{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;border-top:1px solid var(--line);padding-top:14px}
.ppg .est div{font-size:13px;color:var(--sub)}
.ppg .est b{display:block;font-size:18px;color:var(--ink);letter-spacing:-.02em}
.ppg .bar{margin-top:16px}
.ppg .bar span{display:flex;justify-content:space-between;align-items:baseline;font-size:14px;font-weight:600;color:var(--sub);margin-bottom:8px}
.ppg .bar span b{font-size:24px;font-weight:800;color:var(--ink);letter-spacing:-.03em}
.ppg .bar i{display:block;height:10px;border-radius:99px;background:#ECECEA;position:relative;overflow:hidden}
.ppg .bar i::after{content:"";position:absolute;inset:0;width:var(--w);border-radius:99px;background:var(--c,var(--ink))}
.ppg .ax{display:flex;justify-content:space-between;margin-top:8px;font-size:12px;font-weight:600;color:var(--mute)}
.ppg .ok{margin-top:16px;font-size:14px;font-weight:700;color:var(--acc-t)}
.ppg .tri{display:grid;grid-template-columns:1fr 1fr 1.6fr;gap:16px;align-items:end;width:100%;max-width:520px}
.ppg .tri .im{border-radius:14px}
.ppg .tri .sq{aspect-ratio:1}
.ppg .tri .ck{aspect-ratio:1;border-radius:14px;position:relative;overflow:hidden;background-color:#fff;background-image:linear-gradient(45deg,#E6E6E3 25%,transparent 25%,transparent 75%,#E6E6E3 75%),linear-gradient(45deg,#E6E6E3 25%,transparent 25%,transparent 75%,#E6E6E3 75%);background-size:18px 18px;background-position:0 0,9px 9px}
.ppg .tri .ck .im{position:absolute;inset:0;background-color:transparent;border-radius:0}
.ppg .tri .ps{aspect-ratio:3/4;box-shadow:0 26px 50px -30px rgba(0,0,0,.5)}
.ppg .tri figcaption{margin-top:11px;font-size:13.5px;font-weight:700;color:var(--sub);text-align:center}
.ppg .tri figcaption b{color:var(--ink)}
.ppg .msg{border-top:1px solid var(--line);padding:12px 0}
.ppg .msg small{display:block;font-size:12.5px;font-weight:700;color:var(--mute);margin-bottom:6px}
.ppg .msg p{display:inline-block;background:var(--soft);border-radius:16px 16px 16px 5px;padding:10px 13px;font-size:14px;line-height:1.5}
.ppg .msg p b{color:var(--acc-t)}
.ppg .sr{display:grid;grid-template-columns:56px 1fr 52px;gap:12px;align-items:center;padding:12px 0;border-top:1px solid var(--line);font-size:14px;font-weight:600;color:var(--sub)}
.ppg .sr i{display:block;height:10px;border-radius:99px;background:#ECECEA;position:relative;overflow:hidden}
.ppg .sr i::after{content:"";position:absolute;inset:0;width:var(--w);border-radius:99px;background:#B9B9BD}
.ppg .sr b{text-align:right;color:var(--ink);font-variant-numeric:tabular-nums}
.ppg .sr.win{color:var(--ink)}
.ppg .sr.win i::after{background:var(--acc)}
.ppg .chat{display:flex;flex-direction:column;gap:9px;border-top:1px solid var(--line);padding-top:14px}
.ppg .chat .i{align-self:flex-start;background:var(--soft);border-radius:16px 16px 16px 5px;padding:10px 13px;font-size:14px}
.ppg .chat .o{align-self:flex-end;background:var(--ink);color:#fff;border-radius:16px 16px 5px 16px;padding:10px 13px;font-size:14px;max-width:84%}
.ppg .chat small{align-self:flex-end;font-size:12.5px;font-weight:700;color:var(--sub);margin-top:-3px}
.ppg .chat small.h{color:var(--acc-t)}
.ppg .keep{background:var(--ink);color:#fff;padding:104px 0}
.ppg .keep .lbl{color:#FF8A5C}
.ppg .kg{margin-top:44px;display:grid;grid-template-columns:repeat(2,1fr);border-top:1px solid rgba(255,255,255,.18)}
.ppg .kg div{padding:28px 28px 4px 0;font-size:16.5px;line-height:1.68;color:rgba(255,255,255,.78)}
.ppg .kg div+div{padding-left:28px;border-left:1px solid rgba(255,255,255,.18)}
.ppg .kg b{display:block;font-size:22px;color:#fff;margin-bottom:8px;letter-spacing:-.03em}
.ppg .end{padding:120px 0;text-align:center}
.ppg .end p{margin:20px auto 0;font-size:18.5px;line-height:1.66;color:var(--sub);max-width:30em}
.ppg .end .cta{margin-top:34px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.ppg footer{padding:26px 0 40px;font-size:13.5px;color:var(--sub);text-align:center;border-top:1px solid var(--line)}
.ppg .hero .sub,.ppg .ft .d,.ppg .ft li,.ppg .ft .nt,.ppg .kg div,.ppg .end p{text-wrap:pretty}
.ppg .rv{opacity:0;transform:translateY(22px);transition:opacity .7s,transform .8s cubic-bezier(.2,.8,.2,1)}
.ppg .rv.in{opacity:1;transform:none}
@media (max-width:900px){
.ppg .w{padding:0 20px}
.ppg .nav a.t{display:none}
.ppg .hero{grid-template-columns:1fr;gap:32px;padding:16px 0 64px}
.ppg .gal{padding-bottom:72px}
.ppg .gal .row{grid-template-columns:repeat(3,1fr);gap:10px}
.ppg .gal .im:nth-child(n+4){display:none}
.ppg .sec{padding:72px 0}
.ppg .dh{display:none}
.ppg .dr{grid-template-columns:1fr;gap:6px;padding:20px 0}
.ppg .ft{padding-top:72px}
.ppg .fg{grid-template-columns:1fr;gap:28px}
.ppg .ft:nth-of-type(even) .fg .pn{order:0}
.ppg .pn{min-height:0;padding:26px 16px;border-radius:24px}
.ppg .kg{grid-template-columns:1fr}
.ppg .kg div+div{padding-left:0;border-left:0;border-top:1px solid rgba(255,255,255,.18)}
.ppg .keep{padding:72px 0}
.ppg .end{padding:80px 0}
}
@media (max-width:430px){
.ppg .hero h1{font-size:10.6vw}
.ppg .h2{font-size:7.4vw}
.ppg .tri{gap:10px}
.ppg .tri figcaption{font-size:11.5px}
}
@media (max-width:360px){
.ppg .pn{padding:22px 10px}
.ppg .ui{padding:18px 16px}
.ppg .r span{font-size:12px}
.ppg .est b{font-size:16px}
}
@media (prefers-reduced-motion:reduce){
.ppg *{animation:none!important;transition:none!important}
.ppg .rv{opacity:1;transform:none}
}
.ppg button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.ppg input,.ppg textarea,.ppg select{font:inherit;color:inherit}
.ppg .pnav{display:flex;align-items:center;gap:6px;padding:22px 0}
.ppg .pnav .logo{font-weight:900;font-size:22px;letter-spacing:-.04em}
.ppg .pnav .sp{flex:1}
.ppg .pnav a.t{font-size:15px;font-weight:600;color:var(--sub);padding:10px 14px}
.ppg .hero .lbl{margin-bottom:16px}
.ppg .hero h1.p{font-size:clamp(34px,4.7vw,62px)}
.ppg .get{margin-top:44px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.ppg .get article{background:#fff;border-radius:22px;padding:26px 24px 28px;display:flex;flex-direction:column}
.ppg .get .n{font-size:13.5px;font-weight:800;color:var(--acc-t)}
.ppg .get h3{margin-top:10px;font-size:23px;font-weight:800;letter-spacing:-.035em;line-height:1.3}
.ppg .get p{margin-top:10px;font-size:15.5px;line-height:1.66;color:var(--sub);text-wrap:pretty}
.ppg .get .th{margin-top:auto;padding-top:22px;display:flex;gap:8px;align-items:flex-end;min-height:132px}
.ppg .get .th .im{flex:1;aspect-ratio:3/4;border-radius:10px}
.ppg .get .th .sm{background:var(--soft);border-radius:12px 12px 12px 4px;padding:10px 12px;font-size:12.5px;line-height:1.5;flex:1}
.ppg .get .th .sm b{display:block;font-size:11.5px;color:var(--acc-t);margin-bottom:3px}
.ppg .get .th .pg{flex:0 0 46%;aspect-ratio:9/15;border-radius:12px;background:var(--soft);padding:7px;display:flex;flex-direction:column;gap:5px}
.ppg .get .th .pg .im{flex:0 0 auto;aspect-ratio:4/3;border-radius:7px}
.ppg .get .th .pg i{display:block;height:6px;border-radius:9px;background:#DCDAD3}
.ppg .get .th .pg i:nth-of-type(2){width:70%}
.ppg .get .th .pg u{display:block;margin-top:auto;height:16px;border-radius:6px;background:var(--ink)}
.ppg .get .th .ch{display:flex;flex-wrap:wrap;gap:6px;align-content:flex-end}
.ppg .get .th .ch span{font-size:13px;font-weight:700;padding:7px 11px;border-radius:99px;box-shadow:inset 0 0 0 1.5px var(--line)}
.ppg .how{margin-top:44px;display:grid;grid-template-columns:repeat(4,1fr);border-top:2px solid var(--ink)}
.ppg .how div{padding:24px 22px 4px 0}
.ppg .how div+div{padding-left:22px;border-left:1px solid var(--line)}
.ppg .how small{font-size:13px;font-weight:800;color:var(--mute)}
.ppg .how small.me{color:var(--acc-t)}
.ppg .how b{display:block;margin-top:8px;font-size:20px;font-weight:800;letter-spacing:-.03em;line-height:1.35}
.ppg .how p{margin-top:8px;font-size:15px;line-height:1.62;color:var(--sub);text-wrap:pretty}
.ppg .hown{margin-top:28px;font-size:16px;font-weight:700}
.ppg .vhead{padding-top:104px}
.ppg .ap{display:grid;grid-template-columns:1fr 1.08fr;gap:64px;align-items:start}
.ppg .ap .side p{margin-top:18px;font-size:17.5px;line-height:1.7;color:var(--sub);max-width:24em;text-wrap:pretty}
.ppg .ap .side ul{list-style:none;margin-top:26px;display:grid;gap:12px}
.ppg .ap .side li{display:flex;gap:12px;align-items:flex-start;font-size:16.5px;font-weight:600;line-height:1.5}
.ppg .ap .side li .ic{width:22px;height:22px;padding:4px;border-radius:50%;background:var(--ink);color:#fff;stroke-width:3;margin-top:1px}
.ppg .form{background:#fff;border-radius:26px;padding:30px 30px 28px;box-shadow:0 30px 70px -48px rgba(0,0,0,.45)}
.ppg .fl{display:block;font-size:14.5px;font-weight:800;margin-bottom:9px}
.ppg .fl small{font-weight:600;color:var(--mute);margin-left:6px}
.ppg .fg2{margin-top:22px}
.ppg .ph4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.ppg .ph4 .sl{aspect-ratio:1;border-radius:14px;background:var(--soft);display:grid;place-items:center;color:var(--mute);font-size:12.5px;font-weight:700;position:relative;overflow:hidden;box-shadow:inset 0 0 0 1.5px var(--line)}
.ppg .ph4 .sl.add{box-shadow:inset 0 0 0 1.5px var(--ink);color:var(--ink);background:#fff}
.ppg .ph4 .sl .ic{width:22px;height:22px}
.ppg .ph4 .sl .im{position:absolute;inset:0}
.ppg .ph4 .sl .x{position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;background:rgba(11,11,12,.72);color:#fff;display:grid;place-items:center}
.ppg .ph4 .sl .x .ic{width:12px;height:12px;stroke-width:3}
.ppg .hint{margin-top:8px;font-size:13px;color:var(--mute)}
.ppg .inp{width:100%;height:52px;border-radius:13px;border:0;box-shadow:inset 0 0 0 1.5px var(--line);padding:0 16px;font-size:15.5px;background:#fff;outline:none}
.ppg .inp:focus{box-shadow:inset 0 0 0 2px var(--ink)}
.ppg .inp::placeholder{color:#A3A3A8}
.ppg .seg{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ppg .seg button{height:64px;border-radius:13px;box-shadow:inset 0 0 0 1.5px var(--line);text-align:left;padding:0 16px;font-size:15.5px;font-weight:700;line-height:1.3}
.ppg .seg button small{display:block;font-size:12.5px;font-weight:600;color:var(--mute)}
.ppg .seg button.on{box-shadow:inset 0 0 0 2px var(--ink);background:var(--soft)}
.ppg .form .btn{margin-top:26px;width:100%}
.ppg .fine{margin-top:12px;font-size:13px;line-height:1.6;color:var(--mute);text-align:center}
.ppg .wait{max-width:760px;margin:0 auto;padding:72px 0 120px;text-align:center}
.ppg .rail{margin:40px auto 0;display:grid;grid-template-columns:repeat(4,1fr);max-width:620px}
.ppg .rail div{position:relative;padding-top:30px;font-size:14px;font-weight:700;color:var(--mute)}
.ppg .rail div::before{content:"";position:absolute;top:8px;left:0;right:0;height:2px;background:var(--line)}
.ppg .rail div:first-child::before{left:50%}
.ppg .rail div:last-child::before{right:50%}
.ppg .rail div::after{content:"";position:absolute;top:2px;left:50%;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:#fff;box-shadow:inset 0 0 0 2px #CFCFD3}
.ppg .rail .dn{color:var(--ink)}
.ppg .rail .dn::after{background:var(--ink);box-shadow:none}
.ppg .rail .dn::before,.ppg .rail .nw::before{background:linear-gradient(90deg,var(--ink) 50%,var(--line) 50%)}
.ppg .rail .dn+.dn::before,.ppg .rail .dn:first-child::before{background:var(--ink)}
.ppg .rail .nw{color:var(--acc-t)}
.ppg .rail .nw::after{background:var(--acc);box-shadow:0 0 0 5px rgba(207,69,16,.16)}
.ppg .wait .box{margin-top:44px;background:var(--soft);border-radius:22px;padding:22px;display:flex;gap:16px;align-items:center;text-align:left}
.ppg .wait .box .im{width:76px;height:76px;border-radius:14px;flex-shrink:0}
.ppg .wait .box b{display:block;font-size:13px;color:var(--mute);margin-bottom:4px}
.ppg .wait .box span{font-size:16.5px;font-weight:700;line-height:1.5}
.ppg .kit{padding-top:40px;padding-bottom:112px}
.ppg .kg3{margin-top:40px;display:grid;grid-template-columns:1fr 1.12fr .86fr;gap:28px;align-items:start}
.ppg .kh{font-size:14.5px;font-weight:800;margin-bottom:12px;display:flex;justify-content:space-between;align-items:baseline}
.ppg .kh small{font-size:12.5px;font-weight:600;color:var(--mute)}
.ppg .pos{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.ppg .pos button{display:block;border-radius:14px;padding:5px;box-shadow:inset 0 0 0 1.5px var(--line);background:#fff}
.ppg .pos button .im{aspect-ratio:3/4;border-radius:10px}
.ppg .pos button.on{box-shadow:inset 0 0 0 2.5px var(--acc)}
.ppg .pos .big{grid-column:1/-1;aspect-ratio:3/4;border-radius:18px;margin-bottom:4px;box-shadow:0 26px 56px -36px rgba(0,0,0,.5)}
.ppg .cps{display:grid;gap:10px}
.ppg .cps button{text-align:left;border-radius:16px;padding:16px 18px;box-shadow:inset 0 0 0 1.5px var(--line);background:#fff;width:100%}
.ppg .cps button.on{box-shadow:inset 0 0 0 2.5px var(--acc)}
.ppg .cps .tp{display:flex;gap:8px;align-items:center;margin-bottom:8px;font-size:12.5px;font-weight:800}
.ppg .cps .tp span{color:var(--mute)}
.ppg .pass{display:inline-flex;align-items:center;gap:5px;color:var(--acc-t);margin-left:auto}
.ppg .pass .ic{width:14px;height:14px;stroke-width:3}
.ppg .cps p{font-size:14.5px;line-height:1.62;white-space:pre-line}
.ppg .go{position:sticky;top:64px}
.ppg .go .phone{width:100%;max-width:250px;margin:0 auto}
.ppg .go .btn{margin-top:22px;width:100%}
.ppg .go .ex{margin-top:12px;font-size:13.5px;line-height:1.62;color:var(--sub);text-align:center;text-wrap:pretty}
.ppg .dmc{margin-top:56px;background:var(--soft);border-radius:28px;padding:34px;display:grid;grid-template-columns:auto 1fr;gap:36px;align-items:center}
.ppg .dmp{width:170px;aspect-ratio:9/16;border-radius:22px;background:#fff;padding:9px;display:flex;flex-direction:column;gap:7px;box-shadow:0 26px 56px -36px rgba(0,0,0,.5)}
.ppg .dmp .im{aspect-ratio:3/4;border-radius:13px}
.ppg .dmp i{display:block;height:8px;border-radius:9px;background:#E4E2DB}
.ppg .dmp i:nth-of-type(2){width:64%}
.ppg .dmp u{display:block;margin-top:auto;height:26px;border-radius:9px;background:var(--ink)}
.ppg .dmc h3{font-size:clamp(24px,2.8vw,34px);font-weight:900;letter-spacing:-.04em;line-height:1.24}
.ppg .dmc p{margin-top:12px;font-size:16.5px;line-height:1.68;color:var(--sub);max-width:30em;text-wrap:pretty}
.ppg .dmc .cta{margin-top:22px;display:flex;gap:10px;flex-wrap:wrap}
.ppg .btn.ik{background:var(--ink);color:#fff}
.ppg .more{margin-top:40px;text-align:center;font-size:16px;color:var(--sub)}
.ppg .more a{color:var(--ink);font-weight:800;text-decoration:underline;text-underline-offset:4px}
@media (max-width:1080px){
.ppg .get{grid-template-columns:repeat(2,1fr)}
.ppg .kg3{grid-template-columns:1fr 1fr}
.ppg .go{grid-column:1/-1;position:static;display:grid;grid-template-columns:auto 1fr;gap:24px;align-items:center}
.ppg .go .phone{margin:0;width:200px}
.ppg .go .btn{margin-top:0}
.ppg .go .ex{text-align:left}
}
@media (max-width:900px){
.ppg .pnav a.t{display:none}
.ppg .how{grid-template-columns:1fr 1fr}
.ppg .how div:nth-child(3){padding-left:0;border-left:0}
.ppg .how div:nth-child(n+3){border-top:1px solid var(--line)}
.ppg .ap{grid-template-columns:1fr;gap:32px}
.ppg .vhead{padding-top:72px}
.ppg .dmc{grid-template-columns:1fr;padding:26px 20px;gap:24px;justify-items:start}
}
@media (max-width:640px){
.ppg .get{grid-template-columns:1fr}
.ppg .get .th{min-height:0}
.ppg .how{grid-template-columns:1fr}
.ppg .how div+div{padding-left:0;border-left:0;border-top:1px solid var(--line)}
.ppg .form{padding:22px 18px;border-radius:22px}
.ppg .ph4{gap:7px}
.ppg .seg button{padding:0 12px;font-size:14.5px}
.ppg .kg3{grid-template-columns:1fr}
.ppg .pos .big{display:none}
.ppg .go{grid-template-columns:1fr;justify-items:center}
.ppg .go .ex{text-align:center}
.ppg .rail div{font-size:12.5px}
.ppg .dmc h3{font-size:21px}
.ppg .wait .box{flex-direction:column;align-items:flex-start}
}
.ppg .i-n1{background-image:url(gated:poster-serum.jpg)}
.ppg .i-n2{background-image:url(gated:poster-serum-niche.jpg)}
.ppg .i-n3{background-image:url(gated:poster-latte.jpg)}
.ppg .i-n4{background-image:url(gated:poster-knit.jpg)}
.ppg .i-n5{background-image:url(gated:poster-open.jpg)}
.ppg .i-p1{background-image:url(gated:poster-serum-autumn.jpg)}
.ppg .i-sk{background-image:url(gated:photo-serum.jpg)}
.ppg .i-so{background-image:url(gated:photo-latte.jpg)}
.ppg .i-ss{background-image:url(gated:photo-knit.jpg)}
.ppg .i-co{background-image:url(gated:cut-latte.webp)}
`;

/** 신청 전 화면의 소개(머리 · 받으시는 것 · 진행 순서 · 한줄로 V3 기능 넷 · 그대로인 것) */
export const PROPOSAL_INTRO_HTML = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="ppg-ar" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
  <symbol id="ppg-ck" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></symbol>
</svg>
<header class="w">
  <nav class="pnav"><div class="logo">한줄로</div><div class="sp"></div>
    <a class="t" href="#get">받으시는 것</a><a class="t" href="#how">진행 순서</a><a class="t" href="#f1">한줄로 V3</a>
    <a class="btn or sm" href="#apply">체험 신청</a></nav>
  <div class="hero">
    <div>
      <p class="lbl">제작 대행 체험</p>
      <h1 class="p">사진과 한 줄이면<br><em>보낼 준비</em>가 끝납니다</h1>
      <p class="sub">비즈니스 요금제{{agencyPrice}}부터 포함되는 캠페인 대행 운영의 제작을, 한 번 그대로 해 드립니다. 발송은 평소 쓰시던 화면에서 명단만 올리면 됩니다.</p>
      <div class="cta"><a class="btn or" href="#apply">체험 신청하기 <svg class="ic"><use xlink:href="#ppg-ar"/></svg></a><a class="btn ln" href="#get">무엇을 받나요</a></div>
    </div>
    <div class="hv" aria-hidden="true">
      <div class="im ps i-n1"></div>
      <div class="src"><div class="im i-sk"></div><div>올려 주신 사진으로<small>포스터, 문안, 모바일 DM</small></div></div>
      <div class="phone ph"><div class="nt"></div><div class="scr">
        <div class="bar0"><b>결온</b>문자 메시지</div>
        <div class="th"><div class="bub"><div class="im i-n1"></div><p>(광고)[결온]<br>밤사이 채우는 윤기, 앰버 세럼<br>하루의 끝, 세안 뒤 한 방울이면<br>아침 피부가 달라집니다.<br>무료수신거부 080-000-0000</p></div></div>
      </div></div>
    </div>
  </div>
</header>

<section class="sec sf" id="get"><div class="w">
  <p class="lbl">받으시는 것</p>
  <h2 class="h2">한 번의 신청으로<br><em>이만큼</em> 받으십니다</h2>
  <div class="get">
    <article class="rv"><span class="n">01</span><h3>포스터 3장</h3><p>올려 주신 사진으로 만든 행사 포스터입니다. MMS에 그대로 붙습니다.</p>
      <div class="th"><div class="im i-n1"></div><div class="im i-n2"></div><div class="im i-p1"></div></div></article>
    <article class="rv"><span class="n">02</span><h3>문안 3개</h3><p>통신사 스팸 검사를 지난 문안입니다. 광고 표기와 무료수신거부까지 맞춰 드립니다.</p>
      <div class="th"><div class="sm"><b>통신사 스팸 검사 통과</b>밤사이 채우는 윤기, 앰버 세럼. 이번 주 일요일까지 회원 감사 주간이 이어집니다.</div></div></article>
    <article class="rv"><span class="n">03</span><h3>모바일 DM 1개</h3><p>문자의 링크를 누르면 열리는 한 장짜리 행사 페이지입니다.</p>
      <div class="th"><div class="pg"><div class="im i-n1"></div><i></i><i></i><u></u></div></div></article>
    <article class="rv"><span class="n">04</span><h3>더 필요한 것</h3><p>이메일이나 다른 채널 소재도 필요하시면 함께 만들어 드립니다. 신청하실 때 적어 주세요.</p>
      <div class="th"><div class="ch"><span>이메일</span><span>알림톡 문안</span><span>자사몰 팝업</span></div></div></article>
  </div>
</div></section>

<section class="sec" id="how"><div class="w">
  <p class="lbl">진행 순서</p>
  <h2 class="h2">담당자님이 하실 일은<br><em>두 가지</em>입니다</h2>
  <div class="how">
    <div class="rv"><small class="me">담당자님</small><b>사진 3~4장과<br>한 줄을 올립니다</b><p>무엇을 알릴지 한 줄이면 됩니다.</p></div>
    <div class="rv"><small>한줄로</small><b>완성본을<br>만듭니다</b><p>만든 뒤 저희 담당자가 한 번 더 확인합니다.</p></div>
    <div class="rv"><small>한줄로</small><b>문자로<br>알려 드립니다</b><p>준비되면 적어 주신 번호로 보냅니다.</p></div>
    <div class="rv"><small class="me">담당자님</small><b>명단만 올려<br>보냅니다</b><p>평소 쓰시던 발송 화면이 완성본이 채워진 채 열립니다.</p></div>
  </div>
  <p class="hown">발송은 대신하지 않습니다. 누구에게 언제 보낼지는 담당자님이 정합니다.</p>
</div></section>

<div class="w vhead"><p class="lbl">한줄로 V3</p><h2 class="h2">체험 뒤에는 이런 일을<br><em>직접</em> 하실 수 있습니다</h2></div>
<section class="ft" id="f1"><div class="w fg">
  <div class="rv"><p class="lbl">01 이미지 스튜디오</p>
    <h3>제품 사진 한 장이<br>행사 포스터가 됩니다</h3>
    <p class="d">템플릿을 고르고 제품 사진을 올린 뒤 문구만 적으면, 약 30초 뒤 완성 포스터가 나옵니다.</p>
    <ul><li><svg class="ic"><use xlink:href="#ppg-ck"/></svg>사진 배경은 자동으로 지워집니다(누끼)</li><li><svg class="ic"><use xlink:href="#ppg-ck"/></svg>문자(MMS), 모바일 DM, 이메일, 자사몰 팝업에 그대로 씁니다</li><li><svg class="ic"><use xlink:href="#ppg-ck"/></svg>MMS로 보낼 때는 규격에 맞게 자동으로 변환됩니다</li></ul>
    <p class="nt">요금제에 가입하기 전에도 3회까지 무료로 만들어 볼 수 있습니다.</p></div>
  <div class="pn rv"><div class="tri">
    <figure><div class="im sq i-so" role="img" aria-label="원본 제품 사진"></div><figcaption><b>1</b> 원본 사진</figcaption></figure>
    <figure><div class="ck"><div class="im i-co"></div></div><figcaption><b>2</b> 배경 제거</figcaption></figure>
    <figure><div class="im ps i-n3" role="img" aria-label="이미지 스튜디오로 만든 포스터"></div><figcaption><b>3</b> 완성 포스터</figcaption></figure>
  </div></div>
</div></section>

<section class="ft" id="f2"><div class="w fg">
  <div class="rv"><p class="lbl">02 상품 반응</p>
    <h3>보고도 안 산 고객에게<br>바로 보냅니다</h3>
    <p class="d">많이 본 상품과 많이 찾은 검색어가 한 화면에 모입니다. 상품마다 보고도 안 산 고객 수를 세어 두었다가, 버튼 하나로 그 고객에게 보낼 문자 화면으로 넘어갑니다.</p>
    <ul><li><svg class="ic"><use xlink:href="#ppg-ck"/></svg>대상 명단을 따로 뽑지 않습니다</li><li><svg class="ic"><use xlink:href="#ppg-ck"/></svg>매장이든 자사몰이든 이미 산 고객은 빠집니다</li><li><svg class="ic"><use xlink:href="#ppg-ck"/></svg>화면에서 센 숫자 그대로 발송 명단이 됩니다</li></ul>
    <p class="nt">자사몰을 연결한 회사에서 쓸 수 있습니다.</p></div>
  <div class="pn rv"><div class="ui"><div class="uh">많이 본 상품<small>예시 화면</small></div>
    <div class="r"><div class="im i-sk"></div><div><b>결온 앰버 세럼</b><span>조회 412명, 구매 31명</span></div><em>381명</em></div>
    <div class="r"><div class="im i-ss"></div><div><b>케이블 울 니트</b><span>조회 268명, 구매 22명</span></div><em>246명</em></div>
    <div class="r"><div class="im i-so"></div><div><b>메이플 라떼 키트</b><span>조회 190명, 구매 40명</span></div><em>150명</em></div>
    <div class="ubtn">보고 안 산 381명에게 보내기 <svg class="ic"><use xlink:href="#ppg-ar"/></svg></div></div></div>
</div></section>

<section class="ft" id="f3"><div class="w fg">
  <div class="rv"><p class="lbl">03 기본 여정</p>
    <h3>가입부터 재구매까지<br>한 번에 켭니다</h3>
    <p class="d">AI가 우리 회사에 비어 있는 자동 발송을 찾아 초안을 만들어 둡니다. 내용을 확인하고 한 번에 켜면, 그다음부터는 때맞춰 알아서 나갑니다.</p>
    <ul><li><svg class="ic"><use xlink:href="#ppg-ck"/></svg>켜기 전에 예상 대상, 발송량, 비용을 미리 봅니다</li><li><svg class="ic"><use xlink:href="#ppg-ck"/></svg>발송 전 점검을 통과한 것만 켜집니다</li><li><svg class="ic"><use xlink:href="#ppg-ck"/></svg>켠 뒤에도 하나씩 멈출 수 있습니다</li></ul></div>
  <div class="pn rv"><div class="ui"><div class="uh">기본 여정 한 번에 켜기<small>예시 화면</small></div>
    <div class="j"><b>가입 환영</b><span>가입 직후</span><div class="tg"></div></div>
    <div class="j"><b>장바구니 알림</b><span>담고 1시간 뒤</span><div class="tg"></div></div>
    <div class="j"><b>생일 축하</b><span>생일 아침</span><div class="tg"></div></div>
    <div class="j"><b>휴면 전 안내</b><span>60일 미구매</span><div class="tg"></div></div>
    <div class="est"><div><b>1,240명</b>예상 대상</div><div><b>860건</b>예상 발송</div><div><b>미리 계산</b>예상 비용</div></div></div></div>
</div></section>

<section class="ft" id="f4"><div class="w fg">
  <div class="rv"><p class="lbl">04 업종 평균</p>
    <h3>같은 업종 평균을<br>바로 옆에 놓습니다</h3>
    <p class="d">성과 화면의 숫자 옆에 같은 업종 평균이 함께 보입니다. 잘하고 있는지 아닌지를 우리 숫자만 보고 짐작하지 않아도 됩니다.</p>
    <ul><li><svg class="ic"><use xlink:href="#ppg-ck"/></svg>다른 회사 숫자는 드러나지 않고 평균만 보입니다</li><li><svg class="ic"><use xlink:href="#ppg-ck"/></svg>비교할 회사가 충분할 때만 표시합니다</li><li><svg class="ic"><use xlink:href="#ppg-ck"/></svg>통신사별 스팸 검사 차단율도 한눈에 봅니다</li></ul></div>
  <div class="pn rv"><div class="ui"><div class="uh">문자 성공률<small>예시 화면</small></div>
    <div class="bar"><span>우리 회사<b>98.2%</b></span><i style="--w:82%;--c:var(--acc)"></i></div>
    <div class="bar"><span>같은 업종 평균<b>96.9%</b></span><i style="--w:69%;--c:#9A9A9F"></i></div>
    <div class="ax"><span>90%</span><span>막대 눈금</span><span>100%</span></div>
    <p class="ok">같은 업종 평균보다 1.3%p 높습니다</p></div></div>
</div></section>
<section class="keep" id="keep"><div class="w">
  <p class="lbl">그대로인 것</p>
  <h2 class="h2">지금 쓰시는 발송은<br>그대로입니다</h2>
  <div class="kg">
    <div><b>발송 화면</b>직접 발송, 주소록, 발신번호는 지금과 같은 자리에서 같은 방식으로 씁니다.</div>
    <div><b>적용 범위</b>V3 기능은 켠 회사, 켠 캠페인에만 적용됩니다. 켜지 않으면 아무것도 달라지지 않습니다.</div>
  </div>
</div></section>
`;
