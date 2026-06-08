// This file handles the specific parsing rules for individual banks.
// You can easily add more banks here in the future!

const BankParsers = {
    // 1. GENERIC PARSER
    generic: function(rowText) {
        const datePattern = /^\d{1,2}[\/\-]\d{1,2}/;
        if (!datePattern.test(rowText)) return null;

        let cleanText = rowText.replace(/,/g, "");
        let pieces = cleanText.split(/\s+/);

        let date = pieces[0];
        let amount = pieces[pieces.length - 1];
        let description = pieces.slice(1, pieces.length - 1).join(" ");

        return [date, description, amount];
    },

    // 2. CHASE BANK PARSER
    chase: function(rowText) {
        const datePattern = /^\d{2}\/\d{2}/; // Matches MM/DD
        if (!datePattern.test(rowText)) return null;

        let pieces = rowText.replace(/,/g, "").split(/\s+/);
        let date = pieces[0];
        let amount = pieces[pieces.length - 1];
        let description = "[Chase] " + pieces.slice(1, pieces.length - 1).join(" ");

        return [date, description, amount];
    },

    // 3. BANK OF AMERICA PARSER
    bofa: function(rowText) {
        // Matches dates like "Jan 15" or "Oct 24"
        const bofaDatePattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i;
        if (!bofaDatePattern.test(rowText)) return null;

        let pieces = rowText.replace(/,/g, "").split(/\s+/);
        let date = pieces[0] + " " + pieces[1];
        let amount = pieces[pieces.length - 1];
        let description = pieces.slice(2, pieces.length - 1).join(" ");

        if (rowText.includes("MINUS")) amount = "-" + amount;

        return [date, description, amount];
    },

    // 4. WELLS FARGO PARSER
    wells: function(rowText) {
        const datePattern = /^\d{2}\/\d{2}\/\d{4}/; // Matches MM/DD/YYYY
        if (!datePattern.test(rowText)) return null;

        let pieces = rowText.replace(/,/g, "").split(/\s+/);
        let date = pieces[0];
        let amount = pieces[pieces.length - 1];
        let description = pieces.slice(1, pieces.length - 1).join(" ");

        return [date, description, amount];
    }
};

// Global router function used by your main webpage
function parseRowByBank(rowText, bankKey) {
    // If the selected bank parser exists, use it. Otherwise, fallback to generic.
    if (BankParsers[bankKey]) {
        return BankParsers[bankKey](rowText);
    }
    return BankParsers.generic(rowText);
}