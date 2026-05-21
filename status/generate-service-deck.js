// 한줄로 (TargetUp) 서비스 소개서 — 모노크롬 톤 (로고 정합)
// 컬러: 검정 + 흰색 + 1 액센트 (라임 #C7F284) — 한줄로 로고 미니멀 톤 정합
// 폰트: Pretendard (Windows fallback: Malgun Gothic + Calibri)

const pptxgen = require('pptxgenjs');
const pres = new pptxgen();

pres.layout = 'LAYOUT_WIDE'; // 13.3 x 7.5 inch
pres.author = '한줄로 (TargetUp)';
pres.title = '한줄로 서비스 소개서';
pres.subject = '한국 마케팅 통합 자동화 SaaS';

// ════════════════════════════════════════
// 모노크롬 컬러 매트릭스
// ════════════════════════════════════════
const C = {
  black: '0A0A0A',        // 진검정 (로고 톤)
  ink: '171717',          // 잉크
  inkSoft: '262626',      // 다크 그레이
  graphite: '525252',     // 그래파이트
  steel: '737373',        // 미들 그레이
  mist: 'A3A3A3',         // 미스트
  fog: 'D4D4D4',          // 포그
  pale: 'E5E5E5',         // 페일
  bg: 'F5F5F5',           // 거의 화이트
  white: 'FFFFFF',
  accent: 'C7F284',       // 라임 (단 하나의 액센트)
  accentDark: '84CC16',   // 라임 진한
};

// Pretendard 폰트 (Windows fallback)
const FONT_HEAD = 'Pretendard';
const FONT_BODY = 'Pretendard';

const TOTAL = 16;

// ════════════════════════════════════════
// 헬퍼
// ════════════════════════════════════════
function darkHeaderBar(slide) {
  slide.addText('한줄로___', {
    x: 0.5, y: 0.35, w: 4, h: 0.4,
    fontFace: FONT_HEAD, fontSize: 14, color: C.ink, bold: true, margin: 0,
    charSpacing: 1,
  });
  slide.addText('TargetUp', {
    x: 8, y: 0.35, w: 4.8, h: 0.4,
    fontFace: FONT_BODY, fontSize: 11, color: C.steel, align: 'right', margin: 0,
    charSpacing: 2,
  });
  slide.addShape(pres.shapes.LINE, {
    x: 0.5, y: 0.85, w: 12.3, h: 0,
    line: { color: C.pale, width: 0.5 },
  });
}

function footerBar(slide, pageNum) {
  slide.addShape(pres.shapes.LINE, {
    x: 0.5, y: 7.05, w: 12.3, h: 0,
    line: { color: C.pale, width: 0.5 },
  });
  slide.addText('hanjul.ai', {
    x: 0.5, y: 7.15, w: 6, h: 0.3,
    fontFace: FONT_BODY, fontSize: 10, color: C.steel, margin: 0,
  });
  slide.addText(`${String(pageNum).padStart(2, '0')} / ${TOTAL}`, {
    x: 7, y: 7.15, w: 5.8, h: 0.3,
    fontFace: FONT_BODY, fontSize: 10, color: C.steel, align: 'right', charSpacing: 2, margin: 0,
  });
}

function slideTitle(slide, text, subtitle) {
  slide.addText(text, {
    x: 0.5, y: 1.3, w: 12.3, h: 0.9,
    fontFace: FONT_HEAD, fontSize: 38, color: C.black, bold: true, margin: 0,
  });
  // 굵은 underscore 모티프
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 2.2, w: 0.6, h: 0.08,
    fill: { color: C.black }, line: { type: 'none' },
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.5, y: 2.4, w: 12.3, h: 0.4,
      fontFace: FONT_BODY, fontSize: 14, color: C.graphite, margin: 0,
    });
  }
}

// ════════════════════════════════════════
// Slide 1 — 표지 (다크 + 로고 정합)
// ════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.black };

  // 한줄로 로고 표기
  s.addText('한줄로', {
    x: 0.8, y: 2.3, w: 10, h: 1.6,
    fontFace: FONT_HEAD, fontSize: 110, color: C.white, bold: true, margin: 0,
  });

  // 긴 underscore (로고 모티프)
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.5, y: 3.55, w: 3.5, h: 0.18,
    fill: { color: C.white }, line: { type: 'none' },
  });

  // TargetUp + 라임 점
  s.addShape(pres.shapes.OVAL, {
    x: 0.8, y: 4.2, w: 0.18, h: 0.18,
    fill: { color: C.accent }, line: { type: 'none' },
  });
  s.addText('TargetUp', {
    x: 1.1, y: 4.05, w: 8, h: 0.5,
    fontFace: FONT_BODY, fontSize: 22, color: C.fog, charSpacing: 6, margin: 0,
  });

  // 한 줄 카피
  s.addText('한 줄로 끝내는 마케팅 자동화', {
    x: 0.8, y: 5.0, w: 11, h: 0.6,
    fontFace: FONT_HEAD, fontSize: 32, color: C.white, bold: true, margin: 0,
  });
  s.addText('SMS · 알림톡 · Email · Push · AI Operator — 한국 마케팅 통합 솔루션', {
    x: 0.8, y: 5.65, w: 12, h: 0.4,
    fontFace: FONT_BODY, fontSize: 14, color: C.mist, margin: 0,
  });

  // 하단 메타
  s.addShape(pres.shapes.LINE, {
    x: 0.5, y: 6.7, w: 12.3, h: 0,
    line: { color: C.inkSoft, width: 0.5 },
  });
  s.addText('hanjul.ai', {
    x: 0.5, y: 6.85, w: 6, h: 0.3,
    fontFace: FONT_BODY, fontSize: 11, color: C.fog, bold: true, margin: 0,
  });
  s.addText('2026 SERVICE INTRODUCTION', {
    x: 7, y: 6.85, w: 5.8, h: 0.3,
    fontFace: FONT_BODY, fontSize: 11, color: C.steel, align: 'right', charSpacing: 4, margin: 0,
  });
}

// ════════════════════════════════════════
// Slide 2 — 한국 마케팅 담당자의 현실
// ════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  darkHeaderBar(s);
  slideTitle(s, '한국 마케팅 담당자의 현실', '매일 부딪히는 4가지 어려움');

  const problems = [
    { title: '흩어진 고객 데이터', desc: '엑셀 · 자사몰 · CRM — 한 곳에서 보지 못함' },
    { title: '여러 발송 도구의 분산', desc: 'SMS · 알림톡 · Email 각각 다른 시스템' },
    { title: '복잡한 캠페인 세팅', desc: '타겟 · 메시지 · 시점 · 비용 검토 부담' },
    { title: '광고 · 법규 검토 부담', desc: '(광고) 표기 · 080 수신거부 · 발송 시간 · 스팸' },
  ];
  const cardW = 5.85, cardH = 1.8, gapX = 0.5, gapY = 0.3;
  const startX = 0.5, startY = 3.1;
  problems.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.bg }, line: { type: 'none' },
    });
    s.addText(`0${i + 1}`, {
      x: x + 0.4, y: y + 0.25, w: 1.5, h: 0.5,
      fontFace: FONT_HEAD, fontSize: 14, color: C.steel, bold: true, charSpacing: 3, margin: 0,
    });
    s.addText(p.title, {
      x: x + 0.4, y: y + 0.65, w: cardW - 0.8, h: 0.55,
      fontFace: FONT_HEAD, fontSize: 20, color: C.black, bold: true, margin: 0,
    });
    s.addText(p.desc, {
      x: x + 0.4, y: y + 1.2, w: cardW - 0.8, h: 0.5,
      fontFace: FONT_BODY, fontSize: 13, color: C.graphite, margin: 0,
    });
  });
  footerBar(s, 2);
}

// ════════════════════════════════════════
// Slide 3 — 한줄로의 답
// ════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  darkHeaderBar(s);
  slideTitle(s, '한줄로의 답', '한국 마케팅 자동화의 새로운 기준');

  const answers = [
    { title: '모든 채널 한 곳', desc: 'SMS · LMS · MMS · 알림톡 · Email · Push 통합' },
    { title: '한국 통신 100%', desc: '정보통신망법 · 통신사 표준 자동 준수' },
    { title: '학습하는 AI', desc: '사용할수록 브랜드 톤이 더 정확해집니다' },
    { title: '즉시 시작', desc: '시스템 구축 없이 1분 안 첫 캠페인 발송' },
  ];
  const cardW = 2.95, cardH = 3.5;
  const startX = 0.55, gapX = 0.15, startY = 3.0;
  answers.forEach((a, i) => {
    const x = startX + i * (cardW + gapX);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: startY, w: cardW, h: cardH,
      fill: { color: C.white }, line: { color: C.fog, width: 1 },
    });
    // 큰 숫자
    s.addText(`0${i + 1}`, {
      x: x + 0.3, y: startY + 0.3, w: cardW - 0.6, h: 1.2,
      fontFace: FONT_HEAD, fontSize: 64, color: C.black, bold: true, margin: 0,
    });
    // underscore 액센트
    s.addShape(pres.shapes.RECTANGLE, {
      x: x + 0.3, y: startY + 1.6, w: 0.5, h: 0.08,
      fill: { color: C.black }, line: { type: 'none' },
    });
    s.addText(a.title, {
      x: x + 0.3, y: startY + 1.85, w: cardW - 0.6, h: 0.6,
      fontFace: FONT_HEAD, fontSize: 18, color: C.black, bold: true, margin: 0,
    });
    s.addText(a.desc, {
      x: x + 0.3, y: startY + 2.5, w: cardW - 0.6, h: 0.9,
      fontFace: FONT_BODY, fontSize: 12, color: C.graphite, margin: 0,
    });
  });
  footerBar(s, 3);
}

// ════════════════════════════════════════
// Slide 4 — 전체 서비스 한눈에
// ════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  darkHeaderBar(s);
  slideTitle(s, '전체 서비스 한눈에', '발송 · 데이터 · AI · 자동화 · 안전 · 운영');

  const cats = [
    { title: '발송 채널', items: 'SMS · LMS · MMS · 알림톡 · 친구톡 · Email · Web Push · In-app' },
    { title: '고객 데이터', items: '고객 DB · 주소록 · 자사몰 연동 · 엑셀 자동 매핑 · 실시간 행동' },
    { title: 'AI 자동화', items: 'AI 메시지 · AI 타겟 · AI Operator · 여정 자동화 · 영구 운영' },
    { title: '자동 발송', items: '예약 발송 · 정기 발송 · 트리거 발송 · 모바일 DM 빌더' },
    { title: '4중 안전망', items: '광고 표기 · 080 수신거부 · 발송 시간 · KISA 제목 · 스팸 검수' },
    { title: '운영 + 학습', items: '성과 리포트 · 채널별 매트릭스 · 다음 액션 추천 · 톤 학습' },
  ];
  const cardW = 4.0, cardH = 2.0;
  const startX = 0.5, startY = 3.0, gapX = 0.15, gapY = 0.2;
  cats.forEach((c, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.bg }, line: { type: 'none' },
    });
    s.addText(`0${i + 1}`, {
      x: x + 0.3, y: y + 0.25, w: 1, h: 0.4,
      fontFace: FONT_HEAD, fontSize: 12, color: C.steel, bold: true, charSpacing: 3, margin: 0,
    });
    s.addText(c.title, {
      x: x + 0.3, y: y + 0.65, w: cardW - 0.6, h: 0.5,
      fontFace: FONT_HEAD, fontSize: 18, color: C.black, bold: true, margin: 0,
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: x + 0.3, y: y + 1.15, w: 0.4, h: 0.05,
      fill: { color: C.black }, line: { type: 'none' },
    });
    s.addText(c.items, {
      x: x + 0.3, y: y + 1.3, w: cardW - 0.6, h: 0.65,
      fontFace: FONT_BODY, fontSize: 11, color: C.graphite, margin: 0,
    });
  });
  footerBar(s, 4);
}

// ════════════════════════════════════════
// Slide 5 — 발송 채널 8종
// ════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  darkHeaderBar(s);
  slideTitle(s, '발송 채널', '국내외 8개 채널을 한 곳에서');

  const channels = [
    { name: 'SMS', bytes: '90 bytes', desc: '단문 · 짧고 빠른 안내' },
    { name: 'LMS', bytes: '2,000 bytes', desc: '장문 · 풍성한 본문' },
    { name: 'MMS', bytes: '2,000 + 이미지', desc: '이미지 첨부' },
    { name: '카카오 알림톡', bytes: '검수 템플릿', desc: '거래 안내 · 본인 인증' },
    { name: '카카오 친구톡', bytes: '자유 본문', desc: '플러스 친구 마케팅' },
    { name: 'Email', bytes: '글로벌 표준', desc: '뉴스레터 · 거래 메일' },
    { name: 'Web Push', bytes: 'PC · 모바일', desc: '브라우저 푸시 알림' },
    { name: 'In-app 메시지', bytes: '자사몰 안', desc: '배너 · 모달 · 팝업' },
  ];
  const cardW = 3.0, cardH = 1.55;
  const startX = 0.5, startY = 3.0, gapX = 0.15, gapY = 0.2;
  channels.forEach((c, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.white }, line: { color: C.fog, width: 1 },
    });
    s.addText(c.name, {
      x: x + 0.25, y: y + 0.2, w: cardW - 0.5, h: 0.45,
      fontFace: FONT_HEAD, fontSize: 16, color: C.black, bold: true, margin: 0,
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: x + 0.25, y: y + 0.7, w: 0.3, h: 0.04,
      fill: { color: C.black }, line: { type: 'none' },
    });
    s.addText(c.bytes, {
      x: x + 0.25, y: y + 0.8, w: cardW - 0.5, h: 0.3,
      fontFace: FONT_BODY, fontSize: 11, color: C.inkSoft, bold: true, margin: 0,
    });
    s.addText(c.desc, {
      x: x + 0.25, y: y + 1.1, w: cardW - 0.5, h: 0.4,
      fontFace: FONT_BODY, fontSize: 10, color: C.steel, margin: 0,
    });
  });
  s.addText('통합 발송 결과 — 채널별 도달률 · 성공률 · 비용 한눈에', {
    x: 0.5, y: 6.55, w: 12.3, h: 0.3,
    fontFace: FONT_BODY, fontSize: 13, color: C.graphite, italic: true, align: 'center', margin: 0,
  });
  footerBar(s, 5);
}

// ════════════════════════════════════════
// Slide 6 — 카카오 3 채널
// ════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  darkHeaderBar(s);
  slideTitle(s, '카카오 채널 통합', '알림톡 · 친구톡 · 브랜드메시지');

  const ka = [
    { name: '알림톡', tag: '거래 안내', desc: '주문 · 배송 · 결제 · 본인 인증 — 검수 통과 템플릿' },
    { name: '친구톡', tag: '마케팅', desc: '플러스 친구 대상 — 자유 본문 · 이미지 · 버튼' },
    { name: '브랜드메시지', tag: '빠른 발송', desc: '검수 없이 빠른 발송 — 자체 브랜드 채널' },
  ];
  ka.forEach((k, i) => {
    const x = 0.5, y = 3.0 + i * 1.3;
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 6.0, h: 1.15,
      fill: { color: C.bg }, line: { type: 'none' },
    });
    s.addText(k.name, {
      x: x + 0.3, y: y + 0.2, w: 2.5, h: 0.5,
      fontFace: FONT_HEAD, fontSize: 22, color: C.black, bold: true, margin: 0,
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: x + 3.0, y: y + 0.3, w: 1.4, h: 0.3,
      fill: { color: C.black }, line: { type: 'none' },
    });
    s.addText(k.tag, {
      x: x + 3.0, y: y + 0.3, w: 1.4, h: 0.3,
      fontFace: FONT_BODY, fontSize: 10, color: C.white, bold: true, align: 'center', valign: 'middle', margin: 0,
    });
    s.addText(k.desc, {
      x: x + 0.3, y: y + 0.7, w: 5.4, h: 0.4,
      fontFace: FONT_BODY, fontSize: 12, color: C.graphite, margin: 0,
    });
  });

  // 오른쪽 — 통합 운영
  s.addShape(pres.shapes.RECTANGLE, {
    x: 6.8, y: 3.0, w: 6.0, h: 3.9,
    fill: { color: C.black }, line: { type: 'none' },
  });
  s.addText('통합 운영', {
    x: 7.0, y: 3.15, w: 5.6, h: 0.5,
    fontFace: FONT_HEAD, fontSize: 20, color: C.white, bold: true, margin: 0,
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 7.0, y: 3.65, w: 0.5, h: 0.06,
    fill: { color: C.accent }, line: { type: 'none' },
  });
  const ops = [
    { t: '발신 프로필 관리', d: '카카오 검수 통과 발신 프로필 통합' },
    { t: '템플릿 검수 추적', d: '카카오 검수 상태 실시간 추적 · 알림' },
    { t: '카테고리 자동 매핑', d: '템플릿 카테고리 6자리 자동 분류' },
    { t: '미전송 자동 대비', d: '알림톡 실패 시 SMS · LMS 자동 폴백' },
  ];
  ops.forEach((o, i) => {
    const y = 3.9 + i * 0.72;
    s.addText(`0${i + 1}`, {
      x: 7.0, y, w: 0.6, h: 0.3,
      fontFace: FONT_HEAD, fontSize: 12, color: C.mist, bold: true, charSpacing: 2, margin: 0,
    });
    s.addText(o.t, {
      x: 7.7, y: y - 0.05, w: 5.0, h: 0.4,
      fontFace: FONT_HEAD, fontSize: 14, color: C.white, bold: true, margin: 0,
    });
    s.addText(o.d, {
      x: 7.7, y: y + 0.32, w: 5.0, h: 0.4,
      fontFace: FONT_BODY, fontSize: 11, color: C.fog, margin: 0,
    });
  });
  footerBar(s, 6);
}

// ════════════════════════════════════════
// Slide 7 — 고객 DB + 주소록
// ════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  darkHeaderBar(s);
  slideTitle(s, '고객 DB · 주소록', '엑셀에서 시작 → 통합 고객 데이터로');

  const features = [
    { num: '01', title: '엑셀 자동 매핑', desc: '컬럼 자동 인식 — 이름 · 연락처 · 등급 · 생일 · 매장' },
    { num: '02', title: '대량 업로드', desc: '13만+ 고객도 안전하게 — 진행 표시 · 중복 자동 제거' },
    { num: '03', title: '브랜드 격리', desc: '멀티 브랜드 운영 — 매장별 사용자 권한 분리' },
    { num: '04', title: '주소록 그룹', desc: '캠페인별 그룹 · 발송 이력 · 등급별 자동 분류' },
    { num: '05', title: '동적 필드', desc: 'VIP 등급 · 구매 횟수 · 매장 · 사용자 정의 무제한' },
    { num: '06', title: '수신거부 동기화', desc: '080 수신거부 자동 반영 — 발송 즉시 차단' },
  ];
  const cardW = 4.0, cardH = 1.4;
  const startX = 0.5, startY = 3.0, gapX = 0.15, gapY = 0.2;
  features.forEach((f, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.bg }, line: { type: 'none' },
    });
    s.addText(f.num, {
      x: x + 0.25, y: y + 0.15, w: 0.8, h: 0.35,
      fontFace: FONT_HEAD, fontSize: 12, color: C.steel, bold: true, charSpacing: 2, margin: 0,
    });
    s.addText(f.title, {
      x: x + 0.25, y: y + 0.5, w: cardW - 0.5, h: 0.45,
      fontFace: FONT_HEAD, fontSize: 16, color: C.black, bold: true, margin: 0,
    });
    s.addText(f.desc, {
      x: x + 0.25, y: y + 0.95, w: cardW - 0.5, h: 0.4,
      fontFace: FONT_BODY, fontSize: 11, color: C.graphite, margin: 0,
    });
  });
  footerBar(s, 7);
}

// ════════════════════════════════════════
// Slide 8 — 발송 방식 3가지
// ════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  darkHeaderBar(s);
  slideTitle(s, '발송 방식 3가지', '상황에 맞게 — 즉시 · 필터 · 예약 자동');

  const modes = [
    {
      title: '직접 발송',
      sub: '엑셀 + 즉시 발송',
      points: ['주소록 직접 선택', '엑셀 한 번에 발송', '예약 시점 지정 가능', '즉시 · 예약 분기'],
    },
    {
      title: '직접 타겟 발송',
      sub: '필터 → 추출 → 발송',
      points: ['등급 · 성별 · 나이 · 지역 필터', '구매 패턴 · 활성도 분리', '매칭 인원 미리 확인', '저장된 세그먼트 재사용'],
    },
    {
      title: '자동 발송',
      sub: '예약 · 트리거 자동',
      points: ['일자 지정 정기 발송', '생일 · 기념일 D-day 자동', '월간 · 주간 반복', '담당자 사전 알림'],
    },
  ];
  const cardW = 4.0, cardH = 3.7;
  const startX = 0.55, startY = 3.0, gapX = 0.15;
  modes.forEach((m, i) => {
    const x = startX + i * (cardW + gapX);
    const isMiddle = i === 1;
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: startY, w: cardW, h: cardH,
      fill: { color: isMiddle ? C.black : C.bg }, line: { type: 'none' },
    });
    s.addText(`0${i + 1}`, {
      x: x + 0.3, y: startY + 0.3, w: 1, h: 0.4,
      fontFace: FONT_HEAD, fontSize: 12, color: isMiddle ? C.mist : C.steel, bold: true, charSpacing: 3, margin: 0,
    });
    s.addText(m.title, {
      x: x + 0.3, y: startY + 0.7, w: cardW - 0.6, h: 0.6,
      fontFace: FONT_HEAD, fontSize: 22, color: isMiddle ? C.white : C.black, bold: true, margin: 0,
    });
    s.addText(m.sub, {
      x: x + 0.3, y: startY + 1.3, w: cardW - 0.6, h: 0.4,
      fontFace: FONT_BODY, fontSize: 12, color: isMiddle ? C.fog : C.graphite, italic: true, margin: 0,
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: x + 0.3, y: startY + 1.8, w: 0.4, h: 0.05,
      fill: { color: isMiddle ? C.accent : C.black }, line: { type: 'none' },
    });
    s.addText(m.points.map(p => ({ text: p, options: { bullet: true, breakLine: true } })), {
      x: x + 0.3, y: startY + 2.0, w: cardW - 0.6, h: 1.6,
      fontFace: FONT_BODY, fontSize: 12, color: isMiddle ? C.fog : C.graphite, margin: 0, paraSpaceAfter: 4,
    });
  });
  footerBar(s, 8);
}

// ════════════════════════════════════════
// Slide 9 — AI Operator (다크 임팩트)
// ════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.black };

  // 헤더 (다크 톤)
  s.addText('한줄로___', {
    x: 0.5, y: 0.35, w: 4, h: 0.4,
    fontFace: FONT_HEAD, fontSize: 14, color: C.white, bold: true, charSpacing: 1, margin: 0,
  });
  s.addText('AI OPERATOR', {
    x: 8, y: 0.35, w: 4.8, h: 0.4,
    fontFace: FONT_BODY, fontSize: 11, color: C.accent, align: 'right', charSpacing: 4, bold: true, margin: 0,
  });
  s.addShape(pres.shapes.LINE, {
    x: 0.5, y: 0.85, w: 12.3, h: 0,
    line: { color: C.inkSoft, width: 0.5 },
  });

  s.addText('AI Operator', {
    x: 0.5, y: 1.3, w: 12, h: 0.9,
    fontFace: FONT_HEAD, fontSize: 44, color: C.white, bold: true, margin: 0,
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 2.25, w: 0.6, h: 0.08,
    fill: { color: C.accent }, line: { type: 'none' },
  });
  s.addText('자연어 한 줄 → 완전 자동 캠페인 패키지', {
    x: 0.5, y: 2.45, w: 12, h: 0.4,
    fontFace: FONT_BODY, fontSize: 14, color: C.fog, italic: true, margin: 0,
  });

  // 왼쪽 — 입력 → 출력
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 3.1, w: 6, h: 1.0,
    fill: { color: C.inkSoft }, line: { color: C.graphite, width: 1 },
  });
  s.addText('INPUT', {
    x: 0.7, y: 3.2, w: 5, h: 0.3,
    fontFace: FONT_BODY, fontSize: 10, color: C.mist, bold: true, charSpacing: 3, margin: 0,
  });
  s.addText('"신규 가입자 환영 7일 시리즈"', {
    x: 0.7, y: 3.5, w: 5.6, h: 0.5,
    fontFace: FONT_HEAD, fontSize: 18, color: C.white, italic: true, margin: 0,
  });

  s.addText('▼', {
    x: 3.0, y: 4.2, w: 1, h: 0.5,
    fontFace: FONT_HEAD, fontSize: 18, color: C.accent, align: 'center', margin: 0,
  });

  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 4.85, w: 6, h: 2.0,
    fill: { color: C.inkSoft }, line: { color: C.graphite, width: 1 },
  });
  s.addText('OUTPUT', {
    x: 0.7, y: 4.95, w: 5, h: 0.3,
    fontFace: FONT_BODY, fontSize: 10, color: C.accent, bold: true, charSpacing: 3, margin: 0,
  });
  s.addText([
    { text: '4개 단계 시계열 (Day 0 · 1 · 3 · 7)', options: { breakLine: true } },
    { text: '각 단계 메시지 풍성하게 작성', options: { breakLine: true } },
    { text: '시즌 단어 자연스럽게 반영', options: { breakLine: true } },
    { text: '브랜드 톤 학습 메모리 활용', options: { breakLine: true } },
    { text: '회신번호 · 예산 · 광고 표기 자동' },
  ], {
    x: 0.7, y: 5.25, w: 5.6, h: 1.5,
    fontFace: FONT_BODY, fontSize: 12, color: C.pale, margin: 0,
  });

  // 오른쪽 — 5초 임팩트
  s.addText('5초', {
    x: 7.2, y: 3.1, w: 5.6, h: 1.8,
    fontFace: FONT_HEAD, fontSize: 140, color: C.white, bold: true, margin: 0,
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 7.2, y: 4.8, w: 0.8, h: 0.08,
    fill: { color: C.accent }, line: { type: 'none' },
  });
  s.addText('AI가 완전 패키지 자동 설계', {
    x: 7.2, y: 5.0, w: 5.6, h: 0.5,
    fontFace: FONT_BODY, fontSize: 16, color: C.white, margin: 0,
  });
  s.addText('검토 + 혜택 부분만 직접 수정 → 활성화', {
    x: 7.2, y: 5.5, w: 5.6, h: 0.4,
    fontFace: FONT_BODY, fontSize: 12, color: C.mist, margin: 0,
  });
  s.addText('사용할수록 정확도가 향상되는 학습 메모리', {
    x: 7.2, y: 6.1, w: 5.6, h: 0.4,
    fontFace: FONT_BODY, fontSize: 12, color: C.fog, italic: true, margin: 0,
  });

  // 푸터 (다크)
  s.addShape(pres.shapes.LINE, {
    x: 0.5, y: 7.05, w: 12.3, h: 0,
    line: { color: C.inkSoft, width: 0.5 },
  });
  s.addText('hanjul.ai', {
    x: 0.5, y: 7.15, w: 6, h: 0.3,
    fontFace: FONT_BODY, fontSize: 10, color: C.mist, margin: 0,
  });
  s.addText('09 / 16', {
    x: 7, y: 7.15, w: 5.8, h: 0.3,
    fontFace: FONT_BODY, fontSize: 10, color: C.mist, align: 'right', charSpacing: 2, margin: 0,
  });
}

// ════════════════════════════════════════
// Slide 10 — 여정 자동화 7가지
// ════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  darkHeaderBar(s);
  slideTitle(s, '여정 자동화', '7가지 표준 + 자유 설계');

  const journeys = [
    { num: '01', name: '신규 가입 환영', desc: 'Day 0 · 1 · 3 · 7 단계 발송' },
    { num: '02', name: '재구매 유도', desc: '구매 후 7 · 14 · 30일' },
    { num: '03', name: '휴면 회수', desc: '30일+ 미접속 고객 회복' },
    { num: '04', name: '장바구니 회복', desc: '24시간 결제 없음 안내' },
    { num: '05', name: '생일 축하', desc: 'D-7 사전 + D-Day 당일' },
    { num: '06', name: '예약 알림', desc: 'D-3 + 당일 + D+1 후기' },
    { num: '07', name: '자유 여정', desc: '자연어로 직접 설계' },
  ];
  const cardW = 4.0, cardH = 1.3;
  const startX = 0.5, startY = 3.0, gapX = 0.15, gapY = 0.18;
  journeys.forEach((j, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.bg }, line: { type: 'none' },
    });
    s.addText(j.num, {
      x: x + 0.25, y: y + 0.2, w: 1, h: 0.35,
      fontFace: FONT_HEAD, fontSize: 12, color: C.steel, bold: true, charSpacing: 3, margin: 0,
    });
    s.addText(j.name, {
      x: x + 0.25, y: y + 0.55, w: cardW - 0.5, h: 0.4,
      fontFace: FONT_HEAD, fontSize: 16, color: C.black, bold: true, margin: 0,
    });
    s.addText(j.desc, {
      x: x + 0.25, y: y + 0.93, w: cardW - 0.5, h: 0.3,
      fontFace: FONT_BODY, fontSize: 11, color: C.graphite, margin: 0,
    });
  });

  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 6.05, w: 12.3, h: 0.85,
    fill: { color: C.black }, line: { type: 'none' },
  });
  s.addText('고객 한 명의 행동이 발생하면 — AI가 짜둔 단계별 메시지가 자동 발송', {
    x: 0.7, y: 6.18, w: 12, h: 0.6,
    fontFace: FONT_HEAD, fontSize: 16, color: C.white, italic: true, align: 'center', valign: 'middle', margin: 0,
  });
  footerBar(s, 10);
}

// ════════════════════════════════════════
// Slide 11 — 모바일 DM / Web Push / In-app
// ════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  darkHeaderBar(s);
  slideTitle(s, '디자인 채널', '모바일 DM · Web Push · In-app 메시지');

  const features = [
    {
      title: '모바일 DM 빌더',
      sub: '카드형 디자인 + 단축 URL',
      points: ['드래그 카드형 디자인', '이미지 · 텍스트 · CTA 자유 구성', '단축 URL 자동 + 클릭 추적', '문자 1건에 풍성한 미디어'],
    },
    {
      title: 'Web Push',
      sub: '브라우저 푸시 알림',
      points: ['PC · 모바일 동시 발송', '자사몰 방문자 자동 구독', 'VAPID 표준 보안 인증', '도달률 · 클릭률 추적'],
    },
    {
      title: 'In-app 메시지',
      sub: '자사몰 안 배너 · 모달',
      points: ['상단 · 하단 · 중앙 모달', '세션당 · 일일 · 항상 빈도', '특정 페이지 · 고객군 매칭', '노출 · 클릭 · 닫힘 트래킹'],
    },
  ];
  const cardW = 4.0, cardH = 3.7;
  const startX = 0.55, startY = 3.0, gapX = 0.15;
  features.forEach((f, i) => {
    const x = startX + i * (cardW + gapX);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: startY, w: cardW, h: cardH,
      fill: { color: C.bg }, line: { type: 'none' },
    });
    s.addText(`0${i + 1}`, {
      x: x + 0.3, y: startY + 0.3, w: 1, h: 0.4,
      fontFace: FONT_HEAD, fontSize: 12, color: C.steel, bold: true, charSpacing: 3, margin: 0,
    });
    s.addText(f.title, {
      x: x + 0.3, y: startY + 0.7, w: cardW - 0.6, h: 0.5,
      fontFace: FONT_HEAD, fontSize: 20, color: C.black, bold: true, margin: 0,
    });
    s.addText(f.sub, {
      x: x + 0.3, y: startY + 1.25, w: cardW - 0.6, h: 0.35,
      fontFace: FONT_BODY, fontSize: 11, color: C.graphite, italic: true, margin: 0,
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: x + 0.3, y: startY + 1.7, w: 0.4, h: 0.05,
      fill: { color: C.black }, line: { type: 'none' },
    });
    s.addText(f.points.map(p => ({ text: p, options: { bullet: true, breakLine: true } })), {
      x: x + 0.3, y: startY + 1.9, w: cardW - 0.6, h: 1.7,
      fontFace: FONT_BODY, fontSize: 11, color: C.graphite, margin: 0, paraSpaceAfter: 4,
    });
  });
  footerBar(s, 11);
}

// ════════════════════════════════════════
// Slide 12 — 자사몰 직접 연동
// ════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  darkHeaderBar(s);
  slideTitle(s, '자사몰 직접 연동', '주문 · 회원 · 장바구니 실시간 동기화');

  s.addText('CONNECT', {
    x: 0.5, y: 3.0, w: 5, h: 0.3,
    fontFace: FONT_BODY, fontSize: 11, color: C.steel, bold: true, charSpacing: 4, margin: 0,
  });
  s.addText('연동 자사몰', {
    x: 0.5, y: 3.35, w: 5.6, h: 0.5,
    fontFace: FONT_HEAD, fontSize: 22, color: C.black, bold: true, margin: 0,
  });
  const malls = [
    '네이버 스마트스토어', '카페24',
    'Shopify', '메이크샵',
    'imweb', 'WooCommerce',
    '식스샵', '자체 호스팅',
  ];
  malls.forEach((m, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.5 + col * 2.9;
    const y = 4.05 + row * 0.65;
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 2.7, h: 0.55,
      fill: { color: C.bg }, line: { type: 'none' },
    });
    s.addText(m, {
      x: x + 0.2, y, w: 2.5, h: 0.55,
      fontFace: FONT_BODY, fontSize: 12, color: C.ink, valign: 'middle', margin: 0,
    });
  });

  // 오른쪽 — 통합 데이터 (다크)
  s.addShape(pres.shapes.RECTANGLE, {
    x: 6.8, y: 3.0, w: 6.0, h: 3.9,
    fill: { color: C.black }, line: { type: 'none' },
  });
  s.addText('한 곳에서 통합 관리', {
    x: 7.0, y: 3.15, w: 5.6, h: 0.5,
    fontFace: FONT_HEAD, fontSize: 20, color: C.white, bold: true, margin: 0,
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 7.0, y: 3.65, w: 0.5, h: 0.06,
    fill: { color: C.accent }, line: { type: 'none' },
  });
  const dataItems = [
    { num: '01', label: '회원 정보', desc: '이름 · 연락처 · 등급 · 가입일' },
    { num: '02', label: '주문 이력', desc: '구매 상품 · 금액 · 빈도 · LTV' },
    { num: '03', label: '실시간 행동', desc: '장바구니 · 예약 · 클릭 자동 수집' },
    { num: '04', label: '엑셀 + 행동 통합', desc: '한 고객 모든 데이터 단일 뷰' },
  ];
  dataItems.forEach((d, i) => {
    const y = 3.9 + i * 0.72;
    s.addText(d.num, {
      x: 7.0, y, w: 0.6, h: 0.3,
      fontFace: FONT_HEAD, fontSize: 12, color: C.mist, bold: true, charSpacing: 2, margin: 0,
    });
    s.addText(d.label, {
      x: 7.7, y: y - 0.05, w: 5.0, h: 0.4,
      fontFace: FONT_HEAD, fontSize: 14, color: C.white, bold: true, margin: 0,
    });
    s.addText(d.desc, {
      x: 7.7, y: y + 0.32, w: 5.0, h: 0.4,
      fontFace: FONT_BODY, fontSize: 11, color: C.fog, margin: 0,
    });
  });
  footerBar(s, 12);
}

// ════════════════════════════════════════
// Slide 13 — 4중 안전망
// ════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  darkHeaderBar(s);
  slideTitle(s, '4중 안전망', '정보통신망법 · KISA · 통신사 정책 자동 준수');

  const checks = [
    { num: '01', title: '(광고) 표기 자동', desc: '광고 메시지 (광고) 표시 자동 부착' },
    { num: '02', title: '무료거부 080 자동', desc: '수신거부 자동 합성 (LMS · SMS 분기)' },
    { num: '03', title: '발송 시간 자동', desc: 'KST 08:00 ~ 21:00 야간 차단' },
    { num: '04', title: '제목 표준 자동', desc: 'LMS · MMS KISA 제목 표준 적용' },
  ];
  const cardW = 5.95, cardH = 1.5, gapX = 0.4, gapY = 0.25;
  const startX = 0.5, startY = 3.0;
  checks.forEach((c, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.bg }, line: { type: 'none' },
    });
    s.addText(c.num, {
      x: x + 0.3, y: y + 0.25, w: 1, h: 0.35,
      fontFace: FONT_HEAD, fontSize: 12, color: C.steel, bold: true, charSpacing: 3, margin: 0,
    });
    s.addText(c.title, {
      x: x + 0.3, y: y + 0.55, w: cardW - 0.6, h: 0.45,
      fontFace: FONT_HEAD, fontSize: 18, color: C.black, bold: true, margin: 0,
    });
    s.addText(c.desc, {
      x: x + 0.3, y: y + 1.0, w: cardW - 0.6, h: 0.4,
      fontFace: FONT_BODY, fontSize: 12, color: C.graphite, margin: 0,
    });
  });

  const extras = [
    { t: '스팸 검수', d: '발송 전 자동 분류' },
    { t: '이모지 · 특수문자', d: '미지원 단어 자동 정규화' },
    { t: '발신번호 인증', d: '통신사 등록 발신번호 검증' },
  ];
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 6.4, w: 12.3, h: 0.6,
    fill: { color: C.black }, line: { type: 'none' },
  });
  extras.forEach((e, i) => {
    const x = 0.7 + i * 4.1;
    s.addText(e.t, {
      x, y: 6.45, w: 4.0, h: 0.3,
      fontFace: FONT_HEAD, fontSize: 12, color: C.accent, bold: true, margin: 0,
    });
    s.addText(e.d, {
      x, y: 6.7, w: 4.0, h: 0.3,
      fontFace: FONT_BODY, fontSize: 10, color: C.fog, margin: 0,
    });
  });
  footerBar(s, 13);
}

// ════════════════════════════════════════
// Slide 14 — 성과 + AI 추천
// ════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  darkHeaderBar(s);
  slideTitle(s, '성과 + AI 추천', '1회성 발송에서 운영 파트너로');

  const stats = [
    { num: '30일', label: '자동 성과 분석', sub: '발송 · 도달 · 클릭 · 전환' },
    { num: '채널별', label: '비교 매트릭스', sub: 'SMS · LMS · 알림톡 · Email · Push' },
    { num: '시간대', label: '성과 매트릭스', sub: '24시간 시간대별 도달률' },
    { num: '고객군별', label: '성과 매트릭스', sub: 'VIP · 일반 · 휴면 · 신규' },
  ];
  stats.forEach((st, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.5 + col * 3.0;
    const y = 3.0 + row * 1.6;
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 2.85, h: 1.45,
      fill: { color: C.bg }, line: { type: 'none' },
    });
    s.addText(st.num, {
      x: x + 0.25, y: y + 0.2, w: 2.5, h: 0.55,
      fontFace: FONT_HEAD, fontSize: 28, color: C.black, bold: true, margin: 0,
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: x + 0.25, y: y + 0.78, w: 0.3, h: 0.04,
      fill: { color: C.black }, line: { type: 'none' },
    });
    s.addText(st.label, {
      x: x + 0.25, y: y + 0.85, w: 2.5, h: 0.3,
      fontFace: FONT_HEAD, fontSize: 13, color: C.inkSoft, bold: true, margin: 0,
    });
    s.addText(st.sub, {
      x: x + 0.25, y: y + 1.15, w: 2.5, h: 0.3,
      fontFace: FONT_BODY, fontSize: 10, color: C.graphite, margin: 0,
    });
  });

  // 오른쪽 — AI 추천 (다크)
  s.addShape(pres.shapes.RECTANGLE, {
    x: 6.8, y: 3.0, w: 6.0, h: 3.85,
    fill: { color: C.black }, line: { type: 'none' },
  });
  s.addText('AI 다음 캠페인 추천', {
    x: 7.0, y: 3.15, w: 5.6, h: 0.5,
    fontFace: FONT_HEAD, fontSize: 18, color: C.white, bold: true, margin: 0,
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 7.0, y: 3.7, w: 0.4, h: 0.05,
    fill: { color: C.accent }, line: { type: 'none' },
  });
  const recs = [
    { tag: '추천', body: '"VIP 고객 화요일 LMS — 클릭률 18%로 가장 높습니다"' },
    { tag: '제안', body: '"신규 가입 환영에 Day 14 추가 시 재구매율 +12% 예상"' },
    { tag: '경고', body: '"휴면 회수 — 60일 시점 발송으로 조정 권장"' },
  ];
  recs.forEach((r, i) => {
    const y = 4.0 + i * 0.95;
    s.addText(r.tag, {
      x: 7.0, y, w: 0.8, h: 0.3,
      fontFace: FONT_HEAD, fontSize: 11, color: C.accent, bold: true, charSpacing: 2, margin: 0,
    });
    s.addText(r.body, {
      x: 7.0, y: y + 0.3, w: 5.6, h: 0.6,
      fontFace: FONT_BODY, fontSize: 12, color: C.pale, italic: true, margin: 0,
    });
  });
  footerBar(s, 14);
}

// ════════════════════════════════════════
// Slide 15 — 요금제
// ════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  darkHeaderBar(s);
  slideTitle(s, '요금제', '비즈니스 규모에 맞춰 — 필요한 기능부터');

  const plans = [
    { name: 'STARTER', tag: '시작', desc: '고객 DB · 직접 타겟 발송 · 엑셀 자동 매핑' },
    { name: 'BASIC', tag: '활용', desc: 'AI 메시지 · AI 타겟 추천 · 스팸 검수' },
    { name: 'PRO', tag: '자동화', desc: '자동 발송 · 모바일 DM · 스팸 자동 검사' },
    { name: 'BUSINESS', tag: '통합', desc: '자사몰 연동 · AI Operator · 여정 자동화' },
    { name: 'ENTERPRISE', tag: '무제한', desc: '무제한 발송 · 전담 지원 · 음성 AI · Email' },
  ];
  const cardW = 2.42, cardH = 3.6;
  const startX = 0.5, startY = 3.0, gapX = 0.1;
  plans.forEach((p, i) => {
    const x = startX + i * (cardW + gapX);
    const isHighlight = p.name === 'BUSINESS';
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: startY, w: cardW, h: cardH,
      fill: { color: isHighlight ? C.black : C.bg }, line: { type: 'none' },
    });
    s.addText(p.tag, {
      x, y: startY + 0.3, w: cardW, h: 0.4,
      fontFace: FONT_BODY, fontSize: 11, color: isHighlight ? C.accent : C.steel, bold: true, align: 'center', charSpacing: 3, margin: 0,
    });
    s.addText(p.name, {
      x, y: startY + 0.85, w: cardW, h: 0.5,
      fontFace: FONT_HEAD, fontSize: 18, color: isHighlight ? C.white : C.black, bold: true, align: 'center', charSpacing: 1, margin: 0,
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: x + (cardW - 0.5) / 2, y: startY + 1.5, w: 0.5, h: 0.04,
      fill: { color: isHighlight ? C.accent : C.black }, line: { type: 'none' },
    });
    s.addText(p.desc, {
      x: x + 0.25, y: startY + 1.7, w: cardW - 0.5, h: 1.8,
      fontFace: FONT_BODY, fontSize: 11, color: isHighlight ? C.fog : C.graphite, align: 'center', margin: 0,
    });
  });
  s.addText('상세 가격 · 발송량별 견적은 영업팀 문의', {
    x: 0.5, y: 6.75, w: 12.3, h: 0.3,
    fontFace: FONT_BODY, fontSize: 12, color: C.steel, italic: true, align: 'center', margin: 0,
  });
  footerBar(s, 15);
}

// ════════════════════════════════════════
// Slide 16 — 시작하기 (다크 + 임팩트)
// ════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.black };

  s.addText('지금 시작하세요', {
    x: 0.5, y: 2.0, w: 12.3, h: 1.0,
    fontFace: FONT_HEAD, fontSize: 64, color: C.white, bold: true, align: 'center', margin: 0,
  });

  // 긴 underscore 모티프
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.65, y: 3.0, w: 2.0, h: 0.12,
    fill: { color: C.accent }, line: { type: 'none' },
  });

  s.addText('자연어 한 줄 입력 → 1분 안 첫 캠페인 발송', {
    x: 0.5, y: 3.3, w: 12.3, h: 0.5,
    fontFace: FONT_BODY, fontSize: 18, color: C.fog, italic: true, align: 'center', margin: 0,
  });

  const ctas = [
    { label: 'WEB', value: 'hanjul.ai' },
    { label: 'CALL', value: '1800-8125' },
    { label: 'SALES', value: '영업팀 문의' },
  ];
  ctas.forEach((c, i) => {
    const x = 1.0 + i * 4.0;
    const y = 4.5;
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 3.4, h: 1.6,
      fill: { color: C.inkSoft }, line: { color: C.graphite, width: 1 },
    });
    s.addText(c.label, {
      x: x + 0.2, y: y + 0.25, w: 3.0, h: 0.3,
      fontFace: FONT_BODY, fontSize: 10, color: C.accent, bold: true, align: 'center', charSpacing: 4, margin: 0,
    });
    s.addText(c.value, {
      x: x + 0.2, y: y + 0.7, w: 3.0, h: 0.6,
      fontFace: FONT_HEAD, fontSize: 22, color: C.white, bold: true, align: 'center', valign: 'middle', margin: 0,
    });
  });

  s.addShape(pres.shapes.LINE, {
    x: 0.5, y: 6.75, w: 12.3, h: 0,
    line: { color: C.inkSoft, width: 0.5 },
  });
  s.addText('한줄로 (TargetUp) · 주식회사 인비토', {
    x: 0.5, y: 6.9, w: 12.3, h: 0.3,
    fontFace: FONT_BODY, fontSize: 11, color: C.steel, align: 'center', charSpacing: 1, margin: 0,
  });
}

pres.writeFile({ fileName: 'docs/한줄로_서비스소개서_2026-05.pptx' })
  .then(file => console.log('Created: ' + file))
  .catch(err => { console.error('Error:', err); process.exit(1); });
