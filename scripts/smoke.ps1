<#
.SYNOPSIS
  Smoke test for a running Ex Libris Video deployment (local or production).

.DESCRIPTION
  1. GET  /api/health                      -> must answer { ok: true, db: true }
  2. POST /api/collections                 -> creates an empty draft collection, prints its ids / links
  3. GET  /api/collections/<id>/status     -> the new collection is readable
  4. DELETE /api/collections/<id>          -> only with -Cleanup (uses the owner token)

  Untouched draft collections without sources are purged automatically after
  DRAFT_RETENTION_DAYS (default 7), so leaving the test collection is harmless.
  Creating collections is rate limited (RATE_COLLECTIONS_PER_IP_DAY, default 20 / IP / day).

  Exit code 0 = all checks passed, 1 = a check failed.
  Works in Windows PowerShell 5.1 and PowerShell 7.

.EXAMPLE
  .\scripts\smoke.ps1
.EXAMPLE
  .\scripts\smoke.ps1 -BaseUrl https://www.exlibrisvideo.hu -Cleanup
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://localhost:3000',
    [string]$Title = 'Smoke test',
    [ValidateSet('hu', 'en')]
    [string]$Locale = 'hu',
    [ValidateRange(1, 300)]
    [int]$TimeoutSec = 30,
    # delete the created collection at the end
    [switch]$Cleanup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try {
    # Windows PowerShell 5.1 defaults to old TLS versions
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}
catch { }

$BaseUrl = $BaseUrl.TrimEnd('/')
$script:Failures = 0

function Write-Pass([string]$Message) { Write-Host "  PASS  $Message" -ForegroundColor Green }
function Write-Fail([string]$Message) { Write-Host "  FAIL  $Message" -ForegroundColor Red; $script:Failures++ }

# Calls the API and returns { Status, Body (parsed JSON or $null), Raw }; never throws for HTTP errors.
function Invoke-Api {
    param(
        [Parameter(Mandatory)] [ValidateSet('GET', 'POST', 'DELETE')] [string]$Method,
        [Parameter(Mandatory)] [string]$Path,
        [object]$JsonBody,
        [hashtable]$Headers = @{}
    )
    $params = @{
        Uri             = "$BaseUrl$Path"
        Method          = $Method
        Headers         = $Headers
        TimeoutSec      = $TimeoutSec
        UseBasicParsing = $true
    }
    if ($null -ne $JsonBody) {
        $json = $JsonBody | ConvertTo-Json -Depth 5 -Compress
        $params.Body = [System.Text.Encoding]::UTF8.GetBytes($json)
        $params.ContentType = 'application/json; charset=utf-8'
    }
    $status = 0
    $raw = ''
    try {
        $response = Invoke-WebRequest @params
        $status = [int]$response.StatusCode
        $raw = [string]$response.Content
    }
    catch {
        $ex = $_.Exception
        $hasResponse = $ex.PSObject.Properties.Name -contains 'Response' -and $null -ne $ex.Response
        if (-not $hasResponse) {
            return [pscustomobject]@{ Status = 0; Body = $null; Raw = $ex.Message }
        }
        $status = [int]$ex.Response.StatusCode
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $raw = $_.ErrorDetails.Message
        }
        elseif ($ex.Response -is [System.Net.HttpWebResponse]) {
            try {
                $reader = New-Object System.IO.StreamReader($ex.Response.GetResponseStream())
                $raw = $reader.ReadToEnd()
                $reader.Dispose()
            }
            catch { $raw = '' }
        }
    }
    $body = $null
    if ($raw) {
        try { $body = $raw | ConvertFrom-Json } catch { $body = $null }
    }
    return [pscustomobject]@{ Status = $status; Body = $body; Raw = $raw }
}

function Get-Field($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) { return $null }
    return $prop.Value
}

Write-Host "Ex Libris Video smoke test -> $BaseUrl"
Write-Host ''

# 1. health ------------------------------------------------------------------
$health = Invoke-Api -Method GET -Path '/api/health'
if ($health.Status -eq 0) {
    Write-Fail "GET /api/health - no response: $($health.Raw)"
    Write-Host ''
    Write-Host 'Is the server running and the URL correct?' -ForegroundColor Yellow
    exit 1
}
$ok = Get-Field $health.Body 'ok'
$db = Get-Field $health.Body 'db'
$version = Get-Field $health.Body 'version'
if ($health.Status -eq 200 -and $ok -eq $true -and $db -eq $true) {
    Write-Pass "GET /api/health -> 200 ok=true db=true version=$version"
}
else {
    Write-Fail "GET /api/health -> $($health.Status) ok=$ok db=$db ($($health.Raw))"
}

# 2. create collection ----------------------------------------------------------
$created = Invoke-Api -Method POST -Path '/api/collections' -JsonBody @{ title = $Title; locale = $Locale }
$id = Get-Field $created.Body 'id'
$ownerToken = Get-Field $created.Body 'ownerToken'
if ($created.Status -eq 201 -and $id -and $ownerToken) {
    Write-Pass "POST /api/collections -> 201"
    Write-Host ''
    Write-Host "  collection id : $id"
    Write-Host "  public link   : $(Get-Field $created.Body 'publicUrl')"
    Write-Host "  owner link    : $(Get-Field $created.Body 'ownerUrl')"
    Write-Host '                  (the owner link grants edit rights - do not share it)'
    Write-Host ''
}
else {
    $code = Get-Field $created.Body 'code'
    Write-Fail "POST /api/collections -> $($created.Status) code=$code ($($created.Raw))"
    if ($code -eq 'rate_limited') {
        Write-Host '        daily limit per IP reached (RATE_COLLECTIONS_PER_IP_DAY)' -ForegroundColor Yellow
    }
}

# 3. read it back ---------------------------------------------------------------
if ($id) {
    $status = Invoke-Api -Method GET -Path "/api/collections/$id/status"
    $collectionStatus = Get-Field $status.Body 'status'
    if ($status.Status -eq 200 -and (Get-Field $status.Body 'id') -eq $id) {
        Write-Pass "GET /api/collections/$id/status -> 200 status=$collectionStatus"
    }
    else {
        Write-Fail "GET /api/collections/$id/status -> $($status.Status) ($($status.Raw))"
    }

    # 4. optional cleanup ---------------------------------------------------------
    if ($Cleanup -and $ownerToken) {
        $deleted = Invoke-Api -Method DELETE -Path "/api/collections/$id" -Headers @{ Authorization = "Bearer $ownerToken" }
        if ($deleted.Status -eq 204) {
            Write-Pass "DELETE /api/collections/$id -> 204 (test collection removed)"
        }
        else {
            Write-Fail "DELETE /api/collections/$id -> $($deleted.Status) ($($deleted.Raw))"
        }
    }
}

Write-Host ''
if ($script:Failures -gt 0) {
    Write-Host "$($script:Failures) check(s) FAILED" -ForegroundColor Red
    exit 1
}
Write-Host 'All checks passed' -ForegroundColor Green
exit 0
