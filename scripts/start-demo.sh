#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
check_python() {
  "$1" -B -X utf8 -c 'import sys; assert sys.version_info >= (3, 11); import waitress, PIL' 2>/dev/null
}
python=python3
if [ -x studio/backend/.venv/bin/python ]; then
  python=studio/backend/.venv/bin/python
elif ! check_python python3 && check_python python; then
  python=python
fi
if ! check_python "$python"; then
  echo '缺少 Python 3.11+ 或后端依赖 / Python 3.11+ or backend dependencies missing.' >&2
  echo "$python -m pip install -r studio/backend/requirements.txt" >&2
  exit 1
fi
if [ ! -f studio/frontend/dist/index.html ]; then
  echo '缺少前端构建 / Frontend build missing.' >&2
  echo 'npm --prefix studio/frontend ci' >&2
  echo 'npm --prefix studio/frontend run build' >&2
  exit 1
fi
exec "$python" -B -X utf8 -m studio.backend.server --demo "$@"
