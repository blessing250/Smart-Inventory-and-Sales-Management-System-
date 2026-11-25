CREATE TABLE bizflow_foundation.schema_marker (
    singleton boolean PRIMARY KEY CHECK (singleton)
);

INSERT INTO bizflow_foundation.schema_marker (singleton) VALUES (true);
