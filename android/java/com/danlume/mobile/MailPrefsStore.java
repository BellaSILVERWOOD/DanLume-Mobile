package com.danlume.mobile;

import android.content.Context;
import android.content.SharedPreferences;

/** 邮箱账户存私有 SharedPreferences，整段 JSON 用 Keystore AES-GCM 加密。 */
public class MailPrefsStore implements MailService.AccountStore {
    private final SharedPreferences prefs;

    public MailPrefsStore(Context context) {
        prefs = context.getSharedPreferences("danlume_mail", Context.MODE_PRIVATE);
    }

    @Override
    public String load() {
        String raw = prefs.getString("accounts", "");
        if (raw == null || raw.isEmpty()) return "[]";
        String plain = SecureBox.decrypt(raw);
        return plain == null || plain.isEmpty() ? "[]" : plain;
    }

    @Override
    public boolean save(String json) {
        String enc = SecureBox.encrypt(json == null ? "[]" : json);
        if (enc == null) return false;
        return prefs.edit().putString("accounts", enc).commit();
    }
}
