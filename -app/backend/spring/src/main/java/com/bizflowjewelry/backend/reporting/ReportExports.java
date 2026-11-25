package com.bizflowjewelry.backend.reporting;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Objects;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

final class ReportExports {
    private static final Color GREEN=new Color(20,62,51);
    private static final Color GOLD=new Color(172,132,63);

    private ReportExports() {}

    static byte[] pdf(ReportingService.Report report) throws IOException {
        try(var document=new PDDocument(); var bytes=new ByteArrayOutputStream()) {
            var regular=new PDType1Font(Standard14Fonts.FontName.HELVETICA);
            var bold=new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD);
            var sheet=PDRectangle.A4;
            var size=report.columns().size()>5?new PDRectangle(sheet.getHeight(),sheet.getWidth()):sheet;
            int rowsPerPage=(int)((size.getHeight()-150)/17);
            int pages=Math.max(1,(report.rows().size()+rowsPerPage-1)/rowsPerPage);
            float usable=size.getWidth()-60;
            float equal=usable/(report.columns().size()+1);
            for(int i=0;i<pages;i++) {
                var page=new PDPage(size);
                document.addPage(page);
                try(var out=new PDPageContentStream(document,page)) {
                    float y=size.getHeight()-38;
                    write(out,bold,10,GOLD,30,y,report.brand().name(),usable);
                    write(out,bold,20,GREEN,30,y-24,report.title(),usable);
                    write(out,regular,9,GREEN,30,y-43,period(report),usable);
                    out.setNonStrokingColor(GREEN);
                    out.addRect(30,y-80,usable,21);
                    out.fill();
                    float x=30;
                    for(var c:report.columns()) {
                        float width=c.key().equals("label")?equal*2:equal;
                        write(out,bold,8,Color.WHITE,x+4,y-73,heading(c),width-8);
                        x+=width;
                    }
                    y-=94;
                    for(int row=i*rowsPerPage;row<Math.min(report.rows().size(),(i+1)*rowsPerPage);row++) {
                        x=30;
                        for(var c:report.columns()) {
                            float width=c.key().equals("label")?equal*2:equal;
                            String value=Objects.toString(report.rows().get(row).get(c.key()),"");
                            write(out,regular,c.numeric()?numericSize(regular,value,width-8):8,GREEN,x+4,y,value,width-8);
                            x+=width;
                        }
                        y-=17;
                    }
                    if(i==pages-1 && !report.totals().isEmpty()) {
                        x=30;
                        for(var c:report.columns()) {
                            float width=c.key().equals("label")?equal*2:equal;
                            String value=c.key().equals("label")?"Totals":Objects.toString(report.totals().get(c.key()),"");
                            write(out,bold,c.numeric()?numericSize(bold,value,width-8):8,GREEN,x+4,y,value,width-8);
                            x+=width;
                        }
                    }
                    String footer=report.title().startsWith("Sales receipt")?report.brand().receiptFooter():"";
                    write(out,regular,8,GOLD,30,20,"Page "+(i+1)+" of "+pages+(footer.isBlank()?"":" | "+footer),usable);
                }
            }
            document.save(bytes);
            return bytes.toByteArray();
        }
    }

    private static void write(PDPageContentStream out,PDType1Font font,int size,Color color,float x,float y,String value,float width) throws IOException {
        StringBuilder text=new StringBuilder();
        float used=0;
        for(int cp:value.codePoints().toArray()) {
            String character=Character.isISOControl(cp)?" ":Character.toString(cp);
            float next;
            try {
                next=font.getStringWidth(character)*size/1000;
            } catch(IllegalArgumentException unavailable) {
                character="?";
                next=font.getStringWidth(character)*size/1000;
            }
            if(used+next>width) break;
            text.append(character);
            used+=next;
        }
        out.beginText();
        out.setFont(font,size);
        out.setNonStrokingColor(color);
        out.newLineAtOffset(x,y);
        out.showText(text.toString());
        out.endText();
    }

    static byte[] excel(ReportingService.Report report) throws IOException {
        try(var workbook=new XSSFWorkbook(); var bytes=new ByteArrayOutputStream()) {
            var sheet=workbook.createSheet("Report");
            sheet.createRow(0).createCell(0).setCellValue(report.brand().name()+" | "+report.title());
            sheet.createRow(1).createCell(0).setCellValue(period(report));
            var headerStyle=workbook.createCellStyle();
            headerStyle.setFillForegroundColor(IndexedColors.DARK_GREEN.getIndex());
            headerStyle.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            Font font=workbook.createFont();
            font.setBold(true);
            font.setColor(IndexedColors.WHITE.getIndex());
            headerStyle.setFont(font);
            var dateStyle=workbook.createCellStyle();
            dateStyle.setDataFormat(workbook.createDataFormat().getFormat("yyyy-mm-dd"));
            var header=sheet.createRow(3);
            for(int i=0;i<report.columns().size();i++) {
                var column=report.columns().get(i);
                var cell=header.createCell(i);
                cell.setCellValue(heading(column));
                cell.setCellStyle(headerStyle);
                sheet.setColumnWidth(i,(column.key().equals("label")?44:22)*256);
            }
            int next=4;
            for(var data:report.rows()) {
                var row=sheet.createRow(next++);
                for(int i=0;i<report.columns().size();i++) set(row.createCell(i),data.get(report.columns().get(i).key()),dateStyle);
            }
            if(!report.totals().isEmpty()) {
                var total=sheet.createRow(next);
                for(int i=0;i<report.columns().size();i++) {
                    String key=report.columns().get(i).key();
                    set(total.createCell(i),key.equals("label")?"Totals":report.totals().get(key),dateStyle);
                }
            }
            sheet.createFreezePane(0,4);
            workbook.write(bytes);
            return bytes.toByteArray();
        }
    }

    private static void set(Cell cell,Object value,CellStyle dateStyle) {
        if(value instanceof LocalDate date) {
            cell.setCellValue(date);
            cell.setCellStyle(dateStyle);
        } else if(value instanceof Number number) {
            var integer=new BigDecimal(number.toString());
            if(integer.precision()<=15) cell.setCellValue(integer.longValueExact());
            else cell.setCellValue(integer.toPlainString());
        } else if(value!=null) cell.setCellValue(value.toString());
    }

    private static String heading(ReportingService.Column c) { return c.unit().isEmpty()?c.label():c.label().replace(" rwf","")+" ("+c.unit()+")"; }
    private static int numericSize(PDType1Font font,String value,float width) throws IOException {
        return value.isEmpty()?8:Math.max(1,Math.min(8,(int)(width*1000/font.getStringWidth(value))));
    }
    private static String period(ReportingService.Report report) {
        String scope=Objects.toString(report.from(),"Start")+" to "+Objects.toString(report.to(),"Present");
        return scope+" | "+(report.search()==null||report.search().isBlank()?report.total()+" records":report.search()+" | "+report.total()+" records");
    }
}
