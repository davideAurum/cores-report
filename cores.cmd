@echo off
setlocal
rem cores -- launcher for cores.py (see README.md). From cmd or PowerShell in this folder:  .\cores <command>
rem After  .\cores setup --add-path  (and a new terminal) plain  cores <command>  works from any folder.
rem Interpreter, first found wins: python\python.exe (made by `cores bundle`, needs no installed Python),
rem .venv\Scripts\python.exe, the py launcher, python on PATH.
set "HERE=%~dp0"
if exist "%HERE%python\python.exe" goto bundled
if exist "%HERE%.venv\Scripts\python.exe" goto venv
where py >nul 2>&1
if not errorlevel 1 goto launcher
where python >nul 2>&1
if errorlevel 1 goto nopython
python "%HERE%cores.py" %*
exit /b %ERRORLEVEL%
:launcher
py -3 "%HERE%cores.py" %*
exit /b %ERRORLEVEL%
:venv
"%HERE%.venv\Scripts\python.exe" "%HERE%cores.py" %*
exit /b %ERRORLEVEL%
:bundled
"%HERE%python\python.exe" "%HERE%cores.py" %*
exit /b %ERRORLEVEL%
:nopython
echo cores: no Python found. Install Python 3.10+ from python.org, or copy a folder that contains python\ (made with "cores bundle").
exit /b 1
