package com.bizflowjewelry.backend.foundation;

import org.springframework.dao.DataAccessException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class HealthController {
    private final JdbcClient database;

    HealthController(JdbcClient database) {
        this.database = database;
    }

    @GetMapping("/api/health/live")
    ResponseEntity<HealthStatus> live() {
        return health(HttpStatus.OK, "ok");
    }

    @GetMapping("/api/health/ready")
    ResponseEntity<HealthStatus> ready() {
        try {
            if (database.sql("SELECT 1 FROM bizflow_foundation.schema_marker WHERE singleton")
                    .query(Integer.class).optional().isPresent()) {
                return health(HttpStatus.OK, "ready");
            }
        } catch (DataAccessException ignored) {
            // Keep database diagnostics private.
        }
        return health(HttpStatus.SERVICE_UNAVAILABLE, "unavailable");
    }

    private ResponseEntity<HealthStatus> health(HttpStatus status, String value) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(new HealthStatus(value));
    }

    record HealthStatus(String status) {}
}
