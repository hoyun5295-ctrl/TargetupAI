# 이미지 스튜디오 소개 영상 배경음악 — 코드로 직접 합성(외부 음원 0 · 저작권 = 한줄로)
# 128 BPM · 25초 = 12마디 + 끝 화음 · Dm - Bb - F - C 세 바퀴 → F 로 끝맺음 · 6마디째 숨 고르기
# 실행: python music.py  →  music.wav
import wave
import numpy as np

SR = 44100
BPM = 128
BEAT = 60 / BPM
BAR = BEAT * 4
DUR = 25.0
N = int(SR * DUR)
rng = np.random.default_rng(7)

L = np.zeros(N)
R = np.zeros(N)
send = np.zeros(N)          # 리버브로 보낼 몫(모노)
duck_src = np.zeros(N)      # 사이드체인 기준(킥 위치)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def at(t):
    return int(round(t * SR))


def add(buf, sig, t, gain=1.0, pan=0.0):
    i = at(t)
    if i >= N:
        return
    sig = sig[: N - i] * gain
    if isinstance(buf, str):
        L[i:i + len(sig)] += sig * np.sqrt(0.5 * (1 - pan))
        R[i:i + len(sig)] += sig * np.sqrt(0.5 * (1 + pan))
    else:
        buf[i:i + len(sig)] += sig


def env(n, a=0.002, d=0.2, sus=0.0, rel=0.05, hold=None):
    t = np.arange(n) / SR
    e = np.where(t < a, t / a, sus + (1 - sus) * np.exp(-(t - a) / d))
    if hold is not None:
        cut = t > hold
        e[cut] *= np.exp(-(t[cut] - hold) / rel)
    return e


def lowpass(x, cutoff):
    # 1차 저역 통과 — 고정 cutoff(배열이면 표본마다)
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * c / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def saw(f, n, detune=0.0, phase=0.0):
    t = np.arange(n) / SR
    return 2 * ((t * f * (1 + detune) + phase) % 1.0) - 1


# ── 드럼 ────────────────────────────────────────────
def kick():
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    f = 48 + 110 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.22)
    click = rng.standard_normal(n) * np.exp(-t / 0.004) * 0.25
    return np.tanh((body + click) * 1.6) * 0.9


def clap():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    nz = rng.standard_normal(n)
    nz = highpass(lowpass(nz, 2600), 900)
    e = np.zeros(n)
    for off in (0.0, 0.009, 0.018):
        tt = t - off
        e += np.where(tt >= 0, np.exp(-np.clip(tt, 0, None) / 0.012), 0) * 0.6
    e += np.where(t > 0.02, np.exp(-(t - 0.02) / 0.11), 0)
    return nz * e * 0.55


def hat(open_=False):
    n = int((0.16 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    nz = highpass(rng.standard_normal(n), 7000)
    return nz * np.exp(-t / (0.05 if open_ else 0.012)) * 0.35


def crash():
    n = int(2.2 * SR)
    t = np.arange(n) / SR
    nz = highpass(rng.standard_normal(n), 3500)
    return nz * np.exp(-t / 0.7) * 0.28


# ── 악기 ────────────────────────────────────────────
def supersaw_chord(notes, length, cutoff=3200):
    n = int(length * SR)
    s = np.zeros(n)
    for m in notes:
        f = midi(m)
        for d in (-0.011, -0.004, 0.0, 0.005, 0.012):
            s += saw(f, n, d, rng.random())
    s /= len(notes) * 5
    s = lowpass(s, cutoff)
    return s * env(n, a=0.004, d=0.16, sus=0.0)


def pluck(m, length=0.5, bright=1.0):
    # 마림바풍: 기본음 + 4배음, 빠른 감쇠
    n = int(length * SR)
    t = np.arange(n) / SR
    f = midi(m)
    s = np.sin(2 * np.pi * f * t) + 0.35 * bright * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t / 0.03)
    s += 0.18 * np.sin(2 * np.pi * f * 2 * t)
    return s * env(n, a=0.001, d=0.18) * 0.5


def bass(m, length):
    n = int(length * SR)
    s = saw(midi(m), n) * 0.6 + np.sin(2 * np.pi * midi(m) * np.arange(n) / SR) * 0.7
    s = lowpass(s, 700)
    return s * env(n, a=0.003, d=0.12, sus=0.55, hold=length * 0.75, rel=0.02) * 0.55


def bell(m, length=2.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = midi(m)
    s = (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.3)
         + 0.25 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t / 0.12))
    return s * np.exp(-t / 0.7) * 0.32


# ── 효과음 ──────────────────────────────────────────
def riser(length):
    n = int(length * SR)
    t = np.arange(n) / SR
    nz = rng.standard_normal(n)
    cut = 400 + 9000 * (t / length) ** 2
    return lowpass(nz, cut) * (t / length) ** 2 * 0.35


def whoosh(length=0.45):
    n = int(length * SR)
    t = np.arange(n) / SR
    x = t / length
    nz = rng.standard_normal(n)
    cut = 600 + 5000 * np.sin(np.pi * x)
    return highpass(lowpass(nz, cut), 300) * np.sin(np.pi * x) ** 2 * 0.3


def tick():
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * 2400 * t) * np.exp(-t / 0.004) * 0.18


def pop(m=84):
    n = int(0.14 * SR)
    t = np.arange(n) / SR
    f = midi(m) * (1 + 0.6 * np.exp(-t / 0.01))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.05) * 0.22


# ── 편곡 ────────────────────────────────────────────
# 마디 0 훅 · 1 답(빌드업) · 2~3 갤러리 · 4 문구 · 5 생성 · 6 말로 고치기(숨 고르기 + 라이저) · 7~8 네 채널(드롭)
# 9~10 몽타주 · 11 로고 · 12 끝 화음(22.5초~)
END_BAR = 12
CHORDS = [  # (근음, 화음)
    (38, [62, 65, 69, 74]),   # Dm
    (46, [58, 62, 65, 70]),   # Bb
    (41, [60, 65, 69, 72]),   # F
    (48, [60, 64, 67, 72]),   # C
] * 3
STAB = [0, 0.75, 1.5, 2.5, 3.0]          # 박 단위 · 3-3-2 싱코페이션
MELODY = [  # 4마디 모티프(박 오프셋, 음)
    (0, 74), (0.5, 77), (1, 81), (1.5, 77), (2.5, 74), (3, 76),
    (4, 77), (4.75, 74), (5.5, 70), (6.5, 72), (7, 74),
    (8, 72), (8.5, 77), (9, 81), (9.5, 84), (10.5, 81), (11, 79),
    (12, 76), (12.75, 77), (13.5, 79), (14.5, 76), (15, 72),
]

kk = kick()
cp = clap()
hc = hat()
ho = hat(True)

for bar in range(END_BAR):
    t0 = bar * BAR
    root, chord = CHORDS[bar]
    brk = bar == 6                       # 숨 고르기: 킥·베이스 없이 화음 + 라이저
    full = 2 <= bar <= 11 and not brk
    if not brk:
        for b in range(4):
            if bar == 1 and b >= 2:
                continue  # 빌드업 끝 두 박은 비운다
            add(duck_src, np.ones(1), t0 + b * BEAT)
            add('st', kk, t0 + b * BEAT, 0.95)
    for b in (1, 3):
        if bar == 1 and b == 3:
            continue
        add('st', cp, t0 + b * BEAT, 0.8 if full else 0.55)
        add(send, cp, t0 + b * BEAT, 0.25)
    if not brk:
        for b in range(4):
            add('st', ho if full else hc, t0 + (b + 0.5) * BEAT, 0.9, pan=0.25)
            if full:
                add('st', hc, t0 + (b + 0.25) * BEAT, 0.5, pan=-0.3)
                add('st', hc, t0 + (b + 0.75) * BEAT, 0.5, pan=-0.3)
    if bar in (1, 6):
        for k in range(8):
            add('st', cp, t0 + 2 * BEAT + k * BEAT / 4, 0.25 + 0.06 * k)
        add('st', riser(BAR), t0, 1.0)
    if not brk:
        for b in range(4):
            if bar == 1 and b >= 2:
                continue
            add('st', bass(root, BEAT * 0.45), t0 + (b + 0.5) * BEAT, 1.0 if full else 0.7)
    for s_ in STAB:
        if bar == 1 and s_ >= 2:
            continue
        ch = supersaw_chord(chord, BEAT * (1.6 if brk else 0.9), 3800 if full else 2200)
        add('st', ch, t0 + s_ * BEAT, 0.55 if not brk else 0.4, pan=-0.15)
        add('st', ch, t0 + s_ * BEAT + 0.012, 0.45 if not brk else 0.3, pan=0.35)
        add(send, ch, t0 + s_ * BEAT, 0.3)
    if full:
        k0 = (bar - 2) % 4
        for off, m in MELODY:
            if k0 * 4 <= off < (k0 + 1) * 4:
                p = pluck(m)
                add('st', p, t0 + (off - k0 * 4) * BEAT, 0.6, pan=0.1)
                add(send, p, t0 + (off - k0 * 4) * BEAT, 0.35)

# 훅 마디 위 가벼운 플럭
for k, m in enumerate([74, 77, 81, 86]):
    add('st', pluck(m, bright=1.3), k * BEAT / 2 + BEAT * 2, 0.45)
# 드롭(네 채널) · 아웃트로 진입 크래시
add('st', crash(), 7 * BAR, 0.8)
add('st', crash(), 11 * BAR, 0.55)
# 엔딩: 크래시 + 길게 끄는 F 화음 + 종
t_end = END_BAR * BAR
add('st', crash(), t_end, 1.0)
add('st', kk, t_end, 1.0)
end_chord = np.zeros(int(2.5 * SR))
for m in (41, 53, 60, 65, 69, 72):
    end_chord += saw(midi(m), len(end_chord), rng.random() * 0.01)
end_chord = lowpass(end_chord / 6, 2500) * env(len(end_chord), a=0.01, d=1.0) * 0.5
add('st', end_chord, t_end)
add(send, end_chord, t_end, 0.4)
add('st', bell(89), t_end, 0.9)
add(send, bell(89), t_end, 0.5)

# 효과음 — 영상 장면 전환에 맞춘다(index.html 의 T 시각표와 같은 값)
for t in (BAR - 0.3, 2 * BAR - 0.25, 4 * BAR - 0.25, 5 * BAR - 0.25, 7 * BAR - 0.25, 9 * BAR - 0.25, 11 * BAR - 0.25):
    add('st', whoosh(), t, 1.0)
for k, t in enumerate((0.04, 0.47, 0.9)):  # 훅 세 줄
    add('st', pop(81 + 3 * k), t, 0.8)
for k, t in enumerate((2.2, 2.32, 2.44)): # 템플릿 세 장 펼침
    add('st', pop(86 + 2 * k), t, 0.9)
add('st', pop(79), 6.6, 1.2)              # 템플릿 누름
for t in (7.65, 8.05, 8.45, 8.75):        # 문구 칸 · 위치
    add('st', tick(), t, 1.2)
add('st', pop(79), 9.1, 1.2)              # 만들기
add('st', pop(91), 9.95, 1.0)             # 완성 포스터
add('st', tick(), 11.45, 1.2)             # 고칠 말
add('st', pop(79), 12.05, 1.2)            # 보내기
add('st', pop(93), 12.55, 1.0)            # 수정 완료
for k, t in enumerate((13.3, 13.75, 14.2, 14.65)):  # 네 채널
    add('st', pop(84 + 2 * k), t, 1.0)
for t in (18.4, 18.6, 18.8, 19.0, 19.2):  # 기능 이름표
    add('st', tick(), t, 1.0)
for t in (20.95, 21.07, 21.19, 21.31, 21.5, 21.65):  # 아웃트로 채널 · 밑줄에 AI
    add('st', tick(), t, 1.2)

# 사이드체인(킥마다 패드·베이스가 숨 쉬듯)
duck = np.ones(N)
for i in np.nonzero(duck_src)[0]:
    n = min(int(0.2 * SR), N - i)
    t = np.arange(n) / SR
    duck[i:i + n] = np.minimum(duck[i:i + n], 0.45 + 0.55 * (1 - np.exp(-t / 0.06)))
L *= 0.6 + 0.4 * duck
R *= 0.6 + 0.4 * duck

# 리버브(지수 감쇠 노이즈 IR · FFT 합성곱)
ir_n = int(1.6 * SR)
ir_t = np.arange(ir_n) / SR
irL = rng.standard_normal(ir_n) * np.exp(-ir_t / 0.45)
irR = rng.standard_normal(ir_n) * np.exp(-ir_t / 0.45)
size = 1 << int(np.ceil(np.log2(N + ir_n)))
S = np.fft.rfft(lowpass(send, 6000), size)
wetL = np.fft.irfft(S * np.fft.rfft(irL, size), size)[:N]
wetR = np.fft.irfft(S * np.fft.rfft(irR, size), size)[:N]
wet_gain = 0.22 / max(np.abs(wetL).max(), 1e-9)
L += wetL * wet_gain
R += wetR * wet_gain

# 마스터: 끝 0.5초 페이드 · 소프트 클립 · 정규화
fade = np.ones(N)
fn = int(0.5 * SR)
fade[-fn:] = np.linspace(1, 0, fn) ** 2
mix = np.stack([L * fade, R * fade], axis=1)
mix = np.tanh(mix / np.abs(mix).max() * 1.4)
mix = mix / np.abs(mix).max() * 0.89

with wave.open('music.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('music.wav', DUR, 's')
