"""Reproduce original CC0 frame artwork. Build-time only: Python + Pillow.

Run from any directory. The app uses embedded GIF bytes; no Python at runtime.
Portable packages and a sample board are emitted under ignored dist/.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import base64
import io
import json
import math

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist' / 'profile-samples'
OUT.mkdir(parents=True, exist_ok=True)
COLLECTIONS = [
    ('astral-tide', 'Astral Tide', '#85b9ec', (42, 72, 133), (174, 131, 229), (135, 233, 237)),
    ('sakura-glass', 'Sakura Glass', '#e8aaa9', (128, 65, 100), (245, 162, 182), (255, 223, 163)),
    ('ember-forge', 'Ember Forge', '#e2a265', (126, 48, 47), (226, 118, 57), (255, 224, 149)),
]


def artwork(width, height, colors):
    dark, middle, light = colors
    palette = []
    for i in range(64):
        amount = i / 63
        a, b, mix = (dark, middle, amount * 2) if amount < .5 else (middle, light, (amount - .5) * 2)
        palette.extend(round(a[c] * (1 - mix) + b[c] * mix) for c in range(3))
    palette.extend([0] * (768 - len(palette)))
    phases = []
    for y in range(height):
        for x in range(width):
            phases.append(math.atan2((y - height / 2) / height, (x - width / 2) / width))
    frames = []
    for frame in range(24):
        time = 2 * math.pi * frame / 24
        pixels = bytes(round(18 + 22 * (.5 + .5 * math.sin(phase - time)) +
                             22 * max(0, math.cos(phase * 3 - time)) ** 12) for phase in phases)
        image = Image.frombytes('P', (width, height), pixels)
        image.putpalette(palette)
        frames.append(image)
    output = io.BytesIO()
    frames[0].save(output, format='GIF', save_all=True, append_images=frames[1:],
                   duration=160, loop=0, optimize=False, disposal=2)
    return output.getvalue(), frames


packages, board_frames = [], []
for slug, name, fallback, *colors in COLLECTIONS:
    rendered = {}
    for kind, size in [('avatar-frame', (64, 64)), ('profile-card', (96, 128))]:
        data, frames = artwork(*size, colors)
        package = dict(format='vumirotheme', schemaVersion=1, kind=kind, id=slug + '-' + kind,
                       name=name + (' / Avatar' if kind == 'avatar-frame' else ' / User card'),
                       version='1.0.0', author='Vumiro Studio', license='CC0-1.0',
                       description=f'Original {name} animated GIF frame. A static {fallback} perimeter replaces animation when reduced motion is enabled.',
                       compatibility=dict(engine=1), tokens={}, layouts={}, css='', motion='none',
                       components={kind: dict(backgroundColor=fallback, backgroundImage='asset(frame-art)',
                                              borderWidth='0px', borderStyle='none', borderColor=fallback)},
                       assets=[dict(id='frame-art', mime='image/gif', data=base64.b64encode(data).decode())],
                       previews=['frame-art'])
        packages.append(package)
        (OUT / (package['id'] + '.gif')).write_bytes(data)
        (OUT / (package['id'] + '.vumirotheme')).write_text(json.dumps(package, indent=2) + '\n', encoding='utf-8')
        rendered[kind] = frames
    board_frames.append(rendered)

source = ('/* Generated original CC0 GIF artwork. Reproduce with scripts/Generate-ProfileStyleSamples.py. */\n'
          '(() => {\n  "use strict";\n  const samples=' + json.dumps(packages, separators=(',', ':')) + ';\n'
          '  window.VumiroProfileStyleSamples=Object.freeze({packages:()=>JSON.parse(JSON.stringify(samples))});\n})();\n')
(ROOT / 'Vumiro.Client' / 'WebServer' / 'profile-style-samples.js').write_text(source, encoding='utf-8')

# Preview uses the same masked perimeter as the app; never replaces the portrait.
def font(size):
    try:
        return ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', size)
    except OSError:
        return ImageFont.load_default()


boards = []
for index in range(24):
    board = Image.new('RGB', (1060, 650), '#151314')
    draw = ImageDraw.Draw(board)
    draw.text((38, 25), 'Your profile. Your atmosphere.', font=font(32), fill='#f5eeeb')
    draw.text((40, 76), 'Original animated GIF collections  /  Avatar + user card frames', font=font(16), fill='#b8aba8')
    for col, collection in enumerate(COLLECTIONS):
        x, y, w, h = 40 + col * 340, 140, 300, 390
        art = board_frames[col]['profile-card'][index].convert('RGB').resize((w, h))
        mask = Image.new('L', (w, h))
        md = ImageDraw.Draw(mask)
        md.rounded_rectangle((0, 0, w - 1, h - 1), 22, fill=255)
        md.rounded_rectangle((4, 4, w - 5, h - 5), 18, fill=0)
        draw.rounded_rectangle((x, y, x+w, y+h), 22, fill='#211e20')
        board.paste(art, (x, y), mask)
        draw.rounded_rectangle((x+14, y+14, x+w-14, y+118), 14, fill=collection[2])
        avatar = board_frames[col]['avatar-frame'][index].convert('RGB').resize((98, 98))
        ring = Image.new('L', (98, 98)); rd = ImageDraw.Draw(ring)
        rd.ellipse((0, 0, 97, 97), fill=255); rd.ellipse((5, 5, 92, 92), fill=0)
        draw.ellipse((x+23, y+72, x+121, y+170), fill='#19171b')
        board.paste(avatar, (x+23, y+72), ring)
        draw.text((x+45, y+91), 'MS', font=font(32), fill='#f5eeeb')
        draw.text((x+24, y+191), 'Machine Spirit', font=font(26), fill='#f5eeeb')
        draw.text((x+24, y+234), '@machine_spirit', font=font(15), fill='#b9abaa')
        draw.text((x+24, y+279), 'A little more you.', font=font(17), fill='#e3d8d4')
        draw.rounded_rectangle((x+24, y+328, x+139, y+357), 10, fill='#413234')
        draw.text((x+37, y+332), 'GIF / looping', font=font(13), fill='#e8c6c2')
        draw.text((x+3, y+h+20), collection[1], font=font(22), fill='#eaddd7')
    draw.text((40, 611), 'Preview samples  /  Static fallback with reduced motion  /  Original CC0 artwork', font=font(14), fill='#b8aba8')
    boards.append(board)
boards[0].save(OUT / 'profile-collections.png')
boards[0].save(OUT / 'profile-collections.gif', save_all=True, append_images=boards[1:], duration=160, loop=0)
print(f'Generated {len(packages)} portable GIF packages and preview board in {OUT}')
