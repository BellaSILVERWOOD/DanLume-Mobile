package com.danlume.mobile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;

/**
 * 复旦大学新版身份认证（id.fudan.edu.cn）以及校园数据的带 Cookie 代理。
 *
 * 页面/接口流程参考学校 ID 系统的官方前端：
 *   1. 访问 fdjwgl 课表页，跟随跳转拿到 id.fudan.edu.cn/ac 的 lck / entityId
 *   2. queryAuthMethods 取密码认证链
 *   3. getJsPublicKey 取 RSA 公钥，PKCS#1 加密密码
 *   4. authExecute 提交，拿 loginToken
 *   5. authCenter/authnEngine 换 ticket，再访问 ticket 完成 SSO
 *   6. 回到课表页并保留 Cookie，用于后续课表/通知同步
 */
public class FudanAuth {

    public interface CredentialStore {
        String[] load();           // {username, password} 或 null
        void save(String username, String password);
        void clear();
    }

    /** 把登录 Cookie 同步给 WebView，便于应用内打开 eHall 时自动带着登录态。 */
    public interface CookieSink {
        void onCookie(String domain, String name, String value);
    }

    private static final String ID_BASE = "https://id.fudan.edu.cn";
    private static final String COURSE_TABLE = "https://fdjwgl.fudan.edu.cn/student/for-std/course-table";
    private static final String EHALL_INFO = "https://ehall.fudan.edu.cn/jsonp/ywtb/info/getUserInfoAndSchoolInfo.json";
    private static final String UA = "Mozilla/5.0 (Linux; Android 13; DanLume) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

    private static class Cookie {
        String domain;
        String name;
        String value;
    }

    private static class Resp {
        String url;
        int status;
        String text;
        String contentType;
    }

    private final CredentialStore store;
    private final Map<String, Cookie> jar = new HashMap<>();
    private volatile CookieSink cookieSink;
    private volatile boolean loggedIn = false;
    private volatile String profileId = "";
    private volatile String profileName = "";
    private volatile String profileDept = "";
    private volatile String profileType = "";

    public FudanAuth(CredentialStore store) {
        this.store = store;
    }

    public void setCookieSink(CookieSink sink) {
        this.cookieSink = sink;
    }

    private void pushCookies() {
        CookieSink sink = cookieSink;
        if (sink == null) return;
        for (Cookie cookie : jar.values()) {
            try { sink.onCookie(cookie.domain, cookie.name, cookie.value); } catch (Exception ignored) {}
        }
    }

    public synchronized String statusJson() {
        JSONObject out = new JSONObject();
        try {
            out.put("ok", true);
            out.put("loggedIn", loggedIn);
            out.put("profile", profileJson());
            String[] saved = safeLoad();
            out.put("hasSaved", saved != null);
            out.put("savedUsername", saved != null ? saved[0] : "");
            out.put("savedAt", saved != null ? 1 : 0);
        } catch (Exception e) {
            try { out.put("error", msg(e)); } catch (Exception ignored) {}
        }
        return out.toString();
    }

    private JSONObject profileJson() throws Exception {
        JSONObject p = new JSONObject();
        p.put("id", profileId);
        p.put("name", profileName);
        p.put("department", profileDept);
        p.put("type", profileType);
        return p;
    }

    public synchronized String loginJson(String username, String password, boolean remember) {
        JSONObject out = new JSONObject();
        try {
            login(username, password);
            if (remember) store.save(username.trim(), password);
            else store.clear();
            out.put("ok", true);
            out.put("profile", profileJson());
        } catch (Exception e) {
            try { out.put("ok", false); out.put("error", msg(e)); } catch (Exception ignored) {}
        }
        return out.toString();
    }

    public synchronized String autologinJson() {
        JSONObject out = new JSONObject();
        try {
            if (!loggedIn) {
                String[] saved = store.load();
                if (saved == null || saved[0] == null || saved[1] == null) {
                    throw new Exception("还没有保存登录信息");
                }
                login(saved[0], saved[1]);
            }
            out.put("ok", true);
            out.put("profile", profileJson());
        } catch (Exception e) {
            try { out.put("ok", false); out.put("error", msg(e)); } catch (Exception ignored) {}
        }
        return out.toString();
    }

    public synchronized String logoutJson(boolean clearSaved) {
        loggedIn = false;
        profileId = "";
        profileName = "";
        profileDept = "";
        profileType = "";
        jar.clear();
        if (clearSaved) store.clear();
        JSONObject out = new JSONObject();
        try { out.put("ok", true); } catch (Exception ignored) {}
        return out.toString();
    }

    public synchronized String proxyJson(String target, String method, String body, String contentType) {
        JSONObject out = new JSONObject();
        try {
            URL url = new URL(target);
            String host = url.getHost();
            if (!"https".equals(url.getProtocol()) || !(host.equals("fudan.edu.cn") || host.endsWith(".fudan.edu.cn"))) {
                throw new Exception("只允许访问复旦校内地址");
            }
            if (!loggedIn) {
                String[] saved = safeLoad();
                if (saved != null) {
                    try { login(saved[0], saved[1]); } catch (Exception ignored) {}
                }
            }
            Resp resp = request(url.toString(), "POST".equals(method) ? "POST" : "GET", body, contentType);
            out.put("ok", true);
            out.put("status", resp.status);
            out.put("url", resp.url);
            out.put("contentType", resp.contentType);
            out.put("body", resp.text.length() > 2 * 1024 * 1024 ? resp.text.substring(0, 2 * 1024 * 1024) : resp.text);
            out.put("loggedIn", loggedIn);
            pushCookies();
        } catch (Exception e) {
            try { out.put("ok", false); out.put("error", msg(e)); } catch (Exception ignored) {}
        }
        return out.toString();
    }

    /* ---------------- 登录流程 ---------------- */

    private void login(String username, String password) throws Exception {
        String user = username == null ? "" : username.trim();
        String pass = password == null ? "" : password;
        if (user.isEmpty() || pass.isEmpty()) throw new Exception("请填写学号和密码");
        jar.clear();
        loggedIn = false;

        Resp first = request(COURSE_TABLE, "GET", null, null);
        if (first.url.startsWith("https://fdjwgl.fudan.edu.cn") && first.status == 200) {
            loggedIn = true;
            profileId = user;
            profileName = user;
            return;
        }
        String[] params = parseAuthParams(first.url);
        if (params == null) throw new Exception("无法解析学校登录入口，请稍后重试");

        JSONObject payload = new JSONObject();
        payload.put("lck", params[0]);
        payload.put("entityId", params[1]);
        JSONObject methods = jsonPost(ID_BASE + "/idp/authn/queryAuthMethods", payload);
        if (methods == null) throw new Exception("学校认证服务响应异常");
        if (methods.optBoolean("second")) throw new Exception("学校要求二次验证，请先在浏览器登录后重试");
        JSONArray entries = methods.optJSONArray("data");
        String chainCode = "";
        if (entries != null) {
            for (int i = 0; i < entries.length(); i++) {
                JSONObject item = entries.optJSONObject(i);
                if (item != null && "userAndPwd".equals(item.optString("moduleCode"))) {
                    chainCode = item.optString("authChainCode", "");
                    break;
                }
            }
        }
        if (chainCode.isEmpty()) throw new Exception("学校未返回密码认证方式，可能需要在浏览器完成验证");

        JSONObject keyJson = jsonPost(ID_BASE + "/idp/authn/getJsPublicKey", new JSONObject());
        String publicKey = keyJson == null ? "" : keyJson.optString("data", "");
        if (publicKey.isEmpty()) throw new Exception("学校认证服务未返回公钥");
        String encrypted = rsaEncrypt(publicKey, pass);

        JSONObject authBody = new JSONObject();
        authBody.put("lck", params[0]);
        authBody.put("entityId", params[1]);
        authBody.put("authModuleCode", "userAndPwd");
        authBody.put("authChainCode", chainCode);
        authBody.put("requestType", "chain_type");
        JSONObject authPara = new JSONObject();
        authPara.put("loginName", user);
        authPara.put("password", encrypted);
        authPara.put("verifyCode", "");
        authBody.put("authPara", authPara);
        JSONObject result = jsonPost(ID_BASE + "/idp/authn/authExecute", authBody);
        if (result == null) throw new Exception("学校认证服务响应异常");
        String message = result.optString("message", "");
        if (result.optBoolean("second") || message.contains("验证码") || message.contains("二次验证")) {
            throw new Exception("学校要求验证码/二次验证，请先在浏览器登录一次后再试");
        }
        String loginToken = result.optString("loginToken", "");
        if (loginToken.isEmpty()) throw new Exception(cleanMessage(message));

        String form = "loginToken=" + URLEncoder.encode(loginToken, "UTF-8");
        Resp engine = request(ID_BASE + "/idp/authCenter/authnEngine", "POST", form,
                "application/x-www-form-urlencoded");
        String ticket = parseTicket(engine.text, engine.url);
        if (ticket == null) throw new Exception("登录票据解析失败，学校页面可能已更新");
        Resp done = request(ticket, "GET", null, null);
        if (!done.url.startsWith("https://fdjwgl.fudan.edu.cn")) {
            throw new Exception("登录后未回到课表页面，可能在浏览器里需要额外验证");
        }
        loggedIn = true;
        profileId = user;
        profileName = user;
        pushCookies();
        try {
            Resp info = request(EHALL_INFO, "GET", null, null);
            JSONObject infoJson = new JSONObject(info.text);
            JSONObject data = infoJson.optJSONObject("data");
            if (data != null) {
                String name = data.optString("userName", "");
                if (!name.isEmpty()) profileName = name;
                profileDept = data.optString("userDepartment", "");
                profileType = data.optString("userTypeName", "");
            }
        } catch (Exception ignored) {
        }
    }

    private String[] parseAuthParams(String url) {
        int hash = url.indexOf('#');
        if (hash < 0) return null;
        String fragment = url.substring(hash + 1);
        int q = fragment.indexOf('?');
        String query = q >= 0 ? fragment.substring(q + 1) : fragment;
        String lck = null, entityId = null;
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq < 0) continue;
            try {
                String k = pair.substring(0, eq);
                String v = URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
                if (k.equals("lck")) lck = v;
                else if (k.equals("entityId")) entityId = v;
            } catch (Exception ignored) {}
        }
        if (lck == null || entityId == null || lck.isEmpty() || entityId.isEmpty()) return null;
        return new String[]{ lck, entityId };
    }

    private JSONObject jsonPost(String url, JSONObject body) throws Exception {
        Resp resp = request(url, "POST", body.toString(), "application/json");
        try {
            return new JSONObject(resp.text);
        } catch (Exception e) {
            return null;
        }
    }

    private static String cleanMessage(String message) {
        String text = message == null ? "" : message.replace("原因分析：", " ").replace("原因分析:", " ").trim();
        if (text.contains("用户名或密码错误")) {
            String extra = "";
            Matcher m = Pattern.compile("还有(\\d+)次").matcher(text);
            if (m.find()) extra = "（还可尝试 " + m.group(1) + " 次）";
            return "学号或密码错误" + extra;
        }
        return text.isEmpty() ? "学号或密码不正确" : text;
    }

    private String rsaEncrypt(String base64Key, String password) throws Exception {
        byte[] der = base64Decode(base64Key);
        PublicKey key = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(der));
        Cipher cipher = Cipher.getInstance("RSA/ECB/PKCS1Padding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        return base64Encode(cipher.doFinal(password.getBytes(StandardCharsets.UTF_8)));
    }

    private String parseTicket(String html, String base) throws Exception {
        Matcher formMatcher = Pattern.compile("<form[^>]*>", Pattern.CASE_INSENSITIVE).matcher(html);
        String action = null;
        while (formMatcher.find()) {
            String tag = formMatcher.group();
            if (tag.matches("(?is).*id\\s*=\\s*[\"']logon[\"'].*")) {
                Matcher a = Pattern.compile("action\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(tag);
                if (a.find()) { action = a.group(1); break; }
            }
        }
        if (action == null) return null;
        Matcher inputMatcher = Pattern.compile("<input[^>]*>", Pattern.CASE_INSENSITIVE).matcher(html);
        String ticket = null;
        while (inputMatcher.find()) {
            String tag = inputMatcher.group();
            if (tag.matches("(?is).*(?:name|id)\\s*=\\s*[\"']ticket[\"'].*")) {
                Matcher v = Pattern.compile("value\\s*=\\s*[\"']([^\"']*)[\"']", Pattern.CASE_INSENSITIVE).matcher(tag);
                if (v.find()) { ticket = v.group(1); break; }
            }
        }
        if (ticket == null) return null;
        URL target = new URL(new URL(base), action);
        String sep = target.getQuery() == null ? "?" : "&";
        return target.toString() + sep + "ticket=" + URLEncoder.encode(ticket, "UTF-8");
    }

    /* ---------------- HTTP + Cookie ---------------- */

    private Resp request(String start, String method, String body, String contentType) throws Exception {
        String current = start;
        String httpMethod = method == null ? "GET" : method;
        String payload = body;
        String type = contentType;
        for (int hop = 0; hop < 12; hop++) {
            HttpURLConnection conn = (HttpURLConnection) new URL(current).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(25000);
            conn.setRequestMethod(httpMethod);
            conn.setRequestProperty("User-Agent", UA);
            conn.setRequestProperty("Accept", "text/html,application/json,application/xhtml+xml,*/*;q=0.8");
            conn.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9");
            String cookie = cookieHeader(current);
            if (!cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
            if (payload != null && !httpMethod.equals("GET")) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", type == null ? "application/json" : type);
                byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(bytes.length);
                OutputStream out = conn.getOutputStream();
                out.write(bytes);
                out.close();
            }
            int status = conn.getResponseCode();
            storeCookies(current, conn.getHeaderFields());
            String location = conn.getHeaderField("Location");
            if (status >= 300 && status < 400 && location != null) {
                URL next = new URL(new URL(current), location);
                String host = next.getHost();
                if (!"https".equals(next.getProtocol()) || !(host.equals("fudan.edu.cn") || host.endsWith(".fudan.edu.cn"))) {
                    throw new Exception("认证跳转到了非复旦域名，已停止");
                }
                if (status == 303 || ((status == 301 || status == 302) && !httpMethod.equals("GET"))) {
                    httpMethod = "GET";
                    payload = null;
                    type = null;
                }
                current = next.toString();
                conn.disconnect();
                continue;
            }
            InputStream input = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = input == null ? "" : readAll(input);
            Resp resp = new Resp();
            resp.url = current;
            resp.status = status;
            resp.text = text;
            resp.contentType = conn.getContentType() == null ? "" : conn.getContentType();
            conn.disconnect();
            return resp;
        }
        throw new Exception("重定向次数过多");
    }

    private static String readAll(InputStream input) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384];
        int n;
        while ((n = input.read(buffer)) != -1) out.write(buffer, 0, n);
        input.close();
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private String cookieHeader(String url) {
        String host;
        try { host = new URL(url).getHost(); } catch (Exception e) { return ""; }
        StringBuilder sb = new StringBuilder();
        for (Cookie c : jar.values()) {
            if (host.equals(c.domain) || host.endsWith("." + c.domain)) {
                if (sb.length() > 0) sb.append("; ");
                sb.append(c.name).append("=").append(c.value);
            }
        }
        return sb.toString();
    }

    private void storeCookies(String url, Map<String, List<String>> headers) {
        String host;
        try { host = new URL(url).getHost(); } catch (Exception e) { return; }
        List<String> values = new ArrayList<>();
        for (Map.Entry<String, List<String>> e : headers.entrySet()) {
            if (e.getKey() != null && e.getKey().equalsIgnoreCase("Set-Cookie")) {
                values.addAll(e.getValue());
            }
        }
        for (String raw : values) {
            String first = raw.split(";")[0];
            int eq = first.indexOf('=');
            if (eq <= 0) continue;
            String name = first.substring(0, eq).trim();
            String value = first.substring(eq + 1).trim();
            String domain = host;
            Matcher m = Pattern.compile("(?i)domain\\s*=\\s*\\.?([^;]+)").matcher(raw);
            if (m.find()) {
                String d = m.group(1).trim().toLowerCase();
                if (host.equals(d) || host.endsWith("." + d)) domain = d;
            }
            Cookie cookie = new Cookie();
            cookie.domain = domain;
            cookie.name = name;
            cookie.value = value;
            jar.put(domain + "|" + name, cookie);
        }
    }

    private String[] safeLoad() {
        try { return store.load(); } catch (Exception e) { return null; }
    }

    private static String msg(Exception e) {
        String m = e.getMessage();
        return m == null || m.isEmpty() ? e.getClass().getSimpleName() : m;
    }

    /* ---------------- Base64（避免依赖 API 26 的 java.util.Base64） ---------------- */

    private static final char[] B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();

    private static String base64Encode(byte[] data) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < data.length; i += 3) {
            int b0 = data[i] & 0xff;
            int b1 = i + 1 < data.length ? data[i + 1] & 0xff : 0;
            int b2 = i + 2 < data.length ? data[i + 2] & 0xff : 0;
            sb.append(B64[b0 >> 2]);
            sb.append(B64[((b0 & 3) << 4) | (b1 >> 4)]);
            sb.append(i + 1 < data.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=');
            sb.append(i + 2 < data.length ? B64[b2 & 63] : '=');
        }
        return sb.toString();
    }

    private static byte[] base64Decode(String text) {
        String s = text.replaceAll("\\s", "");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int[] buffer = new int[4];
        int count = 0;
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            int value;
            if (ch >= 'A' && ch <= 'Z') value = ch - 'A';
            else if (ch >= 'a' && ch <= 'z') value = ch - 'a' + 26;
            else if (ch >= '0' && ch <= '9') value = ch - '0' + 52;
            else if (ch == '+') value = 62;
            else if (ch == '/') value = 63;
            else if (ch == '=') value = -1;
            else continue;
            buffer[count++] = value;
            if (count == 4) {
                out.write((buffer[0] << 2) | (buffer[1] >> 4));
                if (buffer[2] >= 0) out.write(((buffer[1] & 15) << 4) | (buffer[2] >> 2));
                if (buffer[3] >= 0) out.write(((buffer[2] & 3) << 6) | buffer[3]);
                count = 0;
            }
        }
        return out.toByteArray();
    }
}
