package com.bizflowjewelry.backend.auth;

import java.util.Map;
import java.util.UUID;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.dao.DataAccessException;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(path = "/api/v1/auth", produces = MediaType.APPLICATION_JSON_VALUE)
class OwnerAuthController {
    private static final String REFRESH="bizflow_spring_refresh";
    private final OwnerAuthentication auth;
    private final OwnerRecovery recovery;
    private final AuthStore store;
    private final AuthRateLimit limit;
    private final AuthOrigin origin;
    private final OwnerPassword password;

    OwnerAuthController(OwnerAuthentication auth, OwnerRecovery recovery, AuthStore store, AuthRateLimit limit,
            AuthOrigin origin, OwnerPassword password) {
        this.auth = auth;
        this.recovery = recovery;
        this.store = store;
        this.limit = limit;
        this.origin = origin;
        this.password = password;
    }

    record Login(@NotBlank @Email @Size(max = 254) String email, @NotNull @Size(max = 72) String password) {
        @Override public String toString() { return "Owner sign-in request"; }
    }
    record Forgot(@NotBlank @Email @Size(max = 254) String email) {}
    record Verify(@NotBlank @Size(max = 43) String token) {
        @Override public String toString() { return "Owner reset verification request"; }
    }
    record Reset(@NotBlank @Size(max = 43) String token, @NotNull @Size(max = 72) String password,
                 @NotNull @Size(max = 72) String confirmation) {
        @Override public String toString() { return "Owner reset submission"; }
    }
    record Profile(String id, String email, String name, String role) {}

    @PostMapping(path = "/login", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> login(@Valid @RequestBody Login form, HttpServletRequest request) {
        var rejection = check(request, AuthRateLimit.Action.LOGIN);
        if (rejection != null) return rejection;
        var token = auth.login(form.email(), form.password());
        if (token == null) return error(HttpStatus.UNAUTHORIZED, "Invalid email or password.");
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(token);
    }

    @GetMapping("/me")
    ResponseEntity<?> profile(@AuthenticationPrincipal Jwt jwt) {
        var owner = store.findById(jwt.getSubject());
        if (owner == null || !owner.active()) return error(HttpStatus.UNAUTHORIZED, "Authentication required.");
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new Profile(owner.id(), owner.email(), owner.name(), "OWNER"));
    }

    @PostMapping(path="/browser-login",consumes=MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> browserLogin(@Valid @RequestBody Login form,HttpServletRequest request) {
        if(!origin.browserAllows(request)) return error(HttpStatus.FORBIDDEN,"Invalid request origin.");
        var rejection=check(request,AuthRateLimit.Action.LOGIN);
        if(rejection!=null) return rejection;
        return browserResponse(auth.login(form.email(),form.password(),true));
    }

    @PostMapping("/browser-refresh")
    ResponseEntity<?> refresh(@CookieValue(name=REFRESH,required=false) String refresh,HttpServletRequest request) {
        if(!origin.browserAllows(request)) return error(HttpStatus.FORBIDDEN,"Invalid request origin.");
        var rejection=check(request,AuthRateLimit.Action.REFRESH);
        if(rejection!=null) return rejection;
        return browserResponse(auth.refresh(refresh));
    }

    @PostMapping("/browser-logout")
    ResponseEntity<?> browserLogout(@CookieValue(name=REFRESH,required=false) String refresh,HttpServletRequest request) {
        if(!origin.browserAllows(request)) return error(HttpStatus.FORBIDDEN,"Invalid request origin.");
        auth.revoke(refresh);
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE,cookie("",0)).cacheControl(CacheControl.noStore()).build();
    }

    private ResponseEntity<?> browserResponse(OwnerAuthentication.BrowserToken token) {
        if(token==null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .cacheControl(CacheControl.noStore()).body(Map.of("error","Sign in again to continue."));
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE,cookie(token.refresh(),OwnerAuthentication.BROWSER_SECONDS))
                .cacheControl(CacheControl.noStore()).body(token.token());
    }

    private String cookie(String value,long age) {
        return ResponseCookie.from(REFRESH,value).httpOnly(true).secure(origin.https()).sameSite("Strict")
                .path("/spring/api/v1/auth").maxAge(age).build().toString();
    }

    @PostMapping("/logout")
    ResponseEntity<?> logout(@AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        if (!origin.allows(request)) return error(HttpStatus.FORBIDDEN, "Invalid request origin.");
        store.logout(jwt.getSubject(), UUID.fromString(jwt.getId()));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @PostMapping(path = "/forgot-password", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> forgot(@Valid @RequestBody Forgot form, HttpServletRequest request) {
        var rejection = check(request, AuthRateLimit.Action.FORGOT);
        if (rejection != null) return rejection;
        if (!recovery.available()) return error(HttpStatus.SERVICE_UNAVAILABLE, "Email recovery is unavailable.");
        recovery.request(form.email());
        return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).body(Map.of("message",
                "If an account exists for this email address, password reset instructions will be sent."));
    }

    @PostMapping(path = "/verify-reset", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> verify(@Valid @RequestBody Verify form, HttpServletRequest request) {
        var rejection = check(request, AuthRateLimit.Action.VERIFY);
        if (rejection != null) return rejection;
        return resetResult(recovery.valid(form.token()));
    }

    @PostMapping(path = "/reset-password", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> reset(@Valid @RequestBody Reset form, HttpServletRequest request) {
        var rejection = check(request, AuthRateLimit.Action.RESET);
        if (rejection != null) return rejection;
        if (!password.meetsPolicy(form.password()) || !form.password().equals(form.confirmation())) {
            return error(HttpStatus.BAD_REQUEST, "Use a matching password with at least 12 characters and at most 72 UTF-8 bytes.");
        }
        return resetResult(recovery.reset(form.token(), form.password()));
    }

    private ResponseEntity<?> resetResult(boolean success) {
        return success ? ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()
                : error(HttpStatus.BAD_REQUEST, "This reset link is invalid or has expired.");
    }

    private ResponseEntity<?> check(HttpServletRequest request, AuthRateLimit.Action action) {
        if (!origin.allows(request)) return error(HttpStatus.FORBIDDEN, "Invalid request origin.");
        if (!limit.allow(action)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).header(HttpHeaders.RETRY_AFTER, "60")
                    .cacheControl(CacheControl.noStore()).body(Map.of("error", "Too many attempts. Try again shortly."));
        }
        return null;
    }

    private ResponseEntity<?> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(Map.of("error", message));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class})
    ResponseEntity<?> invalidInput() {
        return error(HttpStatus.BAD_REQUEST, "Invalid owner authentication request.");
    }

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<?> dataUnavailable() {
        return error(HttpStatus.SERVICE_UNAVAILABLE, "Owner authentication is unavailable.");
    }
}
