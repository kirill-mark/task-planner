#!/bin/zsh
# Рендер экранов в PNG для проверки: shot.sh <out_dir> <file.dc.html>...
OUT=$1; shift
mkdir -p $OUT
D=${0:a:h}
for f in "$@"; do
  n=${f:t:r:r}
  python3 - "$D/project/$f" "$OUT/$n.html" <<'PY'
import re,sys,json
s=open(sys.argv[1]).read()
body=re.search(r"<x-dc>(.*)</x-dc>",s,re.S).group(1)
helm=re.search(r"<helmet>(.*?)</helmet>",body,re.S).group(1)
links="".join(re.findall(r"<link[^>]+>",helm))
style=re.search(r"<style>(.*?)</style>",helm,re.S).group(1)
body=re.sub(r"<helmet>.*?</helmet>","",body,flags=re.S)
open(sys.argv[2],"w").write(f'<!doctype html><html lang="ru"><head><meta charset="utf-8">{links}<style>{style} html,body{{margin:0}}</style></head><body>{body}</body></html>')
PY
  W=$(python3 -c "import json,sys;b=json.load(open('$D/project/canvas.json'))['boards']['$f'];print(b['w'],b['h'])")
  set -- $W
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=${W% *},${W#* } --virtual-time-budget=3000 --screenshot="$OUT/$n.png" "file://$OUT/$n.html" >/dev/null 2>&1
done
