@echo off
REM start-server.bat - Windows HTTP Server Launcher

cd /d "%~dp0"

echo ==========================================
echo   Movie Ratings Dashboard
echo   Starting HTTP Server...
echo ==========================================
echo.
echo Your dashboard will be available at:
echo   http://localhost:8000/index_v2.html
echo.
echo Press Ctrl+C to stop the server
echo ==========================================
echo.

python -m http.server 8000

if errorlevel 1 (
    echo.
    echo Error: Python not found or failed to start server
    echo.
    echo Solutions:
    echo   1. Install Python from python.org
    echo   2. Or use another method:
    echo      - Open index_v2.html directly in your browser
    echo      - Use "Choose a CSV file" button to load data (no server needed)
    echo.
    pause
)
