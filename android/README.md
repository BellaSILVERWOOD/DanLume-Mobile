# Android 打包说明

DanLume 手机版 1.3.2 的 Android 外壳：WebView + 应用内本地服务 + 复旦身份认证 + 手机邮箱。
不依赖 Gradle。

## 结构

    java/com/danlume/mobile/
      MainActivity.java      WebView、文件选择、下载、外链、状态栏
      LocalServer.java       127.0.0.1:18787 静态资源 + /api/fudan + /api/mail + /api/ai + /api/health
      FudanAuth.java         新版 ID（id.fudan.edu.cn）认证 + 带 Cookie 的校内代理
      PrefsStore.java        Android Keystore AES-GCM 加密保存学号/密码
      MailService.java       JavaMail IMAP 收件 + SMTP 发件 + MIME 解析
      MailPrefsStore.java    邮箱账户整段 JSON 加密保存
      SecureBox.java         Android Keystore AES-GCM 通用封装

## 复旦登录

前端登录页（public/js/login.js）调用应用内接口：

    POST /api/fudan/login   {username,password,remember}
    GET  /api/fudan/status
    POST /api/fudan/autologin
    POST /api/fudan/proxy   {url,method,body}

FudanAuth 访问 fdjwgl 课表页 → 跟随跳转到 id.fudan.edu.cn/ac →
queryAuthMethods / getJsPublicKey（RSA PKCS#1 加密密码）/ authExecute →
authCenter/authnEngine 换 ticket → 回到课表页并保存 Cookie。
登录成功后会尝试读取 eHall 用户信息，并把 Cookie 同步给 WebView。

## 手机邮箱

前端 public/js/views/mail.js 在 APK 里把 base 指向 location.origin：

    GET  /api/mail/accounts
    POST /api/mail/accounts           保存（有 body）
    POST /api/mail/accounts/delete
    POST /api/mail/test
    GET  /api/mail/inbox?accountId=&limit=&query=
    GET  /api/mail/message?accountId=&uid=&folder=
    GET  /api/mail/attachment?accountId=&uid=&index=
    POST /api/mail/flags
    POST /api/mail/send

MailService 使用 JavaMail for Android（android-mail 1.6.7 + android-activation 1.6.7）：

- IMAP：imap / imaps，GET 收件、按 UID 取正文、附件、标记已读/星标。
- SMTP：smtp + STARTTLS / smtps，HTML + 纯文本 + 附件。
- 连接后发送 IMAP ID，兼容 QQ / 163 / 126 的“Unsafe Login”限制。
- APK 的 classes.dex 没有 META-INF/mailcap，MailService 在静态初始化时显式注册
  text/plain、text/html、multipart/* 等内容处理器，否则发信会报
  “no object DCH for MIME type multipart/mixed”。
- 账号 JSON 由 MailPrefsStore 用 SecureBox（Keystore AES-GCM）加密后落盘。

## 为什么不用 file://

前端用了 ES Modules、IndexedDB、Service Worker，file:// 下会被同源策略拦住。
所以 MainActivity 在 127.0.0.1:18787 起本地 HTTP 服务，WebView 像普通网站一样访问。
端口固定，保证 IndexedDB 的 origin 稳定（换端口会让用户数据“消失”）。

public/sw.js 会跳过 /api/ 请求，避免把登录状态/邮件缓存住。

## 构建环境

- JDK 11+（当前用 JDK 25 验证）
- android-35 的 android.jar
- android-mail / android-activation 1.6.7（放在 _android/libs/ 下）
- Android build-tools：
  - aapt2 / zipalign / apksigner（当前用 build-tools 34）
  - d8 建议用 build-tools 37（旧版 d8 在 JDK 25 上会崩）
- Node.js（合并 classes.dex，依赖 yazl / yauzl）

    _android/
      sdk/
        platforms/android-35/android.jar
        build-tools/android-14/          (34)
        build-tools37/android-37.0/      (d8)
      libs/
        android-mail-1.6.7.jar
        android-activation-1.6.7.jar

## 打包

    cd DanLumeMobile
    npm install
    powershell -ExecutionPolicy Bypass -File android\build-apk.ps1

javac 与 d8 都会自动把 _android/libs 下的两个 JavaMail jar 加入 classpath / dex；
产物：dist/DanLume-1.3.2.apk

## 发版

- 改 AndroidManifest.xml 的 versionCode / versionName 和 build-apk.ps1 里的两个参数。
- 改 public/sw.js 的 VERSION（否则已安装的手机会继续用旧缓存）。
- 必须保留 android/danlume.keystore 并用同一个 key 签名，否则要先卸载旧版。

## 说明

- 复旦登录、课表、通知、eHall、邮箱都在 APK 内完成，不需要电脑。
- 只有 XeLaTeX 编译还需要可选的电脑服务。
- QQ / 163 / 126 用授权码；Gmail 用应用专用密码；Outlook 基础认证多已关闭。
- 应用内 PDF 预览取决于系统 WebView；打不开时用系统浏览器。
- 图片/附件下载走系统下载管理器，保存到「下载」目录。
