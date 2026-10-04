@echo off
setlocal
rem cores -- launcher for cores.py (see README.md). From cmd or PowerShell in this folder:  .\cores <command>
rem After  .\cores setup --add-path  (and a new terminal) plain  cores <command>  works from any folder.
set "HERE=%~dp0"
set "PY="

rem Interpreter, first found wins:
rem 1. python\python.exe, made by `.\bundle`; needs no installed Python. Only with its python*._pth: without that file
rem    python.exe still starts, by quietly borrowing an installed Python, so a half-built python\ must not win over a
rem    real one (`cores doctor` flags it, `.\bundle` rebuilds it). -I (isolated) so the bundle behaves here exactly as
rem    on the PC this folder gets copied to: without it, it picks up %APPDATA%\Python\...\site-packages on a machine
rem    that has Python, hiding a package missing from the bundle. `cores bundle` verifies with the same flag.
if exist "%HERE%python\python*._pth" if exist "%HERE%python\python.exe" set PY="%HERE%python\python.exe" -I
rem 2. a venv in this folder
if not defined PY if exist "%HERE%.venv\Scripts\python.exe" set PY="%HERE%.venv\Scripts\python.exe"
rem 3. the py launcher, 4. python on PATH
if not defined PY where py >nul 2>&1 && set PY=py -3
if not defined PY where python >nul 2>&1 && set PY=python

if not defined PY (
    echo cores: no Python found. Either run  .\bundle  here ^(it downloads a private Python into python\ and needs
    echo nothing installed^), or install Python 3.10+ from python.org.
    exit /b 1
)
%PY% "%HERE%cores.py" %*
exit /b %ERRORLEVEL%
