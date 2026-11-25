package com.bizflowjewelry.backend.foundation;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import java.util.List;

@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
class ApiSecurity {
    private static final String[] SALES_ROUTES = {"/api/v1/sales", "/api/v1/sales/**", "/api/v1/customers", "/api/v1/customers/**",
            "/api/v1/online-orders", "/api/v1/online-orders/**", "/api/v1/financial-accounts", "/api/v1/financial-accounts/**"};
    private static final String[] FINANCE_ROUTES = {"/api/v1/expenses", "/api/v1/expenses/**", "/api/v1/expense-categories",
            "/api/v1/expense-categories/**", "/api/v1/finance/**", "/api/v1/suppliers/**"};

    @Bean
    SecurityFilterChain foundationSecurity(HttpSecurity http) throws Exception {
        var converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> List.of(new SimpleGrantedAuthority("ROLE_OWNER")));
        return http.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(cache -> cache.disable())
                // These routes authenticate through an explicit Authorization header, never cookies.
                .csrf(csrf -> csrf.ignoringRequestMatchers("/api/v1/auth/**", "/api/v1/products", "/api/v1/products/**",
                        "/api/v1/product-families", "/api/v1/product-families/**", "/api/v1/inventory/**",
                        "/api/v1/purchases", "/api/v1/purchases/**", "/api/v1/shipments", "/api/v1/shipments/**", "/api/v1/procurement-contacts")
                        .ignoringRequestMatchers(SALES_ROUTES).ignoringRequestMatchers(FINANCE_ROUTES).ignoringRequestMatchers("/api/v1/settings"))
                .oauth2ResourceServer(oauth -> oauth.jwt(jwt -> jwt.jwtAuthenticationConverter(converter)))
                .authorizeHttpRequests(requests -> requests
                .requestMatchers(HttpMethod.GET, "/api/health/live", "/api/health/ready").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/v1/auth/login", "/api/v1/auth/forgot-password",
                        "/api/v1/auth/verify-reset", "/api/v1/auth/reset-password", "/api/v1/auth/browser-login",
                        "/api/v1/auth/browser-refresh", "/api/v1/auth/browser-logout").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/v1/auth/me").hasRole("OWNER")
                .requestMatchers(HttpMethod.POST, "/api/v1/auth/logout").hasRole("OWNER")
                .requestMatchers("/api/v1/products", "/api/v1/products/**",
                        "/api/v1/product-families", "/api/v1/product-families/**", "/api/v1/inventory/**",
                        "/api/v1/purchases", "/api/v1/purchases/**", "/api/v1/shipments", "/api/v1/shipments/**", "/api/v1/procurement-contacts").hasRole("OWNER")
                .requestMatchers(SALES_ROUTES).hasRole("OWNER")
                .requestMatchers(FINANCE_ROUTES).hasRole("OWNER")
                .requestMatchers("/api/v1/settings").hasRole("OWNER")
                .requestMatchers(HttpMethod.GET,"/api/v1/reports/**").hasRole("OWNER")
                .anyRequest().denyAll()).build();
    }

    @Bean
    InMemoryUserDetailsManager foundationUsers() {
        return new InMemoryUserDetailsManager();
    }
}
