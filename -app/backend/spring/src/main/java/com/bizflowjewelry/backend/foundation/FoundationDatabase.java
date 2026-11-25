package com.bizflowjewelry.backend.foundation;

import javax.sql.DataSource;
import java.sql.SQLException;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.flyway.autoconfigure.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class FoundationDatabase {
    private static final Pattern DISPOSABLE_DATABASE = Pattern.compile("bizflow_foundation_[a-z0-9_]{1,42}");

    @Bean
    FlywayMigrationStrategy foundationMigration(
            @Value("${bizflow.foundation.database}") String expectedDatabase) {
        return flyway -> {
            checkDatabase(flyway.getConfiguration().getDataSource(), expectedDatabase);
            flyway.migrate();
        };
    }

    static boolean isDisposableDatabase(String expected, String actual, boolean businessTablesExist) {
        return DISPOSABLE_DATABASE.matcher(expected).matches()
                && expected.equals(actual)
                && !businessTablesExist;
    }

    private static void checkDatabase(DataSource source, String expected) {
        String sql = """
                SELECT current_database(), EXISTS (
                    SELECT 1 FROM pg_catalog.pg_tables
                    WHERE tablename IN ('users', 'products', 'sales', 'money_transactions')
                )
                """;
        try (var connection = source.getConnection();
             var statement = connection.prepareStatement(sql);
             var result = statement.executeQuery()) {
            if (!result.next() || !isDisposableDatabase(expected, result.getString(1), result.getBoolean(2))) {
                throw new IllegalStateException("Foundation migrations require the configured disposable PostgreSQL database.");
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Could not verify the isolated PostgreSQL database.", error);
        }
    }
}
