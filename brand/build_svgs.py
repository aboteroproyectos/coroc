"""Genera las variantes SVG del logo COROC a partir de paths.json (§5.1)."""
import json
import os

data = json.load(open("paths.json"))
P = data["paths"]
ix0, iy0, ix1, iy1 = data["bbox"]["iso"]
wx0, wy0, wx1, wy1 = data["bbox"]["word"]
PAD = 24

NAVY = "#130E42"
IVORY = "#FFFDE7"
GOLD_SOLID = "#B8913F"

GRAD = f"""<linearGradient id="corocGold" gradientUnits="userSpaceOnUse" x1="{ix0}" y1="0" x2="{ix1}" y2="0">
  <stop offset="0" stop-color="#A57E33"/>
  <stop offset=".08" stop-color="#AC8C43"/>
  <stop offset=".22" stop-color="#CAA356"/>
  <stop offset=".38" stop-color="#E6C777"/>
  <stop offset=".45" stop-color="#E4C572"/>
  <stop offset=".56" stop-color="#CAA555"/>
  <stop offset=".67" stop-color="#E0BD6C"/>
  <stop offset=".80" stop-color="#CBA658"/>
  <stop offset="1" stop-color="#A57E33"/>
</linearGradient>"""


def iso_group(gold_fill="url(#corocGold)", line_fill=IVORY):
    return (f'<path fill="{gold_fill}" fill-rule="evenodd" d="{P["silhouette"]}"/>'
            f'<path fill="{line_fill}" fill-rule="evenodd" d="{P["ivory"]}"/>')


def word_group(fill=NAVY):
    return f'<path fill="{fill}" fill-rule="evenodd" d="{P["navy"]}"/>'


def svg(viewbox, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" role="img" aria-label="{title}">'
            f'<title>{title}</title><defs>{GRAD}</defs>{body}</svg>')


os.makedirs("svg", exist_ok=True)
vb_full = f"{min(ix0, wx0) - PAD} {iy0 - PAD} {max(ix1, wx1) - min(ix0, wx0) + 2 * PAD} {wy1 - iy0 + 2 * PAD}"
vb_iso = f"{ix0 - PAD} {iy0 - PAD} {ix1 - ix0 + 2 * PAD} {iy1 - iy0 + 2 * PAD}"
vb_word = f"{wx0 - PAD} {wy0 - PAD} {wx1 - wx0 + 2 * PAD} {wy1 - wy0 + 2 * PAD}"

out = {
    "coroc-logo-vertical.svg": svg(vb_full, iso_group() + word_group(), "COROC Personal Loans"),
    "coroc-logo-vertical-dark.svg": svg(vb_full, iso_group() + word_group(IVORY), "COROC Personal Loans"),
    "coroc-isotipo.svg": svg(vb_iso, iso_group(), "COROC"),
    "coroc-wordmark.svg": svg(vb_word, word_group(), "COROC Personal Loans"),
    "coroc-wordmark-ivory.svg": svg(vb_word, word_group(IVORY), "COROC Personal Loans"),
    "coroc-logo-mono-navy.svg": svg(vb_full, iso_group(NAVY, "#FFFFFF") + word_group(NAVY), "COROC Personal Loans"),
    "coroc-logo-mono-gold.svg": svg(vb_full, iso_group(GOLD_SOLID, "#FFFFFF") + word_group(GOLD_SOLID), "COROC Personal Loans"),
}

# Horizontal: isotipo a la izquierda, escalado a la altura del bloque tipográfico
wh = wy1 - wy0
s = wh / (iy1 - iy0)
iso_w = (ix1 - ix0) * s
gap = 90
tx_iso = f"translate({-ix0 * s:.2f},{-iy0 * s:.2f}) scale({s:.4f})"
tx_word = f"translate({iso_w + gap - wx0:.2f},{-wy0:.2f})"
total_w = iso_w + gap + (wx1 - wx0)
for name, wf in (("coroc-logo-horizontal.svg", NAVY), ("coroc-logo-horizontal-dark.svg", IVORY)):
    body = f'<g transform="{tx_iso}">{iso_group()}</g><g transform="{tx_word}">{word_group(wf)}</g>'
    out[name] = svg(f"{-PAD} {-PAD} {total_w + 2 * PAD:.0f} {wh + 2 * PAD}", body, "COROC Personal Loans")

# Ícono de app: isotipo centrado en cuadrado azul noche (zona segura 66 %)
side = 1024
iw, ih = ix1 - ix0, iy1 - iy0
sc = (side * 0.66) / iw
ox = (side - iw * sc) / 2 - ix0 * sc
oy = (side - ih * sc) / 2 - iy0 * sc
icon_body = (f'<rect width="{side}" height="{side}" fill="{NAVY}"/>'
             f'<g transform="translate({ox:.2f},{oy:.2f}) scale({sc:.4f})">{iso_group()}</g>')
out["coroc-app-icon.svg"] = svg(f"0 0 {side} {side}", icon_body, "COROC")
# Primer plano adaptativo Android (fondo transparente, isotipo al 60 % de 108 dp)
sc2 = (side * 0.60) / iw
ox2 = (side - iw * sc2) / 2 - ix0 * sc2
oy2 = (side - ih * sc2) / 2 - iy0 * sc2
out["coroc-android-foreground.svg"] = svg(
    f"0 0 {side} {side}", f'<g transform="translate({ox2:.2f},{oy2:.2f}) scale({sc2:.4f})">{iso_group()}</g>', "COROC")

for name, content in out.items():
    open(os.path.join("svg", name), "w").write(content)
    print(name, len(content) // 1024, "KB")
