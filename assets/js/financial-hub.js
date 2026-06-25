// ===== FINANCIAL HUB - All Functions =====

let pyodide = null;
let currentData = [];
let currentBank = '';
let pyodideReady = false;

// PDF.js setup
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// Initialize Pyodide with better error handling
async function initPyodide() {
    const initStatus = document.getElementById('initStatus');
    const convertBtn = document.getElementById('convertBtn');

    if (!initStatus) return;

    try {
        initStatus.innerHTML = '⏳ Loading Python runtime (this may take 10-15 seconds)...';
        initStatus.style.background = 'rgba(102, 126, 234, 0.15)';
        initStatus.style.borderLeftColor = '#667eea';

        // Load Pyodide
        pyodide = await loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/"
        });

        initStatus.innerHTML = '📥 Loading packages (micropip, openpyxl)...';
        await pyodide.loadPackage("micropip");

        // Install openpyxl
        await pyodide.runPythonAsync(`
import micropip
await micropip.install('openpyxl')
print("✅ openpyxl installed successfully")
        `);

        initStatus.innerHTML = '🎨 Registering bank parsers...';

        // Python code for bank parsing
        const pythonCode = `
import io
import base64
import json
import re
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

DEFAULT_TX_REGEX = re.compile(
    r'^(?P<date>\\d{2}/\\d{2})\\s+'
    r'(?P<header>.+?)\\s+'
    r'(?P<amount>(?:\\d{1,3}(?:\\,\\d{3})*|\\d+)?\\.\\d{2})'
    r'\\s*(?P<sign>[+-])?\\s+'
    r'(?P<balance>(?:\\d{1,3}(?:\\,\\d{3})*|\\d+)?\\.\\d{2})$'
)

def parse_page(page_text, start_markers, footer_keywords, tx_regex=DEFAULT_TX_REGEX):
    rows = []
    current = None
    lines = page_text.splitlines()
    start_idx = 0
    for i, line in enumerate(lines):
        line = line.strip()
        if any(m.lower() in line.lower() for m in start_markers):
            start_idx = i + 1
            break
    for line in lines[start_idx:]:
        line = line.strip()
        if not line: continue
        if any(f.lower() in line.lower() for f in footer_keywords): break
        date_match = re.match(r'^(\\d{2}/\\d{2})', line)
        if date_match:
            match = tx_regex.search(line)
            if current: rows.append(current)
            if match:
                amount_str = match.group('amount').replace(',', '') if match.group('amount') else '0.0'
                balance_str = match.group('balance').replace(',', '') if match.group('balance') else '0.0'
                amount = float(amount_str) if amount_str else 0.0
                balance = float(balance_str) if balance_str else 0.0
                sign = match.group('sign') if 'sign' in match.groupdict() and match.group('sign') else '+'
                current = {
                    'Date': match.group('date'),
                    'Bank Remark': match.group('header').strip(),
                    'Debit': amount if sign == '-' else '',
                    'Credit': amount if sign == '+' or sign == '' else '',
                    'Balance': balance
                }
            else:
                current = {
                    'Date': line[:5],
                    'Bank Remark': line[6:].strip(),
                    'Debit': '',
                    'Credit': '',
                    'Balance': ''
                }
        else:
            if current: current['Bank Remark'] += ' ' + line
    if current: rows.append(current)
    return rows

def clean_val(val):
    if not val: return 0.0
    return float(val.replace(',', '').strip())

def parse_bank_islam_page(page_text):
    lines = [l.strip() for l in page_text.splitlines() if l.strip()]
    BANK_ISLAM_SKIP_KEYWORDS = [
        'sekiranya anda mendapati', 'if you note any discrepancies', 'untuk pertanyaan',
        'ringkasan akaun', 'summary of account', 'total debit', 'total credit',
        'monthly average', 'tarikh penyata', 'statement date', 'halaman', 'page',
        'nombor akaun', 'account no', 'cawangan', 'branch', 'penyata akaun', 'account statement'
    ]
    raw_page_rows = []
    current = None
    def clean_numeric(value):
        if not value: return None
        try: return float(value.replace(',', ''))
        except ValueError: return None
    for line in lines:
        if any(f in line.lower() for f in BANK_ISLAM_SKIP_KEYWORDS): continue
        date_match = re.match(r'^(\\d{1,2}/\\d{2}/\\d{2,4})', line)
        if date_match:
            date_str = date_match.group(1)
            remaining = line[len(date_str):].strip()
            if 'BAL B/F' in remaining.upper() or 'BALANCE B/F' in remaining.upper(): continue
            if current: raw_page_rows.append(current)
            parts = re.findall(r'(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2}))', remaining)
            balance = clean_numeric(parts[-1]) if len(parts) >= 1 else None
            debit = ''
            credit = ''
            if len(parts) == 3:
                debit = clean_numeric(parts[0])
                credit = clean_numeric(parts[1])
            elif len(parts) == 2:
                val = clean_numeric(parts[0])
                header_upper = remaining.upper()
                if any(k in header_upper for k in ['MB', 'IB', 'QR', 'JOMPAY', 'FPX', 'DEBIT', 'CHG']): debit = val
                else: credit = val
            desc = remaining
            for p in parts: desc = desc.replace(p, '').strip()
            current = {
                'Date': date_str,
                'Bank Remark': desc,
                'Debit': debit if debit else '',
                'Credit': credit if credit else '',
                'Balance': balance if balance else ''
            }
        elif current and not any(m in line.upper() for m in ['TARIKH', 'DATE', 'BALANCE', 'HALAMAN', 'DESCRIPTION', '(RM)']):
            current['Bank Remark'] += ' ' + line
    if current: raw_page_rows.append(current)
    return raw_page_rows

def parse_public_bank_page(page_text):
    rows = []
    lines = [l.strip() for l in page_text.splitlines() if l.strip()]
    SKIP_KEYWORDS = ['balance b/f', 'balance c/f', 'balance from last statement', 'tarikh', 'date', 'urus niaga']
    current = None
    last_date = ''
    def clean_val(val):
        if not val: return None
        try: return float(val.replace(',', ''))
        except ValueError: return None
    for line in lines:
        date_match = re.match(r'^(\\d{2}/\\d{2})', line)
        parts = re.findall(r'(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2}))', line)
        if date_match or (len(parts) >= 1 and not any(k in line.lower() for k in SKIP_KEYWORDS)):
            if date_match:
                last_date = date_match.group(1)
                content = line[len(last_date):].strip()
            else: content = line
            if any(k in content.lower() for k in SKIP_KEYWORDS): continue
            if current: rows.append(current)
            debit = None
            credit = None
            balance = None
            if len(parts) >= 2:
                balance = clean_val(parts[-1])
                val = clean_val(parts[-2])
                content_upper = content.upper()
                is_credit = any(x in content_upper for x in [' CR ', 'CR ', 'CR-', 'KREDIT'])
                if 'CR CARD PYMT' in content_upper: is_credit = False
                if 'DEP-ECP' in content_upper: is_credit = True
                if is_credit: credit = val
                else: debit = val
            elif len(parts) == 1: balance = clean_val(parts[0])
            desc = content
            for p in parts: desc = desc.replace(p, '').strip()
            current = {
                'Date': last_date,
                'Bank Remark': desc,
                'Debit': debit if debit else '',
                'Credit': credit if credit else '',
                'Balance': balance if balance else ''
            }
        elif current:
            if not any(k in line for k in ['Muka Surat', 'Page', 'Penyata ini', 'BERHAD']): current['Bank Remark'] += ' ' + line
    if current: rows.append(current)
    return rows

def find_cimb_opening_bal(statement_text):
    match = re.search(r'Opening Balance\\s+([\\d,]+\\.\\d{2})', statement_text, re.IGNORECASE)
    if match: return float(match.group(1).replace(',', ''))
    return 0.00

def parse_cimb_page(page_text):
    rows = []
    lines = [l.strip() for l in page_text.splitlines() if l.strip()]
    CIMB_IGNORE = [
        "Statement of Account", "Page / Halaman", "CONTINUE NEXT", "Opening Balance",
        "CLOSING BALANCE", "No of Withdrawal", "No of Deposits"
    ]
    def clean_numeric(val):
        if not val: return 0.0
        try: return float(val.replace(",", "").strip())
        except ValueError: return 0.0
    current = None
    for line in lines:
        if any(k in line for k in CIMB_IGNORE): continue
        date_match = re.match(r"^(\\d{2}/\\d{2}/\\d{2,4})\\s+([A-Za-z*])", line)
        if date_match:
            if current: rows.append(current)
            date_str = date_match.group(1)
            content = line[len(date_str):].strip()
            parts = re.findall(r"(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2}))", content)
            balance = clean_numeric(parts[-1]) if parts else 0.0
            row_amount = clean_numeric(parts[-2]) if len(parts) >= 2 else 0.0
            desc = content
            for p in parts: desc = desc.replace(p, "").strip()
            current = {
                "Date": date_str,
                "Bank Remark": desc,
                "Amount": row_amount,
                "Debit": 0.0,
                "Credit": 0.0,
                "Balance": balance,
                "Prev Bal": 0.0
            }
        elif current and not any(m in line for m in ["Date", "Tarikh", "Description"]):
            current["Bank Remark"] += " " + line
    if current: rows.append(current)
    return rows

def convert_bank(pdf_text, bank_name):
    if bank_name == 'Bank Islam': return parse_bank_islam_page(pdf_text)
    elif bank_name == 'Public Bank': return parse_public_bank_page(pdf_text)
    elif bank_name == 'CIMB': return parse_cimb_page(pdf_text)
    elif bank_name == 'Maybank': return parse_page(pdf_text, ['BEGINNING BALANCE', 'ENTRY DATE'], ['ENDING BALANCE', 'BAKI LEGAR'])
    elif bank_name == 'Agrobank': return parse_page(pdf_text, ['BEGINNING BALANCE', 'PREVIOUS STMT BAL'], ['CLOSING BALANCE', 'BAKI LEGAR'])
    elif bank_name == 'AmBank': return parse_page(pdf_text, ['Balance b/f', 'CHEQUE NO.'], ['CLOSING BALANCE', 'BAKI LEGAR'])
    return []

def process_all_pages_together(all_pages_text, bank_name, first_page_text):
    all_rows = []
    opening_balance = find_cimb_opening_bal(first_page_text)
    current_balance = opening_balance
    for page_text in all_pages_text:
        page_rows = convert_bank(page_text, bank_name)
        if bank_name == 'CIMB' and page_rows:
            for row in page_rows:
                row["Prev Bal"] = current_balance
                diff = round(row["Balance"] - row["Prev Bal"], 2)
                if diff < 0:
                    row["Debit"] = abs(diff)
                    row["Credit"] = 0.0
                else:
                    row["Credit"] = diff
                    row["Debit"] = 0.0
                current_balance = row["Balance"]
        all_rows.extend(page_rows)
    return json.dumps(all_rows)

def generate_pro_amort_excel_bytes(principal, annual_rate, years, method):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Amortization Schedule'
    font_name = 'Segoe UI'
    title_font = Font(name=font_name, size=16, bold=True, color='1A365D')
    label_font = Font(name=font_name, size=10, bold=True, color='2D3748')
    reg_font = Font(name=font_name, size=10, color='2D3748')
    header_font = Font(name=font_name, size=11, bold=True, color='FFFFFF')
    total_font = Font(name=font_name, size=10, bold=True, color='000000')
    header_fill = PatternFill(start_color='2B6CB0', end_color='2B6CB0', fill_type='solid')
    zebra_fill = PatternFill(start_color='F7FAFC', end_color='F7FAFC', fill_type='solid')
    thin_side = Side(border_style='thin', color='E2E8F0')
    double_side = Side(border_style='double', color='4A5568')
    grid_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)
    summary_border = Border(top=thin_side, bottom=double_side)
    ws['A1'] = 'LOAN AMORTIZATION SCHEDULE'
    ws['A1'].font = title_font
    metadata = [
        ('Base Loan Principal:', principal, 'RM #,##0.00'),
        ('Nominal Annual Rate:', annual_rate / 100, '0.00%'),
        ('Term Horizon (Years):', years, '0'),
        ('Calculation Framework:', method.title(), '@')
    ]
    for idx, (label, val, num_format) in enumerate(metadata, start=3):
        ws[f'A{idx}'] = label
        ws[f'A{idx}'].font = label_font
        ws[f'B{idx}'] = val
        ws[f'B{idx}'].font = reg_font
        ws[f'B{idx}'].number_format = num_format
        ws[f'B{idx}'].alignment = Alignment(horizontal='left')
    headers = ['Month', 'Scheduled Payment', 'Principal Component', 'Interest Component', 'Remaining Balance']
    start_row = 8
    for col_idx, text in enumerate(headers, start=1):
        cell = ws.cell(row=start_row, column=col_idx, value=text)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal='center' if col_idx == 1 else 'right', vertical='center')
        cell.border = grid_border
    total_months = int(years * 12)
    data_start = start_row + 1
    ws.cell(row=data_start, column=5, value=principal).number_format = 'RM #,##0.00'
    ws.cell(row=data_start, column=5).font = reg_font
    for m in range(1, total_months + 1):
        prev_row = data_start + m - 1
        curr_row = data_start + m
        r_str = str(curr_row)
        ws.cell(row=curr_row, column=1, value=m).alignment = Alignment(horizontal='center')
        if method == 'reducing':
            rate_var = '($B$4/12)'
            ws.cell(row=curr_row, column=2, value=f'=ROUND((E{prev_row}*{rate_var})/(1-(1+{rate_var})^(-({total_months}-{m}+1))), 2)')
            ws.cell(row=curr_row, column=4, value=f'=ROUND(E{prev_row}*{rate_var}, 2)')
            ws.cell(row=curr_row, column=3, value=f'=B{r_str}-D{r_str}')
            ws.cell(row=curr_row, column=5, value=f'=MAX(0, ROUND(E{prev_row}-C{r_str}, 2))')
        else:
            ws.cell(row=curr_row, column=2, value=f'=ROUND(($B$3 + ($B$3 * $B$4 * $B$5)) / {total_months}, 2)')
            ws.cell(row=curr_row, column=4, value=f'=ROUND(($B$3 * $B$4 * $B$5) / {total_months}, 2)')
            ws.cell(row=curr_row, column=3, value=f'=B{r_str}-D{r_str}')
            ws.cell(row=curr_row, column=5, value=f'=MAX(0, ROUND(E{prev_row}-C{r_str}, 2))')
        for col_idx in range(1, 6):
            c = ws.cell(row=curr_row, column=col_idx)
            c.font = reg_font
            c.border = grid_border
            if col_idx > 1: c.number_format = 'RM #,##0.00'
            if m % 2 == 0: c.fill = zebra_fill
    total_row = data_start + total_months + 1
    ws.cell(row=total_row, column=1, value='Total Summary').font = total_font
    ws.cell(row=total_row, column=1).border = summary_border
    for col_idx, letter in enumerate(['B', 'C', 'D'], start=2):
        cell = ws.cell(row=total_row, column=col_idx, value=f'=SUM({letter}{data_start + 1}:{letter}{total_row - 1})')
        cell.font = total_font
        cell.number_format = 'RM #,##0.00'
        cell.border = summary_border
    for col in ws.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 14)
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return base64.b64encode(buffer.getvalue()).decode('utf-8')

print("✅ Bank parsers loaded successfully!")
`;

        await pyodide.runPythonAsync(pythonCode);

        pyodideReady = true;

        initStatus.innerHTML = '✅ Ready! Python engine loaded successfully.';
        initStatus.style.background = 'rgba(46, 160, 67, 0.15)';
        initStatus.style.borderLeftColor = '#48bb78';
        if (convertBtn) convertBtn.disabled = false;

        setTimeout(() => {
            if (initStatus) initStatus.style.display = 'none';
        }, 3000);

    } catch (error) {
        console.error('Pyodide error:', error);
        if (initStatus) {
            initStatus.innerHTML = '❌ Failed to load: ' + error.message + '<br><br>💡 Tip: Try opening via local server (http://localhost:8000) instead of file://';
            initStatus.style.background = 'rgba(229, 62, 62, 0.15)';
            initStatus.style.borderLeftColor = '#fc8181';
        }
        pyodideReady = false;
    }
}

// Extract text from PDF page
function extractTextFromPage(page) {
    return new Promise((resolve) => {
        page.getTextContent().then(textContent => {
            let lineMap = {};
            for (const item of textContent.items) {
                if (!item.str.trim()) continue;
                let yKey = Math.round(item.transform[5] * 10) / 10;
                let foundKey = Object.keys(lineMap).find(k => Math.abs(parseFloat(k) - yKey) < 3.5);
                if (foundKey) {
                    lineMap[foundKey].push(item);
                } else {
                    lineMap[yKey] = [item];
                }
            }
            let sortedY = Object.keys(lineMap).sort((a, b) => parseFloat(b) - parseFloat(a));
            let pageText = '';
            for (let y of sortedY) {
                let items = lineMap[y].sort((a, b) => a.transform[4] - b.transform[4]);
                let lineStr = items.map(it => it.str).join(' ');
                pageText += lineStr + '\n';
            }
            resolve(pageText);
        });
    });
}

// Convert PDF
async function convertPDF() {
    const fileInput = document.getElementById('pdfFile');
    const bank = document.getElementById('bankSelect').value;
    const convertBtn = document.getElementById('convertBtn');
    const statusDiv = document.getElementById('status');
    const statsDiv = document.getElementById('stats');
    const tableContainer = document.getElementById('tableContainer');

    if (!fileInput || !fileInput.files.length) {
        showStatus('Please select a PDF file', 'error');
        return;
    }

    if (!pyodideReady) {
        showStatus('Python engine is still loading. Please wait...', 'error');
        return;
    }

    currentBank = bank;
    const file = fileInput.files[0];
    if (convertBtn) {
        convertBtn.disabled = true;
        convertBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    }
    showStatus('Processing PDF file...', 'info');
    if (tableContainer) tableContainer.style.display = 'none';
    if (statsDiv) statsDiv.style.display = 'none';
    const downloadButtons = document.getElementById('downloadButtons');
    if (downloadButtons) downloadButtons.style.display = 'none';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const totalPages = pdf.numPages;

        let allPageTexts = [];
        let firstPageText = '';

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const pageText = await extractTextFromPage(page);
            allPageTexts.push(pageText);
            if (pageNum === 1) {
                firstPageText = pageText;
            }
        }

        const processAllFunc = pyodide.globals.get('process_all_pages_together');
        const pyAllPages = pyodide.toPy(allPageTexts);
        const pyBank = pyodide.toPy(bank);
        const pyFirstPage = pyodide.toPy(firstPageText);

        const resultJson = processAllFunc(pyAllPages, pyBank, pyFirstPage);
        const aggregatedTransactions = JSON.parse(resultJson);

        if (aggregatedTransactions.length === 0) {
            throw new Error('No transaction matches found. Ensure you selected the correct bank.');
        }

        currentData = aggregatedTransactions;
        if (statsDiv) {
            statsDiv.style.display = 'block';
            statsDiv.innerHTML = `
                ✅ Successfully processed <strong>${aggregatedTransactions.length}</strong> transactions
            `;
        }
        displayTable(aggregatedTransactions);
        showStatus('✅ Success! Processed ' + aggregatedTransactions.length + ' transactions', 'success');
        if (downloadButtons) downloadButtons.style.display = 'flex';
    } catch (error) {
        console.error('Error:', error);
        showStatus('❌ Error: ' + error.message, 'error');
    } finally {
        if (convertBtn) {
            convertBtn.disabled = false;
            convertBtn.innerHTML = '<i class="fas fa-sync"></i> Convert Statement';
        }
    }
}

function displayTable(data) {
    const tableContainer = document.getElementById('tableContainer');
    if (!tableContainer) return;

    const columns = ['Date', 'Bank Remark', 'Debit', 'Credit', 'Balance', 'Prev Bal'];

    let html = '<table><thead><tr>';
    columns.forEach(col => { html += '<th>' + col + '</th>'; });
    html += '</tr></thead><tbody>';

    const displayData = data.slice(0, 100);
    for (let row of displayData) {
        html += '<tr>';
        columns.forEach(col => {
            let value = row[col];
            if (value === null || value === undefined || value === '') value = '-';
            if ((col === 'Debit' || col === 'Credit' || col === 'Balance' || col === 'Prev Bal') && value && value !== '-') {
                let numericValue = typeof value === 'string' ? parseFloat(value.replace(/,/g, '')) : value;
                value = isNaN(numericValue) ? value : 'RM ' + numericValue.toFixed(2);
            }
            html += '<td>' + value + '</td>';
        });
        html += '</tr>';
    }

    if (data.length > 100) {
        html += '<tr><td colspan="6" style="text-align: center; font-style: italic; color: var(--gray);">';
        html += '... and ' + (data.length - 100) + ' more rows. Download to see all data.';
        html += '</td></tr>';
    }

    html += '</tbody></table>';
    tableContainer.innerHTML = html;
    tableContainer.style.display = 'block';
}

function downloadExcel() {
    if (!currentData.length) return;
    const wsData = [['Date', 'Bank Remark', 'Debit', 'Credit', 'Balance', 'Prev Bal']];
    for (let row of currentData) {
        wsData.push([
            row.Date || '',
            row["Bank Remark"] || '',
            row.Debit || '',
            row.Credit || '',
            row.Balance || '',
            row["Prev Bal"] || ''
        ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    XLSX.writeFile(wb, currentBank.replace(/\s/g, '_') + '_statement.xlsx');
}

function downloadCSV() {
    if (!currentData.length) return;
    let csv = 'Date,Bank Remark,Debit,Credit,Balance,Prev Bal\n';
    for (let row of currentData) {
        csv += '"' + (row.Date || '') + '","' + ((row["Bank Remark"] || '').replace(/"/g, '""')) + '","' + (row.Debit || '') + '","' + (row.Credit || '') + '","' + (row.Balance || '') + '","' + (row["Prev Bal"] || '') + '"\n';
    }
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute('download', currentBank.replace(/\s/g, '_') + '_statement.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function showStatus(message, type) {
    const statusDiv = document.getElementById('status');
    if (!statusDiv) return;
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + type;
}

// ===== CALCULATORS =====
function calculateLoan() {
    const P = parseFloat(document.getElementById('loanAmount')?.value) || 0;
    const annualRate = parseFloat(document.getElementById('loanRate')?.value) || 0;
    const years = parseFloat(document.getElementById('loanYears')?.value) || 0;
    const method = document.querySelector('input[name="calcMethod"]:checked')?.value || 'reducing';

    if (P <= 0 || annualRate <= 0 || years <= 0) {
        const result = document.getElementById('loanResult');
        if (result) result.textContent = "RM 0.00";
        const interest = document.getElementById('totalInterestResult');
        if (interest) interest.textContent = "";
        return;
    }

    let monthlyPayment = 0;
    let totalInterest = 0;

    if (method === 'reducing') {
        const r = (annualRate / 100) / 12;
        const n = years * 12;
        monthlyPayment = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
        totalInterest = (monthlyPayment * n) - P;
    } else {
        totalInterest = P * (annualRate / 100) * years;
        const totalPayable = P + totalInterest;
        monthlyPayment = totalPayable / (years * 12);
    }

    const result = document.getElementById('loanResult');
    if (result) result.textContent = 'RM ' + monthlyPayment.toFixed(2);
    const interest = document.getElementById('totalInterestResult');
    if (interest) interest.innerHTML = 'Total Interest: <strong>RM ' + totalInterest.toFixed(2) + '</strong>';
}

function calculateCompound() {
    const P = parseFloat(document.getElementById('fdPrincipal')?.value) || 0;
    const annualRate = parseFloat(document.getElementById('fdRate')?.value) || 0;
    const n = parseInt(document.getElementById('fdCompounding')?.value) || 1;
    const t = parseFloat(document.getElementById('fdYears')?.value) || 0;
    const r = annualRate / 100;
    const A = P * Math.pow((1 + (r / n)), (n * t));
    const result = document.getElementById('fdResult');
    if (result) result.textContent = 'RM ' + A.toFixed(2);
}

// ===== AMORTIZATION =====
function generateAmortizationSchedule() {
    const P = parseFloat(document.getElementById('amortAmount')?.value) || 0;
    const annualRate = parseFloat(document.getElementById('amortRate')?.value) || 0;
    const years = parseFloat(document.getElementById('amortYears')?.value) || 0;
    const method = document.querySelector('input[name="amortMethod"]:checked')?.value || 'reducing';
    const container = document.getElementById('amortTableContainer');
    const downloadBtn = document.getElementById('downloadAmortBtn');

    if (P <= 0 || annualRate <= 0 || years <= 0) {
        if (container) container.style.display = 'none';
        if (downloadBtn) downloadBtn.style.display = 'none';
        return;
    }

    const totalMonths = years * 12;
    let html = '<table><thead><tr><th>Month</th><th>Payment</th><th>Principal Paid</th><th>Interest Paid</th><th>Remaining Balance</th></tr></thead><tbody>';
    let balance = P;

    if (method === 'reducing') {
        const monthlyRate = (annualRate / 100) / 12;
        const monthlyPayment = (P * monthlyRate * Math.pow(1 + monthlyRate, totalMonths)) / (Math.pow(1 + monthlyRate, totalMonths) - 1);

        for (let i = 1; i <= totalMonths; i++) {
            const interestPaid = balance * monthlyRate;
            let principalPaid = monthlyPayment - interestPaid;
            if (i === totalMonths) {
                principalPaid = balance;
            }
            balance -= principalPaid;
            if (balance < 0) balance = 0;

            html += '<tr>';
            html += '<td>' + i + '</td>';
            html += '<td>RM ' + (principalPaid + interestPaid).toFixed(2) + '</td>';
            html += '<td>RM ' + principalPaid.toFixed(2) + '</td>';
            html += '<td>RM ' + interestPaid.toFixed(2) + '</td>';
            html += '<td>RM ' + balance.toFixed(2) + '</td>';
            html += '</tr>';
        }
    } else {
        const totalInterest = P * (annualRate / 100) * years;
        const monthlyPayment = (P + totalInterest) / totalMonths;
        const monthlyInterestPaid = totalInterest / totalMonths;
        const monthlyPrincipalPaid = P / totalMonths;

        for (let i = 1; i <= totalMonths; i++) {
            balance -= monthlyPrincipalPaid;
            if (balance < 0) balance = 0;

            html += '<tr>';
            html += '<td>' + i + '</td>';
            html += '<td>RM ' + monthlyPayment.toFixed(2) + '</td>';
            html += '<td>RM ' + monthlyPrincipalPaid.toFixed(2) + '</td>';
            html += '<td>RM ' + monthlyInterestPaid.toFixed(2) + '</td>';
            html += '<td>RM ' + balance.toFixed(2) + '</td>';
            html += '</tr>';
        }
    }

    html += '</tbody></table>';
    if (container) {
        container.innerHTML = html;
        container.style.display = 'block';
    }
    if (downloadBtn) downloadBtn.style.display = 'block';
}

function downloadAmortizationExcel() {
    const P = parseFloat(document.getElementById('amortAmount')?.value) || 0;
    const annualRate = parseFloat(document.getElementById('amortRate')?.value) || 0;
    const years = parseFloat(document.getElementById('amortYears')?.value) || 0;
    const method = document.querySelector('input[name="amortMethod"]:checked')?.value || 'reducing';

    if (P <= 0 || annualRate <= 0 || years <= 0) return;
    if (!pyodideReady) {
        alert("Python runtime hasn't loaded yet.");
        return;
    }

    const pythonEngine = pyodide.globals.get('generate_pro_amort_excel_bytes');
    if (!pythonEngine) {
        alert("Python engine not ready.");
        return;
    }

    const base64Data = pythonEngine(P, annualRate, years, method);
    const byteCharacters = atob(base64Data);
    const byteArrays = [];
    const sliceSize = 1024;

    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
        const slice = byteCharacters.slice(offset, offset + sliceSize);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }
        byteArrays.push(new Uint8Array(byteNumbers));
    }

    const blob = new Blob(byteArrays, {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'Loan_Amortization_Schedule_' + method + '.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ===== INIT =====
window.addEventListener('load', () => {
    if (typeof pdfjsLib === 'undefined') {
        const initStatus = document.getElementById('initStatus');
        if (initStatus) {
            initStatus.innerHTML = '❌ PDF.js library failed to load. Check internet connection.';
            initStatus.style.background = 'rgba(229, 62, 62, 0.15)';
            initStatus.style.borderLeftColor = '#fc8181';
        }
    } else {
        initPyodide();
    }
});

// Make functions globally accessible
window.convertPDF = convertPDF;
window.downloadExcel = downloadExcel;
window.downloadCSV = downloadCSV;
window.calculateLoan = calculateLoan;
window.calculateCompound = calculateCompound;
window.generateAmortizationSchedule = generateAmortizationSchedule;
window.downloadAmortizationExcel = downloadAmortizationExcel;