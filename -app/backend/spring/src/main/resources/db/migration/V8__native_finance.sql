SET LOCAL search_path TO bizflow_foundation, pg_catalog;

ALTER TABLE financial_postings DROP CONSTRAINT financial_postings_kind_check;
ALTER TABLE financial_postings ADD CONSTRAINT financial_postings_kind_check
    CHECK (kind IN ('OPENING','CUSTOMER_PAYMENT','CUSTOMER_REFUND','REVERSAL','OPERATING_EXPENSE',
                    'SUPPLIER_PAYMENT','SHIPMENT_PAYMENT','TRANSFER','CLAIM_CASH','EXCHANGE'));
ALTER TABLE financial_postings
    ADD COLUMN source_minor bigint,
    ADD COLUMN destination_minor bigint,
    ADD COLUMN source_currency text CHECK (source_currency IN ('RWF','USD','CNY')),
    ADD COLUMN destination_currency text CHECK (destination_currency IN ('RWF','USD','CNY')),
    ADD COLUMN rwf_rate_micros bigint CHECK (rwf_rate_micros BETWEEN 1 AND 10000000000),
    ADD COLUMN exchange_rate_micros bigint CHECK (exchange_rate_micros BETWEEN 1 AND 10000000000),
    ADD COLUMN fee_minor bigint NOT NULL DEFAULT 0 CHECK (fee_minor BETWEEN 0 AND 1000000000000),
    ADD COLUMN fee_rwf bigint NOT NULL DEFAULT 0 CHECK (fee_rwf BETWEEN 0 AND 1000000000000),
    ADD CHECK ((source_minor IS NULL)=(source_currency IS NULL)
           AND (destination_minor IS NULL)=(destination_currency IS NULL)
           AND (source_minor IS NULL OR (source_minor BETWEEN 1 AND 2000000000000 AND from_account IS NOT NULL))
           AND (destination_minor IS NULL OR (destination_minor BETWEEN 1 AND 2000000000000 AND to_account IS NOT NULL))
           AND (kind<>'EXCHANGE' OR (source_minor IS NOT NULL AND destination_minor IS NOT NULL
                AND source_currency<>destination_currency AND exchange_rate_micros IS NOT NULL AND rwf_rate_micros IS NOT NULL)));

CREATE OR REPLACE VIEW financial_account_balances AS
SELECT a.*,
       CASE WHEN a.currency='RWF' THEN totals.balance_minor ELSE NULL END AS balance_rwf,
       totals.balance_minor
FROM financial_accounts a
CROSS JOIN LATERAL (
    SELECT COALESCE((SELECT sum(coalesce(p.destination_minor,p.amount_rwf)) FROM financial_postings p WHERE p.to_account=a.id),0)::bigint
         - COALESCE((SELECT sum(coalesce(p.source_minor,p.amount_rwf)+p.fee_minor) FROM financial_postings p WHERE p.from_account=a.id),0)::bigint AS balance_minor
) totals;

ALTER TABLE supplier_payment_allocations ADD COLUMN source_minor bigint CHECK (source_minor>0);
