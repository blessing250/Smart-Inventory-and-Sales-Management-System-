package com.bizflowjewelry.backend.auth;

import jakarta.mail.internet.InternetAddress;
import java.util.Arrays;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Component;
import org.springframework.web.context.WebApplicationContext;

@Component
@ConditionalOnProperty(name = "bizflow.auth.admin")
class OwnerAdminCommand implements ApplicationRunner {
    private final ApplicationContext context;
    private final AuthStore store;
    private final OwnerPassword password;
    private final String action;
    private final boolean verified;

    OwnerAdminCommand(ApplicationContext context, AuthStore store, OwnerPassword password,
            @Value("${bizflow.auth.admin}") String action, @Value("${bizflow.auth.verify-mailbox:false}") boolean verified) {
        this.context = context;
        this.store = store;
        this.password = password;
        this.action = action;
        this.verified = verified;
    }

    @Override
    public void run(ApplicationArguments arguments) {
        var console = System.console();
        if (context instanceof WebApplicationContext || console == null || !"false".equals(
                context.getEnvironment().getProperty("bizflow.auth.mail.enabled"))) {
            throw new IllegalStateException("Use a private non-web console with SMTP disabled for owner administration.");
        }
        if (!action.equals("provision") && !action.equals("recover")) {
            throw new IllegalStateException("Choose the provision or recover owner command.");
        }
        String email = null;
        String name = null;
        if (action.equals("provision")) {
            email = normalizedAddress(console.readLine("Owner email: "));
            name = console.readLine("Owner name: ");
            if (name == null || name.isBlank() || name.trim().length() > 150) {
                throw new IllegalStateException("Enter an owner name up to 150 characters.");
            }
        }
        char[] entered = console.readPassword("New owner password: ");
        char[] confirmed = console.readPassword("Confirm owner password: ");
        try {
            if (entered == null || confirmed == null || !Arrays.equals(entered, confirmed)
                    || !password.meetsPolicy(new String(entered))) {
                throw new IllegalStateException("Use a matching password with at least 12 characters and at most 72 UTF-8 bytes.");
            }
            String hash = password.hash(new String(entered));
            if (action.equals("provision")) store.provision(email, name.trim(), hash, verified);
            else store.recoverOffline(hash);
            console.writer().println("Owner administration completed.");
        } finally {
            if (entered != null) Arrays.fill(entered, '\0');
            if (confirmed != null) Arrays.fill(confirmed, '\0');
        }
    }

    private static String normalizedAddress(String input) {
        if (input != null && input.trim().length() <= 254) {
            String email = OwnerAuthentication.normalizeEmail(input);
            try {
                var address = new InternetAddress(email, true);
                address.validate();
                if (email.equals(address.getAddress())) return email;
            } catch (jakarta.mail.internet.AddressException ignored) {
                // Report only a generic validation error.
            }
        }
        throw new IllegalStateException("Enter a valid owner email address.");
    }
}
