package com.bizflowjewelry.backend.sales;

import com.bizflowjewelry.backend.auth.AuthOrigin;
import com.bizflowjewelry.backend.finance.FinancialPostingService;
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
@RequestMapping(path="/api/v1", produces=MediaType.APPLICATION_JSON_VALUE)
class SalesController {
    private final SalesService sales;
    private final OnlineOrderService orders;
    private final FinancialPostingService finance;
    private final AuthOrigin origin;

    SalesController(SalesService sales, OnlineOrderService orders, FinancialPostingService finance, AuthOrigin origin) {
        this.sales = sales;
        this.orders = orders;
        this.finance = finance;
        this.origin = origin;
    }

    record CustomerInput(@NotBlank @Size(max=200) String name, @Size(max=200) String phone,
                         @Email @Size(max=254) String email) {}
    record AccountInput(@NotBlank @Size(max=200) String name, @NotBlank @Pattern(regexp="CASH|BANK|MOBILE_MONEY") String kind,
                        @Min(0) @Max(1_000_000_000_000L) Long openingRwf) {}
    record LineInput(@NotBlank @Size(max=150) String productId, @Min(1) @Max(1_000_000) long quantity,
                     @Min(0) @Max(1_000_000_000) Long unitPriceRwf, @Min(0) @Max(1_000_000_000) Long unitDiscountRwf) {}
    record PaymentInput(@NotBlank @Size(max=150) String reference, @NotBlank @Size(max=150) String accountId,
                        @NotBlank @Pattern(regexp="CASH|BANK|MOBILE_MONEY") String method,
                        @Min(1) @Max(1_000_000_000_000L) long amountRwf) {}
    record SaleInput(@NotBlank @Size(max=150) String reference, @NotNull LocalDate date,
                     @NotBlank @Size(max=100) String channel, @Size(max=150) String customerId,
                     @Size(max=200) String customerName, @NotEmpty @Size(max=100) List<@NotNull @Valid LineInput> items,
                     @Size(max=10) List<@NotNull @Valid PaymentInput> payments) {}
    record ReturnInput(@NotBlank @Size(max=150) String reference, @NotBlank @Size(max=150) String itemId,
                       @Min(1) @Max(1_000_000) long quantity, @NotBlank @Size(max=1000) String reason,
                       @NotBlank @Pattern(regexp="USABLE|DAMAGED") String condition, @Size(max=150) String refundAccountId) {}
    record ReversalInput(@NotBlank @Size(max=150) String reference, @NotBlank @Size(max=1000) String reason) {}
    record OrderItemInput(@NotBlank @Size(max=150) String productId, @Min(1) @Max(1_000_000) long quantity) {}
    record OrderInput(@NotBlank @Size(max=150) String reference, @Size(max=150) String customerId,
                      @Size(max=200) String customerName, @NotBlank @Size(max=200) String contact,
                      @NotBlank @Size(max=100) String source, @NotEmpty @Size(max=100) List<@NotNull @Valid OrderItemInput> items) {}
    record ConfirmInput(@NotNull LocalDate date, @Size(max=10) List<@NotNull @Valid PaymentInput> payments) {}
    record FulfillmentInput(@NotBlank @Pattern(regexp="PENDING|READY|DELIVERED|COLLECTED") String status) {}

    @PostMapping("/customers")
    @ResponseStatus(HttpStatus.CREATED)
    SalesService.Customer createCustomer(@Valid @RequestBody CustomerInput body, @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        return sales.createCustomer(body, actor(jwt, request));
    }

    @GetMapping("/customers")
    SalesService.Page<SalesService.Customer> customers(@RequestParam(required=false) @Size(max=150) String q,
            @RequestParam(defaultValue="0") @Min(0) int page, @RequestParam(defaultValue="25") @Min(1) @Max(100) int size) {
        return sales.customers(q, page, size);
    }

    @GetMapping("/customers/{id}/sales")
    SalesService.Page<SalesService.Sale> customerSales(@PathVariable String id,
            @RequestParam(defaultValue="0") @Min(0) int page, @RequestParam(defaultValue="25") @Min(1) @Max(100) int size) {
        return sales.customerSales(id, page, size);
    }

    @GetMapping("/customers/{id}/balance")
    SalesService.CustomerBalance customerBalance(@PathVariable String id) {
        return sales.customerBalance(id);
    }

    @GetMapping("/financial-accounts")
    List<FinancialPostingService.Account> accounts() {
        return finance.accounts();
    }

    @PostMapping("/financial-accounts")
    @ResponseStatus(HttpStatus.CREATED)
    FinancialPostingService.Account account(@Valid @RequestBody AccountInput body, @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        long opening = body.openingRwf() == null ? 0 : body.openingRwf();
        return finance.create(body.name(), body.kind(), opening, actor(jwt, request));
    }

    @GetMapping("/financial-accounts/{id}/reconciliation")
    FinancialPostingService.Reconciliation accountReconciliation(@PathVariable String id) {
        return finance.reconciliation(id);
    }

    @GetMapping("/sales")
    SalesService.Page<SalesService.Sale> list(@RequestParam(required=false) @Size(max=150) String q,
            @RequestParam(required=false) @Pattern(regexp="PAID|PARTIAL|UNPAID|RETURNED") String status,
            @RequestParam(required=false) LocalDate from, @RequestParam(required=false) LocalDate to,
            @RequestParam(defaultValue="0") @Min(0) int page, @RequestParam(defaultValue="25") @Min(1) @Max(100) int size) {
        return sales.list(q, status, from, to, null, page, size);
    }

    @PostMapping("/sales")
    SalesService.SaleDetail createSale(@Valid @RequestBody SaleInput body, @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        return sales.checkout(body, actor(jwt, request));
    }

    @GetMapping("/sales/{id}")
    SalesService.SaleDetail sale(@PathVariable String id) {
        return sales.detail(id);
    }

    @GetMapping("/sales/{id}/reconciliation")
    SalesService.Reconciliation reconciliation(@PathVariable String id) {
        return sales.reconcile(id);
    }

    @GetMapping("/sales/{id}/payments")
    List<SalesService.Payment> payments(@PathVariable String id) {
        return sales.payments(id);
    }

    @PostMapping("/sales/{id}/payments")
    @ResponseStatus(HttpStatus.CREATED)
    SalesService.Payment createPayment(@PathVariable String id, @Valid @RequestBody PaymentInput body,
            @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        return sales.pay(id, body, actor(jwt, request));
    }

    @PostMapping("/sales/{id}/payments/{paymentId}/reverse")
    SalesService.Payment reversePayment(@PathVariable String id, @PathVariable String paymentId, @Valid @RequestBody ReversalInput body,
            @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        return sales.reverse(id, paymentId, body, actor(jwt, request));
    }

    @GetMapping("/sales/{id}/returns")
    List<SalesService.Return> returns(@PathVariable String id) {
        return sales.returns(id);
    }

    @PostMapping("/sales/{id}/returns")
    SalesService.Return createReturn(@PathVariable String id, @Valid @RequestBody ReturnInput body,
            @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        return sales.returnItem(id, body, actor(jwt, request));
    }

    @GetMapping("/online-orders")
    SalesService.Page<OnlineOrderService.Order> orders(@RequestParam(required=false) @Pattern(regexp="PENDING|CONFIRMED|CANCELLED") String status,
            @RequestParam(defaultValue="0") @Min(0) int page, @RequestParam(defaultValue="25") @Min(1) @Max(100) int size) {
        return orders.list(status, page, size);
    }

    @PostMapping("/online-orders")
    @ResponseStatus(HttpStatus.CREATED)
    OnlineOrderService.OrderDetail createOrder(@Valid @RequestBody OrderInput body, @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        return orders.create(body, actor(jwt, request));
    }

    @GetMapping("/online-orders/{id}")
    OnlineOrderService.OrderDetail order(@PathVariable String id) {
        return orders.detail(id);
    }

    @PostMapping("/online-orders/{id}/confirm")
    OnlineOrderService.OrderDetail confirm(@PathVariable String id, @Valid @RequestBody ConfirmInput body,
            @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        return orders.confirm(id, body, actor(jwt, request));
    }

    @PostMapping("/online-orders/{id}/cancel")
    OnlineOrderService.OrderDetail cancel(@PathVariable String id, @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        return orders.cancel(id, actor(jwt, request));
    }

    @PutMapping("/online-orders/{id}/fulfillment")
    OnlineOrderService.OrderDetail fulfill(@PathVariable String id, @Valid @RequestBody FulfillmentInput body,
            @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        return orders.fulfill(id, body.status(), actor(jwt, request));
    }

    private String actor(Jwt jwt, HttpServletRequest request) {
        if (!origin.allows(request)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Invalid request origin.");
        return jwt.getSubject();
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String,String>> status(ResponseStatusException error) {
        String reason = error.getReason() == null ? "The sales request failed." : error.getReason();
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("error", reason));
    }

    @ExceptionHandler(DuplicateKeyException.class)
    ResponseEntity<Map<String,String>> duplicate() {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "A reference or account name is already in use."));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HandlerMethodValidationException.class,
            MethodArgumentTypeMismatchException.class, HttpMessageNotReadableException.class})
    ResponseEntity<Map<String,String>> invalid() {
        return ResponseEntity.badRequest().body(Map.of("error", "Check the request fields and filters."));
    }
}
