# Installs the SplitCortex command line node on Windows (x64):
#   irm https://raw.githubusercontent.com/alinflorin/splitcortex/main/src/cli-node/install.ps1 | iex
# Downloads the newest cli-node-vX.Y.Z release from GitHub, checks its SHA-256 and unpacks it into
# %LOCALAPPDATA%\Programs\SplitCortexNode (the program and the engine library next to it), then adds that folder to your PATH.
# Environment: $env:SPLITCORTEX_VERSION = "X.Y.Z" installs that version; $env:SPLITCORTEX_INSTALL_DIR changes the folder;
# $env:SPLITCORTEX_URL sets the web app address without asking (otherwise it asks, Enter keeps the default).
# Remove it again: delete the folder and take it out of your user PATH.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = 'alinflorin/splitcortex'
$InstallDir = if ($env:SPLITCORTEX_INSTALL_DIR) { $env:SPLITCORTEX_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\SplitCortexNode' }

if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw "Unsupported platform: $env:PROCESSOR_ARCHITECTURE (only x64 is built)" }
$Target = 'x86_64-pc-windows-msvc'

if ($env:SPLITCORTEX_VERSION) {
  $Version = $env:SPLITCORTEX_VERSION.TrimStart('v')
} else {
  # The command line node has its own release stream (cli-node-v*); the repository's "latest" release is the server's.
  $releases = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases?per_page=50"
  $versions = $releases | Where-Object { -not $_.draft -and -not $_.prerelease -and $_.tag_name -match '^cli-node-v(\d+\.\d+\.\d+)$' } |
    ForEach-Object { [version]$Matches[1] } | Sort-Object -Descending
  if (-not $versions) { throw "No cli-node release found at github.com/$Repo/releases" }
  $Version = $versions[0].ToString()
}

$Name = "splitcortex-node-$Target.zip"
$Url = "https://github.com/$Repo/releases/download/cli-node-v$Version/$Name"
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("splitcortex-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  Write-Host "Installing SplitCortex node $Version for $Target"
  Invoke-WebRequest -Uri $Url -OutFile (Join-Path $Tmp $Name)
  Invoke-WebRequest -Uri "$Url.sha256" -OutFile (Join-Path $Tmp "$Name.sha256")
  $expected = ((Get-Content (Join-Path $Tmp "$Name.sha256") -Raw).Trim() -split '\s+')[0].ToLower()
  $actual = (Get-FileHash (Join-Path $Tmp $Name) -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) { throw 'The download does not match its checksum' }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  # A running node keeps its executable locked: move it aside instead of overwriting it.
  $exe = Join-Path $InstallDir 'splitcortex-node.exe'
  if (Test-Path $exe) { Move-Item -Force $exe "$exe.old" }
  Expand-Archive -Path (Join-Path $Tmp $Name) -DestinationPath $InstallDir -Force
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $InstallDir) {
  [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $InstallDir), 'User')
  Write-Host "Added $InstallDir to your PATH (open a new terminal to use it by name)."
}

# The web app address `join` enrolls against; Enter keeps the default, SPLITCORTEX_URL skips the question.
$DefaultUrl = 'https://app.prd.splitcortex.com'
$AppUrl = $env:SPLITCORTEX_URL
if (-not $AppUrl) {
  $AppUrl = $DefaultUrl
  if ([Environment]::UserInteractive) {
    try {
      $answer = Read-Host "Web app address [$DefaultUrl]"
      if ($answer) { $AppUrl = $answer.Trim() }
    } catch { }
  }
}
# Saved, so a plain `splitcortex-node join` enrolls against it (no --url needed).
& $exe config --url $AppUrl | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'cannot save the web app address' }

Write-Host ''
Write-Host "Installed: $exe ($Version)"
Write-Host ''
Write-Host 'Next:'
Write-Host '  splitcortex-node join'
Write-Host '                                     (enroll with the code from "Add device" in the web app)'
Write-Host '  splitcortex-node run               start serving (Ctrl+C stops)'
Write-Host '  splitcortex-node service install   or keep it running in the background and at logon'
