// Regular Expressions migrated from your Python script
const DEFAULT_TX_REGEX = /^(\d{2}\/\d{2})\s+(.+?)\s+((?:\d{1,3}(?:,\d{3})*|\d+)?\.\d{2})([+-])\s+((?:\d{1,3}(?:,\d{3})*|\d+)?\.\d{2})$/;
const BANK_ISLAM_TX_REGEX = /^(\d{1,2}\/\d{2}\/\d{2})\s+(.+?)\s+((?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2})\s+((?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2})$/;

// Helper to convert string currency values to floats safely
function cleanNumeric(val) {
    if (val === null || val === undefined || val === "") return null;
    let clean = val.toString().replace(/,/g, "").replace(/\(/g, "").replace(/\)/g, "").trim();
    let num = parseFloat(clean);
    return isNaN(num) ? null : num;
}

// Parse page function - exact port of Python's parse_page
function parsePage(pageText, startMarkers, footerKeywords, txRegex = DEFAULT_TX_REGEX) {
    const rows = [];
    let current = null;
    const lines = pageText.split('\n');

    // Find where transactions start
    let startIdx = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (startMarkers.some(m => line.startsWith(m))) {
            startIdx = i + 1;
            break;
        }
    }

    if (startIdx === null) return rows;

    // Parse transactions
    for (let i = startIdx; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;

        // Stop at footer
        if (footerKeywords.some(f => line.startsWith(f))) break;

        // New transaction always starts with date
        if (/^\d{2}\/\d{2}/.test(line)) {
            const match = line.match(txRegex);

            if (current) rows.push(current);

            if (match) {
                const amount = cleanNumeric(match[3].replace(/,/g, ""));
                const balance = cleanNumeric(match[5].replace(/,/g, ""));
                const sign = match[4];
                const date = match[1];
                const header = match[2];

                current = {
                    "Date": date,
                    "Bank Remark": header,
                    "Debit": sign === "-" ? amount : "",
                    "Credit": sign === "+" ? amount : "",
                    "Balance": balance
                };
            } else {
                // fallback if regex fails
                current = {
                    "Date": line.substring(0, 5),
                    "Bank Remark": line.substring(6),
                    "Debit": "",
                    "Credit": "",
                    "Balance": ""
                };
            }
        } else {
            // multiline description
            if (current) {
                current["Bank Remark"] += " " + line;
            }
        }
    }

    if (current) rows.push(current);
    return rows;
}

// Parse Bank Islam page - exact port of Python's parse_bank_islam_page
function parseBankIslamPage(pageText) {
    const rows = [];
    const lines = pageText.split('\n').map(l => l.trim()).filter(l => l);

    const BANK_ISLAM_FOOTER_KEYWORDS = [
        "Sekiranyaandamendapati",
        "RINGKASANAKAUN",
        "Sekiranya anda mendapati",
        "If you note any discrepancies",
        "Untuk pertanyaan",
        "RINGKASAN AKAUN",
        "SUMMARY OF ACCOUNT",
        "TOTAL DEBIT"
    ];

    let current = null;

    for (const line of lines) {
        if (BANK_ISLAM_FOOTER_KEYWORDS.some(f => line.includes(f))) break;

        const dateMatch = line.match(/^(\d{1,2}\/\d{2}\/\d{2})/);
        if (dateMatch) {
            if (current) rows.push(current);

            const dateStr = dateMatch[1];
            const remaining = line.substring(dateStr.length).trim();

            // Find all currency-like patterns
            const parts = remaining.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/g) || [];

            const balance = parts.length >= 1 ? cleanNumeric(parts[parts.length - 1]) : null;
            let debit = null;
            let credit = null;

            if (parts.length === 3) {
                debit = cleanNumeric(parts[0]);
                credit = cleanNumeric(parts[1]);
            } else if (parts.length === 2) {
                const val = cleanNumeric(parts[0]);
                const headerUpper = remaining.toUpperCase();
                if (["MB", "IB", "QR", "JOMPAY", "FPX"].some(k => headerUpper.includes(k))) {
                    debit = val;
                } else {
                    credit = val;
                }
            }

            // Clean description by removing the identified amount strings
            let desc = remaining;
            for (const p of parts) {
                desc = desc.replace(p, "").trim();
            }

            current = {
                "Date": dateStr,
                "Bank Remark": desc,
                "Debit": debit,
                "Credit": credit,
                "Balance": balance
            };
        } else if (current && !["TARIKH", "DATE", "BALANCE", "HALAMAN"].some(m => line.includes(m))) {
            current["Bank Remark"] += " " + line;
        }
    }

    if (current) rows.push(current);
    return rows;
}

// Parse Public Bank page - exact port of Python's parse_public_bank_page
function parsePublicBankPage(pageText) {
    const rows = [];
    const lines = pageText.split('\n').map(l => l.trim()).filter(l => l);

    const SKIP_KEYWORDS = ["Balance B/F", "Balance C/F", "Balance From Last Statement", "TARIKH", "DATE", "URUS NIAGA", "Dilindungi oleh", "Protected by PIDM", "Mohon Kad Kredit", "RM setiap tahun.", "lebih, sila hubungi 03-2170 8000", "requirement as low as RM", "RM setiap", "Closing Balance In This Statement"];

    let current = null;
    let lastDate = "";

    for (const line of lines) {
        const dateMatch = line.match(/^(\d{2}\/\d{2})/);
        const parts = line.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/g) || [];

        if (dateMatch || (parts.length >= 1 && !SKIP_KEYWORDS.some(k => line.includes(k)))) {
            let content = line;
            if (dateMatch) {
                lastDate = dateMatch[1];
                content = line.substring(lastDate.length).trim();
            }

            // Skip header/footer lines even if they have dates/amounts
            if (SKIP_KEYWORDS.some(k => content.includes(k))) continue;

            if (current) rows.push(current);

            let debit = null;
            let credit = null;
            let balance = null;

            if (parts.length >= 2) {
                balance = cleanNumeric(parts[parts.length - 1]);
                const val = cleanNumeric(parts[parts.length - 2]);
                const contentUpper = content.toUpperCase();

                let isCredit = [" CR ", "CR ", "CR-", "KREDIT"].some(x => contentUpper.includes(x));

                if (contentUpper.includes("CR CARD PYMT")) isCredit = false;
                if (contentUpper.includes("DEP-ECP")) isCredit = true;

                if (isCredit) {
                    credit = val;
                } else {
                    debit = val;
                }
            } else if (parts.length === 1) {
                balance = cleanNumeric(parts[0]);
            }

            // Strip the numbers out of the description
            let desc = content;
            for (const p of parts) {
                desc = desc.replace(p, "").trim();
            }

            current = {
                "Date": lastDate,
                "Bank Remark": desc,
                "Debit": debit,
                "Credit": credit,
                "Balance": balance
            };
        } else if (current) {
            // Multi-line description: append to the current remark
            if (!["Muka Surat", "Page", "Penyata ini", "BERHAD"].some(k => line.includes(k))) {
                current["Bank Remark"] += " " + line;
            }
        }
    }

    if (current) rows.push(current);
    return rows;
}

// Find CIMB opening balance - exact port
function findCIMBOpeningBal(statementText) {
    const match = statementText.match(/Opening\s+Balance\s+([\d,]+\.\d{2})/);
    if (match) {
        return cleanNumeric(match[1]);
    }
    return 0.00;
}

// Parse CIMB page - exact port of Python's parse_cimb_page
function parseCIMBPage(pageText, openingBal) {
    const rows = [];
    const lines = pageText.split('\n').map(l => l.trim()).filter(l => l);

    const CIMB_IGNORE = ["Statement of Account", "Page / Halaman", "CONTINUE NEXT", "Opening Balance", "CLOSING BALANCE", "No of Withdrawal No of Deposits", "You can perform", "For more information", "Bil Pengeluaran Bil", "holidays or", "(RM) (RM)", "*** End of Statement / Penyata Tamat ***", "Important Notice", "(RM) (RM)", "Notis Penting", "GENERIC MESSAGES", "The Bank must be informed", "of any error", "irregularities or discrepancies", "www.cimbbank.com.my", "www.cimbislamic.com.my"];

    let current = null;
    let rowCounter = 0;

    for (const line of lines) {
        if (CIMB_IGNORE.some(k => line.includes(k)) || line.includes("CIMB ISLAMIC")) continue;

        const dateMatch = line.match(/^(\d{2}\/\d{2}\/\d{4})/);
        if (dateMatch) {
            if (current) rows.push(current);

            const dateStr = dateMatch[1];
            const content = line.substring(dateStr.length).trim();
            const parts = content.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/g) || [];

            const balance = parts.length > 0 ? cleanNumeric(parts[parts.length - 1]) : 0.0;
            const rowAmount = parts.length >= 2 ? cleanNumeric(parts[parts.length - 2]) : 0.0;

            let desc = content;
            for (const p of parts) {
                desc = desc.replace(p, "").trim();
            }

            rowCounter++;
            current = {
                "row_id": rowCounter,
                "Date": dateStr,
                "Bank Remark": desc,
                "Amount": rowAmount,
                "Debit": 0.0,
                "Credit": 0.0,
                "Balance": balance,
                "Prev Bal": 0.0
            };
        } else if (current && !["Date", "Tarikh", "Description"].some(m => line.includes(m))) {
            current["Bank Remark"] += " " + line;
        }
    }

    if (current) rows.push(current);

    // Process running balance calculations
    const processedData = [];
    let prevRowBal = openingBal;

    for (const row of rows) {
        const diff = Math.round((row.Balance - prevRowBal) * 100) / 100;

        if (diff < 0) {
            row.Debit = Math.abs(diff);
            row.Credit = 0.0;
        } else {
            row.Credit = diff;
            row.Debit = 0.0;
        }

        prevRowBal = row.Balance;
        processedData.push(row);
    }

    // Sort by row_id and remove Amount field
    const sortedRows = processedData.sort((a, b) => a.row_id - b.row_id);
    for (const row of sortedRows) {
        delete row.Amount;
        delete row.row_id;
        delete row["Prev Bal"];
    }

    return sortedRows;
}

// Bank configurations - exact port from Python
const BANK_CONFIGS = {
    "Bank Islam": {
        startMarkers: ["BALB/F", "BAL B/F", "TARIKH", "DATE"],
        footerKeywords: ["Sekiranya anda mendapati", "Sekiranyaandamendapati", "If you note any discrepancies", "RINGKASAN AKAUN", "SUMMARY OF ACCOUNT", "MESEJ / MESSAGES", "Untuk pertanyaan"],
        txRegex: BANK_ISLAM_TX_REGEX
    },
    "Maybank": {
        startMarkers: ["BEGINNING BALANCE", "ENTRY DATE VALUE DATE TRANSACTION DESCRIPTION TRANSACTION AMOUNT STATEMENT BALANCE"],
        footerKeywords: ["ENDING BALANCE", "BAKI LEGAR", "LEDGER =", "PROTECTED BY PIDM", "Perhatian / Note"],
        txRegex: DEFAULT_TX_REGEX
    },
    "Agrobank": {
        startMarkers: ["BEGINNING BALANCE", "PREVIOUS STMT BAL", "DEBIT(-)/CREDIT"],
        footerKeywords: ["CLOSING BALANCE", "BAKI LEGAR", "LEDGER =", "PROTECTED BY PIDM", "Perhatian / Note", "BANK PERTANIAN MALAYSIA BERHAD"],
        txRegex: DEFAULT_TX_REGEX
    },
    "AmBank": {
        startMarkers: ["Balance b/f", "CHEQUE NO.", "NO. CEK"],
        footerKeywords: ["CLOSING BALANCE", "BAKI LEGAR", "LEDGER =", "PROTECTED BY PIDM", "Perhatian / Note", "1. PRIVACY NOTICE", "AmBank (M) Berhad"],
        txRegex: DEFAULT_TX_REGEX
    },
    "CIMB": {
        startMarkers: ["Current Account-i Transaction Details", "Opening Balance"],
        footerKeywords: ["CLOSING BALANCE", "CONTINUE NEXT PAGE", "** End of Statement"],
        txRegex: null
    },
    "Public Bank": {
        startMarkers: ["TARIKH DATE", "Balance From Last Statement"],
        footerKeywords: ["Balance C/F", "Muka Surat"],
        txRegex: null
    }
};

// Main router function - accepts either array of strings or single string
function masterBankRouter(selectedBank, pageTexts, fullText = "") {
    const config = BANK_CONFIGS[selectedBank];
    if (!config) {
        throw new Error(`Bank "${selectedBank}" not supported yet`);
    }

    let allRows = [];

    // Handle if pageTexts is an array or a single string
    const pages = Array.isArray(pageTexts) ? pageTexts : [pageTexts];

    for (const pageText of pages) {
        if (!pageText || !pageText.trim()) continue;

        let pageRows = [];

        if (selectedBank === "Bank Islam") {
            pageRows = parseBankIslamPage(pageText);
        } else if (selectedBank === "Public Bank") {
            pageRows = parsePublicBankPage(pageText);
        } else if (selectedBank === "CIMB") {
            const openingBal = findCIMBOpeningBal(fullText || pageText);
            pageRows = parseCIMBPage(pageText, openingBal);
        } else {
            pageRows = parsePage(
                pageText,
                config.startMarkers,
                config.footerKeywords,
                config.txRegex || DEFAULT_TX_REGEX
            );
        }

        allRows = allRows.concat(pageRows);
    }

    return allRows;
}

// Export for browser
if (typeof window !== 'undefined') {
    window.masterBankRouter = masterBankRouter;
    window.BANK_CONFIGS = BANK_CONFIGS;
}