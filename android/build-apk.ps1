# DanLume 手机版 · 打 APK（不依赖 Gradle）
# 需要：JDK 11+、Android build-tools、android.jar
param(
  [string]$Sdk = "D:\AIagent-lmq\_android\sdk",
  [string]$OutDir = ""
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$build = Join-Path $here "build"
$dist = if ($OutDir) { $OutDir } else { Join-Path $root "dist" }
$bt = Join-Path $Sdk "build-tools\android-14"
if (!(Test-Path $bt)) { throw "找不到 build-tools：$bt" }
$androidJar = Join-Path $Sdk "platforms\android-35\android.jar"
if (!(Test-Path $androidJar)) { throw "找不到 android.jar：$androidJar" }
$libs = Join-Path (Split-Path $Sdk -Parent) "libs"
if (!(Test-Path (Join-Path $libs "android-mail-1.6.7.jar"))) {
  $libs = Join-Path $here "libs"
}
$mailJars = @(
  (Join-Path $libs "android-mail-1.6.7.jar"),
  (Join-Path $libs "android-activation-1.6.7.jar")
)
foreach ($j in $mailJars) { if (!(Test-Path $j)) { throw "缺少 JavaMail：$j" } }
$javaCp = $androidJar + ";" + ($mailJars -join ";")
$aapt2 = Join-Path $bt "aapt2.exe"
$zipalign = Join-Path $bt "zipalign.exe"
$apksigner = Join-Path $bt "apksigner.bat"
$d8 = Join-Path $bt "d8.bat"
$newD8 = Join-Path $Sdk "build-tools37\android-37.0\d8.bat"
if (Test-Path $newD8) { $d8 = $newD8 }

Write-Host "==> 清理 build"
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Force -Path $build, "$build\gen", "$build\classes", "$build\dex", "$build\assets", $dist | Out-Null

Write-Host "==> 复制前端资源"
Copy-Item (Join-Path $root "public") "$build\assets\web" -Recurse
# 避免把开发用的 Service Worker 缓存版本搞混：保留原样即可
Get-ChildItem "$build\assets\web" -Recurse -File | Measure-Object | ForEach-Object { Write-Host "    $($_.Count) files" }

Write-Host "==> aapt2 compile"
& $aapt2 compile --dir (Join-Path $here "res") -o "$build\res.zip"
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile 失败" }

Write-Host "==> aapt2 link"
& $aapt2 link -o "$build\base.apk" -I $androidJar --manifest (Join-Path $here "AndroidManifest.xml") -R "$build\res.zip" --java "$build\gen" -A "$build\assets" --auto-add-overlay --min-sdk-version 24 --target-sdk-version 34 --version-code 10 --version-name "1.3.2"
if ($LASTEXITCODE -ne 0) { throw "aapt2 link 失败" }

Write-Host "==> javac"
$sources = @()
$sources += Get-ChildItem (Join-Path $here "java") -Recurse -Filter *.java | ForEach-Object { $_.FullName }
$sources += Get-ChildItem "$build\gen" -Recurse -Filter *.java | ForEach-Object { $_.FullName }
& javac -encoding UTF-8 --release 8 -Xlint:-options -classpath $javaCp -d "$build\classes" $sources
if ($LASTEXITCODE -ne 0) { throw "javac 失败" }

Write-Host "==> d8"
$classes = Get-ChildItem "$build\classes" -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& $d8 --lib $androidJar --min-api 24 --output "$build\dex" $classes $mailJars
if ($LASTEXITCODE -ne 0) { throw "d8 失败" }

Write-Host "==> 打包 resources + assets + classes.dex"
& node (Join-Path $here "pack.mjs") "$build\base.apk" "$build\dex\classes.dex" "$build\unsigned.apk"
if ($LASTEXITCODE -ne 0) { throw "pack 失败" }

Write-Host "==> zipalign"
& $zipalign -f 4 "$build\unsigned.apk" "$build\aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "zipalign 失败" }

$ks = Join-Path $here "danlume.keystore"
if (!(Test-Path $ks)) {
  Write-Host "==> 生成签名证书（首次）"
  & keytool -genkeypair -v -keystore $ks -storepass danlume -keypass danlume -alias danlume -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=DanLume, OU=Mobile, O=DanLume, L=Shanghai, ST=Shanghai, C=CN"
  if ($LASTEXITCODE -ne 0) { throw "keytool 失败" }
}

Write-Host "==> 签名"
$apk = Join-Path $dist "DanLume-1.3.2.apk"
if (Test-Path $apk) { Remove-Item $apk -Force }
& $apksigner sign --ks $ks --ks-pass pass:danlume --key-pass pass:danlume --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --out $apk "$build\aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "apksigner 失败" }

Write-Host "==> 校验"
& $apksigner verify --verbose --print-certs $apk
& $aapt2 dump badging $apk | Select-Object -First 6
Get-Item $apk | Select-Object FullName, Length
Write-Host "完成：$apk"
