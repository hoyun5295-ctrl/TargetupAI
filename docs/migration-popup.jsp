<%@ page language="java" contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<%--
  한줄로AI 이관 안내 팝업 (레거시 invitobiz.com 삽입용)
  - 배치: /www/usom/WebContent/inc/migration-popup.jsp
  - 삽입: footer.jsp 맨 끝에 <%@ include file="migration-popup.jsp" %> 1줄
  - 제거: footer.jsp include 1줄 삭제 + 본 파일 rm
  - 공유 Pretendard 웹폰트를 내부에서 1회 주입 (중복 주입은 브라우저가 자동 무시)
--%>
<!-- HANJUL_MIGRATION_POPUP_START -->
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable.css" rel="stylesheet">
<div id="hanjulPopup" style="position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:hjpIn .3s ease;font-family:'Pretendard Variable','Pretendard',-apple-system,'Malgun Gothic',sans-serif">
<div id="hjpCard" style="width:520px;max-width:92vw;max-height:90vh;overflow-y:auto;border-radius:24px;background:#fff;box-shadow:0 25px 50px -12px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.1);animation:hjpSlide .45s cubic-bezier(.175,.885,.32,1.1)">

  <!-- 상단 히어로 -->
  <div style="position:relative;padding:40px 40px 32px;background:linear-gradient(135deg,#059669 0%,#0f766e 35%,#155e75 65%,#1e40af 100%);border-radius:24px 24px 0 0;overflow:hidden">
    <div style="position:absolute;top:-80px;right:-80px;width:240px;height:240px;border-radius:50%;border:1px solid rgba(255,255,255,0.08)"></div>
    <div style="position:absolute;top:-40px;right:-40px;width:160px;height:160px;border-radius:50%;border:1px solid rgba(255,255,255,0.05)"></div>
    <div style="position:absolute;bottom:-60px;left:-60px;width:200px;height:200px;border-radius:50%;background:rgba(255,255,255,0.03)"></div>
    <div style="position:relative;margin-bottom:14px;display:flex;align-items:center;gap:8px">
      <div style="width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#fff;letter-spacing:-0.5px">한</div>
      <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;line-height:1">한줄로<span style="color:#a7f3d0;margin-left:2px">AI</span></div>
    </div>
    <div style="position:relative">
      <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.3px">AI 비즈메세징 플랫폼</h2>
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.65);font-weight:400">AI 타겟 분석부터 캠페인 발송까지, 기업형 비즈메세징을 한번에</p>
    </div>
  </div>

  <!-- 안내 메시지 -->
  <div style="padding:28px 40px 0">
    <p style="margin:0;font-size:15px;color:#374151;line-height:1.85;word-break:keep-all;text-align:center">
      그동안 이용해주신 고객사 여러분께 감사드리며,<br>
      AI 시대를 맞이하여 <b style="color:#059669">한줄로AI</b> 서비스를 오픈하였습니다.
    </p>
  </div>

  <!-- 대표 기능 그리드 -->
  <div style="padding:24px 40px 0">
    <div style="font-size:12px;font-weight:600;color:#9ca3af;letter-spacing:2px;margin-bottom:14px">FEATURES</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="padding:16px;background:#f0fdf4;border-radius:14px;border:1px solid #dcfce7">
        <div style="font-size:20px;margin-bottom:8px">&#9889;</div>
        <div style="font-size:13px;font-weight:700;color:#065f46;margin-bottom:4px">AI 한줄로</div>
        <div style="font-size:11px;color:#6b7280;line-height:1.5">한 줄 입력으로 타겟 추출부터<br>메시지 생성, 발송까지 자동</div>
      </div>
      <div style="padding:16px;background:#eff6ff;border-radius:14px;border:1px solid #dbeafe">
        <div style="font-size:20px;margin-bottom:8px">&#127919;</div>
        <div style="font-size:13px;font-weight:700;color:#1e40af;margin-bottom:4px">AI 맞춤타겟</div>
        <div style="font-size:11px;color:#6b7280;line-height:1.5">고객 DB 분석으로 최적의<br>타겟 자동 추출 및 세그먼트</div>
      </div>
      <div style="padding:16px;background:#fefce8;border-radius:14px;border:1px solid #fef08a">
        <div style="font-size:20px;margin-bottom:8px">&#128640;</div>
        <div style="font-size:13px;font-weight:700;color:#854d0e;margin-bottom:4px">자동발송</div>
        <div style="font-size:11px;color:#6b7280;line-height:1.5">매월/매주/매일 반복 발송을<br>한 번 설정으로 자동 운영</div>
      </div>
      <div style="padding:16px;background:#fdf2f8;border-radius:14px;border:1px solid #fce7f3">
        <div style="font-size:20px;margin-bottom:8px">&#128737;</div>
        <div style="font-size:13px;font-weight:700;color:#9d174d;margin-bottom:4px">스팸필터 테스트</div>
        <div style="font-size:11px;color:#6b7280;line-height:1.5">SKT/KT/LGU+ 3사<br>실시간 스팸 여부 사전 검증</div>
      </div>
    </div>
  </div>

  <!-- 혜택 + 이관 안내 -->
  <div style="padding:20px 40px 0">
    <div style="background:linear-gradient(135deg,#ecfdf5,#f0f9ff);border:1px solid #d1fae5;border-radius:14px;padding:18px 20px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="width:6px;height:6px;border-radius:50%;background:#059669;flex-shrink:0;margin-top:7px"></div>
        <span style="font-size:13px;color:#1f2937;line-height:1.6">기존과 동일한 발송 기능이 <b style="color:#059669">모두 내장</b>되어 있습니다</span>
      </div>
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="width:6px;height:6px;border-radius:50%;background:#ef4444;flex-shrink:0;margin-top:7px"></div>
        <span style="font-size:13px;color:#1f2937;line-height:1.6">기존 고객사께 <b style="color:#ef4444">30일 무료체험</b>을 제공해 드립니다</span>
      </div>
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="width:6px;height:6px;border-radius:50%;background:#d97706;flex-shrink:0;margin-top:7px"></div>
        <span style="font-size:13px;color:#1f2937;line-height:1.6"><b style="color:#d97706">주소록은 이관되지 않습니다.</b> 한줄로AI에서 엑셀 파일로 새로 업로드해 주세요</span>
      </div>
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="width:6px;height:6px;border-radius:50%;background:#0284c7;flex-shrink:0;margin-top:7px"></div>
        <span style="font-size:13px;color:#1f2937;line-height:1.6"><b style="color:#0284c7">기존 아이디</b>와 <b style="color:#0284c7">관리자가 안내한 임시 비밀번호</b>로 로그인 후 원하는 비밀번호로 변경해 주세요</span>
      </div>
    </div>
  </div>

  <!-- 문의 안내 -->
  <div style="padding:14px 40px 0">
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:12px 16px;display:flex;align-items:center;gap:10px">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c2410c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
      <span style="font-size:13px;color:#7c2d12;line-height:1.5">로그인이 안되시나요? <b style="color:#c2410c">1800-8125</b>로 문의해 주세요</span>
    </div>
  </div>

  <!-- CTA -->
  <div style="padding:24px 40px 0">
    <a href="https://hanjul.ai/" target="_blank" id="hjpCta" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:16px 24px;background:#059669;color:#fff;font-size:15px;font-weight:600;border-radius:14px;text-decoration:none;letter-spacing:0.2px;transition:all .2s;box-shadow:0 4px 14px rgba(5,150,105,0.3)" onmouseover="this.style.background='#047857';this.style.transform='translateY(-1px)';this.style.boxShadow='0 8px 24px rgba(5,150,105,0.35)'" onmouseout="this.style.background='#059669';this.style.transform='';this.style.boxShadow='0 4px 14px rgba(5,150,105,0.3)'">
      한줄로AI 바로가기
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
    </a>
  </div>

  <!-- 하단 -->
  <div style="padding:16px 40px 18px;margin-top:20px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #f3f4f6">
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:#9ca3af;user-select:none">
      <input type="checkbox" id="hanjulPopupClose" style="width:14px;height:14px;accent-color:#059669;cursor:pointer">
      오늘 다시 보지 않음
    </label>
    <button onclick="closeHanjulPopup()" style="background:none;border:none;padding:6px 14px;font-size:12px;color:#9ca3af;cursor:pointer;border-radius:6px;font-family:inherit;transition:all .15s" onmouseover="this.style.background='#f3f4f6';this.style.color='#374151'" onmouseout="this.style.background='none';this.style.color='#9ca3af'">닫기</button>
  </div>

</div>
</div>

<style>
@keyframes hjpIn{from{opacity:0}to{opacity:1}}
@keyframes hjpSlide{from{opacity:0;transform:scale(.96) translateY(12px)}to{opacity:1;transform:scale(1) translateY(0)}}
@media(max-width:480px){
  #hjpCard{border-radius:20px 20px 0 0!important;max-height:95vh!important;margin-top:auto!important}
  #hanjulPopup{align-items:flex-end!important}
}
</style>
<script>
function closeHanjulPopup(){
  if(document.getElementById('hanjulPopupClose').checked){
    var d=new Date();d.setHours(23,59,59,0);
    document.cookie='hanjul_popup_closed=1; expires='+d.toUTCString()+'; path=/';
  }
  var el=document.getElementById('hanjulPopup');
  el.style.opacity='0';el.style.transition='opacity .2s';
  setTimeout(function(){el.style.display='none'},200);
}
(function(){
  if(document.cookie.indexOf('hanjul_popup_closed=1')!==-1){
    var el=document.getElementById('hanjulPopup');
    if(el)el.style.display='none';
  }
})();
</script>
<!-- HANJUL_MIGRATION_POPUP_END -->
