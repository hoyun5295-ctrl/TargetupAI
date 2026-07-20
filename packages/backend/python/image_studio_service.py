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


def load_font(font_path, size, bold=True):
    """지정 폰트 → 한국어 폴백 → PIL 기본. bold면 malgunbd(굵게) 우선, 아니면 malgun(일반) 우선."""
    candidates = []
    if font_path:
        candidates.append(font_path)
    base = list(KO_FONT_FALLBACKS)
    if not bold and len(base) >= 2:
        base[0], base[1] = base[1], base[0]  # 일반체(malgun) 우선으로 스왑
    candidates += base
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
    """정제 타이포 — 라벨/제목/부제/뱃지(알약) + 정렬 + 효과(외곽선/그림자) + 굵기."""
    if not typo:
        return canvas
    bg_w, bg_h = canvas.size
    draw = ImageDraw.Draw(canvas)
    for t in typo:
        text = (t.get('text') or '').strip()
        if not text:
            continue
        size = max(8, int(float(t.get('size', 0.06)) * bg_h))
        bold = t.get('weight', 'bold') == 'bold'
        font = load_font(t.get('fontPath'), size, bold)
        color = hex_to_rgb(t.get('color', '#ffffff'))
        align = t.get('align', 'center')
        tx = int(float(t.get('x', 0.5)) * bg_w)
        ty = int(float(t.get('y', 0.1)) * bg_h)
        try:
            bbox = draw.textbbox((0, 0), text, font=font)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
        except Exception:
            tw = size * len(text) // 2
            th = size
        if align == 'center':
            ax = tx - tw // 2
        elif align == 'right':
            ax = tx - tw
        else:
            ax = tx

        if t.get('role') == 'badge':
            pad_x = int(size * 0.5)
            pad_y = int(size * 0.3)
            box = [ax - pad_x, ty - pad_y, ax + tw + pad_x, ty + th + pad_y]
            bcolor = hex_to_rgb(t.get('badgeColor', '#ffd24a'))
            try:
                draw.rounded_rectangle(box, radius=int((box[3] - box[1]) / 2), fill=bcolor)
            except Exception:
                draw.rectangle(box, fill=bcolor)
            draw.text((ax, ty), text, font=font, fill=color)
            continue

        effect = t.get('effect', 'plain')
        if effect == 'outline':
            try:
                draw.text((ax, ty), text, font=font, fill=color, stroke_width=max(2, size // 18), stroke_fill=(0, 0, 0))
            except Exception:
                draw.text((ax, ty), text, font=font, fill=color)
        elif effect == 'shadow':
            off = max(2, size // 20)
            draw.text((ax + off, ty + off), text, font=font, fill=(0, 0, 0))
            draw.text((ax, ty), text, font=font, fill=color)
        else:
            draw.text((ax, ty), text, font=font, fill=color)
    return canvas


def render_graphic_bg(spec, w, h):
    """그래픽 배경 렌더(AI 미사용) — solid/gradient/split/diagonal/frame."""
    kind = spec.get('kind', 'solid')
    cols = [hex_to_rgb(c) for c in (spec.get('colors') or ['#ffffff'])] or [(255, 255, 255)]
    canvas = Image.new('RGBA', (w, h), cols[0] + (255,))
    if kind == 'solid':
        return canvas
    if kind == 'gradient':
        c0 = cols[0]
        c1 = cols[1] if len(cols) > 1 else cols[0]
        strip = Image.new('RGBA', (1, h))
        sp = strip.load()
        for y in range(h):
            r = y / max(1, h - 1)
            sp[0, y] = tuple(int(c0[i] + (c1[i] - c0[i]) * r) for i in range(3)) + (255,)
        return strip.resize((w, h))
    if kind == 'split':
        ratio = spec.get('param', 0.5)
        ratio = float(ratio) if isinstance(ratio, (int, float)) else 0.5
        c1 = cols[1] if len(cols) > 1 else cols[0]
        ImageDraw.Draw(canvas).rectangle([0, int(h * ratio), w, h], fill=c1 + (255,))
        return canvas
    if kind == 'diagonal':
        d = ImageDraw.Draw(canvas)
        c1 = cols[1] if len(cols) > 1 else cols[0]
        c2 = cols[2] if len(cols) > 2 else c1
        if spec.get('param') == 'bl-tr':
            d.polygon([(0, h), (w, 0), (w, int(h * 0.4)), (int(w * 0.3), h)], fill=c1 + (255,))
            d.polygon([(0, h), (0, int(h * 0.6)), (int(w * 0.45), h)], fill=c2 + (255,))
        else:
            d.polygon([(0, 0), (w, h), (w, int(h * 0.6)), (int(w * 0.3), 0)], fill=c1 + (255,))
            d.polygon([(0, 0), (0, int(h * 0.4)), (int(w * 0.45), 0)], fill=c2 + (255,))
        return canvas
    if kind == 'frame':
        border = cols[1] if len(cols) > 1 else (200, 180, 140)
        m = int(min(w, h) * 0.05)
        ImageDraw.Draw(canvas).rectangle([m, m, w - m, h - m], outline=border + (255,), width=max(2, int(min(w, h) * 0.008)))
        return canvas
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


def _parse_ratio(ratio):
    """'3:4' → (3.0, 4.0). 무효 시 3:4 기본."""
    try:
        a, b = str(ratio or '').split(':')
        rw, rh = float(a), float(b)
        if rw > 0 and rh > 0:
            return rw, rh
    except Exception:
        pass
    return 3.0, 4.0


@app.post('/refit')
def refit():
    """★ 2026-07-21 채널 변환 = 비율 조정(원본 픽셀 100% 보존). AI 재생성 아님 — 상품 색·디테일 무손.
    원본을 대상 비율 캔버스에 contain(잘림 0)하고, 남는 여백은 원본을 cover로 확대+블러한 배경으로 채운다(레터박스 X)."""
    try:
        data = request.get_json(force=True)
        src = data['src']
        out = data['out']
        if not os.path.exists(src):
            return jsonify({'ok': False, 'error': 'src not found'}), 400
        rw, rh = _parse_ratio(data.get('aspect_ratio'))
        img = Image.open(src).convert('RGB')
        w, h = img.size
        # 캔버스 = 원본을 완전히 포함하는 최소 대상비율 크기(원본 잘림 0)
        if (w / h) > (rw / rh):
            cw, ch = w, max(1, int(round(w * rh / rw)))
        else:
            cw, ch = max(1, int(round(h * rw / rh))), h
        # 배경 = 원본 cover(캔버스 꽉 채우고 넘침) + 강한 블러
        scale_bg = max(cw / w, ch / h)
        bw, bh = max(1, int(round(w * scale_bg))), max(1, int(round(h * scale_bg)))
        bg = img.resize((bw, bh), Image.LANCZOS)
        left, top = (bw - cw) // 2, (bh - ch) // 2
        bg = bg.crop((left, top, left + cw, top + ch)).filter(ImageFilter.GaussianBlur(max(8, cw // 40)))
        # 전경 = 원본 그대로 중앙 배치(잘림 0)
        canvas = bg.copy()
        canvas.paste(img, ((cw - w) // 2, (ch - h) // 2))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        fmt = data.get('format', 'jpeg')
        if fmt == 'png':
            canvas.save(out, 'PNG')
            mime = 'image/png'
        else:
            canvas.save(out, 'JPEG', quality=90)
            mime = 'image/jpeg'
        return jsonify({'ok': True, 'bytes': os.path.getsize(out), 'width': cw, 'height': ch, 'mime': mime})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e)[:200]}), 500


@app.post('/compose')
def compose():
    try:
        data = request.get_json(force=True)
        out = data['out']
        graphic = data.get('graphic_bg')
        if graphic:
            cw = int(data.get('canvas_w') or 1200)
            ch = int(data.get('canvas_h') or 1600)
            canvas = render_graphic_bg(graphic, cw, ch)
        else:
            bg_path = data['bg']
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
