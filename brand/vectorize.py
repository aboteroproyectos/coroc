"""Vectoriza Logo_COROC.jpeg en capas (dorado, marfil, azul noche) con potrace.

Salida: SVG con coordenadas en el sistema del raster original (1600 x 1066),
recortadas luego por viewBox para cada variante.
"""
import json
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
import potrace

SRC = "Logo_COROC.jpeg"
im = Image.open(SRC).convert("RGB")
# Suavizado leve para eliminar artefactos JPEG antes de umbralizar
soft = np.array(im.filter(ImageFilter.GaussianBlur(0.8))).astype(int)
r, g, b = soft[..., 0], soft[..., 1], soft[..., 2]

gold = (r > 120) & (r - b > 40) & (r < 250)
navy = (r < 110) & (b >= r) & (b - r < 90)

# Isotipo: silueta = dorado con huecos rellenos (las líneas blancas quedan dentro)
iso_region = np.zeros_like(gold)
iso_region[150:545, 440:1165] = True
gold &= iso_region
gold_closed = ndimage.binary_closing(gold, structure=np.ones((3, 3)), iterations=2)
silhouette = ndimage.binary_fill_holes(gold_closed)
# Líneas marfil: dentro de la silueta y claramente claras
bright = (r > 225) & (g > 215) & (b > 180)
ivory = silhouette & bright
ivory = ndimage.binary_opening(ivory, structure=np.ones((2, 2)))

word_region = np.zeros_like(navy)
word_region[600:945, 200:1400] = True
navy &= word_region


def trace(mask, turd=6):
    bmp = potrace.Bitmap(~mask.astype(bool))  # potracer traza los píxeles en False
    path = bmp.trace(turdsize=turd, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY,
                     alphamax=1.0, opticurve=True, opttolerance=0.2)
    parts = []
    for curve in path:
        s = curve.start_point
        d = [f"M{s.x:.2f},{s.y:.2f}"]
        for seg in curve.segments:
            if seg.is_corner:
                d.append(f"L{seg.c.x:.2f},{seg.c.y:.2f}L{seg.end_point.x:.2f},{seg.end_point.y:.2f}")
            else:
                d.append(f"C{seg.c1.x:.2f},{seg.c1.y:.2f} {seg.c2.x:.2f},{seg.c2.y:.2f} {seg.end_point.x:.2f},{seg.end_point.y:.2f}")
        d.append("Z")
        parts.append("".join(d))
    return "".join(parts)


paths = {
    "silhouette": trace(silhouette, 20),
    "ivory": trace(ivory, 5),
    "navy": trace(navy, 6),
}
bbox = {}
for name, m in (("iso", silhouette), ("word", navy)):
    ys, xs = np.where(m)
    bbox[name] = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
json.dump({"paths": paths, "bbox": bbox}, open("paths.json", "w"))
print(bbox, {k: len(v) for k, v in paths.items()})
