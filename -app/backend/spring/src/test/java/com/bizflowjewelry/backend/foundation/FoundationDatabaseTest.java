package com.bizflowjewelry.backend.foundation;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FoundationDatabaseTest {
    @Test
    void acceptsOnlyTheConfiguredDisposableDatabase() {
        assertTrue(FoundationDatabase.isDisposableDatabase("bizflow_foundation_dev", "bizflow_foundation_dev", false));
        assertFalse(FoundationDatabase.isDisposableDatabase("bizflow", "bizflow", false));
        assertFalse(FoundationDatabase.isDisposableDatabase("bizflow_foundation_dev", "postgres", false));
        assertFalse(FoundationDatabase.isDisposableDatabase("bizflow_foundation_dev", "bizflow_foundation_dev", true));
    }
}
