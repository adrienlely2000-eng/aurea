@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installation des outils, une seule fois...
  call npm install
)
echo.
echo Ouvre ensuite : http://127.0.0.1:3847
echo.
node server.js
pause
