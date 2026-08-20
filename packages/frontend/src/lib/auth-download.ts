// 인증 파일 다운로드 — Authorization 헤더가 필요한 endpoint를 blob으로 받아 저장한다.
// ★ 2026-08-20 AdminCampaignAgencyPage 로컬 헬퍼를 원본 그대로 승격(동작 무변경) —
//   고객 캠페인 대행 페이지의 제안서 다운로드가 같은 것을 필요로 해 복제 대신 공용화했다.
export async function downloadAuthFile(url: string, fallbackName: string, onError: (m: string) => void) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    if (!res.ok) { onError('파일을 찾을 수 없습니다.'); return; }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i);
    const name = m ? decodeURIComponent(m[1]) : fallbackName;
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = name; a.click();
    URL.revokeObjectURL(href);
  } catch { onError('다운로드에 실패했습니다.'); }
}
