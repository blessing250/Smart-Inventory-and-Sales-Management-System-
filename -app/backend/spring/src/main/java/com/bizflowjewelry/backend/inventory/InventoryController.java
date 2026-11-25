package com.bizflowjewelry.backend.inventory;

import com.bizflowjewelry.backend.auth.AuthOrigin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping(path = "/api/v1/inventory", produces = MediaType.APPLICATION_JSON_VALUE)
class InventoryController {
    private static final long MAX_QUANTITY = 1_000_000_000L;
    private static final long MAX_VALUE = 9_007_199_254_740_991L;
    private final InventoryLedger ledger;
    private final InventoryQueries queries;
    private final AuthOrigin origin;

    InventoryController(InventoryLedger ledger, InventoryQueries queries, AuthOrigin origin) {
        this.ledger = ledger;
        this.queries = queries;
        this.origin = origin;
    }

    record Opening(@NotNull @Min(1) @Max(MAX_QUANTITY) Long quantity, @NotNull @Min(0) @Max(MAX_VALUE) Long valueRwf,
                   @NotBlank @Size(max = 150) String reference, @NotBlank @Size(max = 500) String reason) {}
    record Adjustment(@NotBlank @Pattern(regexp = "INCREASE|DECREASE|DAMAGE_OUT|MISSING_OUT") String type,
                      @NotNull @Min(1) @Max(MAX_QUANTITY) Long quantity,
                      @NotBlank @Size(max = 150) String reference, @NotBlank @Size(max = 500) String reason) {}
    record PhysicalCount(@NotNull @Min(0) @Max(MAX_QUANTITY) Long observedQuantity, @NotNull @Min(0) Long expectedVersion,
                         @NotBlank @Size(max = 150) String reference, @NotBlank @Size(max = 500) String reason) {}
    record Reversal(@NotBlank @Size(max = 150) String reference, @NotBlank @Size(max = 500) String reason) {}

    @GetMapping("/balances")
    InventoryQueries.Page<InventoryQueries.Balance> balances(@RequestParam(required = false) @Size(max = 150) String q,
            @RequestParam(defaultValue = "0") @Min(0) int page, @RequestParam(defaultValue = "25") @Min(1) @Max(100) int size) {
        return queries.balances(q, page, size);
    }

    @GetMapping("/products/{id}/balance")
    InventoryQueries.Balance balance(@PathVariable String id) { return queries.balance(id); }

    @GetMapping("/movements")
    InventoryQueries.Page<InventoryLedger.Movement> movements(@RequestParam(required = false) @Size(max = 150) String productId,
            @RequestParam(required = false) @Size(max = 150) String q,
            @RequestParam(required = false) @Pattern(regexp = "OPENING|ADJUSTMENT|COUNT|DAMAGE_OUT|MISSING_OUT|REVERSAL|PURCHASE_RECEIPT|SALE|SALE_RETURN") String kind,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "0") @Min(0) int page, @RequestParam(defaultValue = "25") @Min(1) @Max(100) int size) {
        return queries.movements(productId, q, kind, from, to, page, size);
    }

    @GetMapping("/movements/{id}")
    InventoryLedger.Movement movement(@PathVariable UUID id) { return ledger.movement(id); }

    @GetMapping("/counts")
    InventoryQueries.Page<InventoryLedger.Count> counts(@RequestParam(required = false) @Size(max = 150) String productId,
            @RequestParam(required = false) @Size(max = 150) String q, @RequestParam(defaultValue = "all") String status,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "0") @Min(0) int page, @RequestParam(defaultValue = "25") @Min(1) @Max(100) int size) {
        return queries.counts(productId, q, status, from, to, page, size);
    }

    @GetMapping("/counts/{id}")
    InventoryLedger.Count count(@PathVariable UUID id) { return ledger.count(id); }

    @GetMapping("/products/{id}/unavailable")
    InventoryQueries.Unavailable unavailable(@PathVariable String id) { return queries.unavailable(id); }

    @GetMapping("/products/{id}/reconciliation")
    InventoryQueries.Reconciliation reconcile(@PathVariable String id) { return queries.reconcile(id); }

    @PostMapping(path = "/products/{id}/opening", consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    InventoryLedger.Movement open(@PathVariable String id, @Valid @RequestBody Opening input,
            @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        requireOrigin(request);
        return ledger.open(id, input.quantity(), input.valueRwf(), input.reference(), input.reason(), jwt.getSubject());
    }

    @PostMapping(path = "/products/{id}/adjustments", consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    InventoryLedger.Movement adjust(@PathVariable String id, @Valid @RequestBody Adjustment input,
            @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        requireOrigin(request);
        return ledger.adjust(id, input.type(), input.quantity(), input.reference(), input.reason(), jwt.getSubject());
    }

    @PostMapping(path = "/products/{id}/counts", consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    InventoryLedger.Count draft(@PathVariable String id, @Valid @RequestBody PhysicalCount input,
            @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        requireOrigin(request);
        return ledger.draftCount(id, input.observedQuantity(), input.expectedVersion(), input.reference(), input.reason(), jwt.getSubject());
    }

    @PostMapping("/counts/{id}/confirm")
    InventoryLedger.Count confirm(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        requireOrigin(request);
        return ledger.confirm(id, jwt.getSubject());
    }

    @PostMapping(path = "/movements/{id}/reverse", consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    InventoryLedger.Movement reverse(@PathVariable UUID id, @Valid @RequestBody Reversal input,
            @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        requireOrigin(request);
        return ledger.reverse(id, input.reference(), input.reason(), jwt.getSubject());
    }

    private void requireOrigin(HttpServletRequest request) {
        if (!origin.allows(request)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Invalid request origin.");
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> status(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode())
                .body(Map.of("error", error.getReason() == null ? "Inventory request failed." : error.getReason()));
    }

    @ExceptionHandler(DuplicateKeyException.class)
    ResponseEntity<Map<String, String>> duplicate() {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "This inventory reference is already in use."));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HandlerMethodValidationException.class,
            MethodArgumentTypeMismatchException.class, HttpMessageNotReadableException.class})
    ResponseEntity<Map<String, String>> invalid() {
        return ResponseEntity.badRequest().body(Map.of("error", "Check the inventory fields and filters."));
    }
}
