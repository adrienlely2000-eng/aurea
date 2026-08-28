@echo off
title Aurea
cd /d "%~dp0"
if not exist node_modules (
  echo Installation des outils, une seule fois...
  call npm install
)
echo Lancement d'Aurea...
echo Ne ferme pas cette fenetre tant que tu utilises Aurea.
echo.
node server.js
echo.
echo Aurea s'est arrete.
pause
