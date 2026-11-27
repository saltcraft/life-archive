@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0.." || exit /b 1
set "LA_LAUNCH_PYTHON=python"
if exist "studio\backend\.venv\Scripts\python.exe" set "LA_LAUNCH_PYTHON=studio\backend\.venv\Scripts\python.exe"
"%LA_LAUNCH_PYTHON%" -B -X utf8 -c "import sys; assert sys.version_info >= (3, 11); import waitress, PIL" >nul 2>nul
if errorlevel 1 (
  echo 缺少 Python 3.11+ 或后端依赖 / Python 3.11+ or backend dependencies missing.
  echo %LA_LAUNCH_PYTHON% -m pip install -r studio/backend/requirements.txt
  popd
  exit /b 1
)
if not exist "studio\frontend\dist\index.html" (
  echo 缺少前端构建 / Frontend build missing.
  echo npm --prefix studio/frontend ci
  echo npm --prefix studio/frontend run build
  popd
  exit /b 1
)
"%LA_LAUNCH_PYTHON%" -B -X utf8 -m studio.backend.server --scope personal %*
set "LA_LAUNCH_STATUS=%errorlevel%"
popd
exit /b %LA_LAUNCH_STATUS%
