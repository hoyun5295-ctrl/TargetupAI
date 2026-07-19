#!/usr/bin/env python3
"""
image_studio_service.py — P4 이미지 스튜디오 상주 python 서비스 (2026-07-19)

역할: 누끼(rembg isnet-general-use) + 서버 합성(PIL — 알파 bbox 트림·접지 그림자·정제 타이포·MMS 용량 보장).
node backend(routes/image-studio.ts)가 127.0.0.1 HTTP로 호출한다. 파일 경로 기반(같은 서버 파일시스템 공유 — b64 왕복 없음).

★ 127.0.0.1 전용 바인딩 의무 (0.0.0.0 절대 금지 — 2026-02-28 랜섬웨어 교훈).
★ 모델 프리로드(179MB) + 단일 워커(threaded=False)로 rembg 메모리 스파이크 직렬화.

실행(rembg venv): /home/administrator/rembg-venv/bin/python packages/backend/python/image_studio_service.py
필요 패키지: rembg[cpu], pillow, flask  (deploy에서 flask 추가 설치)
env: STUDIO_PY_PORT(기본 8555)
"""

import os
import io
import sys
import traceback
from flask import Flask, request, jsonify
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from rembg import remove, new_session

PORT = int(os.environ.get('STUDIO_PY_PORT', '8555'))
MODEL_NAME = os.environ.get('STUDIO_REMBG_MODEL', 'isnet-general-use')

app = Flask(__name__)

# 모델 프리로드 (첫 요청 지연·재로드 방지)
print(f'[studio-py] loading rembg model: {MODEL_NAME} ...', flush=True)
SESSION = new_session(MODEL_NAME)
print('[studio-py] model ready', flush=True)

# 한국어 폰트 폴백 후보 — 리포 동봉(malgun) 우선 → 시스템 폰트 → DejaVu.
#   리포 fonts/는 packages/backend/fonts/ (이 스크립트 기준 ../fonts). 한글 굵게(malgunbd) = 헤드라인.
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
KO_FONT_FALLBACKS = [
    os.path.join(_SCRIPT_DIR, '..', 'fonts', 'malgunbd.ttf'),
    os.path.join(_SCRIPT_DIR, '..', 'fonts', 'malgun.ttf'),
    '/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf',
    '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]


def load_font(font_path, size):
    """지정 폰트 → 한국어 폴백 → PIL 기본. 한글 렌더 위해 CJK 폰트 우선."""
    candidates = []
    if font_path:
        candidates.append(font_path)
    candidates += KO_FONT_FALLBACKS
    for p in candidates:
        try:
            if p and os.path.exists(p):
                return ImageFont.truetype(p, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default()
    except Exception:
        return None


def hex_to_rgb(h):
    h = (h or '#ffffff').lstrip('#')
    try:
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    except Exception:
        return (255, 255, 255)


@app.get('/health')
def health():
    return jsonify({'ok': True, 'model': MODEL_NAME})


@app.post('/remove-bg')
def remove_bg():
    try:
        data = request.get_json(force=True)
        src = data['src']
        out = data['out']
        if not os.path.exists(src):
            return jsonify({'ok': False, 'error': 'src not found'}), 400
        img = Image.open(src).convert('RGBA')
        # rembg CPU 추론 시간 확보 — 최장변 2000px로 다운스케일(§5-1-2)
        if max(img.size) > 2000:
            r = 2000.0 / max(img.size)
            img = img.resize((int(img.width * r), int(img.height * r)), Image.LANCZOS)
        cut = remove(img, session=SESSION).convert('RGBA')
        os.makedirs(os.path.dirname(out), exist_ok=True)
        cut.save(out, 'PNG')
        return jsonify({'ok': True, 'width': cut.width, 'height': cut.height})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e)[:200]}), 500


def _place_product(canvas, cutout, layout):
    """알파 bbox 트림 + 스케일 + 접지 그림자(알파 기반) + 제품 합성."""
    bg_w, bg_h = canvas.size
    prod = cutout.convert('RGBA')
    bbox = prod.getbbox()
    if bbox:
        prod = prod.crop(bbox)
    scale = float(layout.get('scale', 0.5)) if layout else 0.5
    cx = float(layout.get('x', 0.5)) if layout else 0.5
    by = float(layout.get('y', 0.72)) if layout else 0.72
    pw = max(1, int(bg_w * scale))
    ph = max(1, int(prod.height * pw / prod.width))
    prod = prod.resize((pw, ph), Image.LANCZOS)
    px = int(cx * bg_w) - pw // 2
    base_y = int(by * bg_h)
    py = base_y - ph

    # 접지 그림자 — 제품 알파를 납작하게 눌러 바닥에 밀착 + 블러(개별 실루엣 기반)
    alpha = prod.split()[3]
    sh_h = max(8, int(ph * 0.18))
    shadow_alpha = alpha.resize((pw, sh_h), Image.LANCZOS)
    black = Image.new('RGBA', (pw, sh_h), (0, 0, 0, 130))
    transparent = Image.new('RGBA', (pw, sh_h), (0, 0, 0, 0))
    shadow = Image.composite(black, transparent, shadow_alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(4, int(pw * 0.02))))
    canvas.alpha_composite(shadow, (px, base_y - sh_h // 2))
    canvas.alpha_composite(prod, (px, py))
    return canvas


def _draw_typography(canvas, typo):
    """정제 타이포(라벨/제목/부제) — 가독성 위해 미세 그림자 + 정렬."""
    if not typo:
        return canvas
    bg_w, bg_h = canvas.size
    draw = ImageDraw.Draw(canvas)
    for t in typo:
        text = (t.get('text') or '').strip()
        if not text:
            continue
        size = max(8, int(float(t.get('size', 0.06)) * bg_h))
        font = load_font(t.get('fontPath'), size)
        color = hex_to_rgb(t.get('color', '#ffffff'))
        tx = int(float(t.get('x', 0.5)) * bg_w)
        ty = int(float(t.get('y', 0.1)) * bg_h)
        align = t.get('align', 'center')
        try:
            bbox = draw.textbbox((0, 0), text, font=font)
            tw = bbox[2] - bbox[0]
        except Exception:
            tw = size * len(text) // 2
        if align == 'center':
            tx -= tw // 2
        elif align == 'right':
            tx -= tw
        # 가독성 그림자 후 본문
        draw.text((tx + 2, ty + 2), text, font=font, fill=(0, 0, 0))
        draw.text((tx, ty), text, font=font, fill=color)
    return canvas


def _save_jpeg_under(img, out, max_bytes):
    """MMS 용량 보장 — 최장변 1080 리사이즈 + JPEG 품질 이진탐색 ≤ max_bytes(§4-4 트랙 B)."""
    rgb = img.convert('RGB')
    w, h = rgb.size
    if max(w, h) > 1080:
        r = 1080.0 / max(w, h)
        rgb = rgb.resize((int(w * r), int(h * r)), Image.LANCZOS)
    lo, hi, best = 30, 92, None
    while lo <= hi:
        mid = (lo + hi) // 2
        buf = io.BytesIO()
        rgb.save(buf, 'JPEG', quality=mid)
        if buf.tell() <= max_bytes:
            best = buf.getvalue()
            lo = mid + 1
        else:
            hi = mid - 1
    if best is None:
        # q30에도 초과 → 더 축소 후 재시도
        rgb = rgb.resize((int(rgb.width * 0.8), int(rgb.height * 0.8)), Image.LANCZOS)
        buf = io.BytesIO()
        rgb.save(buf, 'JPEG', quality=60)
        best = buf.getvalue()
    with open(out, 'wb') as f:
        f.write(best)
    return len(best), rgb.width, rgb.height


@app.post('/compose')
def compose():
    try:
        data = request.get_json(force=True)
        bg_path = data['bg']
        out = data['out']
        if not os.path.exists(bg_path):
            return jsonify({'ok': False, 'error': 'bg not found'}), 400
        canvas = Image.open(bg_path).convert('RGBA')

        cutout_path = data.get('cutout')
        if cutout_path and os.path.exists(cutout_path):
            canvas = _place_product(canvas, Image.open(cutout_path), data.get('layout') or {})

        canvas = _draw_typography(canvas, data.get('typography') or [])

        os.makedirs(os.path.dirname(out), exist_ok=True)
        mms_max = data.get('mms_max_bytes')
        if mms_max:
            nbytes, w, h = _save_jpeg_under(canvas, out, int(mms_max))
            return jsonify({'ok': True, 'bytes': nbytes, 'width': w, 'height': h, 'mime': 'image/jpeg'})

        fmt = data.get('format', 'jpeg')
        if fmt == 'png':
            canvas.save(out, 'PNG')
            mime = 'image/png'
        else:
            canvas.convert('RGB').save(out, 'JPEG', quality=90)
            mime = 'image/jpeg'
        nbytes = os.path.getsize(out)
        return jsonify({'ok': True, 'bytes': nbytes, 'width': canvas.width, 'height': canvas.height, 'mime': mime})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e)[:200]}), 500


if __name__ == '__main__':
    # ★ 127.0.0.1 전용 — 외부 노출 금지. 단일 워커(threaded=False) = rembg 직렬화.
    print(f'[studio-py] listening on 127.0.0.1:{PORT}', flush=True)
    app.run(host='127.0.0.1', port=PORT, threaded=False)
