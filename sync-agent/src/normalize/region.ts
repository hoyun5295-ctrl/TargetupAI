/**
 * 지역 정규화
 * 다양한 표기 → 표준 지역명
 *
 * 입력 예시:
 *   서울시, 서울특별시 → 서울
 *   경기도 수원시     → 경기
 *   부산광역시        → 부산
 */

const REGION_MAP: Record<string, string> = {
  // 서울
  '서울': '서울', '서울시': '서울', '서울특별시': '서울',
  // 부산
  '부산': '부산', '부산시': '부산', '부산광역시': '부산',
  // 대구
  '대구': '대구', '대구시': '대구', '대구광역시': '대구',
  // 인천
  '인천': '인천', '인천시': '인천', '인천광역시': '인천',
  // 광주
  '광주': '광주', '광주시': '광주', '광주광역시': '광주',
  // 대전
  '대전': '대전', '대전시': '대전', '대전광역시': '대전',
  // 울산
  '울산': '울산', '울산시': '울산', '울산광역시': '울산',
  // 세종
  '세종': '세종', '세종시': '세종', '세종특별자치시': '세종',
  // 경기
  '경기': '경기', '경기도': '경기',
  // 강원
  '강원': '강원', '강원도': '강원', '강원특별자치도': '강원',
  // 충북
  '충북': '충북', '충청북도': '충북',
  // 충남
  '충남': '충남', '충청남도': '충남',
  // 전북
  '전북': '전북', '전라북도': '전북', '전북특별자치도': '전북',
  // 전남
  '전남': '전남', '전라남도': '전남',
  // 경북
  '경북': '경북', '경상북도': '경북',
  // 경남
  '경남': '경남', '경상남도': '경남',
  // 제주
  '제주': '제주', '제주도': '제주', '제주특별자치도': '제주',
};

export function normalizeRegion(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;

  const value = String(raw).trim();

  // 정확한 매칭
  if (REGION_MAP[value]) {
    return REGION_MAP[value];
  }

  // 접두어 매칭 (주소에서 첫 단어만 추출)
  const firstWord = value.split(/[\s,]+/)[0];
  if (REGION_MAP[firstWord]) {
    return REGION_MAP[firstWord];
  }

  // 포함 매칭 (예: "서울특별시 강남구" → 서울)
  for (const [pattern, normalized] of Object.entries(REGION_MAP)) {
    if (value.includes(pattern)) {
      return normalized;
    }
  }

  // 매칭 실패 시 원본 반환 (custom_fields로 갈 수 있도록)
  return value;
}
