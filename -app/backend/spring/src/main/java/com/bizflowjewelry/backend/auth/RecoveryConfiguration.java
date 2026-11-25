package com.bizflowjewelry.backend.auth;

import jakarta.mail.internet.InternetAddress;
import java.util.concurrent.Executor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration(proxyBeanMethods = false)
class RecoveryConfiguration {
    @Bean
    Executor recoveryExecutor() {
        var executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(30);
        executor.setThreadNamePrefix("owner-recovery-");
        return executor;
    }

    @Bean
    @ConditionalOnProperty(name = "bizflow.auth.mail.enabled", havingValue = "true")
    RecoveryDelivery smtpRecoveryDelivery(AuthOrigin origin,
            @Value("${bizflow.auth.mail.host}") String host, @Value("${bizflow.auth.mail.port}") int port,
            @Value("${bizflow.auth.mail.tls}") String tls, @Value("${bizflow.auth.mail.username}") String user,
            @Value("${bizflow.auth.mail.password}") String password, @Value("${bizflow.auth.mail.from}") String from) {
        if (!origin.https() || host.isBlank() || user.isBlank() || password.isBlank()
                || !(tls.equals("implicit") || tls.equals("starttls")) || port < 1 || port > 65535) {
            throw new IllegalStateException("SMTP recovery requires a trusted HTTPS origin, credentials and TLS.");
        }
        try {
            new InternetAddress(from, true).validate();
        } catch (jakarta.mail.internet.AddressException ignored) {
            throw new IllegalStateException("Set a valid SMTP sender address.");
        }
        var sender = new JavaMailSenderImpl();
        sender.setHost(host);
        sender.setPort(port);
        sender.setUsername(user);
        sender.setPassword(password);
        var settings = sender.getJavaMailProperties();
        settings.setProperty("mail.smtp.auth", "true");
        settings.setProperty("mail.smtp.ssl.enable", Boolean.toString(tls.equals("implicit")));
        settings.setProperty("mail.smtp.ssl.checkserveridentity", "true");
        settings.setProperty("mail.smtp.starttls.enable", Boolean.toString(tls.equals("starttls")));
        settings.setProperty("mail.smtp.starttls.required", Boolean.toString(tls.equals("starttls")));
        settings.setProperty("mail.smtp.connectiontimeout", "5000");
        settings.setProperty("mail.smtp.timeout", "10000");
        settings.setProperty("mail.smtp.writetimeout", "10000");
        return (email, link) -> {
            var message = new SimpleMailMessage();
            message.setFrom(from);
            message.setTo(email);
            message.setSubject("Reset your BizFlow Jewelry password");
            message.setText("BizFlow Jewelry\n\nUse this link to reset your password:\n" + link
                    + "\n\nThe link expires in 30 minutes. If you did not request it, ignore this message.");
            sender.send(message);
        };
    }
}
