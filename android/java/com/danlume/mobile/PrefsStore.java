package com.danlume.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 用 Android Keystore 里的 AES 密钥加密保存复旦学号/密码。
 * 保存后下次启动可以静默重新登录，用户不用反复输入。
 */
public class PrefsStore implements FudanAuth.CredentialStore {
    private static final String PREF = "danlume_fudan";
    private static final String KEY_ALIAS = "danlume_fudan_key";
    private static final String K_USER = "fudan_user";
    private static final String K_PASS = "fudan_pass";

    private final SharedPreferences prefs;

    public PrefsStore(Context context) {
        prefs = context.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    @Override
    public String[] load() {
        String user = prefs.getString(K_USER, "");
        String enc = prefs.getString(K_PASS, "");
        if (user == null || user.isEmpty() || enc == null || enc.isEmpty()) return null;
        try {
            String pass = decrypt(enc);
            if (pass == null || pass.isEmpty()) return null;
            return new String[]{ user, pass };
        } catch (Exception e) {
            clear();
            return null;
        }
    }

    @Override
    public void save(String username, String password) {
        try {
            String enc = encrypt(password);
            if (enc == null) return;
            prefs.edit().putString(K_USER, username).putString(K_PASS, enc).apply();
        } catch (Exception ignored) {
        }
    }

    @Override
    public void clear() {
        prefs.edit().remove(K_USER).remove(K_PASS).apply();
    }

    private SecretKey getKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(KEY_ALIAS)) {
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build());
            kg.generateKey();
        }
        return (SecretKey) ks.getKey(KEY_ALIAS, null);
    }

    private String encrypt(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getKey());
        byte[] iv = cipher.getIV();
        byte[] data = cipher.doFinal(plain.getBytes("UTF-8"));
        return Base64.encodeToString(iv, Base64.NO_WRAP) + "." + Base64.encodeToString(data, Base64.NO_WRAP);
    }

    private String decrypt(String payload) throws Exception {
        int dot = payload.indexOf('.');
        if (dot <= 0) return null;
        byte[] iv = Base64.decode(payload.substring(0, dot), Base64.NO_WRAP);
        byte[] data = Base64.decode(payload.substring(dot + 1), Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(data), "UTF-8");
    }
}
