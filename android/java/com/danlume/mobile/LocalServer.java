package com.danlume.mobile;

import android.content.res.AssetManager;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.URL;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 极简本地 HTTP 服务：把 APK 里的 assets/web 当站点提供给 WebView。
 * 用 127.0.0.1 是为了让 ES Modules / Service Worker / IndexedDB 都按正常网页的规则工作。
 */
public class LocalServer {
    /** 资源读取抽象：Android 用 AssetManager，桌面测试用文件系统。 */
    public interface AssetSource {
        byte[] read(String path);
    }

    private final AssetSource assets;
    private final int preferredPort;
    private final FudanAuth fudan;
    private final MailService mail;
    private ServerSocket serverSocket;
    private int port = 0;
    private volatile boolean running = false;
    private Thread acceptThread;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html; charset=utf-8");
        MIME.put("js", "text/javascript; charset=utf-8");
        MIME.put("mjs", "text/javascript; charset=utf-8");
        MIME.put("css", "text/css; charset=utf-8");
        MIME.put("json", "application/json; charset=utf-8");
        MIME.put("webmanifest", "application/manifest+json; charset=utf-8");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("gif", "image/gif");
        MIME.put("svg", "image/svg+xml");
        MIME.put("ico", "image/x-icon");
        MIME.put("webp", "image/webp");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("ttf", "font/ttf");
        MIME.put("otf", "font/otf");
        MIME.put("pdf", "application/pdf");
        MIME.put("txt", "text/plain; charset=utf-8");
        MIME.put("md", "text/markdown; charset=utf-8");
        MIME.put("zip", "application/zip");
    }

    public LocalServer(AssetSource assets, int preferredPort) {
        this(assets, preferredPort, null);
    }

    public LocalServer(AssetSource assets, int preferredPort, FudanAuth fudan) {
        this(assets, preferredPort, fudan, null);
    }

    public LocalServer(AssetSource assets, int preferredPort, FudanAuth fudan, MailService mail) {
        this.assets = assets;
        this.preferredPort = preferredPort;
        this.fudan = fudan;
        this.mail = mail;
    }

    public static LocalServer fromAssets(final AssetManager manager, int preferredPort) {
        return new LocalServer(new AssetSource() {
            @Override
            public byte[] read(String path) {
                return readAssetFrom(manager, path);
            }
        }, preferredPort);
    }

    public int getPort() {
        return port;
    }

    public void start() throws IOException {
        // 固定端口：IndexedDB / localStorage 是按 origin（含端口）隔离的，
        // 每次启动换端口会导致用户数据「消失」。
        int[] ports = new int[]{ preferredPort, preferredPort + 1, preferredPort + 2 };
        IOException last = null;
        for (int p : ports) {
            try {
                serverSocket = new ServerSocket(p, 20, InetAddress.getByName("127.0.0.1"));
                break;
            } catch (IOException e) {
                last = e;
                try { Thread.sleep(150); } catch (InterruptedException ignored) {}
            }
        }
        if (serverSocket == null) throw last != null ? last : new IOException("cannot bind");
        port = serverSocket.getLocalPort();
        running = true;
        acceptThread = new Thread(new Runnable() {
            @Override
            public void run() {
                while (running) {
                    try {
                        final Socket socket = serverSocket.accept();
                        pool.execute(new Runnable() {
                            @Override
                            public void run() {
                                handle(socket);
                            }
                        });
                    } catch (IOException ignored) {
                        if (running) {
                            // 继续接受下一个连接
                        }
                    }
                }
            }
        }, "danlume-http");
        acceptThread.setDaemon(true);
        acceptThread.start();
    }

    public void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
        pool.shutdownNow();
    }

    private void handle(Socket socket) {
        try {
            socket.setSoTimeout(15000);
            InputStream input = socket.getInputStream();
            OutputStream output = socket.getOutputStream();
            String header = readHeader(input);
            if (header == null || header.isEmpty()) {
                return;
            }
            int lineEnd = header.indexOf("\r\n");
            if (lineEnd < 0) lineEnd = header.indexOf("\n");
            String requestLine = lineEnd >= 0 ? header.substring(0, lineEnd) : header;
            String[] parts = requestLine.split(" ");
            String method = parts.length > 0 ? parts[0] : "GET";
            String rawPath = parts.length > 1 ? parts[1] : "/";
            boolean headOnly = "HEAD".equalsIgnoreCase(method);
            if (!"GET".equalsIgnoreCase(method) && !"POST".equalsIgnoreCase(method) && !headOnly) {
                writeResponse(output, 405, "text/plain; charset=utf-8",
                        "Method Not Allowed".getBytes(StandardCharsets.UTF_8), false);
                return;
            }
            byte[] requestBody = new byte[0];
            if ("POST".equalsIgnoreCase(method)) {
                int length = 0;
                Matcher lengthMatcher = Pattern.compile("(?im)^content-length\\s*:\\s*(\\d+)\\s*$").matcher(header);
                if (lengthMatcher.find()) {
                    try { length = Math.min(Integer.parseInt(lengthMatcher.group(1)), 30 * 1024 * 1024); } catch (Exception ignored) {}
                }
                if (length > 0) {
                    ByteArrayOutputStream bodyOut = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int remaining = length;
                    while (remaining > 0) {
                        int n = input.read(buf, 0, Math.min(buf.length, remaining));
                        if (n < 0) break;
                        bodyOut.write(buf, 0, n);
                        remaining -= n;
                    }
                    requestBody = bodyOut.toByteArray();
                }
            }
            int q = rawPath.indexOf('?');
            String query = q >= 0 ? rawPath.substring(q + 1) : "";
            if (q >= 0) rawPath = rawPath.substring(0, q);
            String path = URLDecoder.decode(rawPath, "UTF-8");
            if (path.length() == 0 || path.equals("/")) path = "/index.html";
            if (path.contains("..")) {
                writeResponse(output, 403, "text/plain; charset=utf-8",
                        "Forbidden".getBytes(StandardCharsets.UTF_8), headOnly);
                return;
            }
            if (path.equals("/api/ai/chat") || path.equals("/api/ai/models")) {
                handleAi(output, path, requestBody, headOnly);
                return;
            }
            if (path.equals("/api/health")) {
                writeJson(output, "{\"ok\":true,\"features\":{\"mail\":true,\"fudan\":true,\"latex\":false}}", headOnly);
                return;
            }
            if (path.startsWith("/api/fudan/")) {
                writeJson(output, handleFudan(path, requestBody), headOnly);
                return;
            }
            if (path.startsWith("/api/mail/")) {
                if (path.equals("/api/mail/attachment")) {
                    MailService.AttachmentData att = mail == null ? null : mail.attachment(parseQuery(query));
                    if (att == null || att.data == null) {
                        writeResponse(output, 404, "application/json; charset=utf-8",
                                "{\"ok\":false,\"error\":\"附件不在了\"}".getBytes(StandardCharsets.UTF_8), headOnly);
                    } else {
                        writeAttachment(output, att, headOnly);
                    }
                    return;
                }
                writeJson(output, handleMail(path, query, requestBody, method), headOnly);
                return;
            }
            if (path.startsWith("/api/")) {
                writeResponse(output, 404, "application/json; charset=utf-8",
                        "{\"error\":\"no local api\"}".getBytes(StandardCharsets.UTF_8), headOnly);
                return;
            }
            String assetPath = "web" + path;
            byte[] data = readAsset(assetPath);
            String mime = mimeOf(path);
            if (data == null) {
                // 未知路径回落到 index.html（应用本身使用 hash 路由，一般不会走到这里）
                data = readAsset("web/index.html");
                mime = MIME.get("html");
            }
            if (data == null) {
                writeResponse(output, 404, "text/plain; charset=utf-8",
                        "Not Found".getBytes(StandardCharsets.UTF_8), headOnly);
                return;
            }
            writeResponse(output, 200, mime, data, headOnly);
        } catch (Exception ignored) {
        } finally {
            try {
                socket.close();
            } catch (IOException ignored) {
            }
        }
    }

    private String handleFudan(String path, byte[] body) {
        if (fudan == null) {
            return "{\"ok\":false,\"error\":\"这个版本没有内置复旦认证\"}";
        }
        String action = path.substring("/api/fudan".length());
        try {
            if ("/status".equals(action)) {
                return fudan.statusJson();
            }
            if ("/login".equals(action)) {
                JSONObject req = new JSONObject(new String(body, StandardCharsets.UTF_8));
                return fudan.loginJson(req.optString("username", ""), req.optString("password", ""),
                        req.optBoolean("remember", true));
            }
            if ("/autologin".equals(action)) {
                return fudan.autologinJson();
            }
            if ("/logout".equals(action)) {
                boolean clear = true;
                try {
                    JSONObject req = new JSONObject(new String(body, StandardCharsets.UTF_8));
                    clear = req.optBoolean("clear", true);
                } catch (Exception ignored) {
                }
                return fudan.logoutJson(clear);
            }
            if ("/proxy".equals(action)) {
                JSONObject req = new JSONObject(new String(body, StandardCharsets.UTF_8));
                return fudan.proxyJson(req.optString("url", ""), req.optString("method", "GET"),
                        req.optString("body", ""), req.optString("contentType", ""));
            }
            JSONObject out = new JSONObject();
            out.put("ok", false);
            out.put("error", "没有这个复旦接口");
            return out.toString();
        } catch (Exception e) {
            try {
                JSONObject out = new JSONObject();
                out.put("ok", false);
                out.put("error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                return out.toString();
            } catch (Exception ignored) {
                return "{\"ok\":false,\"error\":\"unknown\"}";
            }
        }
    }

    private void handleAi(OutputStream out, String path, byte[] body, boolean headOnly) throws IOException {
        HttpURLConnection conn = null;
        boolean headersSent = false;
        try {
            JSONObject req = new JSONObject(new String(body, StandardCharsets.UTF_8));
            String base = req.optString("base", "").trim();
            while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
            String key = req.optString("key", "");
            if (!base.startsWith("https://") && !base.startsWith("http://")) {
                writeResponse(out, 400, "application/json; charset=utf-8",
                        "{\"error\":\"服务地址无效\"}".getBytes(StandardCharsets.UTF_8), headOnly);
                return;
            }
            if (key.isEmpty()) {
                writeResponse(out, 400, "application/json; charset=utf-8",
                        "{\"error\":\"缺少访问密钥\"}".getBytes(StandardCharsets.UTF_8), headOnly);
                return;
            }
            boolean models = path.endsWith("/models");
            String target = models
                    ? base.replaceFirst("/chat/completions$", "") + "/models"
                    : (base.endsWith("/chat/completions") ? base : base + "/chat/completions");
            JSONObject payload = new JSONObject(req.toString());
            payload.remove("base");
            payload.remove("key");
            byte[] payloadBytes = payload.toString().getBytes(StandardCharsets.UTF_8);
            conn = (HttpURLConnection) new URL(target).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(120000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + key);
            conn.setRequestProperty("Accept", "text/event-stream, application/json");
            conn.setRequestProperty("User-Agent", "DanLume-Mobile/1.3.2");
            OutputStream up = conn.getOutputStream();
            up.write(payloadBytes);
            up.flush();
            up.close();
            int code = conn.getResponseCode();
            String ctype = conn.getContentType();
            if (ctype == null || ctype.isEmpty()) ctype = "application/json; charset=utf-8";
            if (code != 200) {
                byte[] data = readAll(conn.getErrorStream());
                writeResponse(out, code, ctype, data, headOnly);
                return;
            }
            if (models) {
                byte[] data = readAll(conn.getInputStream());
                writeResponse(out, 200, ctype, data, headOnly);
                return;
            }
            String headers = "HTTP/1.1 200 OK\r\n" +
                    "Content-Type: text/event-stream; charset=utf-8\r\n" +
                    "Cache-Control: no-cache, no-transform\r\n" +
                    "X-Accel-Buffering: no\r\n" +
                    "Connection: close\r\n\r\n";
            out.write(headers.getBytes(StandardCharsets.ISO_8859_1));
            headersSent = true;
            if (headOnly) return;
            InputStream in = conn.getInputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                out.flush();
            }
        } catch (Exception e) {
            if (!headOnly && !headersSent) {
                try {
                    String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                    writeResponse(out, 502, "application/json; charset=utf-8",
                            ("{\"error\":\"AI 服务连接失败：" + msg + "\"}").getBytes(StandardCharsets.UTF_8), false);
                } catch (Exception ignored) {
                }
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        if (in == null) return new byte[0];
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }

    private String handleMail(String path, String query, byte[] body, String method) {
        if (mail == null) return "{\"ok\":false,\"error\":\"这个版本没有内置邮箱服务\"}";
        String action = path.substring("/api/mail".length());
        Map<String, String> params = parseQuery(query);
        try {
            if ("/accounts".equals(action)) {
                if ("POST".equalsIgnoreCase(method)) {
                    return mail.saveAccountJson(new String(body, StandardCharsets.UTF_8));
                }
                return mail.accountsJson();
            }
            if ("/save".equals(action) || "/accounts/save".equals(action)) {
                return mail.saveAccountJson(new String(body, StandardCharsets.UTF_8));
            }
            if ("/delete".equals(action) || "/accounts/delete".equals(action)) {
                return mail.deleteAccountJson(new String(body, StandardCharsets.UTF_8));
            }
            if ("/test".equals(action)) return mail.testJson(new String(body, StandardCharsets.UTF_8));
            if ("/inbox".equals(action)) return mail.inboxJson(params);
            if ("/message".equals(action)) return mail.messageJson(params);
            if ("/flags".equals(action)) return mail.flagsJson(new String(body, StandardCharsets.UTF_8));
            if ("/send".equals(action)) return mail.sendJson(new String(body, StandardCharsets.UTF_8));
            JSONObject out = new JSONObject();
            out.put("ok", false);
            out.put("error", "没有这个邮箱接口");
            return out.toString();
        } catch (Exception e) {
            try {
                JSONObject out = new JSONObject();
                out.put("ok", false);
                out.put("error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                return out.toString();
            } catch (Exception ignored) {
                return "{\"ok\":false,\"error\":\"unknown\"}";
            }
        }
    }

    private static Map<String, String> parseQuery(String query) {
        Map<String, String> map = new HashMap<>();
        if (query == null || query.isEmpty()) return map;
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq < 0) continue;
            try {
                map.put(URLDecoder.decode(pair.substring(0, eq), "UTF-8"),
                        URLDecoder.decode(pair.substring(eq + 1), "UTF-8"));
            } catch (Exception ignored) {
            }
        }
        return map;
    }

    private static void writeAttachment(OutputStream out, MailService.AttachmentData att, boolean headOnly) throws IOException {
        String filename = att.filename == null || att.filename.isEmpty() ? "attachment" : att.filename;
        String ascii = filename.replaceAll("[^\\x20-\\x7E]", "_").replace("\"", "_");
        String encoded;
        try {
            encoded = java.net.URLEncoder.encode(filename, "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            encoded = ascii;
        }
        String ctype = att.contentType == null || att.contentType.isEmpty()
                ? "application/octet-stream" : att.contentType;
        String headers = "HTTP/1.1 200 OK\r\n" +
                "Content-Type: " + ctype + "\r\n" +
                "Content-Length: " + att.data.length + "\r\n" +
                "Content-Disposition: attachment; filename=\"" + ascii + "\"; filename*=UTF-8''" + encoded + "\r\n" +
                "Cache-Control: no-cache\r\n" +
                "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.ISO_8859_1));
        if (!headOnly) out.write(att.data);
    }

    private static void writeJson(OutputStream out, String json, boolean headOnly) throws IOException {
        writeResponse(out, 200, "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8), headOnly);
    }

    private static String readHeader(InputStream input) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int prev3 = -1, prev2 = -1, prev1 = -1, cur;
        while ((cur = input.read()) != -1) {
            out.write(cur);
            if (prev3 == '\r' && prev2 == '\n' && prev1 == '\r' && cur == '\n') break;
            if (prev2 == '\n' && prev1 == '\n') break;
            prev3 = prev2;
            prev2 = prev1;
            prev1 = cur;
            if (out.size() > 32768) break;
        }
        return new String(out.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private byte[] readAsset(String path) {
        return assets.read(path);
    }

    private static byte[] readAssetFrom(AssetManager manager, String path) {
        InputStream in = null;
        try {
            in = manager.open(path);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return out.toByteArray();
        } catch (IOException e) {
            return null;
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (IOException ignored) {
                }
            }
        }
    }

    private static String mimeOf(String path) {
        int dot = path.lastIndexOf('.');
        if (dot >= 0 && dot < path.length() - 1) {
            String ext = path.substring(dot + 1).toLowerCase();
            String found = MIME.get(ext);
            if (found != null) return found;
        }
        return "application/octet-stream";
    }

    private static void writeResponse(OutputStream out, int status, String contentType, byte[] body, boolean headOnly)
            throws IOException {
        String reason;
        switch (status) {
            case 200: reason = "OK"; break;
            case 403: reason = "Forbidden"; break;
            case 404: reason = "Not Found"; break;
            case 405: reason = "Method Not Allowed"; break;
            default: reason = "Error"; break;
        }
        String headers = "HTTP/1.1 " + status + " " + reason + "\r\n" +
                "Content-Type: " + contentType + "\r\n" +
                "Content-Length: " + body.length + "\r\n" +
                "Cache-Control: no-cache\r\n" +
                "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.ISO_8859_1));
        if (!headOnly) out.write(body);
        out.flush();
    }
}
