package com.bizflowjewelry.backend.foundation;

import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.RETURNS_DEEP_STUBS;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class HealthControllerTest {
    private static final String SELECT = "SELECT 1 FROM bizflow_foundation.schema_marker WHERE singleton";
    private final JdbcClient database = mock(JdbcClient.class, RETURNS_DEEP_STUBS);
    private final HealthController health = new HealthController(database);

    @Test
    void livenessAndReadinessReportSeparateStates() {
        when(database.sql(SELECT).query(Integer.class).optional()).thenReturn(Optional.of(1));
        assertEquals("ok", health.live().getBody().status());
        assertEquals("ready", health.ready().getBody().status());
        assertEquals("no-store", health.ready().getHeaders().getCacheControl());
    }

    @Test
    void readinessKeepsDatabaseFailuresPrivate() {
        when(database.sql(SELECT)).thenThrow(new DataAccessResourceFailureException("private database error"));
        var response = health.ready();
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, response.getStatusCode());
        assertEquals("unavailable", response.getBody().status());
    }
}
