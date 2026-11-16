/**
 * v3-popup.ts — 로그인 뒤에만 내려주는 소개 내용(「한줄로 V3」 장면 창 · 이미지 스튜디오 무료체험 창의 CSS · 마크업 · 업종 셋)
 *   ★ 2026-11-16 C136 배포 가(설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §2).
 *
 * Harold 「의미없이 전부 공개로 해놓으면 서비스 내용만 가져가서 복제 · 안내창도 마찬가지로」 →
 *   프론트 번들(옛 packages/frontend/src/components/v3/v3-popup-parts.ts · v3-motion.ts 의 SETS)에 있던 글을 **스크립트로 값 그대로** 옮겼다.
 *   그림 자리는 `gated:파일이름` 으로 적혀 있고, 화면이 로그인 토큰으로 받아 온 그림 주소로 바꾼다(그림 = packages/backend/assets/gated/v3).
 * 옮기며 바꾼 것 = 그림 주소 꼴 · 장면 창은 로그인 화면 창의 다섯째 장면(인증 안내 요약)을 빼고 단추 줄을 로그인 뒤 틀에 맞춤(다음에 볼게요 · 다시 보지 않기).
 * ⛔ 이 파일의 글 · 그림을 프론트 저장소(packages/frontend/src · public)에 다시 두지 않는다(계약 시험 c136-gated-content).
 * 글꼴 = 앱 전역 프리텐다드 하나. 색 = 흰 바탕 + 검정 + 주황 하나. 움직임의 시간표 = 프론트 components/v3/v3-motion.ts.
 */

export const V3_POPUP_CSS = `.v3p{--ink:#0B0B0C;--sub:#5F6368;--mute:#6B6B70;--line:#E8E8E6;--soft:#F4F3EF;--acc:#CF4510;--acc-d:#B53C0D;--acc-t:#B53C0D;--out:cubic-bezier(.16,1,.3,1);--io:cubic-bezier(.65,0,.35,1);position:fixed;inset:0;z-index:70;display:grid;place-items:center;container:stage/inline-size;overflow-y:auto;overscroll-behavior:contain;color:var(--ink);line-height:normal;letter-spacing:normal;text-align:left;font-size:16px;-webkit-font-smoothing:antialiased;word-break:keep-all}
.v3p .i-n1{background-image:url(gated:poster-serum.jpg)}.v3p .i-n3{background-image:url(gated:poster-latte.jpg)}.v3p .i-n4{background-image:url(gated:poster-knit.jpg)}.v3p .i-sk{background-image:url(gated:photo-serum.jpg)}.v3p .i-so{background-image:url(gated:photo-latte.jpg)}.v3p .i-ss{background-image:url(gated:photo-knit.jpg)}.v3p .i-ck{background-image:url(gated:cut-serum.webp)}.v3p .i-co{background-image:url(gated:cut-latte.webp)}.v3p .i-cs{background-image:url(gated:cut-knit.webp)}
.v3p *{box-sizing:border-box;margin:0;padding:0}
.v3p button{font:inherit;border:0;background:none;cursor:pointer;color:inherit}
.v3p .ic{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
.v3p .im{background-size:cover;background-position:center;background-color:#E9E6DF}
.v3p .scrim{position:absolute;inset:0;background:rgba(10,10,12,.62);animation:v3p-fadeIn .5s both}
@keyframes v3p-fadeIn{from{opacity:0}}
@keyframes v3p-fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes v3p-fadeOut{to{opacity:0}}
@keyframes v3p-fill{to{transform:scaleX(1)}}
.v3p .pop{position:relative;z-index:2;width:100%;max-width:1040px;background:#fff;border-radius:28px;overflow:hidden;box-shadow:0 40px 100px -32px rgba(0,0,0,.6);display:grid;grid-template-columns:46% 1fr;min-height:600px;animation:v3p-popIn .8s var(--out) both}
@keyframes v3p-popIn{from{opacity:0;transform:translateY(26px) scale(.965)}to{opacity:1;transform:none}}
.v3p .vis{position:relative;background:var(--soft);overflow:hidden;min-height:340px}
.v3p .sl{position:absolute;inset:0;opacity:0;visibility:hidden;transition:opacity .3s,visibility .3s}
.v3p .sl.on{opacity:1;visibility:visible}
.v3p .txt{padding:44px 48px 28px;display:flex;flex-direction:column;position:relative;min-width:0}
.v3p .x{position:absolute;right:14px;top:14px;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:var(--mute);z-index:6;transition:background .2s}
.v3p .x:hover{background:#F1F1EF}
.v3p .kick{font-size:14px;font-weight:700;color:var(--sub);display:flex;align-items:center;gap:8px}
.v3p .kick i{width:7px;height:7px;border-radius:50%;background:var(--acc)}
.v3p .msgs{display:grid;margin-top:18px}
.v3p .msgs>div{grid-area:1/1;opacity:0;visibility:hidden;transition:opacity .2s,visibility .2s}
.v3p .msgs>div.on{opacity:1;visibility:visible}
.v3p .hd{font-size:clamp(24px,calc(5cqi - 10.6px),42px);font-weight:900;letter-spacing:-.045em;line-height:1.18}
.v3p .hd em{font-style:normal;color:var(--acc-t)}
.v3p .ln{display:block;overflow:hidden;padding-bottom:.1em;margin-bottom:-.1em;white-space:nowrap}
.v3p .ln>span{display:block;transform:translateY(110%)}
.v3p .msgs>div.on .ln>span,.v3p .qA .ln>span{animation:v3p-lnUp .85s var(--out) both;animation-delay:calc(var(--i,0)*100ms + 150ms)}
@keyframes v3p-lnUp{to{transform:none}}
.v3p .lead{margin-top:16px;font-size:17px;line-height:1.66;color:var(--sub)}
.v3p .lead b{color:var(--ink);font-weight:700}
.v3p .msgs>div .lead{opacity:0}
.v3p .msgs>div.on .lead{animation:v3p-fadeUp .75s .42s var(--out) both}
.v3p .rise{animation:v3p-fadeUp .75s var(--out) both;animation-delay:calc(var(--i,0)*70ms + 150ms)}
.v3p .act{margin-top:28px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.v3p .cta{height:58px;padding:0 28px;border-radius:14px;background:var(--acc);color:#fff;font-weight:800;font-size:17px;display:inline-flex;align-items:center;justify-content:center;gap:10px;white-space:nowrap;transition:background .2s,transform .2s}
.v3p .cta:hover{background:var(--acc-d);transform:translateY(-1px)}
.v3p .ghost{font-size:14px;color:var(--sub);padding:8px 2px;white-space:nowrap}
.v3p .ghost:hover{color:var(--ink)}
.v3p .tabs{margin-top:auto;display:flex;align-items:flex-start;border-top:1px solid var(--line)}
.v3p .tabs button[data-tab]{flex:1;text-align:left;padding:14px 8px 0 0;font-size:13.5px;font-weight:600;color:var(--mute);position:relative;white-space:nowrap;transition:color .2s}
.v3p .tabs button[data-tab] b{display:block;font-size:12px;font-weight:800;margin-bottom:3px;font-variant-numeric:tabular-nums}
.v3p .tabs button[data-tab]:hover,.v3p .tabs button[data-tab].on{color:var(--ink)}
.v3p .tabs button[data-tab].on b{color:var(--acc-t)}
.v3p .tabs button[data-tab]::before{content:"";position:absolute;left:0;right:8px;top:-1px;height:2px;background:var(--ink);transform:scaleX(0);transform-origin:left}
.v3p .tabs button[data-tab].on::before{animation:v3p-fill var(--ms,7000ms) linear forwards}
.v3p .hold .tabs button[data-tab].on::before{animation-play-state:paused}
.v3p .pp{flex:0 0 38px;width:38px;height:38px;margin-top:11px;border-radius:50%;display:grid;place-items:center;color:var(--sub);box-shadow:inset 0 0 0 1px var(--line);transition:background .2s}
.v3p .pp:hover{background:#F1F1EF;color:var(--ink)}
.v3p .pp .ic{width:15px;height:15px;stroke-width:2.6}
.v3p .pp .ic+.ic,.v3p .pp.off .ic{display:none}
.v3p .pp.off .ic+.ic{display:block}
.v3p .sp{position:absolute;right:20px;top:66px;margin:0;background:#fff;box-shadow:0 10px 24px -12px rgba(0,0,0,.5);z-index:7}
.v3p .chip{position:absolute;height:36px;padding:0 14px;border-radius:99px;background:#fff;font-size:13.5px;font-weight:800;display:flex;align-items:center;gap:8px;box-shadow:0 12px 28px -14px rgba(0,0,0,.5);z-index:7;white-space:nowrap}
.v3p .chip i{width:8px;height:8px;border-radius:50%;background:var(--acc)}
.v3p .chip .ic{width:16px;height:16px;color:var(--sub)}
.v3p .c-st{left:20px;top:20px}
.v3p .c-tm{right:20px;top:20px;font-variant-numeric:tabular-nums;min-width:92px;justify-content:center}
.v3p .eg{position:absolute;right:20px;top:22px;font-size:12px;font-weight:600;color:var(--mute);z-index:7}
.v3p .src{position:absolute;left:20px;bottom:20px;display:flex;align-items:center;gap:11px;background:#fff;border-radius:16px;padding:8px 16px 8px 8px;box-shadow:0 14px 34px -16px rgba(0,0,0,.55);font-size:13.5px;font-weight:700;line-height:1.35;z-index:7;white-space:nowrap}
.v3p .src .im{width:54px;height:54px;border-radius:10px;flex-shrink:0}
.v3p .src small{display:block;font-size:12px;font-weight:600;color:var(--sub)}
.v3p .toast{position:absolute;left:50%;bottom:24px;height:44px;padding:0 18px;border-radius:99px;background:var(--ink);color:#fff;font-size:14px;font-weight:700;display:flex;align-items:center;gap:9px;white-space:nowrap;opacity:0;z-index:7;transform:translate(-50%,0)}
.v3p .toast .ic{width:16px;height:16px;stroke-width:3}
@keyframes v3p-toastIn{from{opacity:0;transform:translate(-50%,14px) scale(.95)}to{opacity:1;transform:translate(-50%,0)}}
.v3p .mo{position:absolute;inset:0}
.v3p .mo-wrap{position:absolute;aspect-ratio:1}
.v3p .mo-card{position:absolute;inset:0;overflow:hidden;background:#fff;opacity:0;transform:scale(.93) translateY(14px)}
.v3p .mo[data-ph="1"] .mo-card,.v3p .mo[data-ph="2"] .mo-card{opacity:1;transform:none;transition:opacity .4s,transform .6s var(--out)}
.v3p .mo[data-ph="3"] .mo-card{opacity:0;transform:scale(.98);transition:opacity .22s,transform .22s}
.v3p .mo-photo,.v3p .mo-ck,.v3p .mo-fly{position:absolute;inset:0;background-size:cover;background-position:center}
.v3p .mo-ck{background-color:#fff;background-image:linear-gradient(45deg,#E6E6E3 25%,transparent 25%,transparent 75%,#E6E6E3 75%),linear-gradient(45deg,#E6E6E3 25%,transparent 25%,transparent 75%,#E6E6E3 75%);background-size:22px 22px;background-position:0 0,11px 11px;clip-path:inset(0 0 100% 0)}
.v3p .mo-fly{background-color:transparent;clip-path:inset(0 0 100% 0);opacity:0;transform-origin:var(--ox,50%) var(--oy,50%);z-index:3}
.v3p .mo[data-ph="2"] .mo-ck,.v3p .mo[data-ph="2"] .mo-fly{opacity:1;animation:v3p-wipe .75s linear forwards}
@keyframes v3p-wipe{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 0 0)}}
.v3p .mo[data-ph="3"] .mo-ck{clip-path:inset(0)}
.v3p .mo[data-ph="3"] .mo-fly{opacity:1;clip-path:inset(0)}
.v3p .mo[data-ph="4"] .mo-fly{opacity:1;clip-path:inset(0);transform:translate(var(--dx,0),var(--dy,0)) scale(var(--sc,1));transition:transform .8s var(--io)}
.v3p .mo[data-ph="5"] .mo-fly,.v3p .mo[data-ph="6"] .mo-fly,.v3p .mo[data-ph="7"] .mo-fly{opacity:0;clip-path:inset(0);transform:translate(var(--dx,0),var(--dy,0)) scale(var(--sc,1));transition:opacity .2s}
.v3p .beam{position:absolute;inset:0;transform:translateY(-100%);opacity:0;pointer-events:none;z-index:2}
.v3p .beam::before{content:"";position:absolute;left:0;right:0;bottom:0;height:80px;background:linear-gradient(180deg,rgba(207,69,16,0),rgba(207,69,16,.24))}
.v3p .beam::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--acc)}
.v3p .mo[data-ph="2"] .beam{animation:v3p-beam .75s linear forwards}
@keyframes v3p-beam{from{transform:translateY(-100%);opacity:1}to{transform:none;opacity:1}}
.v3p .mo-post{position:absolute;inset:0;background-size:cover;background-position:center;opacity:0;transform:scale(1.07)}
.v3p .mo[data-ph="4"] .mo-post{opacity:1;transform:scale(1);transition:opacity .75s cubic-bezier(.5,0,.8,.4),transform 1s var(--out)}
.v3p .mo[data-ph="5"] .mo-post,.v3p .mo[data-ph="6"] .mo-post{opacity:1;transform:scale(1.035);transition:transform 7s linear}
.v3p .mo[data-ph="7"] .mo-post{opacity:0;transform:scale(1.035);transition:opacity .45s}
.v3p .mo .chip{opacity:0}
.v3p .mo:not([data-ph="0"]):not([data-ph="7"]) .chip{opacity:1;transition:opacity .4s .25s}
.v3p .mo .src{opacity:0;transform:translateY(16px)}
.v3p .mo[data-ph="5"] .src{opacity:1;transform:none;transition:opacity .5s .15s,transform .7s .15s var(--out)}
.v3p .pA .mo-wrap{left:21%;top:50%;width:58%;margin-top:-29%}
.v3p .pA .mo-card{border-radius:24px;box-shadow:0 34px 70px -34px rgba(0,0,0,.5)}
.v3p .phone{aspect-ratio:262/540;border-radius:15.5% / 7.5%;background:#0B0B0C;padding:3.7%;position:relative;container-type:inline-size;box-shadow:0 34px 70px -30px rgba(0,0,0,.6)}
.v3p .phone .scr{height:100%;border-radius:12.6% / 6.1%;background:#F2F2F4;overflow:hidden;display:flex;flex-direction:column}
.v3p .phone .nt{position:absolute;left:50%;top:3.3%;width:30%;height:4%;border-radius:99px;background:#0B0B0C;transform:translateX(-50%);z-index:2}
.v3p .phone .bar0{padding:15cqi 5cqi 4cqi;text-align:center;background:#fff;border-bottom:1px solid #E6E6E8;font-size:4.6cqi;color:#5F6368}
.v3p .phone .bar0 b{display:block;font-size:5.6cqi;color:#0B0B0C}
.v3p .phone .th{flex:1;padding:4cqi 4.6cqi 5cqi;display:flex;flex-direction:column;justify-content:flex-end;gap:2.6cqi;min-height:0}
.v3p .phone .tm{text-align:center;font-size:4.6cqi;color:#5F6368}
.v3p .bub{background:#E6E6EA;border-radius:8cqi 8cqi 8cqi 2.4cqi;padding:3cqi;width:92%;font-size:4.6cqi;line-height:1.52;color:#0B0B0C}
.v3p .bub .im{aspect-ratio:3/4;border-radius:5.4cqi;margin-bottom:2.8cqi}
.v3p .bub p{padding:0 1.4cqi 1cqi;white-space:pre-line}
.v3p .kk .scr{background:#B9CBDC}
.v3p .kk .bar0{background:#B9CBDC;border-bottom:0;text-align:left;display:flex;align-items:center;gap:3cqi;color:#0B0B0C;padding:15cqi 5cqi 3cqi}
.v3p .kk .bar0 b{font-size:6cqi}
.v3p .kk .bar0 .ic{width:6cqi;height:6cqi}
.v3p .kk .th{justify-content:flex-start;padding-top:3cqi}
.v3p .at-row{display:grid;grid-template-columns:13cqi 1fr;gap:3cqi;align-items:start}
.v3p .at-av{width:13cqi;height:13cqi;border-radius:38%;background:#0B0B0C;color:#fff;display:grid;place-items:center;font-size:6cqi;font-weight:800}
.v3p .at-nm{font-size:4.6cqi;color:#263238;margin-bottom:1.6cqi}
.v3p .at-wrap{display:flex;align-items:flex-end}
.v3p .at{background:#fff;border-radius:5cqi;overflow:hidden;flex:1;min-width:0;font-size:4.6cqi;line-height:1.52;color:#0B0B0C}
.v3p .at-top{background:#FEE500;padding:2.6cqi 4cqi;font-size:4.6cqi;font-weight:800;color:#191600}
.v3p .at-em{padding:4.4cqi 4cqi 3.6cqi;border-bottom:1px solid #EEE}
.v3p .at-em small{display:block;font-size:4.6cqi;color:#6B6B70}
.v3p .at-em b{display:block;font-size:6.2cqi;font-weight:800;letter-spacing:-.03em;margin-top:.6cqi;white-space:nowrap}
.v3p .at-bd{padding:3.6cqi 4cqi 1cqi;white-space:pre-line}
.v3p .at-btn{margin:3.4cqi 4cqi 4cqi;height:13cqi;border-radius:2.6cqi;background:#F3F3F1;display:grid;place-items:center;font-size:4.8cqi;font-weight:700}
.v3p .at-time{font-size:4.6cqi;color:#3C4A57;padding-left:1.6cqi;white-space:nowrap}
.v3p .card{position:absolute;left:50%;top:50%;background:#fff;border-radius:20px;box-shadow:0 26px 60px -34px rgba(0,0,0,.42)}
.v3p .cart{width:324px;margin:-120px 0 0 -162px;padding:20px;opacity:0}
.v3p .cart.gh{height:158px;box-shadow:0 14px 30px -20px rgba(0,0,0,.35)}
.v3p .ch{display:flex;justify-content:space-between;align-items:center;font-size:15px;font-weight:800}
.v3p .ch small{font-size:12px;font-weight:700;color:var(--acc-t);background:#FBE9E1;border-radius:99px;padding:4px 10px}
.v3p .ci{display:grid;grid-template-columns:64px 1fr;gap:12px;align-items:center;margin-top:14px}
.v3p .ci .im{width:64px;height:64px;border-radius:12px}
.v3p .ci b{display:block;font-size:15px}
.v3p .ci span{font-size:13px;color:var(--sub)}
.v3p .cf{margin-top:14px;padding-top:12px;border-top:1px solid var(--line);display:flex;justify-content:space-between;font-size:13px;color:var(--sub)}
.v3p .cf b{color:var(--ink)}
.v3p .s2.on .cart.main{animation:v3p-cardIn .6s .1s var(--out) both,v3p-cartUp .7s 1s var(--io) forwards,v3p-fadeOut .3s 3.05s forwards}
.v3p .s2.on .cart.g1{animation:v3p-g1 .7s 1s var(--io) both,v3p-fadeOut .3s 3.05s forwards}
.v3p .s2.on .cart.g2{animation:v3p-g2 .7s 1.08s var(--io) both,v3p-fadeOut .3s 3.05s forwards}
@keyframes v3p-cardIn{from{opacity:0;transform:scale(.94) translateY(16px)}to{opacity:1;transform:none}}
@keyframes v3p-cartUp{from{opacity:1;transform:none}to{opacity:1;transform:translateY(-104px) scale(.86)}}
@keyframes v3p-g1{from{opacity:0;transform:translateY(-60px) scale(.8)}to{opacity:.75;transform:translateY(-78px) scale(.8)}}
@keyframes v3p-g2{from{opacity:0;transform:translateY(-40px) scale(.74)}to{opacity:.45;transform:translateY(-54px) scale(.74)}}
.v3p .cnt{position:absolute;left:0;right:0;top:50%;margin-top:52px;text-align:center;opacity:0}
.v3p .cnt small{display:block;font-size:14px;font-weight:700;color:var(--sub)}
.v3p .cnt b{display:block;font-size:52px;font-weight:900;letter-spacing:-.04em;line-height:1.15;font-variant-numeric:tabular-nums}
.v3p .s2.on .cnt{animation:v3p-fadeUp .6s 1.15s var(--out) both,v3p-fadeOut .3s 3.05s forwards}
.v3p .ubtn{height:52px;border-radius:14px;background:var(--ink);color:#fff;font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap}
.v3p .send{position:absolute;left:50%;bottom:54px;width:268px;margin-left:-134px;opacity:0}
.v3p .s2.on .send{animation:v3p-fadeUp .55s 1.7s var(--out) both,v3p-press .34s 2.72s var(--io),v3p-fadeOut .3s 3.05s forwards}
@keyframes v3p-press{50%{transform:scale(.95)}}
.v3p .cur{position:absolute;left:50%;top:50%;width:28px;height:28px;margin:-2px 0 0 36px;z-index:8;opacity:0;filter:drop-shadow(0 4px 6px rgba(0,0,0,.3))}
.v3p .s2.on .cur{animation:v3p-curIn .8s 1.9s var(--io) both,v3p-curTap .34s 2.72s var(--io)}
@keyframes v3p-curIn{from{opacity:0;transform:translate(96px,84px)}22%{opacity:1}to{opacity:1;transform:none}}
@keyframes v3p-curTap{50%{scale:.84}}
.v3p .sms{width:336px;margin:-184px 0 0 -168px;padding:18px 20px 20px;font-size:14.5px;line-height:1.62;white-space:pre-line;opacity:0;border-radius:22px 22px 22px 6px}
.v3p .s2.on .sms{animation:v3p-cardIn .6s 3.2s var(--out) both}
.v3p .s2.on .toast{animation:v3p-toastIn .6s 3.5s var(--out) both}
.v3p .join{width:312px;margin:-132px 0 0 -156px;padding:22px;opacity:0}
.v3p .jf{margin-top:12px;border:1px solid var(--line);border-radius:12px;padding:9px 13px;display:flex;justify-content:space-between;font-size:14px}
.v3p .jf span{color:var(--sub)}
.v3p .jf b{font-weight:700}
.v3p .jb{margin-top:14px;position:relative;height:50px;border-radius:13px;background:var(--ink);color:#fff;font-weight:700;font-size:15px}
.v3p .jb span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:7px}
.v3p .jb span+span{opacity:0}
.v3p .jb .ic{width:16px;height:16px;stroke-width:3}
.v3p .jb .cur{margin-left:44px}
.v3p .s3.on .join{animation:v3p-cardIn .6s .1s var(--out) both,v3p-fadeOut .3s 1.15s forwards}
.v3p .s3.on .jb{animation:v3p-press .34s .9s var(--io)}
.v3p .s3.on .jb span:first-child{animation:v3p-fadeOut .2s 1s forwards}
.v3p .s3.on .jb span+span{animation:v3p-fadeUp .3s 1.18s both}
.v3p .s3.on .cur{animation:v3p-curIn .55s .35s var(--io) both,v3p-curTap .34s .9s var(--io)}
.v3p .s3 .phone{position:absolute;left:50%;top:50%;width:244px;margin:-252px 0 0 -122px;opacity:0}
.v3p .s3.on .phone{animation:v3p-phIn .6s 1.2s var(--out) both,v3p-phSide .6s 2.9s var(--io) forwards}
@keyframes v3p-phIn{from{opacity:0;transform:translateY(70px)}to{opacity:1;transform:none}}
@keyframes v3p-phSide{to{opacity:1;transform:translate(var(--phx,-134px),var(--phy,0px)) scale(var(--phs,.76))}}
.v3p .s3 .at-row{opacity:0}
.v3p .s3.on .at-row{animation:v3p-atIn .5s 1.6s var(--out) both}
@keyframes v3p-atIn{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:none}}
.v3p .jr{width:258px;left:auto;right:12px;margin:-136px 0 0 0;padding:18px 16px 10px;opacity:0}
.v3p .jr .j b{font-size:13.5px}
.v3p .jr .j span{font-size:12px}
.v3p .jr .uh{font-size:14px}
.v3p .s3.on .jr{animation:v3p-jrIn .6s 3.1s var(--out) both}
@keyframes v3p-jrIn{from{opacity:0;transform:translateX(60px)}to{opacity:1;transform:none}}
.v3p .uh{font-size:15px;font-weight:800;display:flex;justify-content:space-between;align-items:baseline}
.v3p .uh small{font-size:12px;font-weight:600;color:var(--mute)}
.v3p .j{display:flex;align-items:center;gap:10px;padding:13px 0;border-top:1px solid var(--line)}
.v3p .uh+.j{margin-top:12px}
.v3p .j b{flex:1;font-size:14.5px;font-weight:700;white-space:nowrap}
.v3p .j span{font-size:12.5px;color:var(--sub);white-space:nowrap}
.v3p .j em{font-style:normal;font-size:12px;font-weight:800;color:var(--acc-t);background:#FBE9E1;border-radius:99px;padding:3px 9px;white-space:nowrap}
.v3p .tg{width:38px;height:22px;border-radius:99px;background:#D9D9D6;position:relative;flex-shrink:0}
.v3p .tg::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff}
.v3p .tg.on0{background:var(--ink)}
.v3p .tg.on0::after{transform:translateX(16px)}
.v3p .s3.on .tg:not(.on0){animation:v3p-tgBg .3s var(--d,3.45s) forwards}
.v3p .s3.on .tg:not(.on0)::after{animation:v3p-tgKnob .3s var(--d,3.45s) forwards}
@keyframes v3p-tgBg{to{background:var(--ink)}}
@keyframes v3p-tgKnob{to{transform:translateX(16px)}}
.v3p .s3 .toast{bottom:28px}
.v3p .s3.on .toast{animation:v3p-toastIn .6s 4s var(--out) both}
.v3p .bn{position:absolute;left:0;right:0;top:64px;text-align:center}
.v3p .bn small{display:block;font-size:14px;font-weight:700;color:var(--sub)}
.v3p .bn b{display:block;font-size:76px;font-weight:900;letter-spacing:-.045em;line-height:1.1;font-variant-numeric:tabular-nums}
.v3p .bn p{font-size:15px;font-weight:700;color:var(--mute);opacity:0}
.v3p .s4.on .bn{animation:v3p-bnMove .75s 1.75s var(--io) both}
@keyframes v3p-bnMove{from{transform:translateY(150px) scale(1.12)}to{transform:none}}
.v3p .s4.on .bn p{animation:v3p-fadeUp .45s 1.05s both,v3p-fadeOut .3s 1.75s forwards}
.v3p .cmp{position:absolute;left:40px;right:40px;top:226px;opacity:0}
.v3p .s4.on .cmp{animation:v3p-fadeUp .6s 2.3s var(--out) both}
.v3p .bar{margin-top:16px}
.v3p .bar>span{display:flex;justify-content:space-between;align-items:baseline;font-size:14px;font-weight:700;color:var(--sub);margin-bottom:8px}
.v3p .bar>span>b{font-size:20px;font-weight:800;color:var(--ink);letter-spacing:-.03em;font-variant-numeric:tabular-nums;white-space:nowrap}
.v3p .bar i{display:block;height:14px;border-radius:99px;background:#E6E5E0;position:relative;overflow:hidden}
.v3p .bar i::after{content:"";position:absolute;inset:0;width:var(--w);border-radius:99px;background:var(--c,var(--ink));transform:scaleX(0);transform-origin:left}
.v3p .s4.on .bar i::after{animation:v3p-fill .9s var(--d,2.45s) var(--out) forwards}
.v3p .ax{display:flex;justify-content:space-between;margin-top:8px;font-size:12px;font-weight:600;color:var(--mute)}
.v3p .delta{position:absolute;left:50%;top:394px;height:42px;padding:0 18px;border-radius:99px;background:var(--acc);color:#fff;font-size:14.5px;font-weight:800;display:flex;align-items:center;white-space:nowrap;opacity:0;transform:translateX(-50%)}
.v3p .s4.on .delta{animation:v3p-deltaIn .55s 3.35s var(--out) both}
@keyframes v3p-deltaIn{from{opacity:0;transform:translate(-50%,10px) scale(.9)}to{opacity:1;transform:translate(-50%,0)}}
.v3p .car{position:absolute;left:40px;right:40px;top:456px}
.v3p .car div{display:grid;grid-template-columns:58px 1fr 100px;gap:12px;align-items:center;padding:10px 0;border-top:1px solid #DEDDD8;font-size:13.5px;opacity:0}
.v3p .car b{font-weight:700}
.v3p .car i{display:block;height:8px;border-radius:99px;background:#E6E5E0;position:relative;overflow:hidden}
.v3p .car i::after{content:"";position:absolute;inset:0;width:var(--w);border-radius:99px;background:#9A9A9F}
.v3p .car span{font-weight:600;color:var(--sub);text-align:right;white-space:nowrap}
.v3p .s4.on .car div{animation:v3p-fadeUp .5s both;animation-delay:calc(var(--i)*110ms + 3.85s)}
.v3p .au{width:340px;margin:-128px 0 0 -170px;padding:20px 20px 12px;opacity:0}
.v3p .s5.on .au{animation:v3p-cardIn .6s .1s var(--out) both}
.v3p .au ul{list-style:none;margin-top:12px}
.v3p .au li{display:grid;grid-template-columns:86px 1fr;gap:10px;padding:12px 0;border-top:1px solid var(--line);font-size:13.5px;line-height:1.5;opacity:0}
.v3p .au li b{font-weight:800}
.v3p .s5.on .au li{animation:v3p-fadeUp .5s both;animation-delay:calc(var(--i)*100ms + .45s)}
.v3p .au button{margin:6px 0 4px;font-size:13.5px;font-weight:700;color:var(--acc-t);text-decoration:underline;text-underline-offset:3px}
.v3p .qA .mo-card{border-radius:0}
.v3p .mo-dim{position:absolute;inset:0;background:rgba(11,11,12,.36);opacity:0;transition:opacity .5s;z-index:4}
.v3p .mo[data-ph="6"] .mo-dim{opacity:1}
.v3p .mo-phone{position:absolute;right:6%;bottom:-5%;width:52%;z-index:5;opacity:0;transform:translateY(60%)}
.v3p .mo[data-ph="6"] .mo-phone{opacity:1;transform:none;transition:opacity .35s,transform .75s var(--out)}
.v3p .mo[data-ph="7"] .mo-phone{opacity:0;transform:none;transition:opacity .4s}
.v3p .mo-phone .bub{opacity:0;transform:translateY(5cqi) scale(.96);transform-origin:left bottom}
.v3p .mo[data-ph="6"] .mo-phone .bub{opacity:1;transform:none;transition:opacity .4s .55s,transform .55s .55s var(--out)}
.v3p .track{position:absolute;left:20px;right:20px;bottom:20px;height:48px;border-radius:14px;background:rgba(11,11,12,.8);display:grid;grid-template-columns:repeat(3,1fr);align-items:center;text-align:center;font-size:13px;font-weight:700;color:rgba(255,255,255,.72);overflow:hidden;z-index:6;transition:opacity .4s}
.v3p .track span{transition:color .3s;white-space:nowrap}
.v3p .track span.on{color:#fff}
.v3p .track i{position:absolute;left:0;right:0;bottom:0;height:3px;background:#FF7A45;transform-origin:left;transform:scaleX(var(--p,0));transition:transform .7s var(--out)}
.v3p .mo[data-ph="0"] .track,.v3p .mo[data-ph="6"] .track,.v3p .mo[data-ph="7"] .track{opacity:0}
.v3p .facts{margin-top:24px;display:grid;grid-template-columns:repeat(3,auto);justify-content:start;font-size:13.5px;color:var(--sub)}
.v3p .facts div{padding:0 22px;border-left:1px solid var(--line);white-space:nowrap}
.v3p .facts div:first-child{padding-left:0;border-left:0}
.v3p .facts b{display:block;font-size:19px;font-weight:800;color:var(--ink);letter-spacing:-.03em}
.v3p .trial{margin-top:auto;padding-top:26px}
.v3p .trial .cta{width:100%;height:62px;font-size:18px}
.v3p .lnk{display:flex;gap:18px;justify-content:center;margin-top:12px;font-size:13.5px;color:var(--sub)}
.v3p .lnk button{white-space:nowrap}
.v3p .lnk button:hover{color:var(--ink)}
.v3p .done{display:none;margin-top:auto;align-items:center;gap:14px;border-radius:16px;padding:16px 18px;background:var(--ink);color:#fff;font-weight:700;font-size:16px;line-height:1.4}
.v3p .done small{display:block;font-weight:500;font-size:13px;color:rgba(255,255,255,.75)}
.v3p .done .go{margin-left:auto;height:46px;padding:0 18px;border-radius:12px;background:#fff;color:var(--ink);font-weight:800;font-size:14.5px;display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
.v3p .opened .trial{display:none}
.v3p .opened .done{display:flex;animation:v3p-fadeUp .45s both}
.v3p .scrim{position:fixed}
.v3p .pop{width:calc(100% - 32px);margin:28px 16px}
.v3p .lead{font-size:clamp(13.5px,calc(2.7cqi - 6px),17px)}
.v3p button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.v3p .pop:focus{outline:none}
.v3p .cta[disabled]{opacity:.6;cursor:default;transform:none}
@container stage (max-width:720px){
.v3p .pop{grid-template-columns:1fr;min-height:0;border-radius:24px 24px 0 0;max-height:min(760px,100dvh);overflow-y:auto;width:100%;margin:0;align-self:end}
.v3p .vis{min-height:350px}
.v3p .txt{padding:22px 22px 20px}
.v3p .ln{white-space:normal}
.v3p .hd{font-size:clamp(23px,7.5cqi,27px)}
.v3p .lead{font-size:clamp(12.5px,calc(4.72cqi - 2.1px),15.5px);margin-top:12px}
.v3p .act{margin-top:18px}
.v3p .cta{width:100%}
.v3p .tabs{margin-top:20px}
.v3p .tabs button[data-tab]{font-size:12.5px}
.v3p .chip{height:32px;padding:0 11px;font-size:12.5px}
.v3p .c-st{left:12px;top:12px}
.v3p .c-tm{right:12px;top:12px;min-width:80px}
.v3p .src{left:12px;bottom:12px}
.v3p .toast{bottom:12px;height:38px;font-size:13px;padding:0 14px}
.v3p .s2 .cart{width:300px;margin:-152px 0 0 -150px;padding:18px}
.v3p .cnt{margin-top:2px}
.v3p .cnt b{font-size:40px}
.v3p .send{bottom:58px}
.v3p .sms{margin:-150px 0 0 -148px;font-size:13px;width:296px}
.v3p .s3{--phx:-124px;--phy:-44px;--phs:.7}
.v3p .s3 .phone{width:178px;margin:-161px 0 0 -89px}
.v3p .s3 .toast{bottom:10px}
.v3p .join{width:290px;margin:-140px 0 0 -145px;padding:20px}
.v3p .jr{width:228px;right:8px;margin:-146px 0 0 0;padding:16px 14px 8px}
.v3p .jr .j span,.v3p .jr .uh small{display:none}
.v3p .bn{top:26px}
.v3p .bn b{font-size:54px}
.v3p .cmp{top:122px;left:22px;right:22px}
.v3p .delta{top:298px;height:38px;font-size:13.5px}
.v3p .car{display:none}
.v3p .au{width:300px;margin:-150px 0 0 -150px}
.v3p .au li{grid-template-columns:1fr;gap:2px}
.v3p .track{left:12px;right:12px;bottom:12px;height:42px;font-size:12px}
.v3p .mo-phone{width:74%;right:5%;bottom:5%;aspect-ratio:auto;background:none;padding:0;border-radius:0;box-shadow:none}
.v3p .mo-phone .nt,.v3p .mo-phone .bar0,.v3p .mo-phone .tm,.v3p .mo-phone .bub .im{display:none}
.v3p .mo-phone .scr{background:none;border-radius:0;overflow:visible}
.v3p .mo-phone .th{padding:0}
.v3p .mo-phone .bub{width:100%;background:#fff;box-shadow:0 18px 40px -18px rgba(0,0,0,.6)}
.v3p .sp{right:12px;top:52px}
.v3p .facts div{padding:0 12px}
.v3p .facts b{font-size:16px}
.v3p .done{flex-wrap:wrap;margin-top:22px}
.v3p .done .go{margin-left:0;width:100%;justify-content:center}
}
@media (prefers-reduced-motion:reduce){
.v3p *{animation:none!important;transition:none!important}
.v3p .ln>span{transform:none}
.v3p .msgs>div.on .lead{opacity:1}
.v3p .s2 .cart,.v3p .s2 .cnt,.v3p .s2 .send,.v3p .s3 .join{display:none}
.v3p .s3.on .phone{opacity:1;transform:translate(var(--phx,-134px),var(--phy,0px)) scale(var(--phs,.76))}
.v3p .s3.on .at-row,.v3p .mo[data-ph="6"] .mo-phone .bub{opacity:1;transform:none}
.v3p .s2.on .sms,.v3p .s2.on .toast,.v3p .s3.on .jr,.v3p .s3.on .toast,.v3p .s4.on .cmp,.v3p .s4.on .delta,.v3p .s4.on .car div,.v3p .s5.on .au,.v3p .s5.on .au li{opacity:1}
.v3p .bar i::after{transform:scaleX(1)}
.v3p .tg{background:var(--ink)}
.v3p .tg::after{transform:translateX(16px)}
}`;

/** 로그인 직후 장면 창의 안쪽(무대 네 장면 + 글 + 쪽 번호) */
export const V3_SCENES_HTML = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="v3p-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol><symbol id="v3p-ar" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol><symbol id="v3p-ck" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></symbol><symbol id="v3p-lf" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></symbol><symbol id="v3p-clk" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></symbol><symbol id="v3p-pau" viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></symbol><symbol id="v3p-ply" viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z"/></symbol></svg><div class="vis" data-slides>
        
<div class="sl s1 on" data-ms="5000">
<div class="mo" data-morph data-ph="0">
<div class="im mo-post i-n1" role="img" aria-label="이미지 스튜디오로 만든 포스터"></div>
<div class="mo-wrap"><div class="mo-card"><div class="mo-photo i-sk"></div><div class="mo-ck"></div><div class="beam"></div></div><div class="mo-fly i-ck"></div></div>
<div class="chip c-st" data-status><i></i><span>원본 사진</span></div>
<div class="chip c-tm"><svg class="ic"><use xlink:href="#v3p-clk"/></svg><span data-timer>00:00</span></div>
<div class="src"><div class="im i-sk"></div><div>이 사진 한 장으로<small>약 30초 뒤 완성</small></div></div>
</div>
</div>
        
<div class="sl s2" data-ms="5500">
<span class="eg">예시 화면</span>
<div class="card cart gh g2"></div><div class="card cart gh g1"></div>
<div class="card cart main">
<div class="ch">장바구니<small>결제 전</small></div>
<div class="ci"><div class="im i-sk"></div><div><b>결온 앰버 세럼</b><span>30ml, 1개</span></div></div>
<div class="cf"><span>담은 지 <b>3일</b></span><span>아직 주문하지 않음</span></div>
</div>
<div class="cnt"><small>담아 두고 안 산 고객</small><b><span data-count="128" data-delay="1250">0</span>명</b></div>
<div class="ubtn send">128명에게 보내기 <svg class="ic"><use xlink:href="#v3p-ar"/></svg><svg class="cur" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 8-6.2 1.6L10 19z" fill="#0B0B0C" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
<div class="card sms">(광고)[결온]
김한줄 님, 담아 두신 앰버 세럼이
아직 장바구니에서 기다리고 있어요.

하루의 끝에 바르는 한 방울,
망설이셨다면 오늘 다시 만나 보세요.

장바구니 보기 hanjul.ai/s/kyeolon
무료수신거부 080-000-0000</div>
<div class="toast"><svg class="ic"><use xlink:href="#v3p-ck"/></svg>128명에게 보냈습니다</div>
</div>
        
<div class="sl s3" data-ms="6000">
<span class="eg">예시 화면</span>
<div class="card join">
<div class="uh">결온 회원가입</div>
<div class="jf"><span>이름</span><b>김한줄</b></div>
<div class="jf"><span>휴대폰</span><b>010-0000-0000</b></div>
<div class="jb"><span>가입하기</span><span><svg class="ic"><use xlink:href="#v3p-ck"/></svg>가입 완료</span><svg class="cur" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 8-6.2 1.6L10 19z" fill="#0B0B0C" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
</div>
<div class="phone kk"><div class="nt"></div><div class="scr">
<div class="bar0"><svg class="ic"><use xlink:href="#v3p-lf"/></svg><b>결온</b></div>
<div class="th"><div class="at-row"><div class="at-av">결</div><div><div class="at-nm">결온</div>
<div class="at-wrap"><div class="at">
<div class="at-top">알림톡 도착</div>
<div class="at-em"><small>회원가입 완료</small><b>김한줄 님, 환영합니다</b></div>
<div class="at-bd">결온의 가족이 되어 주셔서
감사합니다.

바쁜 하루 끝, 피부가 쉬어 가는
시간에 결온이 곁에 있겠습니다.

▪ 가입일 2026.11.15
▪ 아이디 hanjul**

궁금한 점이 있으시면
언제든 편하게 물어봐 주세요.</div>
<div class="at-btn">마이페이지 바로가기</div>
</div><span class="at-time">방금</span></div>
</div></div></div>
</div></div>
<div class="card jr">
<div class="uh">켜 둔 여정<small>대상은 자동으로</small></div>
<div class="j"><b>가입 환영</b><em>방금 발송</em><div class="tg on0"></div></div>
<div class="j"><b>장바구니 알림</b><span>담고 1시간 뒤</span><div class="tg" style="--d:3.45s"></div></div>
<div class="j"><b>생일 축하</b><span>생일 아침</span><div class="tg" style="--d:3.6s"></div></div>
<div class="j"><b>휴면 전 안내</b><span>60일 미구매</span><div class="tg" style="--d:3.75s"></div></div>
</div>
<div class="toast"><svg class="ic"><use xlink:href="#v3p-ck"/></svg>대상을 고르지 않아도 자동으로 나갑니다</div>
</div>
        
<div class="sl s4" data-ms="5300">
<span class="eg">예시 화면</span>
<div class="bn"><small>우리 문자 성공률</small><b><span data-count="98.2" data-dec="1" data-delay="200">0.0</span>%</b><p>잘하고 있는 걸까?</p></div>
<div class="cmp">
<div class="bar"><span>우리 회사<b>98.2%</b></span><i style="--w:82%;--c:var(--acc)"></i></div>
<div class="bar"><span>같은 업종 평균<b><span data-count="96.9" data-dec="1" data-delay="2600">0.0</span>%</b></span><i style="--w:69%;--c:#9A9A9F;--d:2.6s"></i></div>
<div class="ax"><span>90%</span><span>막대 눈금</span><span>100%</span></div>
</div>
<div class="delta">같은 업종 평균보다 1.3%p 높습니다</div>
<div class="car">
<div style="--i:0"><b>SKT</b><i style="--w:8%"></i><span>스팸 차단 0.4%</span></div>
<div style="--i:1"><b>KT</b><i style="--w:13%"></i><span>스팸 차단 0.7%</span></div>
<div style="--i:2"><b>LG U+</b><i style="--w:10%"></i><span>스팸 차단 0.5%</span></div>
</div>
</div>
        
</div>
<div class="txt">
<button class="x" data-act="close" aria-label="닫기"><svg class="ic"><use xlink:href="#v3p-x"/></svg></button>
<div class="kick"><i></i>한줄로 V3 업그레이드</div>
<div class="msgs" data-slides>
<div class="on"><h3 class="hd"><span class="ln" style="--i:0"><span>제품 사진 한 장이</span></span><span class="ln" style="--i:1"><span><em>포스터</em>가 됩니다</span></span></h3><p class="lead">사진을 올리고 문구만 적으면<br>약 30초 뒤 완성본이 나옵니다.<br>문자, 모바일 DM, 이메일에 그대로 씁니다.</p></div>
<div><h3 class="hd"><span class="ln" style="--i:0"><span><em>담아 두고 안 산</em> 고객에게</span></span><span class="ln" style="--i:1"><span>바로 보냅니다</span></span></h3><p class="lead">장바구니에 담아 두기만 한 고객, 보고도 안 산 고객을<br>세어 두었다가 그 자리에서 문자를 보냅니다.</p></div>
<div><h3 class="hd"><span class="ln" style="--i:0"><span>가입하는 순간,</span></span><span class="ln" style="--i:1"><span><em>환영 인사</em>가 먼저 갑니다</span></span></h3><p class="lead">여정을 한 번 켜 두면 가입, 장바구니, 생일, 휴면까지<br>대상을 고르지 않아도 때맞춰 나갑니다.</p></div>
<div><h3 class="hd"><span class="ln" style="--i:0"><span><em>같은 업종 평균</em>을</span></span><span class="ln" style="--i:1"><span>바로 옆에 놓습니다</span></span></h3><p class="lead">우리 숫자만 보고 짐작하지 않아도 됩니다.<br>같은 업종 평균이 성과 옆에 함께 보입니다.</p></div>
</div>
<div class="act"><button class="cta" data-act="go">이미지 스튜디오 보기 <svg class="ic"><use xlink:href="#v3p-ar"/></svg></button><button class="ghost" data-act="later">다음에 볼게요</button><button class="ghost" data-act="dismiss">이 소개 다시 보지 않기</button></div>
<div class="tabs">
<button data-tab class="on"><b>01</b>포스터</button><button data-tab><b>02</b>미구매 고객</button><button data-tab><b>03</b>자동 발송</button><button data-tab><b>04</b>업종 비교</button>
<button class="pp" data-pp aria-label="자동 넘김 멈춤"><svg class="ic"><use xlink:href="#v3p-pau"/></svg><svg class="ic"><use xlink:href="#v3p-ply"/></svg></button>
</div>
</div>`;

/** 무료체험 창의 안쪽(무대 + 글 + 신청 버튼) */
export const V3_TRIAL_HTML = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="v3p-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol><symbol id="v3p-ar" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol><symbol id="v3p-ck" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></symbol><symbol id="v3p-lf" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></symbol><symbol id="v3p-clk" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></symbol><symbol id="v3p-pau" viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></symbol><symbol id="v3p-ply" viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z"/></symbol></svg><div class="vis">
<div class="mo" data-morph="loop" data-ph="0">
<div class="mo-wrap"><div class="mo-card"><div class="mo-photo i-sk"></div><div class="mo-ck"></div><div class="beam"></div></div><div class="mo-fly i-ck"></div></div>
<div class="im mo-post i-n1" role="img" aria-label="이미지 스튜디오로 만든 포스터"></div>
<div class="mo-dim"></div>
<div class="phone mo-phone"><div class="nt"></div><div class="scr">
<div class="bar0"><b data-ph-name>결온</b>문자 메시지</div>
<div class="th"><div class="tm">오늘 오전 11:02</div><div class="bub"><div class="im i-n1" data-ph-img></div><p data-ph-text></p></div></div>
</div></div>
<div class="chip c-st" data-status><i></i><span>원본 사진</span></div>
<div class="chip c-tm"><svg class="ic"><use xlink:href="#v3p-clk"/></svg><span data-timer>00:00</span></div>
<div class="track"><span>1 원본 사진</span><span>2 배경 자동 제거</span><span>3 포스터 완성</span><i></i></div>
<button class="pp sp" data-stop aria-label="장면 반복 멈춤"><svg class="ic"><use xlink:href="#v3p-pau"/></svg><svg class="ic"><use xlink:href="#v3p-ply"/></svg></button>
</div>
</div>
<div class="txt">
<button class="x" data-act="close" aria-label="닫기"><svg class="ic"><use xlink:href="#v3p-x"/></svg></button>
<div class="kick rise" style="--i:0"><i></i>이미지 스튜디오 무료체험</div>
<h3 class="hd" style="margin-top:18px"><span class="ln" style="--i:0"><span>제품 사진만 올리세요.</span></span><span class="ln" style="--i:1"><span><em>포스터</em>는 한줄로가 만듭니다.</span></span></h3>
<p class="lead rise" style="--i:4">갖고 계신 제품 사진에서 <b>배경을 지우고(누끼)</b>,<br>문구를 얹어 <b>포스터 한 장으로 합성</b>합니다.<br>완성본은 지금 쓰시는 <b>MMS에 바로 붙여</b> 보냅니다.</p>
<div class="facts rise" style="--i:6"><div><b>무료 3회</b>포스터 3장</div><div><b>기한 없음</b>언제든 사용</div><div><b>가입 없이</b>요금제 그대로</div></div>
<div class="trial rise" style="--i:8"><button class="cta" data-act="trial">무료체험 3회 이용하고 싶습니다 <svg class="ic"><use xlink:href="#v3p-ar"/></svg></button>
<div class="lnk"><button data-act="later">다음에 볼게요</button><button data-act="dismiss">이 안내 다시 보지 않기</button></div></div>
<div class="done"><svg class="ic"><use xlink:href="#v3p-ck"/></svg><div>무료체험 3회가 열렸습니다<small data-remaining>남은 횟수 3회</small></div><button class="go" data-act="studio">이미지 스튜디오로 가기 <svg class="ic"><use xlink:href="#v3p-ar"/></svg></button></div>
</div>`;

/**
 * 누끼 → 포스터에 쓰는 세 업종.
 *   c = 누끼 사진 속 제품의 가운데(가로 · 세로)와 폭 · p = 포스터 속 그 제품의 가운데와 폭(그림마다 잰 값 · 0 ~ 1)
 *   text = 그 포스터가 붙어 나가는 MMS 문안(광고 표기 + 무료수신거부 · 줄 단위)
 */
export interface V3MorphSet { src: string; cut: string; post: string; c: [number, number, number]; p: [number, number, number]; name: string; text: string }
export const V3_MORPH_SETS: readonly V3MorphSet[] = [
  { src: 'i-sk', cut: 'i-ck', post: 'i-n1', c: [0.498, 0.504, 0.215], p: [0.681, 0.613, 0.1146], name: '결온',
    text: '(광고)[결온]\n밤사이 채우는 윤기, 앰버 세럼\n\n하루의 끝, 세안 뒤 한 방울이면\n아침 피부가 달라집니다.\n이번 주 일요일까지\n회원 감사 주간이 이어집니다.\n\nhanjul.ai/s/kyeolon\n무료수신거부 080-000-0000' },
  { src: 'i-so', cut: 'i-co', post: 'i-n3', c: [0.496, 0.566, 0.641], p: [0.496, 0.549, 0.343], name: '오후담',
    text: '(광고)[오후담]\n겨울 시즌 메뉴, 메이플 크림 라떼\n\n찬 바람 부는 오후,\n따뜻한 한 잔이 생각날 때\n창가 자리를 비워 두겠습니다.\n\nhanjul.ai/s/ohudam\n무료수신거부 080-000-0000' },
  { src: 'i-ss', cut: 'i-cs', post: 'i-n4', c: [0.486, 0.49, 0.668], p: [0.54, 0.655, 0.62], name: '소요웨어',
    text: '(광고)[소요웨어]\n첫 추위엔 울 니트\n\n올겨울 처음 꺼내 입는 니트,\n포근한 케이블 짜임으로 준비했습니다.\n윈터 컬렉션이 지금 열렸습니다.\n\nhanjul.ai/s/soyo\n무료수신거부 080-000-0000' },
];
