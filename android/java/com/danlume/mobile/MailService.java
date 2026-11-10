package com.danlume.mobile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.UnsupportedEncodingException;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.security.cert.CertificateException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.sun.mail.imap.IMAPProvider;
import com.sun.mail.imap.IMAPSSLProvider;
import com.sun.mail.imap.IMAPStore;
import com.sun.mail.smtp.SMTPProvider;
import com.sun.mail.smtp.SMTPSSLProvider;

import javax.activation.CommandMap;
import javax.activation.DataHandler;
import javax.activation.MailcapCommandMap;
import javax.mail.Address;
import javax.mail.AuthenticationFailedException;
import javax.mail.Flags;
import javax.mail.Folder;
import javax.mail.Message;
import javax.mail.MessagingException;
import javax.mail.Multipart;
import javax.mail.Part;
import javax.mail.Session;
import javax.mail.Transport;
import javax.mail.UIDFolder;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeBodyPart;
import javax.mail.internet.MimeMessage;
import javax.mail.internet.MimeMultipart;
import javax.mail.internet.MimeUtility;
import javax.mail.search.FromStringTerm;
import javax.mail.search.OrTerm;
import javax.mail.search.RecipientStringTerm;
import javax.mail.search.SearchTerm;
import javax.mail.search.SubjectTerm;
import javax.mail.util.ByteArrayDataSource;

/**
 * 手机端邮箱：IMAP 收件 + SMTP 发件（JavaMail for Android）。
 * 账号只保存在本机；MailPrefsStore 会用 Keystore 加密整个 JSON。
 */
public class MailService {

    public interface AccountStore {
        String load();
        boolean save(String json);
    }

    public static class AttachmentData {
        public String filename;
        public String contentType;
        public byte[] data;
    }

    private static final int MAX_BODY = 20 * 1024 * 1024;
    private static boolean mailcapReady = false;

    static {
        ensureMailcap();
    }

    /**
     * APK 的 classes.dex 没有 META-INF/mailcap 资源，JavaMail 会报
     * “no object DCH for MIME type multipart/mixed”。这里显式注册内容处理器。
     */
    private static synchronized void ensureMailcap() {
        if (mailcapReady) return;
        try {
            MailcapCommandMap map = new MailcapCommandMap();
            map.addMailcap("text/plain;; x-java-content-handler=com.sun.mail.handlers.text_plain");
            map.addMailcap("text/html;; x-java-content-handler=com.sun.mail.handlers.text_html");
            map.addMailcap("text/xml;; x-java-content-handler=com.sun.mail.handlers.text_xml");
            map.addMailcap("multipart/*;; x-java-content-handler=com.sun.mail.handlers.multipart_mixed; x-java-fallback-entry=true");
            map.addMailcap("message/rfc822;; x-java-content-handler=com.sun.mail.handlers.message_rfc822");
            CommandMap.setDefaultCommandMap(map);
        } catch (Exception ignored) {
        }
        mailcapReady = true;
    }

    private final AccountStore store;

    public MailService(AccountStore store) {
        this.store = store;
    }

    /* ---------------- 账号 ---------------- */

    private static class Account {
        String id = "";
        String name = "";
        String email = "";
        String imapHost = "";
        int imapPort = 993;
        boolean imapSecure = true;
        String imapUser = "";
        String imapPass = "";
        String smtpHost = "";
        int smtpPort = 465;
        boolean smtpSecure = true;
        String smtpUser = "";
        String smtpPass = "";
        String smtpFrom = "";

        static Account from(JSONObject j) {
            Account a = new Account();
            a.id = j.optString("id", "");
            a.name = j.optString("name", "");
            a.email = j.optString("email", "");
            JSONObject im = j.optJSONObject("imap");
            if (im != null) {
                a.imapHost = im.optString("host", "");
                a.imapPort = im.optInt("port", 993);
                a.imapSecure = im.optBoolean("secure", true);
                a.imapUser = im.optString("user", a.email);
                a.imapPass = im.optString("pass", "");
            }
            JSONObject sm = j.optJSONObject("smtp");
            if (sm != null) {
                a.smtpHost = sm.optString("host", "");
                a.smtpPort = sm.optInt("port", 465);
                a.smtpSecure = sm.optBoolean("secure", true);
                a.smtpUser = sm.optString("user", a.email);
                a.smtpPass = sm.optString("pass", "");
                a.smtpFrom = sm.optString("fromName", "");
            }
            return a;
        }

        JSONObject toJson(boolean withPass) throws Exception {
            JSONObject j = new JSONObject();
            j.put("id", id);
            j.put("name", name);
            j.put("email", email);
            JSONObject im = new JSONObject();
            im.put("host", imapHost);
            im.put("port", imapPort);
            im.put("secure", imapSecure);
            im.put("user", imapUser);
            if (withPass) im.put("pass", imapPass);
            j.put("imap", im);
            JSONObject sm = new JSONObject();
            sm.put("host", smtpHost);
            sm.put("port", smtpPort);
            sm.put("secure", smtpSecure);
            sm.put("user", smtpUser);
            sm.put("fromName", smtpFrom);
            if (withPass) sm.put("pass", smtpPass);
            j.put("smtp", sm);
            return j;
        }

        JSONObject publicJson() throws Exception {
            JSONObject j = toJson(false);
            j.getJSONObject("imap").put("hasPass", !imapPass.isEmpty());
            j.getJSONObject("smtp").put("hasPass", !smtpPass.isEmpty());
            return j;
        }
    }

    private JSONArray loadAccounts() {
        try {
            String raw = store.load();
            if (raw == null || raw.trim().isEmpty()) return new JSONArray();
            return new JSONArray(raw);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private boolean persist(JSONArray arr) {
        try {
            return store.save(arr.toString());
        } catch (Exception e) {
            return false;
        }
    }

    private Account find(JSONArray arr, String id) {
        for (int i = 0; i < arr.length(); i++) {
            JSONObject j = arr.optJSONObject(i);
            if (j != null && id != null && id.equals(j.optString("id"))) return Account.from(j);
        }
        return null;
    }

    private Account resolveAccount(JSONObject body) throws Exception {
        JSONArray arr = loadAccounts();
        JSONObject draft = body.optJSONObject("account");
        String id = body.optString("id", draft == null ? "" : draft.optString("id", ""));
        Account old = id == null || id.isEmpty() ? null : find(arr, id);
        if (draft == null) {
            if (old == null) throw new Exception("没有这个邮箱账户");
            return old;
        }
        Account a = Account.from(draft);
        if (a.id.isEmpty() && old != null) a.id = old.id;
        if (a.imapPass.isEmpty() && old != null) a.imapPass = old.imapPass;
        if (a.smtpPass.isEmpty() && old != null) a.smtpPass = old.smtpPass;
        if (a.imapUser.isEmpty()) a.imapUser = a.email;
        if (a.smtpUser.isEmpty()) a.smtpUser = a.email;
        return a;
    }

    public synchronized String accountsJson() {
        JSONObject out = new JSONObject();
        try {
            JSONArray arr = loadAccounts();
            JSONArray list = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject j = arr.optJSONObject(i);
                if (j != null) list.put(Account.from(j).publicJson());
            }
            out.put("accounts", list);
            out.put("ok", true);
        } catch (Exception e) {
            putError(out, e);
        }
        return out.toString();
    }

    public synchronized String saveAccountJson(String body) {
        JSONObject out = new JSONObject();
        try {
            JSONObject req = new JSONObject(body);
            JSONObject draft = req.optJSONObject("account");
            if (draft == null) throw new Exception("缺少账户信息");
            Account a = Account.from(draft);
            if (a.email == null || a.email.trim().isEmpty()) throw new Exception("缺少邮箱地址");
            JSONArray arr = loadAccounts();
            Account old = a.id.isEmpty() ? null : find(arr, a.id);
            if (a.id.isEmpty()) a.id = "acc" + Long.toString(System.currentTimeMillis(), 36);
            if (a.imapPass.isEmpty() && old != null) a.imapPass = old.imapPass;
            if (a.smtpPass.isEmpty() && old != null) a.smtpPass = old.smtpPass;
            if (a.name.isEmpty()) a.name = a.email;
            if (a.imapUser.isEmpty()) a.imapUser = a.email;
            if (a.smtpUser.isEmpty()) a.smtpUser = a.email;
            JSONArray next = new JSONArray();
            boolean replaced = false;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject j = arr.optJSONObject(i);
                if (j != null && a.id.equals(j.optString("id"))) {
                    next.put(a.toJson(true));
                    replaced = true;
                } else if (j != null) {
                    next.put(j);
                }
            }
            if (!replaced) next.put(a.toJson(true));
            if (!persist(next)) throw new Exception("账户保存失败：本机加密存储不可用，请重试");
            out.put("ok", true);
            out.put("account", a.publicJson());
        } catch (Exception e) {
            putError(out, e);
        }
        return out.toString();
    }

    public synchronized String deleteAccountJson(String body) {
        JSONObject out = new JSONObject();
        try {
            JSONObject req = new JSONObject(body);
            String id = req.optString("id", "");
            JSONArray arr = loadAccounts();
            JSONArray next = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject j = arr.optJSONObject(i);
                if (j != null && !id.equals(j.optString("id"))) next.put(j);
            }
            if (!persist(next)) throw new Exception("删除失败：本机加密存储不可用");
            out.put("ok", true);
        } catch (Exception e) {
            putError(out, e);
        }
        return out.toString();
    }

    public synchronized String testJson(String body) {
        JSONObject out = new JSONObject();
        try {
            Account a = resolveAccount(new JSONObject(body));
            JSONObject imap = new JSONObject();
            JSONObject smtp = new JSONObject();
            try {
                javax.mail.Store st = connectImap(a);
                try {
                    Folder f = st.getFolder("INBOX");
                    f.open(Folder.READ_ONLY);
                    f.close(false);
                    imap.put("ok", true);
                } finally {
                    st.close();
                }
            } catch (Exception e) {
                imap.put("ok", false);
                imap.put("error", friendly(e));
            }
            try {
                Transport t = connectSmtp(a);
                t.close();
                smtp.put("ok", true);
            } catch (Exception e) {
                smtp.put("ok", false);
                smtp.put("error", friendly(e));
            }
            out.put("imap", imap);
            out.put("smtp", smtp);
        } catch (Exception e) {
            putError(out, e);
        }
        return out.toString();
    }

    /* ---------------- 收发 ---------------- */

    public synchronized String inboxJson(Map<String, String> q) {
        JSONObject out = new JSONObject();
        String accountId = value(q, "accountId");
        String folderName = value(q, "folder");
        if (folderName.isEmpty()) folderName = "INBOX";
        int limit = 40;
        try { limit = Math.min(100, Math.max(1, Integer.parseInt(value(q, "limit")))); } catch (Exception ignored) {}
        String query = value(q, "query");
        javax.mail.Store st = null;
        try {
            Account a = find(loadAccounts(), accountId);
            if (a == null) throw new Exception("没有这个邮箱账户");
            st = connectImap(a);
            Folder f = st.getFolder(folderName);
            f.open(Folder.READ_ONLY);
            try {
                int total = f.getMessageCount();
                Message[] messages;
                if (!query.isEmpty()) {
                    SearchTerm term = new OrTerm(new SubjectTerm(query), new FromStringTerm(query));
                    term = new OrTerm(term, new RecipientStringTerm(Message.RecipientType.TO, query));
                    Message[] found = f.search(term);
                    int start = Math.max(0, found.length - limit);
                    messages = new Message[found.length - start];
                    System.arraycopy(found, start, messages, 0, messages.length);
                } else {
                    int start = Math.max(1, total - limit + 1);
                    messages = total > 0 ? f.getMessages(start, total) : new Message[0];
                }
                if (!(f instanceof UIDFolder)) throw new Exception("邮件服务器不支持 UID");
                UIDFolder uf = (UIDFolder) f;
                JSONArray items = new JSONArray();
                for (int i = messages.length - 1; i >= 0; i--) {
                    Message m = messages[i];
                    JSONObject item = new JSONObject();
                    item.put("uid", uf.getUID(m));
                    item.put("subject", safe(m.getSubject()));
                    Address[] from = m.getFrom();
                    item.put("from", addressText(from));
                    item.put("fromAddress", addressAddress(from));
                    item.put("to", addressText(m.getRecipients(Message.RecipientType.TO)));
                    item.put("date", iso(m.getSentDate()));
                    item.put("seen", m.isSet(Flags.Flag.SEEN));
                    item.put("flagged", m.isSet(Flags.Flag.FLAGGED));
                    item.put("size", m.getSize());
                    items.put(item);
                }
                out.put("ok", true);
                out.put("total", total);
                out.put("items", items);
                out.put("folder", folderName);
            } finally {
                try { f.close(false); } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            putError(out, e);
        } finally {
            closeStore(st);
        }
        return out.toString();
    }

    public synchronized String messageJson(Map<String, String> q) {
        JSONObject out = new JSONObject();
        javax.mail.Store st = null;
        try {
            Account a = find(loadAccounts(), value(q, "accountId"));
            if (a == null) throw new Exception("没有这个邮箱账户");
            String folderName = value(q, "folder");
            if (folderName.isEmpty()) folderName = "INBOX";
            long uid = Long.parseLong(value(q, "uid"));
            st = connectImap(a);
            Folder f = st.getFolder(folderName);
            f.open(Folder.READ_WRITE);
            try {
                if (!(f instanceof UIDFolder)) throw new Exception("邮件服务器不支持 UID");
                Message m = ((UIDFolder) f).getMessageByUID(uid);
                if (m == null) throw new Exception("这封信不在了");
                MimeMessage mm = (MimeMessage) m;
                Parsed parsed = parse(mm);
                out.put("ok", true);
                out.put("subject", safe(mm.getSubject()));
                Address[] from = mm.getFrom();
                out.put("from", addressText(from));
                out.put("fromAddress", addressAddress(from));
                out.put("fromName", addressName(from));
                out.put("to", addressText(mm.getRecipients(Message.RecipientType.TO)));
                out.put("cc", addressText(mm.getRecipients(Message.RecipientType.CC)));
                out.put("date", iso(mm.getSentDate()));
                out.put("html", parsed.html);
                out.put("text", parsed.text);
                out.put("attachments", parsed.attachmentsJson());
                out.put("messageId", safe(mm.getMessageID()));
                try { mm.setFlag(Flags.Flag.SEEN, true); } catch (Exception ignored) {}
            } finally {
                try { f.close(false); } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            putError(out, e);
        } finally {
            closeStore(st);
        }
        return out.toString();
    }

    public synchronized AttachmentData attachment(Map<String, String> q) {
        javax.mail.Store st = null;
        try {
            Account a = find(loadAccounts(), value(q, "accountId"));
            if (a == null) return null;
            String folderName = value(q, "folder");
            if (folderName.isEmpty()) folderName = "INBOX";
            int index = Integer.parseInt(value(q, "index"));
            st = connectImap(a);
            Folder f = st.getFolder(folderName);
            f.open(Folder.READ_ONLY);
            try {
                if (!(f instanceof UIDFolder)) return null;
                Message m = ((UIDFolder) f).getMessageByUID(Long.parseLong(value(q, "uid")));
                if (m == null) return null;
                Parsed parsed = parse((MimeMessage) m);
                java.util.List<Attachment> list = parsed.attachments;
                if (index < 0 || index >= list.size()) return null;
                Attachment at = list.get(index);
                AttachmentData data = new AttachmentData();
                data.filename = at.filename;
                data.contentType = at.contentType;
                data.data = at.data;
                return data;
            } finally {
                try { f.close(false); } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            return null;
        } finally {
            closeStore(st);
        }
    }

    public synchronized String flagsJson(String body) {
        JSONObject out = new JSONObject();
        javax.mail.Store st = null;
        try {
            JSONObject req = new JSONObject(body);
            Account a = find(loadAccounts(), req.optString("accountId", ""));
            if (a == null) throw new Exception("没有这个邮箱账户");
            String folderName = req.optString("folder", "INBOX");
            st = connectImap(a);
            Folder f = st.getFolder(folderName);
            f.open(Folder.READ_WRITE);
            try {
                Message m = ((UIDFolder) f).getMessageByUID(req.optLong("uid"));
                if (m == null) throw new Exception("这封信不在了");
                if (req.has("seen")) m.setFlag(Flags.Flag.SEEN, req.optBoolean("seen"));
                if (req.has("flagged")) m.setFlag(Flags.Flag.FLAGGED, req.optBoolean("flagged"));
                out.put("ok", true);
            } finally {
                try { f.close(false); } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            putError(out, e);
        } finally {
            closeStore(st);
        }
        return out.toString();
    }

    public synchronized String sendJson(String body) {
        JSONObject out = new JSONObject();
        try {
            JSONObject req = new JSONObject(body);
            Account a = find(loadAccounts(), req.optString("accountId", ""));
            if (a == null) throw new Exception("还没有配置发件账户");
            if (a.smtpHost == null || a.smtpHost.isEmpty()) throw new Exception("还没有配置发件服务器（SMTP）");
            String to = req.optString("to", "");
            if (to.trim().isEmpty()) throw new Exception("缺少收件人");
            Session session = smtpSession(a);
            MimeMessage message = new MimeMessage(session);
            String fromEmail = a.email == null || a.email.isEmpty() ? a.smtpUser : a.email;
            if (a.smtpFrom != null && !a.smtpFrom.isEmpty()) {
                message.setFrom(new InternetAddress(fromEmail, a.smtpFrom, "UTF-8"));
            } else {
                message.setFrom(new InternetAddress(fromEmail));
            }
            message.setRecipients(Message.RecipientType.TO, InternetAddress.parse(to));
            String cc = req.optString("cc", "");
            if (cc != null && !cc.trim().isEmpty()) {
                message.setRecipients(Message.RecipientType.CC, InternetAddress.parse(cc));
            }
            message.setSubject(req.optString("subject", "(无主题)"), "UTF-8");
            String text = req.optString("text", "");
            String html = req.optString("html", "");

            MimeMultipart root = new MimeMultipart("mixed");
            MimeBodyPart bodyPart = new MimeBodyPart();
            MimeMultipart alt = new MimeMultipart("alternative");
            if (!text.isEmpty()) {
                MimeBodyPart textPart = new MimeBodyPart();
                textPart.setText(text, "UTF-8");
                alt.addBodyPart(textPart);
            }
            if (!html.isEmpty()) {
                MimeBodyPart htmlPart = new MimeBodyPart();
                htmlPart.setContent(html, "text/html; charset=UTF-8");
                alt.addBodyPart(htmlPart);
            }
            bodyPart.setContent(alt);
            root.addBodyPart(bodyPart);

            JSONArray files = req.optJSONArray("attachments");
            if (files != null) {
                for (int i = 0; i < files.length(); i++) {
                    JSONObject f = files.optJSONObject(i);
                    if (f == null) continue;
                    String b64 = f.optString("contentBase64", "");
                    if (b64.isEmpty()) continue;
                    byte[] data = Base64Compat.decode(b64);
                    MimeBodyPart part = new MimeBodyPart();
                    String ctype = f.optString("contentType", "application/octet-stream");
                    part.setDataHandler(new DataHandler(new ByteArrayDataSource(data, ctype)));
                    part.setFileName(f.optString("filename", "附件"));
                    root.addBodyPart(part);
                }
            }
            message.setContent(root);
            String protocol = a.smtpSecure ? "smtps" : "smtp";
            Transport transport = session.getTransport(protocol);
            try {
                transport.connect(a.smtpHost, a.smtpPort, a.smtpUser, a.smtpPass);
                transport.sendMessage(message, message.getAllRecipients());
            } finally {
                try { transport.close(); } catch (Exception ignored) {}
            }
            out.put("ok", true);
            out.put("messageId", safe(message.getMessageID()));
            out.put("accepted", new JSONArray());
            out.put("rejected", new JSONArray());
            out.put("response", "sent");
        } catch (Exception e) {
            putError(out, e);
        }
        return out.toString();
    }

    /* ---------------- 连接 ---------------- */

    private javax.mail.Store connectImap(Account a) throws Exception {
        if (a.imapHost == null || a.imapHost.isEmpty()) throw new Exception("没有填写 IMAP 服务器");
        String proto = a.imapSecure ? "imaps" : "imap";
        Properties p = baseProps();
        p.put("mail.store.protocol", proto);
        p.put("mail." + proto + ".host", a.imapHost);
        p.put("mail." + proto + ".port", String.valueOf(a.imapPort));
        p.put("mail." + proto + ".ssl.enable", String.valueOf(a.imapSecure));
        p.put("mail." + proto + ".ssl.trust", "*");
        p.put("mail." + proto + ".connectiontimeout", "15000");
        p.put("mail." + proto + ".timeout", "30000");
        p.put("mail." + proto + ".writetimeout", "30000");
        p.put("mail." + proto + ".peek", "true");
        Session session = newSession(p);
        javax.mail.Store st = session.getStore(proto);
        st.connect(a.imapHost, a.imapPort, a.imapUser, a.imapPass);
        // QQ / 163 等国内 IMAP 要求客户端先发 ID；不支持 ID 的服务器会忽略这个错误
        try {
            Map<String, String> id = new HashMap<>();
            id.put(IMAPStore.ID_NAME, "DanLume");
            id.put(IMAPStore.ID_VERSION, "1.1.1");
            id.put(IMAPStore.ID_VENDOR, "DanLume");
            id.put(IMAPStore.ID_SUPPORT_URL, "https://danlume.local");
            ((IMAPStore) st).id(id);
        } catch (Exception ignored) {
        }
        return st;
    }

    private Session smtpSession(Account a) {
        String proto = a.smtpSecure ? "smtps" : "smtp";
        Properties p = baseProps();
        p.put("mail." + proto + ".host", a.smtpHost);
        p.put("mail." + proto + ".port", String.valueOf(a.smtpPort));
        p.put("mail." + proto + ".auth", "true");
        p.put("mail." + proto + ".ssl.enable", String.valueOf(a.smtpSecure));
        if (!a.smtpSecure) p.put("mail." + proto + ".starttls.enable", "true");
        p.put("mail." + proto + ".ssl.trust", "*");
        p.put("mail." + proto + ".connectiontimeout", "15000");
        p.put("mail." + proto + ".timeout", "30000");
        p.put("mail." + proto + ".writetimeout", "30000");
        return newSession(p);
    }

    /** APK 里没有 META-INF 服务资源，显式注册 JavaMail 的 IMAP/SMTP Provider。 */
    private static Session newSession(Properties p) {
        ensureMailcap();
        Session s = Session.getInstance(p);
        try { s.setProvider(new IMAPProvider()); } catch (Exception ignored) {}
        try { s.setProvider(new IMAPSSLProvider()); } catch (Exception ignored) {}
        try { s.setProvider(new SMTPProvider()); } catch (Exception ignored) {}
        try { s.setProvider(new SMTPSSLProvider()); } catch (Exception ignored) {}
        return s;
    }

    private Transport connectSmtp(Account a) throws Exception {
        if (a.smtpHost == null || a.smtpHost.isEmpty()) throw new Exception("没有填写 SMTP 服务器");
        String proto = a.smtpSecure ? "smtps" : "smtp";
        Session session = smtpSession(a);
        Transport t = session.getTransport(proto);
        t.connect(a.smtpHost, a.smtpPort, a.smtpUser, a.smtpPass);
        return t;
    }

    private Properties baseProps() {
        Properties p = new Properties();
        p.put("mail.mime.decodetext.strict", "false");
        p.put("mail.mime.charset", "UTF-8");
        p.put("mail.mime.encodefilename", "true");
        p.put("mail.mime.decodefilename", "true");
        return p;
    }

    private static void closeStore(javax.mail.Store st) {
        if (st != null) {
            try { st.close(); } catch (Exception ignored) {}
        }
    }

    /* ---------------- 解析 ---------------- */

    private static class Attachment {
        String filename;
        String contentType;
        String cid;
        boolean inline;
        byte[] data;
    }

    private static class Parsed {
        String html = "";
        String text = "";
        final List<Attachment> attachments = new ArrayList<>();
        final Map<String, String> inlineData = new HashMap<>();

        JSONArray attachmentsJson() throws Exception {
            JSONArray arr = new JSONArray();
            for (int i = 0; i < attachments.size(); i++) {
                Attachment a = attachments.get(i);
                JSONObject j = new JSONObject();
                j.put("index", i);
                j.put("filename", a.filename);
                j.put("contentType", a.contentType);
                j.put("size", a.data == null ? 0 : a.data.length);
                j.put("cid", a.cid == null ? JSONObject.NULL : a.cid);
                j.put("inline", a.inline);
                arr.put(j);
            }
            return arr;
        }
    }

    private Parsed parse(MimeMessage message) throws Exception {
        Parsed out = new Parsed();
        walk(message, out, 0);
        if (!out.html.isEmpty() && !out.inlineData.isEmpty()) {
            String html = out.html;
            for (Map.Entry<String, String> e : out.inlineData.entrySet()) {
                html = Pattern.compile("cid:" + Pattern.quote(e.getKey()), Pattern.CASE_INSENSITIVE)
                        .matcher(html).replaceAll(Matcher.quoteReplacement(e.getValue()));
            }
            out.html = html;
        }
        if (out.text.isEmpty() && !out.html.isEmpty()) {
            out.text = out.html.replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").trim();
        }
        return out;
    }

    private void walk(Part part, Parsed out, int depth) throws Exception {
        if (part == null || depth > 12) return;
        if (part.isMimeType("multipart/*")) {
            Object content = part.getContent();
            if (content instanceof Multipart) {
                Multipart mp = (Multipart) content;
                for (int i = 0; i < mp.getCount(); i++) walk(mp.getBodyPart(i), out, depth + 1);
            }
            return;
        }
        if (part.isMimeType("message/rfc822")) {
            Object content = part.getContent();
            if (content instanceof Part) walk((Part) content, out, depth + 1);
            return;
        }
        String disposition = part.getDisposition();
        String filename = decode(part.getFileName());
        boolean attachment = Part.ATTACHMENT.equalsIgnoreCase(disposition) || filename != null;
        if (attachment) {
            byte[] data = readBytes(part.getInputStream());
            String cid = contentId(part);
            boolean inline = cid != null || Part.INLINE.equalsIgnoreCase(disposition);
            Attachment at = new Attachment();
            at.filename = filename == null || filename.isEmpty() ? ("附件" + (out.attachments.size() + 1)) : filename;
            at.contentType = part.getContentType();
            at.cid = cid;
            at.inline = inline;
            at.data = data;
            out.attachments.add(at);
            if (inline && cid != null) {
                String base = at.contentType.split(";")[0].trim();
                out.inlineData.put(cid, "data:" + base + ";base64," + Base64Compat.encode(data));
            }
            return;
        }
        if (part.isMimeType("text/html")) {
            String s = textOf(part);
            if (out.html.isEmpty()) out.html = s;
            return;
        }
        if (part.isMimeType("text/plain")) {
            String s = textOf(part);
            if (out.text.isEmpty()) out.text = s;
        }
    }

    private String textOf(Part part) throws Exception {
        Object content = part.getContent();
        if (content instanceof String) return (String) content;
        if (content instanceof InputStream) {
            return new String(readBytes((InputStream) content), "UTF-8");
        }
        return String.valueOf(content);
    }

    private static String contentId(Part part) {
        try {
            String[] ids = part.getHeader("Content-ID");
            if (ids == null || ids.length == 0) return null;
            String id = ids[0];
            if (id != null) {
                id = id.trim();
                if (id.startsWith("<") && id.endsWith(">")) id = id.substring(1, id.length() - 1);
            }
            return id;
        } catch (Exception e) {
            return null;
        }
    }

    private static byte[] readBytes(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        int total = 0;
        while ((n = in.read(buf)) != -1) {
            total += n;
            if (total > MAX_BODY) break;
            out.write(buf, 0, n);
        }
        in.close();
        return out.toByteArray();
    }

    private static String decode(String s) {
        if (s == null) return null;
        try { return MimeUtility.decodeText(s); } catch (Exception e) { return s; }
    }

    /* ---------------- 工具 ---------------- */

    private static String value(Map<String, String> q, String key) {
        String v = q.get(key);
        return v == null ? "" : v;
    }

    private static String safe(String s) {
        return s == null ? "" : s;
    }

    private static String addressText(Address[] list) {
        if (list == null) return "";
        StringBuilder sb = new StringBuilder();
        for (Address a : list) {
            if (sb.length() > 0) sb.append(", ");
            if (a instanceof InternetAddress) {
                InternetAddress ia = (InternetAddress) a;
                String name = decode(ia.getPersonal());
                if (name != null && !name.isEmpty()) sb.append(name).append(" <").append(ia.getAddress()).append(">");
                else sb.append(ia.getAddress());
            } else {
                sb.append(a.toString());
            }
        }
        return sb.toString();
    }

    private static String addressAddress(Address[] list) {
        if (list == null || list.length == 0) return "";
        for (Address a : list) {
            if (a instanceof InternetAddress) return safe(((InternetAddress) a).getAddress());
        }
        return safe(list[0].toString());
    }

    private static String addressName(Address[] list) {
        if (list == null || list.length == 0) return "";
        if (list[0] instanceof InternetAddress) {
            String name = decode(((InternetAddress) list[0]).getPersonal());
            return name == null ? "" : name;
        }
        return "";
    }

    private static String iso(Date date) {
        if (date == null) date = new Date();
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(date);
    }

    private static void putError(JSONObject out, Exception e) {
        try {
            out.put("ok", false);
            out.put("error", friendly(e));
        } catch (Exception ignored) {}
    }

    private static String friendly(Exception e) {
        Throwable t = e;
        String text = "";
        while (t != null) {
            if (t.getMessage() != null && !t.getMessage().isEmpty()) text = t.getMessage();
            if (t instanceof AuthenticationFailedException) {
                return "登录被服务器拒绝：请确认账号与授权码（QQ/163 要用授权码，不是网页密码）";
            }
            if (t instanceof UnknownHostException) return "找不到邮件服务器：检查地址是否写错";
            if (t instanceof SocketTimeoutException) return "连接超时：检查网络、服务器地址和端口";
            if (t instanceof ConnectException) return "服务器拒绝连接：端口可能不对，或被网络拦截";
            if (t instanceof CertificateException) return "TLS 证书校验失败：确认端口与加密方式";
            t = t.getCause();
        }
        String lower = text.toLowerCase();
        if (lower.contains("authentication") || lower.contains("535") || lower.contains("auth")) {
            return "登录被服务器拒绝：请确认账号与授权码（QQ/163 要用授权码，不是网页密码）";
        }
        if (text.contains("timed out") || lower.contains("timeout")) return "连接超时：检查网络、服务器地址和端口";
        return text.isEmpty() ? e.getClass().getSimpleName() : text;
    }

    /** 少量 Base64，避免依赖 API 26 的 java.util.Base64（测试环境也一致） */
    static final class Base64Compat {
        private static final char[] CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();
        static String encode(byte[] data) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < data.length; i += 3) {
                int b0 = data[i] & 0xff;
                int b1 = i + 1 < data.length ? data[i + 1] & 0xff : 0;
                int b2 = i + 2 < data.length ? data[i + 2] & 0xff : 0;
                sb.append(CHARS[b0 >> 2]);
                sb.append(CHARS[((b0 & 3) << 4) | (b1 >> 4)]);
                sb.append(i + 1 < data.length ? CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=');
                sb.append(i + 2 < data.length ? CHARS[b2 & 63] : '=');
            }
            return sb.toString();
        }
        static byte[] decode(String text) {
            String s = text.replaceAll("\\s", "");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            int[] buf = new int[4];
            int count = 0;
            for (int i = 0; i < s.length(); i++) {
                char ch = s.charAt(i);
                int v;
                if (ch >= 'A' && ch <= 'Z') v = ch - 'A';
                else if (ch >= 'a' && ch <= 'z') v = ch - 'a' + 26;
                else if (ch >= '0' && ch <= '9') v = ch - '0' + 52;
                else if (ch == '+') v = 62;
                else if (ch == '/') v = 63;
                else if (ch == '=') v = -1;
                else continue;
                buf[count++] = v;
                if (count == 4) {
                    out.write((buf[0] << 2) | (buf[1] >> 4));
                    if (buf[2] >= 0) out.write(((buf[1] & 15) << 4) | (buf[2] >> 2));
                    if (buf[3] >= 0) out.write(((buf[2] & 3) << 6) | buf[3]);
                    count = 0;
                }
            }
            return out.toByteArray();
        }
    }
}
