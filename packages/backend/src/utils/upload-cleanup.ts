/**
 * ★ CT: 업로드 파일 정리 (2026-09-28 한줄로 V2 차수 4 FILES · R341)
 *
 * multer 는 라우트 본문보다 먼저 파일을 디스크에 저장한다. 그래서 검사 400·처리 실패로 끝나는 응답에서는
 * 저장된 파일이 주인 없이 남는다(위임장·통신가입증명원처럼 개인정보가 든 문서도). 실패 응답 직전에 이 함수로 지운다.
 * req.file(single) · req.files(array · fields) 모두 받는다. 지우기 실패는 조용히 넘긴다(응답을 막지 않는다).
 */
import fs from 'fs';

export function dropUploadedFiles(req: { file?: { path?: string } | undefined; files?: unknown }): void {
  const paths: string[] = [];
  if (req.file?.path) paths.push(req.file.path);
  const files = req.files as any;
  if (Array.isArray(files)) {
    for (const f of files) if (f?.path) paths.push(f.path);
  } else if (files && typeof files === 'object') {
    for (const list of Object.values(files)) {
      if (Array.isArray(list)) for (const f of list as any[]) if (f?.path) paths.push(f.path);
    }
  }
  for (const p of paths) fs.unlink(p, () => { /* 이미 없으면 그만 */ });
}
