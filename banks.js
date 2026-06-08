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

// Parse Bank Islam page - FIXED version
function parseBankIslamPage(pageText) {
    const rows = [];
    const lines = pageText.split('\n').map(l => l.trim()).filter(l => l);

    let current = null;

    for (const line of lines) {
        // Skip footer lines
        if (line.includes("Sekiranya anda mendapati") ||
            line.includes("RINGKASAN AKAUN") ||
            line.includes("SUMMARY OF ACCOUNT") ||
            line.includes("TOTAL DEBIT") ||
            line.includes("MESEJ / MESSAGES") ||
            line.includes("Untuk pertanyaan")) {
            break;
        }

        // Skip page header lines that contain "OF 7" or "NOMBOR AKAUN" etc
        if (line.includes("OF 7") ||
            line.includes("NOMBOR AKAUN") ||
            line.includes("CAWANGAN BRANCH") ||
            line.includes("DEBIT DEBIT") ||
            line.includes("KREDIT CREDIT") ||
            line.includes("KETERANGAN DESCRIPTION") ||
            line.includes("BAL B/F")) {
            continue;
        }

        // Look for date pattern (DD/MM/YY or D/MM/YY)
        const dateMatch = line.match(/^(\d{1,2}\/\d{2}\/\d{2})/);
        if (dateMatch) {
            // Save previous row if exists
            if (current) {
                rows.push(current);
            }

            const dateStr = dateMatch[1];
            let remaining = line.substring(dateStr.length).trim();

            // Find all currency values in the line (e.g., 670.00, 1,800.00)
            const currencyPattern = /(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/g;
            const amounts = [];
            let match;
            while ((match = currencyPattern.exec(remaining)) !== null) {
                amounts.push(cleanNumeric(match[1]));
            }

            let debit = null;
            let credit = null;
            let balance = null;

            // Bank Islam statement format: Description [DEBIT] [CREDIT] [BALANCE]
            if (amounts.length === 3) {
                debit = amounts[0];
                credit = amounts[1];
                balance = amounts[2];
            } else if (amounts.length === 2) {
                balance = amounts[1];
                const amount = amounts[0];

                const descUpper = remaining.toUpperCase();
                // Credit indicators (money coming IN)
                const isCredit = descUpper.includes("INW") ||
                                descUpper.includes("DUITNOW TRANSFER") ||
                                descUpper.includes("PROFIT PAID") ||
                                (descUpper.includes("TRANSFER") && !descUpper.includes("MB "));

                // Debit indicators (money going OUT)
                const isDebit = descUpper.includes("MB ") ||
                               descUpper.includes("PAYMENT") ||
                               descUpper.includes("PURCHASE") ||
                               (descUpper.includes("TRANSFER") && descUpper.includes("MB"));

                if (isCredit && !isDebit) {
                    credit = amount;
                } else if (isDebit && !isCredit) {
                    debit = amount;
                } else if (descUpper.includes("INW")) {
                    credit = amount;
                } else {
                    debit = amount;
                }
            } else if (amounts.length === 1) {
                balance = amounts[0];
            }

            // Extract description by removing all amount strings
            let desc = remaining;
            const allAmounts = remaining.match(currencyPattern) || [];
            for (const amt of allAmounts) {
                desc = desc.replace(amt, "").trim();
            }
            desc = desc.replace(/\s+/g, " ").trim();

            // Handle "PROFIT PAID" special case
            if (desc.toUpperCase().includes("PROFIT PAID")) {
                credit = amounts[0] || balance;
                debit = null;
                if (amounts.length === 1 && balance === null) {
                    balance = credit;
                }
            }

            current = {
                "Date": dateStr,
                "Bank Remark": desc,
                "Debit": (debit && debit !== 0) ? debit : "",
                "Credit": (credit && credit !== 0) ? credit : "",
                "Balance": balance
            };
        } else if (current && !line.includes("OF 7") && !line.includes("NOMBOR AKAUN")) {
            // Append to multi-line description
            if (!line.match(/^\d+\s+OF\s+\d+$/i)) {
                current["Bank Remark"] += " " + line;
            }
        }
    }

    if (current) {
        rows.push(current);
    }

    // Clean up descriptions
    for (const row of rows) {
        row["Bank Remark"] = row["Bank Remark"].replace(/\s+\d+(?:,\d{3})*(?:\.\d{2})+\s*$/, "").trim();
        row["Bank Remark"] = row["Bank Remark"].replace(/\s+\d+(?:,\d{3})*(?:\.\d{2})+\s+/, " ").trim();
    }

    return rows;
}

// Parse page function for other banks
function parsePage(pageText, startMarkers, footerKeywords, txRegex = DEFAULT_TX_REGEX) {
    const rows = [];
    let current = null;
    const lines = pageText.split('\n');

    let startIdx = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (startMarkers.some(m => line.startsWith(m))) {
            startIdx = i + 1;
            break;
        }
    }

    if (startIdx === null) return rows;

    for (let i = startIdx; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;

        if (footerKeywords.some(f => line.startsWith(f))) break;

        if (/^\d{2}\/\d{2}/.test(line)) {
            const match = line.match(txRegex);

            if (current) rows.push(current);

            if (match) {
                const amount = cleanNumeric(match[3].replace(/,/g, ""));
                const balance = cleanNumeric(match[5].replace(/,/g, ""));
                const sign = match[4];

                current = {
                    "Date": match[1],
                    "Bank Remark": match[2],
                    "Debit": sign === "-" ? amount : "",
                    "Credit": sign === "+" ? amount : "",
                    "Balance": balance
                };
            } else {
                current = {
                    "Date": line.substring(0, 5),
                    "Bank Remark": line.substring(6),
                    "Debit": "",
                    "Credit": "",
                    "Balance": ""
                };
            }
        } else if (current) {
            current["Bank Remark"] += " " + line;
        }
    }

    if (current) rows.push(current);
    return rows;
}

// Parse Public Bank page
function parsePublicBankPage(pageText) {
    const rows = [];
    const lines = pageText.split('\n').map(l => l.trim()).filter(l => l);
    const SKIP_KEYWORDS = ["Balance B/F", "Balance C/F", "TARIKH", "DATE"];
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

            if (SKIP_KEYWORDS.some(k => content.includes(k))) continue;
            if (current) rows.push(current);

            let debit = null, credit = null, balance = null;

            if (parts.length >= 2) {
                balance = cleanNumeric(parts[parts.length - 1]);
                const val = cleanNumeric(parts[parts.length - 2]);
                const contentUpper = content.toUpperCase();
                let isCredit = contentUpper.includes("CR");
                if (contentUpper.includes("CR CARD")) isCredit = false;
                if (isCredit) credit = val;
                else debit = val;
            } else if (parts.length === 1) {
                balance = cleanNumeric(parts[0]);
            }

            let desc = content;
            for (const p of parts) desc = desc.replace(p, "").trim();

            current = {
                "Date": lastDate,
                "Bank Remark": desc,
                "Debit": debit,
                "Credit": credit,
                "Balance": balance
            };
        } else if (current) {
            current["Bank Remark"] += " " + line;
        }
    }

    if (current) rows.push(current);
    return rows;
}

// Find CIMB opening balance
function findCIMBOpeningBal(statementText) {
    const match = statementText.match(/Opening\s+Balance\s+([\d,]+\.\d{2})/);
    return match ? cleanNumeric(match[1]) : 0.00;
}

// Parse CIMB page
function parseCIMBPage(pageText, openingBal) {
    const rows = [];
    const lines = pageText.split('\n').map(l => l.trim()).filter(l => l);
    const CIMB_IGNORE = ["Statement of Account", "Page / Halaman", "CONTINUE NEXT", "Opening Balance", "CLOSING BALANCE"];

    let current = null;
    let rowCounter = 0;

    for (const line of lines) {
        if (CIMB_IGNORE.some(k => line.includes(k))) continue;

        const dateMatch = line.match(/^(\d{2}\/\d{2}\/\d{4})/);
        if (dateMatch) {
            if (current) rows.push(current);

            const dateStr = dateMatch[1];
            const content = line.substring(dateStr.length).trim();
            const parts = content.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/g) || [];

            const balance = parts.length > 0 ? cleanNumeric(parts[parts.length - 1]) : 0.0;
            const rowAmount = parts.length >= 2 ? cleanNumeric(parts[parts.length - 2]) : 0.0;

            let desc = content;
            for (const p of parts) desc = desc.replace(p, "").trim();

            rowCounter++;
            current = {
                "row_id": rowCounter,
                "Date": dateStr,
                "Bank Remark": desc,
                "Amount": rowAmount,
                "Debit": 0.0,
                "Credit": 0.0,
                "Balance": balance
            };
        } else if (current) {
            current["Bank Remark"] += " " + line;
        }
    }

    if (current) rows.push(current);

    // Calculate debits/credits from balances
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
        delete row.Amount;
        delete row.row_id;
        processedData.push(row);
    }

    return processedData;
}

// Bank configurations
const BANK_CONFIGS = {
    "Bank Islam": { startMarkers: [], footerKeywords: [], txRegex: null },
    "Maybank": { startMarkers: ["BEGINNING BALANCE"], footerKeywords: ["ENDING BALANCE", "PROTECTED BY PIDM"], txRegex: DEFAULT_TX_REGEX },
    "Agrobank": { startMarkers: ["BEGINNING BALANCE"], footerKeywords: ["CLOSING BALANCE", "PROTECTED BY PIDM"], txRegex: DEFAULT_TX_REGEX },
    "AmBank": { startMarkers: ["Balance b/f"], footerKeywords: ["CLOSING BALANCE", "AmBank (M) Berhad"], txRegex: DEFAULT_TX_REGEX },
    "CIMB": { startMarkers: [], footerKeywords: [], txRegex: null },
    "Public Bank": { startMarkers: [], footerKeywords: [], txRegex: null }
};

// Main router function
function masterBankRouter(selectedBank, pageTexts, fullText) {
    let allRows = [];
    const pages = Array.isArray(pageTexts) ? pageTexts : [pageTexts];

    for (let p = 0; p < pages.length; p++) {
        const pageText = pages[p];
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
            const config = BANK_CONFIGS[selectedBank];
            pageRows = parsePage(pageText, config.startMarkers, config.footerKeywords, config.txRegex);
        }

        allRows = allRows.concat(pageRows);
    }

    return allRows;
}

// Export for browser
window.masterBankRouter = masterBankRouter;
window.BANK_CONFIGS = BANK_CONFIGS;

console.log("banks.js loaded successfully");