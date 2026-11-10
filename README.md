# DanLume（旦光）· Android

DanLume 手机端：**原生 Android（Java）+ WebView + 内置本地服务**，不是 Flutter。

## 结构

```
android/            Android 工程（AndroidManifest.xml + java/com/danlume/mobile/*.java）
  ├ FudanAuth.java       统一身份认证（校内登录）
  ├ LocalServer.java     在手机本地起一个 HTTP 服务，给 WebView 提供接口
  ├ MailService.java     IMAP 收信（配合 android-mail / activation）
  ├ MainActivity.java    WebView 外壳
  ├ SecureBox.java       口令加密保存
  └ build-apk.ps1        用命令行打 APK（Windows）
public/             前端资源（HTML/JS/CSS、KaTeX、字体）
server/ server.mjs  本地服务的 Node 部分
docs/screenshots/   界面截图
tools/              小脚本
```

## 构建

需要 JDK + Android SDK（platform-tools / build-tools）：

```powershell
cd android
powershell -ExecutionPolicy Bypass -File build-apk.ps1
# 产物：dist/DanLume-<版本>.apk
```

> 仓库里**不含签名 keystore**（不能公开）。自己打包时用 `keytool` 生成一个，
> 把路径/别名/口令填进 `build-apk.ps1` 即可。

## 下载

- 安装包：Release 里的 `DanLume-1.3.2.apk`
- 国内直连（不用梯子）：<https://43.108.99.38.sslip.io/download/>

## 著作权与来源

- 手机端基于 **lmq（GitHub: @BellaSILVERWOOD）** 的 DanLume Python 桌面版移植；
- 手机端开发：**lcy（LinkCutY@qq.com）**；
- 桌面端（Python 版 / Rust 版）著作权归 **lmq（@BellaSILVERWOOD）** 所有。

## License

**GNU General Public License v3.0（GPL-3.0）**，全文见 `LICENSE`。
分发衍生作品必须同样以 GPL-3.0 开源，并保留上面的著作权署名与变更说明。

Copyright (C) 2026 lmq (@BellaSILVERWOOD) · 手机端开发 lcy <LinkCutY@qq.com>
