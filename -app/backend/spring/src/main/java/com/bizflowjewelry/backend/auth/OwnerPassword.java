package com.bizflowjewelry.backend.auth;

import java.nio.charset.StandardCharsets;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

@Component
class OwnerPassword {
    private final BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder(12);

    boolean canVerify(String password) {
        return password != null && !password.isEmpty() && password.getBytes(StandardCharsets.UTF_8).length <= 72;
    }

    boolean meetsPolicy(String password) {
        return canVerify(password) && password.length() >= 12;
    }

    String hash(String password) {
        return bcrypt.encode(password);
    }

    boolean matches(String password, String hash) {
        return canVerify(password) && bcrypt.matches(password, hash);
    }
}
