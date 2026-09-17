@echo off
rem Like "Make Daily Report.cmd", and then prints the Daily Report: the browser opens with the print dialog up,
rem or, when a printer is set in cores.config.json, the report goes straight to that printer.
call "%~dp0cores.cmd" run --print %*
if errorlevel 1 (pause & exit /b 1)
echo.
echo This window closes in 8 seconds.
timeout /t 8 >nul 2>&1
exit /b 0
