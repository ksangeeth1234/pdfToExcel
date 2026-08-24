# PDF to Excel Studio

A browser-based utility for extracting structured student register tables from PDF files and exporting them to a readable Excel workbook.

## Features

- Drag and drop or select one or more PDF files
- Processes PDF content locally in the browser
- Detects programme tables and student rows
- Combines multiple PDFs into one worksheet
- Preserves table colors and withdrawn-row italics
- Shows an extraction preview before download
- Exports a styled `.xlsx` workbook

## Run Locally

No build step is required. Open `index.html` in a modern browser, or serve the folder with a local web server.

For example, with XAMPP, place the project inside `htdocs` and open:

```text
http://localhost/php/pdf%20to%20excel/
```

The application loads PDF.js and the XLSX styling library from public CDNs, so an internet connection is required when the page loads.

## Usage

1. Open the application.
2. Drop PDF files onto the upload area, or select them with **Choose PDF**.
3. Review the extracted tables and student-row count.
4. Select **Download .xlsx** to save the workbook.
5. Use **Add PDF pack** to append another set of PDF tables.

Only PDF files with selectable text can be processed. Scanned image-only PDFs need OCR before extraction.

## Project Files

- `index.html` - Application structure and external library loading
- `styles.css` - Layout, responsive styles, and visual design
- `app.js` - PDF parsing, table detection, preview rendering, and Excel export

## Privacy

PDF processing happens in the browser. The selected files are not uploaded to an application server.

## Author

Created by [ksangeeth1234](https://github.com/ksangeeth1234)

- GitHub: https://github.com/ksangeeth1234
