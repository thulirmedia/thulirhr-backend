#!/usr/bin/env python3
"""Bundle landing/index.html into ONE self-contained HTML file (images, fonts and JS inlined).
Usage: python3 landing/build_single.py [output.html]"""
import base64, re, sys, pathlib
root = pathlib.Path(__file__).parent
s = (root / "index.html").read_text()
b64 = lambda p, m: f"data:{m};base64," + base64.b64encode((root / p).read_bytes()).decode()
for p, m in (("img/mangalyan-avenue.jpg", "image/jpeg"), ("img/maharani-town.jpg", "image/jpeg"), ("img/logo.png", "image/png")):
    s = s.replace(f'src="{p}"', f'src="{b64(p, m)}"')
for p in ("fonts/cinzel-latin-wght-normal.woff2", "fonts/josefin-sans-latin-wght-normal.woff2"):
    s = s.replace(f"url({p})", f"url({b64(p, 'font/woff2')})")
    s = re.sub(rf'<link rel="preload" href="{re.escape(p)}"[^>]*>\n?', "", s)
for p in ("vendor/lenis.min.js", "vendor/gsap.min.js", "vendor/ScrollTrigger.min.js"):
    js = (root / p).read_text().replace("</script", "<\\/script")
    s = s.replace(f'<script src="{p}"></script>', "<script>" + js + "</script>")
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else root / "dist" / "landing-single.html")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(s)
print(f"wrote {out} ({len(s)//1024} KB)")
