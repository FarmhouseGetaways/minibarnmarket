"""Turn the real Mini Barn Market logo (images/logo-fill.png) into the white neon sign that hangs in the barn's
gable (Cory, 9 Oct 2026: "it's the same as the logo"). Every red stroke of the logo becomes one neon tube along its
centre line, and the logo's outer silhouette becomes the tube that outlines the sign, as on the real one.
Writes images/mbm-neon.png (white on transparent; the glow is added in the page's SVG)."""
import cv2, numpy as np, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
im = cv2.imread(str(ROOT / "images" / "logo-fill.png"), cv2.IMREAD_UNCHANGED)
SCALE = 2
im = cv2.resize(im, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_CUBIC)
b, g, r, a = [im[..., i].astype(int) for i in range(4)]
red = ((a > 128) & (r > 120) & (g < 100) & (b < 100)).astype(np.uint8)
solid = (a > 128).astype(np.uint8)


def thin(img):
    """Zhang-Suen thinning, numpy only."""
    im = img.copy()
    while True:
        changed = False
        for step in (0, 1):
            P = np.pad(im, 1)
            p2, p3, p4, p5 = P[:-2, 1:-1], P[:-2, 2:], P[1:-1, 2:], P[2:, 2:]
            p6, p7, p8, p9 = P[2:, 1:-1], P[2:, :-2], P[1:-1, :-2], P[:-2, :-2]
            nb = [p2, p3, p4, p5, p6, p7, p8, p9]
            B = sum(n.astype(int) for n in nb)
            seq = nb + [p2]
            A = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(int) for i in range(8))
            c = ((p2 * p4 * p6 == 0) & (p4 * p6 * p8 == 0)) if step == 0 else ((p2 * p4 * p8 == 0) & (p2 * p6 * p8 == 0))
            rm = (im == 1) & (B >= 2) & (B <= 6) & (A == 1) & c
            if rm.any():
                im[rm] = 0
                changed = True
        if not changed:
            return im


red = cv2.morphologyEx(red, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
skel = thin(red)
# tubes thick enough to read as neon when the sign is drawn ~150px wide on the poster
k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19))
tubes = cv2.dilate(skel * 255, k)
# the outline tube around the whole sign, just inside the silhouette
inner = cv2.erode(solid * 255, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
ring = cv2.subtract(inner, cv2.erode(inner, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))))
# the small round dots either side of MARKET: keep them as glowing dots, not thinned away
n, lab, st, _ = cv2.connectedComponentsWithStats(red)
dots = np.zeros_like(red)
for i in range(1, n):
    x, y, w, h, area = st[i]
    if area < 900 and 0.6 < w / max(h, 1) < 1.6:
        dots[lab == i] = 255
dots = cv2.dilate(dots, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
tubes = cv2.max(tubes, dots)
neon = cv2.max(tubes, ring)
neon = cv2.GaussianBlur(neon, (0, 0), 0.8)
out = np.zeros((*neon.shape, 4), np.uint8)
out[..., :3] = 255
out[..., 3] = neon
out = cv2.resize(out, (1000, round(1000 * out.shape[0] / out.shape[1])), interpolation=cv2.INTER_AREA)
cv2.imwrite(str(ROOT / "images" / "mbm-neon.png"), out)
print("wrote", out.shape)
