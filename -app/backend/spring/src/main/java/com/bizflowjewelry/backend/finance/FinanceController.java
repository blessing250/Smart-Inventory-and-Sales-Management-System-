package com.bizflowjewelry.backend.finance;

import com.bizflowjewelry.backend.auth.AuthOrigin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.HexFormat;
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
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import static com.bizflowjewelry.backend.finance.FinanceRules.*;

@RestController
@RequestMapping(path="/api/v1",produces=MediaType.APPLICATION_JSON_VALUE)
class FinanceController {
    private static final String DISCREPANCY="DAMAGE|SHORTAGE";
    private final FinanceOperations operations;
    private final FinancialPostingService finance;
    private final DiscrepancyFinance discrepancies;
    private final AuthOrigin origin;

    FinanceController(FinanceOperations operations,FinancialPostingService finance,DiscrepancyFinance discrepancies,AuthOrigin origin) {
        this.operations=operations;
        this.finance=finance;
        this.discrepancies=discrepancies;
        this.origin=origin;
    }

    record NameInput(@NotBlank @Size(max=200) String name) {}
    record CategoryInput(@NotBlank @Size(max=200) String name,Boolean active) {}
    record ExpenseInput(@NotNull @Min(1) @Max(MAX) Long amountRwf,@NotBlank @Size(max=150) String categoryId,
            @NotBlank @Size(max=150) String accountId,LocalDate date,@Size(max=150) String reference,
            @Size(max=1000) String description,@Size(max=200) String payee,@Size(max=150) String receiptReference,
            @Size(max=150) String relatedReference,@Min(1) @Max(MAX) Long sourceMinor,@Min(1) @Max(10000000000L) Long rwfRateMicros) {}
    record TransferInput(@NotBlank @Size(max=150) String reference,@NotBlank @Size(max=150) String fromAccount,
            @NotBlank @Size(max=150) String toAccount,@NotNull @Min(1) @Max(MAX) Long amountRwf,LocalDate date) {}
    record NativeAccountInput(@NotBlank @Size(max=200) String name,@NotBlank @Pattern(regexp="BANK|CASH|MOBILE_MONEY") String kind,
            @NotBlank @Pattern(regexp="USD|CNY") String currency,@Min(0) @Max(MAX) Long openingMinor,@Min(1) @Max(10000000000L) Long rwfRateMicros) {}
    record ExchangeInput(@NotBlank @Size(max=150) String reference,@NotBlank @Size(max=150) String fromAccount,
            @NotBlank @Size(max=150) String toAccount,@NotNull @Min(1) @Max(MAX) Long sourceMinor,
            @NotNull @Min(1) @Max(MAX) Long destinationMinor,@Min(0) @Max(MAX) Long feeMinor,
            @NotNull @Min(1) @Max(10000000000L) Long rwfRateMicros,@Min(1) @Max(10000000000L) Long exchangeRateMicros,LocalDate date) {}
    record ReverseInput(@NotBlank @Size(max=150) String reference,@NotBlank @Size(max=1000) String reason,LocalDate date) {}
    record SupplierAllocation(@NotBlank @Size(max=150) String purchaseId,@NotNull @Min(1) @Max(MAX) Long amountRwf,
            @Min(1) @Max(100_000_000_000_000_000L) Long payableMinor,@Min(1) @Max(MAX) Long sourceMinor) {}
    record SupplierPaymentInput(@NotBlank @Size(max=150) String reference,@NotBlank @Size(max=150) String accountId,
            LocalDate date,@NotEmpty @Size(max=100) List<@NotNull @Valid SupplierAllocation> allocations,
            @Min(1) @Max(10000000000L) Long rwfRateMicros) {}
    record ShipmentPaymentInput(@NotBlank @Size(max=150) String reference,@NotBlank @Size(max=150) String accountId,
            @NotBlank @Pattern(regexp="SHIPPING|CUSTOMS|CLEARING|OTHER") String chargeKind,
            @NotNull @Min(1) @Max(MAX) Long amountRwf,LocalDate date,@Min(1) @Max(MAX) Long sourceMinor,
            @Min(1) @Max(10000000000L) Long rwfRateMicros) {}
    record ClaimInput(@NotBlank @Size(max=150) String receiptId,@NotBlank @Size(max=150) String lineId,
            @NotBlank @Pattern(regexp=DISCREPANCY) String kind,@NotBlank @Size(max=150) String reference,
            @NotBlank @Size(max=200) String claimant,@NotNull @Min(1) @Max(MAX) Long amountRwf,@Size(max=1000) String notes) {}
    record DecisionInput(@NotNull @Min(0) @Max(MAX) Long acceptedRwf,@NotBlank @Size(max=1000) String notes) {}
    record ResolutionInput(@NotBlank @Size(max=150) String receiptId,@NotBlank @Size(max=150) String lineId,
            @NotBlank @Pattern(regexp=DISCREPANCY) String kind,@NotBlank @Pattern(regexp="CASH|CREDIT|LOSS") String action,
            @NotBlank @Size(max=150) String reference,@NotNull @Min(1) @Max(MAX) Long amountRwf,
            @Min(1) @Max(100_000_000_000_000_000L) Long payableMinor,@Size(max=150) String accountId,LocalDate date,
            @NotBlank @Size(max=1000) String notes) {}

    @GetMapping("/financial-accounts/{id}")
    FinancialPostingService.Account account(@PathVariable String id) { return finance.account(id); }
    @PostMapping("/financial-accounts/native")
    @ResponseStatus(HttpStatus.CREATED)
    FinancialPostingService.Account nativeAccount(@Valid @RequestBody NativeAccountInput body,@AuthenticationPrincipal Jwt jwt,HttpServletRequest req) {
        return finance.createNative(body.name(),body.kind(),body.currency(),body.openingMinor()==null?0:body.openingMinor(),body.rwfRateMicros(),actor(jwt,req));
    }
    @GetMapping("/financial-accounts/{id}/native-reconciliation")
    FinancialPostingService.NativeReconciliation nativeBalance(@PathVariable String id) { return finance.nativeReconciliation(id); }
    @PatchMapping("/financial-accounts/{id}")
    FinancialPostingService.Account rename(@PathVariable String id,@Valid @RequestBody NameInput body,@AuthenticationPrincipal Jwt jwt,HttpServletRequest req) {
        return finance.update(id,body.name(),false,actor(jwt,req));
    }
    @PostMapping("/financial-accounts/{id}/archive")
    FinancialPostingService.Account archive(@PathVariable String id,@AuthenticationPrincipal Jwt jwt,HttpServletRequest req) {
        return finance.update(id,null,true,actor(jwt,req));
    }

    @GetMapping("/expense-categories")
    List<FinanceOperations.Category> categories() { return operations.categories(); }
    @PostMapping("/expense-categories")
    @ResponseStatus(HttpStatus.CREATED)
    FinanceOperations.Category category(@Valid @RequestBody CategoryInput input,@AuthenticationPrincipal Jwt jwt,HttpServletRequest req) {
        return operations.category(null,input,actor(jwt,req));
    }
    @PutMapping("/expense-categories/{id}")
    FinanceOperations.Category category(@PathVariable String id,@Valid @RequestBody CategoryInput input,@AuthenticationPrincipal Jwt jwt,HttpServletRequest req) {
        return operations.category(id,input,actor(jwt,req));
    }

    @PostMapping(path="/expenses",consumes=MediaType.APPLICATION_JSON_VALUE)
    FinanceOperations.Expense expense(@Valid @RequestBody ExpenseInput input,@RequestHeader(name="Idempotency-Key",required=false) String key,
            @AuthenticationPrincipal Jwt jwt,HttpServletRequest req) {
        return operations.expense(input,key,null,actor(jwt,req));
    }
    @PostMapping(path="/expenses",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    FinanceOperations.Expense expenseFile(@Valid @RequestPart("expense") ExpenseInput input,@RequestPart(name="receipt",required=false) MultipartFile file,
            @RequestHeader(name="Idempotency-Key",required=false) String key,@AuthenticationPrincipal Jwt jwt,HttpServletRequest req) {
        String actor=actor(jwt,req);
        return operations.expense(input,key,file==null?null:receipt(file),actor);
    }
    @GetMapping("/expenses")
    FinanceOperations.Page<FinanceOperations.Expense> expenses(@RequestParam(required=false) @Size(max=150) String q,
            @RequestParam(required=false) String categoryId,@RequestParam(required=false) String accountId,
            @RequestParam(required=false) LocalDate from,@RequestParam(required=false) LocalDate to,@RequestParam(required=false) Boolean reversed,
            @RequestParam(defaultValue="0") @Min(0) int page,@RequestParam(defaultValue="25") @Min(1) @Max(100) int size) {
        return operations.expenses(q,categoryId,accountId,from,to,reversed,page,size);
    }
    @GetMapping("/expenses/category-totals")
    List<FinanceOperations.CategoryTotal> totals(@RequestParam(required=false) String categoryId,@RequestParam(required=false) String accountId,
            @RequestParam(required=false) LocalDate from,@RequestParam(required=false) LocalDate to) {
        return operations.expenseTotals(categoryId,accountId,from,to);
    }
    @GetMapping("/expenses/{id}")
    FinanceOperations.Expense expense(@PathVariable String id) { return operations.expense(id); }
    @GetMapping("/expenses/{id}/receipts")
    List<FinanceOperations.Attachment> receipts(@PathVariable String id) { return operations.attachments(id); }
    @PostMapping(path="/expenses/{id}/receipts",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    FinanceOperations.Attachment attach(@PathVariable String id,@RequestPart("receipt") MultipartFile file,
            @AuthenticationPrincipal Jwt jwt,HttpServletRequest req) {
        String actor=actor(jwt,req);
        return operations.attach(id,receipt(file),actor);
    }
    @GetMapping(path="/expenses/{id}/receipts/{receiptId}",produces=MediaType.ALL_VALUE)
    ResponseEntity<byte[]> download(@PathVariable String id,@PathVariable String receiptId) {
        var file=operations.attachment(id,receiptId);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(file.mediaType())).cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION,ContentDisposition.attachment().filename(file.filename(),StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options","nosniff").body(file.contents());
    }

    @GetMapping("/finance/transactions")
    FinanceOperations.Page<FinanceOperations.Transaction> transactions(@RequestParam(required=false) @Pattern(regexp=
            "OPENING|CUSTOMER_PAYMENT|CUSTOMER_REFUND|REVERSAL|OPERATING_EXPENSE|SUPPLIER_PAYMENT|SHIPMENT_PAYMENT|TRANSFER|EXCHANGE|CLAIM_CASH") String kind,
            @RequestParam(required=false) String accountId,@RequestParam(required=false) LocalDate from,@RequestParam(required=false) LocalDate to,
            @RequestParam(required=false) Boolean reversed,@RequestParam(defaultValue="0") @Min(0) int page,
            @RequestParam(defaultValue="25") @Min(1) @Max(100) int size) {
        return operations.transactions(kind,accountId,from,to,reversed,page,size);
    }
    @GetMapping("/finance/transactions/{id}")
    FinanceOperations.Transaction transaction(@PathVariable String id) { return operations.transaction(id); }
    @PostMapping("/finance/transactions/{id}/reverse")
    FinanceOperations.Transaction reverse(@PathVariable String id,@Valid @RequestBody ReverseInput input,@AuthenticationPrincipal Jwt jwt,HttpServletRequest req) {
        return operations.reverse(id,input,actor(jwt,req));
    }
    @PostMapping("/finance/transfers")
    FinanceOperations.Transaction transfer(@Valid @RequestBody TransferInput input,@AuthenticationPrincipal Jwt jwt,HttpServletRequest req) {
        return operations.transfer(input,actor(jwt,req));
    }
    @PostMapping("/finance/exchanges")
    FinanceOperations.Transaction exchange(@Valid @RequestBody ExchangeInput input,@AuthenticationPrincipal Jwt jwt,HttpServletRequest req) {
        return operations.exchange(input,actor(jwt,req));
    }
    @GetMapping("/finance/reconciliation")
    FinanceOperations.Reconciliation reconciliation() { return operations.reconcile(); }

    @GetMapping("/suppliers/{id}/obligations")
    List<FinanceOperations.Obligation> obligations(@PathVariable String id) { return operations.obligations(id); }
    @GetMapping("/suppliers/{id}/payments")
    FinanceOperations.Page<FinanceOperations.Transaction> supplierPayments(@PathVariable String id,
            @RequestParam(defaultValue="0") @Min(0) int page,@RequestParam(defaultValue="25") @Min(1) @Max(100) int size) {
        return operations.supplierPayments(id,page,size);
    }
    @GetMapping("/suppliers/{id}/payments/{paymentId}")
    FinanceOperations.SupplierPayment supplierPayment(@PathVariable String id,@PathVariable String paymentId) {
        return operations.supplierPayment(id,paymentId);
    }
    @PostMapping("/suppliers/{id}/payments")
    FinanceOperations.SupplierPayment supplierPay(@PathVariable String id,@Valid @RequestBody SupplierPaymentInput input,
            @AuthenticationPrincipal Jwt jwt,HttpServletRequest req) {
        return operations.supplierPay(id,input,actor(jwt,req));
    }
    @GetMapping("/shipments/{id}/charge-balances")
    List<FinanceOperations.Charge> shipmentCharges(@PathVariable String id) { return operations.shipmentCharges(id); }
    @GetMapping("/shipments/{id}/payments")
    FinanceOperations.Page<FinanceOperations.Transaction> shipmentPayments(@PathVariable String id,
            @RequestParam(defaultValue="0") @Min(0) int page,@RequestParam(defaultValue="25") @Min(1) @Max(100) int size) {
        return operations.shipmentPayments(id,page,size);
    }
    @PostMapping("/shipments/{id}/payments")
    FinanceOperations.Transaction shipPay(@PathVariable String id,@Valid @RequestBody ShipmentPaymentInput input,
            @AuthenticationPrincipal Jwt jwt,HttpServletRequest req) {
        return operations.shipmentPay(id,input,actor(jwt,req));
    }
    @GetMapping("/shipments/{id}/financial-reconciliation")
    FinanceOperations.ShipmentSummary shipmentSummary(@PathVariable String id) { return operations.shipmentSummary(id); }
    @GetMapping("/shipments/{id}/claims")
    List<DiscrepancyFinance.Discrepancy> discrepancies(@PathVariable String id) { return discrepancies.list(id); }
    @PostMapping("/shipments/{id}/claims")
    @ResponseStatus(HttpStatus.CREATED)
    DiscrepancyFinance.Claim claim(@PathVariable String id,@Valid @RequestBody ClaimInput input,@AuthenticationPrincipal Jwt jwt,HttpServletRequest req) {
        return discrepancies.submit(id,input,actor(jwt,req));
    }
    @PostMapping("/shipments/{id}/claims/{claimId}/decision")
    DiscrepancyFinance.Claim decide(@PathVariable String id,@PathVariable String claimId,@Valid @RequestBody DecisionInput input,
            @AuthenticationPrincipal Jwt jwt,HttpServletRequest req) {
        return discrepancies.decide(id,claimId,input,actor(jwt,req));
    }
    @PostMapping("/shipments/{id}/resolutions")
    @ResponseStatus(HttpStatus.CREATED)
    DiscrepancyFinance.Resolution resolve(@PathVariable String id,@Valid @RequestBody ResolutionInput input,@AuthenticationPrincipal Jwt jwt,HttpServletRequest req) {
        return discrepancies.resolve(id,input,actor(jwt,req));
    }

    private String actor(Jwt jwt,HttpServletRequest req) {
        if(!origin.allows(req)) throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Invalid request origin.");
        return jwt.getSubject();
    }

    private static FinanceOperations.ReceiptFile receipt(MultipartFile file) {
        if(file.isEmpty() || file.getSize()>2_097_152) throw invalid("Choose a receipt file up to 2 MiB.");
        byte[] bytes;
        try {
            bytes=file.getBytes();
        } catch(IOException e) {
            throw invalid("The receipt could not be read.");
        }
        String header=HexFormat.of().formatHex(bytes,0,Math.min(12,bytes.length));
        String mime;
        if(header.startsWith("255044462d")) mime="application/pdf";
        else if(header.startsWith("89504e470d0a1a0a")) mime="image/png";
        else if(header.startsWith("ffd8ff")) mime="image/jpeg";
        else if(header.matches("52494646.{8}57454250")) mime="image/webp";
        else throw invalid("Choose a PDF, PNG, JPEG or WebP receipt.");
        String name=clean(file.getOriginalFilename()).replaceAll("[\\\\/\\p{Cntrl}]", "_");
        if(name.isBlank()) name="receipt";
        return new FinanceOperations.ReceiptFile(name.substring(0,Math.min(name.length(),200)),mime,bytes);
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String,String>> status(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("error",error.getReason()==null?"Finance request failed.":error.getReason()));
    }
    @ExceptionHandler(DuplicateKeyException.class)
    ResponseEntity<Map<String,String>> duplicate() {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error","A financial reference or name is already in use."));
    }
    @ExceptionHandler({MethodArgumentNotValidException.class,HandlerMethodValidationException.class,HttpMessageNotReadableException.class,
            MethodArgumentTypeMismatchException.class,MaxUploadSizeExceededException.class})
    ResponseEntity<Map<String,String>> badRequest() {
        return ResponseEntity.badRequest().body(Map.of("error","Check the financial fields, filters or receipt size."));
    }
}
