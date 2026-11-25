package com.bizflowjewelry.backend.procurement;

import com.bizflowjewelry.backend.auth.AuthOrigin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
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
@RequestMapping(path="/api/v1",produces=MediaType.APPLICATION_JSON_VALUE)
class ProcurementController {
    private final ProcurementService service;
    private final AuthOrigin origin;

    ProcurementController(ProcurementService service,AuthOrigin origin) { this.service=service; this.origin=origin; }

    record ContactInput(@NotBlank @Pattern(regexp="SUPPLIER|AGENT") String kind,@NotBlank @Size(max=200) String name,
                        @Size(max=100) String phone,@Email @Size(max=254) String email,@Size(max=200) String location) {}
    record PurchaseItem(@NotBlank @Size(max=150) String productId,@NotNull @Min(1) @Max(1000000) Long quantity,
                        @NotNull @Min(0) @Max(1000000000) Long unitMinor) {}
    record PurchaseInput(@NotBlank @Size(max=150) String supplierId,@NotBlank @Size(max=150) String reference,
                         @Size(max=150) String invoiceReference,@NotNull LocalDate date,
                         @NotBlank @Pattern(regexp="RWF|USD|CNY") String currency,@NotNull @Min(1) @Max(10000000000L) Long rateMicros,
                         @NotEmpty @Size(max=100) List<@NotNull @Valid PurchaseItem> lines) {}
    record PlanItem(@NotBlank @Size(max=150) String lineId,@NotNull @Min(1) @Max(1000000) Long quantity) {}
    record ManifestInput(@NotEmpty @Size(max=100) List<@NotNull @Valid PlanItem> lines) {}
    record ShipmentInput(@NotBlank @Size(max=150) String tracking,@NotBlank @Size(max=150) String agentId,
                         @NotNull LocalDate plannedDate, LocalDate arrivalDate,
                         @NotEmpty @Size(max=100) List<@NotNull @Valid PlanItem> lines) {}
    record ChargesInput(@NotBlank @Pattern(regexp="QUANTITY|VALUE") String allocation,
                        @NotNull @Min(0) @Max(1000000000) Long shipping, @NotNull @Min(0) @Max(1000000000) Long customs,
                        @NotNull @Min(0) @Max(1000000000) Long clearing, @NotNull @Min(0) @Max(1000000000) Long other) {}
    record ReceiptItem(@NotBlank @Size(max=150) String lineId,@NotNull @Min(0) @Max(1000000) Long usable,
                       @NotNull @Min(0) @Max(1000000) Long damaged,@NotNull @Min(0) @Max(1000000) Long missing,
                       @Size(max=1000) String explanation) {}
    record ReceiptInput(@NotBlank @Size(max=150) String reference,@NotNull LocalDate date,
                        @NotEmpty @Size(max=100) List<@NotNull @Valid ReceiptItem> lines) {}
    record CorrectionInput(@NotBlank @Size(max=150) String reference,@NotBlank @Size(max=500) String reason) {}

    @GetMapping("/procurement-contacts")
    ProcurementService.Page<ProcurementService.Contact> contacts(@RequestParam(required=false) @Pattern(regexp="SUPPLIER|AGENT") String kind,
            @RequestParam(required=false) @Size(max=150) String q,@RequestParam(defaultValue="0") @Min(0) int page,
            @RequestParam(defaultValue="25") @Min(1) @Max(100) int size) { return service.contacts(kind,q,page,size); }

    @PostMapping(path="/procurement-contacts",consumes=MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    ProcurementService.Contact createContact(@Valid @RequestBody ContactInput input,@AuthenticationPrincipal Jwt jwt,HttpServletRequest request) {
        return service.createContact(input,actor(request,jwt));
    }

    @GetMapping("/purchases")
    ProcurementService.Page<ProcurementService.Order> orders(@RequestParam(required=false) @Pattern(regexp="OPEN|PARTIAL|RECEIVED|CANCELLED") String status,
            @RequestParam(required=false) @Size(max=150) String supplierId,@RequestParam(required=false) @Size(max=150) String q,
            @RequestParam(defaultValue="0") @Min(0) int page,@RequestParam(defaultValue="25") @Min(1) @Max(100) int size) {
        return service.orders(status,supplierId,q,page,size);
    }

    @PostMapping(path="/purchases",consumes=MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    ProcurementService.OrderView purchase(@Valid @RequestBody PurchaseInput input,@AuthenticationPrincipal Jwt jwt,HttpServletRequest request) {
        return service.createOrder(input,actor(request,jwt));
    }

    @GetMapping("/purchases/{id}")
    ProcurementService.OrderView order(@PathVariable String id) { return service.orderView(id); }

    @PostMapping("/purchases/{id}/cancel")
    ProcurementService.OrderView cancelOrder(@PathVariable String id,@AuthenticationPrincipal Jwt jwt,HttpServletRequest request) {
        return service.cancelOrder(id,actor(request,jwt));
    }

    @GetMapping("/shipments")
    ProcurementService.Page<ProcurementService.Shipment> shipments(@RequestParam(required=false) @Pattern(regexp="PLANNED|IN_TRANSIT|RECEIVED|CANCELLED") String status,
            @RequestParam(required=false) @Size(max=150) String q,@RequestParam(defaultValue="0") @Min(0) int page,
            @RequestParam(defaultValue="25") @Min(1) @Max(100) int size) { return service.shipments(status,q,page,size); }

    @PostMapping(path="/shipments",consumes=MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    ProcurementService.ShipmentView shipment(@Valid @RequestBody ShipmentInput input,@AuthenticationPrincipal Jwt jwt,HttpServletRequest request) {
        return service.createShipment(input,actor(request,jwt));
    }

    @GetMapping("/shipments/{id}")
    ProcurementService.ShipmentView shipment(@PathVariable String id) { return service.shipmentView(id); }

    @PutMapping(path="/shipments/{id}/manifest",consumes=MediaType.APPLICATION_JSON_VALUE)
    ProcurementService.ShipmentView manifest(@PathVariable String id,@Valid @RequestBody ManifestInput input,
            @AuthenticationPrincipal Jwt jwt,HttpServletRequest request) { return service.amend(id,input.lines(),actor(request,jwt)); }

    @PutMapping(path="/shipments/{id}/charges",consumes=MediaType.APPLICATION_JSON_VALUE)
    ProcurementService.ShipmentView charges(@PathVariable String id,@Valid @RequestBody ChargesInput input,
            @AuthenticationPrincipal Jwt jwt,HttpServletRequest request) { return service.charges(id,input,actor(request,jwt)); }

    @PostMapping("/shipments/{id}/cancel")
    ProcurementService.ShipmentView cancelShipment(@PathVariable String id,@AuthenticationPrincipal Jwt jwt,HttpServletRequest request) {
        return service.cancelShipment(id,actor(request,jwt));
    }

    @PostMapping(path="/shipments/{id}/receipts",consumes=MediaType.APPLICATION_JSON_VALUE)
    ProcurementService.ReceiptView receive(@PathVariable String id,@Valid @RequestBody ReceiptInput input,
            @AuthenticationPrincipal Jwt jwt,HttpServletRequest request) { return service.receive(id,input,actor(request,jwt)); }

    @GetMapping("/shipments/{id}/receipts")
    ProcurementService.Page<ProcurementService.Receipt> receipts(@PathVariable String id,
            @RequestParam(defaultValue="0") @Min(0) int page,@RequestParam(defaultValue="25") @Min(1) @Max(100) int size) {
        return service.receipts(id,page,size);
    }

    @GetMapping("/shipments/{id}/receipts/{receiptId}")
    ProcurementService.ReceiptView receipt(@PathVariable String id,@PathVariable String receiptId) { return service.receiptView(id,receiptId); }

    @GetMapping("/shipments/{id}/reconciliation")
    ProcurementService.Reconciliation reconcile(@PathVariable String id) { return service.reconciliation(id); }

    @PostMapping("/shipments/{id}/receipts/{receiptId}/correction")
    ProcurementService.Correction correct(@PathVariable String id,@PathVariable String receiptId,@Valid @RequestBody CorrectionInput input,
            @AuthenticationPrincipal Jwt jwt,HttpServletRequest request) {
        return service.correct(id,receiptId,input,actor(request,jwt));
    }

    @GetMapping("/shipments/{id}/receipts/{receiptId}/correction")
    ProcurementService.Correction correction(@PathVariable String id,@PathVariable String receiptId) {
        return service.correction(id,receiptId);
    }

    private String actor(HttpServletRequest request,Jwt jwt) {
        if(!origin.allows(request)) throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Invalid request origin.");
        return jwt.getSubject();
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String,String>> status(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("error",error.getReason()==null?"Procurement request failed.":error.getReason()));
    }

    @ExceptionHandler(DuplicateKeyException.class)
    ResponseEntity<Map<String,String>> duplicate() {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error","This operation reference is already in use."));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HandlerMethodValidationException.class,
            MethodArgumentTypeMismatchException.class, HttpMessageNotReadableException.class})
    ResponseEntity<Map<String,String>> invalid() {
        return ResponseEntity.badRequest().body(Map.of("error","Check the purchasing or shipment fields and filters."));
    }
}
