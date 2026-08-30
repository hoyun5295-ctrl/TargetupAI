/**
 * build-kr-cidrs.js — APNIC 위임 통계 → 한국(KR) CIDR 목록 변환기 (★2026-08-30 신설)
 *
 * 왜 있나: 국외 접속 판정(utils/geo-access.ts `classifyOrigin`)은 `geo_allow_cidrs`에
 * "있으면 국내, 없으면 국외"다. 수기 등록 60개로는 한국 할당 대역을 못 덮어 국내 로그인
 * 전부가 국외 감지로 기록되던 오탐의 정정 도구다.
 *
 * ⛔ DB에 직접 쓰지 않는다 — 적재는 기존 배관 하나뿐이다:
 *   슈퍼관리자 화면 → POST /api/admin/geo/cidrs/bulk (전량 검증·advisory lock·전체 교체·감사 기록).
 *   이 스크립트는 그 화면 textarea에 붙여 넣을 토큰 목록 파일만 만든다.
 * ⛔ 출력 파일은 순수 토큰만(줄당 1개, 주석 금지) — endpoint가 공백 분리 후 전 토큰을 검증하므로
 *   주석 줄이 섞이면 전체가 거부된다. 생성 일자·통계는 stdout과 커밋 메시지가 소유한다.
 *
 * 사용:
 *   node scripts/build-kr-cidrs.js <delegated-apnic-extended-latest 경로> <출력 파일 경로>
 * 원천:
 *   https://ftp.apnic.net/stats/apnic/delegated-apnic-extended-latest
 *   형식: registry|cc|type|start|value|date|status[|opaque-id]
 *   ipv4의 value는 "주소 개수"(2의 거듭제곱이 아닐 수 있어 정렬 블록으로 분해),
 *   ipv6의 value는 프리픽스 길이 그대로다.
 * 갱신(반기 권장): 원천 재다운로드 → 재실행 → 화면에서 전체 교체 → 재검증 SQL.
 *   절차 등재 = status/OPS.md
 */
'use strict';

const fs = require('fs');

function v4ToInt(addr) {
  const p = addr.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}

function intToV4(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** start..start+count-1 을 정렬된 CIDR 블록들로 분해. 경계 정렬은 수학적으로 보장되지만 단언으로 재확인한다 */
function v4RangeToCidrs(startInt, count) {
  const out = [];
  let cur = startInt;
  let remain = count;
  while (remain > 0) {
    // 현재 주소의 정렬 하한(lowbit)과 남은 개수 하한(highbit) 중 작은 블록
    const alignBlock = cur === 0 ? 0x100000000 : (cur & -cur) >>> 0;
    let block = Math.min(alignBlock || 0x100000000, 1 << Math.floor(Math.log2(remain)));
    const prefix = 32 - Math.log2(block);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      throw new Error(`블록 계산 오류: cur=${intToV4(cur)} remain=${remain} block=${block}`);
    }
    // 정렬 단언 — validateCidrToken(PG cidr 동치)이 거부할 값을 여기서 먼저 잡는다
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if (((cur & mask) >>> 0) !== cur) {
      throw new Error(`네트워크 정렬 위반: ${intToV4(cur)}/${prefix}`);
    }
    out.push(`${intToV4(cur)}/${prefix}`);
    cur = (cur + block) >>> 0;
    remain -= block;
  }
  return out;
}

function main() {
  const [srcPath, outPath] = process.argv.slice(2);
  if (!srcPath || !outPath) {
    console.error('사용: node scripts/build-kr-cidrs.js <delegated 파일> <출력 파일>');
    process.exit(1);
  }
  const lines = fs.readFileSync(srcPath, 'utf8').split('\n');

  const tokens = [];
  const stats = { v4Lines: 0, v4Addrs: 0, v4Cidrs: 0, v6Lines: 0, skippedStatus: {} };
  for (const line of lines) {
    if (!line.startsWith('apnic|KR|')) continue;
    const f = line.trim().split('|');
    const [, , type, start, value, , status] = f;
    if (type !== 'ipv4' && type !== 'ipv6') continue;
    // 위임 확정분만 — available·reserved는 아직 한국 대역이 아니다
    if (status !== 'allocated' && status !== 'assigned') {
      stats.skippedStatus[status] = (stats.skippedStatus[status] || 0) + 1;
      continue;
    }
    if (type === 'ipv4') {
      const startInt = v4ToInt(start);
      const count = Number(value);
      if (startInt === null || !Number.isInteger(count) || count <= 0) {
        throw new Error(`ipv4 줄 해석 실패: ${line}`);
      }
      // ★Codex 2R 범위 밖 지적 수용 — 주소 공간 끝을 넘는 범위는 32비트 래핑으로 남의 대역이 된다
      if (startInt + count > 0x100000000) {
        throw new Error(`ipv4 범위가 주소 공간을 넘습니다: ${line}`);
      }
      const cidrs = v4RangeToCidrs(startInt, count);
      tokens.push(...cidrs);
      stats.v4Lines += 1;
      stats.v4Addrs += count;
      stats.v4Cidrs += cidrs.length;
    } else {
      const prefix = Number(value);
      if (!start.includes(':') || !Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
        throw new Error(`ipv6 줄 해석 실패: ${line}`);
      }
      tokens.push(`${start}/${prefix}`);
      stats.v6Lines += 1;
    }
  }

  const unique = Array.from(new Set(tokens));
  // 원천이 잘렸거나 형식이 바뀐 것 — 이 목록으로 전체 교체하면 커버리지가 무너진다.
  // ★Codex 2R 수용: 원천 줄 합산은 중복 행으로 부풀 수 있어 **중복 제거 후** 계열별로 다시 센다.
  //   기준 = 2026-08 실측(IPv4 112,475,392 주소 · IPv6 178대역)에서 여유 둔 하한.
  let v4UniqueAddrs = 0;
  let v6UniqueCount = 0;
  for (const t of unique) {
    const [addr, p] = t.split('/');
    if (addr.includes(':')) v6UniqueCount += 1;
    else v4UniqueAddrs += 2 ** (32 - Number(p));
  }
  if (v4UniqueAddrs < 105_000_000) {
    throw new Error(`IPv4 커버 주소(중복 제거)가 ${v4UniqueAddrs.toLocaleString()}개뿐입니다(정상 약 1.12억). 원천 파일이 잘렸는지 확인하세요.`);
  }
  if (v6UniqueCount < 150) {
    throw new Error(`IPv6 대역(중복 제거)이 ${v6UniqueCount}개뿐입니다(정상 178개 안팎). IPv6 구간이 잘린 원천입니다.`);
  }
  if (unique.length < 1000) {
    throw new Error(`토큰이 ${unique.length}개뿐입니다. 원천 파일이 온전한지 확인하세요.`);
  }

  // 표본 커버리지 단언 — 실제 오탐으로 확인된 국내 IP 3개가 목록 안에 들어야 한다
  const samples = ['115.138.27.202', '220.94.157.131', '121.147.24.89'];
  for (const ip of samples) {
    const ipInt = v4ToInt(ip);
    const hit = unique.some((t) => {
      const [addr, p] = t.split('/');
      if (addr.includes(':')) return false;
      const prefix = Number(p);
      const net = v4ToInt(addr);
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      return ((ipInt & mask) >>> 0) === net;
    });
    if (!hit) throw new Error(`표본 IP ${ip} 가 생성 목록에 없습니다 — 원천·해석 확인 필요`);
    console.log(`표본 커버 확인: ${ip} 포함`);
  }

  fs.writeFileSync(outPath, unique.join('\n') + '\n', 'utf8');
  console.log(`ipv4: ${stats.v4Lines}줄 → CIDR ${stats.v4Cidrs}개 (주소 ${stats.v4Addrs.toLocaleString()}개)`);
  console.log(`ipv6: ${stats.v6Lines}줄`);
  if (Object.keys(stats.skippedStatus).length > 0) {
    console.log(`제외(status): ${JSON.stringify(stats.skippedStatus)}`);
  }
  console.log(`총 토큰 ${unique.length}개 → ${outPath}`);
}

main();
