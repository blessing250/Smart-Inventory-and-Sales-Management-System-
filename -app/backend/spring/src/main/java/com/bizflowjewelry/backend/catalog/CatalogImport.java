package com.bizflowjewelry.backend.catalog;

import jakarta.validation.Validator;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

@Service
class CatalogImport {
    private final JdbcClient db;
    private final CatalogService catalog;
    private final Validator validator;
    private final ObjectMapper json;

    CatalogImport(JdbcClient db,CatalogService catalog,Validator validator,ObjectMapper json) {
        this.db=db;
        this.catalog=catalog;
        this.validator=validator;
        this.json=json;
    }

    record Row(CatalogController.CreateProduct product,Long quantity) {}
    record Result(int row,String sku,String name,String action,List<String> errors,List<String> warnings) {}
    record Outcome(int created,int updated,int skipped,List<Result> rows) {}
    private record Existing(String id,boolean archived,String familyId) {}
    private record Prior(String requestHash,String result,String actorId) {}

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    List<Result> preview(List<Row> rows,String mode) {
        var counts=new HashMap<String,Integer>();
        for(var row:rows) counts.merge(sku(row),1,Integer::sum);
        var results=new ArrayList<Result>();
        for(int i=0;i<rows.size();i++) {
            var row=rows.get(i);
            var p=row.product();
            var errors=new ArrayList<String>();
            var warnings=new ArrayList<String>();
            if(p==null) errors.add("Map the product fields.");
            else {
                validator.validate(withCatalogDefaults(p)).stream().map(v->v.getPropertyPath()+": "+v.getMessage()).sorted().forEach(errors::add);
                if(p.familyId()!=null && !db.sql("SELECT EXISTS(SELECT 1 FROM bizflow_foundation.catalog_families WHERE id=?)")
                        .param(p.familyId()).query(Boolean.class).single()) errors.add("Select an existing product family.");
            }
            if(!sku(row).isEmpty() && counts.get(sku(row))>1) errors.add("Duplicate SKU in the file.");
            if(row.quantity()!=null) {
                if(row.quantity()<0 || row.quantity()>1_000_000) errors.add("Quantity must be between 0 and 1,000,000.");
                else if(row.quantity()>0) warnings.add("Sheet quantity will not change stock. Use opening stock separately.");
            }
            Existing current=sku(row).isEmpty()?null:existing(sku(row));
            String action=current==null?"CREATE":"SKIP";
            if(current!=null && "UPDATE".equals(mode) && !current.archived()) action="UPDATE";
            if(current!=null && current.archived()) warnings.add("Archived products are skipped.");
            results.add(new Result(i+1,p==null?"":p.sku(),p==null?"":p.name(),action,errors,warnings));
        }
        return results;
    }

    @Transactional
    Outcome confirm(CatalogController.ImportInput input,String actor) {
        db.sql("SELECT pg_advisory_xact_lock(12790421,11)").query((row,n)->1).single();
        String reference=input.reference()==null?"":input.reference().strip();
        if(reference.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"An import reference is required.");
        String hash=hash(input);
        var prior=db.sql("SELECT request_hash,result::text AS result,actor_id FROM bizflow_foundation.catalog_imports WHERE reference=?")
                .param(reference).query(Prior.class).optional();
        if(prior.isPresent()) {
            if(!hash.equals(prior.get().requestHash()) || !actor.equals(prior.get().actorId())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,"This import reference belongs to another request.");
            }
            return json.readValue(prior.get().result(),Outcome.class);
        }
        var decisions=preview(input.rows(),input.mode());
        if(decisions.stream().anyMatch(r->!r.errors().isEmpty())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Resolve the import preview errors.");
        int created=0,updated=0,skipped=0;
        for(int i=0;i<decisions.size();i++){
            var row=input.rows().get(i);
            var p=row.product();
            switch(decisions.get(i).action()){
                case "CREATE" -> { catalog.create(withCatalogDefaults(p),actor); created++; }
                case "UPDATE" -> {
                    var current=existing(sku(row));
                    if(current==null || current.archived()) throw new ResponseStatusException(HttpStatus.CONFLICT,"Catalog changed. Review the import again.");
                    catalog.update(current.id(),new CatalogController.UpdateProduct(null,p.name(),p.category(),p.description(),p.supplierLabel(),
                            p.variantSize(),p.variantColor(),p.variantMaterial(),p.variantDesign(),p.sellingPrice(),p.estimatedUnitCost(),p.reorderThreshold()),actor);
                    if(p.familyId()!=null && !p.familyId().equals(current.familyId())) catalog.link(current.id(),p.familyId(),actor);
                    updated++;
                }
                default -> skipped++;
            }
        }
        var outcome=new Outcome(created,updated,skipped,decisions);
        db.sql("INSERT INTO bizflow_foundation.catalog_imports(reference,request_hash,actor_id,result) VALUES (?,?,?,?::jsonb)")
                .params(reference,hash,actor,json.writeValueAsString(outcome)).update();
        return outcome;
    }

    private Existing existing(String sku) {
        return db.sql("SELECT id,archived_at IS NOT NULL AS archived,family_id FROM bizflow_foundation.catalog_products WHERE lower(sku)=?")
                .param(sku).query(Existing.class).optional().orElse(null);
    }

    private static String sku(Row row) {
        return row.product()==null || row.product().sku()==null?"":row.product().sku().strip().toLowerCase(Locale.ROOT);
    }

    private static CatalogController.CreateProduct withCatalogDefaults(CatalogController.CreateProduct value) {
        return new CatalogController.CreateProduct(value.sku(),value.name(),value.category(),value.description(),value.supplierLabel(),
                value.familyId(),value.variantSize(),value.variantColor(),value.variantMaterial(),value.variantDesign(),value.sellingPrice(),
                value.estimatedUnitCost()==null?0L:value.estimatedUnitCost(),value.reorderThreshold()==null?0:value.reorderThreshold());
    }

    private String hash(Object value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(json.writeValueAsBytes(value)));
        } catch(NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required.",e);
        }
    }
}
