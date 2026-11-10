package com.danlume.mobile;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Android Keystore 的 AES-GCM 小封装：邮箱账号整段 JSON 加密后落盘。 */
public final class SecureBox {
    private static final String ALIAS = "danlume_secure_v1";
    private static final String TRANSFORM = "AES/GCM/NoPadding";

    private SecureBox() {
    }

    private static synchronized SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build();
            kg.init(spec);
            kg.generateKey();
        }
        return (SecretKey) ks.getKey(ALIAS, null);
    }

    public static synchronized String encrypt(String plain) {
        if (plain == null) return null;
        try {
            // AndroidKeyStore 默认 setRandomizedEncryptionRequired(true)：
            // IV 必须由 Cipher 生成，不能自己传，否则会抛 InvalidAlgorithmParameterException。
            Cipher c = Cipher.getInstance(TRANSFORM);
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = c.getIV();
            byte[] ct = c.doFinal(plain.getBytes("UTF-8"));
            return "v1:" + Base64.encodeToString(iv, Base64.NO_WRAP) + ":"
                    + Base64.encodeToString(ct, Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    public static synchronized String decrypt(String payload) {
        if (payload == null || payload.isEmpty()) return "";
        try {
            String[] parts = payload.split(":", 3);
            if (parts.length != 3 || !"v1".equals(parts[0])) return null;
            byte[] iv = Base64.decode(parts[1], Base64.NO_WRAP);
            byte[] ct = Base64.decode(parts[2], Base64.NO_WRAP);
            Cipher c = Cipher.getInstance(TRANSFORM);
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            return new String(c.doFinal(ct), "UTF-8");
        } catch (Exception e) {
            return null;
        }
    }
}
