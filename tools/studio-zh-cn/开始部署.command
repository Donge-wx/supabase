#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
for tool in node npm python3 git docker; do
  command -v "$tool" >/dev/null || { printf '请先安装 %s\n' "$tool"; exit 1; }
done
npm install --ignore-scripts
npm test
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 scripts/manage.py install
