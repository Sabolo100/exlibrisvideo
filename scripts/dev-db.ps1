<#
.SYNOPSIS
  Local PostgreSQL 16 for Ex Libris Video development (Docker container "exlibris-pg").

.DESCRIPTION
  start   create the container on first use (volume "exlibris-pgdata"), or start it; waits until ready
  stop    stop the container (data stays in the volume)
  status  container state, readiness, applied migrations and the DATABASE_URL to use
  logs    last 200 log lines (-Follow to keep streaming)
  psql    interactive psql shell inside the container

  Works in Windows PowerShell 5.1 and PowerShell 7. Requires Docker Desktop.

.EXAMPLE
  .\scripts\dev-db.ps1 start
  npm run db:migrate

.EXAMPLE
  .\scripts\dev-db.ps1 status
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'status', 'logs', 'psql')]
    [string]$Action = 'status',

    # host port used only when the container is created for the first time
    [ValidateRange(1, 65535)]
    [int]$Port = 5432,

    # logs: keep streaming
    [switch]$Follow
)

Set-StrictMode -Version Latest
# 'Continue' on purpose: in Windows PowerShell 5.1 'Stop' turns any stderr line of a native
# command into a terminating error. Exit codes are checked explicitly instead.
$ErrorActionPreference = 'Continue'

$Container = 'exlibris-pg'
$Volume = 'exlibris-pgdata'
$Image = 'postgres:16-alpine'
$DbName = 'exlibris'
$DbUser = 'postgres'
$DbPassword = 'postgres'   # local development only

function Write-Info([string]$Message) { Write-Host "[dev-db] $Message" }
function Write-Ok([string]$Message) { Write-Host "[dev-db] $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "[dev-db] $Message" -ForegroundColor Yellow }
function Stop-WithError([string]$Message) {
    Write-Host "[dev-db] ERROR: $Message" -ForegroundColor Red
    exit 1
}

# Runs docker with the given arguments; returns exit code and combined output as text.
function Invoke-Docker([string[]]$Arguments) {
    $output = & docker @Arguments 2>&1 | ForEach-Object { "$_" }
    [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output   = (@($output) -join [Environment]::NewLine).Trim()
    }
}

function Assert-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Stop-WithError 'docker was not found on PATH. Install Docker Desktop: https://www.docker.com/products/docker-desktop/'
    }
    $info = Invoke-Docker @('info', '--format', '{{.ServerVersion}}')
    if ($info.ExitCode -ne 0) {
        Stop-WithError "Docker is not running (start Docker Desktop and try again). $($info.Output)"
    }
}

# 'running', 'exited', 'created', 'paused', ... or $null when the container does not exist
function Get-ContainerState {
    $r = Invoke-Docker @('container', 'inspect', '--format', '{{.State.Status}}', $Container)
    if ($r.ExitCode -ne 0) { return $null }
    return $r.Output
}

function Get-HostPort {
    $r = Invoke-Docker @('port', $Container, '5432/tcp')
    if ($r.ExitCode -ne 0 -or -not $r.Output) { return $null }
    $first = ($r.Output -split "`r?`n")[0]
    return ($first -split ':')[-1]
}

function Test-Ready {
    $r = Invoke-Docker @('exec', $Container, 'pg_isready', '-U', $DbUser, '-d', $DbName)
    return ($r.ExitCode -eq 0)
}

function Wait-Ready([int]$TimeoutSec = 60) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-Ready) { return $true }
        Start-Sleep -Milliseconds 700
    }
    return $false
}

function Get-DatabaseUrl {
    $hostPort = Get-HostPort
    if (-not $hostPort) { $hostPort = $Port }
    return "postgres://${DbUser}:${DbPassword}@localhost:${hostPort}/${DbName}"
}

function Invoke-Start {
    Assert-Docker
    $state = Get-ContainerState
    if ($null -eq $state) {
        Write-Info "creating container $Container ($Image, volume $Volume, localhost:$Port)"
        $r = Invoke-Docker @(
            'run', '-d',
            '--name', $Container,
            '--restart', 'unless-stopped',
            '-e', "POSTGRES_USER=$DbUser",
            '-e', "POSTGRES_PASSWORD=$DbPassword",
            '-e', "POSTGRES_DB=$DbName",
            '-p', "${Port}:5432",
            '-v', "${Volume}:/var/lib/postgresql/data",
            $Image
        )
        if ($r.ExitCode -ne 0) {
            if ($r.Output -match 'port is already allocated|address already in use|Only one usage of each socket') {
                Stop-WithError "port $Port is already in use (docker compose postgres? another Postgres?). Stop it or use -Port 5433 (then update DATABASE_URL). $($r.Output)"
            }
            Stop-WithError "docker run failed: $($r.Output)"
        }
    }
    elseif ($state -eq 'running') {
        Write-Info "$Container is already running"
    }
    elseif ($state -eq 'paused') {
        $r = Invoke-Docker @('unpause', $Container)
        if ($r.ExitCode -ne 0) { Stop-WithError "docker unpause failed: $($r.Output)" }
    }
    else {
        Write-Info "starting $Container (was: $state)"
        $r = Invoke-Docker @('start', $Container)
        if ($r.ExitCode -ne 0) { Stop-WithError "docker start failed: $($r.Output)" }
    }

    Write-Info 'waiting for PostgreSQL to accept connections...'
    if (-not (Wait-Ready 60)) {
        Stop-WithError "PostgreSQL did not become ready within 60 s. See: .\scripts\dev-db.ps1 logs"
    }
    Write-Ok 'PostgreSQL is ready'
    Write-Host ''
    Write-Host "  DATABASE_URL=$(Get-DatabaseUrl)"
    Write-Host ''
    Write-Host '  next steps:  npm run db:migrate    then    npm run dev   (and npm run worker:dev in a second terminal)'
}

function Invoke-Stop {
    Assert-Docker
    $state = Get-ContainerState
    if ($null -eq $state) { Write-Warn "$Container does not exist - nothing to stop"; return }
    if ($state -ne 'running' -and $state -ne 'paused') { Write-Info "$Container is not running ($state)"; return }
    $r = Invoke-Docker @('stop', $Container)
    if ($r.ExitCode -ne 0) { Stop-WithError "docker stop failed: $($r.Output)" }
    Write-Ok "$Container stopped (data kept in volume $Volume)"
}

function Invoke-Status {
    Assert-Docker
    $state = Get-ContainerState
    if ($null -eq $state) {
        Write-Warn "$Container does not exist. Create it with: .\scripts\dev-db.ps1 start"
        exit 3
    }
    Write-Host "  container   : $Container ($state)"
    $volumeCheck = Invoke-Docker @('volume', 'inspect', '--format', '{{.Name}}', $Volume)
    Write-Host ("  volume      : {0}" -f $(if ($volumeCheck.ExitCode -eq 0) { $Volume } else { "$Volume (missing!)" }))
    if ($state -ne 'running') {
        Write-Warn "not running. Start it with: .\scripts\dev-db.ps1 start"
        exit 2
    }
    $ready = Test-Ready
    Write-Host ("  ready       : {0}" -f $(if ($ready) { 'yes' } else { 'no (still starting?)' }))
    Write-Host "  DATABASE_URL: $(Get-DatabaseUrl)"
    if ($ready) {
        $m = Invoke-Docker @('exec', $Container, 'psql', '-U', $DbUser, '-d', $DbName, '-At', '-c',
            "select count(*) from drizzle.__drizzle_migrations")
        if ($m.ExitCode -eq 0) {
            Write-Host "  migrations  : $($m.Output) applied"
        }
        else {
            Write-Host '  migrations  : none yet - run: npm run db:migrate'
        }
    }
}

function Invoke-Logs {
    Assert-Docker
    if ($null -eq (Get-ContainerState)) { Stop-WithError "$Container does not exist" }
    if ($Follow) { & docker logs --tail 200 -f $Container }
    else { & docker logs --tail 200 $Container }
}

function Invoke-Psql {
    Assert-Docker
    if ((Get-ContainerState) -ne 'running') { Stop-WithError "$Container is not running. Start it with: .\scripts\dev-db.ps1 start" }
    & docker exec -it $Container psql -U $DbUser -d $DbName
}

switch ($Action) {
    'start' { Invoke-Start }
    'stop' { Invoke-Stop }
    'status' { Invoke-Status }
    'logs' { Invoke-Logs }
    'psql' { Invoke-Psql }
}
