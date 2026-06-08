// EUC-KR byte 길이 순수 로직 검증 (DB-free)
import assert from 'node:assert';
import { eucKrByteLength } from '../message-byte';

// 1) 빈 문자열 → 0
assert.equal(eucKrByteLength(''), 0);

// 2) ASCII는 1byte
assert.equal(eucKrByteLength('abc'), 3);
assert.equal(eucKrByteLength('12 [test]'), 9);

// 3) 한글은 2byte (EUC-KR 규격)
assert.equal(eucKrByteLength('가나'), 4);
assert.equal(eucKrByteLength('한글'), 4);

// 4) 혼합
assert.equal(eucKrByteLength('a가'), 3);
assert.equal(eucKrByteLength('안녕 hi'), 4 + 1 + 2); // 안녕(4) + 공백(1) + hi(2)

console.log('message-byte pure: PASS');
