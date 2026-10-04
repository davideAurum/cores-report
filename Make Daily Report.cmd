@echo off
rem Drop a captured "CORES report ... .html" onto this file, or double-click it to use the newest capture in Downloads (else the clipboard).
rem A capture from Downloads (or from next to the scripts) moves into reports\; one dropped from anywhere else is
rem copied and the original stays where it was. "<capture> - Daily Report.html" then opens in your browser.
call "%~dp0cores.cmd" generate %*
if errorlevel 1 (pause & exit /b 1)
echo.
echo This window closes in 8 seconds.
timeout /t 8 >nul 2>&1
exit /b 0
