# Prueba la conexión REST API de WordPress
# Uso: .\scripts\test-connection.ps1

$envFile = Join-Path (Join-Path $PSScriptRoot "..") ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: No existe .env — copia .env.example a .env y completa tus credenciales." -ForegroundColor Red
    exit 1
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim().Trim('"')
        Set-Item -Path "env:$name" -Value $value
    }
}

$siteUrl = $env:WORDPRESS_SITE_URL.TrimEnd('/')
$user = $env:WORDPRESS_USERNAME
$pass = $env:WORDPRESS_APP_PASSWORD

if (-not $siteUrl -or -not $user -or -not $pass) {
    Write-Host "ERROR: WORDPRESS_SITE_URL, WORDPRESS_USERNAME y WORDPRESS_APP_PASSWORD son obligatorios en .env" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== Test 1: REST API pública ===" -ForegroundColor Cyan
try {
    $public = Invoke-RestMethod -Uri "$siteUrl/wp-json/wp/v2/" -Method Get -TimeoutSec 15
    Write-Host "OK — REST API accesible" -ForegroundColor Green
} catch {
    Write-Host "FALLO — $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Verifica la URL y que los permalinks estén guardados en WordPress." -ForegroundColor Yellow
}

Write-Host "`n=== Test 2: Autenticación (Application Password) ===" -ForegroundColor Cyan
$pair = "${user}:${pass}"
$bytes = [System.Text.Encoding]::ASCII.GetBytes($pair)
$base64 = [System.Convert]::ToBase64String($bytes)
$headers = @{ Authorization = "Basic $base64" }

try {
    $me = Invoke-RestMethod -Uri "$siteUrl/wp-json/wp/v2/users/me" -Headers $headers -Method Get -TimeoutSec 15
    Write-Host "OK — Autenticado como: $($me.name) (rol: $($me.roles -join ', '))" -ForegroundColor Green
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    Write-Host "FALLO — HTTP $status" -ForegroundColor Red
    if ($status -eq 401) {
        Write-Host @"

El hosting probablemente NO reenvía el header Authorization a PHP.
Soluciones (en orden):

1. Plugin 'Application Passwords' nativo de WP 5.6+ (sin JSON Basic Auth)
2. Añade el fix de .htaccess en scripts/htaccess-auth-fix.txt
3. Pide a FVDigital que habilite: fastcgi_param HTTP_AUTHORIZATION `$http_authorization;
4. Alternativa: plugin JWT Authentication for WP-API

"@ -ForegroundColor Yellow
    }
}

Write-Host "`n=== Test 3: Listar posts (requiere auth) ===" -ForegroundColor Cyan
try {
    $posts = Invoke-RestMethod -Uri "$siteUrl/wp-json/wp/v2/posts?per_page=3" -Headers $headers -Method Get -TimeoutSec 15
    Write-Host "OK — $($posts.Count) posts recientes:" -ForegroundColor Green
    $posts | ForEach-Object { Write-Host "  - [$($_.status)] $($_.title.rendered)" }
} catch {
    Write-Host "FALLO — $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
