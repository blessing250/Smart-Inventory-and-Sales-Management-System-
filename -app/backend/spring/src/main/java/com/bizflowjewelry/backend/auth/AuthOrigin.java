package com.bizflowjewelry.backend.auth;

import java.net.URI;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class AuthOrigin {
    private final URI app;
    private final String origin;
    private final String resetPath;

    AuthOrigin(@Value("${bizflow.auth.app-url}") String url,
               @Value("${bizflow.auth.reset-path:/reset-password}") String resetPath) {
        if(!java.util.Set.of("/reset-password","/staging/reset-password").contains(resetPath)) {
            throw new IllegalStateException("Choose a supported password recovery path.");
        }
        this.resetPath=resetPath;
        app = URI.create(url);
        boolean loopback = "localhost".equals(app.getHost()) || "127.0.0.1".equals(app.getHost())
                || "[::1]".equals(app.getHost());
        if (app.getHost() == null || app.getUserInfo() != null || app.getQuery() != null || app.getFragment() != null
                || !(app.getPath().isEmpty() || "/".equals(app.getPath()))
                || !("https".equals(app.getScheme()) || loopback && "http".equals(app.getScheme()))) {
            throw new IllegalStateException("Set a trusted application origin. HTTP is only supported on loopback.");
        }
        boolean defaultPort = app.getPort() == ("https".equals(app.getScheme()) ? 443 : 80);
        origin = app.getScheme() + "://" + app.getHost()
                + (app.getPort() < 0 || defaultPort ? "" : ":" + app.getPort());
    }

    public boolean allows(HttpServletRequest request) {
        String provided = request.getHeader("Origin");
        return !"cross-site".equalsIgnoreCase(request.getHeader("Sec-Fetch-Site"))
                && (provided == null || origin.equals(provided));
    }

    boolean https() { return "https".equals(app.getScheme()); }
    boolean browserAllows(HttpServletRequest request) { return origin.equals(request.getHeader("Origin")) && allows(request); }

    URI resetLink(String token) {
        return app.resolve(resetPath + "#" + token);
    }
}
