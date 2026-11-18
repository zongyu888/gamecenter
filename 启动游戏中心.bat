@echo off
cd /d "%~dp0"
echo Starting Game Center...
echo.
echo   Open in browser: http://localhost:8899
echo   Press Ctrl+C to stop
echo.
start "" http://localhost:8899/index.html
node server.js
