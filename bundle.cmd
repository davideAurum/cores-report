@echo off
rem bundle -- put a private Python into python\ so this folder runs on a Windows PC with no Python installed.
rem Works whether or not this PC has Python: with none, bundle.ps1 downloads one into %TEMP% to do the work.
rem   .\bundle              .\bundle -DryRun              .\bundle -Version 3.13.7              .\bundle -Arch arm64
rem -ExecutionPolicy Bypass applies to this one run only; it changes nothing on the machine.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bundle.ps1" %*
exit /b %ERRORLEVEL%
