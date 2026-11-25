package com.bizflowjewelry.backend.reporting;

import jakarta.validation.constraints.*;
import java.io.IOException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/reports")
class ReportingController {
    private final ReportingService reports;
    ReportingController(ReportingService reports) { this.reports=reports; }

    @GetMapping("/{kind}")
    ReportingService.Report report(@PathVariable String kind,@RequestParam(defaultValue="day") String group,
            @RequestParam(required=false) LocalDate from,@RequestParam(required=false) LocalDate to,
            @RequestParam(required=false) @Size(max=150) String q,@RequestParam(defaultValue="0") @Min(0) int page,
            @RequestParam(defaultValue="25") @Min(1) @Max(100) int size) {
        return reports.report(kind,group,from,to,q,page,size,false);
    }

    @GetMapping("/{kind}/export")
    ResponseEntity<byte[]> export(@PathVariable String kind,@RequestParam(defaultValue="day") String group,
            @RequestParam @Pattern(regexp="pdf|xlsx") String format,@RequestParam(required=false) LocalDate from,
            @RequestParam(required=false) LocalDate to,@RequestParam(required=false) @Size(max=150) String q) throws IOException {
        var report=reports.report(kind,group,from,to,q,0,1,true);
        return export(report,kind,format);
    }

    @GetMapping("/sale-receipt/{id}/export")
    ResponseEntity<byte[]> receipt(@PathVariable String id,@RequestParam @Pattern(regexp="pdf|xlsx") String format) throws IOException {
        return export(reports.saleReceipt(id),"sale-receipt",format);
    }

    private ResponseEntity<byte[]> export(ReportingService.Report report,String kind,String format) throws IOException {
        boolean pdf="pdf".equals(format);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .contentType(MediaType.parseMediaType(pdf?"application/pdf":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .header(HttpHeaders.CONTENT_DISPOSITION,ContentDisposition.attachment().filename("bizflow-"+kind+"."+format).build().toString())
                .body(pdf?ReportExports.pdf(report):ReportExports.excel(report));
    }

    @GetMapping("/dashboard")
    List<Map<String,Object>> dashboard(@RequestParam LocalDate from,@RequestParam LocalDate to) {
        return reports.salesTrend(from,to);
    }
}
