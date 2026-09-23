// 인증 파일 다운로드 — Authorization 헤더가 필요한 endpoint를 blob으로 받아 저장한다.
// ★ 2026-08-20 AdminCampaignAgencyPage 로컬 헬퍼를 원본 그대로 승격(동작 무변경) —
//   고객 캠페인 대행 페이지의 제안서 다운로드가 같은 것을 필요로 해 복제 대신 공용화했다.

/**
 * 응답 헤더 Content-Disposition 에서 저장할 파일명을 고른다.
 *
 * ★ 2026-09-23 원래 이름(`filename*=UTF-8''…`)을 먼저 읽는다. 서버는 두 값을 함께 보내는데
 *   `filename="…"` 은 구형 브라우저용 ASCII 대체값이라 한글이 `_`·`?` 로 바뀌어 있다
 *   (엑셀 CT = `_______.xlsx` · Express res.download = `???_??????_.pdf`). 전에는 그쪽을 먼저 읽어 이름이 깨졌다.
 *   `filename=` 값은 풀어 보고 안 풀리면 그대로 쓴다 — 전에는 `100%.xlsx` 같은 이름에서 예외가 나 다운로드가 실패했다.
 *   검증 = backend/src/utils/__tests__/auth-download-filename.test.ts
 */
export function filenameFromDisposition(cd: string, fallbackName: string): string {
  const ext = cd.match(/filename\*\s*=\s*UTF-8'[^']*'([^;]+)/i);
  if (ext) {
    try { return decodeURIComponent(ext[1].trim()); } catch { /* 깨진 값 → 아래 filename= */ }
  }
  const plain = cd.match(/filename\s*=\s*"?([^";]+)/i);
  if (plain) {
    try { return decodeURIComponent(plain[1]); } catch { return plain[1]; }
  }
  return fallbackName;
}

/**
 * 인증 서빙 그림을 화면에 띄울 blob 주소로 받는다(쓰고 나면 부르는 쪽이 URL.revokeObjectURL).
 *
 * ★ 2026-09-23 `<img src>` 는 Authorization 헤더를 못 붙인다. 로그인이 필요한 주소
 *   (예: `/api/image-studio/temp/:id`)를 그대로 넣으면 401 로 깨진다 — DM 블록 스튜디오 결과 미리보기 빈칸 접수.
 *   서버가 거절하면 깨진 주소 대신 실패를 던진다.
 *   검증 = backend/src/utils/__tests__/auth-object-url.test.ts
 */
export async function fetchAuthObjectUrl(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  if (!res.ok) throw new Error(`이미지를 불러오지 못했습니다 (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

export async function downloadAuthFile(url: string, fallbackName: string, onError: (m: string) => void) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    if (!res.ok) { onError('파일을 찾을 수 없습니다.'); return; }
    const blob = await res.blob();
    const name = filenameFromDisposition(res.headers.get('Content-Disposition') || '', fallbackName);
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = name; a.click();
    URL.revokeObjectURL(href);
  } catch { onError('다운로드에 실패했습니다.'); }
}
