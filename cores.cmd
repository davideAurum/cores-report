@echo off
setlocal
rem cores -- launcher for cores.py (see README.md). From cmd or PowerShell in this folder:  .\cores <command>
rem After  .\cores setup --add-path  (and a new terminal) plain  cores <command>  works from any folder.
rem Interpreter, first found wins: python\python.exe (made by `.\bundle`, needs no installed Python),
rem .venv\Scripts\python.exe, the py launcher, python on PATH.
set "HERE=%~dp0"
rem python*._pth is what makes an embeddable Python carry its own stdlib. Without it python.exe still starts, by
rem quietly borrowing an installed Python -- so a half-built python\ must not win over a real one. `cores doctor`
rem reports any python\ that fails this; `.\bundle` rebuilds it.
if not exist "%HERE%python\python*._pth" goto nobundle
if exist "%HERE%python\python.exe" goto bundled
:nobundle
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
rem -I (isolated) so the bundle behaves identically here and on the PC this folder gets copied to: without it a
rem bundle silently picks up %APPDATA%\Python\...\site-packages on a machine that has Python, which hides a package
rem missing from the bundle until it is somewhere that has none. `cores bundle` verifies with the same flag.
"%HERE%python\python.exe" -I "%HERE%cores.py" %*
exit /b %ERRORLEVEL%
:nopython
echo cores: no Python found. Either run  .\bundle  here (it downloads a private Python into python\ and needs
echo nothing installed), or install Python 3.10+ from python.org.
exit /b 1
