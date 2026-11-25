package com.bizflowjewelry.backend.finance;

import java.math.BigInteger;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

final class FinanceRules {
    static final long MAX = 1_000_000_000_000L;
    private static final ZoneId KIGALI = ZoneId.of("Africa/Kigali");

    private FinanceRules() {}

    static LocalDate businessDate(LocalDate requested) {
        LocalDate today=LocalDate.now(KIGALI);
        if (requested!=null && requested.isAfter(today)) throw invalid("Choose a date on or before today in Kigali.");
        return requested==null?today:requested;
    }

    static long share(long value,long quantity,long total) {
        var divisor=BigInteger.valueOf(total);
        return BigInteger.valueOf(value).multiply(BigInteger.valueOf(quantity)).add(divisor.divide(BigInteger.TWO))
                .divide(divisor).longValueExact();
    }

    static long release(long value,long remaining,long minor) {
        if (minor<=0 || minor>remaining || value<=0) throw conflict("Settlement exceeds the outstanding purchase obligation.");
        long released=minor==remaining?value:Math.min(value-1,share(value,minor,remaining));
        if (released<1) throw conflict("This partial settlement rounds to zero RWF.");
        return released;
    }

    static String clean(String text) { return text==null?"":text.strip(); }
    static long reporting(long minor,String currency,long rate) {
        if(rate<1 || rate>10_000_000_000L || ("RWF".equals(currency) && rate!=1_000_000)) throw invalid("Enter the actual RWF reporting rate.");
        long amount=share(minor,rate,"RWF".equals(currency)?1_000_000:100_000_000);
        if(amount<1 || amount>MAX) throw invalid("The amount must convert to a supported positive RWF value.");
        return amount;
    }
    static String id() { return UUID.randomUUID().toString(); }
    static ResponseStatusException invalid(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST,message); }
    static ResponseStatusException missing(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND,message); }
    static ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT,message); }
}
