// Regular Expressions migrated from your Python script
const DEFAULT_TX_REGEX = /^(\d{2}\/\d{2})\s+(.+?)\s+((?:\d{1,3}(?:,\d{3})*|\d+)?\.\d{2})([+-])\s+((?:\d{1,3}(?:,\d{3})*|\d+)?\.\d{2})$/;
const BANK_ISLAM_TX_REGEX = /^(\d{1,2}\/\d{2}\/\d{2})\s+(.+?)\s+((?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2})\s+((?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2})$/;

// Helper to convert string currency values to floats safely (replaces pandas cleanup)
function cleanNumeric(val) {
    if (val === null || val === undefined || val === "") return 0.0;
    let clean = val.toString().replace(/,/g, "").replace(/\(/g, "").replace(/\)/g, "").trim();
    let num = parseFloat(clean);
    return isNaN(num) ? 0.0 : num;
}

const BankParsers = {
    // Port of parse_page() for Maybank, Agrobank, and AmBank
    defaultParser: function(lines, startMarkers, footerKeywords, txRegex = DEFAULT_TX_REGEX) {
        let rows = [];
        let current = null;

        // Find start index
        let startIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (startMarkers.some(m => line.startsWith(m))) {
                startIdx = i + 1;
                break;
            }
        }

        if (startIdx === -1) return rows;

        // Parse transactions
        for (let i = startIdx; i < lines.length; i++) {
            let line = lines[i].trim();
            if (!line) continue;

            // Stop at footer
            if (footerKeywords.some(f => line.startsWith(f))) break;

            // New transaction always starts with date
            if (/^\d{2}\/\d{2}/.test(line)) {
                let match = line.match(txRegex);

                if (current) rows.push(current);

                if (match) {
                    let date = match[1];
                    let header = match[2];
                    let amount = cleanNumeric(match[3]);
                    let sign = match[4];
                    let balance = cleanNumeric(match[5]);

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
                if (current) current["Bank Remark"] += " " + line;
            }
        }
        if (current) rows.push(current);
        return rows;
    },

    // Port of parse_bank_islam_page()
    bankIslam: function(lines) {
        let rows = [];
        let current = null;
        const footerKeywords = ["Sekiranyaandamendapati", "RINGKASANAKAUN", "Sekiranya anda mendapati", "If you note any discrepancies", "Untuk pertanyaan", "RINGKASAN AKAUN", "SUMMARY OF ACCOUNT", "TOTAL DEBIT"];

        for (let line of lines) {
            line = line.trim();
            if (footerKeywords.some(f => line.includes(f))) break;

            let dateMatch = line.match(/^(\d{1,2}\/\d{2}\/\d{2})/);
            if (dateMatch) {
                if (current) rows.push(current);

                let dateStr = dateMatch[1];
                let remaining = line.substring(dateStr.length).trim();

                // Regex findall numbers
                let parts = remaining.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/g) || [];
                let balance = parts.length >= 1 ? cleanNumeric(parts[parts.length - 1]) : null;

                let debit = null;
                let credit = null;

                if (parts.length === 3) {
                    debit = cleanNumeric(parts[0]);
                    credit = cleanNumeric(parts[1]);
                } else if (parts.length === 2) {
                    let val = cleanNumeric(parts[0]);
                    let headerUpper = remaining.toUpperCase();
                    if (["MB", "IB", "QR", "JOMPAY", "FPX"].some(k => headerUpper.includes(k))) {
                        debit = val;
                    } else {
                        credit = val;
                    }
                }

                let desc = remaining;
                parts.forEach(p => desc = desc.replace(p, ""));

                current = {
                    "Date": dateStr,
                    "Bank Remark": desc.trim(),
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
    },

    // Port of parse_public_bank_page()
    publicBank: function(lines) {
        let rows = [];
        let current = null;
        let lastDate = "";
        const skipKeywords = ["Balance B/F", "Balance C/F", "Balance From Last Statement", "TARIKH", "DATE", "URUS NIAGA", "Dilindungi oleh", "Protected by PIDM", "Mohon Kad Kredit", "RM setiap tahun.", "lebih, sila hubungi 03-2170 8000", "requirement as low as RM", "RM setiap", "Closing Balance In This Statement"];

        for (let line of lines) {
            line = line.trim();
            let dateMatch = line.match(/^(\d{2}\/\d{2})/);
            let parts = line.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/g) || [];

            if (dateMatch || (parts.length >= 1 && !skipKeywords.some(k => line.includes(k)))) {
                let content = line;
                if (dateMatch) {
                    lastDate = dateMatch[1];
                    content = line.substring(lastDate.length).trim();
                }

                if (skipKeywords.some(k => content.includes(k))) continue;
                if (current) rows.push(current);

                let debit = null;
                let credit = null;
                let balance = null;

                if (parts.length >= 2) {
                    balance = cleanNumeric(parts[parts.length - 1]);
                    let val = cleanNumeric(parts[parts.length - 2]);
                    let contentUpper = content.toUpperCase();

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

                let desc = content;
                parts.forEach(p => desc = desc.replace(p, ""));

                current = {
                    "Date": lastDate,
                    "Bank Remark": desc.trim(),
                    "Debit": debit,
                    "Credit": credit,
                    "Balance": balance
                };
            } else if (current) {
                if (!["Muka Surat", "Page", "Penyata ini", "BERHAD"].some(k => line.includes(k))) {
                    current["Bank Remark"] += " " + line;
                }
            }
        }
        if (current) rows.push(current);
        return rows;
    },

    // Port of parse_cimb_page()
    cimb: function(lines, fullText) {
        // Find Opening Balance exactly like find_cimb_opening_bal logic
        let openingBal = 0.00;
        let openMatch = fullText.match(/Opening\s+Balance\s+([\d,]+\.\d{2})/i);
        if (openMatch) openingBal = cleanNumeric(openMatch[1]);

        let rows = [];
        let current = null;
        let rowCounter = 0;
        const cimbIgnore = ["Statement of Account", "Page / Halaman", "CONTINUE NEXT", "Opening Balance", "CLOSING BALANCE", "No of Withdrawal No of Deposits", "You can perform", "For more information", "Bil Pengeluaran Bil", "holidays or", "(RM) (RM)", "*** End of Statement / Penyata Tamat ***", "Important Notice", "Notis Penting", "GENERIC MESSAGES", "The Bank must be informed", "of any error", "irregularities or discrepancies", "www.cimbbank.com.my", "www.cimbislamic.com.my"];

        for (let line of lines) {
            line = line.trim();
            if (cimbIgnore.some(k => line.includes(k)) || line.includes("CIMB ISLAMIC")) continue;

            let dateMatch = line.match(/^(\d{2}\/\d{2}\/\d{4})/);
            if (dateMatch) {
                if (current) rows.push(current);

                let dateStr = dateMatch[1];
                let content = line.substring(dateStr.length).trim();
                let parts = content.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/g) || [];

                let balance = parts.length > 0 ? cleanNumeric(parts[parts.length - 1]) : 0.0;
                let rowAmount = parts.length >= 2 ? cleanNumeric(parts[parts.length - 2]) : 0.0;

                let desc = content;
                parts.forEach(p => desc = desc.replace(p, ""));

                rowCounter++;
                current = {
                    "row_id": rowCounter,
                    "Date": dateStr,
                    "Bank Remark": desc.trim(),
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

        // Process running balance calculations matching Python step 2
        for (let i = 0; i < rows.length; i++) {
            if (i === rows.length - 1) {
                rows[i]["Prev Bal"] = openingBal;
            } else {
                rows[i]["Prev Bal"] = rows[i + 1]["Balance"];
            }

            let diff = Math.round((rows[i]["Balance"] - rows[i]["Prev Bal"]) * 100) / 100;
            if (diff < 0) {
                rows[i]["Debit"] = rows[i]["Amount"];
                rows[i]["Credit"] = 0.0;
            } else {
                rows[i]["Credit"] = rows[i]["Amount"];
                rows[i]["Debit"] = 0.0;
            }
            // Cleanup temporary property so it matches output blueprint columns
            delete rows[i]["Amount"];
            delete rows[i]["Prev Bal"];
            delete rows[i]["row_id"];
        }
        return rows;
    }
};

// Main Router exposed to index.html
function masterBankRouter(selectedBank, textArray, completeTextString) {
    let lines = textArray;

    switch (selectedBank) {
        case "Bank Islam":
            return BankParsers.bankIslam(lines);
        case "Public Bank":
            return BankParsers.publicBank(lines);
        case "CIMB":
            return BankParsers.cimb(lines, completeTextString);
        case "Maybank":
            return BankParsers.defaultParser(lines,
                ["BEGINNING BALANCE", "ENTRY DATE VALUE DATE TRANSACTION DESCRIPTION TRANSACTION AMOUNT STATEMENT BALANCE"],
                ["ENDING BALANCE", "BAKI LEGAR", "LEDGER =", "PROTECTED BY PIDM", "Perhatian / Note"],
                DEFAULT_TX_REGEX);
        case "Agrobank":
            return BankParsers.defaultParser(lines,
                ["BEGINNING BALANCE", "PREVIOUS STMT BAL", "DEBIT(-)/CREDIT"],
                ["CLOSING BALANCE", "BAKI LEGAR", "LEDGER =", "PROTECTED BY PIDM", "Perhatian / Note", "BANK PERTANIAN MALAYSIA BERHAD"],
                DEFAULT_TX_REGEX);
        case "AmBank":
            return BankParsers.defaultParser(lines,
                ["Balance b/f", "CHEQUE NO.", "NO. CEK"],
                ["CLOSING BALANCE", "BAKI LEGAR", "LEDGER =", "PROTECTED BY PIDM", "Perhatian / Note", "1. PRIVACY NOTICE", "AmBank (M) Berhad"],
                DEFAULT_TX_REGEX);
        default:
            return BankParsers.defaultParser(lines, [], [], DEFAULT_TX_REGEX);
    }
}

// Export for use in other files (if using modules)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { masterBankRouter, BankParsers, cleanNumeric };
}