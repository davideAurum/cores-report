<#
    bundle.ps1 -- put a private Python into python\ so this folder runs on a Windows PC with nothing installed.

    Run it through bundle.cmd (which sets the execution policy for this one script):

        .\bundle                       bundle the default Python, or the one already on this PC
        .\bundle -DryRun               only list what would be downloaded
        .\bundle -Version 3.13.7       a particular Python (needed if PyPI has no lxml wheel for the default yet)
        .\bundle -Arch arm64           the Windows build (default: this machine)

    The work is all in `cores.py bundle` -- the wheel picking, the checksums, the python*._pth patching and the
    "does it really carry its own stdlib" check live there and are used by `cores doctor` too. This script's only
    job is to find a Python that can run it. If the PC has none, it downloads python.org's embeddable build into
    %TEMP%, runs cores.py with that, and deletes it again. That is what makes bundling possible on the locked-down
    PC that actually needs a bundle, instead of only on a PC that already has Python.

    Needs internet once (python.org and pypi.org). Nothing is installed and nothing outside this folder changes.
#>
[CmdletBinding()]
param(
    [string]$Version = '',
    [ValidateSet('amd64', 'arm64')][string]$Arch = '',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 still negotiates TLS 1.0 by default; python.org and pypi.org refuse it.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

# The Python downloaded only when this PC has none. Any 3.10+ release works; it has to be one python.org still
# publishes an embeddable zip for, and one PyPI has an lxml wheel for (-Version overrides it if that stops being true).
$DefaultVersion = '3.14.7'

$Here = $PSScriptRoot
$Cores = Join-Path $Here 'cores.py'
if (-not (Test-Path -LiteralPath $Cores)) { throw "cores.py is not next to this script ($Here)." }

if (-not $Arch) { $Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' } }

# Arguments handed to `cores.py bundle`. --force because python\ is what we are here to (re)build: a half-written
# or stdlib-borrowing python\ is exactly the state you run this from.
$CoresArgs = @('bundle', '--force')
if ($Version) { $CoresArgs += @('--version', $Version) }
$CoresArgs += @('--arch', $Arch)
if ($DryRun) { $CoresArgs += '--dry-run' }

function Find-Python {
    # Returns @{ Exe = <path>; Args = @(...) }, or $null. python\ is deliberately not considered: it is the folder
    # being replaced, and if it is the broken kind it cannot be trusted to run anything anyway.
    $venv = Join-Path $Here '.venv\Scripts\python.exe'
    if (Test-Path -LiteralPath $venv) { return @{ Exe = $venv; Args = @() } }
    foreach ($c in @(@{ Name = 'py'; Args = @('-3') }, @{ Name = 'python'; Args = @() })) {
        $exe = Get-Command $c.Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $exe) { continue }
        # Probe rather than trust: `python` on PATH is often the Microsoft Store stub, which prints an advert and
        # runs nothing, and the py launcher can be present with no 3.x installed.
        $probe = & $exe.Source @($c.Args) '-c' 'import sys; print(sys.version_info[:2])' 2>&1
        if ($LASTEXITCODE -eq 0 -and "$probe" -match '\(3, (\d+)\)' -and [int]$Matches[1] -ge 10) {
            return @{ Exe = $exe.Source; Args = $c.Args }
        }
    }
    return $null
}

function Get-BootstrapPython {
    # python.org's embeddable zip is a complete Python in a folder: no installer, no registry, no admin rights.
    # It is unzipped unpatched into %TEMP% purely to run cores.py once; cores.py builds the real python\.
    param([string]$Ver)
    $url = "https://www.python.org/ftp/python/$Ver/python-$Ver-embed-$Arch.zip"
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("cores-bootstrap-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $zip = "$tmp.zip"
    Write-Host "No Python on this PC. Fetching one to bundle with:"
    Write-Host "  $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -UserAgent 'cores-cli'
    } catch {
        throw ("could not download Python $Ver ($Arch) from python.org: $($_.Exception.Message)`n" +
               "       Check the connection, or pick a release python.org still publishes with  .\bundle -Version X.Y.Z")
    }
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmp)
    } finally {
        Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    }
    $exe = Join-Path $tmp 'python.exe'
    if (-not (Test-Path -LiteralPath $exe)) {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
        throw "the zip from python.org did not contain python.exe; try another release with  .\bundle -Version X.Y.Z"
    }
    return @{ Exe = $exe; Dir = $tmp }
}

$temp = $null
$python = Find-Python
if ($python) {
    Write-Host "Using $($python.Exe) to build the bundle."
} else {
    $temp = Get-BootstrapPython ($(if ($Version) { $Version } else { $DefaultVersion }))
    $python = @{ Exe = $temp.Exe; Args = @() }
    # Without --version, cores.py bundles whatever Python is running it -- here, the one just downloaded.
}

try {
    & $python.Exe @($python.Args) $Cores @CoresArgs
    $code = $LASTEXITCODE
} finally {
    if ($temp) { Remove-Item -LiteralPath $temp.Dir -Recurse -Force -ErrorAction SilentlyContinue }
}

if ($code -eq 0 -and -not $DryRun) {
    Write-Host ''
    Write-Host 'Done. `.\cores doctor` now reports the bundled Python; `.\cores run` uses it in preference to any other.'
}
exit $code
