# 한줄로AI 홍보 영상 배경음악 · 코드로 직접 합성(외부 음원 0 · 저작권 = 한줄로)
# 120 BPM(한 마디 = 2초) · 276초 = 138마디 · 장 경계(js/ui.js CH)와 마디가 맞는다: 20 · 66 · 106 · 146 · 176 · 212 · 236 · 250 · 262 · 276초
# 실행: python music.py  →  music.wav (render.js 가 -14 LUFS 로 맞춰 붙인다)
import wave
import numpy as np
from scipy.signal import lfilter, fftconvolve

SR = 44100
BPM = 120
BEAT = 60 / BPM
BAR = BEAT * 4
DUR = 276.0
N = int(SR * DUR)
rng = np.random.default_rng(23)

L = np.zeros(N)
R = np.zeros(N)
SEND = np.zeros(N)       # 잔향으로 보낼 몫
DUCK = np.zeros(N)       # 킥 자리(사이드체인 기준)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def at(t):
    return int(round(t * SR))


def put(sig, t, g=1.0, pan=0.0, send=0.0):
    i = at(t)
    if i >= N or i < 0:
        return
    s = sig[: N - i] * g
    L[i:i + len(s)] += s * np.sqrt(0.5 * (1 - pan))
    R[i:i + len(s)] += s * np.sqrt(0.5 * (1 + pan))
    if send:
        SEND[i:i + len(s)] += s * send


def lp(x, fc):
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    return lfilter([a], [1, -(1 - a)], x)


def hp(x, fc):
    return x - lp(x, fc)


def env(n, a=0.005, d=0.3, s=0.0, r=0.08, hold=None):
    t = np.arange(n) / SR
    e = np.where(t < a, t / a, s + (1 - s) * np.exp(-(t - a) / d))
    if hold is not None:
        k = t > hold
        e[k] *= np.exp(-(t[k] - hold) / r)
    return e


def saw(f, n, ph=0.0):
    t = np.arange(n) / SR
    return 2 * ((t * f + ph) % 1.0) - 1


# ── 소리들 ──────────────────────────────────────────
def kick(g=1.0):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 46 + 120 * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.24)
    click = lp(rng.standard_normal(n), 4000) * np.exp(-t / 0.003) * 0.3
    return np.tanh((body + click) * 1.5) * 0.85 * g


def clap():
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    nz = hp(lp(rng.standard_normal(n), 3000), 900)
    e = sum(np.where(t >= o, np.exp(-np.clip(t - o, 0, None) / 0.01), 0) for o in (0, 0.008, 0.016)) * 0.5
    e += np.where(t > 0.02, np.exp(-(t - 0.02) / 0.09), 0)
    return nz * e * 0.5


def snap():
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 2500) * np.exp(-t / 0.018) * 0.35


def hat(open_=False):
    n = int((0.18 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 7500) * np.exp(-t / (0.06 if open_ else 0.012)) * 0.28


def shaker():
    n = int(0.08 * SR)
    t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 5000) * np.sin(np.pi * t / 0.08) ** 2 * 0.12


def bass(m, d):
    n = int(d * SR)
    t = np.arange(n) / SR
    s = 0.55 * saw(midi(m), n) + 0.8 * np.sin(2 * np.pi * midi(m) * t)
    return lp(s, 620) * env(n, a=0.004, d=0.18, s=0.6, hold=d * 0.8, r=0.03) * 0.5


def keys(notes, d, bright=1.0):
    # 전자 피아노(주파수 변조): 두드리는 소리 + 부드러운 꼬리
    n = int(d * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m in notes:
        f = midi(m)
        idx = 1.6 * bright * np.exp(-t / 0.35)
        out += np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t)) * np.exp(-t / 1.1)
    return out / max(1, len(notes)) * env(n, a=0.003, d=2.0, s=0.4, hold=d * 0.85, r=0.12) * 0.5


def pad(notes, d, cut=1800):
    n = int(d * SR)
    out = np.zeros(n)
    for m in notes:
        for dt in (-0.006, 0.0, 0.007):
            out += saw(midi(m) * (1 + dt), n, rng.random())
    out = lp(out / (len(notes) * 3), cut)
    return out * env(n, a=0.8, d=4.0, s=0.85, hold=max(0.1, d - 0.6), r=0.4) * 0.32


def pluck(m, d=0.45, bright=1.0):
    n = int(d * SR)
    t = np.arange(n) / SR
    f = midi(m)
    s = np.sin(2 * np.pi * f * t) + 0.3 * bright * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t / 0.04) + 0.15 * np.sin(2 * np.pi * 2 * f * t)
    return s * np.exp(-t / 0.16) * 0.42


def bell(m, d=2.5, g=1.0):
    n = int(d * SR)
    t = np.arange(n) / SR
    f = midi(m)
    s = (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.35)
         + 0.25 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t / 0.12))
    return s * np.exp(-t / 0.8) * 0.3 * g


def chime():
    a = bell(88, 1.4, 0.7)
    b = bell(95, 1.4, 0.6)
    out = np.zeros(int(1.6 * SR))
    out[:len(a)] += a
    o = int(0.09 * SR)
    out[o:o + len(b)] += b[: len(out) - o]
    return out


def riser(d):
    n = int(d * SR)
    t = np.arange(n) / SR
    x = t / d
    nz = rng.standard_normal(n)
    cut = 300 + 8000 * x ** 2
    y = np.zeros(n)
    # 구간마다 차단 주파수를 올린다(빠르게: 64조각)
    for k in range(64):
        a, b = k * n // 64, (k + 1) * n // 64
        y[a:b] = lp(nz[a:b], cut[a])
    return y * x ** 2 * 0.28


def whoosh(d=0.6, g=1.0):
    n = int(d * SR)
    t = np.arange(n) / SR
    x = t / d
    nz = hp(lp(rng.standard_normal(n), 3500), 400)
    return nz * np.sin(np.pi * x) ** 2 * 0.32 * g


def impact(g=1.0):
    n = int(2.4 * SR)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t / 0.08)) / SR) * np.exp(-t / 0.7)
    air = hp(rng.standard_normal(n), 3000) * np.exp(-t / 0.6) * 0.18
    return (np.tanh(boom * 1.4) * 0.6 + air) * g


def tick(g=1.0):
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * 2200 * t) * np.exp(-t / 0.004) * 0.16 * g


def pop(m=84, g=1.0):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    f = midi(m) * (1 + 0.5 * np.exp(-t / 0.01))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.045) * 0.2 * g


# ── 화음(D 장조 · 근음, 화음) ───────────────────────────
D = 2   # C → D 로 올린다
PROG = {
    'A': [(48, [60, 64, 67, 71]), (43, [59, 62, 67, 71]), (45, [60, 64, 69, 72]), (41, [60, 65, 69, 72])],   # I V vi IV
    'B': [(45, [60, 64, 69, 72]), (41, [60, 65, 69, 72]), (48, [60, 64, 67, 71]), (43, [59, 62, 67, 71])],   # vi IV I V
    'C': [(41, [57, 60, 65, 69]), (48, [55, 60, 64, 67]), (43, [55, 59, 62, 67]), (45, [57, 60, 64, 69])],   # IV I V vi
}
ARP = [0, 2, 1, 3, 2, 1, 3, 2]

# 마디별 장면 · (시작 마디, 끝 마디, 판)
SECTIONS = [
    (0, 3, 'intro'), (3, 5, 'hush'), (5, 8, 'swell'), (8, 10, 'lift'),
    (10, 23, 'A'), (23, 28, 'Aarp'), (28, 33, 'A'),            # 장 1
    (33, 45, 'B'), (45, 53, 'Barp'),                            # 장 2
    (53, 73, 'C'),                                              # 장 3
    (73, 88, 'A'),                                              # 장 4
    (88, 106, 'flow'),                                          # 장 5
    (106, 118, 'Bwarm'),                                        # 장 6
    (118, 125, 'A'), (125, 131, 'Aarp'),                        # 장 7 · 8
    (131, 134, 'outro_pad'), (134, 138, 'finale'),              # 장 9
]


def style_of(bar):
    for a, b, s in SECTIONS:
        if a <= bar < b:
            return s
    return 'finale'


MELODY = [(0, 76), (0.75, 79), (1.5, 83), (2.5, 79), (3, 76), (4, 74), (4.75, 79), (5.5, 81), (6.5, 79), (7, 74)]

kk, cp, sn, hc, ho, sh = kick(), clap(), snap(), hat(), hat(True), shaker()
for bar in range(138):
    t0 = bar * BAR
    st = style_of(bar)
    prog = PROG['B' if st.startswith('B') or st in ('outro_pad',) else 'C' if st == 'C' else 'A']
    root, chord = prog[bar % 4]
    root += D
    chord = [m + D for m in chord]
    full = st in ('A', 'Aarp', 'C', 'flow', 'finale')
    soft = st in ('B', 'Barp', 'Bwarm')
    # 드럼
    if st not in ('intro', 'hush', 'swell', 'outro_pad'):
        kicks = [0, 1, 2, 3] if full or st == 'lift' else [0, 2.5]
        for b in kicks:
            put(kk, t0 + b * BEAT, 0.95 if full else 0.75)
            DUCK[min(N - 1, at(t0 + b * BEAT))] = 1
        if full:
            for b in (1, 3):
                put(cp, t0 + b * BEAT, 0.7, send=0.2)
        elif soft:
            for b in (1, 3):
                put(sn, t0 + b * BEAT, 0.8, pan=0.1, send=0.15)
        for b in range(4):
            put(ho if full else hc, t0 + (b + 0.5) * BEAT, 0.8 if full else 0.6, pan=0.25)
            if full or st == 'Barp' or st == 'Bwarm':
                for q in (0.25, 0.75):
                    put(sh, t0 + (b + q) * BEAT, 0.9, pan=-0.3)
    if st == 'intro':
        for k in range(16):    # 째깍째깍(할 일이 쌓인다)
            put(tick(0.6 + 0.04 * k), t0 + k * BEAT / 4, 1.0, pan=0.2 * ((k % 3) - 1))
    # 베이스
    if st not in ('intro', 'hush', 'outro_pad'):
        pat = [0, 0.5, 1.5, 2, 2.5, 3.5] if full else [0, 1.5, 2, 3]
        for b in pat:
            put(bass(root, BEAT * 0.45), t0 + b * BEAT, 0.9 if full else 0.7)
    # 화음
    if st in ('intro', 'hush', 'swell', 'outro_pad', 'B', 'Bwarm', 'Barp', 'flow', 'lift'):
        put(pad(chord, BAR + 0.4, 900 if st == 'intro' else 1400 if st in ('hush', 'outro_pad') else 2200), t0, 0.7 if st == 'intro' else 0.9, pan=-0.1, send=0.3)
    if st not in ('intro', 'hush'):
        for b in ((0, 1.5, 2.5) if full else (0, 2)):
            put(keys(chord, BEAT * 1.4, 1.2 if full else 0.8), t0 + b * BEAT, 0.6, pan=0.15, send=0.25)
    # 아르페지오 · 선율
    if st in ('Aarp', 'Barp', 'flow', 'intro', 'C', 'finale'):
        step = BEAT / 4 if st in ('flow', 'Aarp', 'finale') else BEAT / 2
        cnt = int(BAR / step)
        for k in range(cnt):
            m = chord[ARP[k % 8]] + 12
            put(pluck(m, 0.35, 1.0 if st != 'intro' else 0.6), t0 + k * step, 0.5 if st != 'intro' else 0.35, pan=0.3 * np.sin(k), send=0.3)
    if st in ('C', 'Bwarm'):
        k0 = bar % 2
        for off, m in MELODY:
            if k0 * 4 <= off < (k0 + 1) * 4:
                put(bell(m + D, 1.2, 0.6) if st == 'Bwarm' else pluck(m + D, 0.5), t0 + (off - k0 * 4) * BEAT, 0.6, pan=-0.2, send=0.35)

# ── 효과음 · 장면 시각(js/scenes 의 S 표와 같은 값) ───────────
for k in range(18):                                  # 할 일 이름표가 쏟아진다
    put(pop(84 + (k * 5) % 12, 0.9), 0.8 + k * 0.17, 1.0, pan=((k % 5) - 2) * 0.2)
put(whoosh(1.0, 1.4), 6.2)                           # 한 점으로 빨려 든다
put(riser(2.4), 8.3)
put(impact(0.9), 10.7)                               # 마케팅, 이제 한 줄이면 됩니다
put(bell(86, 3.0, 1.0), 13.7, 1.0, send=0.5)         # 로고
for tt in (14.75, 14.91):
    put(tick(1.4), tt, 1.0)
CHAPTER = [20, 66, 106, 146, 176, 212, 236, 250]
for c in CHAPTER:                                    # 장 표지가 덮고 걷힌다
    put(whoosh(0.7, 1.1), c - 0.15, 1.0, pan=0.4)
    put(whoosh(0.6, 0.7), c + 2.3, 1.0, pan=-0.4)
    put(riser(1.6), c - 1.7, 0.7)
for c in CHAPTER[1:]:
    put(impact(0.35), c, 1.0)
put(impact(0.8), 20.0)
for tt in (26.8, 45.4, 64.2, 120.2, 126.0, 188.6, 205.4, 225.8, 247.9):   # 주요 누르기
    put(tick(1.2), tt, 1.0)
for tt in (57.7, 59.05, 59.85, 64.45, 205.9, 227.6, 229.0, 230.4, 248.2):  # 통과 · 완료
    put(chime(), tt, 0.8, send=0.4)
put(impact(0.5), 85.6)                               # 칸막이가 내려온다
put(whoosh(1.2, 0.9), 120.6)                         # 포스터가 나타난다
put(bell(93, 2.0, 0.8), 121.9, 1.0, send=0.5)
put(whoosh(1.1, 1.0), 126.2)                         # 말로 고치기
put(riser(3.0), 203.0)                               # 켜기
put(impact(0.7), 205.9)
put(impact(0.9), 268.3)                              # 닫는 로고
put(bell(86, 3.5, 1.1), 268.3, 1.0, send=0.6)
for tt in (269.3, 269.46):
    put(tick(1.4), tt, 1.0)
end = np.zeros(int(3.6 * SR))
for m in (50, 62, 66, 69, 74, 78):
    end += saw(midi(m), len(end), rng.random() * 0.01)
end = lp(end / 6, 2400) * env(len(end), a=0.02, d=1.6, s=0.0) * 0.5
put(end, 272.0, 1.0, send=0.5)
put(bell(86, 3.5, 0.9), 272.0, 1.0, send=0.6)

# 사이드체인(킥마다 화음이 숨 쉬듯)
duck = np.ones(N)
for i in np.nonzero(DUCK)[0]:
    n = min(int(0.22 * SR), N - i)
    t = np.arange(n) / SR
    duck[i:i + n] = np.minimum(duck[i:i + n], 0.5 + 0.5 * (1 - np.exp(-t / 0.07)))
L *= 0.6 + 0.4 * duck
R *= 0.6 + 0.4 * duck

# 잔향(지수 감쇠 소음 응답 · FFT 합성곱)
ir_n = int(1.8 * SR)
ir_t = np.arange(ir_n) / SR
irL = rng.standard_normal(ir_n) * np.exp(-ir_t / 0.5)
irR = rng.standard_normal(ir_n) * np.exp(-ir_t / 0.5)
wet = lp(SEND, 6000)
wL = fftconvolve(wet, irL)[:N]
wR = fftconvolve(wet, irR)[:N]
g = 0.25 / max(np.abs(wL).max(), 1e-9)
L += wL * g
R += wR * g

# 마스터: 앞 0.3초 · 끝 1.2초 페이드 · 부드러운 클립 · 정규화
fade = np.ones(N)
fade[: int(0.3 * SR)] = np.linspace(0, 1, int(0.3 * SR))
fn = int(1.2 * SR)
fade[-fn:] = np.linspace(1, 0, fn) ** 2
mix = np.stack([L * fade, R * fade], axis=1)
mix = np.tanh(mix / np.abs(mix).max() * 1.3)
mix = mix / np.abs(mix).max() * 0.89
with wave.open('music.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('music.wav', DUR, 's')
