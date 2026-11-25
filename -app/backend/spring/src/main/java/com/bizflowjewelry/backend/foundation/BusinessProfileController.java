package com.bizflowjewelry.backend.foundation;

import com.bizflowjewelry.backend.auth.AuthOrigin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/settings")
class BusinessProfileController {
    private final JdbcClient db;
    private final AuthOrigin origin;

    BusinessProfileController(JdbcClient db,AuthOrigin origin) { this.db=db;this.origin=origin; }

    record Profile(@NotBlank @Size(max=200) String name,@NotNull @Size(max=500) String address,
                   @NotNull @Size(max=100) String phone,@NotNull @Size(max=500) String receiptFooter) {}

    @GetMapping
    Profile profile() {
        return db.sql("SELECT name,address,phone,receipt_footer FROM bizflow_foundation.business_profile WHERE singleton")
                .query(Profile.class).single();
    }

    @PutMapping
    @Transactional
    Profile update(@Valid @RequestBody Profile input,@AuthenticationPrincipal Jwt jwt,HttpServletRequest request) {
        if(!origin.allows(request)) throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Invalid request origin.");
        db.sql("SELECT name FROM bizflow_foundation.business_profile WHERE singleton FOR UPDATE").query(String.class).single();
        db.sql("""
                INSERT INTO bizflow_foundation.business_profile_audit(actor_id,previous)
                SELECT ?,jsonb_build_object('name',name,'address',address,'phone',phone,'receiptFooter',receipt_footer)
                FROM bizflow_foundation.business_profile WHERE singleton
                """).param(jwt.getSubject()).update();
        db.sql("""
                UPDATE bizflow_foundation.business_profile SET name=?,address=?,phone=?,receipt_footer=?,updated_by=?,
                    updated_at=CURRENT_TIMESTAMP WHERE singleton
                """).params(input.name().strip(),input.address().strip(),input.phone().strip(),input.receiptFooter().strip(),jwt.getSubject()).update();
        return profile();
    }
}
