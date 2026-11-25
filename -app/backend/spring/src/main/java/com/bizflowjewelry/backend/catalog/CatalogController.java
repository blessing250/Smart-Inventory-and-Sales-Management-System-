package com.bizflowjewelry.backend.catalog;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.io.IOException;
import java.net.URI;
import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.server.ResponseStatusException;
import com.bizflowjewelry.backend.auth.AuthOrigin;
import com.bizflowjewelry.backend.catalog.CatalogImport.Row;

@RestController
@RequestMapping("/api/v1")
class CatalogController {
    private static final int MAX_IMAGE = 2 * 1024 * 1024;
    private final CatalogService catalog;
    private final CatalogImport imports;
    private final AuthOrigin origin;

    CatalogController(CatalogService catalog, AuthOrigin origin,CatalogImport imports) {
        this.catalog = catalog;
        this.origin = origin;
        this.imports=imports;
    }

    record CreateProduct(@NotBlank @Size(max = 100) String sku, @NotBlank @Size(max = 200) String name,
                         @NotBlank @Size(max = 100) String category, @Size(max = 4000) String description,
                         @Size(max = 200) String supplierLabel, @Size(max = 150) String familyId,
                         @Size(max = 100) String variantSize, @Size(max = 100) String variantColor,
                         @Size(max = 100) String variantMaterial, @Size(max = 100) String variantDesign,
                         @NotNull @Min(0) @Max(1000000000) Long sellingPrice,
                         @NotNull @Min(0) @Max(1000000000) Long estimatedUnitCost,
                         @NotNull @Min(0) @Max(1000000) Integer reorderThreshold) {}
    record UpdateProduct(@Size(max = 100) String sku, @Size(max = 200) String name, @Size(max = 100) String category,
                         @Size(max = 4000) String description, @Size(max = 200) String supplierLabel,
                         @Size(max = 100) String variantSize, @Size(max = 100) String variantColor,
                         @Size(max = 100) String variantMaterial, @Size(max = 100) String variantDesign,
                         @Min(0) @Max(1000000000) Long sellingPrice,
                         @Min(0) @Max(1000000000) Long estimatedUnitCost, @Min(0) @Max(1000000) Integer reorderThreshold) {}
    record FamilyInput(@NotBlank @Size(max = 200) String name) {}
    record ImportInput(@NotBlank @Pattern(regexp="SKIP|UPDATE") String mode,@Size(max=150) String reference,
                       @NotEmpty @Size(max=200) java.util.List<@NotNull Row> rows) {}

    @PostMapping("/products/import/preview")
    java.util.List<CatalogImport.Result> previewImport(@Valid @RequestBody ImportInput input,HttpServletRequest request) {
        requireOrigin(request);
        return imports.preview(input.rows(),input.mode());
    }

    @PostMapping("/products/import/confirm")
    CatalogImport.Outcome confirmImport(@Valid @RequestBody ImportInput input,@AuthenticationPrincipal Jwt jwt,HttpServletRequest request) {
        requireOrigin(request);
        return imports.confirm(input,jwt.getSubject());
    }
    record FamilyLink(@com.fasterxml.jackson.annotation.JsonProperty(required = true) @Size(max = 150) String familyId) {}

    @GetMapping("/products")
    CatalogService.Page<CatalogService.Product> listProducts(
            @RequestParam(required = false) @Size(max = 150) String q,
            @RequestParam(required = false) @Size(max = 100) String category,
            @RequestParam(required = false) @Size(max = 150) String familyId,
            @RequestParam(defaultValue = "active") String status,
            @RequestParam(defaultValue = "name") String sort,
            @RequestParam(defaultValue = "0") @Min(0) int page, @RequestParam(defaultValue = "25") @Min(1) @Max(100) int size) {
        return catalog.products(q, category, familyId, status, sort, page, size);
    }

    @GetMapping("/products/{id}")
    CatalogService.Product product(@PathVariable String id) { return catalog.product(id); }

    @PostMapping(path = "/products", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<CatalogService.Product> create(@Valid @RequestBody CreateProduct input,
            @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        requireOrigin(request);
        var product = catalog.create(input, jwt.getSubject());
        return ResponseEntity.created(URI.create("/api/v1/products/" + product.id())).body(product);
    }

    @PatchMapping(path = "/products/{id}", consumes = MediaType.APPLICATION_JSON_VALUE)
    CatalogService.Product update(@PathVariable String id, @Valid @RequestBody UpdateProduct input,
            @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        requireOrigin(request);
        return catalog.update(id, input, jwt.getSubject());
    }

    @PatchMapping(path = "/products/{id}/family", consumes = MediaType.APPLICATION_JSON_VALUE)
    CatalogService.Product link(@PathVariable String id, @Valid @RequestBody FamilyLink input,
            @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        requireOrigin(request);
        return catalog.link(id, input.familyId(), jwt.getSubject());
    }

    @PostMapping("/products/{id}/archive")
    CatalogService.Product archive(@PathVariable String id, @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        requireOrigin(request);
        return catalog.archive(id, jwt.getSubject());
    }

    @GetMapping("/product-families")
    CatalogService.Page<CatalogService.Family> families(@RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int size) {
        return catalog.families(page, size);
    }

    @GetMapping("/product-families/{id}")
    CatalogService.Family family(@PathVariable String id) { return catalog.family(id); }

    @PostMapping(path = "/product-families", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<CatalogService.Family> createFamily(@Valid @RequestBody FamilyInput input,
            @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        requireOrigin(request);
        var family = catalog.createFamily(input.name(), jwt.getSubject());
        return ResponseEntity.created(URI.create("/api/v1/product-families/" + family.id())).body(family);
    }

    @PatchMapping(path = "/product-families/{id}", consumes = MediaType.APPLICATION_JSON_VALUE)
    CatalogService.Family updateFamily(@PathVariable String id, @Valid @RequestBody FamilyInput input,
            @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        requireOrigin(request);
        return catalog.updateFamily(id, input.name(), jwt.getSubject());
    }

    @GetMapping("/products/{id}/image")
    ResponseEntity<byte[]> image(@PathVariable String id) {
        var image = catalog.image(id);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(image.contentType()))
                .cacheControl(CacheControl.noStore()).header("X-Content-Type-Options", "nosniff").body(image.contents());
    }

    @PutMapping(path = "/products/{id}/image", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    ResponseEntity<Void> uploadImage(@PathVariable String id, @RequestParam("image") MultipartFile file,
            @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) throws IOException {
        requireOrigin(request);
        if (file.isEmpty() || file.getSize() > MAX_IMAGE) throw invalidImage();
        byte[] bytes = file.getBytes();
        String mime = imageType(bytes);
        if (mime == null || !mime.equals(file.getContentType())) throw invalidImage();
        catalog.saveImage(id, new CatalogService.Image(mime, bytes), jwt.getSubject());
        return ResponseEntity.noContent().build();
    }

    static String imageType(byte[] bytes) {
        if (startsWith(bytes, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
                && startsWith(bytes, 12, 'I', 'H', 'D', 'R') && bytes.length >= 33) return "image/png";
        if (startsWith(bytes, 0, 0xff, 0xd8, 0xff) && bytes.length >= 8
                && startsWith(bytes, bytes.length - 2, 0xff, 0xd9)) return "image/jpeg";
        if (startsWith(bytes, 0, 'R', 'I', 'F', 'F') && startsWith(bytes, 8, 'W', 'E', 'B', 'P') && bytes.length >= 20) {
            long size = Integer.toUnsignedLong(java.nio.ByteBuffer.wrap(bytes, 4, 4)
                    .order(java.nio.ByteOrder.LITTLE_ENDIAN).getInt());
            if (size == bytes.length - 8 && (startsWith(bytes, 12, 'V', 'P', '8', ' ')
                    || startsWith(bytes, 12, 'V', 'P', '8', 'L') || startsWith(bytes, 12, 'V', 'P', '8', 'X'))) return "image/webp";
        }
        return null;
    }

    private static boolean startsWith(byte[] bytes, int offset, int... signature) {
        if (bytes.length < offset + signature.length) return false;
        for (int i = 0; i < signature.length; i++) if (Byte.toUnsignedInt(bytes[offset + i]) != signature[i]) return false;
        return true;
    }

    private void requireOrigin(HttpServletRequest request) {
        if (!origin.allows(request)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Invalid request origin.");
    }

    private static ResponseStatusException invalidImage() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a JPEG, PNG or WebP image up to 2 MiB.");
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> statusError(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("error", error.getReason() == null ? "Catalog request failed." : error.getReason()));
    }

    @ExceptionHandler(DuplicateKeyException.class)
    ResponseEntity<Map<String, String>> duplicate() {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "The SKU or family name already exists."));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HandlerMethodValidationException.class,
            MethodArgumentTypeMismatchException.class, HttpMessageNotReadableException.class})
    ResponseEntity<Map<String, String>> invalidParameters() {
        return ResponseEntity.badRequest().body(Map.of("error", "Check the catalog fields and filters."));
    }
}
