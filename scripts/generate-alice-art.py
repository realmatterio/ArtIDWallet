"""Generate ten original artworks for Artist Alice's demo wallet.

Usage: python3 scripts/generate-alice-art.py images/art/alice [function ...]
Needs Pillow and NumPy. Output is deterministic (fixed seeds)."""
import math, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

OUT = sys.argv[1]
S = 1600          # render size; downsampled to 800 for antialiasing
FINAL = 800
os.makedirs(OUT, exist_ok=True)


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lerp(a, b, t):
    return a + (b - a) * t


def gradient(stops, n):
    """stops: [(pos, '#hex')] -> (n,3) float array"""
    xs = np.linspace(0, 1, n)
    out = np.zeros((n, 3))
    pos = [p for p, _ in stops]
    cols = np.array([hexrgb(c) for _, c in stops], float)
    for ch in range(3):
        out[:, ch] = np.interp(xs, pos, cols[:, ch])
    return out


def vgrad(stops, w=S, h=S):
    g = gradient(stops, h)
    return np.repeat(g[:, None, :], w, axis=1)


def to_img(arr):
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')


def value_noise_1d(n, octaves, rng, base=8):
    out = np.zeros(n)
    amp, freq, tot = 1.0, base, 0
    for _ in range(octaves):
        pts = rng.random(freq + 2)
        xs = np.linspace(0, freq, n)
        i = xs.astype(int)
        f = xs - i
        f = f * f * (3 - 2 * f)
        out += amp * (pts[i] * (1 - f) + pts[i + 1] * f)
        tot += amp
        amp *= 0.5
        freq *= 2
    return out / tot


def value_noise_2d(n, cells, rng):
    grid = rng.random((cells + 2, cells + 2))
    xs = np.linspace(0, cells, n)
    i = xs.astype(int)
    f = xs - i
    f = f * f * (3 - 2 * f)
    a = grid[np.ix_(i, i)]
    b = grid[np.ix_(i, i + 1)]
    c = grid[np.ix_(i + 1, i)]
    d = grid[np.ix_(i + 1, i + 1)]
    fx = f[None, :]
    fy = f[:, None]
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy)


def grain(img, amount=10, seed=0):
    rng = np.random.default_rng(seed)
    arr = np.asarray(img).astype(float)
    arr += rng.normal(0, amount, arr.shape[:2])[..., None]
    return to_img(arr)


def save(img, name):
    img = img.resize((FINAL, FINAL), Image.LANCZOS)
    img.save(os.path.join(OUT, name + '.jpg'), quality=90, optimize=True, progressive=True)
    print('wrote', name)


def seal(draw, x, y, s, color='#c8322b'):
    draw.rounded_rectangle([x, y, x + s, y + s], radius=s * 0.12, fill=color)
    w = s * 0.12
    c = '#f6e9d8'
    draw.rectangle([x + s * .25, y + s * .22, x + s * .25 + w, y + s * .78], fill=c)
    draw.rectangle([x + s * .25, y + s * .22, x + s * .75, y + s * .22 + w], fill=c)
    draw.rectangle([x + s * .63, y + s * .22, x + s * .63 + w, y + s * .78], fill=c)
    draw.rectangle([x + s * .25, y + s * .5 - w / 2, x + s * .75, y + s * .5 + w / 2], fill=c)


# 1 --------------------------------------------------------------------------
def pearl_river_dusk():
    rng = np.random.default_rng(1)
    horizon = int(S * 0.62)
    sky = vgrad([(0, '#1b1446'), (0.35, '#5a1f63'), (0.62, '#d9466b'), (0.85, '#f7955a'), (1, '#ffd37a')], S, horizon)
    water = vgrad([(0, '#3a1850'), (0.5, '#1c1240'), (1, '#0d0a26')], S, S - horizon)
    img = to_img(np.concatenate([sky, water], 0))
    d = ImageDraw.Draw(img, 'RGBA')
    # sun with retro slits
    cx, cy, r = S * 0.5, horizon - S * 0.07, S * 0.2
    sun = Image.new('L', (S, S), 0)
    sd = ImageDraw.Draw(sun)
    sd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    for k in range(7):
        y = cy + r * 0.1 + k * r * 0.14
        sd.rectangle([0, y, S, y + 4 + k * 3.2], fill=0)
    sun_col = to_img(vgrad([(0, '#fff2a8'), (0.5, '#ffb35c'), (1, '#ff5e7e')], S, S))
    glow = sun.filter(ImageFilter.GaussianBlur(70))
    img = Image.composite(Image.new('RGB', (S, S), '#ffb36b'), img, glow.point(lambda v: v * 0.45))
    img.paste(sun_col, (0, int(cy - r - (S / 2 - r)) if False else 0), sun)
    d = ImageDraw.Draw(img, 'RGBA')
    # hills
    for layer, (col, base, amp) in enumerate([('#3b1a5c', 0.0, 70), ('#24123f', 0.02, 46)]):
        nz = value_noise_1d(S, 4, rng, 5)
        pts = [(x, horizon - base * S - nz[x] * amp - 6) for x in range(0, S, 4)]
        d.polygon(pts + [(S, horizon), (0, horizon)], fill=col)
    # city sliver
    x = 0
    while x < S:
        w = rng.integers(14, 40)
        h = rng.integers(8, 70) * (1.6 if S * 0.62 < x < S * 0.8 else 1)
        d.rectangle([x, horizon - h, x + w, horizon], fill='#160c2c')
        x += w + rng.integers(0, 6)
    # reflections
    for i in range(110):
        y = horizon + 6 + (i ** 1.35) * 1.6
        if y > S: break
        spread = r * (0.5 + i / 70)
        a = int(max(0, 200 - i * 1.7))
        w = spread * rng.uniform(0.35, 1.0)
        x0 = cx + rng.uniform(-0.25, 0.25) * spread
        d.rounded_rectangle([x0 - w, y, x0 + w, y + 3 + i * 0.05], radius=3, fill=(255, 190, 120, a))
    for i in range(260):
        y = rng.uniform(horizon + 10, S)
        x = rng.uniform(0, S)
        w = rng.uniform(10, 60)
        d.line([x, y, x + w, y], fill=(255, 140, 160, int(rng.uniform(20, 70))), width=2)
    img = grain(img, 7, 1)
    save(img, 'pearl-river-dusk')


# 2 --------------------------------------------------------------------------
def harbour_lights():
    rng = np.random.default_rng(2)
    horizon = int(S * 0.58)
    sky = vgrad([(0, '#070b1f'), (0.6, '#122046'), (1, '#2b3c74')], S, horizon)
    img = to_img(np.concatenate([sky, vgrad([(0, '#0a1230'), (1, '#03050f')], S, S - horizon)], 0))
    city = Image.new('RGBA', (S, horizon), (0, 0, 0, 0))
    cd = ImageDraw.Draw(city)
    # back + front rows
    for row, (col, hmin, hmax, lit) in enumerate([((22, 34, 72, 255), 120, 420, 0.25), ((10, 15, 36, 255), 60, 640, 0.45)]):
        x = -20
        while x < S:
            w = int(rng.integers(50, 130))
            h = int(rng.integers(hmin, hmax))
            if row == 1 and 560 < x < 760: h = 760   # the tall tower
            top = horizon - h
            cd.rectangle([x, top, x + w, horizon], fill=col)
            if row == 1 and h > 500:
                cd.polygon([(x, top), (x + w, top), (x + w / 2, top - 70)], fill=col)
                cd.line([x + w / 2, top - 70, x + w / 2, top - 140], fill=col, width=5)
            for wy in range(top + 14, horizon - 10, 18):
                for wx in range(x + 8, x + w - 8, 14):
                    if rng.random() < lit:
                        c = [(255, 214, 140), (160, 220, 255), (255, 160, 200)][int(rng.integers(0, 3))]
                        cd.rectangle([wx, wy, wx + 6, wy + 8], fill=c + (int(rng.integers(150, 255)),))
            x += w + int(rng.integers(2, 14))
    img.paste(city, (0, 0), city)
    # reflection: flip, blur horizontally, ripple
    ref = city.transpose(Image.FLIP_TOP_BOTTOM).crop((0, 0, S, S - horizon))
    arr = np.asarray(ref).copy()
    for y in range(arr.shape[0]):
        shift = int(math.sin(y * 0.09) * (3 + y * 0.03) + rng.normal(0, 2))
        arr[y] = np.roll(arr[y], shift, axis=0)
    ref = Image.fromarray(arr, 'RGBA').filter(ImageFilter.BoxBlur(3))
    a = ref.getchannel('A').point(lambda v: v * 0.55)
    ref.putalpha(a)
    img.paste(ref, (0, horizon), ref)
    # bokeh
    bok = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bok)
    for _ in range(45):
        r = rng.uniform(18, 70)
        x, y = rng.uniform(0, S), rng.uniform(S * 0.05, S * 0.95)
        c = [(255, 190, 110), (120, 200, 255), (255, 120, 190)][int(rng.integers(0, 3))]
        bd.ellipse([x - r, y - r, x + r, y + r], fill=c + (int(rng.uniform(25, 60)),))
    bok = bok.filter(ImageFilter.GaussianBlur(6))
    img = Image.alpha_composite(img.convert('RGBA'), bok).convert('RGB')
    img = grain(img, 6, 2)
    save(img, 'harbour-lights')


# 3 --------------------------------------------------------------------------
def bauhaus_tram():
    img = Image.new('RGB', (S, S), '#efe6d2')
    d = ImageDraw.Draw(img)
    red, blue, yellow, ink, cream = '#d6402e', '#21479b', '#f0b429', '#1c1c1c', '#efe6d2'
    u = S / 16
    d.rectangle([0, 0, 6 * u, 16 * u], fill=blue)
    d.ellipse([3 * u, 2 * u, 13 * u, 12 * u], fill=red)
    d.pieslice([8 * u, 8 * u, 16 * u, 16 * u], 180, 360, fill=yellow)
    d.rectangle([8 * u, 12 * u, 16 * u, 16 * u], fill=ink)
    d.ellipse([10.5 * u, 12.6 * u, 13.5 * u, 15.6 * u], fill=cream)
    d.pieslice([0, 9 * u, 6 * u, 15 * u], 270, 90, fill=yellow)
    d.rectangle([1 * u, 1 * u, 2.2 * u, 7 * u], fill=cream)
    d.rectangle([13 * u, 1 * u, 15 * u, 3 * u], fill=ink)
    d.line([0, 8 * u, 16 * u, 8 * u], fill=ink, width=int(u * 0.22))
    d.line([6 * u, 0, 6 * u, 16 * u], fill=ink, width=int(u * 0.12))
    for i in range(6):
        y = 3.2 * u + i * 0.55 * u
        d.line([8.6 * u, y, 10.8 * u, y], fill=ink, width=int(u * 0.14))
    d.ellipse([7.4 * u, 6.6 * u, 8.6 * u, 7.8 * u], fill=ink)
    d.polygon([(13 * u, 4.5 * u), (16 * u, 4.5 * u), (16 * u, 7.5 * u)], fill=blue)
    img = grain(img, 9, 3)
    save(img, 'bauhaus-tram')


# 4 --------------------------------------------------------------------------
def jade_current():
    rng = np.random.default_rng(4)
    img = to_img(vgrad([(0, '#062a24'), (1, '#0c3b31')]))
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    n = 200
    ang = value_noise_2d(n, 5, rng) * math.pi * 4.0
    palette = [hexrgb(c) for c in ['#7fd1ae', '#b6e8c9', '#3fa37f', '#e4f5d0', '#2c7a64', '#f2c879']]
    for i in range(1700):
        x, y = rng.uniform(0, S), rng.uniform(0, S)
        col = palette[int(rng.integers(0, len(palette)))] if rng.random() > 0.03 else hexrgb('#f2c879')
        pts = [(x, y)]
        steps = int(rng.integers(40, 140))
        for _ in range(steps):
            gx, gy = int(x / S * (n - 1)), int(y / S * (n - 1))
            if not (0 <= gx < n and 0 <= gy < n): break
            a = ang[gy, gx]
            x += math.cos(a) * 6
            y += math.sin(a) * 6
            pts.append((x, y))
        if len(pts) > 3:
            d.line(pts, fill=col + (int(rng.uniform(70, 190)),), width=int(rng.integers(2, 6)), joint='curve')
    glow = layer.filter(ImageFilter.GaussianBlur(8))
    img = Image.alpha_composite(img.convert('RGBA'), glow)
    img = Image.alpha_composite(img, layer).convert('RGB')
    img = grain(img, 5, 4)
    save(img, 'jade-current')


# 5 --------------------------------------------------------------------------
def lantern_grid():
    rng = np.random.default_rng(5)
    img = Image.new('RGB', (S, S), '#a3161a')
    d = ImageDraw.Draw(img)
    n = 10
    t = S / n
    gold, deep = '#f3c14b', '#7a0d12'
    for gy in range(n):
        for gx in range(n):
            x, y = gx * t, gy * t
            if (gx + gy) % 2:
                d.rectangle([x, y, x + t, y + t], fill='#b41d20')
            w = int(t * 0.16)
            if rng.random() < 0.5:
                arcs = [((x - t / 2, y - t / 2, x + t / 2, y + t / 2), 0, 90), ((x + t / 2, y + t / 2, x + 3 * t / 2, y + 3 * t / 2), 180, 270)]
            else:
                arcs = [((x + t / 2, y - t / 2, x + 3 * t / 2, y + t / 2), 90, 180), ((x - t / 2, y + t / 2, x + t / 2, y + 3 * t / 2), 270, 360)]
            for box, a0, a1 in arcs:
                d.arc(box, a0, a1, fill=deep, width=w + 10)
                d.arc(box, a0, a1, fill=gold, width=w)
    # a few lanterns
    for _ in range(5):
        cx, cy = rng.uniform(0.12, 0.88) * S, rng.uniform(0.12, 0.88) * S
        r = rng.uniform(0.045, 0.07) * S
        d.line([cx, cy - r * 2.2, cx, cy - r], fill=deep, width=6)
        d.ellipse([cx - r, cy - r * 0.85, cx + r, cy + r * 0.85], fill='#ff5b3a', outline=gold, width=8)
        d.rectangle([cx - r * 0.45, cy - r, cx + r * 0.45, cy - r * 0.75], fill=gold)
        d.rectangle([cx - r * 0.45, cy + r * 0.75, cx + r * 0.45, cy + r], fill=gold)
        for k in (-0.5, 0, 0.5):
            d.arc([cx - r * abs(k) - 2, cy - r * 0.85, cx + r * abs(k) + 2, cy + r * 0.85], 0, 360, fill=gold, width=3) if k else d.line([cx, cy - r * 0.85, cx, cy + r * 0.85], fill=gold, width=3)
        d.line([cx, cy + r, cx, cy + r * 1.7], fill=gold, width=5)
    img = grain(img, 8, 5)
    save(img, 'lantern-grid')


# 6 --------------------------------------------------------------------------
def lantau_mist():
    rng = np.random.default_rng(6)
    img = to_img(vgrad([(0, '#e9e4d8'), (0.6, '#f3efe5'), (1, '#ddd6c6')]))
    d = ImageDraw.Draw(img, 'RGBA')
    d.ellipse([S * 0.62, S * 0.16, S * 0.8, S * 0.34], fill='#d2513f')
    layers = 7
    for i in range(layers):
        t = i / (layers - 1)
        base = S * (0.42 + t * 0.48)
        amp = S * (0.22 - t * 0.12)
        nz = value_noise_1d(S, 5, rng, 3 + i)
        col = tuple(int(lerp(a, b, t)) for a, b in zip(hexrgb('#b9bfc4'), hexrgb('#1f2a33')))
        pts = [(x, base - nz[x] * amp) for x in range(0, S, 3)]
        mtn = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        md = ImageDraw.Draw(mtn)
        md.polygon(pts + [(S, S), (0, S)], fill=col + (255,))
        # mist band fading the foot of each ridge
        fog = Image.new('L', (S, S), 0)
        fa = np.zeros((S, S))
        ys = np.arange(S)[:, None]
        fa[:] = np.clip((ys - (base - amp * 0.2)) / (amp * 0.9 + 1), 0, 1) * 150
        fog = Image.fromarray(fa.astype(np.uint8), 'L')
        img.paste(mtn, (0, 0), mtn)
        mist = Image.new('RGB', (S, S), '#ece7dc')
        img = Image.composite(mist, img, ImageChops.multiply(fog, mtn.getchannel('A')))
    d = ImageDraw.Draw(img, 'RGBA')
    # birds
    for _ in range(6):
        bx, by, bs = rng.uniform(0.2, 0.55) * S, rng.uniform(0.18, 0.32) * S, rng.uniform(10, 22)
        d.line([(bx - bs, by - bs * 0.4), (bx, by), (bx + bs, by - bs * 0.5)], fill='#2b2b2b', width=3)
    seal(d, S * 0.08, S * 0.08, S * 0.07)
    img = grain(img, 7, 6)
    save(img, 'lantau-mist')


# 7 --------------------------------------------------------------------------
def neon_kowloon():
    horizon = int(S * 0.56)
    img = to_img(np.concatenate([
        vgrad([(0, '#0b0221'), (0.7, '#2d0b4e'), (1, '#6b1a6e')], S, horizon),
        vgrad([(0, '#14032b'), (1, '#05010d')], S, S - horizon)], 0))
    neon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    nd = ImageDraw.Draw(neon)
    # sun
    cx, cy, r = S / 2, horizon - S * 0.12, S * 0.2
    sunmask = Image.new('L', (S, S), 0)
    smd = ImageDraw.Draw(sunmask)
    smd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    for k in range(8):
        y = cy + k * r * 0.13
        smd.rectangle([0, y, S, y + 3 + k * 3], fill=0)
    smd.rectangle([0, horizon, S, S], fill=0)
    neon.paste(to_img(vgrad([(0, '#ffe66d'), (0.45, '#ff7b54'), (1, '#ff2e88')])).convert('RGBA'), (0, 0), sunmask)
    # grid floor
    pink = (255, 60, 190, 255)
    for i in range(-24, 25):
        nd.line([cx + i * 12, horizon, cx + i * 170, S], fill=pink, width=3)
    y, gap = horizon, 6
    while y < S:
        nd.line([0, y, S, y], fill=pink, width=3)
        gap *= 1.28
        y += gap
    # skyline signs silhouettes
    rng = np.random.default_rng(7)
    x = 0
    while x < S:
        w = int(rng.integers(40, 110)); h = int(rng.integers(40, 260))
        if abs(x + w / 2 - cx) > r * 0.9:
            nd.rectangle([x, horizon - h, x + w, horizon], fill=(10, 2, 30, 255), outline=(0, 240, 255, 255), width=3)
            for k in range(int(rng.integers(0, 3))):
                sy = horizon - h + 20 + k * 40
                nd.rectangle([x + 10, sy, x + w - 10, sy + 14], fill=[(0, 240, 255, 230), (255, 60, 190, 230), (255, 230, 109, 230)][int(rng.integers(0, 3))])
        x += w + int(rng.integers(6, 30))
    glow = neon.filter(ImageFilter.GaussianBlur(14))
    img = Image.alpha_composite(img.convert('RGBA'), glow)
    img = Image.alpha_composite(img, neon).convert('RGB')
    img = grain(img, 6, 7)
    save(img, 'neon-kowloon')


# 8 --------------------------------------------------------------------------
def tidal_rings():
    ys, xs = np.mgrid[0:S, 0:S] / S
    d1 = np.hypot(xs - 0.32, ys - 0.38)
    d2 = np.hypot(xs - 0.7, ys - 0.66)
    v = np.sin(d1 * 120) + np.sin(d2 * 104)
    v = (v + 2) / 4
    v = 1 / (1 + np.exp(-(v - 0.5) * 14))
    pal = gradient([(0, '#0d3b4f'), (0.45, '#1d7b8a'), (0.55, '#f4e9d4'), (1, '#f7c59f')], 256)
    img = pal[(v * 255).astype(int)]
    vign = np.clip(1.1 - np.hypot(xs - 0.5, ys - 0.5) * 0.8, 0, 1)[..., None]
    img = to_img(img * vign + (1 - vign) * np.array(hexrgb('#0a2633')))
    img = grain(img, 5, 8)
    save(img, 'tidal-rings')


# 9 --------------------------------------------------------------------------
def plum_blossom():
    rng = random.Random(9)
    base = vgrad([(0, '#f4ede0'), (1, '#e8dcc6')])
    img = to_img(base)
    d = ImageDraw.Draw(img, 'RGBA')
    blossoms = []

    def branch(x, y, ang, length, width, depth):
        if depth == 0 or length < 18:
            blossoms.append((x, y)); return
        segs = 6
        for _ in range(segs):
            ang += rng.uniform(-0.28, 0.28)
            nx, ny = x + math.cos(ang) * length / segs, y + math.sin(ang) * length / segs
            d.line([x, y, nx, ny], fill=(34, 26, 24, 255), width=max(2, int(width)))
            d.ellipse([nx - width / 2, ny - width / 2, nx + width / 2, ny + width / 2], fill=(34, 26, 24, 255))
            x, y = nx, ny
            width *= 0.93
            if rng.random() < 0.35: blossoms.append((x, y))
        for k in range(rng.choice([2, 2, 3])):
            branch(x, y, ang + rng.uniform(-0.75, 0.75), length * rng.uniform(0.55, 0.78), width * 0.75, depth - 1)

    branch(-20, S * 0.88, -0.42, S * 0.42, 46, 6)
    branch(S + 20, S * 0.3, math.pi + 0.25, S * 0.32, 26, 5)
    branch(S * 0.3, S + 20, -1.25, S * 0.3, 22, 4)
    for (x, y) in blossoms:
        for _ in range(rng.choice([1, 1, 2])):
            bx, by = x + rng.uniform(-22, 22), y + rng.uniform(-22, 22)
            r = rng.uniform(11, 22)
            col = rng.choice([(231, 96, 128), (244, 150, 170), (214, 60, 98), (250, 196, 206)])
            for p in range(5):
                a = p * 2 * math.pi / 5 + rng.uniform(0, 0.4)
                px, py = bx + math.cos(a) * r * 0.75, by + math.sin(a) * r * 0.75
                d.ellipse([px - r * 0.62, py - r * 0.62, px + r * 0.62, py + r * 0.62], fill=col + (215,))
            d.ellipse([bx - r * 0.25, by - r * 0.25, bx + r * 0.25, by + r * 0.25], fill=(246, 204, 92, 255))
    # falling petals
    for _ in range(40):
        x, y, r = rng.uniform(0, S), rng.uniform(0, S), rng.uniform(5, 10)
        d.ellipse([x - r, y - r * 0.6, x + r, y + r * 0.6], fill=(236, 120, 150, 150))
    seal(d, S * 0.84, S * 0.84, S * 0.08)
    img = grain(img, 8, 9)
    save(img, 'plum-blossom')


# 10 -------------------------------------------------------------------------
def signal_eight():
    ys, xs = np.mgrid[0:S, 0:S] / S - 0.5
    r = np.hypot(xs, ys) + 1e-6
    th = np.arctan2(ys, xs)
    twist = 2.6 / (r + 0.06)
    bands = np.sin(th * 3 + twist + np.log(r) * 4)
    v = (bands + 1) / 2
    v = v ** 1.4
    eye = np.clip((r - 0.035) / 0.05, 0, 1)
    fade = np.clip(1.25 - r * 1.6, 0, 1)
    val = v * eye * fade
    pal = gradient([(0, '#08162e'), (0.35, '#1e4f8c'), (0.7, '#8fc2e8'), (1, '#f6fbff')], 256)
    img = pal[(np.clip(val, 0, 1) * 255).astype(int)]
    img = to_img(img)
    d = ImageDraw.Draw(img)
    # the No. 8 signal: an inverted T in the corner
    u = S * 0.04
    x0, y0 = S * 0.86, S * 0.08
    d.rectangle([x0 - u * 0.25, y0, x0 + u * 0.25, y0 + u * 1.6], fill='#f2c14b')
    d.polygon([(x0 - u, y0 + u * 1.6), (x0 + u, y0 + u * 1.6), (x0, y0 + u * 0.7)], fill='#f2c14b')
    img = grain(img, 5, 10)
    save(img, 'signal-eight')


for fn in ([globals()[n] for n in sys.argv[2:]] or [pearl_river_dusk, harbour_lights, bauhaus_tram, jade_current, lantern_grid,
           lantau_mist, neon_kowloon, tidal_rings, plum_blossom, signal_eight]):
    fn()
