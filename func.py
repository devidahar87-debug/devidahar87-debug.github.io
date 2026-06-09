import re
import json
from typing import List, Dict, Any

DEFAULT_TX_REGEX = re.compile(
    r"^(?P<date>\d{2}/\d{2})\s+"
    r"(?P<header>.+?)\s+"
    r"(?P<amount>(?:\d{1,3}(?:\,\d{3})*|\d+)?\.\d{2})"
    r"\s*(?P<sign>[+-])?\s+"
    r"(?P<balance>(?:\d{1,3}(?:\,\d{3})*|\d+)?\.\d{2})$"
)

BANK_ISLAM_TX_REGEX = re.compile(
    r"^(?P<date>\d{1,2}/\d{2}/\d{2})\s+"
    r"(?P<header>.+?)\s+"
    r"(?P<amount>(?:\d{1,3}(?:\,\d{3})*|\d+)\.\d{2})\s+"
    r"(?P<balance>(?:\d{1,3}(?:\,\d{3})*|\d+)\.\d{2})$"
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
        if not line:
            continue

        if any(f.lower() in line.lower() for f in footer_keywords):
            break

        date_match = re.match(r"^(\d{2}/\d{2})", line)
        if date_match:
            match = tx_regex.search(line)
            if current:
                rows.append(current)

            if match:
                amount_str = match.group("amount").replace(",", "") if match.group("amount") else "0.0"
                balance_str = match.group("balance").replace(",", "") if match.group("balance") else "0.0"
                amount = float(amount_str) if amount_str else 0.0
                balance = float(balance_str) if balance_str else 0.0

                sign = match.group("sign") if "sign" in match.groupdict() and match.group("sign") else "+"

                current = {
                    "Date": match.group("date"),
                    "Bank Remark": match.group("header").strip(),
                    "Debit": amount if sign == "-" else "",
                    "Credit": amount if sign == "+" or sign == "" else "",
                    "Balance": balance
                }
            else:
                current = {
                    "Date": line[:5],
                    "Bank Remark": line[6:].strip(),
                    "Debit": "",
                    "Credit": "",
                    "Balance": ""
                }
        else:
            if current:
                current["Bank Remark"] += " " + line

    if current:
        rows.append(current)

    return rows

def parse_bank_islam_page(page_text):
    """
    Parses Bank Islam iGain Account statements across multiple pages
    and ensures amounts are numeric.
    """
    rows = []
    lines = [l.strip() for l in page_text.splitlines() if l.strip()]

    # Keywords signaling template noise, headers, or page footers to ignore
    BANK_ISLAM_SKIP_KEYWORDS = [
        "Sekiranyaandamendapati",
        "RINGKASANAKAUN",
        "Sekiranya anda mendapati",
        "If you note any discrepancies",
        "Untuk pertanyaan",
        "RINGKASAN AKAUN",
        "SUMMARY OF ACCOUNT",
        "TOTAL DEBIT",
        "TOTAL CREDIT",
        "MONTHLY AVERAGE",
        "TARIKH PENYATA",
        "STATEMENT DATE",
        "HALAMAN",
        "PAGE",
        "NOMBOR AKAUN",
        "ACCOUNT NO",
        "CAWANGAN",
        "BRANCH",
        "PENYATA AKAUN",
        "ACCOUNT STATEMENT"
    ]

    current = None

    def clean_numeric(value):
        """Helper to convert string currency to float."""
        if not value:
            return None
        try:
            return float(value.replace(",", ""))
        except ValueError:
            return None

    for line in lines:
        # FIX: Change break to continue so the script doesn't stop on page 1
        if any(f in line for f in BANK_ISLAM_SKIP_KEYWORDS):
            continue

        # Match Date format (e.g., 2/01/25 or 31/01/25)
        date_match = re.match(r"^(\d{1,2}/\d{2}/\d{2})", line)

        if date_match:
            date_str = date_match.group(1)
            remaining = line[len(date_str):].strip()

            # Skip opening forward balance lines ("BAL B/F") across pages
            if "BAL B/F" in remaining.upper() or "BALANCE B/F" in remaining.upper():
                continue

            if current:
                rows.append(current)

            # Find all currency-like patterns (e.g., 100,502.78)
            parts = re.findall(r"(\d{1,3}(?:,\d{3})*(?:\.\d{2}))", remaining)

            # Last number is always the Balance
            balance = clean_numeric(parts[-1]) if len(parts) >= 1 else None

            debit = None
            credit = None

            if len(parts) == 3:
                debit = clean_numeric(parts[0])
                credit = clean_numeric(parts[1])
            elif len(parts) == 2:
                val = clean_numeric(parts[0])
                # Heuristic: Transfers out are typically Debits
                header_upper = remaining.upper()
                if any(k in header_upper for k in ["MB", "IB", "QR", "JOMPAY", "FPX", "DEBIT", "CHG"]):
                    debit = val
                else:
                    credit = val

            # Clean description by removing the identified amount strings
            desc = remaining
            for p in parts:
                desc = desc.replace(p, "").strip()

            desc_parts = re.split(r'\s{2,}', desc)
            if desc_parts:
                desc = desc_parts[0].strip()


            current = {
                "Date": date_str,
                "Bank Remark": desc,
                "Debit": debit if debit else "",
                "Credit": credit if credit else "",
                "Balance": balance if balance else ""
            }

        elif current and not any(m in line for m in ["TARIKH", "DATE", "BALANCE", "HALAMAN", "DESCRIPTION", "(RM)"]):
            # Append multi-line descriptions dynamically
            current["Bank Remark"] += " " + line

    if current:
        rows.append(current)

    return rows
def parse_public_bank_page(page_text):
    rows = []
    lines = [l.strip() for l in page_text.splitlines() if l.strip()]

    SKIP_KEYWORDS = ["balance b/f", "balance c/f", "balance from last statement",
                     "tarikh", "date", "urus niaga", "dilindungi oleh", "protected by pidm"]

    current = None
    last_date = ""

    def clean_val(val):
        if not val: return None
        try:
            return float(val.replace(",", ""))
        except ValueError:
            return None

    for line in lines:
        date_match = re.match(r"^(\d{2}/\d{2})", line)
        parts = re.findall(r"(\d{1,3}(?:,\d{3})*(?:\.\d{2}))", line)

        if date_match or (len(parts) >= 1 and not any(k in line.lower() for k in SKIP_KEYWORDS)):
            if date_match:
                last_date = date_match.group(1)
                content = line[len(last_date):].strip()
            else:
                content = line

            if any(k in content.lower() for k in SKIP_KEYWORDS):
                continue

            if current:
                rows.append(current)

            debit = None
            credit = None
            balance = None

            if len(parts) >= 2:
                balance = clean_val(parts[-1])
                val = clean_val(parts[-2])
                content_upper = content.upper()

                is_credit = any(x in content_upper for x in [" CR ", "CR ", "CR-", "KREDIT"])
                if "CR CARD PYMT" in content_upper:
                    is_credit = False
                if "DEP-ECP" in content_upper:
                    is_credit = True

                if is_credit:
                    credit = val
                else:
                    debit = val

            elif len(parts) == 1:
                balance = clean_val(parts[0])

            desc = content
            for p in parts:
                desc = desc.replace(p, "").strip()

            current = {
                "Date": last_date,
                "Bank Remark": desc,
                "Debit": debit if debit else "",
                "Credit": credit if credit else "",
                "Balance": balance if balance else ""
            }

        elif current:
            if not any(k in line for k in ["Muka Surat", "Page", "Penyata ini", "BERHAD"]):
                current["Bank Remark"] += " " + line

    if current:
        rows.append(current)

    return rows

def find_cimb_opening_bal(statement_text):
    match = re.search(r'Opening Balance\s+([\d,]+\.\d{2})', statement_text, re.IGNORECASE)
    if match:
        return float(match.group(1).replace(",", ""))
    return 0.00

def parse_cimb_page(page_text, opening_bal):
    rows = []
    lines = [l.strip() for l in page_text.splitlines() if l.strip()]

    CIMB_IGNORE = ["statement of account", "page / halaman", "continue next",
                   "opening balance", "closing balance", "no of withdrawal no of deposits"]

    def clean_val(val):
        if not val: return 0.0
        try:
            return float(val.replace(",", "").strip())
        except:
            return 0.0

    current = None
    for line in lines:
        if any(k in line.lower() for k in CIMB_IGNORE) or "cimb" in line.lower():
            continue

        date_match = re.match(r"^(\d{2}/\d{2}/\d{4})", line)
        if date_match:
            if current:
                rows.append(current)

            date_str = date_match.group(1)
            content = line[len(date_str):].strip()
            parts = re.findall(r"(\d{1,3}(?:,\d{3})*\.\d{2})", content)

            balance = clean_val(parts[-1]) if parts else 0.0
            row_amount = clean_val(parts[-2]) if len(parts) >= 2 else 0.0

            desc = content
            for p in parts:
                desc = desc.replace(p, "").strip()

            current = {
                "Date": date_str,
                "Bank Remark": desc,
                "Amount": row_amount,
                "Debit": 0.0,
                "Credit": 0.0,
                "Balance": balance
            }
        elif current and not any(m in line for m in ["Date", "Tarikh", "Description"]):
            current["Bank Remark"] += " " + line

    if current:
        rows.append(current)

    processed_data = []
    prev_row_bal = opening_bal

    for row in rows:
        diff = round(row['Balance'] - prev_row_bal, 2)
        if diff < 0:
            row['Debit'] = abs(diff)
            row['Credit'] = 0.0
        else:
            row['Credit'] = diff
            row['Debit'] = 0.0
        prev_row_bal = row['Balance']
        if 'Amount' in row:
            del row['Amount']
        processed_data.append(row)

    return processed_data

def convert_bank(pdf_text, bank_name):
    if bank_name == "Bank Islam":
        return parse_bank_islam_page(pdf_text)
    elif bank_name == "Public Bank":
        return parse_public_bank_page(pdf_text)
    elif bank_name == "CIMB":
        opening_bal = find_cimb_opening_bal(pdf_text)
        return parse_cimb_page(pdf_text, opening_bal)
    elif bank_name == "Maybank":
        return parse_page(pdf_text,
            ["BEGINNING BALANCE", "ENTRY DATE", "TRANSACTION DESCRIPTION"],
            ["ENDING BALANCE", "BAKI LEGAR", "LEDGER =", "PROTECTED BY PIDM"])
    elif bank_name == "Agrobank":
        return parse_page(pdf_text,
            ["BEGINNING BALANCE", "PREVIOUS STMT BAL", "DEBIT(-)/CREDIT"],
            ["CLOSING BALANCE", "BAKI LEGAR", "PROTECTED BY PIDM"])
    elif bank_name == "AmBank":
        return parse_page(pdf_text,
            ["Balance b/f", "CHEQUE NO.", "NO. CEK"],
            ["CLOSING BALANCE", "BAKI LEGAR", "AmBank (M) Berhad"])
    else:
        return []

def process_pdf(pdf_content: str, bank_name: str):
    """Main function to be called from JavaScript"""
    result = convert_bank(pdf_content, bank_name)
    return json.dumps(result)