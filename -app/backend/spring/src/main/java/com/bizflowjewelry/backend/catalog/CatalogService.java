package com.bizflowjewelry.backend.catalog;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class CatalogService {
    private static final String PRODUCTS = "bizflow_foundation.catalog_products";
    private static final String FAMILIES = "bizflow_foundation.catalog_families";
    private static final String IMAGES = "bizflow_foundation.catalog_images";
    private static final String FIELDS = """
            p.id,p.sku,p.name,p.category,p.description,p.supplier_label,p.family_id,
            p.variant_size,p.variant_color,p.variant_material,p.variant_design,p.selling_price,
            p.estimated_unit_cost,p.reorder_threshold,p.archived_at,p.created_at,p.updated_at,
            EXISTS (SELECT 1 FROM bizflow_foundation.catalog_images i WHERE i.product_id=p.id) AS has_image
            """;
    private final JdbcClient sql;

    CatalogService(JdbcClient sql) { this.sql = sql; }

    record Product(String id, String sku, String name, String category, String description, String supplierLabel,
                   String familyId, String variantSize, String variantColor, String variantMaterial, String variantDesign,
                   long sellingPrice, long estimatedUnitCost, int reorderThreshold, OffsetDateTime archivedAt,
                   OffsetDateTime createdAt, OffsetDateTime updatedAt, boolean hasImage) {}

    record Family(String id, String name, OffsetDateTime createdAt, OffsetDateTime updatedAt) {}
    record Page<T>(List<T> items, int page, int size, long total) {}
    record Image(String contentType, byte[] contents) {}

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Page<Product> products(String query, String category, String family, String status, String sort, int page, int size) {
        String order = switch (sort) {
            case "name" -> "lower(p.name), p.id";
            case "sku" -> "lower(p.sku), p.id";
            case "newest" -> "p.created_at DESC, p.id";
            default -> throw invalid("Unknown product sort.");
        };
        String condition = switch (status) {
            case "active" -> " AND p.archived_at IS NULL";
            case "archived" -> " AND p.archived_at IS NOT NULL";
            case "all" -> "";
            default -> throw invalid("Unknown product status.");
        };
        String from = " FROM " + PRODUCTS + " p WHERE true" + condition;
        List<Object> params = new ArrayList<>();
        if (query != null && !query.isBlank()) {
            from += " AND strpos(lower(p.sku || ' ' || p.name || ' ' || p.description), lower(?)) > 0";
            params.add(query.trim());
        }
        if (category != null && !category.isBlank()) { from += " AND lower(p.category)=lower(?)"; params.add(category.trim()); }
        if (family != null) { from += " AND p.family_id=?"; params.add(family); }
        long total = sql.sql("SELECT count(*)" + from).params(params).query(Long.class).single();
        params.add(size);
        params.add((long) page * size);
        var rows = sql.sql("SELECT " + FIELDS + from + " ORDER BY " + order + " LIMIT ? OFFSET ?")
                .params(params).query(Product.class).list();
        return new Page<>(rows, page, size, total);
    }

    Product product(String id) { return product(id, false); }

    private Product product(String id, boolean lock) {
        return sql.sql("SELECT " + FIELDS + " FROM " + PRODUCTS + " p WHERE p.id=?" + (lock ? " FOR UPDATE OF p" : ""))
                .param(id).query(Product.class).optional().orElseThrow(() -> missing("Product not found."));
    }

    @Transactional
    Product create(CatalogController.CreateProduct value, String actor) {
        if (value.familyId() != null) family(value.familyId());
        String id = UUID.randomUUID().toString();
        sql.sql("INSERT INTO " + PRODUCTS + """
                 (id,sku,name,category,description,supplier_label,family_id,variant_size,variant_color,
                  variant_material,variant_design,selling_price,estimated_unit_cost,reorder_threshold)
                VALUES (?,?,?,?,?,?,?, ?,?,?,?,?,?,?)
                """).params(id, required(value.sku()), required(value.name()), required(value.category()),
                or(value.description(), ""), or(value.supplierLabel(), ""), value.familyId(), or(value.variantSize(), ""),
                or(value.variantColor(), ""), or(value.variantMaterial(), ""), or(value.variantDesign(), ""),
                value.sellingPrice(), value.estimatedUnitCost(), value.reorderThreshold()).update();
        productAudit(id, actor, "created");
        return product(id);
    }

    @Transactional
    Product update(String id, CatalogController.UpdateProduct value, String actor) {
        Product current = editable(id);
        sql.sql("UPDATE " + PRODUCTS + """
                 SET sku=?,name=?,category=?,description=?,supplier_label=?,variant_size=?,variant_color=?,
                  variant_material=?,variant_design=?,selling_price=?,estimated_unit_cost=?,reorder_threshold=?,
                  updated_at=CURRENT_TIMESTAMP WHERE id=?
                """).params(required(or(value.sku(), current.sku())), required(or(value.name(), current.name())),
                required(or(value.category(), current.category())), or(value.description(), current.description()),
                or(value.supplierLabel(), current.supplierLabel()), or(value.variantSize(), current.variantSize()),
                or(value.variantColor(), current.variantColor()), or(value.variantMaterial(), current.variantMaterial()),
                or(value.variantDesign(), current.variantDesign()), or(value.sellingPrice(), current.sellingPrice()),
                or(value.estimatedUnitCost(), current.estimatedUnitCost()), or(value.reorderThreshold(), current.reorderThreshold()), id).update();
        productAudit(id, actor, "updated");
        return product(id);
    }

    @Transactional
    Product link(String id, String familyId, String actor) {
        editable(id);
        if (familyId != null) family(familyId);
        sql.sql("UPDATE " + PRODUCTS + " SET family_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
                .params(familyId, id).update();
        productAudit(id, actor, "family_link_changed");
        return product(id);
    }

    @Transactional
    Product archive(String id, String actor) {
        Product current = product(id, true);
        if (current.archivedAt() != null) return current;
        boolean inStock = sql.sql("""
                SELECT EXISTS (SELECT 1 FROM bizflow_foundation.inventory_balances WHERE product_id=? AND quantity>0)
                """).param(id).query(Boolean.class).single();
        if (inStock) throw new ResponseStatusException(HttpStatus.CONFLICT, "Adjust stock to zero before archiving.");
        boolean pending = sql.sql("""
                SELECT EXISTS (SELECT 1 FROM bizflow_foundation.procurement_line_progress p
                    JOIN bizflow_foundation.procurement_orders o ON o.id=p.order_id
                    WHERE p.product_id=? AND NOT o.cancelled AND p.usable+p.damaged<p.ordered)
                """).param(id).query(Boolean.class).single();
        if (pending) throw new ResponseStatusException(HttpStatus.CONFLICT, "This product has an open purchase line.");
        sql.sql("UPDATE " + PRODUCTS + " SET archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?")
                .param(id).update();
        productAudit(id, actor, "archived");
        return product(id);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Page<Family> families(int page, int size) {
        long total = sql.sql("SELECT count(*) FROM " + FAMILIES).query(Long.class).single();
        var rows = sql.sql("SELECT * FROM " + FAMILIES + " ORDER BY lower(name),id LIMIT ? OFFSET ?")
                .params(size, (long) page * size).query(Family.class).list();
        return new Page<>(rows, page, size, total);
    }

    Family family(String id) {
        return sql.sql("SELECT * FROM " + FAMILIES + " WHERE id=?").param(id).query(Family.class)
                .optional().orElseThrow(() -> missing("Product family not found."));
    }

    @Transactional
    Family createFamily(String name, String actor) {
        String id = UUID.randomUUID().toString();
        sql.sql("INSERT INTO " + FAMILIES + " (id,name) VALUES (?,?)").params(id, required(name)).update();
        familyAudit(id, actor, "created");
        return family(id);
    }

    @Transactional
    Family updateFamily(String id, String name, String actor) {
        int changed = sql.sql("UPDATE " + FAMILIES + " SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
                .params(required(name), id).update();
        if (changed != 1) throw missing("Product family not found.");
        familyAudit(id, actor, "updated");
        return family(id);
    }

    Image image(String id) {
        return sql.sql("SELECT content_type,contents FROM " + IMAGES + " WHERE product_id=?")
                .param(id).query((row, number) -> new Image(row.getString(1), row.getBytes(2)))
                .optional().orElseThrow(() -> missing("Product image not found."));
    }

    @Transactional
    void saveImage(String id, Image image, String actor) {
        editable(id);
        sql.sql("INSERT INTO " + IMAGES + """
                 (product_id,content_type,contents) VALUES (?,?,?)
                 ON CONFLICT (product_id) DO UPDATE SET content_type=excluded.content_type,contents=excluded.contents
                """).params(id, image.contentType(), image.contents()).update();
        sql.sql("UPDATE " + PRODUCTS + " SET updated_at=CURRENT_TIMESTAMP WHERE id=?").param(id).update();
        productAudit(id, actor, "image_saved");
    }

    private Product editable(String id) {
        Product current = product(id, true);
        if (current.archivedAt() != null) throw new ResponseStatusException(HttpStatus.CONFLICT, "Product is archived.");
        return current;
    }

    private void productAudit(String id, String actor, String action) {
        sql.sql("INSERT INTO bizflow_foundation.catalog_audit (actor_id,product_id,action) VALUES (?,?,?)")
                .params(actor, id, action).update();
    }

    private void familyAudit(String id, String actor, String action) {
        sql.sql("INSERT INTO bizflow_foundation.catalog_audit (actor_id,family_id,action) VALUES (?,?,?)")
                .params(actor, id, action).update();
    }

    private static String required(String value) {
        if (value == null || value.isBlank()) throw invalid("SKU, name and category cannot be blank.");
        return value.strip();
    }

    private static <T> T or(T value, T fallback) { return value == null ? fallback : value; }
    private static ResponseStatusException missing(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }
    private static ResponseStatusException invalid(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
}
