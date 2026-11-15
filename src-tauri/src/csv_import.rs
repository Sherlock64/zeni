//! CSV parsing: header fingerprint, mapping preview and full parse into a `ParsedStatement`.

use crate::transactions::is_date;
use crate::types::{
    AmountColumns, AppError, CsvMapping, CsvPreviewRow, DateFormat, FileBalanceCheck,
    ParsedStatement, ParsedTransaction,
};

/// The header cells, trimmed, in file order.
pub fn read_header(text: &str) -> Result<Vec<String>, AppError> {
    Records::new(text).header()
}

/// Trims, collapses whitespace runs to one space and lowercases ASCII.
pub fn normalise(header: &str) -> String {
    header
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

/// The normalised header names joined with '\n'; what a saved layout matches on.
pub fn fingerprint(headers: &[String]) -> String {
    headers
        .iter()
        .map(|header| normalise(header))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The first `limit` data rows, raw cells.
pub fn sample_rows(text: &str, limit: usize) -> Result<Vec<Vec<String>>, AppError> {
    let mut records = Records::new(text);
    records.header()?;
    let mut rows = Vec::new();
    while rows.len() < limit {
        let Some(record) = records.next()? else { break };
        rows.push(record.cells.iter().map(String::from).collect());
    }
    Ok(rows)
}

/// The first `limit` data rows parsed with a draft mapping; problems go in each row's `error`.
pub fn preview(
    text: &str,
    mapping: &CsvMapping,
    limit: usize,
) -> Result<Vec<CsvPreviewRow>, AppError> {
    let mut records = Records::new(text);
    let headers = records.header()?;
    let mut rows = Vec::new();
    while rows.len() < limit {
        let Some(record) = records.next()? else { break };
        let row = Row {
            headers: &headers,
            record: &record,
        };
        let mut error = None;
        let mut preview = CsvPreviewRow {
            line: record.line,
            posted_date: keep(row.date(mapping), &mut error),
            amount_cents: keep(row.amount(mapping.amount), &mut error),
            description: keep(row.text(Some(mapping.description)), &mut error).flatten(),
            transaction_id: keep(row.text(mapping.transaction_id), &mut error).flatten(),
            memo: keep(row.text(mapping.memo), &mut error).flatten(),
            transaction_type: keep(row.text(mapping.transaction_type), &mut error).flatten(),
            running_balance_cents: keep(row.balance(mapping.running_balance), &mut error).flatten(),
            posting_status: keep(row.text(mapping.posting_status), &mut error).flatten(),
            bank_category: keep(row.text(mapping.bank_category), &mut error).flatten(),
            error: None,
        };
        // Not-posted rows are skipped unparsed on import, so their problems don't reject the file.
        if keep(row.posted(mapping.posting_status), &mut error) != Some(false) {
            preview.error = error;
        }
        rows.push(preview);
    }
    Ok(rows)
}

/// Parses the whole file. Any bad posted row rejects it, naming the line.
pub fn parse(text: &str, mapping: &CsvMapping) -> Result<ParsedStatement, AppError> {
    let mut records = Records::new(text);
    let headers = records.header()?;
    let mut transactions = Vec::new();
    let mut not_posted = 0;
    while let Some(record) = records.next()? {
        let row = Row {
            headers: &headers,
            record: &record,
        };
        let at_line = |error: FieldError| error.at_line(record.line);
        if !row.posted(mapping.posting_status).map_err(at_line)? {
            not_posted += 1;
            continue;
        }
        transactions.push(ParsedTransaction {
            fitid: row.text(mapping.transaction_id).map_err(at_line)?,
            posted_date: row.date(mapping).map_err(at_line)?,
            amount_cents: row.amount(mapping.amount).map_err(at_line)?,
            description: row
                .text(Some(mapping.description))
                .map_err(at_line)?
                .unwrap_or_default(),
            memo: row.text(mapping.memo).map_err(at_line)?,
            transaction_type: row.text(mapping.transaction_type).map_err(at_line)?,
            running_balance_cents: row.balance(mapping.running_balance).map_err(at_line)?,
            bank_category: row.text(mapping.bank_category).map_err(at_line)?,
            original: record.original.to_owned(),
        });
    }
    let (file_balance_check, ledger) = if mapping.running_balance.is_some() {
        check_running_balance(&transactions)
    } else {
        (FileBalanceCheck::NotChecked, None)
    };
    let (ledger_balance_cents, balance_as_of) = ledger.unzip();
    Ok(ParsedStatement {
        currency: "USD".into(),
        ledger_balance_cents,
        balance_as_of,
        transactions,
        not_posted,
        file_balance_check,
    })
}

/// R9: the within-file check, and the newest row's balance and date as the ledger.
fn check_running_balance(rows: &[ParsedTransaction]) -> (FileBalanceCheck, Option<(i64, String)>) {
    let (Some(first), Some(last)) = (rows.first(), rows.last()) else {
        return (FileBalanceCheck::NotChecked, None);
    };
    let newest_first = first.posted_date > last.posted_date;
    let newest = if newest_first { first } else { last };
    let ledger = newest
        .running_balance_cents
        .map(|balance| (balance, newest.posted_date.clone()));
    // Either order: the newer row's balance is the older row's balance plus the newer row's amount.
    let consistent = rows.iter().all(|row| row.running_balance_cents.is_some())
        && rows.iter().zip(rows.iter().skip(1)).all(|(a, b)| {
            let (older, newer) = if newest_first { (b, a) } else { (a, b) };
            older
                .running_balance_cents
                .and_then(|balance| balance.checked_add(newer.amount_cents))
                == newer.running_balance_cents
        });
    let check = if consistent {
        FileBalanceCheck::Passed
    } else {
        FileBalanceCheck::Mismatch
    };
    (check, ledger)
}

fn no_header() -> AppError {
    AppError::Import("This CSV file has no header row.".into())
}

/// Stores the first problem and turns the result into an `Option`.
fn keep<T>(result: Result<T, FieldError>, error: &mut Option<String>) -> Option<T> {
    result
        .map_err(|problem| {
            error.get_or_insert_with(|| problem.for_preview());
        })
        .ok()
}

/// One CSV record with its 1-based line and its exact source text.
struct Record<'a> {
    line: u32,
    cells: csv::StringRecord,
    original: &'a str,
}

struct Records<'a> {
    text: &'a str,
    reader: csv::Reader<&'a [u8]>,
    /// Newlines are counted up to this byte; `line` is the 1-based line there.
    counted: usize,
    line: usize,
}

impl<'a> Records<'a> {
    fn new(text: &'a str) -> Self {
        let text = text.strip_prefix('\u{feff}').unwrap_or(text);
        let reader = csv::ReaderBuilder::new()
            .has_headers(false)
            .from_reader(text.as_bytes());
        Self {
            text,
            reader,
            counted: 0,
            line: 1,
        }
    }

    fn header(&mut self) -> Result<Vec<String>, AppError> {
        let record = self.next()?.ok_or_else(no_header)?;
        Ok(record
            .cells
            .iter()
            .map(|cell| cell.trim().to_owned())
            .collect())
    }

    fn next(&mut self) -> Result<Option<Record<'a>>, AppError> {
        let mut cells = csv::StringRecord::new();
        match self.reader.read_record(&mut cells) {
            Ok(true) => {}
            Ok(false) => return Ok(None),
            Err(error) => return Err(self.read_error(&error)),
        }
        let start = cells.position().map_or(0, csv::Position::byte);
        let end = self.reader.position().byte();
        let original = self
            .text
            .get(to_usize(start)..to_usize(end))
            .unwrap_or_default()
            .trim_matches(['\r', '\n']);
        Ok(Some(Record {
            line: self.line_at(start),
            cells,
            original,
        }))
    }

    /// The 1-based line of the record at or after `byte`. The csv crate's positions can point at
    /// the previous record's terminator, so line terminators and blank lines are skipped first.
    fn line_at(&mut self, byte: u64) -> u32 {
        let byte = to_usize(byte);
        let rest = self.text.get(byte..).unwrap_or_default();
        let start = byte + (rest.len() - rest.trim_start_matches(['\r', '\n']).len());
        if start > self.counted {
            let skipped = self.text.get(self.counted..start).unwrap_or_default();
            self.line += skipped.matches('\n').count();
            self.counted = start;
        }
        u32::try_from(self.line).unwrap_or(u32::MAX)
    }

    fn read_error(&mut self, error: &csv::Error) -> AppError {
        let line = error
            .position()
            .map(|position| self.line_at(position.byte()));
        let message = match (error.kind(), line) {
            (
                csv::ErrorKind::UnequalLengths {
                    expected_len, len, ..
                },
                Some(line),
            ) => {
                format!("Line {line}: this row has {len} columns; the header has {expected_len}.")
            }
            (_, Some(line)) => format!("Line {line}: this row couldn't be read as CSV."),
            (_, None) => "This file couldn't be read as CSV.".into(),
        };
        AppError::Import(message)
    }
}

fn to_usize(byte: u64) -> usize {
    usize::try_from(byte).unwrap_or(usize::MAX)
}

/// A problem with one cell: "{column} {value} {problem}".
struct FieldError {
    column: String,
    value: String,
    problem: String,
}

impl FieldError {
    fn at_line(self, line: u32) -> AppError {
        AppError::Import(format!("Line {line}: {}", self.sentence(" ")))
    }

    fn for_preview(&self) -> String {
        self.sentence(": ")
    }

    fn sentence(&self, separator: &str) -> String {
        if self.value.is_empty() {
            format!("{} {}", self.column, self.problem)
        } else {
            format!("{}{separator}{} {}", self.column, self.value, self.problem)
        }
    }
}

struct Row<'a> {
    headers: &'a [String],
    record: &'a Record<'a>,
}

impl Row<'_> {
    fn name(&self, column: u32) -> String {
        usize::try_from(column)
            .ok()
            .and_then(|index| self.headers.get(index))
            .cloned()
            .unwrap_or_else(|| format!("Column {}", u64::from(column) + 1))
    }

    fn error(&self, column: u32, value: &str, problem: impl Into<String>) -> FieldError {
        FieldError {
            column: self.name(column),
            value: value.to_owned(),
            problem: problem.into(),
        }
    }

    /// The trimmed cell.
    fn cell(&self, column: u32) -> Result<&str, FieldError> {
        usize::try_from(column)
            .ok()
            .and_then(|index| self.record.cells.get(index))
            .map(str::trim)
            .ok_or_else(|| self.error(column, "", "isn't in this file."))
    }

    /// An optional text field; empty means `None`.
    fn text(&self, column: Option<u32>) -> Result<Option<String>, FieldError> {
        let Some(column) = column else {
            return Ok(None);
        };
        let cell = self.cell(column)?;
        Ok((!cell.is_empty()).then(|| cell.to_owned()))
    }

    /// R5: with no status column every row counts as posted.
    fn posted(&self, column: Option<u32>) -> Result<bool, FieldError> {
        match column {
            Some(column) => Ok(self.cell(column)?.eq_ignore_ascii_case("posted")),
            None => Ok(true),
        }
    }

    fn date(&self, mapping: &CsvMapping) -> Result<String, FieldError> {
        let cell = self.cell(mapping.posted_date)?;
        iso_date(cell, mapping.date_format).ok_or_else(|| {
            let problem = format!("isn't a {} date.", date_format_label(mapping.date_format));
            self.error(mapping.posted_date, cell, problem)
        })
    }

    fn amount(&self, columns: AmountColumns) -> Result<i64, FieldError> {
        match columns {
            AmountColumns::Signed { column } => {
                let cell = self.cell(column)?;
                if cell.is_empty() {
                    return Err(self.error(column, "", "is empty."));
                }
                cents(cell).map_err(|problem| self.error(column, cell, problem))
            }
            AmountColumns::Split { debit, credit } => {
                let (debit_cell, credit_cell) = (self.cell(debit)?, self.cell(credit)?);
                if debit_cell.is_empty() && credit_cell.is_empty() {
                    return Err(FieldError {
                        column: format!("{} and {}", self.name(debit), self.name(credit)),
                        value: String::new(),
                        problem: "are both empty.".into(),
                    });
                }
                let magnitude = |column: u32, cell: &str| match cell {
                    "" => Ok(0),
                    _ => cents(cell)
                        .map(i64::abs)
                        .map_err(|problem| self.error(column, cell, problem)),
                };
                let (out, into) = (
                    magnitude(debit, debit_cell)?,
                    magnitude(credit, credit_cell)?,
                );
                Ok(into - out)
            }
        }
    }

    /// A running balance; an empty cell is `None`.
    fn balance(&self, column: Option<u32>) -> Result<Option<i64>, FieldError> {
        let Some(column) = column else {
            return Ok(None);
        };
        let cell = self.cell(column)?;
        if cell.is_empty() {
            return Ok(None);
        }
        cents(cell)
            .map(Some)
            .map_err(|problem| self.error(column, cell, problem))
    }
}

fn date_format_label(format: DateFormat) -> &'static str {
    match format {
        DateFormat::MmDdYyyy => "MM/DD/YYYY",
        DateFormat::MDYyyy => "M/D/YYYY",
        DateFormat::YyyyMmDd => "YYYY-MM-DD",
        DateFormat::DdMmYyyy => "DD/MM/YYYY",
    }
}

/// A real calendar date in the given format, as "YYYY-MM-DD".
fn iso_date(value: &str, format: DateFormat) -> Option<String> {
    let separator = if format == DateFormat::YyyyMmDd {
        '-'
    } else {
        '/'
    };
    let parts: Vec<&str> = value.split(separator).collect();
    let [a, b, c] = parts.as_slice() else {
        return None;
    };
    let (year, month, day) = match format {
        DateFormat::MmDdYyyy | DateFormat::MDYyyy => (c, a, b),
        DateFormat::YyyyMmDd => (a, b, c),
        DateFormat::DdMmYyyy => (c, b, a),
    };
    let short = format == DateFormat::MDYyyy;
    let digits = |part: &str, width: usize| {
        part.bytes().all(|byte| byte.is_ascii_digit())
            && (part.len() == width || (short && width == 2 && part.len() == 1))
    };
    if !(digits(year, 4) && digits(month, 2) && digits(day, 2)) {
        return None;
    }
    let iso = format!("{year}-{month:0>2}-{day:0>2}");
    is_date(&iso).then_some(iso)
}

/// R3: optional `-`, optional `$` (also `$-`), digits, optional `.` and 1-5 digits; whole cents only.
/// Parsed as text, never via float.
fn cents(value: &str) -> Result<i64, &'static str> {
    const NOT_AN_AMOUNT: &str = "isn't an amount.";
    let (negative, rest) = if let Some(rest) = value.strip_prefix('-') {
        (true, rest.strip_prefix('$').unwrap_or(rest))
    } else if let Some(rest) = value.strip_prefix("$-") {
        (true, rest)
    } else {
        (false, value.strip_prefix('$').unwrap_or(value))
    };
    let (whole, fraction) = match rest.split_once('.') {
        Some((whole, fraction)) if (1..=5).contains(&fraction.len()) => (whole, fraction),
        Some(_) => return Err(NOT_AN_AMOUNT),
        None => (rest, ""),
    };
    let all_digits = |part: &str| part.bytes().all(|byte| byte.is_ascii_digit());
    if whole.is_empty() || !all_digits(whole) || !all_digits(fraction) {
        return Err(NOT_AN_AMOUNT);
    }
    let (fraction, beyond_cents) = fraction.split_at(fraction.len().min(2));
    if beyond_cents.bytes().any(|byte| byte != b'0') {
        return Err("isn't a whole number of cents.");
    }
    let total = whole
        .parse::<i64>()
        .ok()
        .and_then(|whole| whole.checked_mul(100))
        .and_then(|whole| whole.checked_add(format!("{fraction:0<2}").parse().ok()?))
        .ok_or(NOT_AN_AMOUNT)?;
    Ok(if negative { -total } else { total })
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: &str = "Date,Description,Amount,Balance,Status\n";

    /// Columns of `HEADER`.
    fn simple() -> CsvMapping {
        CsvMapping {
            date_format: DateFormat::MmDdYyyy,
            posted_date: 0,
            description: 1,
            amount: AmountColumns::Signed { column: 2 },
            transaction_id: None,
            memo: None,
            transaction_type: None,
            running_balance: Some(3),
            posting_status: Some(4),
            bank_category: None,
        }
    }

    /// The bank layout (PRD R11 header names).
    fn bank() -> CsvMapping {
        CsvMapping {
            date_format: DateFormat::MmDdYyyy,
            posted_date: 1,
            description: 8,
            amount: AmountColumns::Signed { column: 5 },
            transaction_id: Some(0),
            memo: Some(13),
            transaction_type: Some(3),
            running_balance: Some(11),
            posting_status: Some(4),
            bank_category: Some(9),
        }
    }

    fn import_error<T: std::fmt::Debug>(result: Result<T, AppError>) -> String {
        match result {
            Err(AppError::Import(message)) => message,
            other => panic!("expected an import error, got {other:?}"),
        }
    }

    fn amounts(statement: &ParsedStatement) -> Vec<i64> {
        statement
            .transactions
            .iter()
            .map(|t| t.amount_cents)
            .collect()
    }

    #[test]
    fn headers_normalise_to_the_same_fingerprint() {
        let a = read_header("\"Posting Date\",\" Amount \"\n").unwrap();
        let b = read_header("\u{feff}\"posting  date\",\"AMOUNT\"\r\n").unwrap();
        assert_eq!(a, ["Posting Date", "Amount"]);
        assert_eq!(b, ["posting  date", "AMOUNT"]);
        assert_eq!(fingerprint(&a), "posting date\namount");
        assert_eq!(fingerprint(&a), fingerprint(&b));
        assert_eq!(
            normalise("\tExtended   Description "),
            "extended description"
        );
    }

    #[test]
    fn a_file_without_a_header_is_rejected_and_header_only_is_empty() {
        for text in ["", "\n\r\n"] {
            assert_eq!(
                import_error(read_header(text)),
                "This CSV file has no header row."
            );
            assert_eq!(
                import_error(parse(text, &simple())),
                "This CSV file has no header row."
            );
        }
        let empty = parse(HEADER, &simple()).unwrap();
        assert!(empty.transactions.is_empty());
        assert_eq!(empty.not_posted, 0);
        assert_eq!(empty.file_balance_check, FileBalanceCheck::NotChecked);
        assert_eq!(
            (empty.ledger_balance_cents, empty.balance_as_of),
            (None, None)
        );
        assert_eq!(empty.currency, "USD");
    }

    #[test]
    fn dates_follow_each_format_and_must_be_real() {
        use DateFormat::*;
        let cases = [
            (MmDdYyyy, "10/03/2026", Some("2026-10-03")),
            (MmDdYyyy, "10/3/2026", None),
            (MmDdYyyy, "02/29/2027", None),
            (MmDdYyyy, "02/29/2028", Some("2028-02-29")),
            (MmDdYyyy, "13/01/2026", None),
            (MDYyyy, "10/3/2026", Some("2026-10-03")),
            (MDYyyy, "1/3/2026", Some("2026-01-03")),
            (MDYyyy, "10/03/2026", Some("2026-10-03")),
            (MDYyyy, "10/3/26", None),
            (MDYyyy, "100/3/2026", None),
            (YyyyMmDd, "2026-10-03", Some("2026-10-03")),
            (YyyyMmDd, "2026-10-3", None),
            (YyyyMmDd, "2026/10/03", None),
            (DdMmYyyy, "03/10/2026", Some("2026-10-03")),
            (DdMmYyyy, "31/04/2026", None),
            (DdMmYyyy, "3/10/2026", None),
            (MmDdYyyy, "", None),
            (MmDdYyyy, "10/03/2026/1", None),
        ];
        for (format, text, expected) in cases {
            assert_eq!(
                iso_date(text, format).as_deref(),
                expected,
                "{text} as {format:?}"
            );
        }
    }

    #[test]
    fn amounts_parse_to_cents_without_floats() {
        let ok = [
            ("-18.40000", -1840),
            ("2100.00000", 210_000),
            ("$12.5", 1250),
            ("-$4.25", -425),
            ("$-4.25", -425),
            ("7", 700),
            ("0.10", 10),
            ("-0.00", 0),
        ];
        for (text, expected) in ok {
            assert_eq!(cents(text), Ok(expected), "{text}");
        }
        for text in ["0.00500", "12.345", "0.001"] {
            assert_eq!(cents(text), Err("isn't a whole number of cents."), "{text}");
        }
        for text in [
            "1,200.00",
            "",
            "$",
            "-",
            ".50",
            "12.",
            "1.000000",
            "+5",
            "--5",
            "5-",
            "1e3",
            "99999999999999999999",
        ] {
            assert_eq!(cents(text), Err("isn't an amount."), "{text}");
        }
    }

    #[test]
    fn signed_amount_errors_name_the_line() {
        let text = format!("{HEADER}10/01/2026,A,-1.00,,\n10/02/2026,B, 0.00500 ,,\n");
        let mapping = CsvMapping {
            posting_status: None,
            ..simple()
        };
        assert_eq!(
            import_error(parse(&text, &mapping)),
            "Line 3: Amount 0.00500 isn't a whole number of cents."
        );
        let empty = format!("{HEADER}10/01/2026,A,,,\n");
        assert_eq!(
            import_error(parse(&empty, &mapping)),
            "Line 2: Amount is empty."
        );
        let comma = format!("{HEADER}10/01/2026,A,\"1,200.00\",,\n");
        assert_eq!(
            import_error(parse(&comma, &mapping)),
            "Line 2: Amount 1,200.00 isn't an amount."
        );
        let date = format!("{HEADER}13/45/2026,A,1.00,,\n");
        assert_eq!(
            import_error(parse(&date, &mapping)),
            "Line 2: Date 13/45/2026 isn't a MM/DD/YYYY date."
        );
        let balance = format!("{HEADER}10/01/2026,A,1.00,1.001,\n");
        assert_eq!(
            import_error(parse(&balance, &mapping)),
            "Line 2: Balance 1.001 isn't a whole number of cents."
        );
    }

    #[test]
    fn split_amount_is_credit_minus_debit() {
        let mapping = CsvMapping {
            amount: AmountColumns::Split {
                debit: 2,
                credit: 3,
            },
            running_balance: None,
            posting_status: None,
            ..simple()
        };
        let header = "Date,Description,Debit,Credit\n";
        let text = format!(
            "{header}10/01/2026,A,45.00,\n10/02/2026,B,,$1000\n10/03/2026,C,-45.00,\n10/04/2026,D,1.00,-3.00\n"
        );
        assert_eq!(
            amounts(&parse(&text, &mapping).unwrap()),
            [-4500, 100_000, -4500, 200]
        );

        let comma = format!("{header}10/01/2026,A,,\"$1,000\"\n");
        assert_eq!(
            import_error(parse(&comma, &mapping)),
            "Line 2: Credit $1,000 isn't an amount."
        );
        let both_empty = format!("{header}10/01/2026,A,10.00,\n10/02/2026,B, ,\n");
        assert_eq!(
            import_error(parse(&both_empty, &mapping)),
            "Line 3: Debit and Credit are both empty."
        );
    }

    #[test]
    fn only_posted_rows_import_and_others_are_counted_unparsed() {
        let text = format!(
            "{HEADER}10/01/2026,A,1.00,,Posted\n\
             10/02/2026,B,2.00,, posted \n\
             garbage,C,0.001,x,Pending\n\
             10/04/2026,D,4.00,,\n\
             10/05/2026,E,5.00,,POSTED\n"
        );
        let mapping = CsvMapping {
            running_balance: None,
            ..simple()
        };
        let statement = parse(&text, &mapping).unwrap();
        assert_eq!(amounts(&statement), [100, 200, 500]);
        assert_eq!(statement.not_posted, 2);

        let all = CsvMapping {
            posting_status: None,
            running_balance: None,
            ..simple()
        };
        assert_eq!(
            import_error(parse(&text, &all)),
            "Line 4: Date garbage isn't a MM/DD/YYYY date."
        );
    }

    #[test]
    fn text_fields_are_trimmed_and_empty_is_none() {
        let header = "ID,Date,Description,Amount,Memo,Type,Category\n";
        let mapping = CsvMapping {
            date_format: DateFormat::MmDdYyyy,
            posted_date: 1,
            description: 2,
            amount: AmountColumns::Signed { column: 3 },
            transaction_id: Some(0),
            memo: Some(4),
            transaction_type: Some(5),
            running_balance: None,
            posting_status: None,
            bank_category: Some(6),
        };
        let text = format!(
            "{header} X1 ,10/01/2026, Fresh Market ,-1.00, note ,POS,Groceries\n,10/02/2026,,2.00,,,\n"
        );
        let statement = parse(&text, &mapping).unwrap();
        let [first, second] = statement.transactions.as_slice() else {
            panic!("expected two rows");
        };
        assert_eq!(first.fitid.as_deref(), Some("X1"));
        assert_eq!(first.description, "Fresh Market");
        assert_eq!(first.memo.as_deref(), Some("note"));
        assert_eq!(first.transaction_type.as_deref(), Some("POS"));
        assert_eq!(first.bank_category.as_deref(), Some("Groceries"));
        assert_eq!(first.running_balance_cents, None);
        assert_eq!(
            (
                &second.fitid,
                second.description.as_str(),
                &second.memo,
                &second.bank_category
            ),
            (&None, "", &None, &None)
        );
    }

    #[test]
    fn original_is_the_exact_record_text_with_its_line() {
        let text = "\u{feff}Date,Description,Amount\r\n\
                    \"10/01/2026\",\"Fresh \"\"Market\"\"\",\"-1.00\"\r\n\
                    \r\n\
                    10/02/2026,\"Two\nlines\",2.00\r\n\
                    10/03/2026,Last,3.00";
        let mapping = CsvMapping {
            running_balance: None,
            posting_status: None,
            ..simple()
        };
        let statement = parse(text, &mapping).unwrap();
        let originals: Vec<_> = statement
            .transactions
            .iter()
            .map(|t| t.original.as_str())
            .collect();
        assert_eq!(
            originals,
            [
                "\"10/01/2026\",\"Fresh \"\"Market\"\"\",\"-1.00\"",
                "10/02/2026,\"Two\nlines\",2.00",
                "10/03/2026,Last,3.00",
            ]
        );
        assert_eq!(statement.transactions[0].description, "Fresh \"Market\"");
        let lines: Vec<_> = preview(text, &mapping, 5)
            .unwrap()
            .iter()
            .map(|r| r.line)
            .collect();
        assert_eq!(lines, [2, 4, 6]);
    }

    #[test]
    fn rows_with_the_wrong_column_count_or_missing_columns_error_without_panicking() {
        let text = format!("{HEADER}10/01/2026,A,1.00,,Posted\n10/02/2026,B\n");
        assert_eq!(
            import_error(parse(&text, &simple())),
            "Line 3: this row has 2 columns; the header has 5."
        );
        let mapping = CsvMapping {
            description: 40,
            ..simple()
        };
        let one = format!("{HEADER}10/01/2026,A,1.00,,Posted\n");
        assert_eq!(
            import_error(parse(&one, &mapping)),
            "Line 2: Column 41 isn't in this file."
        );
        let rows = preview(
            &one,
            &CsvMapping {
                posted_date: u32::MAX,
                ..simple()
            },
            5,
        )
        .unwrap();
        assert_eq!(
            rows[0].error.as_deref(),
            Some("Column 4294967296 isn't in this file.")
        );
    }

    fn balance_check(rows: &str) -> ParsedStatement {
        parse(&format!("{HEADER}{rows}"), &simple()).unwrap()
    }

    #[test]
    fn running_balance_oldest_first_passes() {
        let statement =
            balance_check("10/01/2026,A,-5.00,95.00,Posted\n10/02/2026,B,10.00,105.00,Posted\n");
        assert_eq!(statement.file_balance_check, FileBalanceCheck::Passed);
        assert_eq!(statement.ledger_balance_cents, Some(10_500));
        assert_eq!(statement.balance_as_of.as_deref(), Some("2026-10-02"));
    }

    #[test]
    fn running_balance_newest_first_passes_and_ignores_pending_rows() {
        let statement = balance_check(
            "10/31/2026,P,-18.40,,Pending\n\
             10/30/2026,A,2100.00,10297.91,Posted\n\
             10/29/2026,B,-120.00,8197.91,Posted\n",
        );
        assert_eq!(statement.file_balance_check, FileBalanceCheck::Passed);
        assert_eq!(statement.ledger_balance_cents, Some(1_029_791));
        assert_eq!(statement.balance_as_of.as_deref(), Some("2026-10-30"));
        assert_eq!(statement.not_posted, 1);
    }

    #[test]
    fn running_balance_with_one_date_is_oldest_first() {
        let statement =
            balance_check("10/01/2026,A,-5.00,95.00,Posted\n10/01/2026,B,-5.00,90.00,Posted\n");
        assert_eq!(statement.file_balance_check, FileBalanceCheck::Passed);
        assert_eq!(statement.ledger_balance_cents, Some(9000));
        // Read newest-first, the same rows would not add up.
        let reversed =
            balance_check("10/01/2026,B,-5.00,90.00,Posted\n10/01/2026,A,-5.00,95.00,Posted\n");
        assert_eq!(reversed.file_balance_check, FileBalanceCheck::Mismatch);
        assert_eq!(reversed.ledger_balance_cents, Some(9500));
    }

    #[test]
    fn running_balance_mismatch_still_feeds_the_newest_balance() {
        let off =
            balance_check("10/02/2026,B,10.00,105.01,Posted\n10/01/2026,A,-5.00,95.00,Posted\n");
        assert_eq!(off.file_balance_check, FileBalanceCheck::Mismatch);
        assert_eq!(off.ledger_balance_cents, Some(10_501));
        assert_eq!(off.balance_as_of.as_deref(), Some("2026-10-02"));

        let gap = balance_check("10/01/2026,A,-5.00,,Posted\n10/02/2026,B,10.00,105.00,Posted\n");
        assert_eq!(gap.file_balance_check, FileBalanceCheck::Mismatch);
        assert_eq!(gap.ledger_balance_cents, Some(10_500));

        let newest_empty =
            balance_check("10/01/2026,A,-5.00,95.00,Posted\n10/02/2026,B,10.00,,Posted\n");
        assert_eq!(newest_empty.file_balance_check, FileBalanceCheck::Mismatch);
        assert_eq!(
            (
                newest_empty.ledger_balance_cents,
                newest_empty.balance_as_of
            ),
            (None, None)
        );
    }

    #[test]
    fn running_balance_single_row_passes_and_unmapped_or_empty_is_not_checked() {
        let one = balance_check("10/01/2026,A,-5.00,95.00,Posted\n");
        assert_eq!(one.file_balance_check, FileBalanceCheck::Passed);
        assert_eq!(one.ledger_balance_cents, Some(9500));

        let one_empty = balance_check("10/01/2026,A,-5.00,,Posted\n");
        assert_eq!(one_empty.file_balance_check, FileBalanceCheck::Mismatch);

        let pending_only = balance_check("10/01/2026,A,-5.00,95.00,Pending\n");
        assert_eq!(
            pending_only.file_balance_check,
            FileBalanceCheck::NotChecked
        );
        assert_eq!(pending_only.ledger_balance_cents, None);

        let unmapped = parse(
            &format!("{HEADER}10/01/2026,A,-5.00,95.00,Posted\n"),
            &CsvMapping {
                running_balance: None,
                ..simple()
            },
        )
        .unwrap();
        assert_eq!(unmapped.file_balance_check, FileBalanceCheck::NotChecked);
        assert_eq!(
            (unmapped.ledger_balance_cents, unmapped.balance_as_of),
            (None, None)
        );
        assert_eq!(unmapped.transactions[0].running_balance_cents, None);
    }

    #[test]
    fn preview_parses_the_first_rows_and_reports_each_rows_first_problem() {
        let text = format!(
            "{HEADER}10/01/2026,A,-1.00,99.00,Posted\n\
             13/45/2026,B,0.001,x,Posted\n\
             bad,C,bad,,Pending\n\
             10/04/2026,D,4.00,,Posted\n"
        );
        let rows = preview(&text, &simple(), 3).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].line, 2);
        assert_eq!(rows[0].posted_date.as_deref(), Some("2026-10-01"));
        assert_eq!(rows[0].amount_cents, Some(-100));
        assert_eq!(rows[0].description.as_deref(), Some("A"));
        assert_eq!(rows[0].running_balance_cents, Some(9900));
        assert_eq!(rows[0].posting_status.as_deref(), Some("Posted"));
        assert_eq!(rows[0].error, None);

        assert_eq!(rows[1].posted_date, None);
        assert_eq!(rows[1].amount_cents, None);
        assert_eq!(rows[1].description.as_deref(), Some("B"));
        assert_eq!(
            rows[1].error.as_deref(),
            Some("Date: 13/45/2026 isn't a MM/DD/YYYY date.")
        );

        // A pending row is skipped on import, so its bad cells are no error.
        assert_eq!(rows[2].posting_status.as_deref(), Some("Pending"));
        assert_eq!(rows[2].error, None);
        assert_eq!(preview(HEADER, &simple(), 5).unwrap().len(), 0);
    }

    #[test]
    fn sample_rows_returns_raw_cells() {
        let text = format!("{HEADER}10/01/2026, A ,1.00,,Posted\n10/02/2026,B,2.00,,Posted\n");
        let rows = sample_rows(&text, 1).unwrap();
        assert_eq!(rows, [["10/01/2026", " A ", "1.00", "", "Posted"]]);
        assert_eq!(sample_rows(&text, 5).unwrap().len(), 2);
        assert_eq!(
            import_error(sample_rows("", 5)),
            "This CSV file has no header row."
        );
    }

    #[test]
    fn parses_the_october_sample_with_the_bank_layout() {
        let text = include_str!("../../samples/checking-2026-10.csv");
        let statement = parse(text, &bank()).unwrap();
        assert_eq!(statement.transactions.len(), 27);
        assert_eq!(statement.not_posted, 1);
        assert_eq!(statement.file_balance_check, FileBalanceCheck::Passed);
        assert_eq!(statement.ledger_balance_cents, Some(1_029_791));
        assert_eq!(statement.balance_as_of.as_deref(), Some("2026-10-30"));
        let first = &statement.transactions[0];
        assert_eq!(first.fitid.as_deref(), Some("20261030 ECB 00027"));
        assert_eq!(first.amount_cents, 210_000);
        assert_eq!(first.description, "Acme Payroll");
        assert_eq!(first.memo.as_deref(), Some("ACME PAYROLL"));
        assert_eq!(first.transaction_type.as_deref(), Some("Credit"));
        assert_eq!(first.bank_category.as_deref(), Some("Paychecks"));
        assert_eq!(text.lines().nth(2), Some(first.original.as_str()));
    }

    fn fixture(name: &str) -> String {
        let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    fn parses_every_csv_fixture_as_the_readme_says() {
        let bank_file = parse(&fixture("checking-bank.csv"), &bank()).unwrap();
        assert_eq!(bank_file.transactions.len(), 6);
        assert_eq!(bank_file.not_posted, 1);
        assert_eq!(bank_file.file_balance_check, FileBalanceCheck::Passed);
        assert_eq!(bank_file.ledger_balance_cents, Some(630_401));
        assert_eq!(bank_file.balance_as_of.as_deref(), Some("2026-11-30"));
        // Ledger of checking-broken-balance.ofx plus checking-no-fitid.ofx's rows, then this file.
        let opening = 439_309 - 450 - 450 - 1999;
        assert_eq!(opening + amounts(&bank_file).iter().sum::<i64>(), 630_401);
        assert_eq!(
            bank_file.transactions[3].memo.as_deref(),
            Some("ACME PAYROLL, DIRECT DEP")
        );

        let reimport = parse(&fixture("checking-bank-reimport.csv"), &bank()).unwrap();
        assert_eq!(reimport.transactions.len(), 5);
        assert_eq!(reimport.file_balance_check, FileBalanceCheck::Passed);
        assert_eq!(reimport.ledger_balance_cents, Some(646_061));
        assert_eq!(reimport.balance_as_of.as_deref(), Some("2026-12-03"));
        let shared = reimport
            .transactions
            .iter()
            .filter(|row| bank_file.transactions.contains(row))
            .count();
        assert_eq!(shared, 2);

        let split_mapping = CsvMapping {
            date_format: DateFormat::MDYyyy,
            posted_date: 0,
            description: 1,
            amount: AmountColumns::Split {
                debit: 2,
                credit: 3,
            },
            transaction_id: None,
            memo: None,
            transaction_type: None,
            running_balance: Some(4),
            posting_status: None,
            bank_category: None,
        };
        let split = parse(&fixture("checking-split.csv"), &split_mapping).unwrap();
        assert_eq!(amounts(&split), [-2310, 210_000, -9120, -450]);
        assert_eq!(split.transactions[2].description, "City Power, Light & Gas");
        assert_eq!(split.file_balance_check, FileBalanceCheck::Passed);
        assert_eq!(split.ledger_balance_cents, Some(844_181));
        assert_eq!(split.balance_as_of.as_deref(), Some("2026-12-08"));
        assert_eq!(646_061 + amounts(&split).iter().sum::<i64>(), 844_181);

        let overlap_mapping = CsvMapping {
            date_format: DateFormat::YyyyMmDd,
            posted_date: 0,
            description: 1,
            amount: AmountColumns::Signed { column: 2 },
            transaction_id: None,
            memo: None,
            transaction_type: None,
            running_balance: None,
            posting_status: None,
            bank_category: None,
        };
        let overlap = parse(&fixture("checking-overlap-ofx.csv"), &overlap_mapping).unwrap();
        assert_eq!(amounts(&overlap), [-4210, -12_055, -30_000, -1575, -6731]);
        assert_eq!(overlap.file_balance_check, FileBalanceCheck::NotChecked);
        assert_eq!(overlap.ledger_balance_cents, None);

        let broken = parse(&fixture("checking-broken-running-balance.csv"), &bank()).unwrap();
        assert_eq!(broken.transactions.len(), 3);
        assert_eq!(broken.file_balance_check, FileBalanceCheck::Mismatch);
        assert_eq!(broken.ledger_balance_cents, Some(146_501));
        assert_eq!(broken.balance_as_of.as_deref(), Some("2026-12-12"));

        assert_eq!(
            import_error(parse(&fixture("checking-sub-cent.csv"), &bank())),
            "Line 3: Amount 0.00500 isn't a whole number of cents."
        );
        assert_eq!(
            import_error(parse(&fixture("checking-bad-date.csv"), &bank())),
            "Line 2: Posting Date 13/05/2026 isn't a MM/DD/YYYY date."
        );
    }
}
